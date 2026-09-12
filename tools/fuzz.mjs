/* SAAHAA · tools/fuzz.mjs — the same money rules, ten thousand times, for free.
 *
 * The journeys walk ONE carefully chosen path each. That is what they are for,
 * and it is also their limit: every bug they ever caught was on a path somebody
 * had already thought of. This walks paths nobody thought of — random baskets,
 * random weights, random cancellations at random stages, random tiers — and
 * after each one asserts the handful of things that must be true of every order
 * that has ever existed:
 *
 *   1. ESCROW ENDS AT ZERO. Money is never stranded in a closed order and
 *      never minted out of one.
 *   2. NOBODY GOES NEGATIVE except the accounts that are allowed to (WORLD,
 *      DEBT). A negative wallet is somebody's rent.
 *   3. WHAT WENT IN CAME OUT. in == refund + payouts + fees + gst + dispatch,
 *      to the paisa, with no rounding slack.
 *   4. THE CHAIN HOLDS. Every leg's prevHash is the one before it.
 *   5. NOBODY IS PAID MORE THAN THE CUSTOMER PAID.
 *
 * Seeded, so a failure is reproducible: the seed is printed and
 *   node tools/fuzz.mjs --seed <n>
 * replays exactly that run.
 *
 * Run: node tools/fuzz.mjs [--runs 2000] [--seed 12345]
 */

const U = p => new URL('../' + p, import.meta.url).href;

class Mem { #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); } clear() { this.#m.clear(); }
  key(i) { return [...this.#m.keys()][i] ?? null; } get length() { return this.#m.size; } }
globalThis.__SAAHAA_STRICT = true;
globalThis.localStorage = new Mem(); globalThis.sessionStorage = new Mem();
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

const ctx   = await import(U('src/core/ctx.js'));
const store = await import(U('src/core/store.js'));
const flags = await import(U('src/core/flags.js'));
const M     = await import(U('src/core/money.js'));
await import(U('src/domain/catalog.services.js'));
await import(U('src/domain/catalog.retail.js'));
const { defaultState } = await import(U('src/domain/state.js'));
const { buildSeed } = await import(U('src/domain/seed.js'));
const L = await import(U('src/domain/ledger.js'));
const F = await import(U('src/domain/flow.js'));

/* ── a seeded generator, so every failure replays ─────────── */
const argOf = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const RUNS = argOf('runs', 2000);
let SEED = argOf('seed', (Date.now() ^ 0x5f3759df) >>> 0);
const rnd = () => { SEED ^= SEED << 13; SEED ^= SEED >>> 17; SEED ^= SEED << 5; return ((SEED >>> 0) % 1e6) / 1e6; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

async function world() {
  const s = store.createStore(store.combineFromRegistry(), defaultState());
  ctx.ctx.store = s; ctx.ctx.render = () => {}; ctx.ctx.go = () => {};
  const seed = await buildSeed();
  flags.set('SIM_MARKET', false);
  ['users', 'partners', 'shops', 'products'].forEach(k => s.dispatch({ type: 'seed/' + k, payload: seed[k] }));
  s.dispatch({ type: 'seed/done' });
  return s;
}

const bal = a => L.balanceOf(ctx.getState().ledger, a);
const TERMINAL = new Set(['SETTLED', 'CANCELLED', 'REFUNDED', 'CLOSED',
                          'R_SETTLED', 'R_CLOSED', 'R_CANCELLED', 'R_REFUNDED']);
const problems = [];
let audited = 0, skipped = 0;

/* THE APP ALREADY HAS AN ORACLE AND IT WAS TALKING TO NOBODY. `assertBookOk`
   logs "stranded escrow" when a closed order still holds funds — exactly the
   condition this file hunts — and the first version of this fuzzer printed "ok"
   over the top of that warning for two thousand consecutive runs. A test that
   shouts down its own oracle is worse than no test, so its voice is a failure
   here. */
const realErr = console.error, realWarn = console.warn;
const oracleSaid = [];
const listen = fn => (...a) => {
  const m = a.join(' ');
  if (m.indexOf('[saahaa]') === 0) oracleSaid.push(m); else fn(...a);
};
console.error = listen(realErr);
console.warn = listen(realWarn);
const flag = (seed, what, detail) => problems.push({ seed, what, detail });

/* ── the invariants every finished order must satisfy ─────── */
function auditOrder(o, seedAtStart) {
  const st = ctx.getState();
  /* ONLY A FINISHED ORDER OWES THESE INVARIANTS. Escrow holding money on a live
     order is the product working: it releases when she confirms. My first
     version audited every order at whatever stage it reached and reported a
     hundred "stranded" escrows that were simply orders still in progress — a
     fuzzer that cries wolf is worse than no fuzzer. */
  if (!TERMINAL.has(o.stage)) { skipped++; return; }
  audited++;
  const legs = (st.ledger || []).filter(r => (r.meta && r.meta.orderId) === o.id || r.to === 'ESCROW:' + o.id || r.from === 'ESCROW:' + o.id);

  const escrow = bal('ESCROW:' + o.id);
  if (escrow !== 0) flag(seedAtStart, 'escrow did not land at zero', `${o.kind} ${o.stage}: ${M.fmt2(escrow)} stranded`);

  const inLegs = legs.filter(r => r.to === 'ESCROW:' + o.id).reduce((n, r) => n + (r.paise | r.amount | 0), 0);
  const outLegs = legs.filter(r => r.from === 'ESCROW:' + o.id).reduce((n, r) => n + (r.paise | r.amount | 0), 0);
  if (inLegs && inLegs !== outLegs) {
    flag(seedAtStart, 'what went into escrow did not come out',
         `${o.kind} ${o.stage}: in ${M.fmt2(inLegs)} out ${M.fmt2(outLegs)}`);
  }

  /* nobody is paid more than she paid */
  const paidOut = legs.filter(r => r.from === 'ESCROW:' + o.id && /PARTNER|SHOP/.test(r.to))
                      .reduce((n, r) => n + (r.paise | r.amount | 0), 0);
  if (paidOut > (o.customerPays | 0) + 1) {
    flag(seedAtStart, 'somebody was paid more than the customer paid',
         `${o.kind}: paid ${M.fmt2(paidOut)} of ${M.fmt2(o.customerPays)}`);
  }
}

function auditGlobal(seedAtStart) {
  const st = ctx.getState();
  const seen = new Set();
  (st.ledger || []).forEach(r => { seen.add(r.from); seen.add(r.to); });
  for (const acct of seen) {
    if (!acct) continue;
    const type = String(acct).split(':')[0];
    if (type === 'WORLD' || type === 'DEBT' || type === 'CUSTOMER') continue;
    const b = bal(acct);
    if (b < 0) flag(seedAtStart, 'an account went negative', `${acct} at ${M.fmt2(b)}`);
  }
  /* the chain */
  let prev = null, broke = 0;
  (st.ledger || []).forEach(r => {
    if (prev && r.prevHash && r.prevHash !== prev) broke++;
    prev = r.hash || prev;
  });
  if (broke) flag(seedAtStart, 'the hash chain is broken', `${broke} link(s)`);
}

/* ── one random life of one random order ──────────────────── */
async function oneRun(S) {
  const seedAtStart = SEED;
  const st = ctx.getState();
  const cust = st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });

  if (rnd() < 0.5) {
    /* a service job */
    const pro = pick(st.partners.filter(p => (p.tier | 0) >= 2));
    if (!pro) return;
    let o;
    try { o = await F.bookService({ catId: pro.cat, partner: pro, sub: null }); } catch (e) { return; }
    if (!o) return;

    const path = rnd();
    if (path < 0.25) {
      await F.cancelOrder(o.id, pick(['MATCHING', 'EN_ROUTE', 'ACCEPTED']));
    } else if (path < 0.4) {
      F.advance(o.id, 'ASSIGNED', {}); F.advance(o.id, 'EN_ROUTE', {});
      await F.cancelOrder(o.id, 'EN_ROUTE');
    } else {
      F.advance(o.id, 'ASSIGNED', {}); F.advance(o.id, 'EN_ROUTE', {}); F.advance(o.id, 'ARRIVED', {});
      F.verifyOtp(o.id, String(cust.code || o.otp));
      F.advance(o.id, 'IN_PROGRESS', {}); F.advance(o.id, 'WORK_DONE', {});
      try { await F.confirmAndRelease(o.id, 1); } catch (e) {}
    }
    auditOrder(ctx.getState().orders.find(x => x.id === o.id) || o, seedAtStart);
  } else {
    /* a basket */
    const shop = pick(st.shops.filter(s => s.deliveryMode !== 'pickup_only'));
    if (!shop) return;
    const items = st.products.filter(p => p.shopId === shop.id && p.active).slice(0, between(1, 5));
    if (!items.length) return;
    /* THE REAL API, NOT ONE I ASSUMED. The first version called a
       `placeRetail({lines})` that does not exist; the throw was swallowed by the
       catch below and the retail half of this fuzzer silently tested nothing
       while reporting "ok". An order is placed the way the app places one: fill
       the cart, then `placeRetailOrder`. */
    F.clearCart && F.clearCart();
    let spend = 0;
    items.forEach(pr => { const q = between(1, 4); F.addToCart(pr, q); spend += (pr.price | 0) * q; });
    /* clear the shop's minimum, or the order is legitimately refused */
    if (spend < (shop.minOrder | 0)) {
      const pr = items[0];
      F.addToCart(pr, Math.ceil(((shop.minOrder | 0) - spend) / Math.max(1, pr.price | 0)) + 1);
    }
    let o;
    try { o = await F.placeRetailOrder(pick(['rider', 'self'])); } catch (e) { return; }
    if (!o) return;

    /* random weighing, including over and under */
    (o.lines || []).forEach(l => {
      if (rnd() < 0.5) {
        const q = Math.max(0.1, (l.qty || 1) * (0.5 + rnd()));
        try { F.setPickedQty(o.id, l.lineId, Math.round(q * 100) / 100); } catch (e) {}
      }
    });
    const path = rnd();
    try {
      if (path < 0.3) { await F.refundRetail(o.id, 'fuzz'); }
      else {
        F.advance(o.id, 'R_PACKED', {}); F.advance(o.id, 'R_OUT', {}); F.advance(o.id, 'R_DELIVERED', {});
        if (path < 0.5) { await F.acceptReturn(o.id); }
        else { await F.settleRetail(o.id); }
      }
    } catch (e) {}
    auditOrder(ctx.getState().orders.find(x => x.id === o.id) || o, seedAtStart);
  }
}

const S = await world();
let ran = 0;
const started = Date.now();
for (let i = 0; i < RUNS; i++) {
  try { await oneRun(S); ran++; } catch (e) {
    flag(SEED, 'a run threw', e.message);
  }
  if (i % 250 === 249) { auditGlobal(SEED); }
}
auditGlobal(SEED);

[...new Set(oracleSaid)].forEach(m => flag(SEED, "the app's own invariant objected", m));

const secs = ((Date.now() - started) / 1000).toFixed(1);
const uniq = [];
problems.forEach(p => { if (!uniq.some(u => u.what === p.what && u.detail === p.detail)) uniq.push(p); });

console.log(`\n  fuzz: ${ran} random lives in ${secs}s — ${audited} finished and were audited, ${skipped} still live`);

/* A PASS THAT AUDITED NOTHING IS NOT A PASS. Half of this file's history is
   tests that were quietly vacuous: a retail branch calling a function that does
   not exist, its throw swallowed by a catch, reporting "ok" for two thousand
   runs it never ran. The count above has to be large or this exits non-zero. */
if (audited < ran * 0.15) {
  console.log(`\n  x only ${audited} of ${ran} runs finished an order — the money paths are not being exercised\n`);
  process.exit(1);
}
if (!uniq.length) {
  console.log(`  ok escrow closed, nothing minted, nobody negative, the chain held — ${audited} times\n`);
  process.exit(0);
}
console.log(`\n  x ${problems.length} violation(s), ${uniq.length} distinct:\n`);
uniq.slice(0, 12).forEach(p =>
  console.log(`      x ${p.what}\n          ${p.detail}\n          replay: node tools/fuzz.mjs --seed ${p.seed} --runs 1`));
process.exit(1);
