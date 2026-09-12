/* SAAHAA · app.js — bootstrap and router. This is the ONLY file that knows
   about every other module, and it does nothing but wire them together. */

import { VERSION, SCHEMA_VERSION, BUILD_ID } from './core/version.js';
import { ctx, getState, dispatch, me, restoreSession, myArea, saveSession, myPartner } from './core/ctx.js';
import { createStore, combineFromRegistry } from './core/store.js';
import * as persist from './core/persist.js';
import * as bus from './core/bus.js';
/* the erase sheet names an amount, and threw ReferenceError without this */
import * as M from './core/money.js';
import { CONTACT } from './core/config.js';
import * as i18n from './ui/i18n.js';
import * as verification from './domain/verification.js';
import * as registry from './core/registry.js';
import * as flags from './core/flags.js';
import * as audit from './core/audit.js';
import * as adminauth from './core/adminauth.js';
import { runMigrations } from './core/migrate.js';
import { checkHealth } from './core/health.js';
import * as selftest from './core/selftest.js';
import { deviceId } from './core/id.js';
import { startUpdateWatch } from './core/update.js';

/* domain — importing a catalog file IS registering it (open/closed) */
import './domain/catalog.services.js';
import './domain/catalog.retail.js';
import './domain/state.js';
import './core/migrations.js';
import { defaultState } from './domain/state.js';
import { buildSeed } from './domain/seed.js';
import * as flow from './domain/flow.js';
import * as PAY from './domain/payments.js';
import * as W from './domain/wallet.js';
import { CANCEL_RULES } from './domain/pricing.js';
import * as auction from './domain/auction.js';
import * as bidding from './domain/bidding.js';
import * as fresh from './domain/fresh.js';
import * as autoverify from './domain/autoverify.js';
import * as treasury from './domain/treasury.js';
import * as gateway from './core/gateway.js';
import './core/selftests.js';
import './core/selftests.money.js';
import './core/selftests.security.js';
import './core/selftests.auto.js';
import './core/selftests.identity.js';
import './core/selftests.photos.js';
import './core/selftests.erase.js';
import './core/selftests.recovery.js';
import './core/selftests.doorcode.js';
import './core/selftests.scale.js';
import './core/selftests.i18n.js';

/* ui */
import { mount, action, initActions, toast, sheet, closeSheet, esc, stickyToast } from './ui/dom.js';
import { defs, mark } from './ui/logo.js';
import { icon } from './ui/icons.js';
import { showSplash, replaySplash } from './ui/splash.js';
import * as home from './ui/views/home.js';
import * as shops from './ui/views/shops.js';
import * as addr from './ui/address.js';
import * as ordersView from './ui/views/orders.js';
import * as auth from './ui/views/auth.js';
import * as partner from './ui/views/partner.js';
import * as admin from './ui/views/admin.js';
import * as earn from './ui/views/earn.js';
import * as ask from './ui/views/ask.js';
import * as onboard from './ui/views/onboard.js';
import * as pro from './ui/views/pro.js';
import * as account from './ui/views/account.js';
import * as legal from './ui/views/legal.js';
import * as checkout from './ui/checkout.js';
import * as photo from './ui/photo.js';
import * as erase from './domain/erase.js';
import * as recovery from './domain/recovery.js';
import * as security from './core/security.js';

/* ══════════════ ROUTES ══════════════ */
/* WHICH DOCUMENT AM I ON. admin.html carries data-admin-host on <html>; the
   customer app does not, and without it the owner console is not a route that
   exists — #/admin resolves to nothing and go('admin') lands on home. One
   bundle, one repo, two doors.
   This is not the access control. Anyone can request admin.html and meet the
   password; what keeps that safe is that the credential is a PBKDF2 hash kept
   out of the repo, and that a browser has no authority to move money — the
   Worker holds the service-role key. Put Cloudflare Access in front of
   /admin.html for a real boundary (docs/DEPLOY.md). */
const ADMIN_HOST = (typeof document !== 'undefined' && document.documentElement
  && document.documentElement.getAttribute('data-admin-host') === '1')
  || !!globalThis.__SAAHAA_ADMIN_HOST;

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
  /* ONLY ON THE OWNER'S OWN PAGE. This was a route in the customer app, so
     anyone could type #/admin and be shown a sign-in box with the owner's
     username already in it — an invitation to try. The console is served from
     admin.html now (src/admin-host.js sets the flag); everywhere else the route
     does not exist and go('admin') lands on home. */
  ...(ADMIN_HOST ? { admin: () => admin.render() } : {}),
  earn:      () => earn.render(),
  ask:       p => ask.render(p),
  onboard:   () => onboard.render(),
  pro:       p => pro.render(p),
  account:   () => account.render(),
  nearby:    () => home.renderNearby(),      // mockup 7 — the neighbourhood, map first
  chat:      p => ordersView.renderChat(p),  // mockup 6 — the thread with the pro
  legal:     p => legal.render(p),          // #/legal/terms · privacy · refunds · contact · about
};

/* The label is looked up at render time, not baked in here, so switching
   language repaints the tab bar with everything else. */
const NAV = [
  ['home',    'navHome',   'nav.home'],
  ['shops',   'navShops',  'nav.shops'],   // a shopfront, not a cart: 🛒 means "my basket"
  ['orders',  'navOrders', 'nav.orders'],
  ['earn',    'navEarn',   'nav.earn'],    // a rupee coin, not 💰 which reads "my wallet"
  ['account', 'navYou',    'nav.you'],
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
  if (view === 'admin' && !ADMIN_HOST) view = 'home';   // no door in the customer app
  /* AND THE OTHER WAY ROUND. admin.html hosts the console and nothing else, so
     "Back to SAAHAA" must LEAVE this document — go('home') would otherwise
     paint the customer app, tab bar and all, inside the owner page. The two
     pages share an origin and therefore the same stored state, so stepping
     across is a navigation, not a reload of anything that matters. */
  if (ADMIN_HOST && view !== 'admin') {
    location.href = './' + (location.search || '') + '#/' + view + (param ? '/' + param : '');
    return;
  }
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

/* THE DEVICE IS FULL, AND EVERYTHING ON SCREEN IS A LIE.

   All of this product's data lives in one browser's localStorage, which is
   hard-capped — about 5 MB on an iPhone. When it fills, `setItem` throws, and
   until 8.6.0 the app swallowed that and carried on looking healthy: an order
   would be placed, a balance would change, and none of it reached the disk.
   The person found out on their next reload, when it had all gone back.

   Nothing about that is acceptable in an app holding money, so it is said out
   loud, at the top of every screen, and it does not go away by itself. The
   warning at 80% is the useful one — it arrives while there is still time to
   do something rather than after the damage.

   The banner is deliberately not dismissible. This is the one message in the
   product a person must not be able to tidy away. */
function storageBanner() {
  /* A BROKEN BOOK IS LOUDER THAN A FULL DISK. If the ledger stops balancing,
     payouts are already refused (domain/flow.js assertBookOk) — but somebody
     has to be told, and it must not be dismissible. */
  const book = flow.bookStatus && flow.bookStatus();
  if (book) {
    /* WHO IS READING THIS DECIDES WHAT IT SAYS. One banner told a customer and
       a plumber that the books do not balance, printed the ledger accounts at
       fault, and instructed them to "Open Admin → Finance" — an invitation to
       a door that is not theirs, and an alarm about money they cannot act on.
       The owner needs the detail. Everybody else needs to know it is being
       handled and that they need do nothing. */
    if (adminauth.isLoggedIn()) {
      return `<div class="sysbar sysbar--bad" role="alert">
        <b>${esc(i18n.t('sys.booksBad'))}</b>
        <span>${esc(book.problems.join(' · '))}. ${esc(i18n.t('sys.booksBadOwner'))}</span>
      </div>`;
    }
    return `<div class="sysbar sysbar--bad" role="alert">
      <b>${esc(i18n.t('sys.payoutsHeld'))}</b>
      <span>${esc(i18n.t('sys.payoutsHeldNote'))}</span>
    </div>`;
  }
  const failed = persist.saveFailed && persist.saveFailed();
  if (failed) {
    return `<div class="sysbar sysbar--bad" role="alert">
      <b>${esc(i18n.t('warn.deviceFull'))}</b>
      <span>${esc(i18n.t('warn.deviceFullBody'))}</span>
    </div>`;
  }
  const u = persist.usage ? persist.usage() : { pct: 0 };
  if (u.pct >= 0.8) {
    return `<div class="sysbar sysbar--warn" role="status">
      <b>This device is nearly full (${Math.round(u.pct * 100)}%).</b>
      <span>SAAHAA keeps everything on this phone. Clear some space soon, or new orders will stop saving.</span>
    </div>`;
  }
  return '';
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
    <div class="shell__main">${showNav ? topBar() : ''}${storageBanner()}${body}</div>
  </div>${showNav ? navBar() : ''}`);
}

function currentTab() {
  return ctx.view === 'shop' || ctx.view === 'cart' ? 'shops' : ctx.view === 'order' || ctx.view === 'ask' ? 'orders'
       : ctx.view === 'partner' || ctx.view === 'shopadmin' || ctx.view === 'onboard' || ctx.view === 'pro' ? 'earn'
       : ctx.view;
}

/* desktop ≥1024px persistent · tablet 768–1023 icon rail · hidden on mobile */
/* THE SIDE RAIL IS GONE, DELIBERATELY, AND THIS IS THE NOTE THAT SAYS SO.

   Until 8.6.0 `sideNav()` was still built into every single render and then
   hidden by `.sidenav{display:none!important}` in tokens.css — while a comment
   in that stylesheet claimed nothing rendered it. Invisible markup on every
   paint, and a comment that was not true.

   The v8 shell replaced it with the top bar plus a horizontal tab row, and an
   audit confirmed every control the rail carried is reachable elsewhere: the
   five tabs in navBar(), theme.toggle and auth.logout on the account screen,
   "My page" on the partner and pro screens. So nothing was lost with it.

   If a persistent desktop rail is ever wanted back, it is a design decision to
   take on purpose — git has this function — not a hidden element to un-hide. */


/* desktop-only top strip: where am I, what can I do */
function topBar() {
  const s = me();
  const cart = flow.getCart();
  const n = cart ? cart.lines.reduce((a, l) => a + l.qty, 0) : 0;
  return `<div class="topbar">
    <button class="topbar__loc tap" data-act="area.pick"><span class="eyebrow">Serving</span><b>${esc(myArea())} ▾</b></button>
    <button class="topbar__search" data-act="nav.home" aria-label="Search">${icon('search', { size: 18 })}<span>What do you need today?</span></button>
    ${n ? `<button class="btn btn--secondary btn--sm" data-act="nav.cart">${icon('basket', { size: 16 })} ${n}</button>` : ''}
    <button class="btn btn--ghost tap" data-act="nav.orders" aria-label="Notifications">${icon('bell', { size: 20 })}</button>
    ${s ? `<button class="avatar avatar--sm tap" data-act="nav.account" aria-label="Account">${esc(s.name[0])}</button>`
        : `<button class="btn btn--primary btn--sm" data-act="auth.open">Sign in</button>`}
  </div>`;
}

function navBar() {
  const cur = currentTab();
  /* `on-plum` re-points `--color-accent-text` to the LIGHT end of the ramp for
     use on a dark ground — and a later rule repaints this nav near-white, so
     the token override survived onto a light surface and the ACTIVE tab became
     pale salmon on off-white at 1.92:1. The least readable text in the product
     was the control telling her where she was. The customer nav is a light
     surface; it does not claim to be a dark one. */
  return `<nav class="nav" role="tablist">
    ${NAV.map(([id, ic, lk]) => `<button role="tab" aria-selected="${cur === id}"
      data-act="nav.tab" data-tab="${id}" aria-label="${esc(i18n.t(lk))}">
      <span class="ic">${icon(ic, { size: 22 })}</span>${esc(i18n.t(lk))}</button>`).join('')}
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
  /* SCROLLING TO A SECTION, RELIABLY.
     `behavior:'smooth'` is a request, not a promise: in some engines and in
     several embedded webviews it is silently ignored and the page does not move
     at all. A navigation control that does nothing is worse than one that jumps.
     So: ask for smooth, check a beat later whether anything actually happened,
     and land it instantly if it did not. "All 24 categories" had this bug
     already — it used scrollIntoView({behavior:'smooth'}) and could do nothing. */
  const scrollToEl = el => {
    if (!el) return;
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 64);  // clear the top bar
    const from = window.scrollY;
    try { window.scrollTo({ top: y, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, y); }
    setTimeout(() => { if (Math.abs(window.scrollY - from) < 2 && Math.abs(y - from) > 8) window.scrollTo(0, y); }, 240);
  };
  /* Jump to a section on the current screen. My SAAHAA stacks a dozen of them
     and a person who does not scroll never learns they are there. */
  A('nav.jump',   d => scrollToEl(d && d.to && document.getElementById(d.to)));
  A('scroll.all', () => scrollToEl(document.getElementById('allCats') || document.getElementById('shopsSec')));
  A('nav.tab', d => {
    // A partner or shop owner already earns here, so the tab is their console.
    // Everyone else — including a signed-out guest — gets the invitation to
    // join, which is a real screen, not a redirect to the login form.
    if (d.tab === 'earn' && earn.wantsConsole()) go(earn.consoleRoute());
    else go(d.tab);
  });
  A('earn.start', () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); go('auth'); });
  A('pro.rate',      d => partner.openRateSheet(d.id));
  A('pro.rate.save', d => { partner.saveRate(d.id); render(); });
  A('nav.onboard', () => go('onboard'));

  /* ── partner verification (the chronology) ─────────────────── */
  /* 'ob.sendcode' is gone with the fake SMS — the phone step confirms a number
     and hands over the pro's permanent code instead. */
  ['ob.confirmphone','ob.idtype','ob.submitid','ob.selfie','ob.pick','ob.quiz','ob.payout','ob.agree','ob.bg']
    .forEach(n => A(n, d => onboard.act(n, d)));

  /* ── the pro's public page ─────────────────────────────────── */
  A('pro.open',  d => go('pro', d.id));
  A('pro.edit',  () => pro.openEdit());
  A('pro.save',  () => { pro.saveEdit(); closeSheet(); render(); });
  A('pro.share', d => pro.share(d.id, d.kind));
  A('pro.qr.save', d => pro.saveQr(d.id, d.kind, d.name));
  A('sheet.close', () => closeSheet());

  /* theme + brand */
  /* the sheet used to tell her to empty her wallet with no way to do it from
     there, and the floor then refused the odd paise she had left */
  A('cwallet.emptyout', async d => { await flow.customerWithdraw(Number(d.amt)); closeSheet(); render(); });
  A('cwallet.upi', () => sheet('Where your money goes', `
    <p class="tiny muted" style="margin-bottom:12px">Refunds and take-outs are sent here. Until it is set,
      SAAHAA has nowhere to pay you and the take-out button stays off.</p>
    <div class="field"><input id="cwUpi" autocomplete="off" spellcheck="false" placeholder=" "
      value="${esc((ctx.session || {}).upi || '')}"><label>UPI id — name@bank</label></div>
    <button class="btn btn-primary btn--block" data-act="cwallet.upi.save">Save</button>`));
  A('cwallet.upi.save', () => {
    const v = (document.getElementById('cwUpi') || {}).value || '';
    if (flow.setCustomerUpi(v)) { closeSheet(); render(); }
  });
  A('lang.set', d => { i18n.setLang(d.lang); render(); });
  A('theme.toggle', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('SAAHAA_THEME', next); } catch (e) {}
  });
  A('splash.replay', () => replaySplash());

  /* area */
  A('area.pick', () => home.openPlacePicker());   // search, pin or device — anywhere in the world
  A('area.set', d => {
    // persist.read JSON.parses; a raw setItem here made every guest Madhapur
    // a signed-in user's area was updated in memory only, so it reverted on
    // the next reload; saveSession is what makes a choice survive
    if (ctx.session) saveSession({ ...ctx.session, area: d.area });
    else { ctx.session = null; persist.write(persist.KEYS.guestArea, d.area); }
    closeSheet(); toast(`Serving ${d.area}`); render();
  });

  /* search */
  A('search.clear', () => { home.setSearch(''); render(); });

  /* catalog + booking */
  A('cat.open',      d => home.openCategory(d.id, null, d.pid || null));   // d.pid: booking a NAMED pro books that pro
  A('book.sub',      d => home.openCategory(d.id, d.sub, d.pid || null));  // the chosen sub used to be dropped
  A('book.others',   d => home.showAlternates(d.id, d.sub || null));
  A('book.allpros',  d => home.showAllPros(d.id, d.sub || null));
  A('book.confirm',  d => home.confirmBooking(d.id, d.pid, d.sub));
  /* THIS SEARCHED FOR THE WORD "repair" AND TOASTED "Showing urgent-capable
     trades". For a burst pipe at 9pm it was worse than typing "plumber": no
     online filter, no arrival sort, no urgency in the data model at all. It now
     does the only thing that helps — who can be here soonest, right now. */
  A('quick.emergency', () => { home.showFreeNow(); render(); });
  A('quick.nearby',    () => go('shops'));

  /* ── ask rates (the P2P auction, in the customer's words) ──── */
  A('ask.start',  d => ask.startAsk(d.id, d.pid, Number(d.held), d.sub || null));
  A('ask.cancel', d => { auction.cancelRequest(d.id); toast('Cancelled. Nothing was charged.'); go('home'); });
  A('ask.background', () => { toast('Rates keep arriving. Open Orders whenever you like — nothing expires.'); go('home'); });
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
  /* ── worker wallet ─────────────────────────────────────────── */
  A('wallet.topup', d => sheet('Add money to your wallet', `
    <p class="tiny muted" style="margin-bottom:12px">This is the money that gets locked when a job starts and comes back when it is finished. In production this is a UPI payment.</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">${[100, 200, 500, 1000].map(r =>
      `<button class="chip" data-act="wallet.topup.do" data-id="${d.id}" data-amt="${r * 100}">₹${r}</button>`).join('')}</div>`));
  A('wallet.topup.do',  d => flow.walletTopUp(d.id, Number(d.amt)).then(() => { closeSheet(); render(); }));
  /* THE PRO'S WHOLE LIVELIHOOD LEFT ON ONE TAP. The SHOP got a confirmation
     sheet in the last pass and the pro did not — same product, same
     irreversible act, ₹1,710 gone on a misplaced thumb. And neither side could
     send a PART of it: a plumber who wants ₹500 for the day and ₹1,200 left in
     the app had no way to say so. One sheet, both sides, with an amount. */
  /* AND THE HEADLINE DID NOT FOLLOW THE AMOUNT. I added the partial-payout
     field in this same pass and left the title formatting `balance` once, at
     render. A pro typed 200, read "Send ₹698 to ramesh@upi?" directly above
     "This goes out now and cannot be pulled back", pressed Send -- and ₹200
     went. The transfer was right and the sentence he authorised was wrong, on
     the one screen in the product that is explicitly irreversible.

     A number that can change does not belong in a title rendered once. It sits
     on the button that performs the act, and it tracks every keystroke. */
  const payoutSheet = (id, balance, upi, act) => { sheet(
    i18n.t('pay.takeOutTo', { upi: upi || '' }), `
    <p class="tiny">${esc(i18n.t('pay.takeOutBody'))}</p>
    <div class="field" style="margin:12px 0 8px">
      <input id="poAmt" type="number" inputmode="decimal" min="10" step="0.01"
        value="${(balance / 100).toFixed(2)}" placeholder=" ">
      <label>${esc(i18n.t('pay.howMuch'))}</label>
    </div>
    <button class="btn btn--ghost btn--block btn--sm" data-act="pay.all" data-amt="${balance}">${esc(i18n.t('pay.allOfIt', { amount: M.fmtMax(balance) }))}</button>
    <button class="btn btn-primary btn--block" style="margin-top:10px" id="poSend"
      data-act="${act}" data-id="${esc(id)}">${esc(i18n.t('pay.sendAmount', { amount: M.fmt2(balance) }))}</button>
    <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px" data-act="sheet.close">${esc(i18n.t('pay.notNow'))}</button>`);
    const el = document.getElementById('poAmt');
    const btn = document.getElementById('poSend');
    const sync = () => { if (btn) btn.textContent = i18n.t('pay.sendAmount', { amount: M.fmt2(poAmt(balance)) }); };
    if (el) el.addEventListener('input', sync);
    sync();
  };
  const poAmt = fallback => {
    const el = document.getElementById('poAmt');
    const typed = el ? Math.round(Number(el.value || 0) * 100) : 0;
    return typed > 0 ? typed : fallback;
  };
  A('pay.all', d => { const el = document.getElementById('poAmt');
    /* the button reads off the field, so the field announces its own change */
    if (el) { el.value = (Number(d.amt) / 100).toFixed(2); el.dispatchEvent(new Event('input')); } });
  A('wallet.withdraw', d => {
    const p0 = (ctx.store.getState().partners || []).find(x => x.id === d.id) || {};
    const bal = W.walletOf(getState().ledger, d.id, p0).available;
    payoutSheet(d.id, bal, (p0.verification || {}).upi, 'wallet.withdraw.do');
  });
  A('wallet.withdraw.do', async d => {
    const p0 = (ctx.store.getState().partners || []).find(x => x.id === d.id) || {};
    const bal = W.walletOf(getState().ledger, d.id, p0).available;
    await flow.walletWithdraw(d.id, poAmt(bal)); closeSheet(); render();
  });

  /* ── the right to be removed ────────────────────────────────
     The privacy page promises a person can have their data deleted, so the
     product has to be able to do it. The plan is shown BEFORE anything
     happens, in three honest parts: what goes, what is emptied but kept
     because somebody else's record points at it, and what stays because the
     ledger is hash-chained and a business must keep its books. */
  /* ── forgetting the password ────────────────────────────────
     No mail and no SMS rail yet, so a reset is what a neighbourhood business
     actually does: ring the owner, they check who you are, they read out a
     one-time code. See domain/recovery.js for why it is built this way. */
  /* THIS PROMISED A CHANNEL THAT DOES NOT EXIST. The sheet said "the number to
     ring is on the Contact page", and CONTACT.phone is empty until the owner
     fills it in — so a pro locked out of his livelihood was sent to a page
     reading "Phone: not yet set", with no other route back in. A screen must
     not offer a way to reach somebody that nobody can walk. */
  A('auth.forgot', () => sheet('Forgotten your password?', `
    ${!(CONTACT.phone || CONTACT.email) ? `<p class="m-note" style="margin-bottom:12px">
      <b>SAAHAA has not published a contact number yet.</b> A reset needs the owner to check who you are
      and read you a code, and there is no way to reach them from this screen until that number is set.
      If you can reach the owner another way, they can issue you a code from the admin console — type it
      below when they do.</p>` : ''}
    <p class="tiny muted" style="margin-bottom:12px">Your account is not lost. ${CONTACT.phone || CONTACT.email
      ? 'Ring SAAHAA — the owner checks it is you and reads out a one-time code that lasts half an hour. Type it here with the new password you want.'
      : 'When you can reach the owner, they check it is you and read out a one-time code that lasts half an hour. Type it here with the new password you want.'}</p>
    <div class="field"><input id="rcWho" type="text" autocomplete="username" autocapitalize="characters" placeholder=" "><label>Mobile number or SAAHAA ID</label></div>
    <div class="field"><input id="rcCode" type="text" autocomplete="one-time-code" autocapitalize="characters" placeholder=" "><label>The code you were read out</label></div>
    <div class="field"><input id="rcPass" type="password" autocomplete="new-password" placeholder=" "><label>Your new password</label></div>
    <button class="btn btn-primary btn--block" data-act="auth.forgot.do">Set my new password</button>
    <p class="micro muted" style="margin-top:10px">${CONTACT.phone
      ? `Ring <b>${esc(CONTACT.phone)}</b> — also on the <a class="more" href="#/legal/contact">Contact page</a>.`
      : 'No number is published yet, so this code has to come from the owner directly.'}</p>`)),
  A('auth.forgot.do', async () => {
    const val = id => (document.getElementById(id) || {}).value || '';
    const pw = val('rcPass');
    const why = security.passwordProblem(pw, val('rcWho'));
    if (why) { toast(why, 'danger'); return; }
    const r = await recovery.redeem(val('rcWho'), val('rcCode'), pw);
    if (!r.ok) { toast(r.reason, 'danger'); return; }
    closeSheet();
    toast(`Password changed for ${r.account.code || r.account.name}. Sign in with it now.`);
    auth.setAuthTab('login'); go('auth');
  });
  /* ── the manual UPI rail ───────────────────────────────────
     She claims, he checks, an admin clears. Only the last one funds escrow,
     and it is the only one of the three that touches the ledger. */
  A('pay.claim', d => {
    const el = document.getElementById('utrBox');
    const r = PAY.claimUtr(d.id, el ? el.value : '');
    toast(r.ok ? i18n.t('pay.claimThanks') : r.reason, r.ok ? 'ok' : 'danger');
    render();
  });
  A('pay.procheck.yes', d => { PAY.proCheck(d.id, true); toast(i18n.t('pay.proThanks')); render(); });
  A('pay.procheck.no',  d => { PAY.proCheck(d.id, false); toast(i18n.t('pay.proFlagged'), 'warn'); render(); });
  A('pay.admin.clear', async d => {
    const r = PAY.adminClear(d.id, { ok: true });
    if (r.ok) await flow.fundClearedOrder(d.id, r.payment ? r.payment.seen : null);
    toast(r.ok ? `Cleared — escrow funded` : r.reason, r.ok ? 'ok' : 'danger');
    render();
  });
  A('pay.admin.reject', d => { PAY.adminClear(d.id, { ok: false, note: 'not in the statement' }); toast('Rejected', 'warn'); render(); });

  A('admin.reset', d => admin.resetPassword && admin.resetPassword(d.key));

  A('account.erase', () => {
    const s = me();
    if (!s) { toast('Sign in first', 'warn'); return; }
    const plan = erase.erasePlan(s.key);
    const row = (k, v) => `<div class="between tiny" style="padding:4px 0"><span class="muted">${esc(k)}</span><b>${esc(String(v))}</b></div>`;
    const blockers = erase.eraseBlockers(s.key);
    /* THE MOST HONEST SCREEN IN THE APP NEVER MENTIONED MONEY. It itemised what
       is removed, what is emptied but kept, and what stays — and said nothing
       about the wallet or the jobs in flight, while erasure removed the user
       row and left the balance in a ledger nobody could sign in to claim. */
    if (blockers.length) {
      const live = blockers.find(b => b.kind === 'live');
      const money = blockers.find(b => b.kind === 'money');
      sheet('Not yet — your money is still here', `
        <p class="tiny" style="margin-bottom:12px">Your account can be removed, but not while SAAHAA is
          still holding something of yours. Removing it now would forfeit it, and that is not a deletion.</p>
        ${money ? `<div class="m-kv"><span>In your wallet</span><span class="num">${M.fmt2(money.paise)}</span></div>` : ''}
        ${live ? `<div class="m-kv"><span>Jobs still running</span><span class="num">${live.n}</span></div>` : ''}
        <p class="micro muted" style="margin-top:10px">${live ? 'Finish or cancel those first. ' : ''}${money
          ? 'Then take your money out from My SAAHAA — you can always withdraw the whole balance, however small.' : ''}
          Come back after that and this will go through.</p>
        ${money ? `<button class="btn btn-primary btn--block" style="margin-top:12px"
          data-act="cwallet.emptyout" data-amt="${money.paise}">Take out ${M.fmt2(money.paise)} now</button>` : ''}
        <button class="btn btn--secondary btn--block" style="margin-top:12px" data-act="sheet.close">Got it</button>`);
      return;
    }
    sheet('Remove my account', `
      <p class="tiny muted" style="margin-bottom:12px">This cannot be undone. Here is exactly what happens to
        ${esc(s.name)} (${esc(s.code || s.key)}).</p>
      <p class="m-cap" style="margin:0 0 4px">Removed</p>
      ${row('Your account', 'name, number, password, place')}
      ${row('Your pictures', plan.removed.photos)}
      ${row('Reviews you wrote', plan.removed.reviewsWritten)}
      ${row('Your messages', 'the words and your name')}
      <p class="m-cap" style="margin:12px 0 4px">Emptied, but kept</p>
      <p class="micro muted" style="margin:0 0 6px">Other people's records point at these — deleting them would tear a hole in someone else's history.</p>
      ${row('Your pro pages', plan.deIdentified.pros)}
      ${row('Your shops', plan.deIdentified.shops)}
      ${row('Orders you were part of', plan.deIdentified.orders)}
      <p class="m-cap" style="margin:12px 0 4px">Kept</p>
      ${row('Ledger entries', plan.kept.ledgerLegs)}
      <p class="micro muted" style="margin:0 0 12px">${esc(plan.kept.reason)}. What stays is an account number with nobody behind it.</p>
      <div class="field"><input id="eraseWord" type="text" autocomplete="off" autocapitalize="characters" placeholder=" "><label>Type REMOVE to confirm</label></div>
      <button class="btn btn--block" style="border-color:var(--danger);color:var(--danger)" data-act="account.erase.do">Remove my account</button>
      <button class="btn btn--ghost btn--block" style="margin-top:6px" data-act="sheet.close">Keep my account</button>`);
  });
  A('account.erase.do', () => {
    const s = me();
    const word = (document.getElementById('eraseWord') || {}).value || '';
    if (word.trim().toUpperCase() !== 'REMOVE') { toast('Type REMOVE in the box to confirm', 'danger'); return; }
    const r = erase.eraseAccount(s.key, 'self');
    if (!r.ok) { toast(r.reason || 'Could not remove that account', 'danger'); return; }
    closeSheet();
    auth.logout();
    toast('Your account is removed. What is left is a number in the books with nobody behind it.');
    go('home');
  });
  /* ── contracts for the parallel build: each action calls an export the
        owning view provides (auth/home/orders/admin). Registered here so the
        views never touch app.js. ── */
  A('auth.locate',        () => auth.useMyLocation && auth.useMyLocation());
  A('auth.geocode',       () => auth.searchPlace && auth.searchPlace());
  A('auth.place',         d => auth.choosePlace && auth.choosePlace(d));
  A('area.locate',        () => home.useMyLocation && home.useMyLocation());
  A('area.search',        () => home.searchPlace && home.searchPlace());
  A('area.choose',        d => { home.choosePlace && home.choosePlace(d); render(); });
  A('order.map',          d => ordersView.toggleMap && ordersView.toggleMap(d.id));
  A('admin.pricing.push', () => admin.pushPricing && admin.pushPricing());
  A('admin.pricing.reset',() => admin.resetPricing && admin.resetPricing());
  A('admin.flow.pick',    d => { admin.pickFlow && admin.pickFlow(d.key); render(); });
  A('admin.flow.filter',  d => { admin.filterFlow && admin.filterFlow(d.role); render(); });
  A('admin.map',          () => admin.refreshMap && admin.refreshMap());
  A('bid.open', d => {
    const p = getState().partners.find(x => x.id === d.pid);
    if (p) ask.bidSheet(d.id, p);
  });
  A('shop.start',      () => { auth.setAuthTab('signup'); auth.setAuthRole('shop'); go('auth'); });   // open a shop, from anywhere
  A('partner.join',    () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); go('auth'); });

  /* auth */
  A('auth.tab',   d => { auth.setAuthTab(d.tab); render(); });
  A('auth.role',  d => { auth.setAuthRole(d.role); render(); });
  A('auth.login', () => auth.doLogin());
  A('auth.pick',  d => { closeSheet(); auth.doLogin(d.key); });   // one number, two accounts: which one

  /* pictures — ui/photo.js asks for the file and shrinks it; domain/flow.js
     writes the id onto the record. A refusal (too big, budget full) is said
     out loud rather than swallowed. */
  const withPhoto = async (opts, then) => {
    const r = await photo.pick(opts);
    if (r.cancelled) return;
    if (!r.ok) { toast(r.reason || 'That picture could not be added', 'danger'); return; }
    then(r.id); render();
  };
  A('photo.shop',    d => withPhoto({ maxEdge: 900 }, id => flow.setShopPhoto(d.id, id)));
  A('photo.product', d => withPhoto({ maxEdge: 560 }, id => flow.setProductPhoto(d.id, id)));
  A('photo.pro',     d => withPhoto({ maxEdge: 560 }, id => flow.setPartnerPhoto(d.id, id)));
  A('photo.selfie',  d => withPhoto({ maxEdge: 560 }, id => flow.setPartnerSelfie(d.id, id)));   // verification only, never published
  A('photo.publish', d => { const p = getState().partners.find(x => x.id === d.id); if (p && p.selfie) { flow.setPartnerPhoto(d.id, p.selfie); toast('That photo is on your page now'); } render(); });
  A('photo.work',    d => withPhoto({ maxEdge: 900 }, id => flow.addWorkPhoto(d.id, id)));
  A('photo.workdrop',d => { flow.removeWorkPhoto(d.id, d.photo); render(); });
  /* Taking a picture back off. Setting null frees the bytes (domain/flow.js),
     so a shop that thinks better of a photograph gets its budget back. */
  A('photo.drop',    d => {
    if (d.kind === 'shop') flow.setShopPhoto(d.id, null);
    else if (d.kind === 'pro') flow.setPartnerPhoto(d.id, null);
    else flow.setProductPhoto(d.id, null);
    render();
  });
  A('photo.evidence',d => withPhoto({ maxEdge: 900, capture: true }, id => flow.addEvidence(d.id, d.label || 'Work done', id)));
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
  /* THE GROCERY ORDER WENT OUT WITH NOWHERE TO TAKE IT. The cart never asked
     for an address, so `customerAddress` was the empty string on every retail
     order ever placed and the rider got an area centroid. The field is on the
     cart now; this is where it is saved and where an order with no door is
     refused. Validated on the tap rather than by grewing the button out: the
     input sits on this same screen and a re-render on every keystroke would
     take the focus out from under her thumb. */
  /* priced on site — the promise the booking sheet has made since 8.0 */
  A('onsite.quote', d => {
    const el = document.getElementById('onSitePrice');
    const rupees = Number((el || {}).value || 0);
    if (!rupees) { toast('Put in what the job costs', 'warn'); if (el) el.focus(); return; }
    if (flow.proposeOnSitePrice(d.id, Math.round(rupees * 100))) render();
  });
  A('onsite.approve', d => flow.approveOnSitePrice(d.id).then(render));
  A('onsite.decline', d => flow.declineOnSitePrice(d.id).then(render));
  A('retail.refusereturn', d => {
    const el = document.getElementById('refuseWhy');
    if (flow.refuseReturn(d.id, el && el.value)) { render(); }
    else if (el) el.focus();
  });
  A('cart.place', async () => {
    const mode = shops.getCartMode();
    const saved = addr.saveAddress();
    if (addr.modeNeedsAddress(mode) && !addr.looksLikeAddress(saved && saved.address)) {
      toast('Add the flat or house and street — the rider needs a door', 'warn');
      const el = document.getElementById('bkAddr');
      if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
      return;
    }
    const o = await flow.placeRetailOrder(mode);
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
  /* Reads every [data-role="otp"] field and joins them, so it works whether the
     screen shows ONE code box (today) or the old four digit boxes (an order
     booked before codes replaced the per-job number). */
  A('otp.submit',    d => {
    const code = Array.from(document.querySelectorAll('[data-role="otp"]'))
      .map(el => el.value || '').join('').trim();
    flow.verifyOtp(d.id, code);
  });
  A('release.full',  d => flow.confirmAndRelease(d.id, 1).then(render));
  A('retail.settle', d => flow.settleRetail(d.id).then(render));
  /* the retail processes the machine declared but nothing drove */
  A('retail.out',       d => { flow.markLineUnavailable(d.id, d.line); render(); });
  A('retail.sub',       d => { flow.decideSubstitution(d.id, d.line, d.choice); render(); });
  A('retail.ready',     d => { flow.readyForPickup(d.id); render(); });
  /* The retail handover now checks the code the customer reads out, exactly as
     the service door does — it used to print her permanent code on the shop's
     screen and simply mark it done, so the check verified nothing. */
  const doorCode = () => Array.from(document.querySelectorAll('[data-role="otp"]'))
    .map(el => el.value || '').join('').trim();
  A('retail.collected', d => { if (flow.checkRetailCode(d.id, doorCode())) { flow.collected(d.id); render(); } });
  A('retail.delivered', d => { if (flow.checkRetailCode(d.id, doorCode())) { flow.advance(d.id, 'R_DELIVERED'); render(); } });
  /* ONE STALE ₹42 PACKET OF TURMERIC TOOK A ₹501 ORDER BACK WITH IT, atta and
     all. She picks the items now; picking none means the whole basket, which is
     the right answer when the problem is the delivery rather than an item. */
  A('retail.return', d => {
    const o = (getState().orders || []).find(x => x.id === d.id) || {};
    const lines = o.lines || [];
    /* SHE COMMITTED A RETURN WITHOUT EVER BEING SHOWN WHAT SHE WOULD GET BACK.
       Tick a box, tap a reason, done — no total, anywhere, at any point. Two
       audits reported committing blind, and the shop's side had the same hole.

       The figure is the one the engine actually refunds: what she was BILLED for
       that line, which on an over-weighed item is the quantity she agreed to and
       not the heavier quantity that was packed. */
    const billed = l => Math.round((l.unitPrice | 0)
      * (l.pickedQty != null ? Math.min(l.pickedQty, l.qty) : l.qty));
    const whole = lines.reduce((n, l) => n + billed(l), 0);
    sheet(i18n.t('ret.title'), `
    <p class="tiny muted" style="margin-bottom:12px">${esc(i18n.t('ret.whatCameBack'))}</p>
    ${lines.map(l => `<label class="m-kv" style="gap:10px;align-items:center">
        <input type="checkbox" class="retLine" value="${esc(l.lineId)}" data-amt="${billed(l)}" style="width:20px;height:20px;flex:none">
        <span class="grow">${esc(l.name)} × ${l.pickedQty != null ? l.pickedQty : l.qty}</span>
        <span class="num tiny">${M.fmt2(billed(l))}</span>
      </label>`).join('')}
    <div class="m-kv m-kv--total" style="margin-top:10px"><span>${esc(i18n.t('ret.comingBackToYou'))}</span>
      <span class="num" id="retTotal">${M.fmt2(whole)}</span></div>
    <p class="micro muted" id="retHint" style="margin:6px 0 12px">${esc(i18n.t('ret.noneMeansAll'))}</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${['Stale or spoiled', 'Wrong item', 'Short weight', 'Damaged / leaked', 'Not what I ordered'].map(r =>
        `<button class="chip" data-act="retail.return.pick" data-id="${esc(d.id)}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>`);

    /* and the hint stops saying "tick nothing and it all goes back" the moment
       she has ticked something — it was contradicting the screen it sat on */
    const boxes = [...document.querySelectorAll('.retLine')];
    const totalEl = document.getElementById('retTotal');
    const hintEl = document.getElementById('retHint');
    const paint = () => {
      const on = boxes.filter(b => b.checked);
      const sum = on.length ? on.reduce((n, b) => n + Number(b.dataset.amt || 0), 0) : whole;
      if (totalEl) totalEl.textContent = M.fmt2(sum);
      if (hintEl) hintEl.textContent = on.length
        ? i18n.t('ret.pickedN', { n: on.length })
        : i18n.t('ret.noneMeansAll');
    };
    boxes.forEach(b => b.addEventListener('change', paint));
  });
  A('retail.return.pick', d => {
    const picked = [...document.querySelectorAll('.retLine')].filter(c => c.checked).map(c => c.value);
    flow.requestReturn(d.id, d.reason, picked); closeSheet(); render();
  });
  /* SHE HAD ₹954 IN A BASKET AND NO WAY OUT. The engine has always allowed
     `R_PLACED -> R_CANCELLED` and `R_ACCEPTED -> R_CANCELLED`; nothing on her
     screen ever offered it, and four audits in a row reported being trapped
     with an order they had already paid for. It says the figure before she
     commits, like every other irreversible act in this app. */
  A('retail.cancel', d => {
    const o = (getState().orders || []).find(x => x.id === d.id) || {};
    sheet(i18n.t('order.cancelOrderTitle'), `
      <p class="tiny">${esc(i18n.t('order.notPackedYet', { shop: o.shopName || 'The shop' }))}</p>
      <div class="m-kv m-kv--total" style="margin-top:14px"><span>${esc(i18n.t('ret.comingBackToYou'))}</span>
        <span class="num">${M.fmt2(o.customerPays | 0)}</span></div>
      <button class="btn btn--danger btn--block" style="margin-top:16px"
        data-act="retail.cancel.do" data-id="${esc(d.id)}">${esc(i18n.t('order.cancelOrder', { amount: M.fmtMax(o.customerPays | 0) }))}</button>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px" data-act="sheet.close">${esc(i18n.t('pay.notNow'))}</button>`);
  });
  A('retail.cancel.do', async d => {
    await flow.refundRetail(d.id, 'cancelled by the customer before packing');
    closeSheet(); render();
  });
  A('retail.acceptreturn', d => flow.acceptReturn(d.id).then(render));
  A('stage.picking', d => flow.advance(d.id, 'R_PICKING'));
  A('stage.packed',  d => flow.advance(d.id, 'R_PACKED'));
  A('stage.out',     d => flow.advance(d.id, 'R_OUT'));
  A('stage.delivered', d => flow.advance(d.id, 'R_DELIVERED'));
  A('chat.send',     d => {
    const el = document.getElementById('chatIn');
    if (el && el.value.trim()) { flow.sendChat(d.id, el.value.trim()); el.value = ''; render(); }
  });
  A('dispute.open',  d => ordersView.openDispute(d.id));
  /* ONE TAP, NO CONFIRMATION, NO UNDO — AND IT FREEZES THE WHOLE ORDER. An
     auditor meant to tap "Charged too much", the sheet shifted, and
     "It never arrived" was filed instantly against an order that had arrived,
     freezing ₹658.29 on both sides with no way back. Every other irreversible
     act in this app states what it will do and waits: the cancel sheet, the
     withdrawal sheet, the return. This one did not.
     Choosing a reason now shows it back and asks. */
  A('dispute.pick', d => {
    const o = (getState().orders || []).find(x => x.id === d.id) || {};
    sheet(i18n.t('order.reportConfirmTitle'), `
      <div class="m-kv m-kv--total" style="margin-top:4px"><span>${esc(d.reason)}</span></div>
      <p class="tiny" style="margin:12px 0 0">${esc(i18n.t('order.reportConfirmBody', {
        amount: M.fmt2((o.customerPays | 0)) }))}</p>
      <button class="btn btn--danger btn--block" style="margin-top:16px"
        data-act="dispute.send" data-id="${esc(d.id)}" data-reason="${esc(d.reason)}">${esc(i18n.t('order.reportConfirmGo'))}</button>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
        data-act="dispute.open" data-id="${esc(d.id)}">${esc(i18n.t('order.reportPickAgain'))}</button>`);
  });
  A('dispute.send', d => { closeSheet(); ordersView.submitDispute(d.id, d.reason); });
  A('cancel.open',   d => ordersView.openCancel(d.id));
  /* THE ESCAPES THAT EXISTED IN THE ENGINE AND ON THE PUBLISHED REFUNDS PAGE,
     but that nothing on screen could reach: a customer whose pro never came,
     and a pro who cannot make it and is required by his own agreement to say so. */
  A('noshow.open',      d => ordersView.openNoShow(d.id));
  A('noshow.confirm',   async d => { await flow.cancelOrder(d.id, 'WORKER_NO_SHOW'); closeSheet(); render(); });
  /* THIS SHEET WAS NOT TRUE. It promised "you keep your stake" while
     domain/flow.js forfeited it to the customer on WORKER_CANCEL, and it never
     mentioned the Rs.100 the public refunds page has charged him in writing
     since 8.0. He was told the honest route was free, and it cost him the same
     as a no-show. The engine now does what this sheet says; this sheet now
     says what the engine does, including the part he will not like. */
  A('worker.cancel',    d => sheet(i18n.t('sheet.cannotDo'), `
    <p>${esc(i18n.t('sheet.cancelBody'))}</p>
    <p class="micro muted" style="margin-top:10px">${esc(i18n.t('sheet.cancelCost', { amount: M.fmt(CANCEL_RULES.WORKER_CANCEL.workerFee) }))}</p>
    <button class="btn btn-primary btn--block" style="margin-top:14px" data-act="worker.cancel.do" data-id="${esc(d.id)}">${esc(i18n.t('sheet.cancelDo'))}</button>
    <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px" data-act="sheet.close">${esc(i18n.t('sheet.keepJob'))}</button>`));
  A('code.retry', d => { flow.retryDoorCode(d.id); render(); });
  A('worker.cancel.do', async d => { await flow.workerCancel(d.id); closeSheet(); render(); });
  A('cancel.confirm',d => { flow.cancelOrder(d.id, d.rule); closeSheet(); render(); });

  /* partner + shop console */
  A('partner.online', () => {
    const p = getState().partners.find(x => x.userKey === me().key);
    if (p) { ctx.store.dispatch({ type:'partner/patch', payload:{ id:p.id, patch:{ online: p.online === false } } }); render(); }
  });
  // was an explanatory sheet with nothing behind it; it is the ladder now
  A('partner.upgrade', () => go('onboard'));
  A('shop.tab',    d => { partner.setShopTab(d.tab); render(); });
  /* a shop's takings need an account to land in, and a control to send them */
  A('pro.upi', d => {
    const pr = (ctx.store.getState().partners || []).find(x => x.id === d.id) || {};
    sheet(i18n.t('sheet.whereePaid'), `
      <p class="tiny muted" style="margin-bottom:12px">${esc(i18n.t('sheet.paidBody'))}</p>
      <div class="field"><input id="prUpi" autocomplete="off" spellcheck="false" placeholder=" "
        value="${esc((pr.verification || {}).upi || '')}"><label>${esc(i18n.t('sheet.upiLabel'))}</label></div>
      <button class="btn btn-primary btn--block" data-act="pro.upi.save" data-id="${esc(d.id)}">${esc(i18n.t('sheet.save'))}</button>`);
  });
  A('pro.upi.save', d => {
    const pr = (ctx.store.getState().partners || []).find(x => x.id === d.id);
    const v = (document.getElementById('prUpi') || {}).value || '';
    if (pr && verification.submitPayout(pr, v)) { closeSheet(); render(); }
  });
  A('shop.upi', d => sheet(i18n.t('sheet.shopPaid'), `
    <p class="tiny muted" style="margin-bottom:12px">${esc(i18n.t('sheet.shopPaidBody'))}</p>
    <div class="field"><input id="shUpi" autocomplete="off" spellcheck="false" placeholder=" "
      value="${esc((ctx.store.getState().shops.find(x => x.id === d.id) || {}).upi || '')}"><label>${esc(i18n.t('sheet.upiLabel'))}</label></div>
    <button class="btn btn-primary btn--block" data-act="shop.upi.save" data-id="${esc(d.id)}">${esc(i18n.t('sheet.save'))}</button>`));
  A('shop.upi.save', d => {
    const v = (document.getElementById('shUpi') || {}).value || '';
    if (flow.setShopUpi(d.id, v)) { closeSheet(); render(); }
  });
  /* THE ONE IRREVERSIBLE CONTROL ON THE SCREEN, AND IT FIRED ON ONE TAP. A ₹40
     cancellation gets a full confirm sheet; sending a shop's entire takings to
     UPI did not. It cannot be pulled back, and there is no part-payment yet, so
     both facts are said before it happens rather than after. */
  A('shop.withdraw', d => {
    const s0 = ctx.store.getState().shops.find(x => x.id === d.id) || {};
    payoutSheet(d.id, flow.shopWallet(d.id).balance, s0.upi, 'shop.withdraw.do');
  });
  A('shop.withdraw.do', async d => {
    await flow.shopWithdraw(d.id, poAmt(flow.shopWallet(d.id).balance)); closeSheet(); render();
  });

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
  /* the outcome now needs a line saying why — both sides are shown it */
  A('admin.resolve', d => sheet('Why this outcome?', `
    <p class="tiny muted" style="margin-bottom:12px">Both the customer and the professional are shown this,
      on the job. One plain sentence is enough — it is what stops a decision feeling arbitrary.</p>
    <div class="field"><textarea id="dsWhy" rows="3" placeholder=" "></textarea>
      <label>What you decided, and why</label></div>
    <button class="btn btn-primary btn--block" data-act="admin.resolve.do"
      data-id="${esc(d.id)}" data-out="${esc(d.out)}">Resolve this dispute</button>`));
  A('admin.resolve.do', d => {
    const why = (document.getElementById('dsWhy') || {}).value || '';
    Promise.resolve(admin.resolve(d.id, d.out, why)).then(() => { closeSheet(); render(); });
  });
  A('admin.refundretail', d => admin.refundRetail(d.id));
  A('admin.hidereview', d => admin.hideReview(d.id));
  A('admin.flag',    d => admin.toggleFlag(d.name));
  A('admin.runtests',() => admin.runTests());
  A('admin.verifychain', () => admin.doVerifyChain());
  A('admin.snapshot',() => admin.snapshot());
  A('admin.restore', d => admin.restore(d.key));
  A('admin.fresh',   () => admin.freshStart && admin.freshStart());
  A('admin.payments.save',  () => admin.savePayments());
  A('nav.nearby',  () => go('nearby'));                                   // the neighbourhood screen
  A('nav.chat',    d => go('chat', d.id));                                // the thread with the pro
  A('admin.payments.clear', () => admin.clearPayments());
  A('admin.automation.push',  () => admin.pushAutomation && admin.pushAutomation());
  A('admin.automation.reset', () => admin.resetAutomation && admin.resetAutomation());
  A('admin.treasury.withdraw', d => admin.treasuryWithdraw && admin.treasuryWithdraw(d));
  A('admin.treasury.remit',    d => admin.treasuryRemit && admin.treasuryRemit(d));
  /* peer verification + the customer's wallet (views: pro.js, partner.js, account.js) */
  A('vouch.give',   d => { const r = autoverify.vouch(d.id); toast(r.ok ? 'Thank you — your vouch counts.' : r.reason, r.ok ? '' : 'warn'); render(); });
  A('ref.send',     () => { const p = myPartner(); const code = p && autoverify.sendReferenceCode(p); partner.showReferenceCode && partner.showReferenceCode(code); render(); });
  A('ref.confirm',  d => { const p = myPartner(); const ok = p && autoverify.confirmReference(p, d.code || (document.getElementById('refCode') || {}).value); toast(ok ? 'Reference confirmed.' : 'That code is not right', ok ? '' : 'danger'); render(); });
  /* chips carry paise; the field is rupees, and it may now carry paise after
     the point — `Math.round` on rupees x 100 is what keeps 18.70 as 1870 rather
     than 1869.9999 */
  const cwAmt = d => Number(d.amt) || Math.round(Number((document.getElementById('cwAmt') || {}).value || 0) * 100);
  A('cwallet.topup',    d => flow.customerTopUp(cwAmt(d)).then(() => { closeSheet(); render(); }));
  A('cwallet.withdraw', d => flow.customerWithdraw(cwAmt(d)).then(render));
  /* the exact balance, to the paisa, with nothing typed and nothing rounded —
     the one amount she could never successfully enter by hand */
  A('cwallet.withdrawAll', () => {
    const s0 = me(); if (!s0) return;
    flow.customerWithdraw(flow.customerWallet(s0.key).balance).then(render);
  });
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
      /* Only the legacy four-box layout auto-advances; the single code field
         has nowhere to advance to. */
      case 'otp': {
        const i = Number(t.id.replace('otp', ''));
        if (Number.isFinite(i) && t.value && i < 3) document.getElementById('otp' + (i + 1))?.focus();
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
    /* the weight the shop actually put on the scale — committed on blur, like a
       price, so typing "1.25" does not re-quote the order three times */
    if (t.dataset.role === 'picked' && v) { flow.setPickedQty(t.dataset.id, t.dataset.line, v); }
    /* the shop's own delivery dials, committed on blur like a price */
    if (t.dataset.role === 'shopmin' && v !== '') {
      ctx.store.dispatch({ type: 'shop/patch', payload: { id: t.dataset.id, patch: { minOrder: Math.max(0, Number(v) || 0) * 100 } } });
      toast('Minimum order saved'); render();
    }
    if (t.dataset.role === 'shopfree' && v !== '') {
      const n = Math.max(0, Number(v) || 0) * 100;
      ctx.store.dispatch({ type: 'shop/patch', payload: { id: t.dataset.id, patch: { freeDeliveryAbove: n } } });
      toast(n ? 'Free-delivery threshold saved' : 'Free delivery is off — the customer pays it'); render();
    }
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
  /* A save that failed has to reach the screen on the next paint, not whenever
     something else happens to re-render. */
  bus.on('persist:failed', () => render());
  bus.on('persist:recovered', () => render());
  window.addEventListener('beforeunload', () => persist.flush(persist.KEYS.state));

  if (!mig.state.createdAt) store.dispatch({ type: 'meta/born', payload: Date.now() });

  /* DEMO NEVER LEAKS. A device that was walked with ?demo=1 and now opens the
     app without it drops the example roster before anything else happens —
     the owner's credential and dials stay (domain/fresh.js). */
  const demoMode = new URLSearchParams(location.search).get('demo') === '1' || !!new URLSearchParams(location.search).get('shot');
  let purged = false;
  { const cleaned = fresh.purgeIfDemoResidue(store.getState(), demoMode);
    if (cleaned !== store.getState()) { store.replaceState(cleaned, 'demo-purge'); persist.flush(persist.KEYS.state); purged = true; console.info('[saahaa] demo roster removed — production starts empty'); } }

  /* ?demo=1 WAS A ONE-SHOT, AND THE README HANDED YOU THE GUN. Opening the app
     once without ?demo — running ?selftest=1, say, which the README lists one
     line above ?demo=1 — purged the roster and left `seeded: true`, so ?demo=1
     never seeded again and the device read "0 pros · 0 shops" for ever. It
     also silently broke tools/shots.py. A purge that removes the demo data must
     also clear the flag that says demo data exists. */
  if (purged && !demoMode) store.dispatch({ type: 'seed/reset' });

  /* AND IT WAS STILL A ONE-SHOT, ONE FIX LATER. The guard is `!seeded` -- but a
     plain first visit seeds EMPTY and sets `seeded: true`, so every device that
     had ever been opened without the flag was permanently immune to it. An
     audit signed up on the empty build, then opened ?demo=1 and sat looking at
     "0 pros · 0 shops"; SIM_MARKET is set inside this same block, so nobody
     ever acted on the other side of a single one of their orders and every
     order froze at "step 2 of 7". They reported the product as unable to
     complete a transaction. It could; there was simply nobody home.

     ?demo=1 means "make this device a demo device", and it has to mean that on
     the second visit too. The simulator is switched on regardless, and a device
     whose roster is EMPTY gets the roster -- partners, shops and products only.
     `users` is deliberately left alone: whoever is signed in stays signed in,
     and a populated device is never overwritten by a query string. */
  const demoWanted = new URLSearchParams(location.search).get('demo') === '1'
    || !!new URLSearchParams(location.search).get('shot');
  if (demoWanted) flags.set('SIM_MARKET', true);
  const st0 = store.getState();
  const bareRoster = !(st0.partners || []).length && !(st0.shops || []).length;
  if (st0.seeded && demoWanted && bareRoster) {
    const seed = await buildSeed();
    store.dispatch({ type: 'seed/partners', payload: seed.partners });
    store.dispatch({ type: 'seed/shops',    payload: seed.shops });
    store.dispatch({ type: 'seed/products', payload: seed.products });
    persist.flush(persist.KEYS.state);
    console.info('[saahaa] demo roster loaded onto an already-seeded device');
  }

  if (!store.getState().seeded) {
    /* Production starts EMPTY. The demo seed (example customers, pros, shops,
       products) loads only when explicitly asked for: ?demo=1 — used by the
       deck capture and local testing, never by a real device. */
    const demo = new URLSearchParams(location.search).get('demo') === '1' || new URLSearchParams(location.search).get('shot');
    const seed = demo ? await buildSeed() : await buildSeed({ empty: true });
    if (demo) flags.set('SIM_MARKET', true);
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
  /* "see Admin → System" to whoever happened to be holding the phone. */
  if (health.fatal) { flags.safeMode(); toast(i18n.t('sys.safeMode'), 'danger'); }

  gateway.useOpener(checkout.open);            // how Razorpay Checkout is shown, when the rail is live
  initActions();
  wireActions();
  wireInputs();

  /* route from the hash so links and refreshes work */
  const applyHash = () => {
    const [, v, p] = (location.hash || '#/home').split('/');
    if (ROUTES[v]) { ctx.view = v; ctx.param = p || null; }
  };
  applyHash();
  /* admin.html is the console and nothing else — it does not carry the customer
     app's tabs, and no hash can take it somewhere else. */
  if (ADMIN_HOST) { ctx.view = 'admin'; ctx.param = null; }
  // A sheet must never outlive its screen. go() closes it, but hash-driven
  // navigation (browser back, a pasted deep link) bypassed go() entirely and
  // left the previous screen's sheet sitting on top of the new one.
  window.addEventListener('hashchange', () => {
    if (selfNav) { selfNav = false; return; }   // our own echo: go() already rendered
    closeSheet(); applyHash(); render();
  });

  /* The purge above is all-or-nothing on purpose: an order or a ledger leg
     pointing at an example account cannot be left dangling. That means an
     account signed up by hand DURING a ?demo=1 session goes with the roster,
     which is right for a demo phone and baffling if nobody says so. */
  if (purged) setTimeout(() => toast('Example data removed — this device is a fresh install now', 'warn'), 400);

  ctx.ready = true;
  /* ?shot=<scene> — the presentation capture switch. A dev-only module that
     seeds a real state and walks to a real screen so headless Chrome can
     photograph it. Never loaded otherwise; it is UI tooling, not product. */
  const shot = new URLSearchParams(location.search).get('shot');
  /* A BROKEN SCENE MUST NOT PHOTOGRAPH QUIETLY. This used to swallow the error
     into console.error, so when 8.4.0 deleted the functions a scene called, the
     capture tool went on producing blank and wrong slides for the deck and
     nobody found out until an audit read the source. Now the failure is painted
     onto the page: the screenshot shows the error, which is impossible to miss
     and impossible to publish by accident. */
  if (shot) {
    import('./ui/deckscenes.js').then(m => m.run(shot)).catch(e => {
      console.error('[shot]', e);
      const el = document.getElementById('app');
      if (el) el.innerHTML = `<main class="wrap"><div class="card" style="margin-top:40px;border:2px solid var(--color-accent)">
        <b style="color:var(--color-accent)">Scene &ldquo;${esc(shot)}&rdquo; failed</b>
        <p class="tiny" style="margin-top:8px">${esc(e && e.message ? e.message : String(e))}</p>
        <p class="micro muted" style="margin-top:6px">src/ui/deckscenes.js — fix the scene, do not publish this slide.</p>
      </div></main>`;
    });
  }
  // the WORK_DONE screen promises auto-release; this is what keeps it
  /* THE SWEEPS ONLY EVER RAN AT BOOT, so "auto-releases in 6h" and "released
     after 7 days" quietly meant "the next time somebody opens the app". On a
     phone that can be days. They run on a timer now as well, so a promise with
     an hour count on it is kept by the clock rather than by a page load.
     (A real backend runs these server-side; until then this is the honest
     approximation, and it is cheap — each is a filter over a bounded list.) */
  const sweepAll = () => {
    flow.sweepAutoRelease().then(n => { if (n) { console.info('[saahaa] auto-released', n); render(); } });
    flow.sweepHoldbacks().then(n => { if (n) { console.info('[saahaa] holdbacks released', n); render(); } });
    flow.sweepUnaccepted().then(n => { if (n) { console.info('[saahaa] unaccepted refunded', n); render(); } });
  };
  flow.assertBookOk('boot');
  sweepAll();
  setInterval(sweepAll, 60 * 1000);
  /* coming back to a phone that slept for hours must not wait for the next tick */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sweepAll(); });
  /* Pictures outlive the records that pointed at them — a deleted product, a
     closed shop. They cost a device's storage until something collects them. */
  { const n = flow.sweepPhotos(); if (n) console.info('[saahaa] reclaimed', n, 'unused photo(s)'); }
  /* APPROVALS HAPPEN BY THEMSELVES. After any state change settles, the sweep
     promotes whoever has earned the next tier (domain/autoverify.js). A
     promotion changes state, which schedules one more sweep, which finds
     nothing — so it always comes to rest. */
  let sweepT = null;
  const scheduleSweep = () => { clearTimeout(sweepT); sweepT = setTimeout(() => {
    try { const made = autoverify.sweepAutoApprovals(); if (made.length) { made.forEach(m => console.info('[saahaa] auto-approved', m.name, '→ tier', m.tier)); render(); } }
    catch (e) { console.error('[autoverify]', e); } }, 250); };
  store.subscribe(scheduleSweep); scheduleSweep();
  startUpdateWatch((v, apply) => stickyToast(`SAAHAA ${v.version || ''} is ready.`, 'Tap to update — takes a second, nothing is lost.', apply));
  // the 90-second substitution promise, kept while the app is open
  setInterval(() => { if (flow.sweepSubstitutions()) render(); }, 15000);

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
      <h1>SAAHAA could not start</h1><p>${String(err.message).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>
      <p style="opacity:.6">v${VERSION} · ${BUILD_ID}</p>
      <button id="bootReset">Reset local data and retry</button>
    </main>`;
});
