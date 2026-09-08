/* SAAHAA · ui/views/home.js — the customer home screen and the 3-tap booking.

   MODERNIST. Home is the mockup's 1b "the ask" on top of 1a's list: a red
   band that asks the question, the ask box (which IS the search — one query
   reaches services, sub-services, shops, products and the customer's own
   orders), what is still open from before, one-tap chips, who is open now,
   and the categories. The engine is untouched: same registry, same matcher,
   same quote, same actions, same ids. What changed is the surface.

   The booking sheet is the mockup's "Booking & payment": the worker's own
   price, SAAHAA's charge laid on top (the LIVE dial, never a constant), what
   you pay, how it is paid (wallet first, the gateway for the rest), and the
   refund rule read from CANCEL_RULES. */

import { mount, esc, sheet, closeSheet, toast, ratingStars, delegate } from '../dom.js';
import { ctx, getState, me, myArea, isGuest, myOrders, saveSession, dispatch } from '../../core/ctx.js';
import * as persist from '../../core/persist.js';
import { live, get } from '../../core/registry.js';
import { AREA_NAMES, AREA_GEO, kmBetween, etaMins } from '../../domain/match.js';
import * as gmap from '../map.js';
import { GROUPS } from '../../domain/catalog.services.js';
import { mark } from '../logo.js';
import { icon, hasIcon } from '../icons.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { tier } from '../../domain/trust.js';
import * as flags from '../../core/flags.js';
import { trackerFor, trackerIndex, stage, isTerminal } from '../../domain/orders.js';
import { CANCEL_RULES } from '../../domain/pricing.js';
import { getPricing } from '../../domain/settings.js';
import * as gateway from '../../core/gateway.js';
import * as A from '../../domain/auction.js';
import * as ask from './ask.js';
import { SYS_CSS, header, emptyBlock } from './shops.js';

/* the four sections of the neighbourhood, drawn like everything else */
const GROUP_ICON = { home: 'groupHome', care: 'groupCare', life: 'groupLife', shops: 'groupShops' };

let search = '';
/* Recent searches live in module memory only — no store, no persistence, no
   invented "history" feature. Keystrokes collapse: p / pl / plu / plum fold
   into the longest form the user actually reached, so the row never fills up
   with the prefixes of one word. */
const recent = [];
export const setSearch = v => {
  search = v;
  const t = String(v || '').trim();
  if (t.length < 3) return;
  const k = t.toLowerCase();
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i].toLowerCase();
    if (r.startsWith(k) || k.startsWith(r)) recent.splice(i, 1);
  }
  recent.unshift(t);
  if (recent.length > 5) recent.length = 5;
};

const cats = () => live('category');
const services = () => cats().filter(c => c.kind === 'service');
const retails  = () => cats().filter(c => c.kind === 'retail');

/* ══════════════ WHERE THE CUSTOMER IS ══════════════════════════
   An area is a place: a label the user recognises AND the coordinates behind
   it, so a distance is a real distance and SAAHAA works in a town nobody
   hard-coded. We keep writing `area` — the short label — everywhere it was
   written before; `loc` is added alongside it. */
const GUEST_LOC = 'SAAHAA_GUEST_LOC';
const HYD = { lat: 17.4486, lng: 78.3908 };

/** The signed-in user's place, the guest's place, or — failing both — the
    label alone, which domain/match.js still knows how to measure from. */
export function myPlace() {
  const s = me();
  if (s && s.loc && s.loc.lat != null) return s.loc;
  if (!s) {
    try {
      const r = persist.read(GUEST_LOC, null);
      if (r && r.lat != null) return r;
    } catch (e) { /* private mode, or a value from an older build */ }
  }
  return myArea();
}

function setMyPlace(p) {
  const s = me();
  if (s) {
    /* Both, deliberately: the session is what the current tab reads, the user
       record is what survives a reload (restoreSession re-reads the record). */
    saveSession({ ...s, area: p.label, loc: p });
    dispatch({ type: 'user/patch', payload: { key: s.key, patch: { area: p.label, loc: p } } });
  } else {
    persist.write(persist.KEYS.guestArea, p.label);   // keeps ctx.myArea() honest
    persist.write(GUEST_LOC, p);
  }
}

/* ── the place picker (data-act="area.pick", routed by app.js) ── */

let hits = [];                 // last geocode results
let mapH = null, mapEl = null; // the picker's map

export function openPlacePicker() {
  hits = [];
  sheet('Where are you?', pickerBody(), { onClose: destroyMap });
  setTimeout(mountMap, 0);
}

function pickerBody() {
  const cur = myPlace();
  return `
    <p class="tiny muted" style="margin-bottom:12px">Search any place in the world, use your location, or
      tap an area. Everything nearby is measured from here.</p>

    <div class="search" style="border:2px solid var(--color-text);height:48px">
      ${icon('search', { size: 18 })}
      <input id="areaQ" type="search" placeholder="Search a place — area, town or city"
             aria-label="Search for a place">
      <button class="btn btn--primary btn--sm" data-act="area.search">Search</button>
    </div>

    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn btn--ghost btn--sm" data-act="area.locate">
        ${icon('pin', { size: 14 })} Use my location</button>
    </div>

    <div id="areaMap" style="height:200px;margin-top:10px;overflow:hidden;
      border:1px solid var(--color-divider);background:var(--surface-2)"></div>
    <p class="micro muted" style="margin-top:6px">Drag the pin, or tap the map, to fix your exact spot.</p>

    <div id="areaResults" class="chiprow" style="flex-wrap:wrap;gap:8px;margin-top:10px"></div>

    <p class="tiny" id="areaLabel" style="margin-top:10px">
      Serving <b>${esc(typeof cur === 'string' ? cur : cur.label)}</b></p>

    <p class="m-cap" style="margin-top:14px">Hyderabad areas</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:6px">
      ${AREA_NAMES.map(a => {
        const g = AREA_GEO[a];
        return g ? `<button class="chip${myArea() === a ? ' on' : ''}" data-act="area.choose"
          data-lat="${g[0]}" data-lng="${g[1]}" data-label="${esc(a)}">${esc(a)}</button>` : '';
      }).join('')}
    </div>
    <div style="height:8px"></div>${SYS_CSS}`;
}

function resultChips() {
  return hits.map(h => `<button class="chip chip--smart" data-act="area.choose"
    data-lat="${h.lat}" data-lng="${h.lng}" data-label="${esc(h.label)}">${esc(h.label)}</button>`).join('');
}

function destroyMap() {
  if (mapH) { mapH.destroy(); mapH = null; }
  mapEl = null;
}

async function mountMap() {
  const el = document.getElementById('areaMap');
  if (!el) { destroyMap(); return; }
  if (el === mapEl && mapH) { paintMap(); return; }
  try { await gmap.ready(); }
  catch (e) {
    mount(el, '<p class="micro muted" style="padding:12px">Map unavailable — search and the ' +
      'area chips still work.</p>');
    return;
  }
  const cur = document.getElementById('areaMap');
  if (!cur) return;
  destroyMap();
  mapEl = cur;
  const p = myPlace();
  const c = typeof p === 'string' ? (AREA_GEO[p] ? { lat: AREA_GEO[p][0], lng: AREA_GEO[p][1] } : HYD) : p;
  mapH = gmap.mapInto(cur, { center: [c.lat, c.lng], zoom: 13 });
  if (mapH) mapH.on('click', pt => pinTo(pt));
  paintMap();
}

function paintMap() {
  if (!mapH) return;
  mapH.clear();
  const p = myPlace();
  const c = typeof p === 'string' ? (AREA_GEO[p] ? { lat: AREA_GEO[p][0], lng: AREA_GEO[p][1] } : null) : p;
  if (!c) return;
  mapH.pin(c.lat, c.lng, {
    color: '#ec3013', label: c.label || myArea(), draggable: true,
    onMove: pt => pinTo(pt),
  });
  mapH.fit([[c.lat, c.lng]]);
  mapH.invalidate();
}

/* a dropped pin is committed straight away — the sheet has no Save button
   because there is nothing to save: the map IS the choice */
async function pinTo(pt) {
  let label = `${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}`;
  try { const r = await gmap.reverse(pt.lat, pt.lng); if (r && r.label) label = r.label; }
  catch (e) { /* offline: the coordinates still stand */ }
  setMyPlace({ lat: pt.lat, lng: pt.lng, label });
  const el = document.getElementById('areaLabel');
  if (el) mount(el, `Serving <b>${esc(label)}</b>`);
  paintMap();
  ctx.render();
}

/* ── the three actions app.js registered for this screen ─────── */
export async function useMyLocation() {
  toast('Asking your device where you are…');
  try {
    const p = await gmap.locate();
    await pinTo(p);
    toast('Got it — drag the pin if it is slightly off');
  } catch (e) {
    toast(e.message || 'Could not get your location — search for it instead', 'warn');
  }
}

export async function searchPlace() {
  const el = document.getElementById('areaQ');
  const q = el ? el.value.trim() : '';
  if (q.length < 3) { toast('Type at least three letters', 'warn'); return; }
  const box = document.getElementById('areaResults');
  if (box) mount(box, '<span class="micro muted">Searching…</span>');
  try { hits = await gmap.geocode(q, { limit: 6 }); }
  catch (e) {
    hits = [];
    if (box) mount(box, '<span class="micro muted">Search is unavailable right now — drop the pin instead.</span>');
    return;
  }
  if (box) mount(box, hits.length ? resultChips()
    : `<span class="micro muted">Nothing matched &ldquo;${esc(q)}&rdquo;.</span>`);
}

export function choosePlace(d) {
  if (!d || d.lat == null) return;
  const p = { lat: +d.lat, lng: +d.lng, label: String(d.label || 'Your place') };
  setMyPlace(p);
  closeSheet();
  toast(`Serving ${p.label}`);
}

/* ══════════════ THE HEADER THAT GETS OUT OF THE WAY ═════════════
   Home's header carries four things a customer needs on arrival — where they
   are, who they are, the ask, and the ask box — and exactly one thing they
   need while scanning results: the box. So on the way down everything but
   the box folds away; on the way back up it returns.

   Hysteresis, not a threshold. A bare `y > 80` toggles twice a frame on a
   trackpad at exactly 80px: the collapse changes the header height, which
   changes the scroll position, which uncollapses it. Direction is latched at
   the reversal point and a move of 12px is required to act on it. */
const COLLAPSE_AT = 80, TRAVEL = 12, TOP = 24;
let hdrY = 0, hdrDir = 0, hdrAnchor = 0, hdrCompact = false;

function onHdrScroll() {
  const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  const d = y - hdrY;
  /* the anchor is where the direction TURNED, which is the previous position,
     not this one — anchoring on `y` makes a single large jump (an in-page
     anchor, a restored scroll position) look like no travel at all */
  if (d > 0 && hdrDir <= 0) { hdrDir = 1; hdrAnchor = hdrY; }
  if (d < 0 && hdrDir >= 0) { hdrDir = -1; hdrAnchor = hdrY; }
  hdrY = y;
  if (y <= TOP) hdrCompact = false;
  else if (hdrDir > 0 && y > COLLAPSE_AT && y - hdrAnchor >= TRAVEL) hdrCompact = true;
  else if (hdrDir < 0 && hdrAnchor - y >= TRAVEL) hdrCompact = false;
  applyHdr();
}
function applyHdr() {
  const el = document.querySelector('.hdr--home');
  if (el) el.classList.toggle('hdr--compact', hdrCompact);
}
window.addEventListener('scroll', onHdrScroll, { passive: true });

function matchCat(c, q) {
  const n = q.toLowerCase();
  return c.name.toLowerCase().includes(n) || (c.blurb || '').toLowerCase().includes(n) ||
         (c.subs || []).some(s => s.toLowerCase().includes(n)) ||
         (c.aisles || []).some(s => s.toLowerCase().includes(n));
}

/* the one category a free-text term most likely means. A recent search only
   becomes a chip when it resolves to a real destination — a chip that cannot
   go anywhere is decoration, and decoration is what we are removing. */
function bestCat(q) {
  const hit = cats().filter(c => matchCat(c, q));
  return hit.length ? hit[0] : null;
}

/* ── supply proof ──────────────────────────────────────────────
   "from Rs.X" was a floor almost nobody actually pays. Supply proof is true,
   self-updating and more persuasive: it answers "can I actually get this
   right now?". */
function supplyLine(c) {
  const st = getState();
  if (c.kind === 'retail') return `${st.shops.filter(x => x.catId === c.id && x.isOpen).length} open now`;
  const pool = st.partners.filter(p => p.cat === c.id && !p.suspended);
  const online = pool.filter(p => p.online !== false).length;
  return online ? `${online} nearby` : pool.length ? `${pool.length} nearby` : 'New here — be first';
}

/* a category tile: the mockup's bordered box — icon, name, supply line */
function tileHtml(c, wide = false) {
  return `<button class="tile${wide ? ' tile--wide' : ''}" data-act="cat.open" data-id="${c.id}" aria-label="${esc(c.name)}">
    <span class="ic" aria-hidden="true">${hasIcon(c.id) ? icon(c.id, { size: 20 }) : esc(c.name[0])}</span>
    <span class="lbl">${esc(c.name)}</span>
    <span class="meta">${esc(supplyLine(c))}</span>
  </button>`;
}

/* a category's chip glyph is its SVG icon — never the registry's emoji, which
   renders as tofu or fragments on the phones this app is for (see icons.js) */
const catGlyph = c => hasIcon(c.id) ? icon(c.id, { size: 14 }) : '';

/* a suggestion chip is a real destination, never a decorative word */
function smartChip(label, catId, ico) {
  return `<button class="chip" data-act="cat.open" data-id="${catId}">
    <span class="chip__ic" aria-hidden="true">${ico || ''}</span>${esc(label)}</button>`;
}

/* ── what is still open from before ──────────────────────────── */
function liveOrders() {
  // the machine knows which stages are terminal; a hand-kept list missed PARTIAL and REFUNDED
  return myOrders().filter(o => !isTerminal(o.stage) &&
    !['SETTLED', 'R_SETTLED', 'RATED', 'PARTIAL', 'REFUNDED', 'R_REFUNDED'].includes(o.stage));
}
function openAsks() {
  try { return A.myRequests().filter(r => ['bidding', 'awaiting_choice'].includes(r.status)); }
  catch (e) { return []; }
}

function orderRow(o, lead = true) {
  const st = stage(o.stage);
  const cat = get('category', o.catId);
  const track = trackerFor(o.kind); const idx = trackerIndex(o);
  const who = o.kind === 'service' ? o.partnerName : o.shopName;
  return `<button class="m-row" data-act="order.open" data-id="${esc(o.id)}">
    <span class="m-lead${lead ? '' : ' m-lead--dim'}" aria-hidden="true"></span>
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(o.kind === 'service' ? `${cat.name}${o.sub ? ' · ' + o.sub : ''}` : `${o.lines.length} item${o.lines.length === 1 ? '' : 's'} from ${o.shopName}`)}</div>
      <div class="m-row__m" style="margin-bottom:0">${esc(who)} · ${esc(st.label.toLowerCase())} · step ${idx + 1} of ${track.length}${o.eta && !isTerminal(o.stage) ? ` · ~${o.eta} min` : ''}</div>
    </div>
    <div class="m-row__r"><b class="num">${M.fmt(o.customerPays)}</b></div>
    <span class="m-row__go" aria-hidden="true">→</span>
  </button>`;
}
function askRow(r) {
  const cat = get('category', r.catId);
  const n = A.bidsFor(r.id).length;
  return `<a class="m-row" href="#/ask/${esc(r.id)}">
    <span class="m-lead" aria-hidden="true"></span>
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(cat.name)}${r.sub ? ` · ${esc(r.sub)}` : ''}</div>
      <div class="m-row__m" style="margin-bottom:0">${r.status === 'bidding' ? 'Asking workers for rates' : 'Rates are in — pick one'} · ${n} ${n === 1 ? 'reply' : 'replies'}${
        r.held ? ` · your ${M.fmt(r.held.amount)} stays held` : ''}</div>
    </div>
    <span class="m-row__go" aria-hidden="true">→</span>
  </a>`;
}

function stillOpen() {
  const orders = liveOrders();
  const asks = openAsks();
  if (!orders.length && !asks.length) return '';
  return `<div class="sec">
    <p class="m-cap">Still open from before</p>
    ${asks.map(askRow).join('')}
    ${orders.slice(0, 4).map(o => orderRow(o)).join('')}
    ${orders.length > 4 ? `<button class="more" style="margin-top:10px" data-act="nav.orders">All ${orders.length} live orders →</button>` : ''}
  </div>`;
}

/* ── who is open now: named pros and shops, nearest first ──── */
export function avgOf(p) {
  const r = p.ratings || [];
  if (!r.length) return 4.5;
  return r.reduce((a, x) => a + x.stars, 0) / r.length;
}
function proRow(p, km) {
  const cat = get('category', p.cat) || { name: '' };
  const t = tier(p.tier);
  return `<button class="m-row" data-act="pro.open" data-id="${esc(p.id)}">
    <span class="thumb m-thumb" aria-hidden="true">${hasIcon(p.cat) ? icon(p.cat, { size: 22 }) : esc(p.name[0])}</span>
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(p.name)}</div>
      <div class="m-row__m">${esc(cat.name)} · ${km} km · ~${etaMins(km)} min</div>
      <div class="m-row__tags"><span class="tag tag-accent">${avgOf(p).toFixed(1)} ★</span>
        <span class="tag tag-neutral">${t.badge ? esc(t.badge) : `${p.completed | 0} jobs`}</span></div>
    </div>
  </button>`;
}
function shopRow(s, km) {
  const cat = get('category', s.catId) || { name: '' };
  const n = getState().products.filter(p => p.shopId === s.id && p.active).length;
  return `<button class="m-row" data-act="shop.open" data-id="${esc(s.id)}">
    <span class="thumb m-thumb" aria-hidden="true">${hasIcon(s.catId) ? icon(s.catId, { size: 22 }) : esc(s.name[0])}</span>
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(s.name)}</div>
      <div class="m-row__m">${esc(cat.name)} · ${n} items in stock · ${km} km</div>
      <div class="m-row__tags"><span class="tag tag-accent">${esc(s.ratingAvg)} ★</span>
        <span class="tag tag-neutral">Delivers · ~${etaMins(km) + (s.prepMins || 20)} min</span></div>
    </div>
  </button>`;
}
function openNow() {
  const st = getState();
  const here = myPlace();
  const pros = st.partners.filter(p => !p.suspended && p.online !== false && (p.tier | 0) >= 1)
    .map(p => ({ p, km: kmBetween(here, p.loc || p.area) })).sort((a, b) => a.km - b.km).slice(0, 4);
  const shops = st.shops.filter(s => s.isOpen && s.status === 'active')
    .map(s => ({ s, km: kmBetween(here, s.loc || s.area) })).sort((a, b) => a.km - b.km).slice(0, 3);
  if (!pros.length && !shops.length) return '';
  return `<div class="sec">
    <div class="between" style="margin-bottom:8px">
      <p class="m-cap" style="margin:0">Open now</p>
      <div class="row" style="gap:14px">
        <button class="more" data-act="nav.nearby">Map view →</button>
        <button class="more" data-act="scroll.all">All ${cats().length} categories →</button>
      </div>
    </div>
    ${pros.map(x => proRow(x.p, x.km)).join('')}
    ${shops.map(x => shopRow(x.s, x.km)).join('')}
  </div>`;
}

/* ── search: one query, every surface ──────────────────────── */
function searchAll(q) {
  const n = q.toLowerCase();
  const st = getState();
  const catHits = cats().filter(c => matchCat(c, n));
  const subHits = [];
  cats().forEach(c => (c.subs || []).forEach(s => {
    if (s.toLowerCase().includes(n)) subHits.push({ c, s });
  }));
  const shopHits = st.shops.filter(s =>
    s.name.toLowerCase().includes(n) || (get('category', s.catId).name || '').toLowerCase().includes(n));
  const prodHits = st.products.filter(p => p.active && p.name.toLowerCase().includes(n));
  const orderHits = myOrders().filter(o => {
    const cat = get('category', o.catId);
    return [o.partnerName, o.shopName, cat.name, o.sub].filter(Boolean)
      .some(v => String(v).toLowerCase().includes(n));
  });
  const total = catHits.length + subHits.length + shopHits.length + prodHits.length + orderHits.length;
  return { catHits, subHits: subHits.slice(0, 8), shopHits: shopHits.slice(0, 6),
           prodHits: prodHits.slice(0, 8), orderHits: orderHits.slice(0, 4), total };
}

function searchResults(q) {
  const r = searchAll(q);
  if (!r.total) return `<div class="empty empty--smart">
    <div class="em-ico">${mark(40, { detail: true })}</div>
    <h3 style="font-size:17px">Nothing matched &ldquo;${esc(q)}&rdquo;</h3>
    <p style="margin-top:6px">These are live in ${esc(myArea())} right now.</p>
    <div class="chiprow" style="justify-content:center;flex-wrap:wrap;margin-top:14px">
      ${services().slice(0, 4).map(c => smartChip(c.name, c.id, catGlyph(c))).join('')}
    </div></div>`;

  const st = getState();
  const here = myPlace();
  const sec = (title, count, body) => `<div class="sec">
    <div class="between" style="margin-bottom:6px"><p class="m-cap" style="margin:0">${esc(title)}</p><span class="meta">${count}</span></div>${body}</div>`;

  return `
  ${r.orderHits.length ? sec('Your orders', r.orderHits.length,
    r.orderHits.map(o => orderRow(o, !isTerminal(o.stage))).join('')) : ''}

  ${r.catHits.length ? sec('Services & shops', r.catHits.length,
    `<div class="grid3">${r.catHits.map(c => tileHtml(c)).join('')}</div>`) : ''}

  ${r.subHits.length ? sec('Exactly what you need', r.subHits.length,
    `<div class="chiprow" style="flex-wrap:wrap;gap:8px">${r.subHits.map(({ c, s }) =>
      `<button class="chip" data-act="book.sub" data-id="${c.id}" data-sub="${esc(s)}">
        <span class="chip__ic" aria-hidden="true">${catGlyph(c)}</span>${esc(s)}</button>`).join('')}</div>`) : ''}

  ${r.prodHits.length ? sec('On shop shelves', r.prodHits.length,
    r.prodHits.map(p => {
      const sh = st.shops.find(x => x.id === p.shopId);
      return `<button class="m-row" data-act="shop.open" data-id="${esc(p.shopId)}">
        <div class="grow" style="min-width:0">
          <div class="m-row__t">${esc(p.name)}</div>
          <div class="m-row__m" style="margin-bottom:0">${esc(sh ? sh.name : 'Shop')} · ${esc(p.unit)}</div></div>
        <div class="m-row__r"><b class="num">${M.fmt(p.price)}</b></div>
        <span class="m-row__go" aria-hidden="true">→</span></button>`;
    }).join('')) : ''}

  ${r.shopHits.length ? sec('Shops near you', r.shopHits.length,
    r.shopHits.map(s => shopRow(s, kmBetween(here, s.loc || s.area))).join('')) : ''}`;
}

/* ── the screen ────────────────────────────────────────────── */
export function render() {
  const s = me();
  const q = search.trim();
  const st = getState();
  const cart = flow.getCart();
  const cartCount = cart ? cart.lines.reduce((n, l) => n + l.qty, 0) : 0;
  const liveCount = liveOrders().length + openAsks().length;
  const shopsGroup = GROUPS.find(g => g.id === 'shops');
  const prosOnline = st.partners.filter(p => !p.suspended && p.online !== false).length;
  const shopsOpen = st.shops.filter(x => x.isOpen && x.status === 'active').length;
  const P = getPricing();

  /* suggestions when the box is empty: the categories with real supply right
     now, ordered by it — not a hand-written list that can go stale */
  const suggest = services()
    .map(c => ({ c, n: st.partners.filter(p => p.cat === c.id && p.online !== false && !p.suspended).length }))
    .sort((a, b) => b.n - a.n).slice(0, 6).map(x => x.c);
  const recentChips = recent.map(t => ({ t, c: bestCat(t) })).filter(x => x.c);
  const best = q ? bestCat(q) : null;

  // the header is rebuilt by every render; re-apply whatever the scroll
  // position already decided, so a re-render never pops it back open
  setTimeout(applyHdr, 0);

  return `
  <header class="hdr hdr--home">
    <div class="wrap inner">
      <button class="loc tap grow" data-act="area.pick" aria-label="Change where you are served">
        <b style="font:800 17px/1 var(--font-heading)">${esc(myArea())} ▾</b>
        <small style="font-size:11px;color:var(--ink-3);margin-top:3px">${prosOnline} pros · ${shopsOpen} shops nearby</small>
      </button>
      <button class="btn btn--ghost tap" data-act="nav.orders" aria-label="Your live orders" style="padding-inline:8px">
        <span style="position:relative;display:grid;place-items:center">
          ${icon('bell', { size: 20 })}
          ${liveCount ? `<span class="fab__count" style="position:absolute;top:-6px;right:-8px">${liveCount}</span>` : ''}
        </span>
      </button>
      <button class="btn btn--ghost tap" data-act="theme.toggle" aria-label="Switch theme" style="padding-inline:8px">${icon('theme', { size: 20 })}</button>
      ${s ? `<button class="tap" data-act="nav.account" aria-label="Account"
              style="width:44px;height:44px;border:1px solid var(--color-divider);display:grid;place-items:center;font:800 12px var(--font-heading)">${esc(s.name[0])}</button>`
           : `<button class="btn btn--secondary btn--sm" data-act="auth.open">Sign in</button>`}
    </div>

    <div class="hero">
      <div class="m-hero hdr__fold">
        <div class="m-hero__k">Together, we elevate life</div>
        <h1 class="hero__title">What do you<br>need today?</h1>
        <p>${shopsOpen} shop${shopsOpen === 1 ? '' : 's'} and ${prosOnline} pro${prosOnline === 1 ? '' : 's'} in ${esc(myArea())} are listening.</p>
      </div>
      <div class="m-ask">
        <div class="search hero__search">
          ${icon('search', { size: 20 })}
          <input id="q" type="search" placeholder="Fan in the bedroom stopped working…"
                 value="${esc(search)}" data-role="search"
                 aria-label="Say what you need — services, shops, products and your orders">
          ${q ? `<button class="btn btn--ghost btn--sm tap" data-act="search.clear" aria-label="Clear search">${icon('cross', { size: 16 })}</button>` : ''}
        </div>
        <div class="hdr__fold">
          ${best ? `<button class="btn btn--primary btn--block" style="justify-content:flex-start;margin-top:10px"
              data-act="cat.open" data-id="${best.id}">Send to the circle → ${esc(best.name)}</button>` : ''}
          ${!q ? `<div class="chiprow" style="margin-top:10px;flex-wrap:wrap">
            ${recentChips.length
              ? recentChips.map(x => smartChip(x.t, x.c.id, icon('refresh', { size: 14 }))).join('')
              : suggest.slice(0, 4).map(c => smartChip(c.name, c.id, catGlyph(c))).join('')}
          </div>
          <p class="micro muted" style="margin-top:8px">One search finds people who come to you, shops that deliver to you, and your own orders.</p>` : ''}
        </div>
      </div>
    </div>
  </header>

  <main class="wrap" id="mainScroll">
    ${q ? `
      <div class="sec" style="padding-bottom:0">
        <h2 class="h-sec">Results for &ldquo;${esc(q)}&rdquo;</h2>
      </div>
      ${searchResults(q)}` : `

      <div class="home-lay">
        <div class="home-lay__main">
          ${stillOpen()}

          <div class="sec">
            <p class="m-cap">Or say it in one tap</p>
            <div class="chiprow" style="flex-wrap:wrap">
              ${s ? `<button class="chip" data-act="nav.orders">
                       <span class="chip__ic" aria-hidden="true">${icon('refresh', { size: 14 })}</span>Book again</button>` : ''}
              <button class="chip" data-act="quick.emergency">
                <span class="chip__ic" aria-hidden="true">${icon('siren', { size: 14 })}</span>Emergency</button>
              <button class="chip" data-act="quick.nearby">
                <span class="chip__ic" aria-hidden="true">${icon('pin', { size: 14 })}</span>Open now</button>
              <button class="chip" data-act="nav.nearby">
                <span class="chip__ic" aria-hidden="true">${icon('groupShops', { size: 14 })}</span>Neighbourhood map</button>
              ${cartCount ? `<button class="chip on" data-act="nav.cart">
                <span class="chip__ic" aria-hidden="true">${icon('basket', { size: 14 })}</span>Cart · ${cartCount}</button>` : ''}
              ${suggest.map(c => smartChip(c.name, c.id, catGlyph(c))).join('')}
            </div>
          </div>

          ${openNow()}
        </div>

        <aside class="home-lay__side">
          <div class="sec">
            <p class="m-cap">Why this circle holds</p>
            <ul class="m-steps" style="gap:8px">
              <li class="m-step"><span class="m-step__dot"></span><span class="m-step__t">Every pro ID-checked</span></li>
              <li class="m-step"><span class="m-step__dot"></span><span class="m-step__t">Price locked before you book</span></li>
              <li class="m-step"><span class="m-step__dot"></span><span class="m-step__t">SAAHAA holds the money until you confirm the work</span></li>
              <li class="m-step"><span class="m-step__dot"></span><span class="m-step__t">The pro keeps the whole of their price</span></li>
            </ul>
          </div>
        </aside>
      </div>

      <!-- the "See all" target: the full category listing, which exists
           regardless of which feature flags are on -->
      <div id="allCats"></div>
      ${GROUPS.filter(g => g.id !== 'shops').map((g, gi) => {
        const list = services().filter(c => c.group === g.id);
        if (!list.length) return '';
        return `<div class="sec rise rise-${Math.min(5, gi + 2)}">
          <div class="between" style="margin-bottom:8px">
            <p class="m-cap" style="margin:0;display:flex;align-items:center;gap:6px">${icon(GROUP_ICON[g.id] || 'groupHome', { size: 14 })} ${esc(g.label)}</p>
            <span class="meta">${list.length} live</span></div>
          <div class="grid3">${list.map(c => tileHtml(c)).join('')}</div></div>`;
      }).join('')}

      ${flags.isOn('RETAIL') ? `
      <div class="sec rise rise-5" id="shopsSec">
        <div class="between" style="margin-bottom:8px">
          <p class="m-cap" style="margin:0;display:flex;align-items:center;gap:6px">${icon('groupShops', { size: 14 })} ${
            esc(shopsGroup ? shopsGroup.label : 'Shops Near You')}</p>
          <button class="more" data-act="nav.shops">Browse all →</button></div>
        <p class="tiny muted" style="margin:0 0 10px">
          Kirana, veg, meat, dairy, chemist, water &amp; gas — real shops listing their own products.</p>
        <div class="grid3">${retails().map(c => tileHtml(c)).join('')}</div>
      </div>` : ''}

      <div class="sec">
        <p class="card-kicker">The other side of the circle</p>
        <h2 class="h-sec" style="margin-top:4px">Run a shop or work a trade?</h2>
        <p class="tiny muted" style="margin:6px 0 12px;max-width:60ch">List your services or your products. A pro keeps 100% of their quote —
          SAAHAA's ${esc(P.serviceMarkupPct)}% sits on top and is paid by the customer. A shop pays
          ${esc(P.retailTakePct)}% of the basket, never more than ${M.fmt(P.retailTakeCapPaise)} an order.</p>
        <button class="btn btn--primary" data-act="partner.join">List my shop or service →</button>
      </div>
    `}

    <div class="credo">
      <div class="cmark">${mark(180, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:10px">
        SAAHAA · locally, professionally · your money is held until the work is confirmed
      </p>
      <p class="micro muted" style="margin-top:8px;position:relative;z-index:1">
        <a class="micro muted" href="#/legal/terms">Terms</a> ·
        <a class="micro muted" href="#/legal/privacy">Privacy</a> ·
        <a class="micro muted" href="#/legal/refunds">Refunds</a> ·
        <a class="micro muted" href="#/legal/contact">Contact</a> ·
        <a class="micro muted" href="#/legal/about">About</a>
      </p>
    </div>
  </main>
  ${SYS_CSS}
  <style>
    /* the ask sits at the top of the screen and stays reachable: the header
       is sticky, and on the way down only the box survives */
    /* .hdr is display:flex in tokens.css — on Home the location row and the
       red band are stacked blocks, not two columns, so the flex context must
       be cancelled here or the hero collapses to a third of the width. */
    .hdr--home{display:block;position:sticky;top:0;z-index:var(--z-header)}
    @media (min-width:768px){ .hdr--home{top:calc(var(--topbar-h) + var(--tabs-h))} }
    .hdr--home .inner{padding:11px var(--gutter)}
    .hdr--home .hero{padding:0 0 var(--sp-5)}
    .hdr--home .hero__title{font:800 27px/1.08 var(--font-heading);margin:10px 0 4px}
    .hdr--home .m-ask{padding:14px var(--gutter) 0}
    .hdr--home .hero__search{margin-top:0}
    .hdr--home .loc b{display:block;max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media (min-width:768px){
      .hdr--home .inner{padding-left:0;padding-right:0}
      .hdr--home .m-ask{padding-left:0;padding-right:0}
      .hdr--home .loc b{max-width:260px}
      .hdr--home .hero__title{font-size:36px}
    }

    /* THE COLLAPSE. Only opacity and max-height animate, so the browser never
       re-lays-out the page mid-scroll. */
    .hdr--home .inner,
    .hdr--home .hdr__fold{
      max-height:420px;opacity:1;
      transition:max-height .26s ease, opacity .18s ease, padding .26s ease, margin .26s ease;
    }
    .hdr--home .hero{transition:padding .26s ease}
    .hdr--home .hero__search{transition:height .26s ease, margin .26s ease}
    .hdr--home.hdr--compact .inner,
    .hdr--home.hdr--compact .hdr__fold{
      max-height:0;opacity:0;margin-top:0;margin-bottom:0;padding-top:0;padding-bottom:0;
      overflow:hidden;pointer-events:none;
    }
    .hdr--home.hdr--compact .hero{padding-bottom:8px}
    .hdr--home.hdr--compact .m-ask{padding-top:8px}
    .hdr--home.hdr--compact .hero__search{height:44px}
    @media (prefers-reduced-motion: reduce){
      .hdr--home .inner,.hdr--home .hdr__fold,.hdr--home .hero,
      .hdr--home .hero__search{transition:none}
    }
    .home-lay__side{margin-top:0}
    @media (min-width:1024px){ .home-lay__side{position:sticky;top:calc(var(--topbar-h) + var(--tabs-h) + 12px)} }
  </style>`;
}

/* ══════════════ THE NEIGHBOURHOOD — mockup 7 ════════════════════
   A map-first browse of what is actually around you: the map fills the top,
   the search box and the Shops / Pros / Open filters float on it, and the
   same list rows the rest of the product uses sit underneath.

   The map is only ever touched through the ui/map.js contract (ready, mapInto,
   pin, circle, fit, geocode, locate) — Leaflet is never imported here.

   Filtering and searching repaint ONLY the chips and the list, never the whole
   screen: a full ctx.render() would rebuild the map element, tear the tile
   layer down and steal focus from the search field mid-keystroke. */

let nearQ = '';                       // what is typed in the map's search box
let nearKind = 'all';                 // 'all' | 'shops' | 'pros'
let nearOpen = false;                 // "Open" — online pros / open shops only
let nearMapH = null, nearMapEl = null;

function killNearMap() {
  if (nearMapH) { nearMapH.destroy(); nearMapH = null; }
  nearMapEl = null;
}
/* a map whose element has left the document is a leaked tile layer */
function sweepNearMap() {
  if (nearMapEl && !document.body.contains(nearMapEl)) killNearMap();
}
window.addEventListener('hashchange', () => setTimeout(sweepNearMap, 300));

/** Everything on the map, as one list: shops and pros, nearest first. */
function nearbyItems() {
  const st = getState();
  const here = myPlace();
  const q = nearQ.trim().toLowerCase();
  const out = [];
  if (nearKind !== 'pros') {
    st.shops.filter(s => s.status === 'active').forEach(s => {
      if (nearOpen && !s.isOpen) return;
      const cat = get('category', s.catId) || { name: '' };
      if (q && !(`${s.name} ${cat.name} ${s.area || ''}`.toLowerCase().includes(q))) return;
      out.push({ kind: 'shop', id: s.id, name: s.name, catId: s.catId, cat, raw: s,
                 loc: s.loc || s.area, km: kmBetween(here, s.loc || s.area), open: !!s.isOpen });
    });
  }
  if (nearKind !== 'shops') {
    st.partners.filter(p => !p.suspended && (p.tier | 0) >= 1).forEach(p => {
      if (nearOpen && p.online === false) return;
      const cat = get('category', p.cat) || { name: '' };
      if (q && !(`${p.name} ${cat.name} ${p.area || ''}`.toLowerCase().includes(q))) return;
      out.push({ kind: 'pro', id: p.id, name: p.name, catId: p.cat, cat, raw: p,
                 loc: p.loc || p.area, km: kmBetween(here, p.loc || p.area), open: p.online !== false });
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

/* the coordinates behind a place, or null when all we have is a name */
function geoOf(loc) {
  if (loc && loc.lat != null) return { lat: +loc.lat, lng: +loc.lng };
  const g = AREA_GEO[typeof loc === 'string' ? loc : ''];
  return g ? { lat: g[0], lng: g[1] } : null;
}

function nearRow(it) {
  const act = it.kind === 'shop' ? 'shop.open' : 'pro.open';
  const line = it.kind === 'shop'
    ? `${getState().products.filter(p => p.shopId === it.id && p.active).length} items · ${esc(it.cat.name)} · ${it.km} km`
    : `${esc(it.cat.name)} · ${it.km} km · ~${etaMins(it.km)} min`;
  const rating = it.kind === 'shop' ? Number(it.raw.ratingAvg) : avgOf(it.raw);
  return `<button class="m-row" data-act="${act}" data-id="${esc(it.id)}">
    <span class="thumb m-thumb nb-thumb" aria-hidden="true">${
      hasIcon(it.catId) ? icon(it.catId, { size: 18 }) : esc((it.name || '?')[0])}</span>
    <div class="grow" style="min-width:0">
      <div class="m-row__t">${esc(it.name)}</div>
      <div class="m-row__m">${line}</div>
      <div class="m-row__tags">
        <span class="tag tag-accent">${(rating || 0).toFixed(1)} ★</span>
        <span class="tag tag-neutral">${it.kind === 'shop'
          ? (it.open ? 'Open now' : 'Closed')
          : (it.open ? 'Free now' : 'Offline')}</span>
      </div>
    </div>
    <span class="m-row__go" aria-hidden="true">→</span>
  </button>`;
}

function nearChipsHtml() {
  const c = (key, label, on) => `<button class="chip nb-chip${on ? ' on' : ''}" aria-pressed="${on}"
    data-near="${key}">${esc(label)}</button>`;
  return c('shops', 'Shops', nearKind === 'shops') +
         c('pros', 'Pros', nearKind === 'pros') +
         c('open', 'Open', nearOpen);
}

function nearListHtml(items) {
  if (!items.length) {
    return emptyBlock(
      nearQ.trim() ? `Nothing here matches “${nearQ.trim()}”` : 'Nobody is on this map yet',
      nearQ.trim()
        ? 'Try a shorter word, or search the box above for a place to move the map.'
        : `No shops or pros have listed themselves around ${myArea()} so far. Be the first, or move the map somewhere else.`,
      `<button class="btn btn--secondary" data-act="partner.join">List my shop or service</button>`);
  }
  return items.map(nearRow).join('');
}

/** #/nearby — routed by app.js to home.renderNearby(). */
export function renderNearby() {
  sweepNearMap();
  const items = nearbyItems();
  const shops = items.filter(i => i.kind === 'shop').length;
  const pros = items.length - shops;
  setTimeout(mountNearMap, 0);

  return `
  ${header('Neighbourhood', `${myArea()} · ${shops} shop${shops === 1 ? '' : 's'} · ${pros} pro${pros === 1 ? '' : 's'}`,
    `<button class="btn btn--ghost tap" data-act="area.pick" aria-label="Change where you are"
       style="padding-inline:8px">${icon('pin', { size: 20 })}</button>`)}
  <main class="wrap nb-wrap">
    <div class="nb-map">
      <div id="nearbyMap" class="nb-canvas"></div>
      <div class="nb-over">
        <div class="nb-find">
          <input id="nearbyQ" type="search" value="${esc(nearQ)}" data-near-role="q"
                 placeholder="Search ${esc(myArea())}" aria-label="Search this neighbourhood, or a place to move the map to">
          <button class="nb-go" data-near="geo" aria-label="Search for this place on the map">${icon('search', { size: 18 })}</button>
        </div>
        <div class="chiprow nb-chips" id="nearbyChips" role="group" aria-label="Filter the map">${nearChipsHtml()}</div>
      </div>
      <div class="nb-legend" aria-hidden="true">
        <span><i class="nb-dot nb-dot--you"></i>You</span>
        <span><i class="nb-dot nb-dot--pro"></i>Pros</span>
        <span><i class="nb-dot nb-dot--shop"></i>Shops</span>
      </div>
    </div>

    <div class="nb-head">
      <div style="font:800 14px/1.2 var(--font-heading)">${items.length} near you</div>
      <button class="more" data-act="nav.shops">All shops →</button>
    </div>
    <div id="nearbyList">${nearListHtml(items)}</div>

    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:16px">
      <button class="btn btn--secondary" data-act="area.locate">${icon('pin', { size: 14 })} Use my location</button>
      <button class="btn btn--ghost" data-act="nav.home">Back to home</button>
    </div>
    <div style="height:24px"></div>
  </main>
  ${SYS_CSS}
  <style>
    .nb-wrap{padding-top:0}
    .nb-map{position:relative;margin:0 calc(-1 * var(--gutter));border-bottom:2px solid var(--color-text)}
    .nb-canvas{height:min(52vh,420px);min-height:260px;background:var(--surface-2)}
    .nb-over{position:absolute;left:12px;right:12px;top:12px;z-index:500;display:flex;flex-direction:column;gap:8px;pointer-events:none}
    .nb-over > *{pointer-events:auto}
    .nb-find{display:flex;background:var(--bg);border:2px solid var(--color-text)}
    .nb-find input{flex:1;min-width:0;height:44px;padding:0 12px;font:400 13px/1 var(--font-body);
      color:var(--ink-1);background:transparent;border:0;outline:none;caret-color:var(--color-accent)}
    .nb-find input::placeholder{color:var(--ink-3)}
    .nb-go{width:44px;min-height:44px;flex:none;display:grid;place-items:center;background:var(--color-accent);color:#fff}
    .nb-chips{flex-wrap:wrap;gap:6px}
    .nb-chip{min-height:44px;background:var(--bg)}
    .nb-chip.on{background:var(--color-accent);color:#fff;border-color:var(--color-accent)}
    /* bottom-right, clear of Leaflet's zoom pair (bottom-left) and its
       attribution strip (the very bottom of the right edge) */
    /* The key is fixed to the map's own paper, in both themes: it names the
       pin colours, and OSM tiles (and therefore the pins) are always light. */
    .nb-legend{position:absolute;right:12px;bottom:22px;z-index:500;display:flex;gap:10px;
      background:#f3f2f2;border:1px solid #201e1d;padding:4px 8px;
      font:600 9px/1.4 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:#201e1d}
    .nb-legend span{display:inline-flex;align-items:center;gap:4px}
    .nb-dot{width:8px;height:8px;display:block}
    .nb-dot--you{background:#ec3013} .nb-dot--pro{background:#201e1d} .nb-dot--shop{background:#7d7979}
    .nb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:10px 0;border-bottom:1px solid var(--color-divider)}
    .nb-thumb{width:44px;height:44px}
    /* Leaflet's own chrome, brought into the system: zero radius, ink rules,
       and the zoom pair moved out from under the floating search box. */
    #nearbyMap .leaflet-top.leaflet-left{top:auto;bottom:4px}
    #nearbyMap .leaflet-bar,#nearbyMap .leaflet-bar a{border-radius:0}
    #nearbyMap .leaflet-bar a{color:var(--color-text);border-bottom-color:var(--color-divider)}
    #nearbyMap .leaflet-control-attribution{font-size:9px;border-radius:0}
    @media (min-width:768px){ .nb-map{margin:0} .nb-canvas{height:min(56vh,520px)} }
  </style>`;
}

async function mountNearMap() {
  const first = document.getElementById('nearbyMap');
  if (!first) { killNearMap(); return; }
  try { await gmap.ready(); }
  catch (e) {
    const el = document.getElementById('nearbyMap');
    if (el) mount(el, '<p class="micro muted" style="padding:14px">The map cannot load right now — ' +
      'the search box, the filters and the list below all still work.</p>');
    return;
  }
  const el = document.getElementById('nearbyMap');
  if (!el) { killNearMap(); return; }
  if (el !== nearMapEl || !nearMapH) {
    killNearMap();
    const c = geoOf(myPlace()) || HYD;
    nearMapH = gmap.mapInto(el, { center: [c.lat, c.lng], zoom: 14 });
    if (!nearMapH) return;
    nearMapEl = el;
  }
  paintNearMap();
}

function paintNearMap(fit = true) {
  if (!nearMapH) return;
  nearMapH.clear();
  const pts = [];
  const you = geoOf(myPlace());
  if (you) {
    nearMapH.pin(you.lat, you.lng, { color: gmap.PINS.accent, label: 'You are here' });
    nearMapH.circle(you.lat, you.lng, 700, { color: gmap.PINS.accent });
    pts.push([you.lat, you.lng]);
  }
  nearbyItems().slice(0, 40).forEach(it => {
    const g = geoOf(it.loc);
    if (!g) return;
    nearMapH.pin(g.lat, g.lng, {
      color: it.kind === 'pro' ? gmap.PINS.ink : gmap.PINS.neutral,
      glyph: (it.name || '?')[0], label: `${it.name} · ${it.cat.name} · ${it.km} km`,
    });
    pts.push([g.lat, g.lng]);
  });
  if (fit && pts.length) nearMapH.fit(pts, 40);
  nearMapH.invalidate();
}

/** Repaint the two live parts only — never the map, never the search field. */
function paintNearby() {
  const items = nearbyItems();
  const chips = document.getElementById('nearbyChips');
  if (chips) mount(chips, nearChipsHtml());
  const list = document.getElementById('nearbyList');
  if (list) mount(list, nearListHtml(items));
  const head = document.querySelector('.nb-head > div');
  if (head) head.textContent = `${items.length} near you`;
  paintNearMap(false);
}

delegate('input', '#nearbyQ', (e, el) => { nearQ = el.value; paintNearby(); });
delegate('click', '[data-near]', async (e, el) => {
  const k = el.dataset.near;
  if (k === 'geo') {
    const q = nearQ.trim();
    if (q.length < 3) { toast('Type at least three letters to find a place', 'warn'); return; }
    if (!nearMapH) { toast('The map is not loaded, so there is nowhere to move to', 'warn'); return; }
    toast('Looking for that place…');
    let hit = [];
    try { hit = await gmap.geocode(q, { limit: 1 }); }
    catch (err) { toast('Place search is unavailable right now', 'warn'); return; }
    if (!hit.length) { toast(`Nothing on the map is called “${q}”`, 'warn'); return; }
    nearMapH.fit([[hit[0].lat, hit[0].lng]]);
    toast(hit[0].label);
    return;
  }
  if (k === 'open') nearOpen = !nearOpen;
  else nearKind = nearKind === k ? 'all' : k;
  paintNearby();
});

/* ── the booking path, made visible ────────────────────────────
   NEED → SERVICE → DETAILS → MATCH → PRICE → CONFIRM. The customer never
   wonders how many more screens there are, because the whole path is on the
   first one and it is only ever one sheet deep. */
const BOOK_STEPS = ['Need', 'Service', 'Details', 'Match', 'Price', 'Confirm'];
function stepbar(cur) {
  return `<div class="stepbar" role="list" aria-label="Booking steps">${BOOK_STEPS.map((s, i) =>
    `<span class="stepbar__step ${i < cur ? 'done' : i === cur ? 'cur' : ''}" role="listitem" title="${esc(s)}"></span>`
  ).join('')}</div>
  <p class="micro muted" style="margin:-6px 0 10px">Step ${Math.min(cur + 1, BOOK_STEPS.length)} of ${BOOK_STEPS.length} · ${esc(BOOK_STEPS[Math.min(cur, BOOK_STEPS.length - 1)])}</p>`;
}

export function openCategory(catId, sub = null, pinnedId = null) {
  const c = get('category', catId);
  if (c.kind === 'retail') { ctx.go('shops', catId); return; }
  const m = flow.findMatch(catId, { area: myPlace() });   // coordinates when we have them
  /* A control that NAMES a pro must book that pro. Arriving from someone's own
     page pins them as the hero; the matcher's pick is the fallback, and an
     unbookable pin (suspended, gone) falls back rather than dead-ends. */
  const pinned = pinnedId ? getState().partners.find(x => x.id === pinnedId && !x.suspended) : null;
  const hero = pinned || m.hero;
  // The chosen sub-service is threaded all the way into the booking.
  const subs = (c.subs || []).map(s =>
    `<button class="chip${s === sub ? ' on' : ''}" data-act="book.sub" data-id="${catId}"
       data-sub="${esc(s)}"${pinned ? ` data-pid="${esc(pinned.id)}"` : ''} aria-pressed="${s === sub}">${esc(s)}</button>`).join('');

  sheet(c.name, `
    ${stepbar(hero ? (sub ? 5 : 2) : 2)}
    <div class="capsules" style="margin:0 0 14px">
      <span class="capsule"><span class="capsule__k">Priced</span>
        <span class="capsule__v" style="font-size:16px">${esc(c.unit)}</span></span>
      <span class="capsule"><span class="capsule__k">Available</span>
        <span class="capsule__v" style="font-size:16px">${esc(supplyLine(c))}</span></span>
      ${c.warrantyDays ? `<span class="capsule capsule--ok"><span class="capsule__k">Warranty</span>
        <span class="capsule__v" style="font-size:16px">${c.warrantyDays} days</span></span>` : ''}
    </div>
    <p class="tiny muted" style="margin-bottom:12px">${esc(c.blurb || '')}</p>
    <p class="m-cap">What exactly do you need?</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px;margin-bottom:18px">${subs}</div>
    ${hero ? heroCard(catId, hero, sub) : `
      <div class="empty empty--smart"><h3 style="font-size:17px">No pro free right now</h3>
      <p style="margin-top:6px">Nobody in ${esc(myArea())} is online for this. Try another area or check back shortly.</p>
      <button class="btn btn--secondary" style="margin-top:12px" data-act="area.pick">Change area</button></div>`}
    ${m.alternates.length ? `
      <button class="btn btn--ghost btn--block" style="margin-top:10px"
        data-act="book.others" data-id="${catId}" data-sub="${esc(sub || '')}">See ${m.alternates.length} other pros</button>` : ''}
    ${SYS_CSS}
  `);
}

/* Why THIS pro — read straight off the fields the matcher already produced.
   No new scoring and no new vocabulary: distance, the trust band, and the
   pro's own ask measured against the category's typical price. */
function whyRow(p, cat) {
  const base = (cat && cat.base) || 0;
  const near = p.km <= 3;
  const trusted = (p.trust | 0) >= 70;
  const fair = base ? p.ask <= base : false;
  const cell = (k, v, d) => `<div style="padding:8px 0"><div class="m-cap" style="margin:0 0 2px">${esc(k)}</div>
    <div style="font:800 16px/1.1 var(--font-heading)">${v}</div><div class="micro" style="opacity:.7">${esc(d)}</div></div>`;
  return `<div class="grid3" style="gap:0;border-top:1px solid color-mix(in srgb,currentColor 30%,transparent);border-bottom:1px solid color-mix(in srgb,currentColor 30%,transparent);margin:12px 0">
    ${cell(near ? 'Nearest' : 'Distance', `${p.km} km`, `arrives ~${p.eta} min`)}
    ${cell(trusted ? 'Most trusted' : 'Trust', `${p.trust}`, (p.band && p.band.label) || tier(p.tier).label)}
    ${cell(fair ? 'Fair price' : 'Above typical', M.fmt(p.ask), `typical ${M.fmt(base)}`)}
  </div>`;
}

/* the refund rule, read from the engine — never a typed promise */
function cancelLine() {
  const before = CANCEL_RULES.BEFORE_ACCEPT, after = CANCEL_RULES.AFTER_ACCEPT_2H, route = CANCEL_RULES.EN_ROUTE;
  if (before && after && before.refundPct >= 1 && after.refundPct >= 1)
    return `Full refund if you cancel before the pro sets out${route ? `; ${Math.round(route.refundPct * 100)}% once they are on the way` : ''}.`;
  return 'See Refunds &amp; cancellation for what comes back if you cancel.';
}

/* The Locked-Match card — identity proof and price finality fused into one
   indivisible unit, and the bill the customer is about to pay, line by line.
   This is the single most important trust element in the product. */
export function heroCard(catId, p, sub = null) {
  const pv = flow.previewBooking(catId, p);
  const t = tier(p.tier);
  const q = pv.quote;
  const pct = Math.round((q.uplift / Math.max(1, q.deal)) * 100);
  const w = flow.customerWallet();
  const fromWallet = me() ? Math.min(w.balance, q.customerPays) : 0;
  const viaGateway = q.customerPays - fromWallet;
  const kv = (k, v, cls = '') => `<div class="m-kv ${cls}"><span>${k}</span><span class="num">${v}</span></div>`;
  return `
  <div class="bestmatch">
    <div class="row" style="align-items:flex-start">
      <span class="avatar avatar--lg">${esc(p.name[0])}</span>
      <div class="grow" style="min-width:0">
        <div class="between">
          <button class="btn btn--ghost btn--sm" style="padding:0;min-height:44px;height:auto;font-size:16px;color:inherit"
            data-act="pro.open" data-id="${p.id}">${esc(p.name)} ›</button>
          <span class="tag tag-accent">Best match</span>
        </div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          ${t.badge ? `<span class="tag">${esc(t.badge)}</span>` : ''}
          <span class="tag">${p.online !== false ? 'Free now' : 'Offline'}</span>
          <span class="tag">${p.completed} jobs done</span>
        </div>
        <p class="tiny" style="margin-top:7px;opacity:.8">
          ${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${esc(p.area || myArea())}
        </p>
      </div>
    </div>

    ${whyRow(p, pv.cat)}

    <p class="m-cap" style="opacity:.8">The bill</p>
    ${kv(`${esc(p.name.split(' ')[0])}'s price · ${esc(pv.cat.name)}${sub ? ` · ${esc(sub)}` : ''}`, M.fmt(q.deal))}
    ${kv(`SAAHAA charge · ${pct}% on top, incl. GST`, M.fmt(q.uplift))}
    ${kv('You pay', M.fmt(q.customerPays), 'm-kv--total')}
    <p class="tiny" style="margin-top:8px;opacity:.85;line-height:1.5">${esc(p.name)} receives the full ${M.fmt(q.deal)}. SAAHAA's charge is on top and paid by you.
      The whole ${M.fmt(q.customerPays)} is paid to SAAHAA now and held until you confirm the work — nothing goes to anyone directly.</p>

    <p class="m-cap" style="margin-top:14px;opacity:.8">How you pay</p>
    ${me() ? `${kv('From your SAAHAA wallet', M.fmt(fromWallet))}${kv(`Via ${esc(gateway.label().split(' — ')[0])}`, M.fmt(viaGateway))}`
           : '<p class="tiny" style="opacity:.85">Sign in to pay — wallet first, the rest through UPI.</p>'}

    ${flags.isOn('SAVINGS_STRIP') ? `
    <div style="margin-top:12px;border-top:1px solid color-mix(in srgb,currentColor 30%,transparent);padding-top:8px">
      ${kv('A typical app would charge', M.fmt(pv.compare.typicalApp))}
      ${kv('You save', M.fmt(pv.compare.saved))}
      <p class="micro" style="opacity:.7;margin-top:4px">* ${esc(pv.compare.assumption)}. ${esc(p.name)} keeps
        <b>${M.fmt(pv.compare.workerGets)}</b> — ${M.fmt(pv.compare.workerUpside)} more than an app would pay.</p>
    </div>` : ''}

    <details class="expand" style="margin:10px 0 14px">
      <summary class="tiny" style="cursor:pointer;font-weight:700">What's included ▾</summary>
      <p class="tiny" style="margin-top:8px;opacity:.85">
        ${esc(pv.cat.name)}${sub ? ` · ${esc(sub)}` : ''} · ${esc(pv.cat.unit)} ·
        about ${pv.cat.workMins} min on site. Platform fee ${M.fmt(q.platformFee)} + GST ${M.fmt(q.gst)}
        is the ${M.fmt(q.uplift)} above. The price cannot change without your approval.
      </p>
    </details>

    <button class="btn btn--primary btn--lg btn--block" style="justify-content:flex-start" data-act="book.confirm"
            data-id="${catId}" data-pid="${p.id}" data-sub="${esc(sub || '')}">
      Confirm booking · ${M.fmt(q.customerPays)}
    </button>
    <p class="micro" style="margin-top:8px;opacity:.75">${cancelLine()}</p>

    ${ask.entryRow(catId, p, q.deal)}

    <button class="btn btn--ghost btn--block" style="margin-top:6px;color:inherit"
            data-act="book.others" data-id="${catId}" data-sub="${esc(sub || '')}">Someone else</button>
  </div>`;
}

export function showAlternates(catId, sub = null) {
  const m = flow.findMatch(catId, { area: myPlace() });   // coordinates when we have them
  const list = [m.hero, ...m.alternates].filter(Boolean);
  const cat = get('category', catId);
  const base = (cat && cat.base) || 0;
  sheet('Choose your pro', `${stepbar(3)}
    <p class="tiny muted" style="margin:0 0 6px">
      Ranked on trust, distance and a fair price — never on price alone.</p>
    ${list.map((p, i) => {
      const pv = flow.previewBooking(catId, p);
      return `<button class="m-row" data-act="book.confirm" data-id="${catId}" data-pid="${p.id}" data-sub="${esc(sub || '')}">
        <span class="avatar avatar--md">${esc(p.name[0])}</span>
        <div class="grow" style="min-width:0">
          <div class="m-row__t">${esc(p.name)}</div>
          <div class="m-row__m">${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${p.km} km · ~${p.eta} min · ${esc(tier(p.tier).label)}</div>
          <div class="m-row__tags">
            ${i === 0 ? '<span class="tag tag-accent">Best match</span>' : ''}
            <span class="tag tag-neutral">Trust ${p.trust}</span>
            <span class="tag ${base && p.ask <= base ? 'tag-neutral' : ''}">Their rate ${M.fmt(p.ask)}</span>
          </div>
        </div>
        <div class="m-row__r"><b class="num" style="font-size:17px">${M.fmt(pv.quote.customerPays)}</b>
          <p class="micro muted">you pay</p></div>
      </button>`;
    }).join('') || '<p class="muted">No pros online.</p>'}${SYS_CSS}`);
}

export async function confirmBooking(catId, partnerId, sub) {
  if (isGuest()) { toast('Sign in to book'); ctx.go('auth'); return; }
  const p = getState().partners.find(x => x.id === partnerId);
  if (!p) return;
  const o = await flow.bookService({ catId, partner: p, sub });
  closeSheet();
  ctx.go('order', o.id);
  toast('Booked. Your pro is on the way.');
}
