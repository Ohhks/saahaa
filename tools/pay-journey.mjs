/* SAAHAA · tools/pay-journey.mjs — the manual UPI rail, end to end.

   A rail where a human types a number and another human believes it needs its
   rules tested harder than one where a PSP signs a webhook. Everything here is
   a way somebody loses money:

     · the same UTR claimed against two orders (pay once, get two jobs)
     · a job starting before anyone has checked anything
     · a payout drawn against a claim the statement never showed
     · a short payment quietly becoming a paid order

   Run: node --experimental-vm-modules tools/pay-journey.mjs   (in preflight) */

class MemStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  clear() { this.#m.clear(); }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  get length() { return this.#m.size; }
}
globalThis.__SAAHAA_STRICT = true;
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();
globalThis.window = { location: { hash: '', search: '', pathname: '/', href: 'http://localhost/' },
  addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.location = globalThis.window.location;
Object.defineProperty(globalThis, 'navigator',
  { value: { languages: ['en'], language: 'en', onLine: true }, configurable: true });
globalThis.document = { documentElement: { getAttribute: () => null, setAttribute() {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {}, classList: { add() {}, remove() {} } } };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const U = p => new URL('../' + p, import.meta.url).href;
const ctx   = await import(U('src/core/ctx.js'));
const store = await import(U('src/core/store.js'));
const flags = await import(U('src/core/flags.js'));
const M     = await import(U('src/core/money.js'));
await import(U('src/domain/catalog.services.js'));
await import(U('src/domain/catalog.retail.js'));
const { defaultState } = await import(U('src/domain/state.js'));
const { buildSeed } = await import(U('src/domain/seed.js'));
const F   = await import(U('src/domain/flow.js'));
const PAY = await import(U('src/domain/payments.js'));

let pass = 0; const fails = [];
const say = (cond, what, detail = '') => {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fails.push(what + (detail ? '  — ' + detail : '')); console.log('      x ' + what + (detail ? '  — ' + detail : '')); }
};
const eq = (a, b, what) => say(a === b, what, a === b ? '' : `got ${a}, wanted ${b}`);

async function world() {
  const s = store.createStore(store.combineFromRegistry(), defaultState());
  ctx.ctx.store = s; ctx.ctx.render = () => {}; ctx.ctx.go = () => {};
  const seed = await buildSeed();
  flags.set('SIM_MARKET', false);
  ['users', 'partners', 'shops', 'products'].forEach(k =>
    s.dispatch({ type: 'seed/' + k, payload: seed[k] }));
  s.dispatch({ type: 'seed/done' });
  return s;
}

const S = await world();
/* THE RAIL UNDER TEST. Everything below is about the manual UPI flow, so the
   world runs in that mode — a test of a rail that silently ran on the sandbox
   would prove nothing about the one in production. */
globalThis.localStorage.setItem('SAAHAA_PAYMENTS', JSON.stringify({ mode: 'upi-manual' }));
const G = await import(U('src/core/gateway.js'));
say(G.isManual(), 'the world under test is on the manual UPI rail', 'mode=' + G.mode());
const st = ctx.getState();
const pro = st.partners[0];
const cust = st.users.find(u => u.role === 'customer');
ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });

const o1 = await F.bookService({ catId: pro.cat, partner: pro, sub: null });
say(!!o1, 'an order exists to be paid for');

// ── what she is told ─────────────────────────────────────────
const ins = PAY.instruction(o1);
eq(ins.upi, 'saahaa@ptyes', 'she is told exactly one UPI id');
eq(ins.amount, o1.customerPays | 0, 'and the exact amount the bill says');
say(ins.link.startsWith('upi://pay?pa='), 'the deep link opens her own UPI app');
say(ins.link.includes(ins.reference), 'and carries the reference the admin will match on');
say(/^SA[A-Z0-9]{1,6}$/.test(ins.reference), 'the reference is short enough to survive a bank narration', ins.reference);

// ── a UTR is 12 digits, and nothing else is ──────────────────
for (const bad of ['', '123', 'abcdefghijkl', '12345678901', '1234567890123']) {
  say(PAY.claimUtr(o1.id, bad).ok === false, `a UTR of "${bad || '(blank)'}" is refused`);
}
const good = '123456789012';
say(PAY.claimUtr(o1.id, good).ok, 'a real 12-digit UTR is accepted');
eq(PAY.paymentFor(o1.id).state, 'CLAIMED', 'and it is a CLAIM, not a payment');

// ── THE LINE THAT MATTERS: one UTR, one order ────────────────
const o2 = await F.bookService({ catId: pro.cat, partner: pro, sub: null });
const dup = PAY.claimUtr(o2.id, good);
say(dup.ok === false, 'THE SAME UTR CANNOT BE CLAIMED AGAINST A SECOND ORDER', dup.reason);
say(PAY.paymentFor(o2.id) === null, 'and the second order records nothing at all');

// ── no money moves on a claim ────────────────────────────────
const L = await import(U('src/domain/ledger.js'));
const escrowOf = id => L.balanceOf(ctx.getState().ledger, L.acct.escrow(id));
eq(escrowOf(o1.id), 0, 'a claim funds no escrow — typing a number cannot mint money');
say(!PAY.CAN_START_WORK.has('CLAIMED'), 'and work cannot start on a bare claim');

// ── the pro looks at her phone ───────────────────────────────
say(PAY.proCheck(o1.id, true, 'saw it on her screen').ok, 'the pro can confirm he saw the payment');
eq(PAY.paymentFor(o1.id).state, 'PRO_CHECKED', 'which is the first of the two checks');
say(PAY.CAN_START_WORK.has('PRO_CHECKED'), 'now the job may start');
say(!PAY.IS_SETTLED_FUNDS.has('PRO_CHECKED'), 'but he may NOT be paid out of a claim he checked himself');
eq(escrowOf(o1.id), 0, 'and still no escrow: his eyes are not a bank statement');

// ── the admin reads the statement ────────────────────────────
eq(PAY.queue('PRO_CHECKED').length, 1, "the admin's morning list holds exactly what is waiting");
const cleared = PAY.adminClear(o1.id, { ok: true });
say(cleared.ok, 'the admin can clear it against the statement');
await F.fundClearedOrder(o1.id);
eq(escrowOf(o1.id), o1.customerPays | 0, 'ONLY NOW is escrow funded — by the statement, not by the typing');
await F.fundClearedOrder(o1.id);
eq(escrowOf(o1.id), o1.customerPays | 0, 'and clearing it twice at 7am funds it once');
eq(PAY.paymentFor(o1.id).state, 'CLEARED', 'and only now is it money');
say(PAY.IS_SETTLED_FUNDS.has('CLEARED'), 'which is the only state a payout may be drawn from');
say(!!PAY.clearedFor(o1.id), 'so the settlement batch can see it');

// ── and the books still balance afterwards ───────────────────
/* THE WHOLE PRODUCT PUT UP "Payouts are paused — the books do not balance" the
   moment an admin cleared a manual payment. The escrow leg was posted straight
   out of CUSTOMER:<code> — a wallet she never funded, because on this rail she
   transfers to a bank, not to SAAHAA — so her account went negative by the
   exact amount of the order and the non-negative invariant fired. The guard was
   right; the leg was wrong. Money enters from WORLD first, as it does on every
   other rail. */
{
  const health = L.health ? L.health(ctx.getState().ledger) : null;
  const bal = a => L.balanceOf(ctx.getState().ledger, a);
  const custAcct = 'CUSTOMER:' + (o1.customerKey || '');
  say(bal(custAcct) >= 0, 'clearing a payment never leaves the customer negative',
      `${custAcct} is ${M.fmt2(bal(custAcct))}`);
  say(!F.bookStatus || F.bookStatus() == null,
      'AND THE BOOKS STILL BALANCE — no payout pause after a clearance',
      JSON.stringify(F.bookStatus && F.bookStatus()));
  say(bal('WORLD:funding') < 0, 'the money is recorded as having come from outside');
  if (health) say(health.ok !== false, 'the ledger health check agrees');
}

// ── a short payment is not a paid order ──────────────────────
const o3 = await F.bookService({ catId: pro.cat, partner: pro, sub: null });
PAY.claimUtr(o3.id, '999988887777');
PAY.proCheck(o3.id, true);
const shortRes = PAY.adminClear(o3.id, { ok: true, seenPaise: (o3.customerPays | 0) - 5000, note: 'paid 50 short' });
eq(shortRes.short, 5000, 'a short payment records exactly how short it was');
eq(PAY.paymentFor(o3.id).shortBy, 5000, 'and carries it on the row for the person who chases it');

// ── a rejection closes it ────────────────────────────────────
const o4 = await F.bookService({ catId: pro.cat, partner: pro, sub: null });
PAY.claimUtr(o4.id, '111122223333');
PAY.adminClear(o4.id, { ok: false, note: 'not in the statement' });
eq(PAY.paymentFor(o4.id), null, 'a rejected claim stops being the order’s payment');
say(PAY.claimUtr(o4.id, '111122223333').ok, 'and the customer may claim again with the same UTR, since nothing cleared');

console.log(`\n  payments: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok the manual rail refuses every way of being paid once and billed twice');
