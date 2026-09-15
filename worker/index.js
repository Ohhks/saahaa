/* SAAHAA · worker/index.js — the only place that may clear money.
 *
 * WHY THIS EXISTS AT ALL. The browser cannot be trusted with three things: the
 * service-role key, the decision that a payment is real, and the webhook
 * secret. Everything else stays client-side exactly as it is today. This Worker
 * is deliberately small — if it grows a fourth responsibility, question it.
 *
 * ENDPOINTS
 *   GET  /api/health          — liveness, and the Supabase keep-alive target
 *   POST /api/accounts/signup — the server names the account and keeps it
 *   POST /api/accounts/signin — verify a password from any device
 *   POST /api/accounts/roster — the owner console's roster   [owner password]
 *   GET  /api/listings         — every pro and shop a customer may see
 *   POST /api/listings/publish — a pro or shop publishes its own   [token]
 *   POST /api/claim           — she says she has paid (validated, deduped)
 *   POST /api/pro-check       — he says he saw it
 *   POST /api/clear           — an admin matched the statement  [admin only]
 *   POST /api/hooks/db        — Supabase DB webhook, HMAC-verified
 *   POST /api/hooks/psp       — the future PSP callback, same verification
 *
 * SECRETS (wrangler secret put ...): SUPABASE_URL, SUPABASE_SERVICE_KEY,
 * HOOK_SECRET, ADMIN_CODES. The owner's roster password is NOT a
 * Worker secret: it is a bcrypt hash in the database (set_owner_password), so
 * nothing here can compute, compare or leak it. None of these may ever appear
 * in the repo.
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


/* ── validation, and nothing else ────────────────────────────
   THE PASSWORD IS NOT HASHED HERE, AND THAT IS THE POINT. It was, briefly:
   PBKDF2-SHA256 at 250,000 rounds to match core/security.js. A Cloudflare
   Worker on the free plan gets **10ms of CPU**, that derivation needs roughly
   ten times it, and every signup and sign-in died as exception 1101 — a bare
   500 on the one path a new customer has to walk. docs/FREE-TIER.md names CPU
   as the limit most likely to bite; this was it biting.

   So the credential is created and checked by Postgres (bcrypt, via pgcrypto),
   and this Worker only passes the password through and forgets it. Waiting on
   the database is I/O, not CPU, so it costs nothing against the budget. */
const MOBILE_RE = /^[6-9][0-9]{9}$/;
const ROLES = new Set(['customer', 'partner', 'shop']);

/* WHAT AN ACCOUNT LOOKS LIKE ON THE WAY OUT — named fields, never a delete
   list, because a row gains columns over time and a delete list starts leaking
   the day somebody adds one. The two account functions already return exactly
   this shape; the roster builds it from a narrowed select. */
const publicAccount = r => ({
  code: r.code, role: r.role, name: r.name,
  mobile: r.mobile, area: r.area, createdAt: r.created_at || r.createdAt,
});

/** Call a Postgres function. The body is its named arguments. */
const rpc = (env, fn, args) =>
  db(env, 'rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });

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
      /* Nothing arrived is not a clearance. It used to be allowed, and the
         ledger's `check (paise > 0)` then rejected the leg — leaving a payment
         marked CLEARED with no leg behind it, which is escrow believed funded
         with nothing to prove it. Say so instead. */
      if (seen <= 0) return json({ ok: false,
        reason: 'Nothing arrived against this order. Reject it — do not clear it.' }, 400);

      /* THE LEG IS POSTED BEFORE THE ROW IS MARKED, and that order matters.
         The old order marked CLEARED first and then posted the leg WITHOUT
         LOOKING AT THE RESULT: any failure there returned ok:true over a
         payment that said money had arrived and a ledger that never heard of
         it. The hash is derived from the payment id and the amount, so it is
         the same on a retry — a second attempt collides on ledger.hash rather
         than minting a second leg, which is what makes this safe to repeat. */
      const leg = await db(env, 'ledger', { method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({
          kind: 'ESCROW_IN', paise: seen,
          from_acct: 'CUSTOMER:' + p.claimed_by, to_acct: 'ESCROW:' + p.order_id,
          order_id: p.order_id, meta: { via: 'upi-manual', utr: p.utr, short },
          prev_hash: 'CHAIN', hash: await hmacHex(env.HOOK_SECRET, p.id + seen),
        }) });
      const alreadyPosted = leg.status === 409 || (leg.body && String(leg.body.code) === '23505');
      if (!leg.ok && !alreadyPosted) return json({ ok: false, reason: 'could not post the escrow leg' }, 500);

      const r = await db(env, `payments?id=eq.${p.id}`, { method: 'PATCH',
        body: JSON.stringify({ state: 'CLEARED', seen, short_by: short,
          cleared_by: me.code, cleared_at: new Date().toISOString() }) });
      if (!r.ok) return json({ ok: false, reason: 'the leg is posted but the row did not mark' }, 500);
      return json({ ok: true, seen, short });
    }

    // ── accounts: the server names them, and keeps them ──────
    // WHY THE SERVER. domain/identity.js chose the next code from the accounts
    // on THAT DEVICE, so two phones both minted C20262001 and neither could see
    // the other's customers — which is exactly what the owner console was
    // reporting when it showed an empty roster while people were signing up.
    if (path === '/api/accounts/signup' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const role = String(b.role || 'customer');
      const name = String(b.name || '').trim();
      const mobile = String(b.mobile || '').replace(/\s+/g, '');
      const area = String(b.area || '').slice(0, 40);
      const password = String(b.password || '');

      if (!ROLES.has(role)) return json({ ok: false, reason: 'unknown kind of account' }, 400);
      if (name.length < 1 || name.length > 80) return json({ ok: false, reason: 'a name is needed' }, 400);
      if (!MOBILE_RE.test(mobile)) return json({ ok: false, reason: 'that is not an Indian mobile number' }, 400);
      if (password.length < 8) return json({ ok: false, reason: 'a password needs at least 8 characters' }, 400);

      // One statement in the database: the code is allocated under a row lock
      // and the account is written with it, so two devices racing get 2001 and
      // 2002 rather than one name twice.
      const made = await rpc(env, 'create_account', {
        p_role: role, p_name: name, p_mobile: mobile, p_area: area, p_password: password });
      if (!made.ok) {
        // THE DATABASE DECIDES WHETHER THE NUMBER IS FREE, not a SELECT before
        // this one — two devices can both pass a check and both insert.
        const text = JSON.stringify(made.body || '');
        const dup = made.status === 409 || text.includes('23505') || text.includes('duplicate key');
        return json({ ok: false, reason: dup
          ? 'That number already has an account of this kind. Sign in instead.'
          : 'could not open the account' }, dup ? 409 : 500);
      }
      /* The device leaves with a session token: the password is not kept, and
         publishing a listing later cannot ask for it again. */
      return json({ ok: true, account: (made.body || {}).account, token: (made.body || {}).token });
    }

    // ── sign in, from any device ─────────────────────────────
    if (path === '/api/accounts/signin' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const ident = String(b.ident || '').replace(/[\s-]/g, '');
      const password = String(b.password || '');
      if (!ident || !password) return json({ ok: false, reason: 'sign-in needs an ID or number, and a password' }, 400);

      // EVERY CANDIDATE IS CHECKED, AND THE SAME ANSWER COMES BACK EITHER WAY.
      // One number can hold a customer account and a pro account, so a failure
      // must not be decided on the first row; and separating "no such account"
      // from "wrong password" would turn this into a directory of who is
      // registered. verify_account answers with the accounts the password
      // opens, which is none of them or some of them.
      const got = await rpc(env, 'verify_account', { p_ident: ident, p_password: password });
      const accounts = (got.ok && Array.isArray(got.body)) ? got.body : [];
      if (!accounts.length) return json({ ok: false, reason: 'That ID or number and password do not match.' }, 401);
      return json({ ok: true, accounts });
    }

    // ── the directory every customer reads ───────────────────
    // Making accounts global was not enough. `profiles` held the plumber, and
    // every screen that LISTS a plumber reads the partner row — which lived in
    // the localStorage of the phone he signed up on. He existed and nobody
    // could see him.
    if (path === '/api/listings' && request.method === 'GET') {
      const got = await rpc(env, 'public_listings', {});
      if (!got.ok) return json({ ok: false, reason: 'could not read the directory' }, 500);
      return json({ ok: true, listings: got.body || [] });
    }

    if (path === '/api/listings/publish' && request.method === 'POST') {
      // THE CODE IS NEVER TAKEN FROM THE REQUEST. publish_listing resolves it
      // from the session, so a device can only ever write its own listing, and
      // only of its own kind — a customer cannot publish himself as a pro.
      const auth = request.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!token) return json({ ok: false, reason: 'sign in first' }, 401);

      const b = await request.json().catch(() => ({}));
      const kind = String(b.kind || '');
      if (kind !== 'partner' && kind !== 'shop') {
        return json({ ok: false, reason: 'unknown kind of listing' }, 400);
      }
      const got = await rpc(env, 'publish_listing', {
        p_token: token, p_kind: kind,
        p_area: String(b.area || '').slice(0, 40),
        p_payload: b.payload || {},
      });
      /* A malformed token makes Postgres reject the uuid cast, which arrives
         here as a failed call rather than `false`. Both mean the same thing to
         the caller and must not be told apart: this is not a way to find out
         which tokens exist. */
      if (!got.ok || got.body !== true) {
        return json({ ok: false, reason: 'that session cannot publish this listing' }, 403);
      }
      return json({ ok: true });
    }

    // ── the roster the owner console shows ───────────────────
    // POST, not GET: the owner's password is in the body, and a password in a
    // query string is a password in a proxy log and in browser history.
    if (path === '/api/accounts/roster' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const who = await rpc(env, 'verify_owner', { p_password: String(b.password || '') });
      if (!who.ok || who.body !== true) {
        return json({ ok: false, reason: 'admins only' }, 403);
      }
      const rows = await db(env, 'profiles?select=code,role,name,mobile,area,created_at&order=created_at.desc&limit=2000');
      if (!rows.ok) return json({ ok: false, reason: 'could not read the roster' }, 500);
      const list = (rows.body || []).map(publicAccount);
      return json({ ok: true, accounts: list, counts: {
        total: list.length,
        customer: list.filter(a => a.role === 'customer').length,
        partner: list.filter(a => a.role === 'partner').length,
        shop: list.filter(a => a.role === 'shop').length,
      } });
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
