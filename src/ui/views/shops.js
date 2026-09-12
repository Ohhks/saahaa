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
import * as IMG from '../../core/imgstore.js';
import { ctx, getState, me, myArea, isGuest } from '../../core/ctx.js';
import { live, get } from '../../core/registry.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { rankShops, kmBetween, etaMins } from '../../domain/match.js';
import { getPricing } from '../../domain/settings.js';
import * as gateway from '../../core/gateway.js';
import * as photo from '../photo.js';
import { mark } from '../logo.js';
import * as ADDR from '../address.js';
import * as flags from '../../core/flags.js';
import { t, catName } from '../i18n.js';

let shopFilter = '';
export const setShopFilter = v => { shopFilter = v; };
/* The storefront's aisle row is the mockup's filter strip, and it filters for
   real — through the same one field the search box writes to, so the box always
   shows what the shelf is currently showing. Wired here rather than as a
   registered action: it changes nothing but this view's own filter. */
delegate('click', '[data-aisle]', (e, el) => { shopFilter = el.dataset.aisle || ''; ctx.render(); });

/* The delivery mode lives here, next to the view that renders it. Displayed
   price and charged price must be the same number, always. */
/* AND IT DEFAULTED TO A COURIER NOBODY HAD HIRED. "SAAHAA rider" was the first
   and default option while `flags.RIDER_POOL` was false and no rider role
   existed anywhere in the product — so the shop drove the delivery itself,
   under a label naming somebody else. The default is the shop's own arrangement
   until the network is real. */
let cartMode = 'rider';   // "delivered to me" while RIDER_POOL is off — the label, not the courier
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
  .m-row:last-child{border-bottom:0} button.m-row,a.m-row{cursor:pointer} button.m-row:hover .m-row__t,a.m-row:hover .m-row__t{color:var(--color-accent-text)}
  .m-row__t{font:800 14px/1.2 var(--font-heading);color:var(--ink-1)} .m-row__m{font-size:12.5px;line-height:1.45;color:var(--ink-3);margin:3px 0 6px}
  .m-row__m:last-child{margin-bottom:0} .m-row__tags{display:flex;gap:6px;flex-wrap:wrap}
  .m-row__go{font:800 13px/1 var(--font-heading);color:var(--color-accent-text);align-self:center;flex:none}
  .m-row__r{text-align:right;flex:none;align-self:center} .m-row__r .num{font-size:15px}
  .m-lead{width:4px;align-self:stretch;background:var(--color-accent);flex:none} .m-lead--dim{background:var(--color-neutral-400)}
  .m-thumb{display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  /* PICTURES. Every picture box is sized in CSS and never by the picture,
     so a row is exactly as tall with a photograph as without one and a list
     cannot jump as pictures decode. A missing picture leaves the drawn
     placeholder the design already uses — never a broken image, never a gap. */
  /* place-self:stretch is what makes height:100% mean anything here. Every
     picture box below is display:grid + place-items:center so the drawn
     placeholder sits in the middle; a centred grid item is sized by its
     CONTENT, so the percentage had nothing definite to resolve against and the
     photograph kept its own height — a 1:1 shot rendered 153px tall inside a
     78px box and was clipped from the TOP by overflow:hidden. The row never
     moved (that part was right), but object-fit:cover never got to do its
     job: shop fronts lost their bottom 85px. Stretching the image to the grid
     area gives the percentage a definite box, and cover crops from the centre. */
  .m-img{display:block;width:100%;height:100%;place-self:stretch;min-width:0;min-height:0;
    object-fit:cover;background:var(--color-neutral-300)}
  .m-front{height:150px;background:var(--color-neutral-300);border-bottom:2px solid var(--color-divider);
    display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  @media (min-width:768px){ .m-front{height:200px} }
  .m-cap{font:600 12px/1.2 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px}
  /* On the ink grounds (.bestmatch, .on-plum) the muted ink of these classes
     is invisible — "THE BILL", "NEAREST" and the row meta all vanished on the
     booking card. Re-derive them from the paper colour instead. */
  .bestmatch .m-cap,.on-plum .m-cap,.bestmatch .m-row__m,.on-plum .m-row__m{color:color-mix(in srgb,var(--color-bg) 68%,transparent)}
  .bestmatch .m-row__t,.on-plum .m-row__t,.bestmatch .m-kv .muted,.on-plum .m-kv .muted{color:inherit}
  .bestmatch .m-kv--total,.on-plum .m-kv--total,.bestmatch .m-row,.on-plum .m-row{border-color:color-mix(in srgb,var(--color-bg) 28%,transparent)}
  /* A step list on the ink ground: .m-step.pend paints its label var(--ink-3),
     which IS the ground here — the "what happens next" list on an order was
     ink on ink and could not be read at all. Same treatment as .m-cap above. */
  .on-plum .m-step.pend .m-step__t{color:color-mix(in srgb,var(--color-bg) 82%,transparent)}
  .on-plum .m-step__m{color:color-mix(in srgb,var(--color-bg) 68%,transparent)}
  .on-plum .m-step.pend .m-step__dot{border-color:color-mix(in srgb,var(--color-bg) 55%,transparent)}
  .m-sec{padding:12px 0} .m-sec + .m-sec{border-top:2px solid var(--color-divider)}
  .m-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0;align-items:baseline}
  .m-kv--total{font:800 17px/1.2 var(--font-heading);padding-top:9px;margin-top:4px;border-top:1px solid var(--color-divider)}
  .m-kv .muted{color:var(--ink-3)}
  .m-note{background:var(--accent-soft);color:var(--brand-text);padding:9px 10px;font-size:12px;line-height:1.5}
  .m-bar{position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));z-index:var(--z-sticky);display:flex;align-items:center;gap:10px;
    padding:10px 0;margin-top:var(--sp-6);border-top:2px solid var(--color-text);background:var(--bg)}
  .m-bar__t{font:800 14px/1.2 var(--font-heading)} .m-bar__m{font-size:12px;color:var(--ink-3)}
  @media (min-width:768px){ .m-bar{bottom:0} }
  .m-set{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;min-height:48px;padding:6px 0;
    border-bottom:1px solid var(--color-divider);text-align:left;font-weight:600;color:inherit;background:none}
  .m-set:last-child{border-bottom:0} .m-set__v{color:var(--ink-3);font-weight:400;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:13px}
  .m-set--em,.m-set--em .m-set__v{color:var(--color-accent-text)}
  .m-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
  .m-step{display:flex;gap:12px;align-items:flex-start} .m-step__dot{width:12px;height:12px;flex:none;margin-top:3px;background:var(--color-accent)}
  .m-step.pend .m-step__dot{background:transparent;border:2px solid var(--color-neutral-400)}
  .m-step__t{font:800 13px/1.3 var(--font-heading)} .m-step.pend .m-step__t{color:var(--ink-3)} .m-step__m{font-size:12px;color:var(--ink-3)}
  .m-hero{background:var(--color-accent-surface);color:#fff;padding:20px 14px 18px}
  .m-hero .m-hero__k{font:800 12px/1.2 var(--font-heading);letter-spacing:.18em;opacity:.85;text-transform:uppercase}
  .m-hero h1{font:800 27px/1.08 var(--font-heading);margin:10px 0 4px;color:#fff;letter-spacing:-.01em} .m-hero p{font-size:12.5px;opacity:.9}
  .m-grid2{display:grid;grid-template-columns:1fr 1fr}
  .m-prod{padding:10px;border-bottom:1px solid var(--color-divider);display:flex;flex-direction:column}
  .m-grid2 .m-prod:nth-child(odd){border-right:1px solid var(--color-divider)}
  .m-prod__img{height:78px;background:var(--color-neutral-300);border:1px solid var(--color-divider);display:grid;place-items:center;color:var(--ink-3);overflow:hidden}
  .m-prod__t{font:800 12.5px/1.25 var(--font-heading);margin:8px 0 3px} .m-prod__m{font-size:12px;color:var(--ink-3)}
  .m-prod__b{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto;padding-top:7px;gap:6px}
  .m-prod__p{font:800 15px/1 var(--font-heading)}
  /* price above, the struck MRP and the saving beneath it — so the ADD control
     always keeps its own line-end and never gets pushed under the price */
  .m-prod__price{display:flex;flex-direction:column;gap:4px;min-width:0}
  .m-prod__was{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-3);flex-wrap:wrap}
  .m-prod__was .tag{padding:2px 6px;font-size:12px}
  .m-add{border:1px solid var(--color-text);padding:0 9px;min-height:44px;min-width:44px;font:800 11px/1 var(--font-heading);color:var(--ink-1)}
  .m-add:disabled{border-color:var(--color-divider);color:var(--ink-3);opacity:1}
  .m-qty{display:inline-flex;align-items:center;background:var(--color-accent-surface);color:#fff;font:800 12px/1 var(--font-heading);min-height:44px}
  .m-qty button{color:inherit;min-width:44px;min-height:44px;font:800 15px/1 var(--font-heading)} .m-qty b{padding:0 2px}
  .m-two{display:block} @media (min-width:1024px){ .m-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:var(--sp-9);align-items:start} .m-two > *{min-width:0} }
  .m-stars{display:flex;gap:6px} .m-stars button{font-size:33px;line-height:1;color:var(--color-neutral-400);min-width:44px;min-height:44px}
  .m-stars button:hover,.m-stars button:focus-visible{color:var(--color-accent-text)}
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
        ${sub ? `<span style="display:block;font-size:12px;line-height:1.3;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub)}</span>` : ''}
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
/* ONE BAG OF ATTA IS PHOTOGRAPHED ONCE FOR THE WHOLE CITY. A shop's own
   photograph wins where it has taken one; otherwise the product resolves to the
   catalogue's shared picture, so forty shops stocking the same 199 items need
   199 pictures and not 7,960. See core/imgstore.js for the arithmetic.

   And where there is no picture at all yet, a ~96-byte placeholder paints the
   shape and colour of the thing with NO image request — which on a ₹6,000
   Android on 3G is the difference between a list that appears and one that
   crawls in grey. */
const picture = (photoId, alt, product = null) => {
  const own = photo.url(photoId);
  const src = own || (product ? photo.url(IMG.keyForListing(product)) : '');
  if (src) return `<img class="m-img" src="${src}" alt="${esc(alt || '')}" loading="lazy" decoding="async">`;
  const blur = product && product.blur;
  return blur
    ? `<span class="m-img m-img--blur" aria-hidden="true" style="background-image:${IMG.blurToCss(blur)}"></span>`
    : '';
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
      <div class="m-bar__t">${n} item${n === 1 ? '' : 's'} · ${M.fmtMax(q.customerPays)}</div>
      <div class="m-bar__m">${sameShop ? deliveryLine(q) : `In your cart from ${esc(q.shop.name)}`}</div>
    </div>
    <button class="btn btn--primary" data-act="nav.cart">View cart</button>
  </div>`;
}

/* WHAT THE DELIVERY ACTUALLY COSTS. The bar printed the basket total and, under
   it, "Free delivery over Rs.499" — the threshold, never the fee, never the
   gap. So the number on the bar (items) and the number at checkout (items +
   delivery) disagreed, and the one line that could have explained the
   difference didn't. Both come off the same quote now. */
function deliveryLine(q) {
  if (!q.deliveryFee) return 'Delivery is free on this order';
  const gap = (q.shop.freeDeliveryAbove | 0) - (q.itemsTotal | 0);
  return `Includes ${M.fmt(q.deliveryFee)} delivery` +
    (gap > 0 ? ` · ${M.fmt(gap)} more and it is free` : '');
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
        <span class="chip__ic" aria-hidden="true">${hasIcon(c.id) ? icon(c.id, { size: 14 }) : ''}</span>${esc(catName(c))}</button>`).join('')}
    </div>

    <div class="between" style="padding:9px 0;border-top:1px solid var(--color-divider);border-bottom:2px solid var(--color-divider);font-size:12px;color:var(--ink-3)">
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
      <!-- the same count Home shows, under the same words: this row said
           "listed" while counting only what is in stock, and the storefront
           it opens says "All · 41" about the whole catalogue -->
      <div class="m-row__m">${products.length} items in stock · ${s.km} km · ~${s.eta} min · min order ${M.fmt(s.minOrder)}</div>
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
        <span class="tag tag-neutral">${esc(t('shopf.freeOver', { amount: M.fmt(s.freeDeliveryAbove) }))}</span>
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
      : q
        ? emptyBlock(`Nothing here matches “${shopFilter.trim()}”`,
            `${s.name} lists ${allItems.length} item${allItems.length === 1 ? '' : 's'}, none of them under that word.`,
            '<button class="btn btn--secondary" data-aisle="">Show everything</button>')
        : emptyBlock('Nothing listed yet',
            `${s.name} has not put any products on its shelf so far.`,
            '<button class="btn btn--secondary" data-act="nav.shops">Other shops near you</button>')}

    ${cartBar(s)}
    <div style="height:24px"></div>
  </main>
  ${SYS_CSS}`;
}

function productCard(p, line) {
  const out = p.trackStock && p.stockQty <= 0;
  const low = p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt;
  /* "₹20  ₹20  2% off" — A STRUCK-THROUGH MRP EQUAL TO THE PRICE BESIDE IT.
     The saving was computed on PAISE (₹19.60 against ₹20.00) and both figures
     printed rupee-rounded, so the badge announced a discount the shelf label
     flatly contradicted. On a screen whose own footer promises "item prices
     never exceed MRP", that is a false claim about money, and in India it is a
     false claim under consumer law. A discount has to survive being displayed:
     at least a rupee off, and at least one whole percent. */
  /* AND SUPPRESSING THE SUB-RUPEE CASE DID NOT FIX THE PERCENTAGE. The badge
     was still computed on PAISE while the two prices beside it printed rounded,
     so "₹99, was ₹105, 5% off" sat six rows above "₹99, was ₹105, 6% off" —
     identical printed prices, different badges, on a page whose own footer
     promises item prices never exceed MRP. A shopper disproves that with one
     second of mental arithmetic, and in India a mis-stated discount is a
     consumer-law exposure rather than a rounding nit.

     The badge describes what is PRINTED, so it is computed from what is
     printed. Same rule as every bill on the customer's path. */
  const shownPrice = Math.round(p.price / 100);
  const shownMrp = Math.round((p.mrp || 0) / 100);
  const off = shownMrp > shownPrice ? Math.max(1, Math.round((1 - shownPrice / shownMrp) * 100)) : 0;
  /* THE SCREEN A KIRANA SHOPPER LIVES ON, measured at ~2% Telugu: every aisle,
     every stock line, the word ADD and the delivery promise were English on a
     page whose product names are the only thing she can read. */
  const stock = out ? t('shopf.outOfStock')
    : low ? t('shopf.onlyLeft', { n: p.stockQty })
    : p.trackStock ? t('shopf.inStockN', { n: p.stockQty })
    : t('shopf.inStock');
  const control = out ? `<button class="m-add" disabled>${esc(t('shopf.add'))}</button>`
    : p.rxRequired ? `<button class="m-add" data-act="rx.info">Rx</button>`
    : line ? `<span class="m-qty" aria-label="${line.qty} in cart">
        <button data-act="cart.dec" data-id="${line.lineId}" aria-label="One less">−</button><b>${line.qty}</b>
        <button data-act="cart.inc" data-id="${line.lineId}" aria-label="One more">+</button></span>`
    : `<button class="m-add" data-act="cart.add" data-id="${p.id}" aria-label="${esc(t('shopf.addNamed', { name: p.name }))}">${esc(t('shopf.add'))}</button>`;
  return `<div class="m-prod" style="${out ? 'opacity:.55' : ''}">
    <div class="m-prod__img">${picture(p.photo, p.name, p) || icon(prodGlyph(p), { size: 22 })}</div>
    <div class="m-prod__t">${esc(p.name)}</div>
    <div class="m-prod__m">${esc(stock)} · ${esc(p.unit)}${p.variableWeight ? ' · ' + esc(t('shopf.weighedAtPacking')) : ''}${
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
    /* THE EMPTY CART WAS 0% TRANSLATED — the machine score found it on its
       first run, and a round-18 audit had said the same thing. It is a screen a
       new customer sees before any other, in whatever language she chose. */
    return `${header(t('cart.title'), '')}<main class="wrap">
      ${emptyBlock(t('cart.empty'), t('cart.emptyHow'),
        `<button class="btn btn--secondary" data-act="nav.shops">${esc(t('cart.browseShops'))}</button>`)}</main>`;

  const q = flow.cartQuote(cartMode);
  if (!q) { flow.clearCart(); return renderCart(); }   // shop vanished under us
  const provisional = cart.lines.some(l => l.variableWeight);
  /* nowhere to send it: a delivery mode that needs a door, and no door given */
  const needsAddr = !!me() && ADDR.modeNeedsAddress(cartMode) && !ADDR.looksLikeAddress((me() || {}).address);
  const n = cart.lines.reduce((a, l) => a + l.qty, 0);
  const w = flow.customerWallet();
  /* the two halves must add to the total printed above them — see
     core/money.js roundParts. Printed independently they read
     "₹10 from wallet · ₹729 by UPI" under a total of ₹740. */
  /* AND THIS WAS THE CALL THAT INVENTED ₹9. `shopPayout` and `platformFee` do
     NOT sum to the basket — the rider's ₹14 and SAAHAA's ₹5 dispatch sit
     between them — so `roundParts` read a ₹19 gap as rounding drift and split
     it across the two lines, printing SAAHAA's ₹20.31 fee as **₹29** on a
     screen that promises "never more than ₹25". A display helper that
     disagrees with the engine by ₹9 is worse than the misalignment it was
     written to fix, and it made the product call itself a liar.

     Every part of the basket goes in, so there is nothing left to invent. */
  /* AND ADDING EVERY PART WAS ONLY RIGHT WHEN DELIVERY IS FREE. When SHE pays
     the delivery, the rider and the dispatch cut come out of the fee she paid,
     not out of the basket — so on an ordinary paid-delivery order this handed
     the helper ₹19 that did not belong to `itemsTotal`, and the guard caught it
     on every single cart. The parts are the parts of THIS basket. */
  /* "SRI LAKSHMI KIRANA RECEIVES ₹1,081" while the shop's own screen said
     ₹1,095. There is no rider network, so the shop makes the delivery and is
     paid for it — her screen subtracted the delivery and never added back the
     part that reaches them. Both screens describe one order, so both print one
     number: what the shop is actually paid, SAAHAA's charge, and the dispatch
     cut, which together are exactly what she pays. */
  const ownDelivery = flags.isOn('RIDER_POOL') ? 0 : (q.riderPayout | 0);
  const [shopGets, shopFee, shopDispatch] = M.roundParts(
    [(q.shopPayout | 0) + ownDelivery, q.platformFee | 0, q.dispatchCut | 0], q.customerPays);
  /* items + delivery must add to the total printed under them */
  /* The payable is rounded UP to a whole rupee (she types it into her bank
     app), so the rounding is a PART like any other — leave it out and the
     column stops summing to the total printed under it, which is the one
     rule this bill has. */
  const cartRow = M.fmtParts([q.itemsTotal, q.deliveryFee], q.customerPays);
  /* AND THE ROWS ABOVE THE BILL WERE NEVER ROUNDED WITH IT. Seven lines summing
     ₹678 sat under "you pay ₹677", and the same basket rendered ₹283 here and
     ₹282 on the order she was charged for — two rounding regimes for one
     shelf. The receipt already does this; the cart now does it the same way. */
  /* AND REDISTRIBUTING THE DRIFT PUT IT ON THE ONE LINE SHE CHECKS. A ₹677.41
     can showed ₹677 on the shelf and ₹676 in the cart, because `roundParts`
     dumps the correction on the LARGEST part — which on a grocery column is
     always the item she remembers the price of.

     Fee, GST and payout are parts of one whole and must be made to sum. Seven
     grocery lines are seven independent facts; forcing them to sum to a rounded
     basket is asking one of them to be wrong. Each line prints its own honest
     rounding, and the basket beneath prints the paise so the column can still
     be checked. */
  /* AND IT STOPPED HALF WAY, exactly as the receipt did. The check below is
     right -- it notices when the column cannot be added up in whole rupees --
     and then moved only the SUBTOTAL to paise, so four rows reading ₹282, ₹517,
     ₹65 and ₹1,642 summed to ₹2,506 beside a total of ₹2,505. If the column
     descends to paise, all of it descends. */
  const lineSum = (cart.lines || []).reduce((n, l) => n + Math.round((l.unitPrice | 0) * l.qty / 100) * 100, 0);
  const cartPaise = lineSum !== Math.round(q.itemsTotal / 100) * 100;
  const lineRow = (cart.lines || []).map(l =>
    (cartPaise ? M.fmt2 : M.fmt)((l.unitPrice | 0) * l.qty));
  /* THE ITEMS LINE MUST COME FROM THE SAME PLACE AS THE REST OF THE COLUMN.
     It formatted itemsTotal on its own while the delivery line came from
     fmtParts, so the two lines were rounded by different rules and stopped
     summing to the total under them the moment the payable was rounded up
     to a whole rupee. fmtParts exists precisely to make a column add up. */
  const itemsShown = cartRow[0];
  const fromWalletP = Math.min(w.balance, q.customerPays);
  const [fromWallet, viaGateway] = M.roundParts([fromWalletP, q.customerPays - fromWalletP], q.customerPays);

  return `
  ${header('Checkout', `${q.shop.name} · ${q.km} km`)}
  <main class="wrap">
    <div class="m-two">
    <div>
    <div class="m-sec">
      <p class="m-cap">${n} item${n === 1 ? '' : 's'}</p>
      ${cart.lines.map((l, li) => {
        /* the picture the customer chose the item by, at the same 44px box
           whether the shop photographed it or not */
        const prod = getState().products.find(x => x.id === l.productId);
        return `
      <div class="m-row" style="align-items:flex-start">
        <span class="thumb m-thumb" style="width:44px;height:44px" aria-hidden="true">${
          picture(prod && prod.photo, '') || icon(prodGlyph(prod || l), { size: 18 })}</span>
        <div class="grow" style="min-width:0">
          <div class="m-row__t">${esc(l.name)}</div>
          <!-- "₹63 kg · 3 · ₹188" — 63 x 3 is 189. The unit price was rounded and the
               extension was not, so the two numbers she multiplies in her head could
               not produce the third. A price with paise in it is printed with them. -->
          <div class="m-row__m">${(l.unitPrice | 0) % 100 ? M.fmt2(l.unitPrice) : M.fmt(l.unitPrice)} ${esc(l.unit)}${l.variableWeight ? ' · est. until weighed' : ''}</div>
          <p class="m-cap" style="margin:8px 0 6px">${esc(t('cart.ifOutOfStock'))}</p>
          <div class="chiprow" style="flex-wrap:wrap">
            ${['similar','call','refund'].map(pol => `
              <button class="chip ${l.subPolicy === pol ? 'on' : ''}" style="min-height:44px;font-size:12px" aria-pressed="${l.subPolicy === pol}"
                data-act="cart.sub" data-id="${l.lineId}" data-pol="${pol}">
                ${esc(pol === 'similar' ? t('cart.similarOk') : pol === 'call' ? t('cart.askMe') : t('cart.justRefund'))}
              </button>`).join('')}
          </div>
        </div>
        <div class="m-row__r" style="align-self:flex-start">
          <span class="m-qty">
            <button data-act="cart.dec" data-id="${l.lineId}" aria-label="One less">−</button><b class="num">${l.qty}</b>
            <button data-act="cart.inc" data-id="${l.lineId}" aria-label="One more">+</button>
          </span>
          <b class="num" style="display:block;margin-top:8px">${lineRow[li]}</b>
        </div>
      </div>`;
      }).join('')}
      <p class="micro muted" style="margin-top:10px">
        The shop follows your choice above. No reply in 90 seconds means we refund that item —
        we never substitute silently.</p>
    </div>

    <div class="m-sec">
      <p class="m-cap">${esc(t('cart.howYouGet'))}</p>
      <div class="seg seg--block" role="group" aria-label="Delivery mode">
        ${(flags.isOn('RIDER_POOL')
            ? [['rider', 'SAAHAA rider'], ['self', t('cart.shopDelivers')], ['pickup', t('cart.pickUp')]]
            : [['rider', t('cart.deliveredToMe')], ['pickup', t('cart.pickUp')]])
          .map(([m, l]) => `<button class="seg__btn ${cartMode === m ? 'on' : ''}"
            aria-pressed="${cartMode === m}" data-act="cart.mode" data-mode="${m}">${esc(l)}</button>`).join('')}
      </div>
    </div>
    </div>

    <div>
    <div class="m-sec">
      <p class="m-cap">${esc(t('cart.bill'))}</p>
      <div class="m-kv"><span>${esc(t('cart.items'))}${provisional ? ` (${esc(t('cart.est'))})` : ''}</span><span class="num">${itemsShown}</span></div>
      <div class="m-kv"><span>${esc(t('cart.delivery'))} · ${q.km} km${cartMode === 'pickup' ? ' · ' + esc(t('cart.pickUp')) : ''}</span><span class="num">${q.deliveryFee ? cartRow[1] : esc(t('cart.free'))}</span></div>
      <!-- AND THE TOTAL ROUNDED WHILE THE LINE ABOVE IT DID NOT. "సామాను ₹658.29 /
           డెలివరీ ఉచితం / మీరు కట్టేది ₹658" — printed one line apart, on the screen
           where she authorises the payment, and ₹658.29 is what escrow actually
           took. The column and its total share one regime, the same rule the
           receipt learned. -->
      <div class="m-kv m-kv--total"><span>${esc(t('cart.youPay'))}${provisional ? ` (${esc(t('cart.est'))})` : ''}</span><span class="num">${(cartPaise ? M.fmt2 : M.fmt)(q.customerPays)}</span></div>
      <!-- "receives ₹471" beside "items ₹485" and "SAAHAA's ₹15" — a
           three-number sentence that does not reconcile, on the panel whose
           whole purpose is to prove the shop keeps everything else. All three
           come off one rounding now. -->
      <p class="m-note" style="margin-top:10px">${esc(q.shop.name)} receives ${M.fmt(shopGets)}.
        ${esc(t('cart.feeFromShop', { fee: M.fmt(shopFee), pct: q.takePct,
          floor: M.fmt(getPricing().retailFeeFloorPaise), cap: M.fmt(getPricing().retailTakeCapPaise) }))}
        <!-- "receives ₹1,182 · SAAHAA takes ₹25" on a bill of ₹1,256 left ₹49
             unaccounted, on the one panel whose whole purpose is to say where
             her money goes. The shop absorbed it so she saw "free delivery";
             she was never told who paid for it. -->
        ${q.shopAbsorbs ? esc(t('cart.shopCoversDelivery', { amount: M.fmt(q.shopAbsorbs), shop: q.shop.name })) : ''}
        <!-- AND WHEN SHE PAYS FOR THE DELIVERY, THE SHOP IS THE ONE MAKING IT.
             There is no rider network yet, so the delivery money goes to
             whoever actually drove — which is the shop. Its own panel has said
             "You made this delivery + ₹34" for versions; this sentence stopped
             at the basket payout and so understated what the shop takes home by the
             whole delivery, on the panel that exists to show her where her
             money goes. Both sides now describe the same order. -->
        ${(!flags.isOn('RIDER_POOL') && (q.riderPayout | 0) && !q.shopAbsorbs)
          ? esc(t('cart.shopMakesDelivery', { amount: M.fmt(q.riderPayout), shop: q.shop.name })) : ''}
        <!-- AND THE THIRD PART WAS COMPUTED AND NEVER PRINTED. shopDispatch
             comes out of the same roundParts as the other two precisely so
             the three sum to what she pays -- and the sentence stopped after
             two. "You pay ₹46 · receives ₹36 · SAAHAA's charge ₹5" leaves ₹5
             of her money unaccounted, on the panel whose whole purpose is to
             say where it goes. The home page names this cut; her bill did not. -->
        ${shopDispatch ? esc(t('cart.dispatchCut', { amount: M.fmt(shopDispatch) })) : ''}
        ${provisional ? esc(t('cart.weighedNote')) : ''}</p>
    </div>

    <!-- WHERE IT GOES. The cart never asked, so every grocery order shipped
         with an empty address and the rider was sent to an area centroid — the
         one defect the customer audit called "the product not working". The
         service sheet has asked since 8.6.0; this is the same question, from
         the same module, so the two cannot drift apart again. -->
    ${me() && ADDR.modeNeedsAddress(cartMode) ? `<div class="m-sec">
      <p class="m-cap">${esc(t('cart.whereItGoes'))}</p>
      ${ADDR.addressFields({ required: true })}
      <p class="micro muted" style="margin-top:-4px">${(me() || {}).address
        ? esc(t('cart.savedAddress'))
        : esc(t('cart.needDoor'))}</p>
    </div>` : ''}

    <div class="m-sec">
      <p class="m-cap">${esc(t('cart.howYouPay'))}</p>
      <div class="m-kv"><span>From your SAAHAA wallet</span><span class="num">${M.fmt(fromWallet)}</span></div>
      <div class="m-kv"><span>${esc(gatewayLine())}</span><span class="num">${M.fmt(viaGateway)}</span></div>
      <p class="micro muted" style="margin-top:6px">${esc(t('cart.heldUntil'))}</p>
    </div>

    <div class="m-bar" style="margin-top:0">
      <div class="grow">
        <div class="m-bar__t">${n} item${n === 1 ? '' : 's'} · ${M.fmtMax(q.customerPays)}</div>
        <div class="m-bar__m">${deliveryLine(q)}</div>
      </div>
      <!-- THE MINIMUM WAS ONLY REVEALED AFTER SHE COMMITTED. The button was fully
           enabled on a below-minimum basket and produced a transient toast that
           changed nothing on screen. Say the gap, in rupees, before the tap. -->
      <button class="btn btn--primary" data-act="cart.place"
        ${q.itemsTotal < (q.shop.minOrder || 0) ? 'disabled' : ''}>${esc(t('cart.place'))}</button>
    </div>
    ${q.itemsTotal < (q.shop.minOrder || 0)
      ? `<p class="m-note" style="margin-top:8px">${M.fmt((q.shop.minOrder || 0) - q.itemsTotal)} more to reach
          ${esc(q.shop.name)}&rsquo;s ${M.fmt(q.shop.minOrder)} minimum.</p>`
      : needsAddr ? `<p class="m-note" style="margin-top:8px">${esc(t('cart.addAddress'))}</p>` : ''}
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="cart.clear">${esc(t('cart.empty'))}</button>
    </div>
    </div>
    <div style="height:24px"></div>
  </main>
  ${SYS_CSS}`;
}

/* the gateway's own label, shortened to a bill line ("Via Sandbox UPI") */
const gatewayLine = () => 'Via ' + gateway.label().split(' — ')[0];

/* WHAT SHE TAPPED WAS THROWN AWAY. A guest tapping ADD was bounced to sign-in
   with "Sign in to start a cart" — and after signing in the cart was empty and
   she was on Home, not back at the shop. She had to find the shop, find the
   item and tap ADD a second time, having already done exactly what the app
   asked. The tap is remembered and replayed. */
const PENDING = 'SAAHAA_PENDING_ADD';
export function replayPendingAdd() {
  let want = null;
  try { want = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) {}
  try { sessionStorage.removeItem(PENDING); } catch (e) {}
  if (!want || !want.productId) return null;
  /* AN HOUR WAS FAR TOO LONG. The orphaned record fired twenty minutes later on
     an unrelated sign-in and put somebody else's sugar in a new cart. This is a
     tap she made seconds ago on her way to a sign-in form; anything longer than
     the walk between those two screens is not that tap. */
  if (Date.now() - (want.at || 0) > 10 * 60e3) return null;
  const p = getState().products.find(x => x.id === want.productId);
  if (!p) return null;
  const r = flow.addToCart(p, 1);
  if (r && r.ok) toast(`${p.name} is in your cart`);
  return { shopId: p.shopId, ok: !!(r && r.ok) };
}

export function addToCart(productId) {
  if (isGuest()) {
    try { sessionStorage.setItem(PENDING, JSON.stringify({ productId, at: Date.now() })); } catch (e) {}
    toast('Sign in and we will put it straight in your cart');
    ctx.go('auth');
    return;
  }
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
