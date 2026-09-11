/* SAAHAA · tools/worker-test.mjs — the Worker is the only thing that may clear
   money, and until now the only thing asserted about it was that it parsed.

   It runs against a stubbed Supabase, so this proves the Worker's OWN rules:
   who may call what, what a bad signature does, and whether a short payment
   funds the bill or the statement. It does not prove Postgres works.

   Run: node tools/worker-test.mjs */

const ENV = {
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  HOOK_SECRET: 'hook-secret',
  ADMIN_CODES: 'C20262001',
};

let pass = 0; const fails = [];
const say = (c, what, d = '') => { if (c) { pass++; console.log('  ok   ' + what); }
  else { fails.push(what); console.log('      x ' + what + (d ? '  — ' + d : '')); } };
const eq = (a, b, what) => say(a === b, what, a === b ? '' : `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the stub: a Supabase that says yes, and remembers what it was asked ── */
let calls = [];
let state = {
  order: { id: 'ord_1', customer_code: 'C20262006', customer_pays: 41600 },
  payment: null,
  user: { id: 'u1' },
  profile: { code: 'C20262006', role: 'customer' },
  insertFails409: false,
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const method = (init.method || 'GET').toUpperCase();
  calls.push({ u, method, body: init.body });
  const J = (o, ok = true, status = 200) => ({ ok, status,
    text: async () => JSON.stringify(o), json: async () => o });

  if (u.includes('/auth/v1/user')) {
    const auth = (init.headers || {}).authorization || '';
    return auth.includes('good-token') ? J(state.user) : { ok: false, status: 401, text: async () => '', json: async () => ({}) };
  }
  if (u.includes('/rest/v1/profiles')) return J([state.profile]);
  if (u.includes('/rest/v1/orders'))   return J([state.order]);
  if (u.includes('/rest/v1/rpc/beat')) return J(new Date().toISOString());
  if (u.includes('/rest/v1/payments')) {
    if (method === 'POST') {
      if (state.insertFails409) return { ok: false, status: 409,
        text: async () => JSON.stringify({ code: '23505' }), json: async () => ({ code: '23505' }) };
      state.payment = { ...JSON.parse(init.body), id: 'pay_1' };
      return J([state.payment]);
    }
    if (method === 'PATCH') { state.payment = { ...state.payment, ...JSON.parse(init.body) }; return J([state.payment]); }
    return J(state.payment ? [state.payment] : []);
  }
  if (u.includes('/rest/v1/ledger')) return J([]);
  return J({});
};

const { default: worker } = await import(new URL('../worker/index.js', import.meta.url).href);
const ctx = { waitUntil() {} };
const call = (path, { method = 'POST', body = {}, token = null, sig = null } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (sig) headers['x-saahaa-signature'] = sig;
  return worker.fetch(new Request('https://api.test' + path, {
    method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) }), ENV, ctx);
};
const body = async r => JSON.parse(await r.text());

async function hmacHex(secret, s) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

console.log('\n  the Worker, against a stubbed Supabase\n');

// ── health, which the keep-alive depends on ──────────────────
{
  const r = await call('/api/health', { method: 'GET' });
  eq(r.status, 200, 'health answers 200');
  say(calls.some(c => c.u.includes('rpc/beat')), 'and it touches the heartbeat the cron relies on');
}

// ── who may claim ────────────────────────────────────────────
{
  const r = await call('/api/claim', { body: { orderId: 'ord_1', utr: '123456789012', reference: 'SAORD1' } });
  eq(r.status, 401, 'a claim with no token is refused');
}
{
  state.profile = { code: 'C20260099', role: 'customer' };          // somebody else
  const r = await call('/api/claim', { token: 'good-token', body: { orderId: 'ord_1', utr: '123456789012', reference: 'SAORD1' } });
  eq(r.status, 403, 'a claim on somebody else’s order is refused');
  state.profile = { code: 'C20262006', role: 'customer' };
}
for (const bad of ['123', 'abcdefghijkl', '1234567890123', '']) {
  const r = await call('/api/claim', { token: 'good-token', body: { orderId: 'ord_1', utr: bad, reference: 'SAORD1' } });
  eq(r.status, 400, `a UTR of "${bad || '(blank)'}" is refused`);
}
{
  const r = await call('/api/claim', { token: 'good-token', body: { orderId: 'ord_1', utr: '123456789012', reference: 'nope' } });
  eq(r.status, 400, 'a malformed reference is refused');
}
{
  const r = await call('/api/claim', { token: 'good-token', body: { orderId: 'ord_1', utr: '123456789012', reference: 'SAORD1' } });
  const b = await body(r);
  say(b.ok, 'a good claim is recorded');
  eq(state.payment.expected, 41600, 'at the amount the ORDER says, never one the caller sent');
  eq(state.payment.state, 'CLAIMED', 'as a claim');
}
{
  state.insertFails409 = true;
  const r = await call('/api/claim', { token: 'good-token', body: { orderId: 'ord_1', utr: '123456789012', reference: 'SAORD1' } });
  const b = await body(r);
  eq(r.status, 409, 'A DUPLICATE UTR IS REFUSED — the database decides, and 23505 is read');
  say(/already recorded/.test(b.reason), 'and the customer is told what to check');
  state.insertFails409 = false;
}

// ── who may clear ────────────────────────────────────────────
{
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1' } });
  eq(r.status, 403, 'A CUSTOMER MAY NOT CLEAR HER OWN PAYMENT');
}
{
  state.profile = { code: 'C20262112', role: 'partner' };
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1' } });
  eq(r.status, 403, 'nor may the pro who is owed the money');
  state.profile = { code: 'C20262001', role: 'customer' };           // in ADMIN_CODES
}
{
  state.payment = { id: 'pay_1', order_id: 'ord_1', expected: 41600, state: 'PRO_CHECKED', claimed_by: 'C20262006', utr: '123456789012' };
  calls = [];
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1' } });
  const b = await body(r);
  say(b.ok, 'an admin listed in ADMIN_CODES may clear');
  eq(state.payment.state, 'CLEARED', 'and the row becomes money');
  const leg = calls.find(c => c.u.includes('/ledger') && c.method === 'POST');
  say(!!leg, 'AND ONLY THEN IS AN ESCROW LEG POSTED');
  eq(JSON.parse(leg.body).paise, 41600, 'for the amount seen');
}
{
  state.payment = { id: 'pay_2', order_id: 'ord_1', expected: 41600, state: 'PRO_CHECKED', claimed_by: 'C20262006', utr: '999988887777' };
  calls = [];
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1', seen: 36600 } });
  const b = await body(r);
  eq(b.short, 5000, 'a short payment records how short it was');
  const leg = JSON.parse(calls.find(c => c.u.includes('/ledger')).body);
  eq(leg.paise, 36600, 'AND FUNDS WHAT THE STATEMENT SHOWED, not what the bill said');
}

// ── webhooks: signed, or nothing ─────────────────────────────
{
  const payload = { record: { state: 'CLAIMED', utr: '123456789012', expected: 41600, reference: 'SAORD1' } };
  const r1 = await call('/api/hooks/db', { body: payload });
  eq(r1.status, 401, 'an unsigned webhook is refused');
  const r2 = await call('/api/hooks/db', { body: payload, sig: 'deadbeef' });
  eq(r2.status, 401, 'a wrongly signed webhook is refused');
  const good = await hmacHex(ENV.HOOK_SECRET, JSON.stringify(payload));
  const r3 = await call('/api/hooks/db', { body: payload, sig: good });
  eq(r3.status, 200, 'a correctly signed webhook is accepted');
  const r4 = await call('/api/hooks/psp', { body: { event: 'payment.captured' }, sig: 'deadbeef' });
  eq(r4.status, 401, 'and the PSP endpoint refuses a bad signature the same way');
}

// ── unknown routes ───────────────────────────────────────────
eq((await call('/api/whatever')).status, 404, 'an unknown endpoint is a 404, not a 500');

console.log(`\n  worker: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok the Worker refuses every caller who must not clear money\n');
