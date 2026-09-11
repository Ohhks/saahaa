/* SAAHAA · tools/render-views.mjs — does the screen actually BUILD?
   THREE SEPARATE ROUNDS HAVE BEEN LOST TO A NAME THAT WAS NOT IN SCOPE.
     · `flags.isOn(…)` in ui/views/partner.js, never imported — took down the
       shop's Payouts tab, the only screen with a withdraw button, on exactly
       the days a kirana is trading.
     · `t(…)` called 88 times in ui/views/ask.js, never imported — killed the
       whole ask-for-quotes journey on both sides, and an audit scored the
       product 4/10 largely for it.
     · `saving` read inside `heroReply()` while being a `const` inside a
       DIFFERENT function — the quote-picking screen died with "saving is not
       defined" the moment the sealed window closed, so a customer who asked
       four plumbers for prices could never pick one.
   Every other gate passes all three. A free variable is legal JavaScript, so
   `lint-parse` compiles it. The domain tests and money journeys never build a
   view. The bundle boots, because the home route does not touch these lines.
   `smoke-dist` opens twelve routes and `#/ask/none` short-circuits to "that
   request is gone" without ever reaching the crashing branch.
   And the third one proves a static check cannot close this: `saving` WAS
   declared in that file, one function up. Catching it needs real scope
   analysis — or it needs somebody to render the screen with data on it, which
   is all this file does.
   It reuses the journey harness's Node shim: enough of a DOM for a module to
   evaluate, and nothing that fakes a domain answer. A view here is called the
   way the router calls it, with a world that has orders, bids and money in it.
   A thrown ReferenceError is a dead screen and fails the build.
   Run: node --experimental-vm-modules tools/render-views.mjs   (in preflight) */
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
globalThis.window = {
  location: { hash: '', search: '', pathname: '/', href: 'http://localhost/' },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.location = globalThis.window.location;
Object.defineProperty(globalThis, 'navigator',
  { value: { languages: ['en'], language: 'en', onLine: true }, configurable: true });
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {},
  addEventListener() {}, removeEventListener() {}, focus() {}, remove() {}, blur() {},
  scrollIntoView() {}, querySelector: () => null, querySelectorAll: () => [],
  closest: () => null, contains: () => false, insertAdjacentHTML() {},
  value: '', textContent: '', innerHTML: '', dataset: {}, children: [] });

/* the shim is enough of a browser for a module to EVALUATE and a view to build
   a string. Anything missing here shows up as a ReferenceError and would be
   indistinguishable from the product bug this file hunts, so it stays complete
   rather than minimal. */
globalThis.document = {
  documentElement: { getAttribute: () => null, setAttribute() {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: el, body: { appendChild() {}, classList: { add() {}, remove() {} } },
};
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const U = p => new URL('../' + p, import.meta.url).href;

const ctx   = await import(U('src/core/ctx.js'));
const store = await import(U('src/core/store.js'));
const flags = await import(U('src/core/flags.js'));
await import(U('src/domain/catalog.services.js'));
await import(U('src/domain/catalog.retail.js'));
const { defaultState } = await import(U('src/domain/state.js'));
const { buildSeed } = await import(U('src/domain/seed.js'));
const A     = await import(U('src/domain/auction.js'));
const F     = await import(U('src/domain/flow.js'));

let pass = 0; const fails = [];

/* A screen is "built" when its render returns markup. Anything thrown is the
   failure this file exists for; a ReferenceError is named specially because it
   is always a dead screen, never a missing stub. */
function builds(name, fn) {
  let out;
  try { out = fn(); } catch (e) {
    const kind = e instanceof ReferenceError ? 'DEAD SCREEN' : e.constructor.name;
    fails.push(`${name}\n      ${kind}: ${e.message}`);
    return;
  }
  if (typeof out !== 'string' || out.length < 40) {
    fails.push(`${name}\n      rendered ${typeof out} of length ${(out || '').length} — nothing painted`);
    return;
  }
  pass++;
}

/* A SHEET RETURNS NOTHING — it paints through ui/dom.js. What matters is that
   building it does not throw, which is exactly how the cancel sheet's dead
   button and the ask screen's dead name would have surfaced. */
const opens = (name, fn) => builds(name, () => { fn(); return 'sheet built without throwing — nothing to paint in Node'; });

/* the same bootstrap the money journeys use — see tools/journey.mjs */
async function world() {
  const s = store.createStore(store.combineFromRegistry(), defaultState());
  ctx.ctx.store = s;
  ctx.ctx.render = () => {};
  ctx.ctx.go = () => {};
  const seed = await buildSeed();
  flags.set('SIM_MARKET', false);        // no timers: this file drives every step
  s.dispatch({ type: 'seed/users',    payload: seed.users });
  s.dispatch({ type: 'seed/partners', payload: seed.partners });
  s.dispatch({ type: 'seed/shops',    payload: seed.shops });
  s.dispatch({ type: 'seed/products', payload: seed.products });
  s.dispatch({ type: 'seed/done' });
  return s;
}

const S = await world();
const st = ctx.getState();
const cat = (st.partners[0] || {}).cat || 'plumbing';
const pros = st.partners.filter(p => p.cat === cat).slice(0, 4);

/* somebody has to be signed in: these are HER screens */
const cust = st.users.find(u => u.role === 'customer');
ctx.saveSession({ ...cust, address: '302, Sai Nilayam, Road No 4' });

/* ── the ask, at every stage it has a screen for ─────────────── */
const ask = await import(U('src/ui/views/ask.js'));
const req = A.postRequest({ catId: cat, sub: null, complexity: 'simple',
  held: pros[0] ? { partnerId: pros[0].id, partnerName: pros[0].name, amount: pros[0].ask } : null });
if (!req) {
  fails.push('the ask · a request can be posted\n      postRequest returned null');
} else {
  builds('the ask · waiting for rates', () => ask.render(req.id));
  for (const p of pros.slice(1)) {
    A.placeBid({ requestId: req.id, partner: p, amount: Math.round(p.ask * 0.92), quiet: true });
  }
  builds('the ask · rates coming in', () => ask.render(req.id));
  /* the branch that died: the sealed window is over and she picks a winner */
  const r0 = ctx.getState().requests.find(x => x.id === req.id);
  S.dispatch({ type: 'request/patch', payload: { id: req.id, patch: { closesAt: Date.now() - 1000 } } });
  A.closeIfDue(req.id);
  builds('the ask · RATES ARE IN, she picks one', () => ask.render(req.id));
  const partner = pros[1] || pros[0];
  if (partner) opens('the ask · a pro sends his rate', () => ask.bidSheet(req.id, partner));
  /* this one returns '' when the pool is too small to offer an auction, which
     is a real answer and not a dead screen — only the throw matters */
  opens('the ask · the entry row on Home', () => ask.entryRow(cat, pros[0] || null, (pros[0] || {}).ask || 50000));
}

/* ── the order screens, and every console ─────────────────────── */
const orders = await import(U('src/ui/views/orders.js'));
const shops  = await import(U('src/ui/views/shops.js'));
const home   = await import(U('src/ui/views/home.js'));
const account = await import(U('src/ui/views/account.js'));
const partnerV = await import(U('src/ui/views/partner.js'));
const job = await F.bookService({ catId: cat, partner: pros[0], sub: null });
if (job) {
  builds('a job · her order screen', () => orders.renderDetail(job.id));
  opens('a job · the cancel sheet', () => orders.openCancel(job.id));
  opens('a job · the no-show sheet', () => orders.openNoShow(job.id));
  opens('a job · report an issue', () => orders.openDispute(job.id));
  /* and the screen AFTER she reports one: the banner that says it landed reads
     from state.disputes, which no other render here exercises */
  F.raiseDispute(job.id, 'Damaged / leaked', '');
  builds('a job · with a complaint open on it', () => orders.renderDetail(job.id));
  builds('a job · the chat', () => orders.renderChat(job.id));
}

/* a retail basket, carried far enough to have money and a weighing on it */
const shop = st.shops.find(x => x.deliveryMode !== 'pickup_only');
const prod = shop && st.products.find(x => x.shopId === shop.id && x.active);
if (shop && prod) {
  shops.addToCart(prod.id, 2);
  builds('the cart', () => shops.renderCart());
  builds('a shop page', () => shops.renderShop(shop.id));
}

builds('the shops list', () => shops.renderList());

/* A SHOP PANEL WITH A RETURN PENDING ON IT. The payout block has its own branch
   for that state, and nothing here rendered it -- so a free variable added to it
   sailed past this gate while every other screen built fine. A branch nobody
   renders is a branch nobody checks. */
if (shop && prod) {
  /* the harness only builds a cart, so place it first — this branch needs a
     real retail order with lines on it */
  let ret = (ctx.getState().orders || []).find(o => o.kind === 'retail' && o.shopId === shop.id);
  if (!ret) { try { ret = await F.placeRetailOrder('rider'); } catch (e) { ret = null; } }
  if (ret && (ret.lines || []).length) {
    S.dispatch({ type: 'order/patch', payload: { id: ret.id, patch: {
      stage: 'R_RETURN', returnLines: [ret.lines[0].lineId], returnReason: 'Damaged / leaked' } } });
    /* as the SHOP — the payout block is his panel, not hers, and signing in as
       the customer renders the other branch entirely */
    const keep = ctx.session;
    ctx.saveSession({ key: shop.ownerKey || 'S20260001', name: shop.name, role: 'shop', code: 'S20260001', shopId: shop.id });
    builds('a shop order with a return pending', () => orders.renderDetail(ret.id));
    if (keep) ctx.saveSession({ ...keep });
  }
}
builds('the orders list', () => orders.renderList());
builds('home', () => home.render());
opens('home · a category sheet is built', () => home.openCategory(cat, null, null));
builds('account', () => account.render());
const pro0 = pros[0];
if (pro0) {
  ctx.saveSession({ key: pro0.userKey || 'P20260001', name: pro0.name, role: 'partner', code: 'P20260001' });
  builds('the partner console', () => partnerV.renderPartner());
  opens('the partner console · he changes his own rate', () => partnerV.openRateSheet(pro0.id));
}

if (shop) {
  ctx.saveSession({ key: shop.ownerKey || 'S20260001', name: shop.name, role: 'shop', code: 'S20260001', shopId: shop.id });
  builds('the shop console', () => partnerV.renderShopAdmin());
}

/* ── the doors ────────────────────────────────────────────────── */
const auth = await import(U('src/ui/views/auth.js'));
for (const [tab, role] of [['signin', 'customer'], ['signup', 'customer'],
                           ['signup', 'partner'], ['signup', 'shop']]) {
  auth.setAuthTab(tab); auth.setAuthRole(role);
  builds(`the door · ${tab} as ${role}`, () => auth.render());
}

/* THE SHOP FORM MUST CARRY THE SLOT THE LICENCE FIELD PAINTS INTO. Requiring a
   number the form cannot show closed five of eight retail categories -- every
   food shop and every chemist -- behind an error naming a box that was not
   there. The gate is only honest if the input can exist. */
auth.setAuthTab('signup'); auth.setAuthRole('shop');
const shopForm = auth.render();
/* and it must ask where the money goes: a shop went live, took an order, held
   ₹137 and was never asked for a UPI id anywhere in signup. */
if (!/id="suUpi"/.test(shopForm)) {
  fails.push('the door · signup as shop — never asks for a UPI id, so takings have nowhere to go');
} else pass++;
if (!/id="suLicenceSlot"/.test(shopForm)) {
  fails.push('the door · signup as shop — no licence slot, so a gated category can never be filled in');
} else pass++;

/* THE LANGUAGE PICKER MUST BE REACHABLE FROM THE PARTNER SIDE. It lived only
   on the customer account screen -- behind a door a Telugu-only plumber cannot
   read -- so the whole partner journey was untranslatable in practice. These
   are the screens he actually meets. */
{
  const reach = [
    ['the door', () => { auth.setAuthTab('signin'); auth.setAuthRole('customer'); return auth.render(); }],
    ['pro signup', () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); return auth.render(); }],
  ];
  for (const [name, fn] of reach) {
    let html = '';
    try { html = fn() || ''; } catch (e) { html = ''; }
    if (/data-act="lang.set"/.test(html)) pass++;
    else fails.push(name + ' — no language picker on it');
  }
}

console.log(`  views: ${pass} screen(s) built, ${fails.length} failure(s)`);
if (fails.length) {
  console.log('\n  x A SCREEN DID NOT BUILD:');
  fails.forEach(f => console.log('      x ' + f));
  console.log('\n    A free variable is legal JavaScript: it parses, tests pass, the bundle');
  console.log('    boots. It throws the first time somebody opens that screen with data on');
  console.log('    it. Fix the name, or the screen is dead for every user.');
  process.exit(1);
}

console.log('  ok every screen built with real data on it');