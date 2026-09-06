/* SAAHAA · ui/views/partner.js — the two partner consoles.

   1. Pro console  — jobs inbox, earnings, online toggle, trust ladder.
   2. Shop console — orders inbox, CATALOG MANAGER with the starter-catalog
      picker, stock, earnings, open/closed master switch.

   The catalog manager is the answer to "make sure grocery store can list
   their products too": search a ready list, tap, overtype the price, set
   stock. No long form, no CSV, no photography. */

/* OPEN CIRCLE · LIVING GLASS — the engine below this line is untouched. What
   changed is the reading order. A console is not a feed: a working person
   opens it to answer three questions in this order — am I open for work,
   what wants me right now, and where is my money. So the shift control comes
   first, then the requests and jobs, then money, and only then the slower
   things (standing, ladder, page). Money is never one number: released, held
   and sent-to-bank are three different truths and get three different chips.
   Nothing here invents data — every figure is the same computation the old
   screen ran. */

import { esc, sheet, closeSheet, toast, ratingStars, timeAgo } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, dispatch, me, myPartner, myShop, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { stage } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { trustScore, tier, TIERS } from '../../domain/trust.js';
import { searchStarter, aislesOf } from '../../domain/starter-catalog.js';
import { header, emptyBlock } from './shops.js';
import { quoteRetail } from '../../domain/pricing.js';
import * as auction from '../../domain/auction.js';
import { progressCard } from './onboard.js';
import { readiness, blocker } from '../../domain/verification.js';
import * as W from '../../domain/wallet.js';

let pickerQuery = '', catalogQuery = '', shopTab = 'orders';
export const setPickerQuery = v => { pickerQuery = v; };
export const setCatalogQuery = v => { catalogQuery = v; };
export const setShopTab = v => { shopTab = v; };

/* ══════════════ the cockpit's small vocabulary ══════════════
   Classes come from the shared visual language (.capsules, .cmd, .pill,
   .glass, .seg, .state--*). Only the two-column recompose lives here,
   because a media query cannot be written as an inline style. */

const cockpitCSS = `<style>
  .cockpit{display:grid;gap:var(--sp-8)}
  .cockpit .sec{margin:0}
  .cockpit__col{min-width:0;display:grid;gap:var(--sp-8);align-content:start}
  .cockpit__lead{min-width:0}
  .prodgrid{display:grid;gap:10px}
  @media (min-width:1024px){
    .cockpit{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:start;column-gap:var(--sp-8)}
    .cockpit__lead{grid-column:1 / -1}
    .prodgrid{grid-template-columns:1fr 1fr}
  }
</style>`;

/** A capsule. k/v/d are trusted markup — callers escape their own values. */
const capsule = (k, v, d = '', tone = '') =>
  `<div class="capsule${tone ? ` capsule--${tone}` : ''}">
    <span class="capsule__k">${k}</span>
    <span class="capsule__v num">${v}</span>
    ${d ? `<span class="capsule__d">${d}</span>` : ''}
  </div>`;

/** A money state chip. Escrow, released and paid-to-bank never share a row. */
const money = (state, label) => `<span class="pill state--${state}">${esc(label)}</span>`;

const sectionHead = (eyebrow, title, right = '') =>
  `<div class="hd"><div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
    <h2 class="h-sec">${esc(title)}</h2></div>${right}</div>`;

/* ══════════════ PRO CONSOLE ══════════════ */
/* Jobs out for rates. He sees the public band, the COUNT of workers asked,
   and nothing else — no rival's price, no name, not even whether anyone has
   replied. That is what "sealed" means, and it is the only reason a worker
   can quote against the fair price instead of against a rival. */
function rateAsks(p) {
  const open = auction.openRequestsForPartner(p);
  if (!open.length) return '';
  return `<div class="sec">
    ${sectionHead('New requests', 'Asking for rates',
      `<span class="pill pill--live">${open.length} near you</span>`)}
    ${open.map((r, i) => {
      const c = get('category', r.catId);
      const left = Math.max(0, Math.round((r.closesAt - Date.now()) / 60000));
      return `<button class="cmd rise${i ? ` rise-${Math.min(5, i + 1)}` : ''}"
        style="width:100%;text-align:left;margin-bottom:10px"
        data-act="bid.open" data-id="${r.id}" data-pid="${p.id}">
        <div class="between" style="align-items:flex-start">
          <div class="grow">
            <span class="cmd__title">${esc(r.sub || c.name)}</span>
            <span class="cmd__sub">${esc(r.area)} · ${r.bidCount} workers asked · ${left} min left</span>
          </div>
          <div style="text-align:right;flex:0 0 auto">
            <b class="num" style="font-size:19px;display:block">${M.fmt(r.target)}</b>
            <span class="meta">fair price</span>
          </div>
        </div>
        <span class="cmd__action">Send my rate</span>
      </button>`;
    }).join('')}
    <p class="micro muted">Sending less than the fair price lowers your chance. It does not raise it.</p>
  </div>`;
}

/* The worker's wallet: four states, never blended. AVAILABLE is theirs to
   take; LOCKED is committed to a job in progress and returns in full when it
   is finished; PENDING is the 7-day holdback; RELEASED is everything ever
   paid. The stake is what makes a check-in a commitment. */
function walletCard(p) {
  const w = W.walletOf(getState().ledger, p.id, p);
  const live = getState().orders.filter(o => o.partnerId === p.id && o.stake && !o.stake.returned && !o.stake.forfeited);
  return `<div class="sec"><div class="hd"><div><span class="eyebrow">Wallet</span><h2 class="h-sec">Your money</h2></div>
      <span class="pill pill--soft">min stake ${M.fmt(W.MIN_STAKE)}</span></div>
    <div class="capsules">
      <div class="capsule capsule--ok"><span class="capsule__k">Available</span><span class="capsule__v num">${M.fmt(w.available)}</span><span class="state state--available">yours to withdraw</span></div>
      <div class="capsule capsule--info"><span class="capsule__k">Locked</span><span class="capsule__v num">${M.fmt(w.locked)}</span><span class="state state--held">${live.length ? `${live.length} job${live.length > 1 ? 's' : ''} in progress` : 'returns when work is done'}</span></div>
      <div class="capsule capsule--warn"><span class="capsule__k">Pending</span><span class="capsule__v num">${M.fmt(w.pending)}</span><span class="state state--pending">7-day holdback</span></div>
      <div class="capsule capsule--gold"><span class="capsule__k">Released</span><span class="capsule__v num">${M.fmt(w.released)}</span><span class="state state--released">lifetime</span></div>
    </div>
    ${w.debt ? `<p class="tiny" style="margin-top:8px;color:var(--warn)">${M.fmt(w.debt)} owed from a job you left — recovered from your next payout.</p>` : ''}
    <p class="micro muted" style="margin-top:8px">When a job starts, ${M.fmt(W.MIN_STAKE)} (or 5% of the job, up to ${M.fmt(W.MAX_STAKE)}) locks from Available. Finish the job and every rupee of it comes back with your full payout. Walk out and it goes to the customer.</p>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn--secondary btn--sm grow" data-act="wallet.topup" data-id="${p.id}">Add money</button>
      <button class="btn btn--ghost btn--sm grow" data-act="wallet.withdraw" data-id="${p.id}" data-amt="${w.available}" ${w.available < 1000 ? 'disabled' : ''}>Withdraw ${w.available >= 1000 ? M.fmt(w.available) : ''}</button>
    </div>
  </div>`;
}

/* The post-auction coaching loop. A pro who loses is told WHY — "your price
   was not the problem" is the line that stops undercutting, and it was built
   and never shown to anyone. */
function myRates(p) {
  const mine = getState().bids.filter(b => b.partnerId === p.id).slice(-6).reverse();
  if (!mine.length) return '';
  const label = { submitted: ['Waiting', 'info'], accepted: ['Won', 'ok'], rejected: ['Lost', 'soft'],
                  countered: ['Counter asked', 'warn'], shortlisted: ['Shortlisted', 'info'] };
  return `<div class="sec">
    ${sectionHead('Sealed bids', 'Your rates')}
    ${mine.map(b => { const r = getState().requests.find(x => x.id === b.requestId) || {};
      const c = r.catId ? get('category', r.catId) : { name: 'Job' };
      const [txt, tone] = label[b.status] || [b.status, 'soft'];
      return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:8px;padding:11px 14px"
        data-act="bid.result" data-id="${b.id}" ${b.status === 'rejected' ? '' : 'disabled'}>
        <div class="between"><div class="grow"><b class="tiny">${esc(c.name)} · ${esc(r.area || '')}</b>
          <p class="micro muted">You sent ${M.fmt(b.amount)} · ${timeAgo(b.submittedAt)}${b.status === 'rejected' ? ' · tap to see why' : ''}</p></div>
          <span class="pill pill--${tone}">${esc(txt)}</span></div></button>`; }).join('')}
  </div>`;
}

/* ── the shift control: the first question a working person asks ── */
function shiftControl(p) {
  const offline = p.online === false;
  const ready = readiness(p).canWork;
  return `<div class="glass glass--deep sheen rise" style="padding:16px 16px 14px;border-radius:var(--r-lg)">
    <div class="between" style="align-items:flex-start">
      <div class="grow">
        <span class="eyebrow">Your shift</span>
        <b class="h-display" style="display:block">${offline ? 'You are offline' : 'You are online'}</b>
        <p class="micro muted" style="margin-top:4px">${offline
          ? 'Requests near you will not reach this phone.'
          : `Jobs near ${esc(p.area)} reach you the moment they are posted.`}</p>
      </div>
      ${!offline && ready ? '<span class="pill pill--live">Live</span>' : ''}
    </div>
    ${ready ? `<div class="seg seg--lg" role="group" aria-label="Availability" style="margin-top:14px">
        <button class="seg__btn" type="button" aria-pressed="${offline ? 'false' : 'true'}"
          ${offline ? 'data-act="partner.online"' : ''}>Online</button>
        <button class="seg__btn" type="button" aria-pressed="${offline ? 'true' : 'false'}"
          ${offline ? '' : 'data-act="partner.online"'}>Offline</button>
      </div>`
    : `<div style="margin-top:14px"><span class="pill pill--soft">Verify to go online</span></div>`}
  </div>`;
}

/* ── money: three states, three chips, never one blended number ── */
function earningsBlock(earned, held, paidOut) {
  return `<div class="sec">
    ${sectionHead('Money', 'Earnings')}
    <div class="capsules metricrow">
      ${capsule('Paid out', M.fmt(earned), money('released', 'Released to you'), 'ok')}
      ${capsule('In escrow', M.fmt(held), money('held', 'Held until the job is confirmed'), 'info')}
      ${capsule('Sent to UPI', M.fmt(paidOut), money('available', 'Landed in your account'), 'soft')}
    </div>
    <p class="micro muted">Escrow, released and sent are three different things. A job only
      moves left to right — it never counts twice.</p>
  </div>`;
}

export function renderPartner() {
  const p = myPartner();
  if (!p) return `${header('Partner', '')}<main class="wrap">
    ${emptyBlock('Not a partner account', 'Sign in with a partner login.')}</main>`;
  const cat = get('category', p.cat);
  const t = trustScore(p);
  const orders = myOrders();
  const inbox = orders.filter(o => ['MATCHING','ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS','WORK_DONE'].includes(o.stage));
  // by SETTLEMENT, never by stage: a rated job moves on to CLOSED, and
  // filtering on SETTLED made a pro's lifetime earnings snap to Rs.0 the
  // moment a customer said thank you
  const paid = orders.filter(o => o.settledAt && (o.workerPayout || 0) > 0);
  const earned = paid.reduce((n, o) => n + (o.workerPayout || 0), 0);
  const paidOut = paid.filter(o => o.paidOut).reduce((n, o) => n + (o.workerPayout || 0), 0);
  const held = orders.filter(o => o.stage === 'WORK_DONE').reduce((n, o) => n + o.deal, 0);
  const nextTier = TIERS[Math.min(4, (p.tier | 0) + 1)];
  const a = avg(p);

  const gate = blocker(p);
  return `
  ${header(p.name, `${cat.name} · ${p.area}`)}
  ${cockpitCSS}
  <main class="wrap workspace">
    <div class="cockpit" style="padding-top:var(--sp-6)">

      <div class="cockpit__lead" style="display:grid;gap:var(--sp-6)">
        ${shiftControl(p)}
        ${progressCard(p)}
        ${gate && readiness(p).complete ? `<div class="card glass" style="border-color:var(--warn)">
          <b class="tiny">${esc(gate)}</b></div>` : ''}
      </div>

      <div class="cockpit__col">
        ${rateAsks(p)}

        <div class="sec">
          ${sectionHead('Today', 'Your jobs',
            `<span class="pill ${inbox.length ? 'pill--info' : 'pill--soft'}">${inbox.length} active</span>`)}
          ${inbox.length ? inbox.map(jobCard).join('')
            : `<div class="empty--smart">${emptyBlock('No live jobs', 'Stay online — requests land here.')}</div>`}
          ${inbox.length ? '<p class="micro muted">Chat with the customer, the arrival code and the finished-work photo all live inside the job.</p>' : ''}
        </div>

        ${walletCard(p)}
        ${myRates(p)}
      </div>

      <div class="cockpit__col">
        ${earningsBlock(earned, held, paidOut)}

        <div class="sec">
          ${sectionHead('Standing', 'Rating and trust',
            `<span class="pill pill--gold">${esc(t.band.label)}</span>`)}
          <div class="capsules metricrow">
            ${capsule('Rating', a.toFixed(1), ratingStars(a), 'gold')}
            ${capsule('Jobs done', String(p.completed), '', 'soft')}
            ${capsule('Trust', `${t.score}<span class="meta">/100</span>`, esc(t.band.label), 'info')}
            ${capsule('Your rate', M.fmt(p.ask), 'you keep 100%', 'ok')}
          </div>
          <p class="micro muted">
            You keep <b>100%</b> of your rate. A commission app would pay you about
            ${M.fmt(Math.round(p.ask * 0.75))} for the same job.</p>
        </div>

        <div class="sec">
          ${sectionHead('Ladder', 'Verification')}
          <div class="card glass">
            <b>${esc(tier(p.tier).label)}</b>
            <p class="tiny muted" style="margin-top:6px">${esc(tier(p.tier).unlocks)}</p>
            ${(p.tier | 0) < 4 ? `<div class="rule" style="margin:12px 0"></div>
              <b class="tiny">Next: ${esc(nextTier.label)}</b>
              <p class="tiny muted" style="margin-top:4px">${esc(nextTier.unlocks)}</p>
              <button class="btn btn--secondary btn--block" style="margin-top:12px"
                data-act="partner.upgrade">${readiness(p).complete ? 'Go further' : 'Continue verification'}</button>` : ''}
          </div>
        </div>

        <div class="sec">
          ${sectionHead('Public', 'Your page')}
          <button class="cmd" style="width:100%;text-align:left" data-act="pro.open" data-id="${p.id}">
            <div class="between">
              <div class="grow">
                <span class="cmd__title">saahaa.app/pro/${esc(p.id.slice(-6))}</span>
                <span class="cmd__sub">Your professional card — ratings, badges and reviews kept current by SAAHAA. Share it.</span>
              </div>
              <span class="avatar avatar--sm">${esc(p.name[0])}</span>
            </div>
            <span class="cmd__action">Open →</span>
          </button>
        </div>
      </div>

    </div>
    <div style="height:40px"></div>
  </main>`;
}

function jobCard(o) {
  const st = stage(o.stage);
  return `<button class="cmd rise" style="width:100%;text-align:left;margin-bottom:10px"
      data-act="order.open" data-id="${o.id}">
    <div class="between" style="align-items:flex-start">
      <div class="grow">
        <span class="cmd__title">${esc(o.customerName)}</span>
        <span class="cmd__sub">${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</span>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        <span class="pill pill--info">${esc(st.short)}</span>
        <b class="num" style="display:block;margin-top:6px">${M.fmt(o.deal)}</b>
      </div>
    </div>
    <span class="cmd__action">Open job</span>
  </button>`;
}
const avg = p => { const r = p.ratings || []; return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 4.5; };

/* ══════════════ SHOP CONSOLE ══════════════ */
/* A merchant command centre. Same tabs, same state, same writes — presented
   as one segmented control instead of a chip row, and split so that the
   question being asked ("what sells", "who buys", "when am I paid") each has
   a place to be answered. Customers, Payouts and Analytics are derived from
   orders that already exist; no new store, no new field. */

const SHOP_TABS = [
  ['orders',    'Orders'],
  ['catalog',   'Products'],
  ['stock',     'Inventory'],
  ['pricing',   'Pricing'],
  ['money',     'Sales'],
  ['customers', 'Customers'],
  ['payouts',   'Payouts'],
  ['analytics', 'Analytics'],
  ['setup',     'Shop profile'],
];

export function renderShopAdmin() {
  const s = myShop();
  if (!s) return `${header('Shop', '')}<main class="wrap">
    ${emptyBlock('Not a shop account', 'Sign in with a shop login.')}</main>`;
  const cat = get('category', s.catId);
  const items = getState().products.filter(p => p.shopId === s.id);
  const orders = myOrders();
  const live = orders.filter(o => !o.settledAt && !['R_CLOSED','R_CANCELLED'].includes(o.stage));

  const body =
      shopTab === 'orders'    ? shopOrders(orders)
    : shopTab === 'catalog'   ? shopCatalog(s, items)
    : shopTab === 'stock'     ? shopStock(s, items)
    : shopTab === 'pricing'   ? shopPricing(s, items)
    : shopTab === 'money'     ? shopMoney(s, orders)
    : shopTab === 'customers' ? shopCustomers(orders)
    : shopTab === 'payouts'   ? shopPayouts(orders)
    : shopTab === 'analytics' ? shopAnalytics(s, orders, items)
    :                           shopSetup(s);

  return `
  ${header(s.name, `${cat.name} · ${s.area}`)}
  ${cockpitCSS}
  <main class="wrap workspace">

    <div class="glass ${s.isOpen ? 'glass--gold sheen' : 'glass--deep'} rise"
         style="margin-top:var(--sp-6);padding:16px;border-radius:var(--r-lg)">
      <div class="between" style="align-items:flex-start">
        <div class="grow">
          <span class="eyebrow">Master switch</span>
          <b class="h-display" style="display:block">${s.isOpen ? 'You are OPEN' : 'You are CLOSED'}</b>
          <p class="micro muted" style="margin-top:4px">
            ${s.isOpen ? 'Customers can order right now.' : "Customers can't order. Open to start selling."}</p>
        </div>
        ${s.isOpen ? '<span class="pill pill--live">Live</span>' : '<span class="pill pill--soft">Closed</span>'}
      </div>
      <div class="between" style="margin-top:14px;gap:10px">
        <div class="capsules metricrow" style="flex:1;min-width:0">
          ${capsule('Live orders', String(live.length), '', live.length ? 'info' : 'soft')}
          ${capsule('Items listed', String(items.length), '', 'soft')}
          ${capsule('Fill rate', `${s.fillRate}<span class="meta">%</span>`, '', s.fillRate >= 85 ? 'ok' : 'warn')}
        </div>
        <button class="btn ${s.isOpen ? 'btn--ghost' : 'btn--primary'}" data-act="shop.toggle">
          ${s.isOpen ? 'Close' : 'Open'}</button>
      </div>
    </div>

    <div class="seg" role="tablist" aria-label="Shop sections"
         style="margin:var(--sp-6) 0;overflow-x:auto;scrollbar-width:none">
      ${SHOP_TABS.map(([k, l]) => `<button class="seg__btn" type="button" role="tab"
        aria-pressed="${shopTab === k ? 'true' : 'false'}"
        aria-selected="${shopTab === k ? 'true' : 'false'}"
        data-act="shop.tab" data-tab="${k}">${esc(l)}</button>`).join('')}
    </div>

    ${body}
    <div style="height:60px"></div>
  </main>`;
}

function shopOrders(orders) {
  const live = orders.filter(o => !o.settledAt && !['R_CLOSED','R_CANCELLED'].includes(o.stage));
  if (!live.length) return `<div class="empty--smart">${
    emptyBlock('No orders right now', 'New orders appear here with a 60-second accept timer.')}</div>`;
  return `<div class="sec">${sectionHead('Live', 'Orders',
      `<span class="pill pill--live">${live.length} open</span>`)}
    ${live.map((o, i) => {
      const st = stage(o.stage);
      return `<button class="cmd rise${i ? ` rise-${Math.min(5, i + 1)}` : ''}"
          style="width:100%;text-align:left;margin-bottom:10px"
          data-act="order.open" data-id="${o.id}">
        <div class="between" style="align-items:flex-start">
          <div class="grow">
            <span class="cmd__title">${esc(o.customerName)}</span>
            <span class="cmd__sub">${o.lines.length} items · ${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</span>
          </div>
          <div style="text-align:right;flex:0 0 auto">
            <span class="pill pill--info">${esc(st.short)}</span>
            <b class="num" style="display:block;margin-top:6px">${M.fmt(o.customerPays)}</b>
          </div>
        </div>
        <span class="cmd__action">Open order</span>
      </button>`;
    }).join('')}</div>`;
}

/* ── CATALOG MANAGER — inline-editable rows + the starter picker ── */
function catalogSearch(items) {
  return `<div class="search" style="margin-bottom:var(--sp-6)">
    <span aria-hidden="true">${icon('search', { size: 16 })}</span>
    <input id="catq" type="search" placeholder="Search your ${items.length} items"
           value="${esc(catalogQuery)}" data-role="catalogsearch">
  </div>`;
}

const shownItems = items => {
  const q = catalogQuery.trim().toLowerCase();
  return q ? items.filter(p => p.name.toLowerCase().includes(q) || p.aisle.toLowerCase().includes(q)) : items;
};

/** The picker is the whole point of the console — it gets a full-width
    command card at the top AND a floating button that follows the list. */
function pickerCall(items) {
  return `
  <button class="cmd glass--gold sheen" style="width:100%;text-align:left" data-act="cat.picker">
    <span class="cmd__title" style="display:flex;align-items:center;gap:8px">${icon('plus', { size: 18 })} Add items from our ready list</span>
    <span class="cmd__sub">Tap an item, change the price, set stock. About six seconds each.</span>
    <span class="cmd__action">Open the ready list</span>
  </button>
  <button class="fab" data-act="cat.picker" aria-label="Add items from our ready list">${icon('plus', { size: 22 })}
    <span class="fab__count">${items.length}</span></button>`;
}

function shopCatalog(s, items) {
  const shown = shownItems(items);
  const aisles = [...new Set(shown.map(p => p.aisle))];

  return `
  ${pickerCall(items)}

  ${items.length ? `
    <div style="margin-top:var(--sp-6)">${catalogSearch(items)}</div>
    ${aisles.map(a => `<div class="sec" style="margin-top:var(--sp-6)">
      ${sectionHead('', a, `<span class="pill pill--soft">${shown.filter(p => p.aisle === a).length}</span>`)}
      <div class="prodgrid">${shown.filter(p => p.aisle === a).map(catalogRow).join('')}</div>
    </div>`).join('')}`
  : `<div class="empty--smart" style="margin-top:var(--sp-6)">${
      emptyBlock('No items listed yet', 'Add your first ten items — it takes about two minutes.')}</div>`}`;
}

/* Same rows, price first: the question here is "what am I charging", so the
   price sits at the head of the card and the MRP guard rail next to it. */
function shopPricing(s, items) {
  const shown = shownItems(items);
  if (!items.length) return `<div class="empty--smart">${
    emptyBlock('Nothing to price yet', 'Add items from the ready list first — prices come pre-filled.')}</div>`;
  return `
  <div class="sec">
    ${sectionHead('Pricing', 'What you charge', `<span class="pill pill--soft">${items.length} items</span>`)}
    ${catalogSearch(items)}
    <div class="prodgrid">${shown.map(p => priceRow(p)).join('')}</div>
    <p class="micro muted">A price above MRP is refused as you type it — that is what keeps the
      “MRP parity” badge on your shop.</p>
  </div>
  ${pickerCall(items)}`;
}

function priceRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  return `<div class="card glass" style="padding:12px">
    <div class="between" style="align-items:flex-start">
      <div class="grow">
        <b style="font-size:14px">${esc(p.name)}</b>
        <p class="micro muted">${esc(p.unit)}${p.mrp ? ` · MRP ${M.fmt(p.mrp)}` : ''}
          ${p.variableWeight ? ' · by weight' : ''}${p.rxRequired ? ' · Rx' : ''}</p>
      </div>
      ${out ? '<span class="pill pill--bad">Hidden</span>' : '<span class="pill pill--ok">Listed</span>'}
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <label class="tiny muted" style="width:38px">Price</label>
      <input class="grow" type="number" value="${(p.price / 100).toFixed(0)}" data-role="price" data-id="${p.id}"
        style="height:38px;padding:0 10px;border:1.5px solid var(--border);border-radius:var(--r-sm);
               background:var(--surface-2);color:var(--ink-1);font-size:15px">
      <label class="tiny muted" style="width:38px">Stock</label>
      <input class="grow" type="number" value="${p.stockQty}" data-role="stock" data-id="${p.id}"
        style="height:38px;padding:0 10px;border:1.5px solid var(--border);border-radius:var(--r-sm);
               background:var(--surface-2);color:var(--ink-1);font-size:15px">
    </div>
  </div>`;
}

function catalogRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  return `<div class="card glass" style="padding:12px;${out ? 'border-color:var(--danger)' : ''}">
    <div class="between">
      <div class="grow">
        <b style="font-size:14px">${esc(p.name)}</b>
        <p class="micro muted">${esc(p.unit)}${p.mrp ? ` · MRP ${M.fmt(p.mrp)}` : ''}
          ${p.variableWeight ? ' · by weight' : ''}${p.rxRequired ? ' · Rx' : ''}</p>
      </div>
      <button class="btn btn--ghost btn--sm tap" data-act="prod.remove" data-id="${p.id}"
        aria-label="Remove">${icon('trash', { size: 16 })}</button>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <label class="tiny muted" style="width:38px">Price</label>
      <input class="grow" type="number" value="${(p.price / 100).toFixed(0)}" data-role="price" data-id="${p.id}"
        style="height:38px;padding:0 10px;border:1.5px solid var(--border);border-radius:var(--r-sm);
               background:var(--surface-2);color:var(--ink-1);font-size:15px">
      <label class="tiny muted" style="width:38px">Stock</label>
      <input class="grow" type="number" value="${p.stockQty}" data-role="stock" data-id="${p.id}"
        style="height:38px;padding:0 10px;border:1.5px solid var(--border);border-radius:var(--r-sm);
               background:var(--surface-2);color:var(--ink-1);font-size:15px">
    </div>
    ${out ? '<p class="micro" style="color:var(--danger);margin-top:8px">Hidden from customers — set stock above 0.</p>' : ''}
  </div>`;
}

export function openPicker() {
  const s = myShop(); if (!s) return;
  const owned = new Set(getState().products.filter(p => p.shopId === s.id).map(p => p.refId));
  const list = searchStarter(s.catId, pickerQuery).filter(sc => !owned.has(sc.refId));
  sheet('Add items', `
    <div class="search" style="margin-bottom:var(--sp-6)">
      <span aria-hidden="true">${icon('search', { size: 16 })}</span>
      <input id="pickq" type="search" placeholder="Search e.g. atta, tomato, milk"
             value="${esc(pickerQuery)}" data-role="pickersearch" autocomplete="off">
    </div>
    <p class="tiny muted" style="margin-bottom:12px">${list.length} items you don't stock yet</p>
    ${list.slice(0, 60).map(sc => `
      <div class="card" style="padding:11px;margin-bottom:7px">
        <div class="between">
          <div class="grow"><b style="font-size:14px">${esc(sc.name)}</b>
            <p class="micro muted">${esc(sc.aisle)} · ${esc(sc.unit)}
              ${sc.mrp ? ` · MRP ${M.fmt(sc.mrp)}` : ''}</p></div>
          <div class="row" style="gap:6px">
            <b class="num tiny">${M.fmt(sc.price)}</b>
            <button class="btn btn--primary btn--sm" data-act="pick.add" data-ref="${sc.refId}">Add</button>
          </div>
        </div>
      </div>`).join('') || '<p class="muted tiny">Nothing left to add here.</p>'}
  `, { noFocus: true });
}

function shopStock(s, items) {
  const out = items.filter(p => p.trackStock && p.stockQty <= 0);
  const low = items.filter(p => p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt);
  const exp = items.filter(p => p.perishable && p.mfgDate && Date.now() - p.mfgDate > 2 * 86400000);
  const block = (title, list, tone) => `<div class="sec">
    ${sectionHead('', title, `<span class="pill pill--${tone}">${list.length}</span>`)}
    ${list.length ? `<div class="prodgrid">${list.map(p => `<div class="card glass" style="padding:11px">
      <div class="between"><div class="grow"><b class="tiny">${esc(p.name)}</b>
        <p class="micro muted">${esc(p.aisle)} · stock ${p.stockQty}</p></div>
        <button class="btn btn--secondary btn--sm" data-act="stock.refill" data-id="${p.id}">Restock 20</button>
      </div></div>`).join('')}</div>` : '<p class="tiny muted">Nothing here — good.</p>'}</div>`;
  return `
    <div class="glass glass--gold sheen" style="padding:14px 16px;border-radius:var(--r-lg)">
      <span class="eyebrow">Inventory health</span>
      <b class="h-display" style="display:block">Fill rate ${s.fillRate}%</b>
      <p class="micro muted" style="margin-top:4px">Stay above 85% to keep the “Reliable stock” badge and your ranking.</p>
    </div>
    ${block(`${icon('cross', { size: 14 })} Out of stock (hidden from buyers)`, out, out.length ? 'bad' : 'soft')}
    ${block(`${icon('warn', { size: 14 })} Running low`, low, low.length ? 'warn' : 'soft')}
    ${block(`${icon('calendar', { size: 14 })} Ageing perishables`, exp, exp.length ? 'warn' : 'soft')}`;
}

function shopMoney(s, orders) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);   // by settlement, not by stage
  const gross = done.reduce((n, o) => n + o.itemsTotal, 0);
  const fee = done.reduce((n, o) => n + o.platformFee, 0);
  const rider = done.reduce((n, o) => n + (o.riderPayout || 0), 0);
  const net = done.reduce((n, o) => n + o.shopPayout, 0);
  const cat = get('category', s.catId);
  return `
    <div class="sec">
      ${sectionHead('Settled', 'Sales', `<span class="pill pill--soft">${done.length} orders</span>`)}
      <div class="moneyflow">
        <div class="moneyflow__node">
          <span class="meta">Gross sales</span><b class="num num-xl">${M.fmt(gross)}</b></div>
        <span class="moneyflow__arrow" aria-hidden="true">→</span>
        <div class="moneyflow__split">
          <div class="moneyflow__node">
            <span class="meta">SAAHAA fee (${cat.takePct}%, capped ${M.fmt(cat.takeCapPaise)})</span>
            <b class="num" style="color:var(--danger)">− ${M.fmt(fee)}</b></div>
          <div class="moneyflow__node">
            <span class="meta">Rider fees</span>
            <b class="num" style="color:var(--danger)">− ${M.fmt(rider)}</b></div>
        </div>
        <span class="moneyflow__arrow" aria-hidden="true">→</span>
        <div class="moneyflow__node">
          <span class="meta">Your net</span>
          <b class="num num-xl" style="color:var(--success)">${M.fmt(net)}</b>
          ${money('released', 'Yours after settlement')}</div>
      </div>
      <p class="micro muted">
        A delivery aggregator would take 20–30% of that gross. SAAHAA takes ${cat.takePct}%
        because a kirana's own margin on staples is only 3–6% — a bigger cut would cost you
        more than the item earns.</p>
    </div>
    <div class="sec">
      ${sectionHead('', 'Settled orders')}
      ${done.length ? done.slice(0, 20).map(o => `<div class="card glass" style="padding:11px;margin-bottom:7px">
        <div class="between"><span class="tiny">${esc(o.customerName)} · ${timeAgo(o.createdAt)}</span>
          <b class="num tiny">${M.fmt(o.shopPayout)}</b></div></div>`).join('')
        : '<p class="tiny muted">No settled orders yet.</p>'}</div>`;
}

/* Derived, read-only: the same orders this console already shows, grouped by
   the name the customer ordered under. No new store, no new field. */
function shopCustomers(orders) {
  const byName = new Map();
  orders.forEach(o => {
    const k = o.customerName || 'Customer';
    const e = byName.get(k) || { name: k, n: 0, last: 0, area: o.customerArea || '' };
    e.n += 1;
    e.last = Math.max(e.last, o.createdAt || 0);
    if (o.customerArea) e.area = o.customerArea;
    byName.set(k, e);
  });
  const list = [...byName.values()].sort((a, b) => b.n - a.n || b.last - a.last);
  const repeat = list.filter(c => c.n > 1).length;
  if (!list.length) return `<div class="empty--smart">${
    emptyBlock('No customers yet', 'Every order you take adds the buyer here.')}</div>`;
  return `<div class="sec">
    ${sectionHead('Who buys', 'Customers', `<span class="pill pill--soft">${list.length}</span>`)}
    <div class="capsules metricrow">
      ${capsule('Customers', String(list.length), '', 'soft')}
      ${capsule('Came back', String(repeat), 'ordered more than once', repeat ? 'ok' : 'soft')}
      ${capsule('Orders', String(orders.length), '', 'info')}
    </div>
    <div class="avatars" style="margin:var(--sp-6) 0">
      ${list.slice(0, 12).map(c => `<span class="avatar avatar--md" title="${esc(c.name)}">${esc(c.name[0])}</span>`).join('')}
    </div>
    <div class="prodgrid">
      ${list.map(c => `<div class="card glass" style="padding:11px">
        <div class="row">
          <span class="avatar avatar--sm">${esc(c.name[0])}</span>
          <div class="grow"><b class="tiny">${esc(c.name)}</b>
            <p class="micro muted">${esc(c.area)}${c.last ? ` · last ${timeAgo(c.last)}` : ''}</p></div>
          <span class="pill ${c.n > 1 ? 'pill--ok' : 'pill--soft'}">${c.n} ${c.n === 1 ? 'order' : 'orders'}</span>
        </div></div>`).join('')}
    </div>
    <p class="micro muted">Read only. SAAHAA never hands you a customer's number — the chat inside
      each order is the way to reach them.</p>
  </div>`;
}

/* paidOut vs pending, from the fields the payout run already writes. */
function shopPayouts(orders) {
  const settled = orders.filter(o => o.settledAt && o.shopPayout);
  const sent = settled.filter(o => o.paidOut);
  const waiting = settled.filter(o => !o.paidOut);
  const inEscrow = orders.filter(o => !o.settledAt && !['R_CLOSED','R_CANCELLED'].includes(o.stage));
  const sum = list => list.reduce((n, o) => n + (o.shopPayout || 0), 0);
  const row = (o, state, label) => `<div class="card glass" style="padding:11px;margin-bottom:7px">
    <div class="between"><div class="grow"><b class="tiny">${esc(o.customerName)}</b>
      <p class="micro muted">${timeAgo(o.createdAt)}${o.settledAt ? ` · settled ${timeAgo(o.settledAt)}` : ''}</p></div>
      <div style="text-align:right"><b class="num tiny" style="display:block">${M.fmt(o.shopPayout || 0)}</b>
        ${money(state, label)}</div></div></div>`;
  return `<div class="sec">
    ${sectionHead('Money', 'Payouts')}
    <div class="capsules metricrow">
      ${capsule('Sent to your bank', M.fmt(sum(sent)), money('released', `${sent.length} paid`), 'ok')}
      ${capsule('Awaiting payout', M.fmt(sum(waiting)), money('pending', `${waiting.length} settled`), 'warn')}
      ${capsule('Still in escrow', M.fmt(sum(inEscrow)), money('held', `${inEscrow.length} live`), 'info')}
    </div>
    <p class="micro muted">These three never add up into one number. Escrow becomes awaiting the
      moment an order settles; awaiting becomes sent when the payout run clears.</p>

    <div class="sec">${sectionHead('', 'Awaiting payout')}
      ${waiting.length ? waiting.slice(0, 20).map(o => row(o, 'pending', 'Awaiting')).join('')
        : '<p class="tiny muted">Nothing waiting.</p>'}</div>
    <div class="sec">${sectionHead('', 'Paid out')}
      ${sent.length ? sent.slice(0, 20).map(o => row(o, 'released', 'Sent')).join('')
        : '<p class="tiny muted">No payout has cleared yet.</p>'}</div>
  </div>`;
}

/* Every figure below is read off orders and products that already exist. */
function shopAnalytics(s, orders, items) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);
  const gross = done.reduce((n, o) => n + o.itemsTotal, 0);
  const avgOrder = done.length ? Math.round(gross / done.length) : 0;
  const cancelled = orders.filter(o => o.stage === 'R_CANCELLED').length;
  const listed = items.filter(p => p.active && (!p.trackStock || p.stockQty > 0)).length;
  return `<div class="sec">
    ${sectionHead('Numbers', 'Analytics')}
    <div class="capsules metricrow">
      ${capsule('Fill rate', `${s.fillRate}<span class="meta">%</span>`, 'items found in stock', s.fillRate >= 85 ? 'ok' : 'warn')}
      ${capsule('Orders', String(orders.length), `${done.length} settled`, 'info')}
      ${capsule('Average order', M.fmt(avgOrder), 'on settled orders', 'gold')}
    </div>
    <div class="capsules metricrow" style="margin-top:10px">
      ${capsule('Items buyable now', `${listed}<span class="meta">/${items.length}</span>`, '', listed ? 'ok' : 'warn')}
      ${capsule('Cancelled', String(cancelled), '', cancelled ? 'warn' : 'soft')}
      ${capsule('Min order', M.fmt(s.minOrder), '', 'soft')}
    </div>
    <p class="micro muted">Fill rate is the number a buyer feels: how often what they tapped was
      actually on your shelf. It drives the “Reliable stock” badge and your place in the list.</p>
  </div>`;
}

function shopSetup(s) {
  const cat = get('category', s.catId);
  const line = (k, v) => `<div class="between" style="margin-bottom:8px">
    <span class="tiny muted">${k}</span>${v}</div>`;
  return `
    <div class="sec">
      ${sectionHead('Profile', 'Your shop')}
      <div class="card glass">
        <div class="row">
          <span class="avatar avatar--lg">${esc(s.name[0])}</span>
          <div class="grow"><b>${esc(s.name)}</b>
            <p class="tiny muted" style="margin-top:4px">${esc(cat.name)} · ${esc(s.area)} · ${esc(s.mobile)}</p></div>
        </div>
        <div class="rule" style="margin:12px 0"></div>
        ${line('Minimum order', `<b class="num">${M.fmt(s.minOrder)}</b>`)}
        ${line('Free delivery above', `<b class="num">${M.fmt(s.freeDeliveryAbove)}</b>`)}
        ${line('Prep time', `<b>${s.prepMins} min</b>`)}
        ${line('Delivery radius', `<b>${s.radiusKm} km</b>`)}
        ${s.fssai ? line('FSSAI', `<b class="tiny">${esc(s.fssai)}</b>`) : ''}
        ${s.drugLicence ? line('Drug licence', `<b class="tiny">${esc(s.drugLicence)}</b>`) : ''}
      </div>
    </div>
    <div class="sec">
      ${sectionHead('', 'Delivery mode')}
      <div class="seg" role="group" aria-label="Delivery mode" style="overflow-x:auto;scrollbar-width:none">
        ${[['self','I deliver'],['rider','SAAHAA rider'],['both','Either'],['pickup_only','Pickup only']]
          .map(([k, l]) => `<button class="seg__btn" type="button"
            aria-pressed="${s.deliveryMode === k ? 'true' : 'false'}"
            data-act="shop.mode" data-mode="${k}">${esc(l)}</button>`).join('')}
      </div>
      <p class="micro muted">Pickup only hides the delivery fee from your customers entirely.</p>
    </div>`;
}

/* ── handlers ──────────────────────────────────────────────── */
export function addFromPicker(refId) {
  const s = myShop(); if (!s) return;
  const sc = searchStarter(s.catId, '').find(x => x.refId === refId);
  if (!sc) return;
  flow.addProductFromStarter(s.id, sc);
  toast(`${sc.name} listed`);
  openPicker();
  ctx.render();
}
export function refill(productId) {
  dispatch({ type: 'product/stock', payload: { id: productId, qty: 20 } });
  toast('Restocked');
  ctx.render();
}
export function removeProduct(productId) {
  dispatch({ type: 'product/remove', payload: { id: productId } });
  toast('Removed from your catalog');
  ctx.render();
}
export function priceEdit(productId, rupees) {
  const r = flow.setProductPrice(productId, Math.round(Number(rupees) * 100));
  if (!r.ok && r.reason) toast(r.reason, 'danger');
}
export function stockEdit(productId, qty) {
  dispatch({ type: 'product/stock', payload: { id: productId, qty: Math.max(0, Number(qty) | 0) } });
}
