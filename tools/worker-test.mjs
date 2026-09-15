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

/* The owner's password. The Worker does not hash it — Postgres does, because
   a Worker on the free plan gets 10ms of CPU and bcrypt does not fit in it.
   The stub below stands in for verify_owner. */
const OWNER_PW = 'the-owner-password';

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
  profileInsert409: false,
  nextCode: 'C20262001',
  accounts: [],
  listings: [],
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
  /* The account functions live in Postgres now — the Worker only passes the
     password through, so the stub is where a password is "checked". */
  if (u.includes('/rest/v1/rpc/create_account')) {
    if (state.profileInsert409) return { ok: false, status: 409,
      text: async () => JSON.stringify({ code: '23505' }), json: async () => ({ code: '23505' }) };
    const a = JSON.parse(init.body);
    const row = { code: state.nextCode, role: a.p_role, name: a.p_name,
                  mobile: a.p_mobile, area: a.p_area, createdAt: '2026-09-16T00:00:00Z' };
    state.accounts.push({ ...row, created_at: row.createdAt, password: a.p_password });
    return J({ account: row, token: 'tok-' + row.code });
  }
  if (u.includes('/rest/v1/rpc/verify_account')) {
    const a = JSON.parse(init.body);
    const id = String(a.p_ident || '');
    return J(state.accounts
      .filter(x => (x.code === id.toUpperCase() || x.mobile === id) && x.password === a.p_password)
      .map(({ password, created_at, ...rest }) => ({ ...rest, token: 'tok-' + rest.code })));
  }
  /* publish_listing resolves the code FROM THE TOKEN and refuses a kind that
     does not match the account's role — the stub has to enforce both, or the
     assertions about them would pass against nothing. */
  if (u.includes('/rest/v1/rpc/publish_listing')) {
    const a = JSON.parse(init.body);
    const code = String(a.p_token || '').startsWith('tok-') ? String(a.p_token).slice(4) : null;
    const acct = state.accounts.find(x => x.code === code);
    if (!acct || acct.role !== a.p_kind) return J(false);
    state.listings = (state.listings || []).filter(l => l.code !== code);
    state.listings.push({ code, kind: a.p_kind, area: a.p_area, payload: a.p_payload });
    return J(true);
  }
  if (u.includes('/rest/v1/rpc/public_listings')) return J(state.listings || []);
  if (u.includes('/rest/v1/rpc/verify_owner')) {
    return J(JSON.parse(init.body).p_password === OWNER_PW);
  }
  if (u.includes('/rest/v1/profiles')) {
    if (method === 'POST') {
      if (state.profileInsert409) return { ok: false, status: 409,
        text: async () => JSON.stringify({ code: '23505' }), json: async () => ({ code: '23505' }) };
      const row = { ...JSON.parse(init.body), created_at: '2026-09-16T00:00:00Z' };
      state.accounts.push(row);
      return J([row]);
    }
    /* whoami asks by id; signup/signin/roster ask by code, mobile or for all */
    if (u.includes('id=eq.')) return J([state.profile]);
    if (u.includes('code=eq.')) return J(state.accounts.filter(a => u.includes(a.code)));
    if (u.includes('mobile=eq.')) return J(state.accounts.filter(a => u.includes(a.mobile)));
    return J(state.accounts);
  }
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
  if (u.includes('/rest/v1/ledger')) {
    if (state.ledgerFails) return { ok: false, status: 500,
      text: async () => JSON.stringify({ code: 'XX000' }), json: async () => ({ code: 'XX000' }) };
    return J([]);
  }
  return J({});
};

const workerUrl = new URL('../worker/index.js', import.meta.url);
/* Read as text as well as imported: one assertion below is about what the
   Worker does NOT contain, and that cannot be asked of a module object. */
const workerSource = (await import('node:fs')).readFileSync(workerUrl, 'utf8');
const { default: worker } = await import(workerUrl.href);
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
{
  /* Clearing a payment where nothing arrived used to be allowed. The ledger's
     `check (paise > 0)` then refused the leg, and because the leg's result was
     never looked at, the API answered ok over a CLEARED payment with no leg
     behind it: escrow believed funded, nothing to prove it. */
  state.payment = { id: 'pay_3', order_id: 'ord_1', expected: 41600, state: 'PRO_CHECKED', claimed_by: 'C20262006', utr: '111122223333' };
  calls = [];
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1', seen: 0 } });
  say(r.status === 400, 'clearing a payment that never arrived is refused');
  say(!calls.some(c => c.u.includes('/ledger') && c.method === 'POST'), 'and posts no escrow leg');
  eq(state.payment.state, 'PRO_CHECKED', 'and leaves the row exactly as it was');
}
{
  /* If the leg cannot be posted, nothing may say the money is here. */
  state.payment = { id: 'pay_4', order_id: 'ord_1', expected: 41600, state: 'PRO_CHECKED', claimed_by: 'C20262006', utr: '444455556666' };
  state.ledgerFails = true; calls = [];
  const r = await call('/api/clear', { token: 'good-token', body: { orderId: 'ord_1' } });
  const b = await body(r);
  say(!b.ok, 'a failed escrow leg fails the clearance');
  eq(state.payment.state, 'PRO_CHECKED', 'AND THE PAYMENT IS NOT MARKED CLEARED');
  state.ledgerFails = false;
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

// ── accounts: the server names them, and the credential never leaves ──
// The bug these guard: identity.js numbered accounts from the list on ONE
// device, so two phones both minted C20262001 and the owner console — reading
// that same local list — showed an empty roster while people signed up.
{
  console.log('\n  accounts\n');
  const PW = 'Kukatpally-7731';
  const hasCredential = o => JSON.stringify(o).match(/pass_hash|pass_salt|pass_iter/);

  state.accounts = [];
  state.nextCode = 'C20262001';

  // what a signup must refuse before it reaches the database
  eq((await call('/api/accounts/signup', { body: { role: 'wizard', name: 'X', mobile: '9876543210', password: PW } })).status,
     400, 'a role that does not exist is refused');
  eq((await call('/api/accounts/signup', { body: { role: 'customer', name: 'X', mobile: '12345', password: PW } })).status,
     400, 'a number that is not an Indian mobile is refused');
  eq((await call('/api/accounts/signup', { body: { role: 'customer', name: 'X', mobile: '9876543210', password: 'short' } })).status,
     400, 'a password under eight characters is refused');
  eq((await call('/api/accounts/signup', { body: { role: 'customer', name: '', mobile: '9876543210', password: PW } })).status,
     400, 'an account with no name is refused');

  const up = await call('/api/accounts/signup', {
    body: { role: 'customer', name: 'Asha', mobile: '9876543210', area: 'Kukatpally', password: PW } });
  const upb = await body(up);
  eq(up.status, 200, 'a good signup is accepted');
  eq(upb.account.code, 'C20262001', 'and the code comes from the SERVER, not the device');
  say(!hasCredential(upb), 'the signup reply carries no hash, no salt and no iteration count');
  say(state.accounts[0].password === PW,
      'the Worker passes the password to Postgres rather than hashing it itself');
  /* `deriveBits` and not /pbkdf2/i: the comment explaining why the derivation
     was REMOVED says the word, and an assertion that fails on its own
     explanation teaches the next person to delete the explanation. */
  say(!/deriveBits/.test(workerSource),
      'and derives no key itself — 250,000 rounds does not fit in 10ms of CPU');

  // the database decides whether a number is free, not a SELECT before the insert
  state.profileInsert409 = true;
  const dup = await call('/api/accounts/signup', {
    body: { role: 'customer', name: 'Asha Again', mobile: '9876543210', password: PW } });
  eq(dup.status, 409, 'the same number cannot open a second account of one kind');
  say(/[Ss]ign in instead/.test((await body(dup)).reason), 'and the person is told to sign in instead');
  state.profileInsert409 = false;

  // signing in from a device that has never seen this account
  const inOk = await call('/api/accounts/signin', { body: { ident: 'C20262001', password: PW } });
  const inb = await body(inOk);
  eq(inOk.status, 200, 'a correct password signs in from any device');
  eq(inb.accounts[0].code, 'C20262001', 'and the account comes back by its code');
  say(!hasCredential(inb), 'the sign-in reply carries no credential either');

  eq((await call('/api/accounts/signin', { body: { ident: 'C20262001', password: 'wrong-password' } })).status,
     401, 'a wrong password does not sign in');
  eq((await call('/api/accounts/signin', { body: { ident: 'C20269999', password: PW } })).status,
     401, 'and an account that does not exist answers exactly the same way');
  const unknown = await body(await call('/api/accounts/signin', { body: { ident: 'C20269999', password: PW } }));
  const wrongpw = await body(await call('/api/accounts/signin', { body: { ident: 'C20262001', password: 'nope-nope' } }));
  eq(unknown.reason, wrongpw.reason, 'the two are not distinguishable — this is not a directory of who is registered');

  // one number, two kinds of account: both are checked, not just the first
  state.nextCode = 'P20262001';
  await call('/api/accounts/signup', {
    body: { role: 'partner', name: 'Asha', mobile: '9876543210', password: 'Plumber-8821' } });
  const byNumber = await body(await call('/api/accounts/signin', { body: { ident: '9876543210', password: 'Plumber-8821' } }));
  eq(byNumber.accounts.length, 1, 'signing in by number finds the account the password opens');
  eq(byNumber.accounts[0].role, 'partner', 'and it is the right one of the two on that number');

  // the roster the owner console reads
  eq((await call('/api/accounts/roster', { body: { password: 'not-the-owner' } })).status,
     403, 'the roster refuses a wrong owner password');
  eq((await call('/api/accounts/roster', { body: {} })).status,
     403, 'and refuses no password at all');
  const ros = await call('/api/accounts/roster', { body: { password: OWNER_PW } });
  const rosb = await body(ros);
  eq(ros.status, 200, 'the owner password opens the roster');
  eq(rosb.counts.total, 2, 'which lists every account on the platform, not on one device');
  eq(rosb.counts.partner, 1, 'counted by role');
  say(!hasCredential(rosb), 'and still without a single credential field');
}


// ── the directory: a pro one device publishes, every device reads ──
{
  console.log('\n  the directory\n');
  state.accounts = []; state.listings = []; state.nextCode = 'P20262001';

  const pro = await body(await call('/api/accounts/signup', {
    body: { role: 'partner', name: 'Ravi Plumber', mobile: '9876500011', area: 'Kukatpally', password: 'Kukatpally-7731' } }));
  say(!!pro.token, 'a signup hands the device a session token');

  state.nextCode = 'C20262001';
  const cust = await body(await call('/api/accounts/signup', {
    body: { role: 'customer', name: 'Asha', mobile: '9876500012', area: 'Madhapur', password: 'Kukatpally-7731' } }));

  const publish = (token, payload) => call('/api/listings/publish', {
    body: { kind: payload.kind || 'partner', area: 'Kukatpally', payload },
    token });

  eq((await publish(null, { cat: 'plumbing' })).status, 401, 'publishing without a session is refused');
  eq((await publish('tok-NOPE', { cat: 'plumbing' })).status, 403, 'and an invented token is refused');
  eq((await publish(cust.token, { cat: 'plumbing' })).status, 403,
     'a customer cannot publish himself as a pro — the kind is checked against the account');

  eq((await publish(pro.token, { cat: 'plumbing', ask: 50000, online: true })).status, 200,
     'a pro publishes his own listing');

  const seen = await body(await call('/api/listings', { method: 'GET' }));
  eq(seen.listings.length, 1, 'and a device that has never met him reads it back');
  eq(seen.listings[0].payload.cat, 'plumbing', 'with the trade intact');
  eq(seen.listings[0].code, pro.account.code, 'under his own code');

  await publish(pro.token, { cat: 'plumbing', ask: 60000, online: false });
  const again = await body(await call('/api/listings', { method: 'GET' }));
  eq(again.listings.length, 1, 'editing the price leaves one listing, not two');
  eq(again.listings[0].payload.ask, 60000, 'and the edit is what the directory serves');

  say(!/pass_hash|password/.test(JSON.stringify(again)), 'the directory carries no credential');
  eq((await call('/api/listings/publish', { body: { kind: 'wizard', payload: {} }, token: pro.token })).status,
     400, 'a listing of a kind that does not exist is refused');
}

// ── the front door: which requests are files, and which are the API ──
// The site and the API are two Workers. Before the service binding the browser
// called the API by its absolute address, which meant CORS for the whole
// internet and `https://*.workers.dev` in the site's connect-src. Now /api/* is
// handed over Cloudflare's internal RPC and everything else is a file.
{
  console.log('\n  the front door\n');
  const { default: site } = await import(new URL('../worker-site/index.js', import.meta.url).href);

  let went;
  const env = {
    API:    { fetch: r => { went = 'api';    return new Response('api ' + new URL(r.url).pathname); } },
    ASSETS: { fetch: r => { went = 'assets'; return new Response('asset ' + new URL(r.url).pathname); } },
  };
  const where = async (p) => { went = null; await site.fetch(new Request('https://saahaa.test' + p), env); return went; };

  eq(await where('/api/health'), 'api', '/api/health goes to the API');
  eq(await where('/api/accounts/signup'), 'api', 'and so does a signup');
  eq(await where('/api'), 'api', 'a bare /api goes there too — it answers with the real endpoints');
  eq(await where('/'), 'assets', 'the home page is a file');
  eq(await where('/admin.html'), 'assets', 'the owner console is a file');
  eq(await where('/vendor/leaflet/leaflet.js'), 'assets', 'so is everything vendored');
  /* THE ONE THAT WOULD HAVE BEEN A BUG. `startsWith('/api')` without the
     slash sends /apiary — or any future /api-docs — into the money Worker. */
  eq(await where('/apiary'), 'assets', 'a path that merely starts with the letters api is a file');
  eq(await where('/api-docs'), 'assets', 'and so is /api-docs');
  eq(await where('/some/deep/link'), 'assets', 'an unknown path is the app, not the API');

  /* The router must carry the request through unchanged: the API reads the
     method and the body, and a rebuilt Request would lose both. */
  went = null;
  const posted = await site.fetch(new Request('https://saahaa.test/api/accounts/signin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ident":"C20262001"}' }), {
      API: { fetch: async r => new Response(JSON.stringify({ method: r.method, body: await r.text() })) },
      ASSETS: { fetch: () => new Response('asset') } });
  const seen = JSON.parse(await posted.text());
  eq(seen.method, 'POST', 'the method survives the hop');
  eq(seen.body, '{"ident":"C20262001"}', 'and so does the body');

  say(!/SUPABASE|SERVICE_KEY|HOOK_SECRET/.test(
        (await import('node:fs')).readFileSync(new URL('../worker-site/index.js', import.meta.url), 'utf8')),
      'the front door holds no secret — that boundary is why the console is safe to publish');
}

// ── unknown routes ───────────────────────────────────────────
eq((await call('/api/whatever')).status, 404, 'an unknown endpoint is a 404, not a 500');

console.log(`\n  worker: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok the Worker refuses every caller who must not clear money\n');
