/* SAAHAA · ui/views/home.js — the customer home screen and the 3-tap booking.
   Section order is the design panel's stack (V5-B5). */

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
import { trackerFor, trackerIndex, stage } from '../../domain/orders.js';

let search = '';
export const setSearch = v => { search = v; };

const cats = () => live('category');
const services = () => cats().filter(c => c.kind === 'service');
const retails  = () => cats().filter(c => c.kind === 'retail');

function matchCat(c, q) {
  const n = q.toLowerCase();
  return c.name.toLowerCase().includes(n) || (c.blurb || '').toLowerCase().includes(n) ||
         (c.subs || []).some(s => s.toLowerCase().includes(n)) ||
         (c.aisles || []).some(s => s.toLowerCase().includes(n));
}

function tileHtml(c) {
  /* "from Rs.X" was a floor almost nobody actually pays, so the first real
     quote felt like bait-and-switch — and it contradicted our own promise that
     the pro sets the price. Supply proof is true, self-updating and more
     persuasive: it answers "can I actually get this right now?". */
  const pool = getState().partners.filter(p => p.cat === c.id && !p.suspended);
  const online = pool.filter(p => p.online !== false).length;
  const sub = c.kind === 'retail'
    ? `${getState().shops.filter(x => x.catId === c.id && x.isOpen).length} open now`
    : online ? `${online} nearby`
    : pool.length ? `${pool.length} nearby`
    : 'New here — be first';
  return `<button class="tile" data-act="cat.open" data-id="${c.id}" aria-label="${esc(c.name)}">
    ${hasIcon(c.id) ? medallion(c.id) : `<span class="med" aria-hidden="true">${c.ico}</span>`}
    <span class="lbl">${esc(c.name)}</span>
    <span class="from">${esc(sub)}</span>
  </button>`;
}

function activeOrderStrip() {
  const live = myOrders().filter(o => !['CLOSED','CANCELLED','EXPIRED','R_CLOSED','R_CANCELLED','SETTLED','R_SETTLED','RATED']
    .includes(o.stage));
  if (!live.length) return '';
  const o = live[0];
  const track = trackerFor(o.kind);
  const idx = trackerIndex(o);
  const st = stage(o.stage);
  return `<div class="card on-plum card--tap" style="margin-top:var(--sp-6);border:0"
       data-act="order.open" data-id="${o.id}">
    <div class="between">
      <div class="grow">
        <div class="row" style="gap:8px">
          <span class="badge badge--gold">Live</span>
          <b style="font-size:15px">${esc(st.label)}</b>
        </div>
        <p class="tiny muted" style="margin-top:4px">
          ${esc(o.kind === 'service' ? o.partnerName : o.shopName)} · ${o.eta ? o.eta + ' min' : ''}
        </p>
      </div>
      <span class="btn btn--secondary btn--sm">Track</span>
    </div>
    <div class="mini-track">${track.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>
  </div>`;
}

export function render() {
  const s = me();
  const q = search.trim();
  const cart = flow.getCart();
  const cartCount = cart ? cart.lines.reduce((n, l) => n + l.qty, 0) : 0;

  const results = q ? cats().filter(c => matchCat(c, q)) : [];

  return `
  <header class="hdr on-plum" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      ${mark(30, { glow: false })}
      <button class="loc tap grow" data-act="area.pick">
        <small>Deliver &amp; serve at</small>
        <b>${esc(myArea())} ▾</b>
      </button>
      <button class="btn btn--ghost tap" data-act="theme.toggle" aria-label="Switch theme">◐</button>
      ${s ? `<button class="btn btn--ghost tap" data-act="nav.account" aria-label="Account">
              <span style="width:28px;height:28px;border-radius:50%;background:var(--accent-fill);color:var(--accent-on-fill);
              display:grid;place-items:center;font-weight:800;font-size:12px">${esc(s.name[0])}</span></button>`
           : `<button class="btn btn--secondary btn--sm" data-act="auth.open">Sign in</button>`}
    </div>
    <div class="wrap" style="margin-top:12px">
      <div class="search">
        ${icon('search', { size: 20 })}
        <input id="q" type="search" placeholder="Search: plumber, AC repair, tomatoes, milk"
               value="${esc(search)}" data-role="search" aria-label="Search services and shop products">
        ${q ? '<button class="btn btn--ghost btn--sm tap" data-act="search.clear">✕</button>' : ''}
      </div>
      <p class="micro muted" style="margin:7px 4px 0">
        One search finds people who come to you, and shops that deliver to you.</p>
    </div>
  </header>

  <main class="wrap" id="mainScroll">
    ${q ? `
      <div class="sec">
        <div class="hd"><h2>${results.length} result${results.length === 1 ? '' : 's'} for “${esc(q)}”</h2></div>
        ${results.length ? `<div class="grid3">${results.map(tileHtml).join('')}</div>`
          : `<div class="empty"><div class="em-ico">${mark(84, { detail: true })}</div>
               <h3>Nothing matched</h3><p>Try “plumber”, “atta”, “maid” or “cake”.</p></div>`}
      </div>` : `

      ${activeOrderStrip()}

      <div class="sec">
        <div class="chiprow">
          ${s ? `<button class="chip" data-act="nav.orders">↻ Book again</button>` : ''}
          <button class="chip" data-act="quick.emergency">🚨 Emergency</button>
          <button class="chip" data-act="quick.nearby">📍 Open now</button>
          ${cartCount ? `<button class="chip on" data-act="nav.cart">🧺 Cart · ${cartCount}</button>` : ''}
        </div>
      </div>

      <div class="sec">
        <div class="hd"><h2>What we stand for</h2></div>
        ${pillarRow({ compact: true })}
      </div>

      <div class="sec">
        <div class="hd"><h2>Most booked near you</h2>
          <button class="more" data-act="scroll.all">See all ${cats().length}</button></div>
        <div class="rail">${services().slice(0, 8).map(tileHtml).join('')}</div>
      </div>

      <div class="trustbar on-plum">
        <span>🛡 Every pro ID-checked</span>
        <span>🔒 Price locked before booking</span>
        <span>💰 Pros keep 100%</span>
      </div>

      ${GROUPS.filter(g => g.id !== 'shops').map(g => {
        const list = services().filter(c => c.group === g.id);
        if (!list.length) return '';
        return `<div class="sec"><div class="hd"><h2>${g.ico} ${esc(g.label)}</h2></div>
          <div class="grid3">${list.map(tileHtml).join('')}</div></div>`;
      }).join('')}

      ${flags.isOn('RETAIL') ? `
      <div class="sec" id="shopsSec">
        <div class="hd"><h2>🛒 Shops near you</h2>
          <button class="more" data-act="nav.shops">Browse all</button></div>
        <p class="tiny muted" style="margin:-8px 0 12px">
          Kirana, veg, meat, dairy, chemist, water &amp; gas — real shops listing their own products.</p>
        <div class="grid3">${retails().map(tileHtml).join('')}</div>
      </div>` : ''}

      <div class="sec card card--gold">
        <div class="between">
          <div class="grow">
            <b>Run a shop or work a trade?</b>
            <p class="tiny muted" style="margin-top:4px">
              List your services or your products. You keep 100% of a service quote;
              shops pay 3–5%, not 25%.</p>
          </div>
        </div>
        <button class="btn btn--primary btn--block" style="margin-top:14px" data-act="partner.join">
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
  </main>`;
}

/* ── category detail ───────────────────────────────────────── */
export function openCategory(catId) {
  const c = get('category', catId);
  if (c.kind === 'retail') { ctx.go('shops', catId); return; }
  const m = flow.findMatch(catId);
  const subs = (c.subs || []).map(s =>
    `<button class="chip" data-act="book.sub" data-id="${catId}" data-sub="${esc(s)}">${esc(s)}</button>`).join('');

  sheet(c.name, `
    <p class="tiny muted" style="margin-bottom:14px">${esc(c.blurb || '')} · priced ${esc(c.unit)}</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px;margin-bottom:18px">${subs}</div>
    ${m.hero ? heroCard(catId, m.hero) : `
      <div class="empty"><h3>No pro free right now</h3>
      <p>Nobody in ${esc(myArea())} is online for this. Try another area or check back shortly.</p></div>`}
    ${m.alternates.length ? `
      <button class="btn btn--ghost btn--block" style="margin-top:10px"
        data-act="book.others" data-id="${catId}">See ${m.alternates.length} other pros</button>` : ''}
  `);
}

/* The Locked-Match card — identity proof and price finality fused into one
   indivisible unit. This is the single most important trust element in the
   product (V5-B7, confidence 5). */
export function heroCard(catId, p) {
  const pv = flow.previewBooking(catId, p);
  const t = tier(p.tier);
  return `
  <div class="card" style="border-color:var(--accent-border)">
    <div class="row" style="align-items:flex-start">
      <span style="width:52px;height:52px;border-radius:50%;background:var(--accent-fill);
        color:var(--accent-on-fill);display:grid;place-items:center;font-weight:800;font-size:19px;flex:0 0 auto">
        ${esc(p.name[0])}</span>
      <div class="grow">
        <div class="between"><b style="font-size:16px">${esc(p.name)}</b>
          <span class="badge badge--gold">Accepted</span></div>
        <div class="row" style="gap:6px;margin-top:5px;flex-wrap:wrap">
          ${t.badge ? `<span class="badge badge--ok">✓ ${esc(t.badge)}</span>` : ''}
          <span class="badge badge--soft">${p.trust} trust</span>
        </div>
        <p class="tiny muted" style="margin-top:6px">
          ${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${p.completed} jobs ·
          ${p.km} km · arrives in ~${p.eta} min
        </p>
      </div>
    </div>

    <div class="rule" style="margin:14px 0"></div>

    <div class="between">
      <div><span class="tiny muted">You pay</span>
        <div style="font-size:26px;font-weight:800" class="num">${M.fmt(pv.quote.customerPays)}</div></div>
      <div style="text-align:right">
        <span class="badge badge--ok">Price locked</span>
        <p class="micro muted" style="margin-top:4px">Pay after the work</p>
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

    <details style="margin-bottom:14px">
      <summary class="tiny" style="cursor:pointer;color:var(--accent);font-weight:700">What's included ▾</summary>
      <p class="tiny muted" style="margin-top:8px">
        ${esc(pv.cat.name)} · ${esc(pv.cat.unit)} · about ${pv.cat.workMins} min on site.
        Platform fee ${M.fmt(pv.quote.platformFee)} + GST ${M.fmt(pv.quote.gst)} is already in the total.
        The price cannot change without your approval.
      </p>
    </details>

    <button class="btn btn--primary btn--lg btn--block" data-act="book.confirm"
            data-id="${catId}" data-pid="${p.id}">
      Confirm booking · ${M.fmt(pv.quote.customerPays)}
    </button>
    <button class="btn btn--ghost btn--block" style="margin-top:6px"
            data-act="book.others" data-id="${catId}">Someone else</button>
  </div>`;
}

export function avgOf(p) {
  const r = p.ratings || [];
  if (!r.length) return 4.5;
  return r.reduce((a, x) => a + x.stars, 0) / r.length;
}

export function showAlternates(catId) {
  const m = flow.findMatch(catId);
  const list = [m.hero, ...m.alternates].filter(Boolean);
  sheet('Choose your pro', list.map(p => {
    const pv = flow.previewBooking(catId, p);
    return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:10px"
        data-act="book.confirm" data-id="${catId}" data-pid="${p.id}">
      <div class="between">
        <div class="grow"><b>${esc(p.name)}</b>
          <p class="tiny muted">${ratingStars(avgOf(p))} ${avgOf(p).toFixed(1)} · ${p.km} km · ~${p.eta} min · ${tier(p.tier).label}</p>
        </div>
        <div style="text-align:right"><b class="num" style="font-size:18px">${M.fmt(pv.quote.customerPays)}</b>
          <p class="micro muted">total</p></div>
      </div></button>`;
  }).join('') || '<p class="muted">No pros online.</p>');
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
