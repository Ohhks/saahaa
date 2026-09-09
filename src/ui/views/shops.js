/* SAAHAA · ui/views/shops.js — retail: shop list, shop page with real product
   listings, the one-shop cart, and checkout.

   MODERNIST. The mockup's 1a "Search & filters" list, 1c "Shop storefront"
   and its sticky cart bar, drawn with the system in ui/tokens.css: one red
   accent, 2px rules, list rows with a thumb, tags, 44px targets. The engine
   is untouched — same cart, same quote, same actions, same ids. Every
   number on screen is the engine's: prices via money.fmt, the shop's charge
   via the live quote (cartQuote), never a typed constant.

   The provisional-vs-final total is a first-class idea here: anything sold by
   weight shows "est." until the shop weighs it. Hiding that is the single
   biggest trust bug in Indian grocery apps.

   PICTURES (8.1). The shop's front photograph carries the list row and the
   storefront band; a product's own picture carries its card and its cart line.
   Nothing here reads the photo store directly — photo.url() validates and
   returns '' when there is none, and the box keeps its size either way, so a
   list is the same height before and after the pictures arrive.

   This file also owns the two pieces every customer screen shares: header()
   (a 2px-ruled screen header with a back button) and SYS_CSS (the list-row,
   step, note and sticky-bar classes the mockup uses that the system does
   not name). Both are imported by the other customer views. */

import { esc, sheet, closeSheet, toast, ratingStars, delegate } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myArea, isGuest } from '../../core/ctx.js';
import { live, get } from '../../core/registry.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { rankShops, kmBetween, etaMins } from '../../domain/match.js';
import { getPricing } from '../../domain/settings.js';
import * as gateway from '../../core/gateway.js';
import * as photo from '../photo.js';
import { mark } from '../logo.js';

let shopFilter = '';
export const setShopFilter = v => { shopFilter = v; };
/* The storefront's aisle row is the mockup's filter strip, and it filters for
   real — through the same one field the search box writes to, so the box always
   shows what the shelf is currently showing. Wired here rather than as a
   registered action: it changes nothing but this view's own filter. */
delegate('click', '[data-aisle]', (e, el) => { shopFilter = el.dataset.aisle || ''; ctx.render(); });

/* The delivery mode lives here, next to the view that renders it. Displayed
   price and charged price must be the same number, always. */
let cartMode = 'rider';
export const setCartMode = m => { cartMode = m; };
export const getCartMode = () => cartMode;

const BADGE_LABEL = {
  verified_shop:'Verified shop', fssai:'FSSAI', reliable_stock:'Reliable stock',
  mrp_parity:'MRP parity', fresh_today:'Fresh today', weighs_right:'Weighs right',
};

/* ── the shared view CSS ────────────────────────────────────────
   Layout the system lacks, built from its tokens only. Prefixed m- so it
   never collides with a contract class. Rendered once per screen. */
export const SYS_CSS = `<style>
  .m-row{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--color-divider);align-items:flex-start;
    width:100%;text-align:left;color:inherit;background:none;border-left:0;border-right:0;border-top:0;text-decoration:none}
  .m-row:last-child{border-bottom:0} button.m-row,a.m-row{cursor:pointer} button.m-row:hover .m-row__t,a.m-row:hover .m-row__t{color:var(--color-accent)}
  .m-row__t{font:800 14px/1.2 var(--font-heading);color:var(--ink-1)} .m-row__m{font-size:11.5px;line-height:1.4;color:var(--ink-3);margin:3px 0 6px}
  .m-row__m:last-child{margin-bottom:0} .m-row__tags{display:flex;gap:6px;flex-wrap:wrap}
  .m-row__go{font:800 13px/1 var(--font-heading);color:var(--color-accent);align-self:center;flex:none}
  .m-row__r{text-align:right;flex:none;align-self:center} .m-row__r .num{font-size:15px}
  .m-lead{width:4px;align-self:stretch;background:var(--color-accent);flex:none} .m-lead--dim{background:var(--color-neutral-400)}
  .m-thumb{display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  /* PICTURES. Every picture box is sized in CSS and never by the picture,
     so a row is exactly as tall with a photograph as without one and a list
     cannot jump as pictures decode. A missing picture leaves the drawn
     placeholder the design already uses — never a broken image, never a gap. */
  .m-img{display:block;width:100%;height:100%;object-fit:cover;background:var(--color-neutral-300)}
  .m-front{height:150px;background:var(--color-neutral-300);border-bottom:2px solid var(--color-divider);
    display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  @media (min-width:768px){ .m-front{height:200px} }
  .m-cap{font:600 9.5px/1 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px}
  /* On the ink grounds (.bestmatch, .on-plum) the muted ink of these classes
     is invisible — "THE BILL", "NEAREST" and the row meta all vanished on the
     booking card. Re-derive them from the paper colour instead. */
  .bestmatch .m-cap,.on-plum .m-cap,.bestmatch .m-row__m,.on-plum .m-row__m{color:color-mix(in srgb,var(--color-bg) 68%,transparent)}
  .bestmatch .m-row__t,.on-plum .m-row__t,.bestmatch .m-kv .muted,.on-plum .m-kv .muted{color:inherit}
  .bestmatch .m-kv--total,.on-plum .m-kv--total,.bestmatch .m-row,.on-plum .m-row{border-color:color-mix(in srgb,var(--color-bg) 28%,transparent)}
  .m-sec{padding:12px 0} .m-sec + .m-sec{border-top:2px solid var(--color-divider)}
  .m-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0;align-items:baseline}
  .m-kv--total{font:800 17px/1.2 var(--font-heading);padding-top:9px;margin-top:4px;border-top:1px solid var(--color-divider)}
  .m-kv .muted{color:var(--ink-3)}
  .m-note{background:var(--accent-soft);color:var(--brand-text);padding:9px 10px;font-size:11.5px;line-height:1.5}
  .m-bar{position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));z-index:var(--z-sticky);display:flex;align-items:center;gap:10px;
    padding:10px 0;margin-top:var(--sp-6);border-top:2px solid var(--color-text);background:var(--bg)}
  .m-bar__t{font:800 14px/1.2 var(--font-heading)} .m-bar__m{font-size:10.5px;color:var(--ink-3)}
  @media (min-width:768px){ .m-bar{bottom:0} }
  .m-set{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;min-height:48px;padding:6px 0;
    border-bottom:1px solid var(--color-divider);text-align:left;font-weight:600;color:inherit;background:none}
  .m-set:last-child{border-bottom:0} .m-set__v{color:var(--ink-3);font-weight:400;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:13px}
  .m-set--em,.m-set--em .m-set__v{color:var(--color-accent)}
  .m-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
  .m-step{display:flex;gap:12px;align-items:flex-start} .m-step__dot{width:12px;height:12px;flex:none;margin-top:3px;background:var(--color-accent)}
  .m-step.pend .m-step__dot{background:transparent;border:2px solid var(--color-neutral-400)}
  .m-step__t{font:800 13px/1.3 var(--font-heading)} .m-step.pend .m-step__t{color:var(--ink-3)} .m-step__m{font-size:11px;color:var(--ink-3)}
  .m-hero{background:var(--color-accent);color:#fff;padding:20px 14px 18px}
  .m-hero .m-hero__k{font:800 10px/1 var(--font-heading);letter-spacing:.18em;opacity:.85;text-transform:uppercase}
  .m-hero h1{font:800 27px/1.08 var(--font-heading);margin:10px 0 4px;color:#fff;letter-spacing:-.01em} .m-hero p{font-size:12.5px;opacity:.9}
  .m-grid2{display:grid;grid-template-columns:1fr 1fr}
  .m-prod{padding:10px;border-bottom:1px solid var(--color-divider);display:flex;flex-direction:column}
  .m-grid2 .m-prod:nth-child(odd){border-right:1px solid var(--color-divider)}
  .m-prod__img{height:78px;background:var(--color-neutral-300);border:1px solid var(--color-divider);display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  .m-prod__t{font:800 12.5px/1.25 var(--font-heading);margin:8px 0 3px} .m-prod__m{font-size:11px;color:var(--ink-3)}
  .m-prod__b{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto;padding-top:7px;gap:6px}
  .m-prod__p{font:800 15px/1 var(--font-heading)}
  /* price above, the struck MRP and the saving beneath it — so the ADD control
     always keeps its own line-end and never gets pushed under the price */
  .m-prod__price{display:flex;flex-direction:column;gap:4px;min-width:0}
  .m-prod__was{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ink-3);flex-wrap:wrap}
  .m-prod__was .tag{padding:2px 6px;font-size:10px}
  .m-add{border:1px solid var(--color-text);padding:0 9px;min-height:44px;min-width:44px;font:800 11px/1 var(--font-heading);color:var(--ink-1)}
  .m-add:disabled{border-color:var(--color-divider);color:var(--ink-3);opacity:1}
  .m-qty{display:inline-flex;align-items:center;background:var(--color-accent);color:#fff;font:800 12px/1 var(--font-heading);min-height:44px}
  .m-qty button{color:inherit;min-width:44px;min-height:44px;font:800 15px/1 var(--font-heading)} .m-qty b{padding:0 2px}
  .m-two{display:block} @media (min-width:1024px){ .m-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:var(--sp-9);align-items:start} .m-two > *{min-width:0} }
  .m-stars{display:flex;gap:6px} .m-stars button{font-size:33px;line-height:1;color:var(--color-neutral-400);min-width:44px;min-height:44px}
  .m-stars button:hover,.m-stars button:focus-visible{color:var(--color-accent)}
  @media (min-width:768px){ .m-grid2{grid-template-columns:repeat(3,1fr)} .m-grid2 .m-prod:nth-child(odd){border-right:0} .m-grid2 .m-prod:not(:nth-child(3n)){border-right:1px solid var(--color-divider)} }
  @media (min-width:1200px){ .m-grid2{grid-template-columns:repeat(4,1fr)} .m-grid2 .m-prod:not(:nth-child(3n)){border-right:0} .m-grid2 .m-prod:not(:nth-child(4n)){border-right:1px solid var(--color-divider)} }
</style>`;

/* ── shared bits ───────────────────────────────────────────── */
/** A screen's own header: 2px rule, back, title, one-line subtitle, and an
    optional control on the right. */
export function header(title, sub, right = '') {
  return `<header class="hdr">
    <div class="wrap inner">
      <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back" style="padding-inline:6px;color:inherit">${icon('back', { size: 20 })}</button>
      <div class="grow" style="min-width:0">
        <b style="font:800 15px/1.15 var(--font-heading);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</b>
        ${sub ? `<span style="display:block;font-size:10.5px;line-height:1.3;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub)}</span>` : ''}
      </div>
      ${right}
    </div>
  </header>`;
}
export function emptyBlock(title, body, cta = '') {
  return `<div class="empty empty--smart"><div class="em-ico">${mark(40, { detail: true, glow: false })}</div>
    <h3 style="font-size:17px">${esc(title)}</h3><p style="margin-top:6px">${esc(body)}</p>${cta ? `<div style="margin-top:12px">${cta}</div>` : ''}</div>`;
}

/* ── pictures ───────────────────────────────────────────────
   One box, one fixed size, three possible fillings: the photograph the shop or
   the shop owner uploaded, the category's drawn glyph, or nothing. The size is
   the box's, never the image's — that is what keeps a list from jumping as
   pictures decode. The src ALWAYS comes from photo.url(), which validates
   against the user-editable store and returns '' when there is no picture. */
const picture = (photoId, alt) => {
  const src = photo.url(photoId);
  return src ? `<img class="m-img" src="${src}" alt="${esc(alt || '')}" loading="lazy" decoding="async">` : '';
};
/* a thumb that carries the shop's own photograph, or the category's icon */
const thumb = (catId, size = 52, photoId = null) => {
  const pic = picture(photoId, '');
  return `<span class="thumb m-thumb" style="width:${size}px;height:${size}px" aria-hidden="true">${
    pic || (hasIcon(catId) ? icon(catId, { size: Math.round(size * 0.42) }) : '')}</span>`;
};
/* the glyph a product falls back to when it has no picture of its own */
const prodGlyph = p => (p && p.coldChain) ? 'cold' : (p && p.rxRequired) ? 'rx' : 'box';

/* ── the cart, as one floating control (the list) or a bar (the shop) ── */
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
function cartBar(shop) {
  const cart = flow.getCart();
  if (!cart || !cart.lines.length) return '';
  const q = flow.cartQuote(cartMode);
  if (!q) return '';
  const n = cart.lines.reduce((a, l) => a + l.qty, 0);
  const sameShop = cart.shopId === shop.id;
  return `<div class="m-bar">
    <div class="grow">
      <div class="m-bar__t">${n} item${n === 1 ? '' : 's'} · ${M.fmt(q.itemsTotal)}</div>
      <div class="m-bar__m">${sameShop
        ? (q.deliveryFee ? `Free delivery over ${M.fmt(q.shop.freeDeliveryAbove)}` : 'Delivery is free on this order')
        : `In your cart from ${esc(q.shop.name)}`}</div>
    </div>
    <button class="btn btn--primary" data-act="nav.cart">Checkout</button>
  </div>`;
}

/* ── shop list — 1a "Search & filters" ─────────────────────── */
export function renderList(catId) {
  const st = getState();
  const retailCats = live('category').filter(c => c.kind === 'retail');
  if (!retailCats.length) return `${header('Shops near you', '')}<main class="wrap">
    ${emptyBlock('No shop categories are live', 'Every retail category is currently switched off.')}</main>`;
  const active = catId && get('category', catId).kind === 'retail' ? catId : null;
  const activeId = active || retailCats[0].id;
  const activeCat = get('category', activeId);
  const shops = rankShops(st.shops, { catId: activeId, area: myArea() });
  const openNow = shops.filter(s => s.isOpen).length;
  const P = getPricing();

  return `
  ${header('Shops near you', `${myArea()} · ${shops.length} listed`)}
  <main class="wrap">
    <div class="chiprow" style="margin:10px 0;flex-wrap:wrap">
      ${retailCats.map(c => `<button class="chip ${c.id === activeId ? 'on' : ''}" aria-pressed="${c.id === activeId}"
        data-act="shops.cat" data-id="${c.id}">
        <span class="chip__ic" aria-hidden="true">${hasIcon(c.id) ? icon(c.id, { size: 14 }) : ''}</span>${esc(c.name)}</button>`).join('')}
    </div>

    <div class="between" style="padding:9px 0;border-top:1px solid var(--color-divider);border-bottom:2px solid var(--color-divider);font-size:11.5px;color:var(--ink-3)">
      <span>${shops.length} ${esc(activeCat.name.toLowerCase())} shop${shops.length === 1 ? '' : 's'} in ${esc(myArea())} · ${openNow} open now</span>
      <span style="font-weight:600;color:var(--ink-1)">Nearest first</span>
    </div>

    ${shops.length ? `<div class="rise">${shops.map(shopRow).join('')}</div>`
      : emptyBlock('No shops here yet', 'Try another category or area.',
        '<button class="btn btn--secondary" data-act="nav.home">Back to services</button>')}

    <p class="micro muted" style="margin-top:16px">Item prices never exceed MRP. SAAHAA's charge on a shop order is
      ${esc(P.retailTakePct)}% of the basket from the shop's side, never more than ${M.fmt(P.retailTakeCapPaise)} —
      it is not added to your bill.</p>
    <div style="height:90px"></div>
  </main>
  ${cartFab()}
  ${SYS_CSS}`;
}

function shopRow(s) {
  const cat = get('category', s.catId);
  const products = getState().products.filter(p => p.shopId === s.id && p.active && (!p.trackStock || p.stockQty > 0));
  const badges = (s.badges || []).slice(0, 1).map(b => BADGE_LABEL[b] || b);
  return `<button class="m-row" data-act="shop.open" data-id="${s.id}">
    ${thumb(cat.id, 52, s.photo)}
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(s.name)}</div>
      <div class="m-row__m">${products.length} items listed · ${s.km} km · ~${s.eta} min · min order ${M.fmt(s.minOrder)}</div>
      <div class="m-row__tags">
        <span class="tag tag-accent">${esc(s.ratingAvg)} ★</span>
        <span class="tag ${s.isOpen ? 'tag-neutral' : ''}">${s.isOpen ? 'Open now' : 'Closed'}</span>
        ${badges.map(b => `<span class="tag tag-neutral">${esc(b)}</span>`).join('')}
      </div>
    </div>
    <span class="m-row__go" aria-hidden="true">→</span>
  </button>`;
}

/* ── one shop, with its catalogue — 1c "Shop storefront" ─── */
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
  const allItems = st.products.filter(p => p.shopId === s.id && p.active);
  const allAisles = [...new Set(allItems.map(p => p.aisle))];
  let items = allItems;
  if (q) items = items.filter(p => p.name.toLowerCase().includes(q) || p.aisle.toLowerCase().includes(q));
  const aisles = [...new Set(items.map(p => p.aisle))];
  const cart = flow.getCart();
  const lineFor = p => (cart && cart.shopId === s.id ? cart.lines.find(l => l.productId === p.id) : null);

  const front = picture(s.photo, s.name);
  return `
  ${header(s.name, `${s.isOpen ? 'Open' : 'Closed'} · ${s.km} km · delivers in ~${s.eta} min`)}
  <div class="m-front"${front ? '' : ' aria-hidden="true"'}>${front
    || (hasIcon(cat.id) ? icon(cat.id, { size: 46 }) : '')}</div>
  <main class="wrap" style="padding-top:0">
    <div class="m-sec" style="padding-top:10px">
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <span class="tag tag-accent">${esc(s.ratingAvg)} ★ (${s.ratingCount})</span>
        <span class="tag tag-neutral">${s.fillRate}% in stock</span>
        <span class="tag tag-neutral">Free delivery over ${M.fmt(s.freeDeliveryAbove)}</span>
        ${(s.badges || []).map(b => `<span class="tag tag-neutral">${esc(BADGE_LABEL[b] || b)}</span>`).join('')}
      </div>
      ${s.fssai || s.drugLicence ? `<p class="micro muted" style="margin-top:8px">
        ${s.fssai ? `FSSAI ${esc(s.fssai)}` : ''}${s.drugLicence ? ` · DL ${esc(s.drugLicence)}` : ''}</p>` : ''}
    </div>

    <div class="search" style="margin:0 0 10px">
      <span aria-hidden="true">${icon('search', { size: 16 })}</span>
      <input id="shopq" type="search" placeholder="Search in ${esc(s.name)}" value="${esc(shopFilter)}"
             data-role="shopsearch" aria-label="Search this shop">
    </div>

    ${allAisles.length ? `<div class="chiprow" style="padding-bottom:10px;border-bottom:2px solid var(--color-divider)"
        role="group" aria-label="Filter this shop">
      <button class="chip${q ? '' : ' on'}" aria-pressed="${!q}" data-aisle="">All · ${allItems.length}</button>
      ${allAisles.map(a => {
        const on = q === a.toLowerCase();
        return `<button class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-aisle="${esc(a)}">${
          esc(a)} · ${allItems.filter(p => p.aisle === a).length}</button>`;
      }).join('')}
    </div>` : ''}

    ${cat.variableWeight ? `<p class="m-note" style="margin-top:10px">
      Items sold by weight show an estimate. Your final bill uses the actual weighed weight.</p>` : ''}

    ${aisles.length ? aisles.map((a, i) => `
      <div class="sec rise rise-${Math.min(5, i + 2)}" style="padding-bottom:0">
        <p class="m-cap">${esc(a)}</p>
        <div class="m-grid2" style="border-top:1px solid var(--color-divider)">${items.filter(p => p.aisle === a).map(p => productCard(p, lineFor(p))).join('')}</div>
      </div>`).join('')
      : emptyBlock('Nothing listed yet', 'This shop has not added products for this search.')}

    ${cartBar(s)}
    <div style="height:24px"></div>
  </main>
  ${SYS_CSS}`;
}

function productCard(p, line) {
  const out = p.trackStock && p.stockQty <= 0;
  const low = p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt;
  const off = p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const stock = out ? 'Out of stock' : low ? `Only ${p.stockQty} left` : p.trackStock ? `In stock · ${p.stockQty} left` : 'In stock';
  const control = out ? '<button class="m-add" disabled>ADD</button>'
    : p.rxRequired ? `<button class="m-add" data-act="rx.info">Rx</button>`
    : line ? `<span class="m-qty" aria-label="${line.qty} in cart">
        <button data-act="cart.dec" data-id="${line.lineId}" aria-label="One less">−</button><b>${line.qty}</b>
        <button data-act="cart.inc" data-id="${line.lineId}" aria-label="One more">+</button></span>`
    : `<button class="m-add" data-act="cart.add" data-id="${p.id}" aria-label="Add ${esc(p.name)}">ADD</button>`;
  return `<div class="m-prod" style="${out ? 'opacity:.55' : ''}">
    <div class="m-prod__img">${picture(p.photo, p.name) || icon(prodGlyph(p), { size: 22 })}</div>
    <div class="m-prod__t">${esc(p.name)}</div>
    <div class="m-prod__m">${esc(stock)} · ${esc(p.unit)}${p.variableWeight ? ' · weighed at packing' : ''}${
      p.coldChain ? ' · cold chain' : ''}${p.rxRequired ? ' · prescription needed' : ''}${p.perishable && p.mfgDate ? ' · packed today' : ''}</div>
    <div class="m-prod__b">
      <span class="m-prod__price"><b class="m-prod__p">${M.fmt(p.price)}</b>${off
        ? `<span class="m-prod__was"><span class="strike num">${M.fmt(p.mrp)}</span> <span class="tag tag-accent">${off}% off</span></span>` : ''}</span>
      ${control}
    </div>
  </div>`;
}

/* ── cart & checkout ───────────────────────────────────────── */
export function renderCart() {
  const cart = flow.getCart();
  if (!cart || !cart.lines.length)
    return `${header('Your cart', '')}<main class="wrap">
      ${emptyBlock('Cart is empty', 'Add items from any shop near you.',
        '<button class="btn btn--secondary" data-act="nav.shops">Browse shops</button>')}</main>`;

  const q = flow.cartQuote(cartMode);
  if (!q) { flow.clearCart(); return renderCart(); }   // shop vanished under us
  const provisional = cart.lines.some(l => l.variableWeight);
  const n = cart.lines.reduce((a, l) => a + l.qty, 0);
  const w = flow.customerWallet();
  const fromWallet = Math.min(w.balance, q.customerPays);
  const viaGateway = q.customerPays - fromWallet;

  return `
  ${header('Checkout', `${q.shop.name} · ${q.km} km`)}
  <main class="wrap">
    <div class="m-two">
    <div>
    <div class="m-sec">
      <p class="m-cap">${n} item${n === 1 ? '' : 's'}</p>
      ${cart.lines.map(l => {
        /* the picture the customer chose the item by, at the same 44px box
           whether the shop photographed it or not */
        const prod = getState().products.find(x => x.id === l.productId);
        return `
      <div class="m-row" style="align-items:flex-start">
        <span class="thumb m-thumb" style="width:44px;height:44px" aria-hidden="true">${
          picture(prod && prod.photo, '') || icon(prodGlyph(prod || l), { size: 18 })}</span>
        <div class="grow" style="min-width:0">
          <div class="m-row__t">${esc(l.name)}</div>
          <div class="m-row__m">${M.fmt(l.unitPrice)} ${esc(l.unit)}${l.variableWeight ? ' · est. until weighed' : ''}</div>
          <p class="m-cap" style="margin:8px 0 6px">If it is out of stock</p>
          <div class="chiprow" style="flex-wrap:wrap">
            ${['similar','call','refund'].map(pol => `
              <button class="chip ${l.subPolicy === pol ? 'on' : ''}" style="min-height:44px;font-size:11.5px" aria-pressed="${l.subPolicy === pol}"
                data-act="cart.sub" data-id="${l.lineId}" data-pol="${pol}">
                ${pol === 'similar' ? 'Similar brand OK' : pol === 'call' ? 'Ask me' : 'Just refund'}
              </button>`).join('')}
          </div>
        </div>
        <div class="m-row__r" style="align-self:flex-start">
          <span class="m-qty">
            <button data-act="cart.dec" data-id="${l.lineId}" aria-label="One less">−</button><b class="num">${l.qty}</b>
            <button data-act="cart.inc" data-id="${l.lineId}" aria-label="One more">+</button>
          </span>
          <b class="num" style="display:block;margin-top:8px">${M.fmt(l.unitPrice * l.qty)}</b>
        </div>
      </div>`;
      }).join('')}
      <p class="micro muted" style="margin-top:10px">
        The shop follows your choice above. No reply in 90 seconds means we refund that item —
        we never substitute silently.</p>
    </div>

    <div class="m-sec">
      <p class="m-cap">How you get it</p>
      <div class="seg seg--block" role="group" aria-label="Delivery mode">
        ${[['rider','SAAHAA rider'],['self','Shop delivers'],['pickup',"I'll pick up"]]
          .map(([m, l]) => `<button class="seg__btn ${cartMode === m ? 'on' : ''}"
            aria-pressed="${cartMode === m}" data-act="cart.mode" data-mode="${m}">${esc(l)}</button>`).join('')}
      </div>
    </div>
    </div>

    <div>
    <div class="m-sec">
      <p class="m-cap">Bill</p>
      <div class="m-kv"><span>Items${provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(q.itemsTotal)}</span></div>
      <div class="m-kv"><span>Delivery · ${q.km} km${cartMode === 'pickup' ? ' · pickup' : ''}</span><span class="num">${q.deliveryFee ? M.fmt(q.deliveryFee) : 'Free'}</span></div>
      <div class="m-kv m-kv--total"><span>You pay${provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(q.customerPays)}</span></div>
      <p class="m-note" style="margin-top:10px">${esc(q.shop.name)} receives ${M.fmt(q.shopPayout)}. SAAHAA's charge of
        ${M.fmt(q.platformFee)} (${q.takePct}% of the basket) comes out of the shop's side, not your bill.
        ${provisional ? 'Weight-based items are billed on the actual weighed weight.' : ''}</p>
    </div>

    <div class="m-sec">
      <p class="m-cap">How you pay</p>
      <div class="m-kv"><span>From your SAAHAA wallet</span><span class="num">${M.fmt(fromWallet)}</span></div>
      <div class="m-kv"><span>${esc(gatewayLine())}</span><span class="num">${M.fmt(viaGateway)}</span></div>
      <p class="micro muted" style="margin-top:6px">You pay SAAHAA. The money is held until you confirm the delivery, then the shop is paid.
        An item the shop cannot supply is refunded to your wallet.</p>
    </div>

    <div class="m-bar" style="margin-top:0">
      <div class="grow">
        <div class="m-bar__t">${n} item${n === 1 ? '' : 's'} · ${M.fmt(q.customerPays)}</div>
        <div class="m-bar__m">${q.deliveryFee ? `Free delivery over ${M.fmt(q.shop.freeDeliveryAbove)}` : 'Delivery is free on this order'}</div>
      </div>
      <button class="btn btn--primary" data-act="cart.place">Place order</button>
    </div>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="cart.clear">Empty cart</button>
    </div>
    </div>
    <div style="height:24px"></div>
  </main>
  ${SYS_CSS}`;
}

/* the gateway's own label, shortened to a bill line ("Via Sandbox UPI") */
const gatewayLine = () => 'Via ' + gateway.label().split(' — ')[0];

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
