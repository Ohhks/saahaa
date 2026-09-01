/* SAAHAA · ui/views/orders.js — order list, live tracker, OTP, evidence,
   chat and the 3-tap dispute. */

import { esc, sheet, closeSheet, toast, clockTime, timeAgo } from '../dom.js';
import { ctx, getState, me, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { header, emptyBlock } from './shops.js';

const TONE_BADGE = { ok:'badge--ok', info:'badge--info', warn:'badge--warn', bad:'badge--bad', soft:'badge--soft' };

export function renderList() {
  const list = myOrders();
  if (!me()) return `${header('Your orders', '')}<main class="wrap">
    ${emptyBlock('Sign in to see orders', 'Your bookings and deliveries live here.',
      '<button class="btn btn--primary" data-act="auth.open">Sign in</button>')}</main>`;
  if (!list.length) return `${header('Your orders', '')}<main class="wrap">
    ${emptyBlock('No orders yet', 'Your first pro is two taps away.',
      '<button class="btn btn--secondary" data-act="nav.home">Browse services</button>')}</main>`;

  return `${header('Your orders', `${list.length} total`)}
  <main class="wrap">
    ${list.map(o => {
      const st = stage(o.stage);
      const cat = get('category', o.catId);
      const track = trackerFor(o.kind); const idx = trackerIndex(o);
      return `<button class="card card--tap" style="width:100%;text-align:left;margin:10px 0"
          data-act="order.open" data-id="${o.id}">
        <div class="between">
          <div class="grow">
            <div class="row" style="gap:8px">
              <span style="font-size:18px">${cat.ico || '📦'}</span>
              <b>${esc(o.kind === 'service' ? cat.name : o.shopName)}</b>
            </div>
            <p class="tiny muted" style="margin-top:4px">
              ${esc(o.kind === 'service' ? o.partnerName : `${o.lines.length} items`)} · ${timeAgo(o.createdAt)}
            </p>
          </div>
          <div style="text-align:right">
            <span class="badge ${TONE_BADGE[st.tone] || 'badge--soft'}">${esc(st.short)}</span>
            <b class="num" style="display:block;margin-top:6px">${M.fmt(o.customerPays)}</b>
          </div>
        </div>
        <div class="mini-track">${track.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>
      </button>`;
    }).join('')}
    <div style="height:40px"></div>
  </main>`;
}

export function renderDetail(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return renderList();
  const cat = get('category', o.catId);
  const st = stage(o.stage);
  const track = trackerFor(o.kind);
  const idx = trackerIndex(o);
  const s = me();
  const isCustomer = s && o.customerKey === s.key;
  const isPartner = s && s.role === 'partner' && getState().partners.some(p => p.userKey === s.key && p.id === o.partnerId);
  const isShop = s && s.role === 'shop' && getState().shops.some(x => x.ownerKey === s.key && x.id === o.shopId);
  const chats = getState().chats[o.id] || [];

  return `
  ${header(o.kind === 'service' ? cat.name : o.shopName, st.label)}
  <main class="wrap">

    <div class="card on-plum" style="margin-top:var(--sp-6);border:0">
      <div class="between">
        <div><span class="tiny muted">${o.kind === 'service' ? 'Your pro' : 'Shop'}</span>
          <b style="display:block;font-size:17px">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}</b>
          <p class="tiny muted" style="margin-top:2px">${o.km || 0} km · ${o.eta || 0} min away</p></div>
        <div style="text-align:right"><span class="tiny muted">Total${o.provisional ? ' (est.)' : ''}</span>
          <b class="num" style="display:block;font-size:22px">${M.fmt(o.customerPays)}</b></div>
      </div>
      ${o.saved ? `<p class="tiny" style="margin-top:10px;color:var(--accent)">
        ✦ You saved ${M.fmt(o.saved)} versus a commission app — and your pro was paid more.</p>` : ''}
    </div>

    <div class="sec"><div class="hd"><h2>Progress</h2></div>
      <ol class="track">
        ${track.map((sg, i) => {
          const cls = i < idx ? 'done' : i === idx ? 'cur' : 'pend';
          const hit = (o.history || []).find(h => h.stage === sg.id);
          return `<li class="${cls}">
            <span class="node"><span class="dot">${i < idx ? '✓' : ''}</span>
              ${i < track.length - 1 ? '<span class="bar"></span>' : ''}</span>
            <span class="body"><b>${esc(sg.label)}</b>
              <span>${hit ? clockTime(hit.at) : ''}</span></span>
          </li>`;
        }).join('')}
      </ol>
    </div>

    ${actionPanel(o, { isCustomer, isPartner, isShop })}

    ${o.kind === 'service' ? `
      <div class="sec"><div class="hd"><h2>Bill</h2></div>
        <div class="card">
          ${billRow(cat.name + ' · ' + (o.sub || cat.unit), o.deal)}
          ${billRow('Platform fee', o.platformFee)}
          ${billRow('GST @18% on the fee', o.gst)}
          <div class="rule" style="margin:10px 0"></div>
          ${billRow('<b>You pay</b>', o.customerPays, true)}
          <p class="micro muted" style="margin-top:10px">
            ${esc(o.partnerName)} receives the full ${M.fmt(o.deal)}. SAAHAA never takes a cut of their quote.
          </p>
        </div>
      </div>` : `
      <div class="sec"><div class="hd"><h2>Items</h2></div>
        <div class="card">
          ${o.lines.map(l => billRow(`${esc(l.name)} × ${l.qty}${l.variableWeight ? ' (est.)' : ''}`,
                                     l.unitPrice * l.qty)).join('')}
          ${billRow('Delivery', o.deliveryFee)}
          <div class="rule" style="margin:10px 0"></div>
          ${billRow('<b>Total</b>', o.customerPays, true)}
        </div>
      </div>`}

    <div class="sec"><div class="hd"><h2>Messages</h2></div>
      <div class="card" style="max-height:230px;overflow-y:auto">
        ${chats.length ? chats.map(m => `<div style="margin-bottom:10px">
          <b class="tiny">${esc(m.name)}</b> <span class="micro muted">${clockTime(m.ts)}</span>
          <p class="tiny">${esc(m.text)}</p>
          ${m.flagged ? '<p class="micro" style="color:var(--warn)">Contact details hidden — keep payments in SAAHAA.</p>' : ''}
        </div>`).join('') : '<p class="tiny muted">No messages yet.</p>'}
      </div>
      <div class="row" style="margin-top:10px">
        <input id="chatIn" class="grow" placeholder="Type a message"
          style="height:44px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);
                 background:var(--surface-2);color:var(--ink-1);font-size:15px">
        <button class="btn btn--secondary" data-act="chat.send" data-id="${o.id}">Send</button>
      </div>
    </div>

    <button class="btn btn--ghost btn--block" style="margin-top:20px;color:var(--danger)"
      data-act="dispute.open" data-id="${o.id}">Report an issue</button>
    <div style="height:40px"></div>
  </main>`;
}

function billRow(label, paise, strong) {
  return `<div class="between" style="margin-bottom:8px">
    <span class="${strong ? '' : 'tiny muted'}">${label}</span>
    <b class="num" style="${strong ? 'font-size:19px' : 'font-size:14px'}">${M.fmt(paise || 0)}</b></div>`;
}

/* the one panel that changes with role + stage — everything derived, no switch
   on a hard-coded id list */
function actionPanel(o, r) {
  const s = o.stage;
  const B = (act, label, cls = 'btn--primary') =>
    `<button class="btn ${cls} btn--lg btn--block" data-act="${act}" data-id="${o.id}">${label}</button>`;

  if (r.isPartner) {
    if (s === 'ASSIGNED')    return panel('Head to the customer', B('stage.enroute', 'Start travelling'));
    if (s === 'EN_ROUTE')    return panel('Arrived?', B('stage.arrived', "I've arrived"));
    if (s === 'ARRIVED')     return panel('Ask the customer for their 4-digit code', `
      <div class="otp-row" style="justify-content:center;margin-bottom:14px">
        ${[0,1,2,3].map(i => `<input id="otp${i}" inputmode="numeric" maxlength="1" data-role="otp">`).join('')}
      </div>${B('otp.submit', 'Verify & start work')}`);
    if (s === 'IN_PROGRESS') return panel('Photo evidence is required before payout', `
      <div class="row" style="gap:8px;margin-bottom:12px">
        <button class="btn btn--secondary grow" data-act="ev.add" data-id="${o.id}" data-label="Before">📷 Before</button>
        <button class="btn btn--secondary grow" data-act="ev.add" data-id="${o.id}" data-label="After">📷 After</button>
      </div>
      <p class="tiny muted" style="margin-bottom:12px">${(o.evidence || []).length} photo(s) attached</p>
      ${B('stage.done', 'Mark work finished')}`);
    if (s === 'WORK_DONE')   return panel('Waiting on the customer',
      `<p class="tiny muted">${o.escrowTier === 'HOLD' ? 'Under team review.' : 'Auto-releases if the customer does not respond.'}</p>`);
  }

  if (r.isCustomer) {
    if (s === 'ARRIVED') return panel('Give your pro this code', `
      <div style="text-align:center;font-size:42px;font-weight:800;letter-spacing:.18em"
        class="num">${esc(o.otp)}</div>
      <p class="tiny muted" style="text-align:center;margin-top:8px">
        Only share it once they are at your door. It proves the right person arrived.</p>`);
    if (s === 'WORK_DONE') return panel('Work finished — confirm to release payment', `
      ${(o.evidence || []).length ? `<p class="tiny muted" style="margin-bottom:12px">
        ${(o.evidence || []).map(e => esc(e.label)).join(' · ')} photo attached</p>` : ''}
      ${B('release.full', `Confirm & release ${M.fmt(o.deal)}`)}
      <button class="btn btn--ghost btn--block" style="margin-top:8px;color:var(--danger)"
        data-act="dispute.open" data-id="${o.id}">Something was wrong</button>`);
    if (s === 'R_DELIVERED') return panel('Delivered — confirm', B('retail.settle', 'Confirm delivery'));
    if (['MATCHING','ASSIGNED','EN_ROUTE'].includes(s))
      return panel('Need to cancel?', `<button class="btn btn--ghost btn--block" style="color:var(--danger)"
        data-act="cancel.open" data-id="${o.id}">Cancel this booking</button>`);
  }

  if (r.isShop) {
    if (s === 'R_ACCEPTED') return panel('Pack this order', B('stage.picking', 'Start packing'));
    if (s === 'R_PICKING')  return panel('Weigh and pack', B('stage.packed', 'Weighed & packed'));
    if (s === 'R_PACKED')   return panel('Hand over', B('stage.out', 'Out for delivery'));
    if (s === 'R_OUT')      return panel('Delivery code', `<div style="text-align:center;font-size:34px;
      font-weight:800;letter-spacing:.18em" class="num">${esc(o.otp)}</div>${B('stage.delivered', 'Mark delivered')}`);
  }
  return '';
}
const panel = (title, body) => `<div class="sec"><div class="card card--gold">
  <b style="display:block;margin-bottom:12px">${esc(title)}</b>${body}</div></div>`;

/* ── dispute: 3 taps ───────────────────────────────────────── */
export function openDispute(orderId) {
  sheet('Report an issue', `
    <p class="tiny muted" style="margin-bottom:14px">Pick what went wrong. Your money freezes immediately.</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${flow.DISPUTE_REASONS.map(r => `<button class="chip" data-act="dispute.pick"
        data-id="${orderId}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <p class="micro muted" style="margin-top:16px">
      Most issues are settled within 24 hours. If your pro never arrived and no start code was
      entered, you are refunded in full automatically.</p>`);
}
export function submitDispute(orderId, reason) {
  flow.raiseDispute(orderId, reason, '');
  closeSheet();
  ctx.render();
}

export function openCancel(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const rule = o.stage === 'MATCHING' ? 'BEFORE_ACCEPT' : o.stage === 'EN_ROUTE' ? 'EN_ROUTE' : 'AFTER_ACCEPT_2H';
  const split = flow.money ? null : null;
  sheet('Cancel booking?', `
    <p>${rule === 'BEFORE_ACCEPT' ? 'No pro has accepted yet — you get a full refund.'
        : rule === 'EN_ROUTE' ? 'Your pro is already travelling. They keep a small travel compensation.'
        : 'More than 2 hours before the slot — full refund.'}</p>
    <button class="btn btn--danger btn--block" style="margin-top:16px"
      data-act="cancel.confirm" data-id="${orderId}" data-rule="${rule}">Yes, cancel</button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="sheet.close">Keep it</button>`);
}
