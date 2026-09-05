/* SAAHAA · ui/views/orders.js — order list, live tracker, OTP, evidence,
   chat and the 3-tap dispute.

   OPEN CIRCLE · LIVING GLASS. One rule governs this screen: nobody should ever
   have to hunt for the status. The current stage is the hero — named, timed,
   and pinned above everything else — and the one thing you can do about it
   sits immediately under it as a single command card. Everything behind that
   (the bill, the messages, the history) folds away until asked for.

   The stage labels are the machine's own. They are never renamed here. */

import { esc, sheet, closeSheet, toast, clockTime, timeAgo } from '../dom.js';
import { ctx, getState, me, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage, canTransition, isTerminal } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { header, emptyBlock } from './shops.js';

const TONE_BADGE = { ok:'badge--ok', info:'badge--info', warn:'badge--warn', bad:'badge--bad', soft:'badge--soft' };
const TONE_PILL  = { ok:'pill--ok', info:'pill--info', warn:'pill--warn', bad:'pill--bad', soft:'pill--soft' };

export function renderList() {
  const list = myOrders();
  if (!me()) return `${header('Your orders', '')}<main class="wrap">
    ${emptyBlock('Sign in to see orders', 'Your bookings and deliveries live here.',
      '<button class="btn btn--primary" data-act="auth.open">Sign in</button>')}</main>`;
  if (!list.length) return `${header('Your orders', '')}<main class="wrap">
    ${emptyBlock('No orders yet', 'Your first pro is two taps away.',
      '<button class="btn btn--secondary" data-act="nav.home">Browse services</button>')}</main>`;

  const liveList = list.filter(o => !isTerminal(o.stage));
  const past = list.filter(o => isTerminal(o.stage));

  const row = o => {
    const st = stage(o.stage);
    const cat = get('category', o.catId);
    const track = trackerFor(o.kind); const idx = trackerIndex(o);
    const running = !isTerminal(o.stage);
    return `<button class="cmd${running ? ' glass glass--deep' : ''}"
        style="width:100%;text-align:left;margin:10px 0" data-act="order.open" data-id="${esc(o.id)}">
      <div class="between">
        <div class="grow">
          <div class="row" style="gap:8px;align-items:center">
            <span style="font-size:18px" aria-hidden="true">${cat.ico || '📦'}</span>
            ${running ? '<span class="pill pill--live">Live</span>' : ''}
            <span class="pill ${TONE_PILL[st.tone] || 'pill--soft'}">${esc(st.short)}</span>
          </div>
          <b class="cmd__title">${esc(o.kind === 'service' ? cat.name : o.shopName)}</b>
          <p class="cmd__sub">
            ${esc(o.kind === 'service' ? o.partnerName : `${o.lines.length} items`)} · ${timeAgo(o.createdAt)}
          </p>
        </div>
        <div style="text-align:right">
          <span class="badge ${TONE_BADGE[st.tone] || 'badge--soft'}">${esc(st.short)}</span>
          <b class="num" style="display:block;margin-top:6px">${M.fmt(o.customerPays)}</b>
        </div>
      </div>
      <div class="mini-track" aria-hidden="true">${
        track.map((_, i) => `<i class="${i < idx ? 'on' : i === idx ? 'on cur' : ''}"></i>`).join('')}</div>
    </button>`;
  };

  return `${header('Your orders', `${list.length} total`)}
  <main class="wrap">
    ${liveList.length ? `<div class="sec rise">
      <div class="hd"><h2 class="h-sec">Happening now</h2>
        <span class="meta">${liveList.length}</span></div>
      ${liveList.map(row).join('')}</div>` : ''}
    ${past.length ? `<div class="sec rise rise-2">
      <div class="hd"><h2 class="h-sec">${liveList.length ? 'Earlier' : 'All orders'}</h2>
        <span class="meta">${past.length}</span></div>
      ${past.map(row).join('')}</div>` : ''}
    <div style="height:40px"></div>
  </main>`;
}

/* ── the live timeline ─────────────────────────────────────────
   trackerFor() supplies the stages and their labels. This renders them and
   nothing else: no renaming, no collapsing, no inventing a step the machine
   does not have. */
function timeline(o, track, idx) {
  return `<ol class="timeline" aria-label="Progress">
    ${track.map((sg, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'cur' : 'pend';
      const hit = (o.history || []).find(h => h.stage === sg.id);
      return `<li class="timeline__node ${cls}"${i === idx ? ' aria-current="step"' : ''}>
        <span class="timeline__dot" aria-hidden="true">${i < idx ? '✓' : sg.ico || ''}</span>
        ${i < track.length - 1 ? '<span class="timeline__bar" aria-hidden="true"></span>' : ''}
        <span class="timeline__label"><b>${esc(sg.label)}</b>
          <span class="meta">${hit ? clockTime(hit.at) : i === idx ? 'now' : ''}</span></span>
      </li>`;
    }).join('')}
  </ol>`;
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
  const running = !isTerminal(o.stage);

  return `
  ${header(o.kind === 'service' ? cat.name : o.shopName, st.label)}
  <main class="wrap">

    <!-- STATUS IS THE HERO. Nothing above it, nothing competing with it. -->
    <div class="cmd glass glass--deep rise" style="margin-top:var(--sp-6)">
      <div class="row" style="gap:8px;align-items:center">
        ${running ? '<span class="pill pill--live">Live</span>' : ''}
        <span class="pill ${TONE_PILL[st.tone] || 'pill--soft'}">${esc(st.short)}</span>
        <span class="meta">Step ${idx + 1} of ${track.length}</span>
      </div>
      <b class="cmd__title h-display" style="display:block;margin-top:8px">${esc(st.label)}</b>
      <p class="cmd__sub">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}
        · ${o.km || 0} km · ${o.eta || 0} min away</p>
      <div class="capsules" style="margin-top:12px">
        <span class="capsule capsule--gold"><span class="capsule__k">You pay${o.provisional ? ' (est.)' : ''}</span>
          <span class="capsule__v num">${M.fmt(o.customerPays)}</span></span>
        <span class="capsule capsule--soft"><span class="capsule__k">Placed</span>
          <span class="capsule__v">${timeAgo(o.createdAt)}</span></span>
        ${o.otp && running && isCustomer ? `<span class="capsule capsule--info"><span class="capsule__k">Your code</span>
          <span class="capsule__v num">${esc(o.otp)}</span></span>` : ''}
      </div>
      ${o.saved ? `<p class="tiny" style="margin-top:12px;color:var(--accent)">
        ✦ You saved ${M.fmt(o.saved)} versus a commission app — and your pro was paid more.</p>` : ''}
    </div>

    <div class="ord-lay">
      <div class="ord-lay__track">
        <div class="sec rise rise-2"><div class="hd"><h2 class="h-sec">Progress</h2></div>
          ${timeline(o, track, idx)}
        </div>
      </div>

      <div class="ord-lay__side">
        ${actionPanel(o, { isCustomer, isPartner, isShop })}

        ${o.kind === 'service' ? `
          <div class="sec rise rise-3"><div class="hd"><h2 class="h-sec">Bill</h2></div>
            <details class="expand card" open>
              <summary class="between" style="cursor:pointer;list-style:none">
                <b>Total${o.provisional ? ' (est.)' : ''}</b>
                <b class="num" style="font-size:19px">${M.fmt(o.customerPays)}</b></summary>
              <div class="rule" style="margin:12px 0"></div>
              <div class="moneyflow">
                ${billRow(esc(cat.name) + ' · ' + esc(o.sub || cat.unit), o.deal, false, 'state--released')}
                ${billRow('Platform fee', o.platformFee, false, 'state--pending')}
                ${billRow('GST @18% on the fee', o.gst, false, 'state--pending')}
              </div>
              <div class="rule" style="margin:10px 0"></div>
              ${billRow('<b>You pay</b>', o.customerPays, true)}
              <p class="micro muted" style="margin-top:10px">
                ${esc(o.partnerName)} receives the full ${M.fmt(o.deal)}.
                SAAHAA never takes a cut of their quote.
              </p>
            </details>
          </div>` : `
          <div class="sec rise rise-3"><div class="hd"><h2 class="h-sec">Items</h2></div>
            <details class="expand card" open>
              <summary class="between" style="cursor:pointer;list-style:none">
                <b>${o.lines.length} item${o.lines.length === 1 ? '' : 's'}${o.provisional ? ' (est.)' : ''}</b>
                <b class="num" style="font-size:19px">${M.fmt(o.customerPays)}</b></summary>
              <div class="rule" style="margin:12px 0"></div>
              <div class="moneyflow">
                ${o.lines.map(l => billRow(`${esc(l.name)} × ${l.qty}${l.variableWeight ? ' (est.)' : ''}`,
                                           l.unitPrice * l.qty)).join('')}
                ${billRow('Delivery', o.deliveryFee, false, 'state--pending')}
              </div>
              <div class="rule" style="margin:10px 0"></div>
              ${billRow('<b>Total</b>', o.customerPays, true)}
            </details>
          </div>`}

        <div class="sec rise rise-4"><div class="hd"><h2 class="h-sec">Messages</h2>
          ${chats.length ? `<span class="meta">${chats.length}</span>` : ''}</div>
          <div class="card" style="max-height:230px;overflow-y:auto">
            ${chats.length ? chats.map(m => `<div style="margin-bottom:10px">
              <b class="tiny">${esc(m.name)}</b> <span class="micro muted">${clockTime(m.ts)}</span>
              <p class="tiny">${esc(m.text)}</p>
              ${m.flagged ? '<p class="micro" style="color:var(--warn)">Contact details hidden — keep payments in SAAHAA.</p>' : ''}
            </div>`).join('') : '<p class="tiny muted">No messages yet.</p>'}
          </div>
          ${/* sendChat returns early with no session, so the composer silently did
               nothing for a guest deep-linking an order. */
            (isCustomer || isPartner || isShop) ? `
          <div class="row" style="margin-top:10px">
            <input id="chatIn" class="grow" placeholder="Type a message"
              style="height:44px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);
                     background:var(--surface-2);color:var(--ink-1);font-size:15px">
            <button class="btn btn--secondary" data-act="chat.send" data-id="${o.id}">Send</button>
          </div>` : '<p class="micro muted" style="margin-top:10px">Sign in to reply.</p>'}
        </div>

        ${/* raiseDispute guards on canTransition, so at a stage with no DISPUTED
              exit it created the dispute record and toasted "your money is frozen"
              while leaving the order flowing — and admin's Resolve then failed on
              the illegal transition. Offer the button only where it can act, and
              only to someone with standing in the order. */
          (isCustomer || isPartner || isShop) && canTransition(o.stage, 'DISPUTED') ? `
        <button class="btn btn--ghost btn--block" style="margin-top:20px;color:var(--danger)"
          data-act="dispute.open" data-id="${o.id}">Report an issue</button>` : ''}
      </div>
    </div>
    <div style="height:40px"></div>
  </main>
  <style>
    .ord-lay{display:block}
    @media (min-width:1024px){
      .ord-lay{display:grid;grid-template-columns:minmax(280px,1fr) minmax(0,1.5fr);
        gap:var(--sp-6,18px);align-items:start}
      .ord-lay__track{position:sticky;top:12px}
      .ord-lay__side{min-width:0}
    }
  </style>`;
}

/* Money never mixes. Each row can carry its own escrow state chip so the
   customer's payment, the platform's fee and the pro's earnings are never
   read as one undifferentiated number. */
function billRow(label, paise, strong, state) {
  return `<div class="between" style="margin-bottom:8px">
    <span class="${strong ? '' : 'tiny muted'}">${label}${
      state && !strong ? ` <span class="${state}"></span>` : ''}</span>
    <b class="num" style="${strong ? 'font-size:19px' : 'font-size:14px'}">${M.fmt(paise || 0)}</b></div>`;
}

/* the one panel that changes with role + stage — everything derived, no switch
   on a hard-coded id list */
function actionPanel(o, r) {
  const s = o.stage;
  const B = (act, label, cls = 'btn--primary') =>
    `<button class="btn ${cls} btn--lg btn--block cmd__action" data-act="${act}" data-id="${o.id}">${label}</button>`;

  if (r.isPartner) {
    // MATCHING -> ASSIGNED used to happen ONLY inside a 900ms setTimeout in
    // bookService. A reload inside that window stranded the order forever with
    // no legal move but cancel. The pro can now accept it themselves.
    if (s === 'MATCHING')    return panel('New job for you', B('stage.accept', 'Accept this job'));
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
      ${(o.evidence || []).length
        // markDone refuses without evidence anyway; an enabled button that only
        // fails on tap teaches the pro nothing about why.
        ? B('stage.done', 'Mark work finished')
        : `<button class="btn btn--primary btn--lg btn--block" disabled
             style="opacity:.5;cursor:not-allowed">Add a photo first</button>`}`);
    if (s === 'WORK_DONE')   return panel('Waiting on the customer',
      `<p class="tiny muted">${o.escrowTier === 'HOLD' ? 'Under team review.' : 'Auto-releases if the customer does not respond.'}</p>`);
  }

  if (r.isCustomer) {
    if (s === 'ARRIVED') return panel('Give your pro this code', `
      <div style="text-align:center" class="num num-xl">${esc(o.otp)}</div>
      <p class="tiny muted" style="text-align:center;margin-top:8px">
        Only share it once they are at your door. It proves the right person arrived.</p>`);
    if (s === 'WORK_DONE') return panel('Work finished — confirm to release payment', `
      ${(o.evidence || []).length ? `<p class="tiny muted" style="margin-bottom:12px">
        ${(o.evidence || []).map(e => esc(e.label)).join(' · ')} photo attached</p>` : ''}
      <div class="capsules" style="margin-bottom:12px">
        <span class="capsule capsule--info"><span class="capsule__k">Held in escrow</span>
          <span class="capsule__v num">${M.fmt(o.deal)}</span>
          <span class="capsule__d state--held">not yet released</span></span>
      </div>
      ${B('release.full', `Confirm & release ${M.fmt(o.deal)}`)}
      <button class="btn btn--ghost btn--block" style="margin-top:8px;color:var(--danger)"
        data-act="dispute.open" data-id="${o.id}">Something was wrong</button>`);
    /* Every service order dead-ended at SETTLED: nothing in the app targeted
       RATED, so partner/rate and review/add were never dispatched, trust
       scores could never move on real work, and the admin's review moderation
       list was permanently empty. This panel is the missing terminal step. */
    if ((s === 'SETTLED' || s === 'PARTIAL') && !o.rated) return panel('How did it go?', `
      <p class="tiny muted" style="margin-bottom:12px">Your rating is what decides who gets recommended next.</p>
      <div class="row" style="gap:8px;justify-content:center">
        ${[1,2,3,4,5].map(n => `<button class="btn btn--ghost" style="font-size:24px;padding:6px 10px"
          data-act="rate.submit" data-id="${o.id}" data-stars="${n}" aria-label="${n} stars">★</button>`).join('')}
      </div>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:10px"
        data-act="rate.skip" data-id="${o.id}">Skip</button>`);
    if (s === 'R_DELIVERED') return panel('Delivered — confirm', B('retail.settle', 'Confirm delivery'));
    if (['MATCHING','ASSIGNED','EN_ROUTE'].includes(s))
      return panel('Need to cancel?', `<button class="btn btn--ghost btn--block" style="color:var(--danger)"
        data-act="cancel.open" data-id="${o.id}">Cancel this booking</button>`);
  }

  if (r.isShop) {
    // Same stranding bug as MATCHING: R_PLACED -> R_ACCEPTED only ever
    // happened in a 1100ms timer, and the shop console promises an accept step
    // that did not exist.
    if (s === 'R_PLACED')   return panel('New order', B('stage.accept', 'Accept order'));
    if (s === 'R_ACCEPTED') return panel('Pack this order', B('stage.picking', 'Start packing'));
    if (s === 'R_PICKING')  return panel('Weigh and pack', B('stage.packed', 'Weighed & packed'));
    if (s === 'R_PACKED')   return panel('Hand over', B('stage.out', 'Out for delivery'));
    if (s === 'R_OUT')      return panel('Delivery code',
      `<div style="text-align:center" class="num num-xl">${esc(o.otp)}</div>${B('stage.delivered', 'Mark delivered')}`);
  }
  return '';
}
const panel = (title, body) => `<div class="sec rise rise-2"><div class="cmd glass glass--gold">
  <p class="eyebrow">What happens next</p>
  <b class="cmd__title" style="display:block;margin-bottom:12px">${esc(title)}</b>${body}</div></div>`;

/* ── dispute: 3 taps ───────────────────────────────────────── */
export function openDispute(orderId) {
  sheet('Report an issue', `
    <p class="meta" style="margin-bottom:14px">Pick what went wrong. Your money freezes immediately.</p>
    <div class="capsules" style="margin-bottom:14px">
      <span class="capsule capsule--warn"><span class="capsule__k">Your money</span>
        <span class="capsule__v state--held">frozen on tap</span></span>
    </div>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${flow.DISPUTE_REASONS.map(r => `<button class="chip chip--smart" data-act="dispute.pick"
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
