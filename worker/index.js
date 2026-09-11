/* SAAHAA · worker/index.js — the only place that may clear money.
 *
 * WHY THIS EXISTS AT ALL. The browser cannot be trusted with three things: the
 * service-role key, the decision that a payment is real, and the webhook
 * secret. Everything else stays client-side exactly as it is today. This Worker
 * is deliberately small — if it grows a fourth responsibility, question it.
 *
 * ENDPOINTS
 *   GET  /api/health          — liveness, and the Supabase keep-alive target
 *   POST /api/claim           — she says she has paid (validated, deduped)
 *   POST /api/pro-check       — he says he saw it
 *   POST /api/clear           — an admin matched the statement  [admin only]
 *   POST /api/hooks/db        — Supabase DB webhook, HMAC-verified
 *   POST /api/hooks/psp       — the future PSP callback, same verification
 *
 * SECRETS (wrangler secret put ...): SUPABASE_URL, SUPABASE_SERVICE_KEY,
 * HOOK_SECRET, ADMIN_CODES. None of these may ever appear in the repo.
 */

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...cors() },
});
const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
});

const UTR_RE = /^\d{12}$/;
const REF_RE = /^SA[A-Z0-9]{1,8}$/;

/** Supabase REST, with the service role. Never reachable from a browser. */
async function db(env, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: init.prefer || 'return=representation',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

/* CONSTANT TIME, BECAUSE A WEBHOOK SECRET IS A PASSWORD. A plain === leaks the
   length of the matching prefix to anyone willing to send a few thousand
   requests, which a Worker is very happy to accept. */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a || '');
  const y = new TextEncoder().encode(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A signed hook, or nothing. Returns the parsed body or null. */
async function verifiedBody(request, env) {
  const raw = await request.text();
  const given = request.headers.get('x-saahaa-signature') || '';
  const want = await hmacHex(env.HOOK_SECRET, raw);
  if (!safeEqual(given, want)) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** Who is asking. The browser sends its Supabase JWT; we ask Supabase who it is
    rather than believing a claim in the body. */
async function whoami(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: auth },
  });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await db(env, `profiles?id=eq.${u.id}&select=code,role`);
  return (p.ok && p.body && p.body[0]) || null;
}

const isAdmin = (env, me) =>
  !!me && (me.role === 'admin'
    || String(env.ADMIN_CODES || '').split(',').map(s => s.trim()).includes(me.code));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    // ── health, and the thing the weekly cron touches ────────
    if (path === '/api/health') {
      const r = await db(env, 'rpc/beat', { method: 'POST', body: '{}' });
      return json({ ok: r.ok, beat: r.body, at: new Date().toISOString() }, r.ok ? 200 : 503);
    }

    // ── she claims ───────────────────────────────────────────
    if (path === '/api/claim' && request.method === 'POST') {
      const me = await whoami(request, env);
      if (!me) return json({ ok: false, reason: 'sign in first' }, 401);
      const b = await request.json().catch(() => ({}));
      const utr = String(b.utr || '').replace(/\s+/g, '');
      if (!UTR_RE.test(utr)) return json({ ok: false, reason: 'A UTR is the 12-digit number your bank app shows.' }, 400);
      if (!REF_RE.test(String(b.reference || ''))) return json({ ok: false, reason: 'bad reference' }, 400);

      const order = await db(env, `orders?id=eq.${encodeURIComponent(b.orderId)}&select=*`);
      const o = order.ok && order.body && order.body[0];
      if (!o) return json({ ok: false, reason: 'no such order' }, 404);
      if (o.customer_code !== me.code) return json({ ok: false, reason: 'not your order' }, 403);

      /* THE DEDUPE IS THE DATABASE'S JOB, NOT OURS. Two requests can pass a
         SELECT check at the same moment and both insert; only the partial
         unique index can actually stop that, so we let it, and read 23505. */
      const ins = await db(env, 'payments', {
        method: 'POST',
        body: JSON.stringify({
          order_id: o.id, utr, reference: b.reference,
          expected: o.customer_pays, claimed_by: me.code, state: 'CLAIMED',
        }),
      });
      if (!ins.ok) {
        const dup = ins.status === 409 || (ins.body && String(ins.body.code) === '23505');
        return json({ ok: false, reason: dup
          ? 'That UTR is already recorded against another order. Check the number.'
          : 'could not record that' }, dup ? 409 : 500);
      }
      return json({ ok: true, payment: ins.body && ins.body[0] });
    }

    // ── he checks ────────────────────────────────────────────
    if (path === '/api/pro-check' && request.method === 'POST') {
      const me = await whoami(request, env);
      if (!me || (me.role !== 'partner' && me.role !== 'shop')) return json({ ok: false }, 403);
      const b = await request.json().catch(() => ({}));
      const patch = b.saw
        ? { state: 'PRO_CHECKED', pro_checked_by: me.code, pro_checked_at: new Date().toISOString() }
        : { state: 'REJECTED', reject_reason: 'the pro could not see the payment' };
      const r = await db(env, `payments?order_id=eq.${encodeURIComponent(b.orderId)}&state=eq.CLAIMED`,
        { method: 'PATCH', body: JSON.stringify(patch) });
      return json({ ok: r.ok, payment: r.body && r.body[0] }, r.ok ? 200 : 500);
    }

    // ── an admin clears it against the statement ─────────────
    if (path === '/api/clear' && request.method === 'POST') {
      const me = await whoami(request, env);
      if (!isAdmin(env, me)) return json({ ok: false, reason: 'admins only' }, 403);
      const b = await request.json().catch(() => ({}));
      const rows = await db(env, `payments?order_id=eq.${encodeURIComponent(b.orderId)}&state=in.(CLAIMED,PRO_CHECKED)&select=*`);
      const p = rows.ok && rows.body && rows.body[0];
      if (!p) return json({ ok: false, reason: 'nothing to clear' }, 404);

      if (b.ok === false) {
        const r = await db(env, `payments?id=eq.${p.id}`, { method: 'PATCH',
          body: JSON.stringify({ state: 'REJECTED', reject_reason: String(b.note || 'not in the statement').slice(0, 200) }) });
        return json({ ok: r.ok });
      }
      const seen = b.seen == null ? p.expected : Number(b.seen) | 0;
      const short = Math.max(0, p.expected - seen);
      const r = await db(env, `payments?id=eq.${p.id}`, { method: 'PATCH',
        body: JSON.stringify({ state: 'CLEARED', seen, short_by: short,
          cleared_by: me.code, cleared_at: new Date().toISOString() }) });
      if (!r.ok) return json({ ok: false }, 500);

      /* escrow is funded here and nowhere else, and the ledger row is the
         proof. A short payment funds what the statement showed, not the bill. */
      await db(env, 'ledger', { method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({
          kind: 'ESCROW_IN', paise: seen,
          from_acct: 'CUSTOMER:' + p.claimed_by, to_acct: 'ESCROW:' + p.order_id,
          order_id: p.order_id, meta: { via: 'upi-manual', utr: p.utr, short },
          prev_hash: 'CHAIN', hash: await hmacHex(env.HOOK_SECRET, p.id + seen),
        }) });
      return json({ ok: true, seen, short });
    }

    // ── webhooks in ──────────────────────────────────────────
    // Supabase fires this on a payments insert/update so the admin's phone can
    // be told without anybody polling. Signed, or ignored.
    if (path === '/api/hooks/db' && request.method === 'POST') {
      const body = await verifiedBody(request, env);
      if (!body) return json({ ok: false, reason: 'bad signature' }, 401);
      const row = body.record || {};
      if (row.state === 'CLAIMED' && env.NOTIFY_URL) {
        ctx.waitUntil(fetch(env.NOTIFY_URL, { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `UPI claim ${row.utr} · ₹${(row.expected / 100).toFixed(2)} · ${row.reference}` }) }));
      }
      return json({ ok: true });
    }

    // The PSP callback this rail replaces. Same verification, so the day a
    // gateway is affordable the only new code is what it means.
    if (path === '/api/hooks/psp' && request.method === 'POST') {
      const body = await verifiedBody(request, env);
      if (!body) return json({ ok: false, reason: 'bad signature' }, 401);
      return json({ ok: true, received: body.event || 'unknown' });
    }

    return json({ ok: false, reason: 'no such endpoint' }, 404);
  },
};
