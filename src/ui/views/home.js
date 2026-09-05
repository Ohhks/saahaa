/* SAAHAA · ui/views/home.js — the customer home screen and the 3-tap booking.

   OPEN CIRCLE · LIVING GLASS. The engine is untouched: same registry, same
   matcher, same quote, same actions. What changed is the surface — home is a
   command screen (who you are, where you are, what is live, what you need),
   and booking is a visible six-step path that lands on one dominant match card
   carrying its own reasons.

   Search is the front door. One query reaches services, sub-services, shops,
   products and the customer's own orders, because a neighbourhood is not
   divided into tabs inside anybody's head. */

import { esc, sheet, closeSheet, toast, ratingStars } from '../dom.js';
import { ctx, getState, me, myArea, isGuest, myOrders } from '../../core/ctx.js';
import { live, get } from '../../core/registry.js';
import { GROUPS } from '../../domain/catalog.services.js';
import { mark, pillarRow } from '../logo.js';
import { icon, medallion, hasIcon } from '../icons.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { tier } from '../../domain/trust.js';
import * as flags from '../../core/flags.js';
import { trackerFor, trackerIndex, stage, isTerminal } from '../../domain/orders.js';
import * as ask from './ask.js';

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
   "from Rs.X" was a floor almost nobody actually pays, so the first real quote
   felt like bait-and-switch — and it contradicted our own promise that the pro
   sets the price. Supply proof is true, self-updating and more persuasive: it
   answers "can I actually get this right now?". */
function supplyLine(c) {
  const st = getState();
  if (c.kind === 'retail') return `${st.shops.filter(x => x.catId === c.id && x.isOpen).length} open now`;
  const pool = st.partners.filter(p => p.cat === c.id && !p.suspended);
  const online = pool.filter(p => p.online !== false).length;
  return online ? `${online} nearby` : pool.length ? `${pool.length} nearby` : 'New here — be first';
}

/* every tile carries its own contextual accent, taken from the category entry
   itself — so a new category registered from a new file styles itself */
function tileHtml(c, wide = false) {
  return `<button class="tile${wide ? ' tile--wide' : ''}" data-act="cat.open" data-id="${c.id}"
      style="--tile-accent:${esc(c.accent || '#C99A5B')}" aria-label="${esc(c.name)}">
    ${hasIcon(c.id) ? medallion(c.id) : `<span class="med" aria-hidden="true">${c.ico}</span>`}
    <span class="lbl">${esc(c.name)}</span>
    <span class="from">${esc(supplyLine(c))}</span>
  </button>`;
}

/* a suggestion chip is a real destination, never a decorative word */
function smartChip(label, catId, ico) {
  return `<button class="chip chip--smart" data-act="cat.open" data-id="${catId}">
    <span class="chip__ic" aria-hidden="true">${ico || ''}</span>${esc(label)}</button>`;
}

/* ── the live order: the loudest thing on the screen ────────── */
function liveOrders() {
  // the machine knows which stages are terminal; a hand-kept list missed PARTIAL and REFUNDED
  return myOrders().filter(o => !isTerminal(o.stage) &&
    !['SETTLED', 'R_SETTLED', 'RATED', 'PARTIAL', 'REFUNDED', 'R_REFUNDED'].includes(o.stage));
}

function activeOrderStrip() {
  const list = liveOrders();
  if (!list.length) return '';
  const o = list[0];
  const track = trackerFor(o.kind);
  const idx = trackerIndex(o);
  const st = stage(o.stage);
  return `<button class="cmd glass glass--deep rise" data-act="order.open" data-id="${o.id}"
      style="width:100%;text-align:left;margin-top:var(--sp-6)">
    <div class="between">
      <div class="grow">
        <div class="row" style="gap:8px;align-items:center">
          <span class="pill pill--live">Live now</span>
          <span class="meta">${esc(o.kind === 'service' ? 'Service' : 'Delivery')}</span>
        </div>
        <b class="cmd__title">${esc(st.label)}</b>
        <p class="cmd__sub">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}${
          o.eta ? ` · arriving in ~${o.eta} min` : ''}</p>
      </div>
      <span class="btn btn--secondary btn--sm cmd__action">Track</span>
    </div>
    <div class="mini-track" aria-hidden="true">${
      track.map((_, i) => `<i class="${i < idx ? 'on' : i === idx ? 'on cur' : ''}"></i>`).join('')}</div>
    <div class="capsules" style="margin-top:10px">
      <span class="capsule capsule--info"><span class="capsule__k">Step</span>
        <span class="capsule__v">${idx + 1} of ${track.length}</span></span>
      <span class="capsule capsule--gold"><span class="capsule__k">Total</span>
        <span class="capsule__v num">${M.fmt(o.customerPays)}</span></span>
      ${list.length > 1 ? `<span class="capsule capsule--soft"><span class="capsule__k">Also live</span>
        <span class="capsule__v">${list.length - 1} more</span></span>` : ''}
    </div>
  </button>`;
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
    <div class="em-ico">${mark(84, { detail: true })}</div>
    <h3>Nothing matched &ldquo;${esc(q)}&rdquo;</h3>
    <p>These are live in ${esc(myArea())} right now.</p>
    <div class="chiprow" style="justify-content:center;flex-wrap:wrap;margin-top:14px">
      ${services().slice(0, 4).map(c => smartChip(c.name, c.id, c.ico)).join('')}
    </div></div>`;

  const st = getState();
  const sec = (title, count, body) => `<div class="sec">
    <div class="hd"><h2 class="h-sec">${esc(title)}</h2><span class="meta">${count}</span></div>${body}</div>`;

  return `
  ${r.orderHits.length ? sec('Your orders', r.orderHits.length,
    r.orderHits.map(o => {
      const stg = stage(o.stage);
      return `<button class="cmd" data-act="order.open" data-id="${esc(o.id)}"
          style="width:100%;text-align:left;margin-bottom:8px">
        <div class="between"><div class="grow">
          <b class="cmd__title">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}</b>
          <p class="cmd__sub">${esc(get('category', o.catId).name)} · ${esc(stg.label)}</p></div>
          <b class="num">${M.fmt(o.customerPays)}</b></div></button>`;
    }).join('')) : ''}

  ${r.catHits.length ? sec('Services & shops', r.catHits.length,
    `<div class="grid3">${r.catHits.map(c => tileHtml(c)).join('')}</div>`) : ''}

  ${r.subHits.length ? sec('Exactly what you need', r.subHits.length,
    `<div class="chiprow" style="flex-wrap:wrap;gap:8px">${r.subHits.map(({ c, s }) =>
      `<button class="chip chip--smart" data-act="book.sub" data-id="${c.id}" data-sub="${esc(s)}">
        <span class="chip__ic" aria-hidden="true">${c.ico}</span>${esc(s)}</button>`).join('')}</div>`) : ''}

  ${r.prodHits.length ? sec('On shop shelves', r.prodHits.length,
    `<div class="grid2">${r.prodHits.map(p => {
      const sh = st.shops.find(x => x.id === p.shopId);
      return `<button class="cmd" data-act="shop.open" data-id="${esc(p.shopId)}" style="text-align:left">
        <div class="between"><div class="grow">
          <b class="cmd__title">${esc(p.name)}</b>
          <p class="cmd__sub">${esc(sh ? sh.name : 'Shop')} · ${esc(p.unit)}</p></div>
          <b class="num">${M.fmt(p.price)}</b></div></button>`;
    }).join('')}</div>`) : ''}

  ${r.shopHits.length ? sec('Shops near you', r.shopHits.length,
    r.shopHits.map(s => `<button class="cmd" data-act="shop.open" data-id="${esc(s.id)}"
        style="width:100%;text-align:left;margin-bottom:8px">
      <div class="between"><div class="grow">
        <b class="cmd__title">${esc(s.name)}</b>
        <p class="cmd__sub">${esc(get('category', s.catId).name)} ·
          ${ratingStars(s.ratingAvg)} ${s.ratingAvg}</p></div>
      <span class="pill ${s.isOpen ? 'pill--ok' : 'pill--bad'}">${s.isOpen ? 'Open' : 'Closed'}</span>
      </div></button>`).join('')) : ''}`;
}

/* ── the screen ────────────────────────────────────────────── */
export function render() {
  const s = me();
  const q = search.trim();
  const cart = flow.getCart();
  const cartCount = cart ? cart.lines.reduce((n, l) => n + l.qty, 0) : 0;
  const liveCount = liveOrders().length;
  const shopsGroup = GROUPS.find(g => g.id === 'shops');

  /* suggestions when the box is empty: the categories with real supply right
     now, ordered by it — not a hand-written list that can go stale */
  const suggest = services()
    .map(c => ({ c, n: getState().partners.filter(p => p.cat === c.id && p.online !== false && !p.suspended).length }))
    .sort((a, b) => b.n - a.n).slice(0, 5).map(x => x.c);
  const recentChips = recent.map(t => ({ t, c: bestCat(t) })).filter(x => x.c);

  return `
  <header class="hdr hdr--home on-plum glass glass--deep" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      ${mark(30, { glow: false })}
      <button class="loc tap grow" data-act="area.pick">
        <small>Deliver &amp; serve at</small>
        <b>${esc(myArea())} ▾</b>
      </button>
      <button class="btn btn--ghost tap" data-act="nav.orders" aria-label="Notifications and live orders">
        <span style="position:relative;display:grid;place-items:center">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            style="display:block"><path d="M18 8a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7M13.7 20a2 2 0 0 1-3.4 0"/></svg>
          ${liveCount ? `<span class="fab__count" style="position:absolute;top:-5px;right:-6px">${liveCount}</span>` : ''}
        </span>
      </button>
      <button class="btn btn--ghost tap" data-act="theme.toggle" aria-label="Switch theme">◐</button>
      ${s ? `<button class="btn btn--ghost tap" data-act="nav.account" aria-label="Account">
              <span class="avatar avatar--sm">${esc(s.name[0])}</span></button>`
           : `<button class="btn btn--secondary btn--sm" data-act="auth.open">Sign in</button>`}
    </div>

    <div class="wrap hero">
      <p class="eyebrow">${esc(myArea())} · one circle</p>
      <h1 class="hero__title display">Everything your neighbourhood needs.</h1>
      <div class="search hero__search">
        ${icon('search', { size: 20 })}
        <input id="q" type="search" placeholder="What do you need today?"
               value="${esc(search)}" data-role="search"
               aria-label="Search services, shops, products and your orders">
        ${q ? '<button class="btn btn--ghost btn--sm tap" data-act="search.clear" aria-label="Clear search">✕</button>' : ''}
      </div>
      <p class="meta" style="margin:8px 4px 0">
        One search finds people who come to you, shops that deliver to you, and your own orders.</p>
      ${!q ? `<div class="chiprow" style="margin-top:12px;flex-wrap:wrap">
        ${recentChips.length
          ? recentChips.map(x => smartChip(x.t, x.c.id, '↻')).join('')
          : suggest.map(c => smartChip(c.name, c.id, c.ico)).join('')}
      </div>` : ''}
    </div>
  </header>

  <main class="wrap" id="mainScroll">
    ${q ? `
      <div class="sec">
        <div class="hd"><h2 class="h-display">Results for &ldquo;${esc(q)}&rdquo;</h2></div>
      </div>
      ${searchResults(q)}` : `

      <div class="home-lay">
        <div class="home-lay__main">
          ${activeOrderStrip()}

          <div class="sec">
            <div class="chiprow" style="flex-wrap:wrap">
              ${s ? `<button class="chip chip--smart" data-act="nav.orders">
                       <span class="chip__ic" aria-hidden="true">↻</span>Book again</button>` : ''}
              <button class="chip chip--smart" data-act="quick.emergency">
                <span class="chip__ic" aria-hidden="true">🚨</span>Emergency</button>
              <button class="chip chip--smart" data-act="quick.nearby">
                <span class="chip__ic" aria-hidden="true">📍</span>Open now</button>
              ${cartCount ? `<button class="chip chip--smart on" data-act="nav.cart">
                <span class="chip__ic" aria-hidden="true">🧺</span>Cart · ${cartCount}</button>` : ''}
            </div>
          </div>

          <div class="sec rise rise-2">
            <div class="hd"><h2 class="h-sec">Most booked near you</h2>
              <button class="more" data-act="scroll.all">See all ${cats().length}</button></div>
            <div class="rail">${services().slice(0, 8).map(c => tileHtml(c)).join('')}</div>
          </div>
        </div>

        <aside class="home-lay__side">
          <div class="glass glass--gold sec rise rise-3" style="margin-top:var(--sp-6);padding:16px">
            <p class="eyebrow">Why this circle holds</p>
            ${pillarRow({ compact: true })}
            <div class="trustbar on-plum" style="margin-top:14px">
              <span>🛡 Every pro ID-checked</span>
              <span>🔒 Price locked before booking</span>
              <span>💰 Pros keep 100%</span>
            </div>
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
          <div class="hd"><h2 class="h-sec">${g.ico} ${esc(g.label)}</h2>
            <span class="meta">${list.length} live</span></div>
          <div class="grid3">${list.map(c => tileHtml(c)).join('')}</div></div>`;
      }).join('')}

      ${flags.isOn('RETAIL') ? `
      <div class="sec rise rise-5" id="shopsSec">
        <div class="hd"><h2 class="h-sec">${shopsGroup ? shopsGroup.ico : '🛒'} ${
          esc(shopsGroup ? shopsGroup.label : 'Shops Near You')}</h2>
          <button class="more" data-act="nav.shops">Browse all</button></div>
        <p class="meta" style="margin:-8px 0 12px">
          Kirana, veg, meat, dairy, chemist, water &amp; gas — real shops listing their own products.</p>
        <div class="grid3">${retails().map(c => tileHtml(c)).join('')}</div>
      </div>` : ''}

      <div class="sec cmd glass glass--gold">
        <p class="eyebrow">The other side of the circle</p>
        <b class="cmd__title">Run a shop or work a trade?</b>
        <p class="cmd__sub">List your services or your products. You keep 100% of a service quote;
          shops pay 3–5%, not 25%.</p>
        <button class="btn btn--primary btn--block cmd__action" style="margin-top:14px" data-act="partner.join">
          Become a SAAHAA partner
        </button>
      </div>
    `}

    <div class="credo">
      <div class="cmark">${mark(180, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:10px">
        SAAHAA · Hyderabad · prototype build — simulated escrow, no real funds
      </p>
    </div>
  </main>
  <style>
    .home-lay{display:block}
    @media (min-width:1024px){
      .home-lay{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);
        gap:var(--sp-6,18px);align-items:start}
      .home-lay__main{min-width:0}
      .home-lay__side{position:sticky;top:12px}
    }
  </style>`;
}

/* ── the booking path, made visible ────────────────────────────
   NEED → SERVICE → DETAILS → MATCH → PRICE → CONFIRM. The customer never
   wonders how many more screens there are, because the whole path is on the
   first one and it is only ever one sheet deep. */
const BOOK_STEPS = ['Need', 'Service', 'Details', 'Match', 'Price', 'Confirm'];
function stepbar(cur) {
  return `<div class="stepbar" role="list" aria-label="Booking steps">${BOOK_STEPS.map((s, i) =>
    `<span class="stepbar__step ${i < cur ? 'done' : i === cur ? 'cur' : ''}" role="listitem">${esc(s)}</span>`
  ).join('')}</div>`;
}

export function openCategory(catId, sub = null) {
  const c = get('category', catId);
  if (c.kind === 'retail') { ctx.go('shops', catId); return; }
  const m = flow.findMatch(catId);
  // The chosen sub-service used to be dropped on the floor: openCategory took
  // one argument, so the sheet re-rendered byte-identical, mount() skipped the
  // write, and tapping a chip did nothing visible. It now selects, and it is
  // threaded all the way into the booking.
  const subs = (c.subs || []).map(s =>
    `<button class="chip${s === sub ? ' on' : ''}" data-act="book.sub" data-id="${catId}"
       data-sub="${esc(s)}" aria-pressed="${s === sub}">${esc(s)}</button>`).join('');

  sheet(c.name, `
    ${stepbar(m.hero ? (sub ? 5 : 2) : 2)}
    <div class="capsules" style="margin:14px 0">
      <span class="capsule capsule--soft"><span class="capsule__k">Priced</span>
        <span class="capsule__v">${esc(c.unit)}</span></span>
      <span class="capsule capsule--info"><span class="capsule__k">Available</span>
        <span class="capsule__v">${esc(supplyLine(c))}</span></span>
      ${c.warrantyDays ? `<span class="capsule capsule--ok"><span class="capsule__k">Warranty</span>
        <span class="capsule__v">${c.warrantyDays} days</span></span>` : ''}
    </div>
    <p class="meta" style="margin-bottom:12px">${esc(c.blurb || '')}</p>
    <p class="eyebrow" style="margin-bottom:8px">What exactly do you need?</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px;margin-bottom:18px">${subs}</div>
    ${m.hero ? heroCard(catId, m.hero, sub) : `
      <div class="empty empty--smart"><h3>No pro free right now</h3>
      <p>Nobody in ${esc(myArea())} is online for this. Try another area or check back shortly.</p>
      <button class="btn btn--secondary" style="margin-top:12px" data-act="area.pick">Change area</button></div>`}
    ${m.alternates.length ? `
      <button class="btn btn--ghost btn--block" style="margin-top:10px"
        data-act="book.others" data-id="${catId}" data-sub="${esc(sub || '')}">See ${m.alternates.length} other pros</button>` : ''}
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
  return `<div class="bestmatch__why capsules">
    <span class="capsule ${near ? 'capsule--ok' : 'capsule--info'}">
      <span class="capsule__k">${near ? 'Nearest' : 'Distance'}</span>
      <span class="capsule__v">${p.km} km</span>
      <span class="capsule__d">arrives ~${p.eta} min</span></span>
    <span class="capsule ${trusted ? 'capsule--gold' : 'capsule--soft'}">
      <span class="capsule__k">${trusted ? 'Most trusted' : 'Trust'}</span>
      <span class="capsule__v">${p.trust}</span>
      <span class="capsule__d">${esc((p.band && p.band.label) || tier(p.tier).label)}</span></span>
    <span class="capsule ${fair ? 'capsule--ok' : 'capsule--warn'}">
      <span class="capsule__k">${fair ? 'Fair price' : 'Above typical'}</span>
      <span class="capsule__v num">${M.fmt(p.ask)}</span>
      <span class="capsule__d">typical ${M.fmt(base)}</span></span>
  </div>`;
}

/* The Locked-Match card — identity proof and price finality fused into one
   indivisible unit. This is the single most important trust element in the
   product (V5-B7, confidence 5). */
export function heroCard(catId, p, sub = null) {
  const pv = flow.previewBooking(catId, p);
  const t = tier(p.tier);
  return `
  <div class="bestmatch glass glass--gold">
    <div class="row" style="align-items:flex-start">
      <span class="avatar avatar--lg">${esc(p.name[0])}</span>
      <div class="grow">
        <div class="between">
          <button class="btn btn--ghost btn--sm" style="padding:0;height:auto;font-size:17px;font-weight:700"
            data-act="pro.open" data-id="${p.id}">${esc(p.name)} ›</button>
          <span class="pill pill--gold">Best match</span>
        </div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          ${t.badge ? `<span class="pill pill--ok">✓ ${esc(t.badge)}</span>` : ''}
          ${p.online !== false ? '<span class="pill pill--live">Free now</span>'
                               : '<span class="pill pill--soft">Offline</span>'}
          <span class="pill pill--soft">${p.completed} jobs done</span>
        </div>
        <p class="meta" style="margin-top:7px">
          ${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${esc(p.area || myArea())}
        </p>
      </div>
    </div>

    ${whyRow(p, pv.cat)}

    <div class="rule" style="margin:14px 0"></div>

    <div class="between bestmatch__price">
      <div><span class="eyebrow">You pay</span>
        <div class="num-xl num">${M.fmt(pv.quote.customerPays)}</div></div>
      <div style="text-align:right">
        <span class="pill pill--ok">Price locked</span>
        <p class="meta" style="margin-top:5px">Pay after the work</p>
      </div>
    </div>

    ${flags.isOn('SAVINGS_STRIP') ? `
    <div class="saves">
      <div class="old"><div class="k">Typical app</div><div class="v num">${M.fmt(pv.compare.typicalApp)}</div></div>
      <div><div class="k">You pay</div><div class="v num">${M.fmt(pv.compare.youPay)}</div></div>
      <div class="good"><div class="k">You save</div><div class="v num">${M.fmt(pv.compare.saved)}</div></div>
    </div>
    <p class="micro muted" style="margin:-4px 0 12px">
      * ${esc(pv.compare.assumption)}. ${esc(p.name)} keeps
      <b>${M.fmt(pv.compare.workerGets)}</b> — ${M.fmt(pv.compare.workerUpside)} more than an app would pay.
    </p>` : ''}

    <details class="expand" style="margin-bottom:14px">
      <summary class="tiny" style="cursor:pointer;color:var(--accent);font-weight:700">What's included ▾</summary>
      <p class="meta" style="margin-top:8px">
        ${esc(pv.cat.name)}${sub ? ` · ${esc(sub)}` : ''} · ${esc(pv.cat.unit)} ·
        about ${pv.cat.workMins} min on site.
        Platform fee ${M.fmt(pv.quote.platformFee)} + GST ${M.fmt(pv.quote.gst)} is already in the total.
        The price cannot change without your approval.
      </p>
    </details>

    <button class="btn btn--primary btn--lg btn--block sheen" data-act="book.confirm"
            data-id="${catId}" data-pid="${p.id}" data-sub="${esc(sub || '')}">
      Confirm booking · ${M.fmt(pv.quote.customerPays)}
    </button>

    ${ask.entryRow(catId, p, pv.quote.deal)}

    <button class="btn btn--ghost btn--block" style="margin-top:6px"
            data-act="book.others" data-id="${catId}" data-sub="${esc(sub || '')}">Someone else</button>
  </div>`;
}

export function avgOf(p) {
  const r = p.ratings || [];
  if (!r.length) return 4.5;
  return r.reduce((a, x) => a + x.stars, 0) / r.length;
}

export function showAlternates(catId, sub = null) {
  const m = flow.findMatch(catId);
  const list = [m.hero, ...m.alternates].filter(Boolean);
  const cat = get('category', catId);
  const base = (cat && cat.base) || 0;
  sheet('Choose your pro', `${stepbar(3)}
    <p class="meta" style="margin:14px 0">
      Ranked on trust, distance and a fair price — never on price alone.</p>
    ${list.map((p, i) => {
      const pv = flow.previewBooking(catId, p);
      return `<button class="cmd${i === 0 ? ' glass glass--gold' : ''}"
          style="width:100%;text-align:left;margin-bottom:10px"
          data-act="book.confirm" data-id="${catId}" data-pid="${p.id}" data-sub="${esc(sub || '')}">
        <div class="row" style="align-items:flex-start">
          <span class="avatar avatar--md">${esc(p.name[0])}</span>
          <div class="grow">
            <div class="between"><b class="cmd__title">${esc(p.name)}</b>
              ${i === 0 ? '<span class="pill pill--gold">Best match</span>' : ''}</div>
            <p class="cmd__sub">${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${p.km} km ·
              ~${p.eta} min · ${esc(tier(p.tier).label)}</p>
            <div class="capsules" style="margin-top:8px">
              <span class="capsule capsule--info"><span class="capsule__k">Trust</span>
                <span class="capsule__v">${p.trust}</span></span>
              <span class="capsule ${base && p.ask <= base ? 'capsule--ok' : 'capsule--soft'}">
                <span class="capsule__k">Their rate</span>
                <span class="capsule__v num">${M.fmt(p.ask)}</span></span>
            </div>
          </div>
          <div style="text-align:right"><b class="num" style="font-size:19px">${M.fmt(pv.quote.customerPays)}</b>
            <p class="meta">you pay</p></div>
        </div></button>`;
    }).join('') || '<p class="muted">No pros online.</p>'}`);
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
