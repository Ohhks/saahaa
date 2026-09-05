/* SAAHAA · ui/views/shops.js — retail: shop list, shop page with real product
   listings, the one-shop cart, and checkout.

   The provisional-vs-final total is a first-class idea here: anything sold by
   weight shows "est." until the shop weighs it. Hiding that is the single
   biggest trust bug in Indian grocery apps (V1/V2, both ballots).

   OPEN CIRCLE · LIVING GLASS. A neighbourhood marketplace, not a warehouse
   feed: each shop card carries the four facts that decide whether you tap it
   (open, distance, stock reliability, minimum), the catalogue is a grid that
   widens with the screen, and the cart follows you as one floating control
   that only exists when there is something in it. */

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

/* ── the cart, as one floating control ─────────────────────────
   It exists only when there is a cart with lines, it says how many and how
   much, and it goes to exactly one place. */
function cartFab() {
  const cart = flow.getCart();
  if (!cart || !cart.lines.length) return '';
  const n = cart.lines.reduce((a, l) => a + l.qty, 0);
  const q = flow.cartQuote(cartMode);
  return `<button class="fab" data-act="nav.cart" aria-label="View cart">
    <span class="fab__count">${n}</span>
    <span>View cart</span>
    ${q ? `<b class="num">${M.fmt(q.customerPays)}</b>` : ''}
  </button>`;
}

/* ── shop list ─────────────────────────────────────────────── */
export function renderList(catId) {
  const st = getState();
  const retailCats = live('category').filter(c => c.kind === 'retail');
  if (!retailCats.length) return `${header('Shops near you', '')}<main class="wrap">
    ${emptyBlock('No shop categories are live', 'Every retail category is currently switched off.')}</main>`;
  const active = catId && get('category', catId).kind === 'retail' ? catId : null;
  const activeId = active || retailCats[0].id;
  const shops = rankShops(st.shops, { catId: activeId, area: myArea() });
  const openNow = shops.filter(s => s.isOpen).length;

  return `
  ${header('Shops near you', `${myArea()} · ${shops.length} listed`)}
  <main class="wrap">
    <div class="chiprow" style="margin:var(--sp-6) 0;flex-wrap:wrap">
      ${retailCats.map(c => `<button class="chip chip--smart ${c.id === activeId ? 'on' : ''}"
        data-act="shops.cat" data-id="${c.id}" style="--tile-accent:${esc(c.accent || '#C99A5B')}">
        <span class="chip__ic" aria-hidden="true">${c.ico}</span>${esc(c.name)}</button>`).join('')}
    </div>

    <div class="capsules" style="margin-bottom:14px">
      <span class="capsule capsule--ok"><span class="capsule__k">Open now</span>
        <span class="capsule__v">${openNow}</span></span>
      <span class="capsule capsule--info"><span class="capsule__k">Area</span>
        <span class="capsule__v">${esc(myArea())}</span></span>
      <span class="capsule capsule--soft"><span class="capsule__k">Commission</span>
        <span class="capsule__v">3–5%, not 25%</span></span>
    </div>

    ${shops.length ? `<div class="shop-grid rise">${shops.map(shopCard).join('')}</div>`
      : emptyBlock('No shops here yet', 'Try another category or area.',
        '<button class="btn btn--secondary" data-act="nav.home">Back to services</button>')}
    <div style="height:110px"></div>
  </main>
  ${cartFab()}
  ${GRID_CSS}`;
}

function shopCard(s) {
  const cat = get('category', s.catId);
  const products = getState().products.filter(p => p.shopId === s.id && p.active && (!p.trackStock || p.stockQty > 0));
  return `<button class="cmd${s.isOpen ? ' glass' : ''}" data-act="shop.open" data-id="${s.id}"
      style="width:100%;text-align:left;--tile-accent:${esc(cat.accent || '#C99A5B')}">
    <div class="row" style="align-items:flex-start">
      <span class="med" style="width:48px;height:48px;border-radius:var(--r-md);background:var(--accent-soft);
        display:grid;place-items:center;font-size:22px;flex:0 0 auto">${cat.ico}</span>
      <div class="grow">
        <div class="between"><b class="cmd__title">${esc(s.name)}</b>
          <span class="pill ${s.isOpen ? 'pill--ok' : 'pill--bad'}">${s.isOpen ? 'Open' : 'Closed'}</span></div>
        <p class="cmd__sub">
          ${ratingStars(s.ratingAvg)} ${s.ratingAvg} (${s.ratingCount}) · ${s.km} km · ~${s.eta} min ·
          ${products.length} items
        </p>
        <div class="capsules" style="margin-top:9px">
          <span class="capsule capsule--info"><span class="capsule__k">In stock</span>
            <span class="capsule__v">${s.fillRate}%</span></span>
          <span class="capsule capsule--soft"><span class="capsule__k">Min order</span>
            <span class="capsule__v num">${M.fmt(s.minOrder)}</span></span>
          <span class="capsule capsule--ok"><span class="capsule__k">Free delivery</span>
            <span class="capsule__v num">over ${M.fmt(s.freeDeliveryAbove)}</span></span>
        </div>
        <div class="row" style="gap:5px;margin-top:8px;flex-wrap:wrap">
          ${(s.badges || []).map(b => `<span class="badge badge--soft">${esc(BADGE_LABEL[b] || b)}</span>`).join('')}
        </div>
        ${s.fssai || s.drugLicence ? `<p class="micro muted" style="margin-top:6px">
          ${s.fssai ? `FSSAI ${esc(s.fssai)}` : ''}${s.drugLicence ? ` · DL ${esc(s.drugLicence)}` : ''}</p>` : ''}
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

  return `
  ${header(s.name, `${cat.ico} ${cat.name} · ${s.km} km · ~${s.eta} min`)}
  <main class="wrap">
    <div class="cmd glass rise" style="margin-top:var(--sp-6)">
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
        <span class="pill ${s.isOpen ? 'pill--ok' : 'pill--bad'}">${s.isOpen ? 'Open now' : 'Closed'}</span>
        ${(s.badges || []).map(b => `<span class="badge badge--soft">${esc(BADGE_LABEL[b] || b)}</span>`).join('')}
      </div>
      <div class="capsules" style="margin-top:10px">
        <span class="capsule capsule--info"><span class="capsule__k">In stock</span>
          <span class="capsule__v">${s.fillRate}%</span></span>
        <span class="capsule capsule--soft"><span class="capsule__k">Min order</span>
          <span class="capsule__v num">${M.fmt(s.minOrder)}</span></span>
        <span class="capsule capsule--ok"><span class="capsule__k">Free delivery</span>
          <span class="capsule__v num">over ${M.fmt(s.freeDeliveryAbove)}</span></span>
        <span class="capsule capsule--gold"><span class="capsule__k">Items listed</span>
          <span class="capsule__v">${items.length}</span></span>
      </div>
    </div>

    <div class="search" style="margin:var(--sp-6) 0">
      <span aria-hidden="true">🔎</span>
      <input id="shopq" type="search" placeholder="Search in ${esc(s.name)}" value="${esc(shopFilter)}"
             data-role="shopsearch" aria-label="Search this shop">
    </div>

    ${cat.variableWeight ? `<p class="tiny" style="background:var(--warn-soft);color:var(--warn);
      padding:10px 12px;border-radius:var(--r-md);margin-bottom:var(--sp-6)">
      ⚖️ Items sold by weight show an estimate. Your final bill uses the actual weighed weight.</p>` : ''}

    ${aisles.length ? aisles.map((a, i) => `
      <div class="sec rise rise-${Math.min(5, i + 2)}">
        <div class="hd"><h2 class="h-sec">${esc(a)}</h2>
          <span class="meta">${items.filter(p => p.aisle === a).length}</span></div>
        <div class="prod-grid">${items.filter(p => p.aisle === a).map(productCard).join('')}</div>
      </div>`).join('')
      : emptyBlock('Nothing listed yet', 'This shop has not added products for this search.')}

    <div style="height:120px"></div>
  </main>
  ${cartFab()}
  ${GRID_CSS}`;
}

function productCard(p) {
  const out = p.trackStock && p.stockQty <= 0;
  const low = p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt;
  const off = p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  return `<div class="card" style="padding:13px;${out ? 'opacity:.5' : ''}">
    <div class="between" style="align-items:flex-start">
      <div class="grow">
        <b style="font-size:14px;display:block">${esc(p.name)}</b>
        <p class="micro muted" style="margin-top:3px">
          ${esc(p.unit)}${p.variableWeight ? ' · weighed at packing' : ''}
          ${p.coldChain ? ' · ❄️ cold chain' : ''}${p.rxRequired ? ' · 📋 prescription needed' : ''}
          ${p.perishable && p.mfgDate ? ' · packed today' : ''}
        </p>
      </div>
      ${off ? `<span class="pill pill--ok">${off}% off</span>` : ''}
    </div>
    <div class="between" style="margin-top:10px;align-items:flex-end">
      <div>
        <b class="num" style="font-size:17px">${M.fmt(p.price)}</b>
        ${off ? `<span class="strike tiny num" style="margin-left:6px">${M.fmt(p.mrp)}</span>` : ''}
        ${low ? `<div><span class="pill pill--warn">Only ${p.stockQty} left</span></div>` : ''}
      </div>
      ${out ? '<span class="pill pill--bad">Out of stock</span>'
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
    <div class="sec rise">
      <div class="hd"><h2 class="h-sec">${cart.lines.length} item${cart.lines.length === 1 ? '' : 's'}</h2>
        <span class="meta">${esc(q.shop.name)}</span></div>
      ${cart.lines.map(l => `
      <div class="card" style="margin:10px 0;padding:12px">
        <div class="between">
          <div class="grow"><b style="font-size:14px">${esc(l.name)}</b>
            <p class="micro muted">${M.fmt(l.unitPrice)} ${esc(l.unit)}${l.variableWeight ? ' · est.' : ''}</p>
            <p class="eyebrow" style="margin-top:9px">If it is out of stock</p>
            <div class="chiprow" style="margin-top:5px;flex-wrap:wrap">
              ${['similar','call','refund'].map(pol => `
                <button class="chip ${l.subPolicy === pol ? 'on' : ''}" style="height:28px;font-size:11px"
                  data-act="cart.sub" data-id="${l.lineId}" data-pol="${pol}">
                  ${pol === 'similar' ? 'Similar brand OK' : pol === 'call' ? 'Ask me' : 'Just refund'}
                </button>`).join('')}
            </div>
          </div>
          <div style="text-align:right">
            <div class="row" style="gap:8px;justify-content:flex-end">
              <button class="btn btn--ghost btn--sm tap" data-act="cart.dec" data-id="${l.lineId}"
                aria-label="One less">−</button>
              <b class="num">${l.qty}</b>
              <button class="btn btn--ghost btn--sm tap" data-act="cart.inc" data-id="${l.lineId}"
                aria-label="One more">+</button>
            </div>
            <b class="num" style="display:block;margin-top:6px">${M.fmt(l.unitPrice * l.qty)}</b>
          </div>
        </div>
      </div>`).join('')}
      <p class="micro muted" style="margin:4px 2px 0">
        The shop follows your choice above. No reply in 90 seconds means we refund that item —
        we never substitute silently.
      </p>
    </div>

    <div class="sec rise rise-2">
      <div class="hd"><h2 class="h-sec">How you get it</h2></div>
      <div class="seg" role="group" aria-label="Delivery mode">
        ${[['rider','SAAHAA rider'],['self','Shop delivers'],['pickup',"I'll pick up"]]
          .map(([m, l]) => `<button class="seg__btn ${cartMode === m ? 'on' : ''}"
            aria-pressed="${cartMode === m}" data-act="cart.mode" data-mode="${m}">${esc(l)}</button>`).join('')}
      </div>
    </div>

    <div class="sec rise rise-3">
      <div class="hd"><h2 class="h-sec">Bill</h2></div>
      <div class="cmd glass glass--gold">
        <div class="moneyflow">
          <div class="between" style="margin-bottom:8px">
            <span class="tiny muted">Items${provisional ? ' (est.)' : ''}</span>
            <b class="num">${M.fmt(q.itemsTotal)}</b></div>
          <div class="between" style="margin-bottom:8px">
            <span class="tiny muted">Delivery · ${q.km} km</span>
            <b class="num">${q.deliveryFee ? M.fmt(q.deliveryFee) : 'Free'}</b></div>
        </div>
        <div class="rule" style="margin:10px 0"></div>
        <div class="between"><b>You pay${provisional ? ' (est.)' : ''}</b>
          <b class="num num-xl">${M.fmt(q.customerPays)}</b></div>

        <div class="capsules" style="margin-top:12px">
          <span class="capsule capsule--ok"><span class="capsule__k">${esc(q.shop.name)} keeps</span>
            <span class="capsule__v num">${M.fmt(q.shopPayout)}</span></span>
          <span class="capsule capsule--soft"><span class="capsule__k">SAAHAA fee</span>
            <span class="capsule__v num">${M.fmt(q.platformFee)}</span>
            <span class="capsule__d">${q.takePct}%</span></span>
        </div>
        <p class="micro muted" style="margin-top:10px">
          A delivery app would take 20–30%.
          ${provisional ? 'Weight-based items are billed on the actual weighed weight.' : ''}
        </p>
      </div>
    </div>

    <button class="btn btn--primary btn--lg btn--block sheen" data-act="cart.place">
      Place order · ${M.fmt(q.customerPays)}
    </button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="cart.clear">Empty cart</button>
    <div style="height:40px"></div>
  </main>`;
}

/* ── shared bits ───────────────────────────────────────────── */
export function header(title, sub) {
  return `<header class="hdr on-plum glass glass--deep" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back">←</button>
      <div class="grow"><b style="font-size:17px;display:block">${esc(title)}</b>
        ${sub ? `<span class="meta">${esc(sub)}</span>` : ''}</div>
      ${mark(26, { glow: false })}
    </div>
  </header>`;
}
export function emptyBlock(title, body, cta = '') {
  return `<div class="empty empty--smart"><div class="em-ico">${mark(84, { detail: true, glow: false })}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>${cta}</div>`;
}

/* the two grids that recompose rather than stretch */
const GRID_CSS = `<style>
  .shop-grid{display:grid;grid-template-columns:1fr;gap:12px}
  .prod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
  @media (min-width:768px){ .shop-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
  @media (min-width:1024px){
    .shop-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .prod-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media (min-width:1360px){ .prod-grid{grid-template-columns:repeat(4,minmax(0,1fr))} }
</style>`;

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
