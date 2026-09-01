/* SAAHAA · app.js — bootstrap and router. This is the ONLY file that knows
   about every other module, and it does nothing but wire them together. */

import { VERSION, SCHEMA_VERSION, BUILD_ID } from './core/version.js';
import { ctx, getState, me } from './core/ctx.js';
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
import { AREA_NAMES } from './domain/match.js';
import './core/selftests.js';

/* ui */
import { mount, action, initActions, toast, sheet, closeSheet, esc } from './ui/dom.js';
import { defs, mark } from './ui/logo.js';
import { showSplash, replaySplash } from './ui/splash.js';
import * as home from './ui/views/home.js';
import * as shops from './ui/views/shops.js';
import * as ordersView from './ui/views/orders.js';
import * as auth from './ui/views/auth.js';
import * as partner from './ui/views/partner.js';
import * as admin from './ui/views/admin.js';

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
  account:   () => accountView(),
};

const NAV = [
  ['home',   '🏠', 'Home'],
  ['shops',  '🛒', 'Shops'],
  ['orders', '🧾', 'Orders'],
  ['console','🧰', 'Work'],
  ['account','👤', 'You'],
];

let history = [];

function go(view, param) {
  closeSheet();                       // a sheet must never outlive its screen
  if (ctx.view !== view || ctx.param !== param) history.push([ctx.view, ctx.param]);
  ctx.view = view; ctx.param = param ?? null;
  if (view !== 'admin') location.hash = param ? `#/${view}/${param}` : `#/${view}`;
  else location.hash = '#/admin';
  window.scrollTo(0, 0);
  render();
}
function back() {
  const prev = history.pop();
  if (prev) { ctx.view = prev[0]; ctx.param = prev[1]; render(); }
  else go('home');
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
  mount('app', body + (showNav ? navBar() : ''));
}

function navBar() {
  const s = me();
  const cur = ctx.view === 'shop' ? 'shops' : ctx.view === 'order' ? 'orders'
            : ctx.view === 'partner' || ctx.view === 'shopadmin' ? 'console' : ctx.view;
  return `<nav class="nav on-plum" role="tablist">
    ${NAV.map(([id, ic, label]) => `<button role="tab" aria-selected="${cur === id}"
      data-act="nav.tab" data-tab="${id}">
      <span class="ic" aria-hidden="true">${ic}</span>${label}</button>`).join('')}
  </nav>`;
}

function accountView() {
  const s = me();
  if (!s) return auth.render();
  return `${shops.header('Your account', esc(s.mobile))}
  <main class="wrap">
    <div class="card on-plum" style="margin-top:var(--sp-6);border:0">
      <div class="row">
        <span style="width:54px;height:54px;border-radius:50%;background:var(--accent-fill);
          color:var(--accent-on-fill);display:grid;place-items:center;font-weight:800;font-size:21px">
          ${esc(s.name[0])}</span>
        <div class="grow"><b style="font-size:18px">${esc(s.name)}</b>
          <p class="tiny muted">${esc(s.role)} · ${esc(s.area)}</p></div>
      </div>
    </div>
    <div class="sec">
      ${[['nav.orders','🧾 Your orders'],['area.pick','📍 Change area'],
         ['splash.replay','✨ Replay the welcome screen'],['theme.toggle','◐ Light / dark'],
         ['nav.admin','🛡 Admin console'],['selftest.run','🧪 Run self-test']]
        .map(([a, l]) => `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:8px;padding:14px"
          data-act="${a}">${l}</button>`).join('')}
      <button class="btn btn--ghost btn--block" style="margin-top:12px;color:var(--danger)"
        data-act="auth.logout">Sign out</button>
    </div>
    <div class="credo"><div class="cmark">${mark(150, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:8px">v${VERSION} · schema v${SCHEMA_VERSION} · ${BUILD_ID}</p></div>
  </main>`;
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
  A('scroll.all',  () => document.getElementById('shopsSec')?.scrollIntoView({ behavior: 'smooth' }));
  A('nav.tab', d => {
    if (d.tab === 'console') {
      const s = me();
      go(!s ? 'auth' : s.role === 'shop' ? 'shopadmin' : s.role === 'partner' ? 'partner' : 'account');
    } else go(d.tab);
  });
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
    if (ctx.session) ctx.session = { ...ctx.session, area: d.area };
    else ctx.session = null, localStorage.setItem('SAAHAA_GUEST_AREA', d.area);
    closeSheet(); toast(`Serving ${d.area}`); render();
  });

  /* search */
  A('search.clear', () => { home.setSearch(''); render(); });

  /* catalog + booking */
  A('cat.open',      d => home.openCategory(d.id));
  A('book.sub',      d => home.openCategory(d.id));
  A('book.others',   d => home.showAlternates(d.id));
  A('book.confirm',  d => home.confirmBooking(d.id, d.pid));
  A('quick.emergency', () => { home.setSearch('repair'); render(); toast('Showing urgent-capable trades'); });
  A('quick.nearby',    () => go('shops'));
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
  A('cart.mode',  d => { cartMode = d.mode; render(); });
  A('cart.place', async () => {
    const o = await flow.placeRetailOrder(cartMode);
    if (o) { toast('Order placed'); go('order', o.id); }
  });
  A('rx.info', () => sheet('Prescription needed', `<p>This medicine needs a valid prescription.
    Upload it at checkout — the chemist cannot pack it until a pharmacist has verified it.</p>
    <p class="tiny muted" style="margin-top:12px">Prescription items are never substituted and cannot be returned.</p>`));

  /* order lifecycle */
  A('order.open',    d => go('order', d.id));
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
  A('partner.upgrade', () => sheet('Get verified', `
    <p>Verification unlocks bigger jobs, the Verified badge and faster payouts.</p>
    <p class="tiny muted" style="margin-top:12px">
      In the prototype an admin promotes you from the Approvals queue. In production this is
      Aadhaar name-match, a selfie check and — for in-home work — police verification.</p>`));
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
  A('admin.approve', d => admin.approve(d.id));
  A('admin.suspend', d => admin.suspend(d.id));
  A('admin.release', d => admin.release(d.id, d.pct));
  A('admin.resolve', d => admin.resolve(d.id, d.out));
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
  A('admin.markpaid',() => toast('Marked paid — record the UTR in production'));
  A('selftest.run',  () => admin.runTests());
}

let cartMode = 'rider';
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
      case 'price':         partner.priceEdit(t.dataset.id, t.value); break;
      case 'stock':         partner.stockEdit(t.dataset.id, t.value); break;
      case 'otp': {
        const i = Number(t.id.replace('otp', ''));
        if (t.value && i < 3) document.getElementById('otp' + (i + 1))?.focus();
        break;
      }
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
  window.addEventListener('hashchange', () => { applyHash(); render(); });

  ctx.ready = true;

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
