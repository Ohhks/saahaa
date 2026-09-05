/* SAAHAA · ui/views/partner.js — the two partner consoles.

   1. Pro console  — jobs inbox, earnings, online toggle, trust ladder.
   2. Shop console — orders inbox, CATALOG MANAGER with the starter-catalog
      picker, stock, earnings, open/closed master switch.

   The catalog manager is the answer to "make sure grocery store can list
   their products too": search a ready list, tap, overtype the price, set
   stock. No long form, no CSV, no photography. */

import { esc, sheet, closeSheet, toast, ratingStars, timeAgo } from '../dom.js';
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

let pickerQuery = '', catalogQuery = '', shopTab = 'orders';
export const setPickerQuery = v => { pickerQuery = v; };
export const setCatalogQuery = v => { catalogQuery = v; };
export const setShopTab = v => { shopTab = v; };

/* ══════════════ PRO CONSOLE ══════════════ */
/* Jobs out for rates. He sees the public band, the COUNT of workers asked,
   and nothing else — no rival's price, no name, not even whether anyone has
   replied. That is what "sealed" means, and it is the only reason a worker
   can quote against the fair price instead of against a rival. */
function rateAsks(p) {
  const open = auction.openRequestsForPartner(p);
  if (!open.length) return '';
  return `<div class="sec"><div class="hd"><h2>Asking for rates</h2>
      <span class="tiny muted">${open.length} near you</span></div>
    ${open.map(r => {
      const c = get('category', r.catId);
      const left = Math.max(0, Math.round((r.closesAt - Date.now()) / 60000));
      return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:8px"
        data-act="bid.open" data-id="${r.id}" data-pid="${p.id}">
        <div class="between">
          <div class="grow"><b>${esc(r.sub || c.name)}</b>
            <p class="tiny muted">${esc(r.area)} · ${r.bidCount} workers asked · ${left} min left</p></div>
          <div style="text-align:right">
            <b class="num" style="font-size:17px">${M.fmt(r.target)}</b>
            <p class="micro muted">fair price</p></div>
        </div></button>`;
    }).join('')}
    <p class="micro muted">Sending less than the fair price lowers your chance. It does not raise it.</p>
  </div>`;
}

/* The post-auction coaching loop. A pro who loses is told WHY — "your price
   was not the problem" is the line that stops undercutting, and it was built
   and never shown to anyone. */
function myRates(p) {
  const mine = getState().bids.filter(b => b.partnerId === p.id).slice(-6).reverse();
  if (!mine.length) return '';
  const label = { submitted: ['Waiting', 'badge--info'], accepted: ['Won', 'badge--ok'], rejected: ['Lost', 'badge--soft'],
                  countered: ['Counter asked', 'badge--warn'], shortlisted: ['Shortlisted', 'badge--info'] };
  return `<div class="sec"><div class="hd"><h2>Your rates</h2></div>
    ${mine.map(b => { const r = getState().requests.find(x => x.id === b.requestId) || {};
      const c = r.catId ? get('category', r.catId) : { name: 'Job' };
      const [txt, cls] = label[b.status] || [b.status, 'badge--soft'];
      return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:8px;padding:11px 14px"
        data-act="bid.result" data-id="${b.id}" ${b.status === 'rejected' ? '' : 'disabled'}>
        <div class="between"><div class="grow"><b class="tiny">${esc(c.name)} · ${esc(r.area || '')}</b>
          <p class="micro muted">You sent ${M.fmt(b.amount)} · ${timeAgo(b.submittedAt)}${b.status === 'rejected' ? ' · tap to see why' : ''}</p></div>
          <span class="badge ${cls}">${txt}</span></div></button>`; }).join('')}
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

  const gate = blocker(p);
  return `
  ${header(p.name, `${cat.ico} ${cat.name} · ${p.area}`)}
  <main class="wrap">
    ${progressCard(p)}
    ${gate && readiness(p).complete ? `<div class="card" style="margin-top:var(--sp-6);border-color:var(--warn)"><b class="tiny">${esc(gate)}</b></div>` : ''}

    <div class="card on-plum" style="margin-top:var(--sp-6);border:0">
      <div class="between">
        <div><span class="tiny muted">Paid out</span>
          <b class="num" style="display:block;font-size:26px">${M.fmt(earned)}</b>
          <p class="micro muted">${M.fmt(held)} in escrow · ${M.fmt(paidOut)} sent to UPI</p></div>
        <div style="text-align:right">
          <span class="badge badge--gold">${t.band.label}</span>
          <p class="tiny" style="margin-top:6px">Trust ${t.score}/100</p>
        </div>
      </div>
      <div class="between" style="margin-top:14px">
        <span class="tiny">${p.online === false ? 'You are offline' : 'You are online'}</span>
        ${readiness(p).canWork ? `<button class="btn ${p.online === false ? 'btn--secondary' : 'btn--primary'} btn--sm"
          data-act="partner.online">${p.online === false ? 'Go online' : 'Go offline'}</button>`
          : '<span class="badge badge--soft">Verify to go online</span>'}
      </div>
    </div>

    <div class="saves" style="margin-top:var(--sp-6)">
      <div><div class="k">Jobs done</div><div class="v num">${p.completed}</div></div>
      <div><div class="k">Rating</div><div class="v num">${avg(p).toFixed(1)}</div></div>
      <div class="good"><div class="k">Your rate</div><div class="v num">${M.fmt(p.ask)}</div></div>
    </div>
    <p class="micro muted" style="margin:-4px 0 0">
      You keep <b>100%</b> of your rate. A commission app would pay you about
      ${M.fmt(Math.round(p.ask * 0.75))} for the same job.</p>

    ${rateAsks(p)}
    ${myRates(p)}

    <div class="sec"><div class="hd"><h2>Your jobs</h2><span class="tiny muted">${inbox.length} active</span></div>
      ${inbox.length ? inbox.map(jobCard).join('') : emptyBlock('No live jobs', 'Stay online — requests land here.')}
    </div>

    <div class="sec"><div class="hd"><h2>Verification</h2></div>
      <div class="card">
        <b>${esc(tier(p.tier).label)}</b>
        <p class="tiny muted" style="margin-top:6px">${esc(tier(p.tier).unlocks)}</p>
        ${(p.tier | 0) < 4 ? `<div class="rule" style="margin:12px 0"></div>
          <b class="tiny">Next: ${esc(nextTier.label)}</b>
          <p class="tiny muted" style="margin-top:4px">${esc(nextTier.unlocks)}</p>
          <button class="btn btn--secondary btn--block" style="margin-top:12px"
            data-act="partner.upgrade">${readiness(p).complete ? 'Go further' : 'Continue verification'}</button>` : ''}
      </div>
    </div>

    <div class="sec"><div class="hd"><h2>Your page</h2></div>
      <button class="card card--tap" style="width:100%;text-align:left" data-act="pro.open" data-id="${p.id}">
        <div class="between"><div class="grow"><b>saahaa.app/pro/${esc(p.id.slice(-6))}</b>
          <p class="tiny muted">Your professional card — ratings, badges and reviews kept current by SAAHAA. Share it.</p></div>
          <span class="tiny" style="color:var(--accent)">Open →</span></div>
      </button>
    </div>
    <div style="height:40px"></div>
  </main>`;
}

function jobCard(o) {
  const st = stage(o.stage);
  return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:10px"
      data-act="order.open" data-id="${o.id}">
    <div class="between">
      <div class="grow"><b>${esc(o.customerName)}</b>
        <p class="tiny muted">${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</p></div>
      <div style="text-align:right"><span class="badge badge--info">${esc(st.short)}</span>
        <b class="num" style="display:block;margin-top:6px">${M.fmt(o.deal)}</b></div>
    </div></button>`;
}
const avg = p => { const r = p.ratings || []; return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 4.5; };

/* ══════════════ SHOP CONSOLE ══════════════ */
export function renderShopAdmin() {
  const s = myShop();
  if (!s) return `${header('Shop', '')}<main class="wrap">
    ${emptyBlock('Not a shop account', 'Sign in with a shop login.')}</main>`;
  const cat = get('category', s.catId);
  const items = getState().products.filter(p => p.shopId === s.id);
  const orders = myOrders();

  return `
  ${header(s.name, `${cat.ico} ${esc(cat.name)} · ${esc(s.area)}`)}
  <main class="wrap">

    <div class="card ${s.isOpen ? 'card--gold' : ''}" style="margin-top:var(--sp-6)">
      <div class="between">
        <div><b style="font-size:17px">${s.isOpen ? 'You are OPEN' : 'You are CLOSED'}</b>
          <p class="tiny muted" style="margin-top:3px">
            ${s.isOpen ? 'Customers can order right now.' : "Customers can't order. Open to start selling."}</p></div>
        <button class="btn ${s.isOpen ? 'btn--ghost' : 'btn--primary'}" data-act="shop.toggle">
          ${s.isOpen ? 'Close' : 'Open'}</button>
      </div>
    </div>

    <div class="chiprow" style="margin:var(--sp-6) 0">
      ${[['orders','📥 Orders'],['catalog','📦 Catalog'],['stock','⚠️ Stock'],['money','💰 Earnings'],['setup','⚙️ Setup']]
        .map(([k, l]) => `<button class="chip ${shopTab === k ? 'on' : ''}" data-act="shop.tab" data-tab="${k}">${l}</button>`).join('')}
    </div>

    ${shopTab === 'orders'  ? shopOrders(orders)
    : shopTab === 'catalog' ? shopCatalog(s, items)
    : shopTab === 'stock'   ? shopStock(s, items)
    : shopTab === 'money'   ? shopMoney(s, orders)
    :                         shopSetup(s)}
    <div style="height:60px"></div>
  </main>`;
}

function shopOrders(orders) {
  const live = orders.filter(o => !o.settledAt && !['R_CLOSED','R_CANCELLED'].includes(o.stage));
  if (!live.length) return emptyBlock('No orders right now', 'New orders appear here with a 60-second accept timer.');
  return live.map(o => {
    const st = stage(o.stage);
    return `<button class="card card--tap" style="width:100%;text-align:left;margin-bottom:10px"
        data-act="order.open" data-id="${o.id}">
      <div class="between">
        <div class="grow"><b>${esc(o.customerName)}</b>
          <p class="tiny muted">${o.lines.length} items · ${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</p></div>
        <div style="text-align:right"><span class="badge badge--info">${esc(st.short)}</span>
          <b class="num" style="display:block;margin-top:6px">${M.fmt(o.customerPays)}</b></div>
      </div></button>`;
  }).join('');
}

/* ── CATALOG MANAGER — inline-editable rows + the starter picker ── */
function shopCatalog(s, items) {
  const q = catalogQuery.trim().toLowerCase();
  const shown = q ? items.filter(p => p.name.toLowerCase().includes(q) || p.aisle.toLowerCase().includes(q)) : items;
  const aisles = [...new Set(shown.map(p => p.aisle))];

  return `
  <button class="btn btn--primary btn--lg btn--block" data-act="cat.picker">
    ＋ Add items from our ready list
  </button>
  <p class="micro muted" style="text-align:center;margin:10px 0 18px">
    Tap an item, change the price, set stock. About six seconds each.</p>

  ${items.length ? `
    <div class="search" style="margin-bottom:var(--sp-6)">
      <span aria-hidden="true">🔎</span>
      <input id="catq" type="search" placeholder="Search your ${items.length} items"
             value="${esc(catalogQuery)}" data-role="catalogsearch">
    </div>
    ${aisles.map(a => `<div class="sec" style="margin-top:var(--sp-6)">
      <div class="hd"><h2 style="font-size:15px">${esc(a)}</h2></div>
      ${shown.filter(p => p.aisle === a).map(catalogRow).join('')}
    </div>`).join('')}`
  : emptyBlock('No items listed yet', 'Add your first ten items — it takes about two minutes.')}`;
}

function catalogRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  return `<div class="card" style="padding:12px;margin-bottom:8px;${out ? 'border-color:var(--danger)' : ''}">
    <div class="between">
      <div class="grow">
        <b style="font-size:14px">${esc(p.name)}</b>
        <p class="micro muted">${esc(p.unit)}${p.mrp ? ` · MRP ${M.fmt(p.mrp)}` : ''}
          ${p.variableWeight ? ' · by weight' : ''}${p.rxRequired ? ' · Rx' : ''}</p>
      </div>
      <button class="btn btn--ghost btn--sm tap" data-act="prod.remove" data-id="${p.id}"
        aria-label="Remove">🗑</button>
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
      <span aria-hidden="true">🔎</span>
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
  const block = (title, list, tone) => `<div class="sec"><div class="hd">
      <h2 style="font-size:15px">${title} · ${list.length}</h2></div>
    ${list.length ? list.map(p => `<div class="card" style="padding:11px;margin-bottom:7px">
      <div class="between"><div class="grow"><b class="tiny">${esc(p.name)}</b>
        <p class="micro muted">${esc(p.aisle)} · stock ${p.stockQty}</p></div>
        <button class="btn btn--secondary btn--sm" data-act="stock.refill" data-id="${p.id}">Restock 20</button>
      </div></div>`).join('') : '<p class="tiny muted">Nothing here — good.</p>'}</div>`;
  return `
    <div class="card card--gold"><b>Fill rate ${s.fillRate}%</b>
      <p class="tiny muted" style="margin-top:4px">Stay above 85% to keep the “Reliable stock” badge and your ranking.</p></div>
    ${block('❌ Out of stock (hidden from buyers)', out)}
    ${block('⚠️ Running low', low)}
    ${block('🗓 Ageing perishables', exp)}`;
}

function shopMoney(s, orders) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);   // by settlement, not by stage
  const gross = done.reduce((n, o) => n + o.itemsTotal, 0);
  const fee = done.reduce((n, o) => n + o.platformFee, 0);
  const rider = done.reduce((n, o) => n + (o.riderPayout || 0), 0);
  const net = done.reduce((n, o) => n + o.shopPayout, 0);
  const cat = get('category', s.catId);
  return `
    <div class="card">
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Gross sales</span><b class="num">${M.fmt(gross)}</b></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">SAAHAA fee (${cat.takePct}%, capped ${M.fmt(cat.takeCapPaise)})</span>
        <b class="num" style="color:var(--danger)">− ${M.fmt(fee)}</b></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Rider fees</span>
        <b class="num" style="color:var(--danger)">− ${M.fmt(rider)}</b></div>
      <div class="rule" style="margin:10px 0"></div>
      <div class="between"><b>Your net</b><b class="num" style="font-size:20px;color:var(--success)">${M.fmt(net)}</b></div>
    </div>
    <p class="tiny muted" style="margin-top:12px">
      A delivery aggregator would take 20–30% of that gross. SAAHAA takes ${cat.takePct}%
      because a kirana's own margin on staples is only 3–6% — a bigger cut would cost you
      more than the item earns.</p>
    <div class="sec"><div class="hd"><h2 style="font-size:15px">Settled orders</h2></div>
      ${done.length ? done.slice(0, 20).map(o => `<div class="card" style="padding:11px;margin-bottom:7px">
        <div class="between"><span class="tiny">${esc(o.customerName)} · ${timeAgo(o.createdAt)}</span>
          <b class="num tiny">${M.fmt(o.shopPayout)}</b></div></div>`).join('')
        : '<p class="tiny muted">No settled orders yet.</p>'}</div>`;
}

function shopSetup(s) {
  const cat = get('category', s.catId);
  return `
    <div class="card">
      <b>${esc(s.name)}</b>
      <p class="tiny muted" style="margin-top:6px">${cat.ico} ${esc(cat.name)} · ${esc(s.area)} · ${esc(s.mobile)}</p>
      <div class="rule" style="margin:12px 0"></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Minimum order</span><b class="num">${M.fmt(s.minOrder)}</b></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Free delivery above</span><b class="num">${M.fmt(s.freeDeliveryAbove)}</b></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Prep time</span><b>${s.prepMins} min</b></div>
      <div class="between" style="margin-bottom:8px"><span class="tiny muted">Delivery radius</span><b>${s.radiusKm} km</b></div>
      ${s.fssai ? `<div class="between"><span class="tiny muted">FSSAI</span><b class="tiny">${esc(s.fssai)}</b></div>` : ''}
      ${s.drugLicence ? `<div class="between"><span class="tiny muted">Drug licence</span><b class="tiny">${esc(s.drugLicence)}</b></div>` : ''}
    </div>
    <div class="card" style="margin-top:12px">
      <b class="tiny">Delivery mode</b>
      <div class="chiprow" style="margin-top:10px">
        ${[['self','I deliver'],['rider','SAAHAA rider'],['both','Either'],['pickup_only','Pickup only']]
          .map(([k, l]) => `<button class="chip ${s.deliveryMode === k ? 'on' : ''}"
            data-act="shop.mode" data-mode="${k}">${l}</button>`).join('')}
      </div>
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
