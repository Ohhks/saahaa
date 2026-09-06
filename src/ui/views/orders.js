/* SAAHAA · ui/views/orders.js — order list, live tracker, OTP, evidence,
   chat and the 3-tap dispute.

   OPEN CIRCLE · LIVING GLASS. One rule governs this screen: nobody should ever
   have to hunt for the status. The current stage is the hero — named, timed,
   and pinned above everything else — and the one thing you can do about it
   sits immediately under it as a single command card. Everything behind that
   (the bill, the messages, the history) folds away until asked for.

   The stage labels are the machine's own. They are never renamed here. */

import { mount, esc, sheet, closeSheet, toast, clockTime, timeAgo } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage, canTransition, isTerminal } from '../../domain/orders.js';
import { kmBetween, etaMins, geoOf, nameOf } from '../../domain/match.js';
import * as gmap from '../map.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { header, emptyBlock } from './shops.js';

/* ══════════════ THE MAP ON A LIVE ORDER ════════════════════════
   "3 km away" is a number. A customer waiting at their door wants to know
   WHERE — and a pro on the way wants to see the same picture, so neither of
   them is describing a landmark down a phone line.

   Customer gold, pro violet, shop teal — the same three colours the rest of
   the product uses for those three people. The line between them is dashed
   because it is a distance, not a route: we do not have turn-by-turn and we
   will not draw a road we cannot promise. */
const PIN = { customer: '#E0B558', partner: '#7C3AED', shop: '#14B8A6' };
let openMapId = null;                 // which order has its map card open
const maps = new Map();               // element id → { el, h }

export function toggleMap(id) {
  openMapId = openMapId === id ? null : id;
  ctx.render();
}

/* the two ends of the order, in coordinates where we have them and in names
   where we do not — kmBetween() understands both */
function endsOf(o) {
  const st = getState();
  const cust = o.customerLoc ||
    ((st.users.find(u => u.key === o.customerKey) || {}).loc) ||
    o.customerArea || myArea();
  if (o.kind === 'service') {
    // re-read the partner on every render: this is what makes the pin move
    const p = st.partners.find(x => x.id === o.partnerId) || {};
    return { cust, them: p.loc || p.area || o.partnerArea, colour: PIN.partner,
             name: o.partnerName || p.name || 'Your pro', role: 'Pro' };
  }
  const sh = st.shops.find(x => x.id === o.shopId) || {};
  return { cust, them: sh.loc || sh.area || o.shopArea, colour: PIN.shop,
           name: o.shopName || sh.name || 'The shop', role: 'Shop' };
}

function mapCard(o, { interactive = true, id = 'orderMap' } = {}) {
  const e = endsOf(o);
  const km = kmBetween(e.cust, e.them);
  const eta = etaMins(km);
  const plotted = !!(geoOf(e.cust) && geoOf(e.them));
  return `<div class="card glass" style="padding:12px;margin-top:12px">
    <div class="between" style="margin-bottom:8px">
      <span class="eyebrow">On the map</span>
      <span class="meta">${km} km apart · ~${eta} min</span>
    </div>
    <div id="${id}" style="height:220px;border-radius:var(--r-md);overflow:hidden;
      border:1px solid var(--border);background:var(--surface-2)"></div>
    <div class="row" style="gap:12px;margin-top:8px;flex-wrap:wrap">
      <span class="micro muted"><b style="color:${PIN.customer}">●</b> You · ${esc(nameOf(e.cust))}</span>
      <span class="micro muted"><b style="color:${e.colour}">●</b> ${esc(e.role)} · ${esc(nameOf(e.them))}</span>
    </div>
    ${plotted ? '' : `<p class="micro muted" style="margin-top:6px">
      One of these is an area name with no coordinates yet, so the distance is an estimate.</p>`}
  </div>`;
}

/* One mounter for both maps on the screen — the customer's card and the pro's
   job panel — keyed by element, so a re-render reuses the map it already has
   instead of tearing down and rebuilding a tile layer. */
async function mountMap(orderId, id, interactive) {
  const first = document.getElementById(id);
  if (!first) { kill(id); return; }
  try { await gmap.ready(); }
  catch (e) {
    mount(first, '<p class="micro muted" style="padding:12px">Map unavailable right now.</p>');
    return;
  }
  const el = document.getElementById(id);
  if (!el) { kill(id); return; }
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) { kill(id); return; }
  const e = endsOf(o);
  const A = geoOf(e.cust), B = geoOf(e.them);
  if (!A && !B) { mount(el, '<p class="micro muted" style="padding:12px">No coordinates on this order yet.</p>'); return; }

  let rec = maps.get(id);
  if (!rec || rec.el !== el) {
    kill(id);
    const c = A || B;
    rec = { el, h: gmap.mapInto(el, { center: [c.lat, c.lng], zoom: 13, interactive }) };
    if (!rec.h) return;
    maps.set(id, rec);
  }
  const h = rec.h;
  h.clear();
  const pts = [];
  if (A) { h.pin(A.lat, A.lng, { color: PIN.customer, label: 'You', glyph: 'Y' }); pts.push([A.lat, A.lng]); }
  if (B) { h.pin(B.lat, B.lng, { color: e.colour, label: e.name, glyph: e.role[0] }); pts.push([B.lat, B.lng]); }
  if (pts.length === 2) h.line(pts, { color: e.colour, dashed: true });
  h.fit(pts, 46);
  h.invalidate();
}
function kill(id) {
  const rec = maps.get(id);
  if (rec && rec.h) rec.h.destroy();
  maps.delete(id);
}
/* a map whose element left the document is a leaked tile layer */
function sweepMaps() {
  for (const [id, rec] of [...maps]) if (!document.body.contains(rec.el)) kill(id);
}

const TONE_BADGE = { ok:'badge--ok', info:'badge--info', warn:'badge--warn', bad:'badge--bad', soft:'badge--soft' };
const TONE_PILL  = { ok:'pill--ok', info:'pill--info', warn:'pill--warn', bad:'pill--bad', soft:'pill--soft' };

export function renderList() {
  sweepMaps();
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
            <span aria-hidden="true" style="display:inline-flex">${hasIcon(cat.id) ? icon(cat.id, { size: 18 }) : icon('box', { size: 18 })}</span>
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
        <span class="timeline__dot" aria-hidden="true">${i < idx ? '✓' : i + 1}</span>
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
  const ends = endsOf(o);
  /* the stored o.km was measured once, from area names, at booking time.
     Coordinates are better and they are current. */
  const km = kmBetween(ends.cust, ends.them);
  const showMap = openMapId === o.id;

  sweepMaps();
  setTimeout(() => {
    if (showMap) mountMap(o.id, 'orderMap', true); else kill('orderMap');
    if (document.getElementById('jobMap')) mountMap(o.id, 'jobMap', false); else kill('jobMap');
  }, 0);

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
        · ${km} km · ${o.eta || etaMins(km)} min away</p>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn btn--secondary btn--sm" data-act="order.map" data-id="${esc(o.id)}"
          aria-pressed="${showMap}">${icon('pin', { size: 14 })} ${showMap ? 'Hide map' : 'Map'}</button>
      </div>
      ${showMap ? mapCard(o) : ''}
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
    /* The pro is travelling to a place, not to a word. The same map the
       customer is looking at, without the controls — a job card is not a place
       to go exploring. */
    if (s === 'EN_ROUTE')    return panel('Arrived?',
      `${mapCard(o, { interactive: false, id: 'jobMap' })}
       <div style="height:12px"></div>${B('stage.arrived', "I've arrived")}`);
    if (s === 'ARRIVED')     return panel('Ask the customer for their 4-digit code', `
      ${mapCard(o, { interactive: false, id: 'jobMap' })}
      <div style="height:12px"></div>
      <div class="otp-row" style="justify-content:center;margin-bottom:14px">
        ${[0,1,2,3].map(i => `<input id="otp${i}" inputmode="numeric" maxlength="1" data-role="otp">`).join('')}
      </div>${B('otp.submit', 'Verify & start work')}`);
    if (s === 'IN_PROGRESS') return panel('Photo evidence is required before payout', `
      ${o.stake ? `<p class="tiny" style="margin-bottom:10px"><span class="state state--held">${M.fmt(o.stake.need)} locked</span>
        <span class="muted">from your wallet for this job${o.stake.onCredit ? ` (${M.fmt(o.stake.onCredit)} on credit against this payout)` : ''} — it comes back in full when the customer confirms.</span></p>` : ''}
      <div class="row" style="gap:8px;margin-bottom:12px">
        <button class="btn btn--secondary grow" data-act="ev.add" data-id="${o.id}" data-label="Before">${icon('camera', { size: 16 })} Before</button>
        <button class="btn btn--secondary grow" data-act="ev.add" data-id="${o.id}" data-label="After">${icon('camera', { size: 16 })} After</button>
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
    if (s === 'R_DELIVERED') return panel('Delivered — confirm', `${B('retail.settle', 'Confirm delivery')}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--danger)"
        data-act="retail.return" data-id="${o.id}">Something was wrong — return this order</button>`);
    if (s === 'R_PICKUP_READY') return panel('Ready at the shop — collect it', `
      <p class="tiny muted" style="margin-bottom:10px">Show this code at the counter.</p>
      <div style="text-align:center" class="num num-xl">${esc(o.otp)}</div>
      ${B('retail.collected', 'I have collected it')}`);
    if (s === 'R_SUB_PENDING') return panel('The shop needs your call', `
      ${(o.lines || []).filter(l => l.status === 'asking').map(l => `<div class="card glass" style="padding:12px;margin-bottom:8px">
        <b class="tiny">${esc(l.name)}</b><p class="micro muted">${esc(l.qty)} × ${M.fmt(l.unitPrice)} · not in stock right now</p>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn btn--secondary btn--sm grow" data-act="retail.sub" data-id="${o.id}" data-line="${l.lineId}" data-choice="similar">Similar brand is fine</button>
          <button class="btn btn--ghost btn--sm grow" data-act="retail.sub" data-id="${o.id}" data-line="${l.lineId}" data-choice="refund">Just refund it</button>
        </div></div>`).join('')}
      <p class="micro muted">No reply in 90 seconds means that item is refunded automatically.</p>`);
    if (s === 'R_RETURN') return panel('Return requested', '<p class="tiny muted">The shop or SAAHAA confirms the return; your money comes back in full.</p>');
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
    if (s === 'R_PICKING')  return panel('Weigh and pack', `
      ${(o.lines || []).map(l => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--hairline)">
        <span class="tiny">${esc(l.name)} <span class="micro muted">× ${esc(l.qty)}</span>
          ${l.status === 'unavailable' ? '<span class="pill pill--bad">Refunded</span>' : l.status === 'substituted' ? '<span class="pill pill--info">Similar</span>' : ''}</span>
        ${['unavailable', 'substituted'].includes(l.status) ? '' : `<button class="btn btn--ghost btn--sm" data-act="retail.out"
          data-id="${o.id}" data-line="${l.lineId}">Not in stock</button>`}</div>`).join('')}
      <div style="height:10px"></div>${B('stage.packed', 'Weighed & packed')}`);
    if (s === 'R_SUB_PENDING') return panel('Waiting for the customer', '<p class="tiny muted">They are choosing a substitute or a refund. No reply in 90 seconds means a refund for that item.</p>');
    if (s === 'R_PACKED')   return o.mode === 'pickup'
      ? panel('Packed — customer collects', B('retail.ready', 'Ready for pickup'))
      : panel('Hand over', B('stage.out', 'Out for delivery'));
    if (s === 'R_PICKUP_READY') return panel('Waiting at the counter', `<p class="tiny muted">Ask for the code <b class="num">${esc(o.otp)}</b> when they collect.</p>`);
    if (s === 'R_RETURN') return panel('Return requested', `<p class="tiny muted" style="margin-bottom:10px">${esc(o.returnReason || '')}</p>${B('retail.acceptreturn', 'Accept return — refund in full')}`);
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
