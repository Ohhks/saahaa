/* SAAHAA · app.js — bootstrap and router. This is the ONLY file that knows
   about every other module, and it does nothing but wire them together. */

import { VERSION, SCHEMA_VERSION, BUILD_ID } from './core/version.js';
import { ctx, getState, dispatch, me, restoreSession, myArea } from './core/ctx.js';
import { createStore, combineFromRegistry } from './core/store.js';
import * as persist from './core/persist.js';
import * as registry from './core/registry.js';
import * as flags from './core/flags.js';
import * as audit from './core/audit.js';
import * as adminauth from './core/adminauth.js';
import { runMigrations } from './core/migrate.js';
import { checkHealth } from './core/health.js';
import * as selftest from './core/selftest.js';
import { deviceId } from './core/id.js';

/* domain — importing a catalog file IS registering it (open/closed) */
import './domain/catalog.services.js';
import './domain/catalog.retail.js';
import './domain/state.js';
import './core/migrations.js';
import { defaultState } from './domain/state.js';
import { buildSeed } from './domain/seed.js';
import * as flow from './domain/flow.js';
import * as auction from './domain/auction.js';
import * as bidding from './domain/bidding.js';
import { AREA_NAMES } from './domain/match.js';
import './core/selftests.js';
import './core/selftests.money.js';

/* ui */
import { mount, action, initActions, toast, sheet, closeSheet, esc } from './ui/dom.js';
import { defs, mark } from './ui/logo.js';
import { icon } from './ui/icons.js';
import { showSplash, replaySplash } from './ui/splash.js';
import * as home from './ui/views/home.js';
import * as shops from './ui/views/shops.js';
import * as ordersView from './ui/views/orders.js';
import * as auth from './ui/views/auth.js';
import * as partner from './ui/views/partner.js';
import * as admin from './ui/views/admin.js';
import * as earn from './ui/views/earn.js';
import * as ask from './ui/views/ask.js';
import * as onboard from './ui/views/onboard.js';
import * as pro from './ui/views/pro.js';
import * as account from './ui/views/account.js';

/* ══════════════ ROUTES ══════════════ */
const ROUTES = {
  home:      () => home.render(),
  shops:     p => shops.renderList(p),
  shop:      p => shops.renderShop(p),
  cart:      () => shops.renderCart(),
  orders:    () => ordersView.renderList(),
  order:     p => ordersView.renderDetail(p),
  auth:      () => auth.render(),
  partner:   () => partner.renderPartner(),
  shopadmin: () => partner.renderShopAdmin(),
  admin:     () => admin.render(),
  earn:      () => earn.render(),
  ask:       p => ask.render(p),
  onboard:   () => onboard.render(),
  pro:       p => pro.render(p),
  account:   () => account.render(),
};

const NAV = [
  ['home',    'navHome',   'Home'],
  ['shops',   'navShops',  'Shops'],   // a shopfront, not a cart: 🛒 means "my basket"
  ['orders',  'navOrders', 'Orders'],
  ['earn',    'navEarn',   'Earn'],    // a rupee coin, not 💰 which reads "my wallet"
  ['account', 'navYou',    'You'],
];

let history = [];
/* one confirmation per bid, not per tap — the guard rail must not become friction */
const confirmedLowRated = new Set();
/* set by go() so the hashchange it triggers is recognised as our own echo */
let selfNav = false;

function go(view, param) {
  closeSheet();                       // a sheet must never outlive its screen
  // `param` arrives undefined from the nav bar while ctx.param is null, and
  // null !== undefined, so every re-tap of the current tab pushed a junk entry
  // and the back button needed five presses to leave Home.
  const next = param ?? null;
  if (ctx.view !== view || ctx.param !== next) history.push([ctx.view, ctx.param]);
  ctx.view = view; ctx.param = next;
  // go() has already done the work; the hashchange it is about to fire is an
  // echo, not a navigation. Without this the handler below re-closed any sheet
  // opened immediately after a go() — which silently ate the ask-rates receipt.
  const nextHash = view === 'admin' ? '#/admin' : param ? `#/${view}/${param}` : `#/${view}`;
  // only an ACTUAL hash change echoes; re-tapping the current tab must not
  // leave the flag armed to swallow the user's next Back
  selfNav = nextHash !== location.hash;
  location.hash = nextHash;
  window.scrollTo(0, 0);
  render();
}
function back() {
  const prev = history.pop();
  if (!prev) return go('home');
  ctx.view = prev[0]; ctx.param = prev[1];
  // the hash used to be left pointing at the screen we just left, so a refresh
  // (or any later hash navigation) snapped forward again
  location.hash = ctx.param ? `#/${ctx.view}/${ctx.param}` : `#/${ctx.view}`;
  render();
}

function render() {
  const view = ROUTES[ctx.view] || ROUTES.home;
  let body;
  try { body = view(ctx.param); }
  catch (err) {
    console.error('[render]', ctx.view, err);
    body = `<main class="wrap"><div class="card" style="margin-top:40px;border-color:var(--danger)">
      <b style="color:var(--danger)">This screen hit an error</b>
      <p class="tiny muted" style="margin-top:8px">${esc(err.message)}</p>
      <p class="micro muted" style="margin-top:6px">v${VERSION} · ${BUILD_ID} · ${esc(ctx.view)}</p>
      <button class="btn btn--secondary btn--block" style="margin-top:14px" data-act="nav.home">Back to home</button>
      </div></main>`;
  }
  const showNav = ctx.view !== 'admin' && ctx.view !== 'auth';
  /* THE SHELL. One visually connected ecosystem instead of a stack of screens:
     on desktop a persistent side navigation + a top bar, on tablet an icon
     rail, on mobile the bottom bar. All three are the same NAV array — the CSS
     decides which is visible, so no view knows or cares which device it is on. */
  mount('app', `<div class="shell${showNav ? '' : ' shell--bare'}">
    ${showNav ? sideNav() : ''}
    <div class="shell__main">${showNav ? topBar() : ''}${body}</div>
  </div>${showNav ? navBar() : ''}`);
}

function currentTab() {
  return ctx.view === 'shop' || ctx.view === 'cart' ? 'shops' : ctx.view === 'order' || ctx.view === 'ask' ? 'orders'
       : ctx.view === 'partner' || ctx.view === 'shopadmin' || ctx.view === 'onboard' || ctx.view === 'pro' ? 'earn'
       : ctx.view;
}

/* desktop ≥1024px persistent · tablet 768–1023 icon rail · hidden on mobile */
function sideNav() {
  const s = me();
  const cur = currentTab();
  return `<aside class="sidenav" aria-label="Main">
    <div class="sidenav__brand">${mark(30, { glow: false })}<span class="wordmark wm">SAAHAA</span></div>
    ${NAV.map(([id, ic, label]) => `<button class="sidenav__item" data-act="nav.tab" data-tab="${id}"
        ${cur === id ? 'aria-current="page"' : ''}>
        <span class="ic">${icon(ic, { size: 22 })}</span><span class="lbl">${label}</span></button>`).join('')}
    ${s && s.role === 'partner' ? `<button class="sidenav__item" data-act="pro.open" data-id="${esc(s.partnerId || '')}">
        <span class="ic">${icon('navYou', { size: 22 })}</span><span class="lbl">My page</span></button>` : ''}
    <div class="sidenav__foot">
      <button class="sidenav__item" data-act="theme.toggle"><span class="ic">◐</span><span class="lbl">Light / dark</span></button>
      ${s ? `<button class="sidenav__item" data-act="auth.logout"><span class="ic">↪</span><span class="lbl">Sign out</span></button>`
          : `<button class="sidenav__item" data-act="auth.open"><span class="ic">→</span><span class="lbl">Sign in</span></button>`}
    </div>
  </aside>`;
}

/* desktop-only top strip: where am I, what can I do */
function topBar() {
  const s = me();
  const cart = flow.getCart();
  const n = cart ? cart.lines.reduce((a, l) => a + l.qty, 0) : 0;
  return `<div class="topbar">
    <button class="topbar__loc tap" data-act="area.pick"><span class="eyebrow">Serving</span><b>${esc(myArea())} ▾</b></button>
    <button class="topbar__search" data-act="nav.home" aria-label="Search">${icon('search', { size: 18 })}<span>What do you need today?</span></button>
    ${n ? `<button class="btn btn--secondary btn--sm" data-act="nav.cart">🧺 ${n}</button>` : ''}
    <button class="btn btn--ghost tap" data-act="nav.orders" aria-label="Notifications">🔔</button>
    ${s ? `<button class="avatar avatar--sm tap" data-act="nav.account" aria-label="Account">${esc(s.name[0])}</button>`
        : `<button class="btn btn--primary btn--sm" data-act="auth.open">Sign in</button>`}
  </div>`;
}

function navBar() {
  const cur = currentTab();
  return `<nav class="nav on-plum" role="tablist">
    ${NAV.map(([id, ic, label]) => `<button role="tab" aria-selected="${cur === id}"
      data-act="nav.tab" data-tab="${id}" aria-label="${label}">
      <span class="ic">${icon(ic, { size: 22 })}</span>${label}</button>`).join('')}
  </nav>`;
}


/* ══════════════ ACTIONS ══════════════ */
function wireActions() {
  const A = action;
  /* nav */
  A('nav.home',    () => go('home'));
  A('nav.back',    () => back());
  A('nav.shops',   () => go('shops'));
  A('nav.cart',    () => go('cart'));
  A('nav.orders',  () => go('orders'));
  A('nav.account', () => go('account'));
  A('nav.admin',   () => go('admin'));
  A('auth.open',   () => go('auth'));
  /* Pointed at #shopsSec, which only exists while the RETAIL flag is on — so
     in safe mode (every flag off) it silently did nothing, and even when it
     worked it scrolled to shops rather than to all categories. */
  A('scroll.all',  () => (document.getElementById('allCats') || document.getElementById('shopsSec'))
                          ?.scrollIntoView({ behavior: 'smooth' }));
  A('nav.tab', d => {
    // A partner or shop owner already earns here, so the tab is their console.
    // Everyone else — including a signed-out guest — gets the invitation to
    // join, which is a real screen, not a redirect to the login form.
    if (d.tab === 'earn' && earn.wantsConsole()) go(earn.consoleRoute());
    else go(d.tab);
  });
  A('earn.start', () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); go('auth'); });
  A('nav.onboard', () => go('onboard'));

  /* ── partner verification (the chronology) ─────────────────── */
  ['ob.sendcode','ob.confirmphone','ob.idtype','ob.submitid','ob.selfie','ob.pick','ob.quiz','ob.payout','ob.agree','ob.bg']
    .forEach(n => A(n, d => onboard.act(n, d)));

  /* ── the pro's public page ─────────────────────────────────── */
  A('pro.open',  d => go('pro', d.id));
  A('pro.edit',  () => pro.openEdit());
  A('pro.save',  () => { pro.saveEdit(); closeSheet(); render(); });
  A('pro.share', d => pro.share(d.id));
  A('sheet.close', () => closeSheet());

  /* theme + brand */
  A('theme.toggle', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('SAAHAA_THEME', next); } catch (e) {}
  });
  A('splash.replay', () => replaySplash());

  /* area */
  A('area.pick', () => sheet('Where are you?', `<div class="grid2">${AREA_NAMES.map(a =>
    `<button class="tile" data-act="area.set" data-area="${esc(a)}"><span class="lbl">${esc(a)}</span></button>`).join('')}</div>`));
  A('area.set', d => {
    // persist.read JSON.parses; a raw setItem here made every guest Madhapur
    if (ctx.session) ctx.session = { ...ctx.session, area: d.area };
    else { ctx.session = null; persist.write(persist.KEYS.guestArea, d.area); }
    closeSheet(); toast(`Serving ${d.area}`); render();
  });

  /* search */
  A('search.clear', () => { home.setSearch(''); render(); });

  /* catalog + booking */
  A('cat.open',      d => home.openCategory(d.id));
  A('book.sub',      d => home.openCategory(d.id, d.sub));   // the chosen sub used to be dropped
  A('book.others',   d => home.showAlternates(d.id, d.sub || null));
  A('book.confirm',  d => home.confirmBooking(d.id, d.pid, d.sub));
  A('quick.emergency', () => { home.setSearch('repair'); render(); toast('Showing urgent-capable trades'); });
  A('quick.nearby',    () => go('shops'));

  /* ── ask rates (the P2P auction, in the customer's words) ──── */
  A('ask.start',  d => ask.startAsk(d.id, d.pid, Number(d.held)));
  A('ask.cancel', d => { auction.cancelRequest(d.id); toast('Cancelled. Nothing was charged.'); go('home'); });
  A('ask.background', () => { toast('We will message you when rates come in.'); go('home'); });
  A('ask.counter', d => auction.sendCounter(d.id, d.bid));
  A('ask.held',   async d => {
    const req = auction.requestById(d.id);
    const o = await auction.bookHeld(d.id);
    if (!o) return;
    go('order', o.id);
    ask.showReceipt(req, req.held.amount, req.held.partnerName);
  });
  A('ask.accept', async d => {
    // The one guard rail: a materially lower-rated pick gets ONE lightweight
    // sheet stating the fact. Not a warning, not "not recommended" — a fact.
    const bid = getState().bids.find(b => b.id === d.bid);
    if (!bid) { toast('That rate is no longer available', 'warn'); render(); return; }
    if (d.warn === '1' && !confirmedLowRated.has(d.bid)) {
      confirmedLowRated.add(d.bid);
      sheet('Before you book', `<p class="tiny muted">${esc(bid.partnerName)} is rated lower than the recommended worker.</p>
        <button class="btn btn--primary btn--lg btn--block" style="margin-top:16px"
          data-act="ask.accept" data-id="${d.id}" data-bid="${d.bid}">Book ${'₹'}${(bid.amount / 100).toFixed(0)}</button>
        <button class="btn btn--ghost btn--block" style="margin-top:6px" data-act="sheet.close">Go back</button>`);
      return;
    }
    const req = auction.requestById(d.id);
    const o = await auction.acceptBid(d.id, d.bid);
    if (!o) return;
    const paid = bid.countered || bid.amount;
    // remember the saving so the NEXT entry row can show their own number
    dispatch({ type: 'request/patch', payload: { id: d.id, patch: { savedPaise: Math.max(0, (req.held ? req.held.amount : paid) - paid) } } });
    go('order', o.id);
    ask.showReceipt(auction.requestById(d.id), paid, bid.partnerName);
  });
  A('bid.send', d => {
    const p = getState().partners.find(x => x.id === d.pid);
    if (!p) return;
    if (auction.placeBid({ requestId: d.id, partner: p, amount: Number(d.amt) })) { closeSheet(); render(); }
  });
  /* The post-auction coaching loop. The button existed in the console with no
     handler behind it — the one screen that stops undercutting was unreachable. */
  A('bid.result', d => {
    const bid = getState().bids.find(b => b.id === d.id); if (!bid) return;
    const req = auction.requestById(bid.requestId); if (!req) return;
    const win = getState().bids.find(b => b.requestId === req.id && b.status === 'accepted');
    if (!win) { toast('This job was not awarded to anyone.'); return; }
    const byId = Object.fromEntries(getState().partners.map(p => [p.id, p]));
    if (!byId[bid.partnerId] || !byId[win.partnerId]) return;
    const band = { beff: req.beff, floor: req.floor, target: req.target, ceiling: req.ceiling, quoteOnly: false };
    const mine   = bidding.scoreBid(bid, byId[bid.partnerId], band, { area: req.area });
    const theirs = bidding.scoreBid(win, byId[win.partnerId], band, { area: req.area });
    ask.showLoserFeedback(bidding.loserFeedback(mine, theirs));
  });
  A('bid.open', d => {
    const p = getState().partners.find(x => x.id === d.pid);
    if (p) ask.bidSheet(d.id, p);
  });
  A('partner.join',    () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); go('auth'); });

  /* auth */
  A('auth.tab',   d => { auth.setAuthTab(d.tab); render(); });
  A('auth.role',  d => { auth.setAuthRole(d.role); render(); });
  A('auth.login', () => auth.doLogin());
  A('auth.signup',() => auth.doSignup());
  A('auth.logout',() => auth.logout());

  /* shops + cart */
  A('shops.cat',  d => go('shops', d.id));
  A('shop.open',  d => go('shop', d.id));
  A('cart.add',   d => shops.addToCart(d.id));
  A('cart.swap',  d => shops.swapCart(d.id));
  A('cart.inc',   d => { const l = findLine(d.id); if (l) flow.setLineQty(d.id, l.qty + 1); render(); });
  A('cart.dec',   d => { const l = findLine(d.id); if (l) flow.setLineQty(d.id, l.qty - 1); render(); });
  A('cart.sub',   d => { flow.setLineSubPolicy(d.id, d.pol); render(); });
  A('cart.clear', () => { flow.clearCart(); toast('Cart emptied'); render(); });
  A('cart.mode',  d => { shops.setCartMode(d.mode); render(); });
  A('cart.place', async () => {
    const o = await flow.placeRetailOrder(shops.getCartMode());
    if (o) { toast('Order placed'); go('order', o.id); }
  });
  A('rx.info', () => sheet('Prescription needed', `<p>This medicine needs a valid prescription.
    Upload it at checkout — the chemist cannot pack it until a pharmacist has verified it.</p>
    <p class="tiny muted" style="margin-top:12px">Prescription items are never substituted and cannot be returned.</p>`));

  /* order lifecycle */
  A('order.open',    d => go('order', d.id));
  // one button, both machines: a pro accepting a job and a shop accepting an
  // order are the same act, and both stages previously had no UI at all
  A('stage.accept',  d => {
    const o = getState().orders.find(x => x.id === d.id);
    if (o) flow.advance(d.id, o.kind === 'service' ? 'ASSIGNED' : 'R_ACCEPTED');
  });
  A('rate.submit',   d => { flow.rateOrder(d.id, d.stars); render(); });
  A('rate.skip',     d => { flow.skipRating(d.id); render(); });
  A('stage.enroute', d => flow.advance(d.id, 'EN_ROUTE'));
  A('stage.arrived', d => flow.advance(d.id, 'ARRIVED'));
  A('stage.done',    d => flow.markDone(d.id));
  A('ev.add',        d => flow.addEvidence(d.id, d.label));
  A('otp.submit',    d => {
    const code = [0,1,2,3].map(i => (document.getElementById('otp' + i) || {}).value || '').join('');
    flow.verifyOtp(d.id, code);
  });
  A('release.full',  d => flow.confirmAndRelease(d.id, 1).then(render));
  A('retail.settle', d => flow.settleRetail(d.id).then(render));
  A('stage.picking', d => flow.advance(d.id, 'R_PICKING'));
  A('stage.packed',  d => flow.advance(d.id, 'R_PACKED'));
  A('stage.out',     d => flow.advance(d.id, 'R_OUT'));
  A('stage.delivered', d => flow.advance(d.id, 'R_DELIVERED'));
  A('chat.send',     d => {
    const el = document.getElementById('chatIn');
    if (el && el.value.trim()) { flow.sendChat(d.id, el.value.trim()); el.value = ''; render(); }
  });
  A('dispute.open',  d => ordersView.openDispute(d.id));
  A('dispute.pick',  d => ordersView.submitDispute(d.id, d.reason));
  A('cancel.open',   d => ordersView.openCancel(d.id));
  A('cancel.confirm',d => { flow.cancelOrder(d.id, d.rule); closeSheet(); render(); });

  /* partner + shop console */
  A('partner.online', () => {
    const p = getState().partners.find(x => x.userKey === me().key);
    if (p) { ctx.store.dispatch({ type:'partner/patch', payload:{ id:p.id, patch:{ online: p.online === false } } }); render(); }
  });
  // was an explanatory sheet with nothing behind it; it is the ladder now
  A('partner.upgrade', () => go('onboard'));
  A('shop.tab',    d => { partner.setShopTab(d.tab); render(); });
  A('shop.toggle', () => {
    const s = getState().shops.find(x => x.ownerKey === me().key);
    if (s) { ctx.store.dispatch({ type:'shop/toggle', payload:{ id:s.id } }); render(); }
  });
  A('shop.mode', d => {
    const s = getState().shops.find(x => x.ownerKey === me().key);
    if (s) { ctx.store.dispatch({ type:'shop/patch', payload:{ id:s.id, patch:{ deliveryMode:d.mode } } }); render(); }
  });
  A('cat.picker',   () => partner.openPicker());
  A('pick.add',     d => partner.addFromPicker(d.ref));
  A('prod.remove',  d => partner.removeProduct(d.id));
  A('stock.refill', d => partner.refill(d.id));

  /* admin */
  A('admin.login',   () => admin.doLogin());
  A('admin.logout',  () => { adminauth.logout(); go('home'); });
  A('admin.sec',     d => { admin.setSection(d.sec); render(); });
  A('admin.approve', d => admin.approve(d.id, d.tier));
  A('admin.suspend', d => admin.suspend(d.id));
  A('admin.release', d => admin.release(d.id, d.pct));
  A('admin.resolve', d => admin.resolve(d.id, d.out));
  A('admin.refundretail', d => admin.refundRetail(d.id));
  A('admin.hidereview', d => admin.hideReview(d.id));
  A('admin.flag',    d => admin.toggleFlag(d.name));
  A('admin.runtests',() => admin.runTests());
  A('admin.verifychain', () => admin.doVerifyChain());
  A('admin.snapshot',() => admin.snapshot());
  A('admin.restore', d => admin.restore(d.key));
  A('admin.export',  () => admin.exportJSON());
  A('admin.exportaudit',  () => admin.exportAudit());
  A('admin.exportledger', () => admin.exportLedger());
  A('admin.changepw',() => admin.changePassword());
  /* Was a bare toast with no data-id and no state change, so the same payout
     stayed in the queue after every tap. It now actually marks the order. */
  A('admin.markpaid', d => {
    const ids = String(d.ids || '').split(',').filter(Boolean);
    if (!ids.length) { toast('No payout selected', 'warn'); return; }
    const at = Date.now();
    ids.forEach(id => dispatch({ type: 'order/patch', payload: { id, patch: { paidOut: true, paidOutAt: at } } }));
    audit.record('payout.marked', { ids, count: ids.length }, 'admin');
    toast(`Marked ${ids.length} payout(s) paid — record the UTR in production`);
    render();
  });
  A('selftest.run',  () => admin.runTests());
}

function findLine(lineId) {
  const c = flow.getCart();
  return c ? c.lines.find(l => l.lineId === lineId) : null;
}

/* live-typing inputs — delegated so a re-render never breaks them */
function wireInputs() {
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t.dataset) return;
    switch (t.dataset.role) {
      case 'search':        home.setSearch(t.value); debounceRender(); break;
      case 'shopsearch':    shops.setShopFilter(t.value); debounceRender(); break;
      case 'catalogsearch': partner.setCatalogQuery(t.value); debounceRender(); break;
      case 'pickersearch':  partner.setPickerQuery(t.value); debouncePicker(); break;
      /* Price and stock are committed on `change` (blur / Enter), NOT here.
         Writing on every keystroke meant typing "150" published the item at
         Rs.1, then Rs.15, then Rs.150 — and when setProductPrice rejected an
         above-MRP value there was no re-render, so the field kept showing the
         illegal number while state held the old one. */
      case 'otp': {
        const i = Number(t.id.replace('otp', ''));
        if (t.value && i < 3) document.getElementById('otp' + (i + 1))?.focus();
        break;
      }
    }
  });

  // committed edits: one write per completed value, and always re-render so a
  // rejected value cannot stay on screen pretending it was accepted
  document.addEventListener('change', e => {
    const t = e.target;
    if (!t || !t.dataset) return;
    const v = String(t.value).trim();
    if (t.dataset.role === 'price' && v) { partner.priceEdit(t.dataset.id, v); render(); }
    if (t.dataset.role === 'stock' && v) { partner.stockEdit(t.dataset.id, v); render(); }
  });
}
let rt = null, pt = null;
const debounceRender = () => { clearTimeout(rt); rt = setTimeout(render, 160); };
const debouncePicker = () => { clearTimeout(pt); pt = setTimeout(() => partner.openPicker(), 200); };

/* ══════════════ BOOT ══════════════ */
async function boot() {
  document.getElementById('defs').innerHTML = defs();

  try {
    const saved = localStorage.getItem('SAAHAA_THEME');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {}

  registry.freeze();

  /* migrate before the store exists, so the store never sees an old shape */
  const raw = persist.read(persist.KEYS.state, null);
  const mig = runMigrations(raw, { freshState: defaultState, tabId: deviceId() });
  if (mig.applied.length) {
    audit.record(audit.ACTIONS.MIGRATION, { from: mig.fromVersion, to: mig.toVersion, applied: mig.applied, backup: mig.backupKey });
    console.info('[saahaa] migrated', mig.applied.join(' → '));
  }
  if (mig.rolledBack) {
    audit.record(audit.ACTIONS.SAFE_MODE, { error: String(mig.error) });
    console.error('[saahaa] migration rolled back:', mig.error);
  }

  const store = createStore(combineFromRegistry(), mig.state);
  ctx.store = store;
  ctx.render = render;
  ctx.go = go;

  /* Subscribe BEFORE seeding, or the seed (and its `seeded` flag) is never
     written and the app re-seeds on every reload. */
  store.subscribe(() => persist.writeDebounced(persist.KEYS.state, () => store.getState()));
  window.addEventListener('beforeunload', () => persist.flush(persist.KEYS.state));

  if (!mig.state.createdAt) store.dispatch({ type: 'meta/born', payload: Date.now() });

  if (!store.getState().seeded) {
    const seed = await buildSeed();
    store.dispatch({ type: 'seed/users',    payload: seed.users });
    store.dispatch({ type: 'seed/partners', payload: seed.partners });
    store.dispatch({ type: 'seed/shops',    payload: seed.shops });
    store.dispatch({ type: 'seed/products', payload: seed.products });
    store.dispatch({ type: 'admin/set',     payload: seed.admin });
    store.dispatch({ type: 'seed/done' });
    persist.flush(persist.KEYS.state);          // commit the seed immediately
    console.info('[saahaa] seeded', seed.shops.length, 'shops,', seed.products.length, 'products');
  }

  // Bring the signed-in user back. Without this the session was written but
  // never read, so every refresh — and every PWA relaunch — silently signed
  // the user out and showed a partner the guest pitch on their own Earn tab.
  const restored = restoreSession(store.getState().users);
  if (restored) console.info('[saahaa] session restored:', restored.role);

  const health = checkHealth(store.getState());
  if (!health.ok) console.warn('[saahaa] health', health.checks.filter(c => !c.ok));
  if (health.fatal) { flags.safeMode(); toast('Safe mode — see Admin → System', 'danger'); }

  initActions();
  wireActions();
  wireInputs();

  /* route from the hash so links and refreshes work */
  const applyHash = () => {
    const [, v, p] = (location.hash || '#/home').split('/');
    if (ROUTES[v]) { ctx.view = v; ctx.param = p || null; }
  };
  applyHash();
  // A sheet must never outlive its screen. go() closes it, but hash-driven
  // navigation (browser back, a pasted deep link) bypassed go() entirely and
  // left the previous screen's sheet sitting on top of the new one.
  window.addEventListener('hashchange', () => {
    if (selfNav) { selfNav = false; return; }   // our own echo: go() already rendered
    closeSheet(); applyHash(); render();
  });

  ctx.ready = true;
  /* ?shot=<scene> — the presentation capture switch. A dev-only module that
     seeds a real state and walks to a real screen so headless Chrome can
     photograph it. Never loaded otherwise; it is UI tooling, not product. */
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) { import('./ui/deckscenes.js').then(m => m.run(shot)).catch(e => console.error('[shot]', e)); }
  // the WORK_DONE screen promises auto-release; this is what keeps it
  flow.sweepAutoRelease().then(n => { if (n) { console.info('[saahaa] auto-released', n); render(); } });

  if (new URLSearchParams(location.search).get('selftest') === '1') {
    const r = await selftest.runAll();
    console.table(r.suites);
    document.getElementById('app').innerHTML =
      `<main class="wrap" style="padding-top:40px"><h1>Self-test — v${VERSION}</h1>
       <p class="${r.failed ? '' : 'muted'}" style="font-size:20px;margin:12px 0">
         ${r.passed} passed · ${r.failed} failed · ${r.durationMs}ms</p>
       ${r.suites.map(s => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--border)">
         <span>${esc(s.name)}</span><b style="color:var(--${s.failed ? 'danger' : 'success'})">${s.passed}/${s.passed + s.failed}</b></div>`).join('')}
       ${r.failures.map(f => `<p style="color:var(--danger);margin-top:10px">${esc(f.suite)} › ${esc(f.case)}<br><small>${esc(f.message)}</small></p>`).join('')}
       <p style="margin-top:24px"><a href="index.html">← back to the app</a></p></main>`;
    return;
  }

  render();
  await showSplash({ onGuest: () => go('home') });
  render();
}

boot().catch(err => {
  console.error('[saahaa] boot failed', err);
  document.getElementById('app').innerHTML =
    `<main style="padding:40px 20px;font-family:system-ui">
      <h1>SAAHAA could not start</h1><p>${String(err.message)}</p>
      <p style="opacity:.6">v${VERSION} · ${BUILD_ID}</p>
      <button onclick="localStorage.clear();location.reload()">Reset local data and retry</button>
    </main>`;
});
