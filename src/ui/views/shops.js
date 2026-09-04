/* SAAHAA · ui/views/shops.js — retail: shop list, shop page with real product
   listings, the one-shop cart, and checkout.

   The provisional-vs-final total is a first-class idea here: anything sold by
   weight shows "est." until the shop weighs it. Hiding that is the single
   biggest trust bug in Indian grocery apps (V1/V2, both ballots). */

import { esc, sheet, closeSheet, toast, ratingStars } from '../dom.js';
import { ctx, getState, me, myArea, isGuest } from '../../core/ctx.js';
import { live, get } from '../../core/registry.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { rankShops, kmBetween, etaMins } from '../../domain/match.js';
import { mark } from '../logo.js';

let shopFilter = '';
export const setShopFilter = v => { shopFilter = v; };

/* The delivery mode lives here, next to the view that renders it. It used to
   live in app.js while this file hardcoded 'rider', so tapping "I'll pick up"
   moved no highlight and left the total showing a delivery fee the customer
   was not going to be charged. Displayed price and charged price must be the
   same number, always. */
let cartMode = 'rider';
export const setCartMode = m => { cartMode = m; };
export const getCartMode = () => cartMode;

const BADGE_LABEL = {
  verified_shop:'Verified shop', fssai:'FSSAI', reliable_stock:'Reliable stock',
  mrp_parity:'MRP parity', fresh_today:'Fresh today', weighs_right:'Weighs right',
};

/* ── shop list ─────────────────────────────────────────────── */
export function renderList(catId) {
  const st = getState();
  const retailCats = live('category').filter(c => c.kind === 'retail');
  if (!retailCats.length) return `${header('Shops near you', '')}<main class="wrap">
    ${emptyBlock('No shop categories are live', 'Every retail category is currently switched off.')}</main>`;
  const active = catId && get('category', catId).kind === 'retail' ? catId : null;
  const shops = rankShops(st.shops, { catId: active || retailCats[0].id, area: myArea() });

  return `
  ${header('Shops near you', `${myArea()} · ${shops.length} open`)}
  <main class="wrap">
    <div class="chiprow" style="margin:var(--sp-6) 0">
      ${retailCats.map(c => `<button class="chip ${c.id === (active || retailCats[0].id) ? 'on' : ''}"
        data-act="shops.cat" data-id="${c.id}">${c.ico} ${esc(c.name)}</button>`).join('')}
    </div>
    ${shops.length ? shops.map(shopCard).join('') : emptyBlock('No shops here yet', 'Try another category or area.')}
    <div style="height:40px"></div>
  </main>`;
}

function shopCard(s) {
  const cat = get('category', s.catId);
  const products = getState().products.filter(p => p.shopId === s.id && p.active && (!p.trackStock || p.stockQty > 0));
  return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:12px"
      data-act="shop.open" data-id="${s.id}">
    <div class="row" style="align-items:flex-start">
      <span class="med" style="width:48px;height:48px;border-radius:var(--r-md);background:var(--accent-soft);
        display:grid;place-items:center;font-size:22px;flex:0 0 auto">${cat.ico}</span>
      <div class="grow">
        <div class="between"><b style="font-size:16px">${esc(s.name)}</b>
          <span class="badge ${s.isOpen ? 'badge--ok' : 'badge--bad'}">${s.isOpen ? 'Open' : 'Closed'}</span></div>
        <p class="tiny muted" style="margin-top:3px">
          ${ratingStars(s.ratingAvg)} ${s.ratingAvg} (${s.ratingCount}) · ${s.km} km · ~${s.eta} min ·
          ${products.length} items
        </p>
        <div class="row" style="gap:5px;margin-top:7px;flex-wrap:wrap">
          ${(s.badges || []).map(b => `<span class="badge badge--soft">${esc(BADGE_LABEL[b] || b)}</span>`).join('')}
          <span class="badge badge--info">${s.fillRate}% items in stock</span>
        </div>
        <p class="micro muted" style="margin-top:6px">
          Min ${M.fmt(s.minOrder)} · free delivery over ${M.fmt(s.freeDeliveryAbove)}
          ${s.fssai ? ` · FSSAI ${esc(s.fssai)}` : ''}${s.drugLicence ? ` · DL ${esc(s.drugLicence)}` : ''}
        </p>
      </div>
    </div>
  </button>`;
}

/* ── one shop, with its catalogue ──────────────────────────── */
export function renderShop(shopId) {
  const st = getState();
  const raw = st.shops.find(x => x.id === shopId);
  if (!raw) return renderList(null);
  /* distance/ETA are derived, not stored — a shop opened by deep link has not
     been through rankShops, so compute them here rather than render blanks. */
  const km = kmBetween(myArea(), raw.area);
  const s = { ...raw, km, eta: raw.prepMins + etaMins(km) };
  const cat = get('category', s.catId);
  const q = shopFilter.trim().toLowerCase();
  let items = st.products.filter(p => p.shopId === s.id && p.active);
  if (q) items = items.filter(p => p.name.toLowerCase().includes(q) || p.aisle.toLowerCase().includes(q));
  const aisles = [...new Set(items.map(p => p.aisle))];
  const cart = flow.getCart();
  const count = cart && cart.shopId === s.id ? cart.lines.reduce((n, l) => n + l.qty, 0) : 0;

  return `
  ${header(s.name, `${cat.ico} ${cat.name} · ${s.km} km · ~${s.eta} min`)}
  <main class="wrap">
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:var(--sp-6) 0">
      ${(s.badges || []).map(b => `<span class="badge badge--soft">${esc(BADGE_LABEL[b] || b)}</span>`).join('')}
      <span class="badge ${s.isOpen ? 'badge--ok' : 'badge--bad'}">${s.isOpen ? 'Open now' : 'Closed'}</span>
    </div>

    <div class="search" style="margin-bottom:var(--sp-6)">
      <span aria-hidden="true">🔎</span>
      <input id="shopq" type="search" placeholder="Search in ${esc(s.name)}" value="${esc(shopFilter)}"
             data-role="shopsearch" aria-label="Search this shop">
    </div>

    ${cat.variableWeight ? `<p class="tiny" style="background:var(--warn-soft);color:var(--warn);
      padding:10px 12px;border-radius:var(--r-md);margin-bottom:var(--sp-6)">
      ⚖️ Items sold by weight show an estimate. Your final bill uses the actual weighed weight.</p>` : ''}

    ${aisles.length ? aisles.map(a => `
      <div class="sec"><div class="hd"><h2>${esc(a)}</h2></div>
        ${items.filter(p => p.aisle === a).map(productRow).join('')}
      </div>`).join('') : emptyBlock('Nothing listed yet', 'This shop has not added products for this search.')}

    <div style="height:100px"></div>
  </main>
  ${count ? `<div style="position:fixed;left:0;right:0;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));
      z-index:var(--z-sticky);padding:10px var(--gutter)">
      <button class="btn btn--primary btn--lg btn--block" data-act="nav.cart">
        ${count} item${count === 1 ? '' : 's'} · View cart →</button></div>` : ''}`;
}

function productRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  const low = p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt;
  const off = p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  return `<div class="card" style="margin-bottom:8px;padding:12px;${out ? 'opacity:.5' : ''}">
    <div class="between">
      <div class="grow">
        <b style="font-size:14px">${esc(p.name)}</b>
        <p class="micro muted" style="margin-top:2px">
          ${esc(p.unit)}${p.variableWeight ? ' · weighed at packing' : ''}
          ${p.coldChain ? ' · ❄️ cold chain' : ''}${p.rxRequired ? ' · 📋 prescription needed' : ''}
          ${p.perishable && p.mfgDate ? ' · packed today' : ''}
        </p>
        <div class="row" style="gap:8px;margin-top:6px">
          <b class="num" style="font-size:16px">${M.fmt(p.price)}</b>
          ${off ? `<span class="strike tiny num">${M.fmt(p.mrp)}</span>
                   <span class="badge badge--ok">${off}% off</span>` : ''}
          ${low ? `<span class="badge badge--warn">Only ${p.stockQty} left</span>` : ''}
        </div>
      </div>
      ${out ? '<span class="badge badge--bad">Out of stock</span>'
            : p.rxRequired ? `<button class="btn btn--secondary btn--sm" data-act="rx.info">Rx</button>`
            : `<button class="btn btn--primary btn--sm" data-act="cart.add" data-id="${p.id}">Add</button>`}
    </div>
  </div>`;
}

/* ── cart ──────────────────────────────────────────────────── */
export function renderCart() {
  const cart = flow.getCart();
  if (!cart || !cart.lines.length)
    return `${header('Your cart', '')}<main class="wrap">
      ${emptyBlock('Cart is empty', 'Add items from any shop near you.',
        '<button class="btn btn--secondary" data-act="nav.shops">Browse shops</button>')}</main>`;

  const q = flow.cartQuote(cartMode);
  if (!q) { flow.clearCart(); return renderCart(); }   // shop vanished under us
  const provisional = cart.lines.some(l => l.variableWeight);

  return `
  ${header('Your cart', q.shop.name)}
  <main class="wrap">
    ${cart.lines.map(l => `
      <div class="card" style="margin:10px 0;padding:12px">
        <div class="between">
          <div class="grow"><b style="font-size:14px">${esc(l.name)}</b>
            <p class="micro muted">${M.fmt(l.unitPrice)} ${esc(l.unit)}${l.variableWeight ? ' · est.' : ''}</p>
            <div class="chiprow" style="margin-top:8px">
              ${['similar','call','refund'].map(pol => `
                <button class="chip ${l.subPolicy === pol ? 'on' : ''}" style="height:28px;font-size:11px"
                  data-act="cart.sub" data-id="${l.lineId}" data-pol="${pol}">
                  ${pol === 'similar' ? 'Similar brand OK' : pol === 'call' ? 'Ask me' : 'Just refund'}
                </button>`).join('')}
            </div>
          </div>
          <div style="text-align:right">
            <div class="row" style="gap:8px;justify-content:flex-end">
              <button class="btn btn--ghost btn--sm tap" data-act="cart.dec" data-id="${l.lineId}">−</button>
              <b class="num">${l.qty}</b>
              <button class="btn btn--ghost btn--sm tap" data-act="cart.inc" data-id="${l.lineId}">+</button>
            </div>
            <b class="num" style="display:block;margin-top:6px">${M.fmt(l.unitPrice * l.qty)}</b>
          </div>
        </div>
      </div>`).join('')}

    <p class="micro muted" style="margin:4px 2px 14px">
      If something is out of stock, the shop follows your choice above.
      No reply in 90 seconds means we refund that item — we never substitute silently.
    </p>

    <div class="card">
      <div class="between" style="margin-bottom:8px"><span>Items${provisional ? ' (est.)' : ''}</span>
        <b class="num">${M.fmt(q.itemsTotal)}</b></div>
      <div class="between" style="margin-bottom:8px"><span>Delivery · ${q.km} km</span>
        <b class="num">${q.deliveryFee ? M.fmt(q.deliveryFee) : 'Free'}</b></div>
      <div class="rule" style="margin:10px 0"></div>
      <div class="between"><b>Total${provisional ? ' (est.)' : ''}</b>
        <b class="num" style="font-size:20px">${M.fmt(q.customerPays)}</b></div>
      <p class="micro muted" style="margin-top:10px">
        ${esc(q.shop.name)} keeps ${M.fmt(q.shopPayout)}. SAAHAA takes ${q.takePct}%
        (${M.fmt(q.platformFee)}) — a delivery app would take 20–30%.
        ${provisional ? 'Weight-based items are billed on the actual weighed weight.' : ''}
      </p>
    </div>

    <div class="chiprow" style="margin:14px 0">
      ${[['rider','SAAHAA rider'],['self','Shop delivers'],['pickup',"I'll pick up"]]
        .map(([m, l]) => `<button class="chip ${cartMode === m ? 'on' : ''}"
          data-act="cart.mode" data-mode="${m}">${esc(l)}</button>`).join('')}
    </div>

    <button class="btn btn--primary btn--lg btn--block" data-act="cart.place">
      Place order · ${M.fmt(q.customerPays)}
    </button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="cart.clear">Empty cart</button>
    <div style="height:40px"></div>
  </main>`;
}

/* ── shared bits ───────────────────────────────────────────── */
export function header(title, sub) {
  return `<header class="hdr on-plum" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back">←</button>
      <div class="grow"><b style="font-size:17px;display:block">${esc(title)}</b>
        ${sub ? `<span class="tiny muted">${esc(sub)}</span>` : ''}</div>
      ${mark(26, { glow: false })}
    </div>
  </header>`;
}
export function emptyBlock(title, body, cta = '') {
  return `<div class="empty"><div class="em-ico">${mark(84, { detail: true, glow: false })}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>${cta}</div>`;
}

export function addToCart(productId) {
  if (isGuest()) { toast('Sign in to start a cart'); ctx.go('auth'); return; }
  const p = getState().products.find(x => x.id === productId);
  if (!p) return;
  const r = flow.addToCart(p, 1);
  if (r.conflict) {
    const cur = getState().shops.find(s => s.id === r.currentShopId);
    sheet('Start a new cart?', `
      <p>Your cart has items from <b>${esc(cur ? cur.name : 'another shop')}</b>.
      SAAHAA keeps one shop per cart so delivery, weighing and refunds stay simple.</p>
      <button class="btn btn--primary btn--block" style="margin-top:16px"
        data-act="cart.swap" data-id="${productId}">Start a new cart</button>
      <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="sheet.close">Keep my cart</button>`);
    return;
  }
  if (r.ok) toast(`${p.name} added`);
  ctx.render();
}
export function swapCart(productId) {
  flow.clearCart();
  closeSheet();
  addToCart(productId);
}
