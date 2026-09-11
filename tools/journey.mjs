#!/usr/bin/env node
/* SAAHAA · tools/journey.mjs — put real money through the real app.

   THE ONLY REASON THIS FILE EXISTS.
   One bug shipped five times, each version under a confident comment saying
   why it could not possibly be wrong. Four audits read the source and missed
   every generation. The fifth was found in ten minutes by placing ONE real
   order in a browser and reading the numbers that came out.

   Everything the other gates do, they do without money moving:
     · test-node.mjs   — pure functions, and the reweigh suites re-implemented
                         the arithmetic by hand, so the model shared the bug
                         and the suite reported green
     · smoke-dist.py   — the bundle boots and paints
     · lint-parse      — every module parses
     · lint-i18n / lint-dead / guard-ui — source shape

   Nothing drove an order from cart to settled and asked where the rupees went.
   This does. It wires the real store, the real reducers and the real flow, and
   after EVERY step it asks the book. A journey that ends with escrow at
   anything but zero is money stranded or money minted.

   Run: node tools/journey.mjs        (wired into tools/preflight.sh) */

/* ── the smallest honest environment ──────────────────────────
   Only what an import needs in order to evaluate. Nothing here fakes a domain
   behaviour: `toast` and `render` are no-ops because they are UI, and every
   number this file checks comes from the ledger. */
class MemStorage {
  #m = new Map();
  getItem(k) { const v = this.#m.get(String(k)); return v === undefined ? null : v; }
  setItem(k, v) { this.#m.set(String(k), String(v)); }
  removeItem(k) { this.#m.delete(String(k)); }
  clear() { this.#m.clear(); }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  get length() { return this.#m.size; }
}
/* A MONEY HELPER HANDED THE WRONG TOTAL FAILS HERE INSTEAD OF BEING QUIETLY
   REPAIRED AT RENDER TIME. See core/money.js `roundParts`. */
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
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, setAttribute() {}, addEventListener() {}, focus() {}, remove() {},
  scrollIntoView() {}, value: '' });
globalThis.document = {
  documentElement: {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: el, body: { appendChild() {}, classList: { add() {}, remove() {} } },
};
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);

const U = p => new URL('../' + p, import.meta.url).href;

const ctx   = await import(U('src/core/ctx.js'));
const store = await import(U('src/core/store.js'));
const flags = await import(U('src/core/flags.js'));
const M     = await import(U('src/core/money.js'));
const CATSVC = await import(U('src/domain/catalog.services.js'));
await import(U('src/domain/catalog.retail.js'));
const { defaultState } = await import(U('src/domain/state.js'));
const { buildSeed } = await import(U('src/domain/seed.js'));
const L = await import(U('src/domain/ledger.js'));
const W = await import(U('src/domain/wallet.js'));
const FRESH = await import(U('src/domain/fresh.js'));
const VER = await import(U('src/domain/verification.js'));
const P = await import(U('src/domain/pricing.js'));
const F = await import(U('src/domain/flow.js'));
const A = await import(U('src/domain/auction.js'));
const T = await import(U('src/domain/trust.js'));

/* ── the reporter ─────────────────────────────────────────── */
let failed = 0, checks = 0, books = 0;
const notes = [];
function say(ok, what, detail) {
  checks++;
  if (ok) return;
  failed++;
  notes.push('      x ' + what + (detail ? '\n          ' + detail : ''));
}
const eq = (got, want, what) => say(got === want, what, `got ${got}, wanted ${want}`);

/* THE ASSERTION THIS WHOLE FILE IS BUILT AROUND. Two separate bugs drove escrow
   negative while every unit test stayed green, because nothing ever asked the
   book BETWEEN steps. It is asked after every single one now, including the
   stranded-escrow check that had no caller for four audits. */
function book(where) {
  books++;
  const closedOrderIds = (ctx.getState().orders || [])
    .filter(o => ['CANCELLED', 'CLOSED', 'RATED', 'R_CLOSED', 'R_CANCELLED'].includes(o.stage))
    .map(o => o.id);
  const r = L.checkInvariants(ctx.getState().ledger || [], { closedOrderIds });
  const bad = (r.checks || []).filter(c => !c.ok);
  say(bad.length === 0, `the book holds after ${where}`,
    bad.map(c => c.id + ': ' + c.detail).join('; '));
  return r;
}

async function freshWorld() {
  const s = store.createStore(store.combineFromRegistry(), defaultState());
  ctx.ctx.store = s;
  ctx.ctx.render = () => {};
  ctx.ctx.go = () => {};
  const seed = await buildSeed();
  flags.set('SIM_MARKET', false);          // no timers: this file drives every step itself
  s.dispatch({ type: 'seed/users',    payload: seed.users });
  s.dispatch({ type: 'seed/partners', payload: seed.partners });
  s.dispatch({ type: 'seed/shops',    payload: seed.shops });
  s.dispatch({ type: 'seed/products', payload: seed.products });
  s.dispatch({ type: 'seed/done' });
  return s;
}
const orderOf = id => ctx.getState().orders.find(o => o.id === id);
const escrowOf = id => L.balanceOf(ctx.getState().ledger, L.acct.escrow(id));

/* ═══ 1 · groceries, weighed SHORT ═══════════════════════════
   The exact shape that hid five generations of one bug: a basket over the
   shop's free-delivery line, weighed lighter than it was ordered. */
async function retailShortWeigh() {
  await freshWorld();
  const st = ctx.getState();
  const shop = st.shops.find(s => s.freeDeliveryAbove > 0 && s.deliveryMode !== 'pickup_only');
  const prod = shop && st.products.find(p => p.shopId === shop.id && p.variableWeight && p.active);
  if (!shop || !prod) { say(false, 'the seed has a by-weight product at a free-delivery shop'); return; }
  const cust = st.users.find(u => u.role === 'customer' && u.area === shop.area)
            || st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam, Road No 4' });
  book('seeding');

  /* THE SCENARIO HAS TO BITE, OR THE JOURNEY PROVES NOTHING. Ordering 1.1x the
     threshold and dropping ONE unit left the basket still above the line, so
     free delivery survived whatever the code did — the same defect the old
     reweigh unit tests had, reproduced in the gate written to catch it. The
     weights are chosen to straddle the line, and the straddle is asserted. */
  const qty = Math.round((shop.freeDeliveryAbove * 1.06) / prod.price * 100) / 100;
  F.clearCart();
  F.addToCart(prod, qty);
  const quoted = F.cartQuote('rider');
  say(!!quoted, 'the cart quotes');
  eq(quoted.deliveryFee, 0, 'free delivery applies at checkout');
  say(quoted.shopAbsorbs > 0, 'and somebody is paid for the ride — nobody works unpaid');

  const ord = await F.placeRetailOrder('rider');
  say(!!ord, 'the order is placed');
  if (!ord) return;
  book('placing the order');
  eq(escrowOf(ord.id), ord.agreedTotal, 'escrow holds exactly what she agreed to pay');
  /* AND THE OTHER WAY IN HAD NO SUCH GUARD. A job won at auction called
     `bookService` directly and carried `customerAddress: ""`, so a plumber was
     sent to a neighbourhood name. The refusal lives in the engine now, which is
     the only place both paths pass through. */
  {
    ctx.saveSession({ ...cust, address: '' });
    let refused = false;
    try { await F.bookService({ catId: ctx.getState().partners[0].cat, partner: ctx.getState().partners[0], sub: null }); }
    catch (e) { refused = true; }
    say(refused, 'NO PATH can book a job without a door to knock on');
    ctx.saveSession({ ...cust, address: '302, Sai Nilayam, Road No 4' });
  }

  say(!!ord.customerAddress, 'and the order carries a door, not just an area',
      `customerAddress: ${JSON.stringify(ord.customerAddress)}`);

  F.advance(ord.id, 'R_ACCEPTED', {}); book('the shop accepting');
  F.advance(ord.id, 'R_PICKING', {});  book('the shop picking');

  const short = Math.round((shop.freeDeliveryAbove * 0.94) / prod.price * 100) / 100;
  say(Math.round(prod.price * qty) >= shop.freeDeliveryAbove,
      'the ordered basket clears the free-delivery line',
      `${M.fmt(Math.round(prod.price * qty))} vs ${M.fmt(shop.freeDeliveryAbove)}`);
  say(Math.round(prod.price * short) < shop.freeDeliveryAbove,
      'AND THE WEIGHED BASKET FALLS BELOW IT — otherwise this journey tests nothing',
      `${M.fmt(Math.round(prod.price * short))} vs ${M.fmt(shop.freeDeliveryAbove)}`);
  await F.setPickedQty(ord.id, ord.lines[0].lineId, short);
  book('the short weigh');
  const mid = orderOf(ord.id);
  eq(mid.deliveryFee, 0, 'free delivery SURVIVES the reweigh — generation five');
  eq(mid.shopAbsorbedDelivery, true, 'and the order still records who paid for the ride');
  eq(mid.riderPayout, ord.riderPayout, 'the ride is a distance band, never scaled — generation three');
  eq(mid.overEstimate, 0, 'weighing LIGHTER can never read as an over-estimate');
  eq(mid.agreedTotal, ord.agreedTotal, 'what she agreed never moves');
  say(mid.customerPays < ord.agreedTotal, 'she is charged less than she agreed',
      `${M.fmt(mid.customerPays)} against ${M.fmt(ord.agreedTotal)}`);
  eq(ord.agreedTotal - mid.customerPays,
     Math.round(prod.price * qty) - Math.round(prod.price * short),
     'the refund is the weight difference, to the paisa');

  /* THE ORDER'S OWN ARITHMETIC, NOT JUST THE LEDGER'S. After a short weigh the
     re-quote scaled `itemsTotal` down by a rider fee she had not paid and left
     `dispatchCut` at the figure from placement, so the order claimed to allocate
     ₹5 more than was ever collected. The LEDGER stayed right — settlement hands
     out the residual — so no invariant fired, and every screen that read the
     order's fields was quietly wrong. A record whose parts do not sum to its
     own total is wrong even when the money is right. */
  eq((mid.itemsTotal | 0) + (mid.deliveryFee | 0), mid.customerPays | 0,
     'items + delivery is what she is charged');
  eq((mid.shopPayout | 0) + (mid.platformFee | 0) + (mid.riderPayout | 0) + (mid.dispatchCut | 0),
     mid.customerPays | 0,
     'and the order allocates exactly what it collects — no more, no less');
  say((mid.itemsTotal | 0) === (mid.weighedItemsTotal | 0),
      'the basket shown is the basket weighed',
      `${M.fmt(mid.itemsTotal)} shown vs ${M.fmt(mid.weighedItemsTotal)} weighed`);

  F.advance(ord.id, 'R_PACKED', {}); book('packing');
  F.advance(ord.id, 'R_OUT', {});    book('going out');
  say(F.checkRetailCode(ord.id, String(cust.code || ord.otp)), 'her own code opens the door');
  F.advance(ord.id, 'R_DELIVERED', { deliveredAt: Date.now(), otpVerified: true });
  book('delivery');

  const oc0 = ctx.getState().shops.find(s => s.id === shop.id).ordersCompleted | 0;
  const her0 = L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key));
  await F.settleRetail(ord.id);
  book('settlement');

  const fin = orderOf(ord.id);
  eq(fin.stage, 'R_CLOSED', 'the order reaches a terminal stage');
  eq(escrowOf(ord.id), 0, 'ESCROW LANDS AT ZERO — nothing stranded, nothing minted');
  eq(L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key)) - her0,
     ord.agreedTotal - fin.customerPays, 'she is refunded exactly the difference');
  eq(ctx.getState().shops.find(s => s.id === shop.id).ordersCompleted | 0, oc0 + 1,
     'the completed-order counter advances on DELIVERY, not on a refund');
  say(L.balanceOf(ctx.getState().ledger, L.acct.shop(shop.id)) > 0, 'the shop is paid');

  /* A LEG THAT BELONGS TO AN ORDER MUST NAME IT. The shop's money column counts
     only the orders that column is about, by filtering its ledger legs through
     the ids on the other side -- and these legs posted with an empty meta, so
     the filter matched nothing, `yours` came out 0, and the residual line
     absorbed the shop's entire month. Its statement read "Yours ₹0" beside
     "Free delivery you gave − ₹416" for a delivery the customer had paid for.
     Nothing in the engine noticed, because the money was all in the right
     accounts; only the screen that asked "which orders?" could tell. */
  const shopAcct = L.acct.shop(shop.id);
  const anon = L.legsFor(ctx.getState().ledger, shopAcct)
    .filter(r => (r.kind === 'SHOP_PAYOUT' || r.kind === 'RIDER') && !(r.meta && r.meta.orderId));
  eq(anon.length, 0, 'every settlement leg paid to the shop names the order it came from');
}

/* ═══ 1b · a basket weighed HEAVIER than she ordered ════════
   The short weigh had a journey through five generations of bugs. The OPPOSITE
   case had none at all, and that is where the next one was found: the shop's
   own money panel derived "free delivery you gave" as a residual, and on an
   over-weighed order `setPickedQty` scales `itemsTotal` down to fit what she is
   actually charged — so the residual collapsed to zero, the giveaway line
   vanished, the panel printed a basket that matched neither the weighed goods
   nor the order, and the shop's stated receipt went UP after it gave stock
   away. An audit read that as the app saying overweighing pays.

   She may never be charged more than she agreed. The shop's column must add up
   to what she paid. Both are asserted here. */
async function retailOverWeigh() {
  await freshWorld();
  const st = ctx.getState();
  const shop = st.shops.find(s => s.deliveryMode !== 'pickup_only');
  const prod = shop && st.products.find(p => p.shopId === shop.id && p.variableWeight && p.active);
  if (!shop || !prod) { say(false, 'the seed has a by-weight product'); return; }
  const cust = st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '12, Market Street' });

  /* clear the shop's own minimum, or the order is refused before it can be
     weighed at all and the journey reports a failure it did not test for */
  const need = Math.max(1, Math.ceil((shop.minOrder | 0) / prod.price) + 1);
  F.clearCart();
  F.addToCart(prod, need);
  const ord = await F.placeRetailOrder('rider');
  say(!!ord, 'the order is placed', `${need} x ${M.fmt(prod.price)} vs min ${M.fmt(shop.minOrder | 0)}`);
  if (!ord) return;
  book('placing the order');

  F.advance(ord.id, 'R_ACCEPTED', {});
  F.advance(ord.id, 'R_PICKING', {});

  /* 35% heavier — well past any rounding, so the cap has to do real work */
  const heavy = Math.round(need * 1.35 * 100) / 100;
  await F.setPickedQty(ord.id, ord.lines[0].lineId, heavy);
  book('the heavy weigh');

  const mid = orderOf(ord.id);
  say(mid.weighedTotal > mid.agreedTotal,
      'THE WEIGHED BASKET IS DEARER THAN THE ONE SHE AGREED TO — otherwise this proves nothing',
      `weighed ${M.fmt(mid.weighedTotal)} vs agreed ${M.fmt(mid.agreedTotal)}`);
  eq(mid.customerPays, mid.agreedTotal, 'and she is charged exactly what she agreed, not a paisa more');
  say((mid.overWeighAbsorbed | 0) > 0, 'the order records what the shop gave away',
      `${M.fmt(mid.overWeighAbsorbed)}`);

  /* the panel's own arithmetic: what she paid, less what SAAHAA takes, is what
     reaches the shop — including any delivery the shop made itself */
  const own = flags.isOn('RIDER_POOL') ? 0 : (mid.riderPayout | 0);
  const gets = (mid.shopPayout | 0) + own;
  /* SAAHAA's take is `platformFee`, which is GST-INCLUSIVE — `gst` is the tax
     inside it. This assertion used to add the two, which double-counted the tax
     and cancelled out an equal-and-opposite error in the engine, so both passed
     while the shop was quietly underpaid by exactly that amount. */
  const saahaa = mid.platformFee | 0;
  eq(gets + saahaa + (mid.dispatchCut | 0), mid.customerPays | 0,
     'the shop panel adds up: she paid = SAAHAA + dispatch + what the shop receives');

  F.advance(ord.id, 'R_PACKED', {});
  F.advance(ord.id, 'R_OUT', {});
  say(F.checkRetailCode(ord.id, String(cust.code || ord.otp)), 'her own code opens the door');
  F.advance(ord.id, 'R_DELIVERED', { deliveredAt: Date.now(), otpVerified: true });
  await F.settleRetail(ord.id);
  book('settlement');
  eq(escrowOf(ord.id), 0, 'ESCROW LANDS AT ZERO — the giveaway is the shop\'s, not a hole in the book');
}

/* ═══ 1c · one bad item comes back, the rest of the shopping stays ═
   A return was all or nothing: one stale packet of turmeric took a whole basket
   back with it, atta and all, and the shop lost a sale it had filled correctly.
   She is refunded for what actually came back; the shop is paid for what she
   kept; escrow still lands at zero, which is the only way to know the two
   halves add up. */
async function retailPartialReturn() {
  await freshWorld();
  const st = ctx.getState();
  const shop = st.shops.find(x => x.deliveryMode !== 'pickup_only');
  const prods = shop && st.products.filter(x => x.shopId === shop.id && x.active).slice(0, 3);
  if (!shop || !prods || prods.length < 2) { say(false, 'the seed has a shop with two products'); return; }
  const cust = st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '9, Nallakunta' });

  F.clearCart();
  for (const pr of prods) F.addToCart(pr, Math.max(1, Math.ceil((shop.minOrder | 0) / pr.price / prods.length) + 1));
  const ord = await F.placeRetailOrder('rider');
  say(!!ord, 'the order is placed');
  if (!ord) return;
  book('placing the order');

  F.advance(ord.id, 'R_ACCEPTED', {});
  F.advance(ord.id, 'R_PICKING', {});
  F.advance(ord.id, 'R_PACKED', {});
  F.advance(ord.id, 'R_OUT', {});
  say(F.checkRetailCode(ord.id, String(cust.code || ord.otp)), 'her own code opens the door');
  F.advance(ord.id, 'R_DELIVERED', { deliveredAt: Date.now(), otpVerified: true });
  book('delivery');

  const bad = ord.lines[0];
  const badValue = Math.round((bad.unitPrice | 0) * (bad.pickedQty != null ? bad.pickedQty : bad.qty));
  say(ord.lines.length > 1, 'THE BASKET HAS MORE THAN THE ONE BAD ITEM — otherwise this proves nothing',
      `${ord.lines.length} lines`);
  say(badValue < (ord.customerPays | 0), 'and the bad item is worth less than the basket',
      `${M.fmt(badValue)} of ${M.fmt(ord.customerPays | 0)}`);

  const herStart = L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key));
  const feeBefore = L.balanceOf(ctx.getState().ledger, L.acct.fee());
  F.requestReturn(ord.id, 'Stale or spoiled', [bad.lineId]);
  const asked = orderOf(ord.id);
  eq(asked.stage, 'R_RETURN', 'the shop is asked');
  say((asked.returnLines || []).length === 1, 'and the order records WHICH item is coming back');

  await F.acceptReturn(ord.id);
  book('the partial return');
  const fin = orderOf(ord.id);

  const herBack = L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key)) - herStart;
  eq(herBack, badValue, 'she is refunded exactly what the returned item cost her');
  say((fin.customerPays | 0) > 0, 'and she is still charged for the shopping she kept',
      `${M.fmt(fin.customerPays | 0)}`);
  say(L.balanceOf(ctx.getState().ledger, L.acct.shop(shop.id)) > 0, 'the shop is paid for what she kept');
  /* AND THE JOURNEY PASSED WHILE SAAHAA AND THE RIDER WERE PAID NOTHING.
     Settlement hands out what escrow holds in priority order with the shop
     FIRST, so a partial return that lowered the total without lowering
     `shopPayout` let the shop swallow the whole remainder: no fee leg, no GST
     leg, no rider leg, and a shop screen still asserting a ₹5 dispatch cut the
     book had never taken. Escrow landed at zero throughout, which is why
     nothing noticed. Escrow reaching zero says the money went SOMEWHERE, not
     that it went to the right people. */
  /* THE PAYOUTS LIST PRINTS THE ORDER'S OWN `shopPayout` + the delivery it drove.
     An audit read "AWAITING PAYOUT ₹137" and, one row below, "₹454" for that
     same order, because the figure on the order still described the basket
     before the return. Whatever the screen prints has to be what the book
     moved, or the shop is reading fiction. */
  const paidToShop = L.legsFor(ctx.getState().ledger, L.acct.shop(shop.id))
    .filter(r => r.meta && r.meta.orderId === ord.id)
    .reduce((n, r) => n + (r.delta | 0), 0);
  const rowShows = (orderOf(ord.id).shopPayout | 0)
    + (flags.isOn('RIDER_POOL') ? 0 : (orderOf(ord.id).riderPayout | 0));
  eq(rowShows, paidToShop, 'the Payouts row shows exactly what the ledger paid the shop');

  /* AND THE SHOP'S BOOK HAS TO ADD UP THE WAY IT IS PRINTED. It shows what she
     paid, less what came back, less SAAHAA's fee and its dispatch cut, and
     calls the remainder "reached your till" — so those five figures must
     reconcile against the ledger, or the shop is reading a story. */
  const fin2 = orderOf(ord.id);
  const shePaid = (fin2.customerPays | 0) + (fin2.returnedValue | 0);
  const took = (fin2.platformFee | 0) + (fin2.dispatchCut | 0);
  eq(shePaid - (fin2.returnedValue | 0) - took, paidToShop,
     'the shop book reconciles: she paid, less the return, less SAAHAA, is what reached the till');

  /* AND THAT ALONE CANNOT SEE AN UNDERPAID SHOP. Settlement lets the DISPATCH
     cut absorb whatever is left over, so understating `shopPayout` quietly
     moves money to SAAHAA and grows the dispatch line by the same amount --
     both sides of the check above move together and it stays green. Pin the
     fee to what the order says the fee is, and the residual can no longer
     hide a transfer. */
  /* read it through `legsFor`, which understands both entry shapes — the book
     has used two, and reading only `e.legs` made an earlier assertion inert */
  const feeLegs = [L.acct.fee(), L.acct.gst()]
    .flatMap(a => L.legsFor(ctx.getState().ledger, a))
    /* the fee account also receives the DISPATCH cut, which is a separate charge
       with its own line — this is about the commission only */
    .filter(r => r.meta && r.meta.orderId === ord.id && (r.kind === 'FEE' || r.kind === 'GST'))
    .reduce((n, r) => n + (r.delta | 0), 0);
  eq(feeLegs, fin2.platformFee | 0,
     'SAAHAA is paid exactly the fee the order records — no more, no less');

  /* AND THE DISPATCH CUT IS A PUBLISHED PRICE, NOT A REMAINDER. Settlement lets
     it absorb whatever is left so escrow lands at zero, which is right — but it
     also means any understatement of the shop's payout silently becomes SAAHAA
     income, and every other check moves with it: the order's own dispatchCut is
     rewritten to match, so the book still reconciles against itself. Pinning it
     to the ₹5 the product publishes is the only line that cannot be dragged. */
  const P2 = await import(U('src/domain/pricing.js'));
  eq(fin2.dispatchCut | 0, P2.RIDER_DISPATCH_CUT,
     'the dispatch cut is the ₹5 the product publishes, not whatever was left over');

  const feeAfter = L.balanceOf(ctx.getState().ledger, L.acct.fee()) - feeBefore;
  say(feeAfter > 0, 'SAAHAA is still paid its fee on the shopping she kept',
      `fee legs came to ${M.fmt(feeAfter)}`);
  eq(escrowOf(ord.id), 0, 'ESCROW LANDS AT ZERO — refund and settlement together empty it');
  say(['R_CLOSED', 'R_SETTLED', 'R_REFUNDED'].includes(fin.stage),
      'and the order ends in a closed stage', `stage ${fin.stage}`);
}

/* ═══ 2 · a job, booked, coded, done, settled ═══════════════ */
async function serviceDone() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer' && u.key !== p.userKey);
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });
  book('seeding');

  const o = await F.bookService({ catId: p.cat, partner: p, sub: null, deal: p.ask, slot: 'now' });
  say(!!o, 'the job is booked');
  if (!o) return;
  book('booking');
  eq(escrowOf(o.id), o.customerPays, 'escrow holds the whole customer price');
  eq(o.deal, p.ask, 'he is booked at exactly what he asked');

  F.advance(o.id, 'ASSIGNED', {}); book('assignment');
  F.advance(o.id, 'EN_ROUTE', {}); book('travel');
  F.advance(o.id, 'ARRIVED', {});  book('arrival');
  say(F.verifyOtp(o.id, String(cust.code || o.otp)), 'her code starts the work');
  book('the door code');
  const mid = orderOf(o.id);
  eq(mid.stage, 'IN_PROGRESS', 'the code moves it to work in progress');
  say(!!mid.stake, 'and the stake is locked by the code');

  F.advance(o.id, 'WORK_DONE', { evidence: [{ label: 'After', at: Date.now() }] });
  book('work finished');
  await F.confirmAndRelease(o.id, 1);
  book('release');

  /* AND EVERY LINE MUST SAY WHICH JOB IT IS ABOUT. "Cancellation fee −₹33.90"
     with no job and no customer was the one question a pro actually asks the
     passbook, and the app could not answer it anywhere. */
  {
    const mine = L.legsFor(ctx.getState().ledger, L.acct.partner(p.id));
    const anon = mine.filter(r => !(r.meta && r.meta.orderId));
    say(anon.length === 0, 'every line in his passbook names the job it came from',
        anon.map(r => r.kind).join(', '));
  }


  /* AND ONE ₹100 STAKE PRINTED FOUR LINES, two of them contradicting the other
     two, because the passbook reads all four of his pockets and a move between
     two of them is a real double entry. What never left him is one line. */
  {
    const pocketed = L.partnerAccounts(p.id);
    const seen = new Map();
    for (const a of pocketed) {
      for (const r of L.legsFor(ctx.getState().ledger, a)) {
        if (!seen.has(r.at)) seen.set(r.at, []);
        seen.get(r.at).push(r);
      }
    }
    const both = [...seen.values()].filter(g => g.length === 2
      && (g[0].delta | 0) === -(g[1].delta | 0));
    say(both.length > 0, 'this job moved money between two of his own pockets',
        `${both.length} such entr${both.length === 1 ? 'y' : 'ies'}`);
    const net = both.reduce((n, g) => n + (g[0].delta | 0) + (g[1].delta | 0), 0);
    eq(net, 0, 'and a move between his own pockets nets to nothing — one line, not two');
  }


  const fin = orderOf(o.id);
  eq(escrowOf(o.id), 0, 'ESCROW LANDS AT ZERO');
  const paidHim = L.balanceOf(ctx.getState().ledger, L.acct.partner(p.id))
                + L.balanceOf(ctx.getState().ledger, L.acct.holdback(p.id));
  say(paidHim >= fin.deal, 'he is paid at least his whole quote — "you keep 100%"',
      `${M.fmt(paidHim)} against a quote of ${M.fmt(fin.deal)}`);
}

/* ═══ 3 · the pro cancels after starting ════════════════════
   The honest route has to cost less than vanishing, or nobody takes it. */
async function workerCancels() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer' && u.key !== p.userKey);
  /* a real customer always has a door: the engine refuses a booking without one */
  ctx.saveSession({ ...cust, address: '4-1-22, Beside the water tank' });

  const o = await F.bookService({ catId: p.cat, partner: p, sub: null, deal: p.ask, slot: 'now' });
  if (!o) { say(false, 'a job can be booked'); return; }
  F.advance(o.id, 'ASSIGNED', {}); F.advance(o.id, 'EN_ROUTE', {}); F.advance(o.id, 'ARRIVED', {});
  F.verifyOtp(o.id, String(cust.code || o.otp));
  book('the stake locking');
  const her0 = L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key));

  await F.workerCancel(o.id, 'found the wrong fault');
  book('the cancellation');
  const fin = orderOf(o.id);
  eq(fin.stage, 'CANCELLED', 'he can cancel from IN_PROGRESS at all');
  eq(fin.cancelRule, 'WORKER_CANCEL', 'and it is a cancellation, not a no-show');
  eq(L.balanceOf(ctx.getState().ledger, L.acct.customer(cust.key)) - her0, o.customerPays,
     'she is refunded every paisa she paid');
  say(!(fin.stake && fin.stake.forfeited), 'his stake is NOT forfeited — the sheet promises this');
  say(!!(fin.stake && fin.stake.returned), 'it is returned');
  eq(escrowOf(o.id), 0, 'ESCROW LANDS AT ZERO');
  say((ctx.getState().partners.find(x => x.id === p.id).workerCancels | 0) > 0,
      'and it is recorded against him');

  /* THE ONE CHARGE SAAHAA LEVIES AGAINST A PRO WAS THE ONE IT COULD NOT SHOW
     HIM. With an empty wallet the ₹40 lived in a mutable `walletDebt` field and
     in no ledger entry at all — in a product whose pitch to a tradesperson is a
     book that "can be verified, never edited". Whatever he is told he owes, the
     book has to say the same. */
  const owed = ctx.getState().partners.find(x => x.id === p.id).walletDebt | 0;
  const onBook = Math.max(0, -L.balanceOf(ctx.getState().ledger, L.acct.debt(p.id)));
  eq(onBook, owed, 'what he is told he owes is what the ledger says he owes');
  say(owed === 0 || onBook > 0, 'and a debt he was charged exists as an entry',
      `field says ${M.fmt(owed)}, book says ${M.fmt(onBook)}`);

  /* AND HIS PASSBOOK MUST BE ABLE TO SHOW ALL OF IT. The screen reads the
     pockets named by `partnerAccounts`. If the engine ever posts him a leg on
     an account outside that list, the charge is real, the book balances, and
     the one man it was taken from cannot find it -- which is the exact defect
     an audit scored 5/10 for. Nothing carrying his id may fall outside. */
  const covered = new Set(L.partnerAccounts(p.id));
  const seen = new Set();
  for (const e of ctx.getState().ledger || []) {
    /* the book has used two shapes; reading only `e.legs` made this assertion
       inert -- it passed with DEBT deliberately removed from the list */
    const accounts = e.legs ? e.legs.map(l => l.account) : [e.partyA, e.partyB];
    for (const a of accounts) if (a && String(a).includes(p.id)) seen.add(a);
  }
  const missed = [...seen].filter(a => !covered.has(a));
  /* AND THE FOOTER MUST DECOMPOSE THE COLUMN IT SITS UNDER. It read "add up to
     ₹236.00 — ₹234.00 in your wallet and ₹42.00 held back": 234 + 42 = 276. The
     column covers four pockets and the sentence named two, so it stopped adding
     up the moment a stake locked or a debt was carried — on the screen whose
     whole claim is "to the paisa". */
  {
    const pockets = L.partnerAccounts(p.id)
      .reduce((n, a) => n + L.balanceOf(ctx.getState().ledger, a), 0);
    const column = L.partnerAccounts(p.id)
      .flatMap(a => L.legsFor(ctx.getState().ledger, a))
      .reduce((n, r) => n + (r.delta | 0), 0);
    eq(column, pockets, 'the passbook column equals the pockets the footer names');

    /* THE WALLET'S "OWED" AND THE PASSBOOK'S DEBT LINE ARE ONE FACT. The wallet
       read the mutable `walletDebt` field and the passbook read the DEBT
       account, so a pro saw the ₹40 subtracted in his column AND flagged as
       still owed above it, then took a payout with nothing deducted. Taken, or
       still coming? Neither screen could be checked against the other. */
    const shown = W.walletOf(ctx.getState().ledger, p.id,
      ctx.getState().partners.find(x => x.id === p.id) || {}).debt | 0;
    const onBook = Math.max(0, -L.balanceOf(ctx.getState().ledger, L.acct.debt(p.id)));
    eq(shown, onBook, 'what the wallet says he owes is what the book says he owes');
    /* and it has teeth only while this journey actually carries one: if a later
       change stops POSTING the debt, both sides go quietly to zero and the
       charge he was warned about becomes invisible everywhere at once. */
    /* AND THE GOVERNMENT'S SHARE MUST NOT DEPEND ON WHETHER HE HAD MONEY. The
     same ₹40 under the same rule was booked fee-plus-GST from a funded wallet
     and flat, untaxed, when it became a debt. */
  {
    const gstLegs = L.legsFor(ctx.getState().ledger, L.acct.gst())
      .filter(r => (r.meta && r.meta.onCredit) && r.delta > 0);
    say(gstLegs.length > 0, 'a fee carried as debt is split for GST like a paid one');
  }
  say(onBook > 0, 'this journey really does leave him owing something',
        `owed ${M.fmt(onBook)}`);
  }

  say(missed.length === 0, 'every account holding his money is one his passbook reads',
      missed.join(', '));
}

/* ═══ 4 · she cancels once he is on the way ═════════════════
   SAAHAA's own share of a cancellation was computed, printed on the sheet, and
   posted NOWHERE — it sat in the escrow of a CANCELLED order for ever, and the
   book still summed to zero because the money was merely in the wrong place. */
async function customerCancelsEnRoute() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer' && u.key !== p.userKey);
  /* a real customer always has a door: the engine refuses a booking without one */
  ctx.saveSession({ ...cust, address: '4-1-22, Beside the water tank' });

  const o = await F.bookService({ catId: p.cat, partner: p, sub: null, deal: p.ask, slot: 'now' });
  if (!o) { say(false, 'a job can be booked'); return; }
  F.advance(o.id, 'ASSIGNED', {}); F.advance(o.id, 'EN_ROUTE', {});
  book('travel');

  const split = P.cancelSplit(o.deal, 'EN_ROUTE');
  say(split.platform > 0, 'this rule keeps a share, or the test proves nothing');
  const fee0 = L.balanceOf(ctx.getState().ledger, L.acct.fee());
  const gst0 = L.balanceOf(ctx.getState().ledger, L.acct.gst());

  await F.cancelOrder(o.id, 'EN_ROUTE');
  book('the cancellation');

  eq(orderOf(o.id).stage, 'CANCELLED', 'the order is cancelled');
  eq(escrowOf(o.id), 0, 'ESCROW LANDS AT ZERO — the platform share is not stranded');
  const feeGot = L.balanceOf(ctx.getState().ledger, L.acct.fee()) - fee0;
  const gstGot = L.balanceOf(ctx.getState().ledger, L.acct.gst()) - gst0;
  eq(feeGot + gstGot, split.platform, 'SAAHAA actually receives what the sheet told her it keeps');
  say(gstGot > 0, 'and the government gets its share of it — every other path splits GST',
      `fee ${M.fmt(feeGot)}, gst ${M.fmt(gstGot)}`);

  /* WHAT THE BOOK PAYS HIM, THE ORDER RECORDS. `split.worker` was posted as
     COMPENSATION and written nowhere on the order, so his own job screen -- which
     reads the order -- told him "You were not paid for it" while his passbook
     showed the payment for that very job and her cancel sheet had already said
     he keeps it. An audit listed the contradiction second among the reasons it
     would not trust the platform with a livelihood. */
  const fin = orderOf(o.id);
  eq(fin.workerKept | 0, split.worker | 0, 'the order records the journey money he was paid');
  const paid = L.legsFor(ctx.getState().ledger, L.acct.partner(p.id))
    .filter(r => r.kind === 'COMPENSATION').reduce((n, r) => n + r.delta, 0);
  eq(fin.workerKept | 0, paid, 'and it is exactly what the ledger moved to him');
  /* the same for SAAHAA's own share: both bills printed the ORIGINAL 8% fee on
     a cancelled job while the ledger had taken far more, and the pro's app
     named the real figure nowhere. */
  eq(fin.platformKept | 0, split.platform | 0, 'the order records what SAAHAA kept');
  eq(fin.platformKept | 0, feeGot + gstGot, 'and that is what the ledger actually took');
}

/* ═══ 5 · a job that can only be priced on the doorstep ═════
   21 sub-services are marked `survey: true`, and the booking sheet promises in
   bold that nothing starts until she approves his number. For eight versions
   there was no screen on which he could give one. */
async function pricedOnSite() {
  await freshWorld();
  const st = ctx.getState();
  const registry = await import(U('src/core/registry.js'));
  const cat = await import(U('src/domain/catalog.services.js'));
  let found = null;
  for (const c of registry.all('category')) {
    for (const sub of (c.subs || [])) {
      const size = cat.subSize(c.id, sub);
      const p = size && size.survey && st.partners.find(x => x.cat === c.id);
      if (p) { found = { catId: c.id, sub, p }; break; }
    }
    if (found) break;
  }
  if (!found) { say(false, 'the catalogue has a survey-priced sub with a pro in that trade'); return; }
  const cust = st.users.find(u => u.role === 'customer' && u.key !== found.p.userKey);
  /* a real customer always has a door: the engine refuses a booking without one */
  ctx.saveSession({ ...cust, address: '4-1-22, Beside the water tank' });

  const o = await F.bookService({ catId: found.catId, partner: found.p, sub: found.sub, slot: 'now' });
  if (!o) { say(false, 'the survey job can be booked'); return; }
  book('booking');
  eq(o.pricedOnSite, true, 'the order knows it has to be priced on site');

  F.advance(o.id, 'ASSIGNED', {}); F.advance(o.id, 'EN_ROUTE', {}); F.advance(o.id, 'ARRIVED', {});
  say(F.verifyOtp(o.id, String(cust.code || o.otp)) === false,
      'the door code CANNOT start an unpriced survey job — the promise is enforced');
  say(F.proposeOnSitePrice(o.id, o.deal * (F.ON_SITE_MAX_MULTIPLE + 1)) === null,
      'and a quote above the ceiling is refused, not negotiated at the doorstep');

  /* THE OTHER CEILING, THE ONE SHE IS RELYING ON. `trust.capOk` existed and was
     called from nowhere: a pro three jobs old is told twice -- on the recruiting
     page and on the go-live screen -- that his first jobs are capped, and an
     audit priced a doorstep job at ₹3,000 against a ₹1,500 cap and watched it
     go through. A limit that is advertised and not enforced is worse than no
     limit, because she believes it. */
  const pro0 = ctx.getState().partners.find(x => x.id === o.partnerId);
  if (T.isProvisional(pro0)) {
    say(F.proposeOnSitePrice(o.id, T.effectiveCap(pro0) + 100000) === null,
        'a provisional pro cannot price above the cap the customer was promised');
  } else {
    say(true, 'this pro is past the provisional cap (nothing to assert here)');
  }

  /* AND THE CAP HAS TO BITE WHERE THE JOB IS ACCEPTED, not only where it is
     later repriced. It was wired into the on-site path alone, so a pro one
     clean job old was booked straight through at ₹1,760 against a ₹1,500 cap
     printed on three separate screens. */
  /* the seed has none — every demo pro has hundreds of jobs behind them — so
     this MAKES one rather than hoping to find one. The first version looked for
     a provisional pro, found nothing, took the "nothing to assert" branch and
     passed with the cap switched off. A test that cannot fail is not a test. */
  const base = ctx.getState().partners[0];
  const rookie = { ...base, id: base.id + '_rookie', name: 'Brand New Pro',
    tier: 2, countedJobs: 0, completed: 0, verification: { upi: 'rookie@okaxis' } };
  ctx.ctx.store.dispatch({ type: 'partner/add', payload: rookie });
  say(T.isProvisional(rookie), 'a pro with no jobs behind him is provisional');
  let refused = false;
  try {
    await F.bookService({ catId: rookie.cat, partner: rookie, sub: null,
      deal: T.effectiveCap(rookie) + 100000 });
  } catch (e) { refused = true; }
  say(refused, 'a provisional pro cannot be BOOKED above his cap either',
      `cap ${M.fmt(T.effectiveCap(rookie))}`);
  const under = await F.bookService({ catId: rookie.cat, partner: rookie, sub: null,
    deal: Math.round(T.effectiveCap(rookie) / 2) });
  say(!!under, 'and a job inside the cap still goes through');

  const want = Math.round(o.deal * 1.4);
  say(!!F.proposeOnSitePrice(o.id, want), 'an honest quote goes to her for approval');
  book('the quote');
  eq(orderOf(o.id).stage, 'AWAITING_APPROVAL', 'and nothing starts while she decides');

  const held = escrowOf(o.id);
  await F.approveOnSitePrice(o.id);
  book('her approval');
  const after = orderOf(o.id);
  eq(after.stage, 'ARRIVED', 'approving a price is not starting the work');
  eq(after.deal, want, 'the job is now priced at what he quoted');
  eq(escrowOf(o.id), after.customerPays, 'escrow holds exactly the agreed total');
  say(escrowOf(o.id) > held, 'and the difference was actually collected',
      `${M.fmt(held)} → ${M.fmt(escrowOf(o.id))}`);
  say(F.verifyOtp(o.id, String(cust.code || o.otp)), 'only now does the code start the work');
  eq(orderOf(o.id).stage, 'IN_PROGRESS', 'the work begins at an agreed price');
}

/* ── run ──────────────────────────────────────────────────── */

/* ═══ 6 · the ask · a pro quotes under his own held price ════
   NO JOURNEY EVER TOUCHED THE AUCTION, and three defects lived there at once:
   the platform offered a price under a pro's name, booked that instead of the
   quote he actually wrote, and then recorded the job he won as "Lost". Every
   gate passed the whole time, because every gate was looking at settlement. */
async function askUndercut() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer' && u.key !== p.userKey);
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });

  /* SAAHAA's computed match, printed under his name, ₹50 above his own rate */
  const heldAmount = (p.ask | 0) + 5000;
  const req = A.postRequest({
    catId: p.cat, slotType: 'now',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount },
  });
  say(!!req, 'the ask is open');
  if (!req) return;

  /* ...and then the same pro answers it, cheaper than SAAHAA quoted for him */
  const bid = A.placeBid({ requestId: req.id, partner: p, amount: (p.ask | 0), quiet: true });
  say(!!bid, 'his own quote is on the request');
  /* AND HE MUST BE ABLE TO SEE THAT HE SENT IT. The open-leads list drops a
     request once he bids, by design, and nothing picked it up — so the quote
     was visible nowhere in his own app and he could not tell he had bid. */
  say(A.sentQuotesFor(p).some(x => x.bid.id === bid.id),
      'and he can see he has quoted on it');

  const o = await A.bookHeld(req.id);
  say(!!o, 'she can book her held match');
  if (!o) return;
  book('booking the held match');

  /* the three assertions that would have caught the audit's worst finding */
  eq(o.deal, p.ask | 0, 'she is booked at HIS quote, not the one SAAHAA wrote for him');
  say(o.deal <= heldAmount, 'and never above the price she was promised');
  eq(escrowOf(o.id), o.customerPays, 'escrow holds the whole customer price');

  const mine = A.bidsFor(req.id).find(b => b.partnerId === p.id);
  say(!!mine && mine.status !== 'rejected',
    'the bid that won is not recorded as lost', mine && ('status ' + mine.status));
}


/* ═══ 7 · the comparison printed beside the bill ═════════════
   "You pay ₹836" and, four lines down, "a typical app would charge ₹1,151 ·
   YOU SAVE ₹299". 1,151 − 299 = 852, not 836.

   `compareWithApps` re-quoted the job at the DEFAULT markup while the bill
   beside it used the PARTNER's -- 6% for a tier-4 pro instead of 8% -- so the
   three numbers only reconciled for pros on the standard rate. It is the fifth
   instance this version of one rule: a figure describing the relationship
   between two numbers on a screen must be derived from those numbers. */
async function comparisonAddsUp() {
  await freshWorld();
  const st = ctx.getState();
  const tier4 = st.partners.find(x => (x.tier | 0) >= 4);
  const plain = st.partners.find(x => (x.tier | 0) < 4);
  say(!!tier4 && !!plain, 'the roster has a rebated pro and a standard one, or this proves nothing');
  if (!tier4 || !plain) return;

  for (const [who, p0] of [['standard', plain], ['tier-4', tier4]]) {
    const markup = T.markupFor(p0);
    const q = P.quoteService(p0.ask, { markup });
    const cmp = P.compareWithApps(p0.ask, { markup });
    eq(cmp.youPay, q.customerPays, `the ${who} pro's comparison prices the same bill she is shown`);
    eq(cmp.typicalApp - cmp.saved, q.customerPays,
       `and typical minus saved lands exactly on what she pays (${who})`);
  }
}

/* ═══ 10 · what he signs says what it costs ═════════════════
   The two terms that take money from a pro said "a tenth of each payout" and
   "a fee is taken from my wallet" -- no figures. He met ₹100, ₹40 and 10%/7
   days for the first time on a door screen, a cancel sheet and an Earnings tab,
   all AFTER he had given his ID, his selfie, two quizzes and his UPI. An audit
   called it the single most misleading thing in the funnel. */
async function termsSayTheCost() {
  await freshWorld();
  const V = await import(U('src/domain/verification.js'));
  const W = await import(U('src/domain/wallet.js'));
  const P = await import(U('src/domain/pricing.js'));
  const Lg = await import(U('src/domain/ledger.js'));
  const fee = (P.CANCEL_RULES.WORKER_CANCEL || {}).workerFee | 0;
  for (const lang of ['en', 'hi', 'te']) {
    const terms = V.termsFor(lang).join(' // ');
    say(!/\{(pct|days|stake|fee)\}/.test(terms),
        `the ${lang} terms have no unfilled placeholders left in them`);
    say(terms.includes(M.fmt(W.MIN_STAKE)), `the ${lang} terms name the stake in rupees`,
        M.fmt(W.MIN_STAKE));
    say(terms.includes(M.fmt(fee)), `the ${lang} terms name the cancellation fee in rupees`,
        M.fmt(fee));
    say(terms.includes(String(Lg.HOLDBACK_PCT)) && terms.includes(String(Lg.HOLDBACK_DAYS)),
        `the ${lang} terms name the holdback and its window`);
  }
}

/* ═══ 11 · asking several pros prices the JOB, not the trade ═
   The ask dropped the sub-service: `startAsk` never passed one, and `priceBand`
   never used one. So every auction went out against the bare category base. An
   audit booked a plumber directly for a blocked drain at ₹416, asked nine pros
   ten minutes later, and was quoted ₹551 by THE SAME MAN for THE SAME JOB —
   labelled "Best pick · ₹28 less than held", in the feature sold to her as the
   cheaper way. She would have paid a third more for using it. */
async function askPricesTheJob() {
  await freshWorld();
  const B = await import(U('src/domain/bidding.js'));
  const C = await import(U('src/domain/catalog.services.js'));
  const st = ctx.getState();
  const cat = st.partners[0] && st.partners[0].cat;
  const R = await import(U('src/core/registry.js'));
  const subs = ((R.find('category', cat) || {}).subs) || [];
  const cheap = subs.map(n => ({ n, x: (C.subSize(cat, n) || {}).x || 1 }))
    .sort((a, b) => a.x - b.x)[0];
  if (!cheap || cheap.x >= 1) { say(false, 'the catalogue has a sub-job cheaper than its category base'); return; }

  const bare = B.priceBand(cat, {});
  const forJob = B.priceBand(cat, { sub: cheap.n });
  say(!!bare && !!forJob, 'both bands are priced');
  if (!bare || !forJob) return;
  say(forJob.target < bare.target,
      'a cheaper sub-job asks for a cheaper price than the whole trade',
      `${cheap.n} (x${cheap.x}) targets ${M.fmt(forJob.target)} vs ${M.fmt(bare.target)}`);
  eq(forJob.target, Math.round(bare.target * cheap.x),
     'and it is exactly the sub-job multiplier the booking sheet uses');
}

/* ═══ 12 · every pro who can do the job is reachable ═══════
   `lockedMatch` returned the hero plus FIVE alternates and dropped the rest, so
   six of eleven plumbers existed as far as a customer was concerned — no count,
   no "and 5 more", no way through. For a pro who has just joined, with no
   ratings and no jobs to rank on, that is the difference between having a
   livelihood here and not, and nothing in onboarding hints at it. */
async function everyProIsReachable() {
  await freshWorld();
  const st = ctx.getState();
  const cat = (st.partners[0] || {}).cat;
  const able = st.partners.filter(p => p.cat === cat && p.active !== false);
  say(able.length > 6, 'this trade has more pros than one screenful — otherwise this proves nothing',
      `${able.length} in ${cat}`);
  const m = F.findMatch(cat, { area: (st.users.find(u => u.role === 'customer') || {}).area });
  const reachable = [m.hero, ...m.alternates].filter(Boolean).length;
  say(reachable > 6, 'the match hands the screen everybody, not the first six',
      `${reachable} reachable of ${able.length}`);
}

/* ═══ 8 · the ask · she accepts after the window shuts ═══════
   A PRO WATCHED A CUSTOMER ACCEPT HIS QUOTE AND NO JOB EXISTED AFTERWARDS.
   The held pro's card is built as a literal object and carried no bid id, so
   the rule that says "accept the price printed on this card" could never fire:
   the button kept the held-booking action under his LOWER number, and once the
   sealed window closed that action refused with "This request is closed.
   Nothing was charged." No order, no award, and nothing in either app saying
   so. He had lost the work and could not find out why.

   Journey 6 books while the window is still open, which is why it passed
   throughout. This is the same accept, one minute later. */
async function askAcceptAfterClose() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });

  const heldAmount = Math.round((p.ask | 0) * 1.3);
  const req = A.postRequest({
    catId: p.cat, sub: null, complexity: 'simple',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount },
  });
  if (!req) { say(false, 'the ask is open'); return; }

  /* under what she is holding, but inside the band and not above his own
     shelf price — both of those are real rules and a test must respect them */
  const under = Math.max(req.floor | 0, Math.min(p.ask | 0, heldAmount - 5000));
  const bid = A.placeBid({ requestId: req.id, partner: p, amount: under, quiet: true });
  say(!!bid, 'he quotes UNDER the price she is holding', `${M.fmt(under)} vs ${M.fmt(heldAmount)}`);
  if (!bid) return;

  /* AND A PRO MUST BE ABLE TO ASK HIS OWN PRICE. The band is category-wide, so
     a plumber listing a rate above it was capped BELOW his own storefront —
     ₹450 on a job his public page sells at ₹630 — by the same screen that had
     just told him his rate is his. The band guides; it does not overrule what
     he already advertises. */
  {
    const rich = { ...p, id: p.id + '_rich', ask: Math.round((p.ask | 0) * 2.5) };
    ctx.ctx.store.dispatch({ type: 'partner/add', payload: rich });
    const own = Math.round((rich.ask | 0) * ((CATSVC.subSize(req.catId, req.sub) || {}).x || 1));
    say(own > (req.ceiling | 0), 'his listed rate really is above the band ceiling',
        `${M.fmt(own)} vs ceiling ${M.fmt(req.ceiling)}`);
    const r2 = A.postRequest({ catId: p.cat, sub: req.sub, complexity: 'simple',
      held: { partnerId: rich.id, partnerName: rich.name, amount: own } });
    const hisBid = r2 && A.placeBid({ requestId: r2.id, partner: rich, amount: own, quiet: true });
    say(!!hisBid, 'and he can quote it');
  }
  if (!bid) return;

  /* the sealed window shuts before she picks — the state the defect needed */
  ctx.ctx.store.dispatch({ type: 'request/patch',
    payload: { id: req.id, patch: { closesAt: Date.now() - 1000 } } });
  A.closeIfDue(req.id);
  say(A.requestById(req.id).status !== 'bidding', 'the window has shut');

  const o = await A.acceptBid(req.id, bid.id);
  say(!!o, 'ACCEPTING HIS QUOTE CREATES A JOB — it silently created nothing');
  if (!o) return;
  book('the acceptance');

  eq(o.deal, under, 'and the job is at the price on his card, not the one she was holding');
  eq(A.requestById(req.id).awardedBidId, bid.id, 'the request records which bid won');
  eq(escrowOf(o.id), o.customerPays, 'escrow holds the whole customer price');
  const mine = A.bidsFor(req.id).find(b => b.id === bid.id);
  eq(mine && mine.status, 'accepted', 'and his own bid reads as accepted, not lost');
}

/* == 9 · the debt the next payout is promised to clear ========
   HIS SCREEN SAID THE ₹40 WAS TAKEN AND, TWICE, THAT IT WAS STILL COMING OUT
   OF HIS NEXT PAYOUT. He took a payout and nothing came out of it. The wallet
   had been corrected to read the DEBT account while the recovery still read the
   mutable `walletDebt` field, so the two could disagree about whether anything
   was owed at all -- and when they did, the recovery the screen promised never
   ran, with no error anywhere.

   This walks it: he cancels a started job with an empty wallet (so the fee is
   carried as debt, not deducted), then completes another job and is paid. */
async function debtRecovered() {
  await freshWorld();
  const st = ctx.getState();
  const cust = st.users.find(u => u.role === 'customer');
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];

  const o1 = await F.bookService({ catId: p.cat, partner: p, sub: null });
  if (!o1) { say(false, 'a job can be booked'); return; }
  F.advance(o1.id, 'ASSIGNED', {}); F.advance(o1.id, 'EN_ROUTE', {});
  F.advance(o1.id, 'ARRIVED', {});
  F.verifyOtp(o1.id, String(cust.code || o1.otp));
  await F.cancelOrder(o1.id, 'WORKER_CANCEL');
  book('his cancellation');

  const owed = Math.max(0, -L.balanceOf(ctx.getState().ledger, L.acct.debt(p.id)));
  say(owed > 0, 'walking out of a started job leaves him owing something',
      `owed ${M.fmt(owed)}`);
  if (!owed) return;

  /* now he earns. The screen promises this payout clears the debt. */
  const o2 = await F.bookService({ catId: p.cat, partner: p, sub: null });
  if (!o2) { say(false, 'a second job can be booked'); return; }
  F.advance(o2.id, 'ASSIGNED', {}); F.advance(o2.id, 'EN_ROUTE', {});
  F.advance(o2.id, 'ARRIVED', {});
  F.verifyOtp(o2.id, String(cust.code || o2.otp));
  F.advance(o2.id, 'WORK_DONE', {});
  await F.confirmAndRelease(o2.id, 1);
  book('the payout that was promised to clear it');

  const after = Math.max(0, -L.balanceOf(ctx.getState().ledger, L.acct.debt(p.id)));
  say(after < owed, 'THE NEXT PAYOUT ACTUALLY CLEARS IT — the screen promised and nothing happened',
      `${M.fmt(owed)} -> ${M.fmt(after)}`);
  const shown = W.walletOf(ctx.getState().ledger, p.id,
    ctx.getState().partners.find(x => x.id === p.id) || {}).debt | 0;
  eq(shown, after, 'and the wallet says what the book says, before and after');
}

/* == 10 · a booking that refuses must leave the ask answerable =====
   THE REQUEST WAS TORN DOWN BEFORE THE JOB WAS BUILT. Both accept paths
   rejected every rival bid and closed the request, and THEN called a booking
   that can refuse -- for a missing address, a cap, a self-booking. When it
   refused, the customer was left on "This request is closed. Nothing was
   charged." with no way back, no order existed, and the winning pro's console
   went on saying "waiting on the customer" about a request that could never be
   answered again. He would have sat on that lead all day.

   Nothing may be torn down until there is something to show for it. */
async function bookingRefusedLeavesAskAlive() {
  await freshWorld();
  const st = ctx.getState();
  const p = st.partners.find(x => (x.tier | 0) >= 2) || st.partners[0];
  const cust = st.users.find(u => u.role === 'customer');

  /* signed in with NO address — the guard that fires in real life */
  ctx.saveSession({ ...cust, address: '', landmark: '' });

  const heldAmount = Math.round((p.ask | 0) * 1.3);
  const req = A.postRequest({ catId: p.cat, sub: null, complexity: 'simple',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount } });
  if (!req) { say(false, 'the ask is open'); return; }

  const under = Math.max(req.floor | 0, Math.min(p.ask | 0, heldAmount - 5000));
  const bid = A.placeBid({ requestId: req.id, partner: p, amount: under, quiet: true });
  say(!!bid, 'a rate is in');
  if (!bid) return;

  let order = null;
  try { order = await A.bookHeld(req.id); } catch (e) { order = null; }
  say(!order, 'the booking refuses without an address, as it should');

  const after = A.requestById(req.id);
  eq(after.status, 'bidding', 'AND THE ASK SURVIVES IT — it was being closed on a failure');
  eq(after.awardedBidId || null, null, 'nothing was awarded');
  const stillOpen = A.bidsFor(req.id).filter(b => b.status === 'submitted').length;
  say(stillOpen > 0, 'his rate is still live, not rejected against a job that never existed',
      `${stillOpen} still submitted`);

  /* and once she gives an address, the same tap works */
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam, Road No 4' });
  const ok = await A.bookHeld(req.id);
  say(!!ok, 'and it books the moment she fixes what was wrong');
}

/* == 11 · a refresh may not delete a real person's account ========
   SHE RELOADED THE PAGE WITHOUT THE QUERY STRING AND LOST EVERYTHING: her
   account, her orders, her ledger and an open complaint, under a toast that
   said only "Example data removed". The purge is all-or-nothing because an
   order pointing at an example partner cannot dangle -- and app.js has carried
   a comment for versions saying this means a hand-made account "goes with the
   roster, which is baffling if nobody says so". Nobody said so.
   Data loss is not a tidy-up. */
async function refreshKeepsARealAccount() {
  await freshWorld();
  const st = ctx.getState();
  const demoOnly = FRESH.purgeIfDemoResidue(st, false, { commit: false });
  say(demoOnly !== st, 'a device with only the example roster is still cleaned');

  /* now somebody signs up on it */
  ctx.ctx.store.dispatch({ type: 'user/add', payload:
    { key: 'C20260009', code: 'C20260009', role: 'customer', name: 'A real person' } });
  const withHer = ctx.getState();
  const after = FRESH.purgeIfDemoResidue(withHer, false, { commit: false });
  say(after === withHer, 'BUT A DEVICE WITH A REAL ACCOUNT IS LEFT ALONE — it was wiping her');
  say((after.users || []).some(u => u.key === 'C20260009'), 'and she is still there');
}

/* == 12 · a stale screen may not erase what he has done =========
   HE FINISHED ALL SEVEN STEPS, WAS TOLD "YOU ARE LIVE", AND WATCHED FOUR OF
   THEM VANISH. `patchVerification` rebuilt the whole verification record from
   the partner object HANDED IN -- and a view holds the partner it captured when
   it rendered. A handler firing against that stale copy wrote an old record
   back over the new one: trade, conduct, payout and agreement gone, account
   stuck on "verification pending", his UPI with it, and recovery meaning a
   re-sit of a quiz that locks for 24 hours after three wrong answers.

   A write built on current state can lose only the field it is setting. */
async function staleScreenCannotEraseVerification() {
  await freshWorld();
  const st = ctx.getState();
  const p0 = st.partners[0];
  if (!p0) { say(false, 'the roster has a partner'); return; }

  /* what a view captured several steps ago */
  const stale = JSON.parse(JSON.stringify(p0));

  VER.submitPayout(p0, 'someone@okaxis');
  const before = Object.keys(((ctx.getState().partners.find(x => x.id === p0.id) || {}).verification || {}).steps || {});
  say(before.length >= 1, 'he has completed a step', before.join(', ') || '(none)');

  /* a handler fires holding the OLD object — the exact shape that wiped him */
  VER.submitSelfie(stale, 'photo-id-1');

  const after = Object.keys(((ctx.getState().partners.find(x => x.id === p0.id) || {}).verification || {}).steps || {});
  before.forEach(k => say(after.includes(k),
    `HE KEEPS the step "${k}" a stale screen would have erased`));
  say(after.includes('selfie'), 'and the step that stale screen was setting is saved');
}

const JOURNEYS = [
  ['groceries · a basket weighed short keeps its free delivery', retailShortWeigh],
  ['groceries · a basket weighed HEAVY is the shop’s gift, not her bill', retailOverWeigh],
  ['groceries · one bad item comes back, the rest of the shopping stays',      retailPartialReturn],
  ['a job · booked, coded, done, settled',                       serviceDone],
  ['a job · the pro cancels after starting',                     workerCancels],
  ['a job · she cancels once he is on the way',                  customerCancelsEnRoute],
  ['a job · priced on the doorstep, approved before it starts',  pricedOnSite],
  ['the ask · a pro quotes under the price SAAHAA wrote for him', askUndercut],
  ['the ask · she accepts after the window shuts', askAcceptAfterClose],
  ['the debt his next payout is promised to clear', debtRecovered],
  ['a booking that refuses leaves the ask answerable', bookingRefusedLeavesAskAlive],
  ['a refresh keeps a real account', refreshKeepsARealAccount],
  ['a stale screen cannot erase his verification', staleScreenCannotEraseVerification],
  ['the comparison beside the bill adds up, at every tier',       comparisonAddsUp],
  ['what a pro signs says what it will cost him',                 termsSayTheCost],
  ['asking several pros prices the JOB, not the whole trade',     askPricesTheJob],
  ['every pro who can do the job is reachable',                   everyProIsReachable],
];

for (const [name, run] of JOURNEYS) {
  const before = failed;
  try { await run(); }
  catch (e) { failed++; notes.push('      x ' + name + ' THREW\n          ' + e.message); }
  console.log((failed === before ? '  ok   ' : '  x    ') + name);
  if (notes.length) { console.log(notes.join('\n')); notes.length = 0; }
}

console.log(`  journeys: ${JOURNEYS.length} run, ${books} book checks, ${checks} assertions, ${failed} failure(s)`);
if (failed) {
  console.log('\n    Money moved somewhere it should not have. A unit test cannot see this;');
  console.log('    that is why five generations of one bug shipped past four audits.');
  process.exit(1);
}
console.log('  ok every rupee arrived where it was meant to, and escrow ended at zero');
