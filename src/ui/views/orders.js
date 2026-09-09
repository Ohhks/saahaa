/* SAAHAA · ui/views/orders.js — order list, live tracker, door code, evidence,
   chat and the 3-tap dispute.

   MODERNIST. The mockup's 1c "Order tracking": the order number and shop
   line in the header, the map, the person-on-the-way line, the stepped
   timeline with times, and the items / delivery / total block. The service
   order carries the same hierarchy; the ratings panel is 1d "Ratings &
   reviews". One rule governs this screen: nobody should ever have to hunt for
   the status, and the one thing you can do about it sits right under it.

   The stage labels are the machine's own. They are never renamed here. Every
   rupee is the order's: deal, platformFee, gst, deliveryFee, customerPays.

   The evidence block is the trust rule made visible: a real photograph, taken
   on the job, shown to whoever is holding the phone. See THE PHOTOGRAPH THAT
   RELEASES THE MONEY, below. */

import { mount, esc, sheet, closeSheet, toast, clockTime, timeAgo, delegate } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage, canTransition, isTerminal } from '../../domain/orders.js';
import { kmBetween, etaMins, geoOf, nameOf } from '../../domain/match.js';
import * as gmap from '../map.js';
import * as photo from '../photo.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import * as W from '../../domain/wallet.js';
import * as gateway from '../../core/gateway.js';
import { getPricing } from '../../domain/settings.js';
import { cancelSplit } from '../../domain/pricing.js';
import { markupFor, ESCROW } from '../../domain/trust.js';
import { t } from '../i18n.js';
import { header, emptyBlock, SYS_CSS } from './shops.js';

/* How the order was paid. EVERYONE PAYS SAAHAA: the wallet is drawn first
   and only the shortfall is collected through the gateway. Orders written
   before 7.0 carry neither field — they were collected in one go. */
function paidWith(o) {
  if (o.paidFromWallet == null && o.collected == null) return 'Paid via UPI';
  const parts = [];
  if (o.paidFromWallet > 0) parts.push(`${M.fmt(o.paidFromWallet)} from wallet`);
  if (o.collected > 0) parts.push(`${M.fmt(o.collected)} via ${gateway.label().split(' — ')[0]}`);
  return parts.length ? parts.join(' · ') : 'Nothing collected yet';
}

/* Sending a message re-renders the whole screen, so `dom.mount`'s focus
   restore cannot help: the element that had focus was the SEND button, not
   the composer, and the composer therefore came back blurred — one message
   per keyboard-open. This puts the caret back where the typist left it.
   Nothing about the action changes; app.js still owns `chat.send`. */
delegate('click', '[data-act="chat.send"]', () => {
  setTimeout(() => {
    const el = document.getElementById('chatIn');
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, 0);
});

/* a short, readable order number: the tail of the engine's id */
const orderNo = o => '#' + String(o.id || '').replace(/^ord[_-]?/i, '').slice(-6).toUpperCase();

/* ══════════════ THE MAP ON A LIVE ORDER ════════════════════════
   "3 km away" is a number. A customer waiting at their door wants to know
   WHERE — and a pro on the way wants to see the same picture. Customer in
   the accent, the other side in ink. The line between them is dashed because
   it is a distance, not a route. */
const PIN = { customer: '#ec3013', partner: '#201e1d', shop: '#201e1d' };
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

/* the live distance between the two ends — coordinates where the order has
   them, area names where it does not */
const kmOf = o => { const e = endsOf(o); return kmBetween(e.cust, e.them); };

function mapCard(o, { interactive = true, id = 'orderMap' } = {}) {
  const e = endsOf(o);
  const km = kmBetween(e.cust, e.them);
  const eta = etaMins(km);
  const plotted = !!(geoOf(e.cust) && geoOf(e.them));
  /* "You" is whoever is holding the phone. On the pro's job panel the accent
     badge is the customer they are travelling to, not the pro. */
  const s = me();
  const mine = !!(s && s.role !== 'customer' && o.customerKey !== s.key);
  const theirs = mine ? `${esc(o.customerName || 'Customer')} · ${esc(nameOf(e.cust))}` : `${esc(e.name)} · ${km} km · ~${eta} min`;
  const yours  = mine ? `You · ${esc(nameOf(e.them))} · ${km} km` : `You · ${esc(nameOf(e.cust))}`;
  return `<div style="${interactive ? 'margin:0 calc(-1 * var(--gutter));' : ''}border-bottom:2px solid var(--color-text);position:relative">
    <div id="${id}" style="height:${interactive ? 200 : 160}px;overflow:hidden;background:var(--surface-2)"></div>
    <span style="position:absolute;left:12px;bottom:10px;background:var(--surface);border:2px solid var(--color-text);padding:5px 9px;font:800 10px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase">${theirs}</span>
    <span style="position:absolute;right:12px;top:10px;background:var(--color-accent);color:#fff;padding:5px 9px;font:800 10px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase">${yours}</span>
    ${plotted ? '' : `<p class="micro muted" style="padding:6px var(--gutter)">One of these is an area name with no coordinates yet, so the distance is an estimate.</p>`}
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
  if (pts.length === 2) h.line(pts, { color: PIN.customer, dashed: true });
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

const TONE_TAG = { ok:'tag-neutral', info:'tag-neutral', warn:'tag-accent-2', bad:'tag-accent', soft:'' };

/* ── the list ──────────────────────────────────────────────── */
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

  const row = (o, live) => {
    const st = stage(o.stage);
    const cat = get('category', o.catId);
    const track = trackerFor(o.kind); const idx = trackerIndex(o);
    const title = o.kind === 'service' ? `${cat.name}${o.sub ? ' · ' + o.sub : ''}` : `${o.lines.length} item${o.lines.length === 1 ? '' : 's'} from ${o.shopName}`;
    const who = o.kind === 'service' ? o.partnerName : o.shopName;
    return `<button class="m-row" data-act="order.open" data-id="${esc(o.id)}">
      <span class="m-lead${live ? '' : ' m-lead--dim'}" aria-hidden="true"></span>
      <div class="grow" style="min-width:0">
        <div class="m-row__t">${esc(title)}</div>
        <div class="m-row__m">${esc(who)} · ${esc(stageLabel(st).toLowerCase())}${live ? ` · step ${idx + 1} of ${track.length}` : ''} · ${timeAgo(o.createdAt)}</div>
        <div class="m-row__tags">
          <span class="tag ${TONE_TAG[st.tone] || ''}">${esc(st.short)}</span>
          <span class="tag" style="background:transparent;border-color:var(--color-divider)">${orderNo(o)}</span>
        </div>
      </div>
      <div class="m-row__r"><b class="num">${M.fmt(o.customerPays)}</b></div>
      <span class="m-row__go" aria-hidden="true">→</span>
    </button>`;
  };

  return `${header('Your orders', `${list.length} total`)}
  <main class="wrap">
    ${liveList.length ? `<div class="sec rise">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">Happening now</p>
        <span class="meta">${liveList.length}</span></div>
      ${liveList.map(o => row(o, true)).join('')}</div>` : ''}
    ${past.length ? `<div class="sec rise rise-2">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">${liveList.length ? 'Earlier' : 'All orders'}</p>
        <span class="meta">${past.length}</span></div>
      ${past.map(o => row(o, false)).join('')}</div>` : ''}
    <div style="height:40px"></div>
  </main>${SYS_CSS}`;
}

/* ── the live timeline ─────────────────────────────────────────
   trackerFor() supplies the stages and their labels. This renders them and
   nothing else: no renaming, no collapsing, no inventing a step the machine
   does not have. Done and current are filled squares; pending is an outline. */
function timeline(o, track, idx) {
  const who = o.kind === 'service' ? o.partnerName : o.shopName;
  return `<ol class="m-steps" aria-label="Progress">
    ${track.map((sg, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'cur' : 'pend';
      const hit = (o.history || []).find(h => h.stage === sg.id);
      const when = hit ? clockTime(hit.at) : i === idx ? 'now' : '';
      const detail = i === 0 && who ? who : sg.owner === 'customer' ? 'yours to do' : sg.owner === 'system' ? 'SAAHAA' : '';
      return `<li class="m-step ${cls}"${i === idx ? ' aria-current="step"' : ''}>
        <span class="m-step__dot" aria-hidden="true"></span>
        <span class="grow"><span class="m-step__t" style="display:block">${esc(sg.label)}</span>
          <span class="m-step__m">${[when, detail].filter(Boolean).map(esc).join(' · ')}</span></span>
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
  /* Whoever is reading, the header names the OTHER side. A pro opening their
     own job was being shown their own name and, below, "You pay ₹217" —
     the customer's voice, on the worker's screen. */
  const theOther = (isPartner || isShop) ? (o.customerName || 'Your customer')
    : (o.kind === 'service' ? o.partnerName : o.shopName);
  const who = theOther;
  const payer = (isPartner || isShop) ? 'The customer pays' : 'You pay';
  const confirms = (isPartner || isShop) ? 'the customer confirms' : 'you confirm';
  const placed = clockTime(o.createdAt);

  sweepMaps();
  setTimeout(() => {
    if (showMap) mountMap(o.id, 'orderMap', true); else kill('orderMap');
    if (document.getElementById('jobMap')) mountMap(o.id, 'jobMap', false); else kill('jobMap');
  }, 0);

  const pct = o.deal ? Math.round(((o.platformFee | 0) + (o.gst | 0)) / o.deal * 100) : 0;

  /* the pictures belong to both sides. They are drawn inside the action panel
     at the two moments a decision hangs on them — the pro attaching, the
     customer releasing — and in their own block every other time, so a
     settled order, a live job or a dispute all still show the work. */
  const evInPanel = (isPartner && o.stage === 'IN_PROGRESS') || (isCustomer && o.stage === 'WORK_DONE');
  const showEv = !!(o.evidence || []).length && (isCustomer || isPartner || isShop) && !evInPanel;

  return `
  ${header(`Order ${orderNo(o)}`, `${who} · placed ${placed}`)}
  <main class="wrap">

    ${showMap ? mapCard(o) : ''}

    <!-- STATUS IS THE HERO. The person on the way, the stage, the one thing to do. -->
    <div class="row" style="gap:10px;padding:12px 0;border-bottom:2px solid var(--color-divider)">
      <span class="thumb m-thumb" style="width:40px;height:40px" aria-hidden="true">${hasIcon(cat.id) ? icon(cat.id, { size: 18 }) : icon('box', { size: 18 })}</span>
      <div class="grow" style="min-width:0">
        <div style="font:800 13.5px/1.2 var(--font-heading)">${esc(who)} · ${esc(stageLabel(st).toLowerCase())}</div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px">${running
          ? `${km} km away · ~${o.eta || etaMins(km)} min · step ${idx + 1} of ${track.length}`
          : `${esc(st.short)} · ${timeAgo(o.createdAt)}`}</div>
      </div>
      <button class="btn btn--secondary btn--sm tap" data-act="order.map" data-id="${esc(o.id)}"
        aria-pressed="${showMap}" style="font-size:11px;letter-spacing:.04em;min-height:44px">${showMap ? 'HIDE MAP' : 'MAP'}</button>
    </div>

    ${o.otp && running && isCustomer && !o.otpVerified && o.stage !== 'ARRIVED' && o.stage !== 'R_PICKUP_READY' ? `
      <div class="between" style="padding:9px 0;border-bottom:1px solid var(--color-divider)">
        <span class="tiny muted">Your SAAHAA code — read it out only at the door</span>
        <b class="num" style="font-size:15px;letter-spacing:.1em">${esc(o.otp)}</b></div>` : ''}

    <div class="m-two">
      <div>
        <div class="sec">
          <p class="m-cap">Progress</p>
          ${timeline(o, track, idx)}
        </div>

        ${actionPanel(o, { isCustomer, isPartner, isShop })}
      </div>

      <div>
        ${o.kind === 'service' ? `
          <div class="sec">
            <p class="m-cap">The bill</p>
            <div class="m-kv"><span>${esc(cat.name)} · ${esc(o.sub || cat.unit)} — ${esc(o.partnerName)}'s price</span><span class="num">${M.fmt(o.deal)}</span></div>
            <!-- "SAAHAA charge · 8% on top" sat beside the platform fee alone,
                 which is not 8% of anything on this screen: the 8% is the fee
                 PLUS the GST under it. Two lines that can be added up, and the
                 percentage stated once, over the sum it actually describes. -->
            <div class="m-kv"><span class="muted">SAAHAA platform fee</span><span class="num">${M.fmt(o.platformFee)}</span></div>
            <div class="m-kv"><span class="muted">GST on that fee</span><span class="num">${M.fmt(o.gst)}</span></div>
            <div class="m-kv m-kv--total"><span>${payer}${o.provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(o.customerPays)}</span></div>
            <p class="micro muted" style="margin-top:8px">The fee and its GST together are ${M.fmt((o.platformFee | 0) + (o.gst | 0))} —
              the ${pct}% SAAHAA adds on top of the quote.</p>
            <p class="micro muted" style="margin-top:6px">${esc(paidWith(o))}. ${esc(o.partnerName)} receives the full ${M.fmt(o.deal)} —
              SAAHAA holds it until ${confirms} the work and never takes a cut of their quote.</p>
            ${o.saved && !(isPartner || isShop) ? `<p class="micro" style="margin-top:6px;color:var(--color-accent)">You saved ${M.fmt(o.saved)} against a commission app — and your pro was paid more.</p>` : ''}
            ${o.saved && (isPartner || isShop) ? `<p class="micro" style="margin-top:6px;color:var(--color-accent)">${esc(t('money.youKeep', { amount: M.fmt(o.deal) }))}</p>` : ''}
          </div>` : `
          <div class="sec">
            <p class="m-cap">${o.lines.length} item${o.lines.length === 1 ? '' : 's'}${o.provisional ? ' · est. until weighed' : ''}</p>
            ${o.lines.map(l => `<div class="m-kv"><span>${esc(l.name)} × ${l.qty}${l.variableWeight ? ' (est.)' : ''}${
              l.status === 'unavailable' ? ' <span class="tag tag-accent">refunded</span>' : l.status === 'substituted' ? ' <span class="tag tag-neutral">similar</span>' : ''}</span>
              <span class="num">${M.fmt(l.unitPrice * l.qty)}</span></div>`).join('')}
            <div class="m-kv"><span class="muted">Delivery${o.mode === 'pickup' ? ' · pickup' : ''}</span><span class="num">${o.deliveryFee ? M.fmt(o.deliveryFee) : 'Free'}</span></div>
            <div class="m-kv m-kv--total"><span>Total${o.provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(o.customerPays)}</span></div>
            <p class="micro muted" style="margin-top:8px">${esc(paidWith(o))}. Held by SAAHAA until ${confirms} the delivery; an item the shop could not supply comes back to ${(isPartner || isShop) ? "the customer's" : 'your'} wallet.</p>
          </div>`}

        ${showEv ? evidenceSection(o, isPartner) : ''}

        <div class="sec">
          <div class="between" style="margin-bottom:6px"><p class="m-cap" style="margin:0">Messages</p>
            <button class="more tap" data-act="nav.chat" data-id="${esc(o.id)}"
              style="min-height:44px;padding-inline:2px">${chats.length ? `Open all ${chats.length} →` : `Message ${esc((who || '').split(' ')[0])} →`}</button></div>
          <div style="max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
            ${chats.length ? chats.slice(-4).map(m => `<div class="msg${s && m.name === s.name ? ' mine' : ''}">
              <span class="micro" style="display:block;opacity:.7">${esc(m.name)} · ${clockTime(m.ts)}</span>
              ${esc(m.text)}
              ${m.flagged ? '<span class="micro" style="display:block;margin-top:4px;opacity:.8">Phone numbers and payment ids hidden — keep payments in SAAHAA.</span>' : ''}
            </div>`).join('') : '<p class="tiny muted">No messages yet.</p>'}
          </div>
          ${(isCustomer || isPartner || isShop) ? `
          <div class="row" style="margin-top:10px;gap:0;border:1px solid var(--color-divider)">
            <input id="chatIn" class="grow" placeholder="Message"
              style="height:44px;padding:0 12px;border:0;background:var(--surface);color:var(--ink-1);font-size:14px;min-width:0">
            <!-- an icon-only button: padding around a 9px glyph came to 37px wide,
                 so the minimum is stated rather than inferred (the #/chat composer's
                 own .ch-send already sets 52px) -->
            <button class="btn btn--primary" style="min-height:44px;min-width:44px;padding-inline:14px" data-act="chat.send" data-id="${o.id}" aria-label="Send">↑</button>
          </div>` : '<p class="micro muted" style="margin-top:10px">Sign in to reply.</p>'}
        </div>

        ${(isCustomer || isPartner || isShop) && canTransition(o.stage, 'DISPUTED') ? `
        <button class="btn btn--ghost btn--block" style="margin-top:12px;color:var(--danger)"
          data-act="dispute.open" data-id="${o.id}">Report an issue</button>` : ''}
      </div>
    </div>
    <div style="height:40px"></div>
  </main>${EV_CSS}${SYS_CSS}`;
}

/* ══════════════ 6 · CHAT WITH THE PRO ═══════════════════════════
   The mockup's chat screen, on the engine's own thread. The header carries
   who you are talking to and where the job has got to; the thread is grouped
   by day; the JOB CONFIRMED card is the order itself, drawn from its stored
   numbers so it can never disagree with the bill; the composer is the one
   `chatIn` field app.js already reads.

   flow.sendChat() masks phone numbers and UPI ids before the message is ever
   stored. That masking is shown, never undone — the line under a masked
   message says why, because a customer who cannot see the reason assumes a
   bug rather than a rule. */

const dayKey = ts => new Date(ts).toDateString();
function dayLabel(ts) {
  const k = dayKey(ts), today = dayKey(Date.now());
  if (k === today) return 'Today';
  if (k === dayKey(Date.now() - 86400000)) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* what was agreed, in the order's own money — never a typed percentage */
function jobCard(o, cat, mine = false) {
  const P = getPricing();
  const title = o.kind === 'service'
    ? `${cat.name}${o.sub ? ' · ' + o.sub : ''}`
    : `${(o.lines || []).length} item${(o.lines || []).length === 1 ? '' : 's'} from ${o.shopName || ''}`;
  const pct = o.deal ? Math.round(((o.platformFee | 0) + (o.gst | 0)) / o.deal * 100) : P.serviceMarkupPct;
  return `<div class="ch-job">
    <p class="m-cap" style="margin:0">Job confirmed</p>
    <b>${esc(title)} · ${M.fmt(o.kind === 'service' ? o.deal : o.customerPays)}</b>
    <p class="micro muted" style="margin:4px 0 0">${o.kind === 'service'
      ? `${esc(o.partnerName || '')} keeps the full ${M.fmt(o.deal)}. ${mine ? 'The customer pays' : 'You pay'} ${M.fmt(o.customerPays)} — SAAHAA's ${pct}% sits on top of the quote and is held until ${mine ? 'the customer confirms' : 'you confirm'} the work.`
      : `${mine ? 'The customer pays' : 'You pay'} ${M.fmt(o.customerPays)}, held by SAAHAA until ${mine ? 'they confirm' : 'you confirm'} the delivery. SAAHAA's charge on a shop order comes out of the shop's side, not the basket.`}</p>
  </div>`;
}

export function renderChat(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return renderList();
  const s = me();
  const cat = get('category', o.catId);
  const st = stage(o.stage);
  const msgs = getState().chats[o.id] || [];
  const isCustomer = !!(s && o.customerKey === s.key);
  const isPartner = !!(s && s.role === 'partner' && getState().partners.some(p => p.userKey === s.key && p.id === o.partnerId));
  const isShop = !!(s && s.role === 'shop' && getState().shops.some(x => x.ownerKey === s.key && x.id === o.shopId));
  const canPost = isCustomer || isPartner || isShop;
  /* a thread has two ends: whoever is reading, the header names the other */
  const who = ((isPartner || isShop) ? o.customerName
    : (o.kind === 'service' ? o.partnerName : o.shopName)) || 'SAAHAA';

  /* a thread is read from the bottom */
  setTimeout(() => { const el = document.getElementById('chatThread'); if (el) el.scrollTop = el.scrollHeight; }, 0);

  let last = '';
  const thread = msgs.map(m => {
    const k = dayKey(m.ts);
    const rule = k === last ? '' : `<div class="ch-day">${esc(dayLabel(m.ts))}</div>`;
    last = k;
    return `${rule}<div class="msg${s && m.name === s.name ? ' mine' : ''}">
      <span class="micro" style="display:block;opacity:.7">${esc(m.name)} · ${clockTime(m.ts)}</span>
      ${esc(m.text)}
      ${m.flagged ? '<span class="micro" style="display:block;margin-top:4px;opacity:.85">Phone numbers and payment ids hidden — keep the job and the payment inside SAAHAA and you are both covered.</span>' : ''}
    </div>`;
  }).join('');

  return `${CHAT_CSS}
  <header class="apphdr ch-hdr">
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="nav.back" aria-label="Back">${icon('back', { size: 18 })}</button>
    <span class="thumb" style="width:34px;height:34px;display:grid;place-items:center;color:var(--ink-3)" aria-hidden="true">${
      hasIcon(cat.id) ? icon(cat.id, { size: 16 }) : icon('chat', { size: 16 })}</span>
    <div class="grow" style="min-width:0">
      <div class="ch-who">${esc(who)}</div>
      <div class="ch-state">${esc(stageLabel(st))} · ${M.fmt(o.kind === 'service' ? o.deal : o.customerPays)} · ${esc(clockTime(o.createdAt))}</div>
    </div>
    <button class="btn btn-secondary" style="flex:none" data-act="order.open" data-id="${esc(o.id)}">Order</button>
  </header>

  <main class="wrap ch-wrap">
    <div id="chatThread" class="ch-thread">
      ${jobCard(o, cat, isPartner || isShop)}
      ${thread || `<p class="tiny muted" style="text-align:center;margin:auto 0">No messages yet. Say what you need — ${esc(who.split(' ')[0])} sees it straight away.</p>`}
    </div>

    ${canPost ? `<div class="ch-bar">
      <input id="chatIn" class="grow ch-in" placeholder="Message ${esc(who.split(' ')[0])}" aria-label="Message ${esc(who)}">
      <button class="btn btn--primary ch-send" data-act="chat.send" data-id="${esc(o.id)}" aria-label="Send">↑</button>
    </div>
    <p class="micro muted ch-foot">Phone numbers and payment ids are hidden automatically. Keep the money in SAAHAA:
      it is held until you confirm the work — or until the deadline shown on the job — and it is the only thing a dispute can be settled from.</p>`
    : `<p class="micro muted ch-foot">${s ? 'This thread belongs to the customer and the pro on this order.' : 'Sign in to reply.'}</p>`}
    <div style="height:20px"></div>
  </main>${SYS_CSS}`;
}

const CHAT_CSS = `<style>
  .ch-hdr .ch-who{font:800 14px/1.15 var(--font-heading);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ch-hdr .ch-state{font-size:10.5px;line-height:1.3;color:var(--color-accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ch-wrap{display:flex;flex-direction:column;padding-top:0}
  .ch-thread{display:flex;flex-direction:column;gap:10px;min-height:52vh;
    margin:0 calc(-1 * var(--gutter));padding:12px var(--gutter);background:var(--bg-sunken)}
  .ch-thread .msg{background:var(--surface);border:1px solid var(--color-divider)}
  .ch-thread .msg.mine{background:var(--color-text);color:var(--color-bg);border-color:var(--color-text)}
  .ch-day{align-self:center;font:600 9.5px/1 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);padding:2px 0}
  .ch-job{align-self:stretch;border:2px solid var(--color-text);background:var(--surface);padding:10px}
  .ch-job b{display:block;font:800 14px/1.25 var(--font-heading);margin-top:4px}
  .ch-bar{position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));z-index:var(--z-sticky);
    display:flex;gap:0;margin-top:auto;border:2px solid var(--color-divider);background:var(--bg)}
  .ch-in{min-height:44px;padding:0 12px;border:0;background:var(--surface);color:var(--ink-1);font-size:14px;min-width:0;
    caret-color:var(--color-accent)}
  .ch-send{min-height:44px;min-width:52px;padding-inline:14px;font:800 15px/1 var(--font-heading)}
  .ch-foot{margin-top:10px}
  @media (min-width:768px){ .ch-bar{bottom:0}
    .ch-thread{min-height:58vh;margin:12px 0 0;padding:14px;border:1px solid var(--color-divider)} }
  @media (min-width:1024px){ .ch-thread .msg{max-width:60%} }
</style>`;

/* ══════════════ THE PHOTOGRAPH THAT RELEASES THE MONEY ═══════════
   The rule is older than this screen: no picture of the finished work, no
   payout. Until now the screen only recorded a WORD — "After" — so a customer
   confirming a job was trusting a label. Now the pro's camera opens and the
   picture itself is attached, and both sides look at the same one.

   Three things this must never do. Build an <img src> from anything but
   photo.url() — the store is user-editable, and core/photos.js is the only
   thing that decides a value is really a picture. Jump the page as pictures
   decode — every tile is exactly THUMB square, reserved before the bytes
   arrive. Leave a broken frame where an older label-only entry sits — those
   are drawn as what they are, a note. Enlarging is a <details>: plain markup,
   no action to register. */
const THUMB = 112;

function evidenceTiles(o) {
  const list = o.evidence || [];
  if (!list.length) return '';
  return `<div class="ev-grid">${list.map(e => {
    const label = esc((e && e.label) || 'Work done');
    const when = e && e.ts ? esc(clockTime(e.ts)) : '';
    const src = (e && e.photo) ? photo.url(e.photo) : '';
    if (!src) return `<p class="ev-plain"><b>${label}</b>
      <span>${when ? when + ' · ' : ''}noted, no photograph</span></p>`;
    return `<details class="ev-card">
      <summary class="ev-sum tap">
        <img class="ev-img" src="${src}" width="${THUMB}" height="${THUMB}"
          alt="${label} — the finished work, photographed">
        <span class="ev-cap"><b>${label}</b><span class="ev-hint">${when ? when + ' · ' : ''}</span></span>
      </summary>
      <img class="ev-full" src="${src}" alt="${label} — the finished work, photographed, larger">
    </details>`;
  }).join('')}</div>`;
}

/* how many of the entries are actually a picture — an order carried over from
   before the camera existed has evidence but nothing to show */
const shot = o => (o.evidence || []).filter(e => e && e.photo && photo.url(e.photo)).length;

/* The block both sides land on once the moment has passed: the customer
   watching the job run, a settled order, a dispute, the shop looking back. */
function evidenceSection(o, mine) {
  const n = shot(o);
  const line = !n
    ? 'This job was recorded by name only — the photograph step came later, so there is nothing to look at.'
    : mine
      ? `Kept with the order. ${n === 1 ? 'It is' : 'They are'} what released the money, and what settles a dispute in your favour.`
      : `${esc(o.partnerName || 'Your pro')} photographed the work. SAAHAA releases nothing until ${n === 1 ? 'it exists' : 'they exist'}, so you can see what you are paying for.`;
  return `<div class="sec" id="evidence">
    <p class="m-cap">Proof of work · ${(o.evidence || []).length}</p>
    ${evidenceTiles(o)}
    <p class="micro muted" style="margin-top:8px">${line}</p>
  </div>`;
}

const EV_CSS = `<style>
  .ev-grid{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;margin:2px 0 0}
  .ev-card{flex:0 0 auto;width:${THUMB}px;border:1px solid var(--color-divider);background:var(--surface-2)}
  .ev-card[open]{width:100%;max-width:420px}
  .ev-sum{display:block;list-style:none;cursor:pointer}
  .ev-sum::-webkit-details-marker{display:none}
  .ev-sum::marker{content:''}
  .ev-img{display:block;width:${THUMB}px;height:${THUMB}px;object-fit:cover;background:var(--color-neutral-300)}
  .ev-card[open] .ev-img{display:none}
  .ev-full{display:block;width:100%;max-height:58vh;object-fit:contain;
    background:var(--color-neutral-300);border-top:1px solid var(--color-divider)}
  .ev-cap{display:flex;flex-direction:column;justify-content:center;gap:1px;min-height:44px;padding:5px 8px;
    font:600 9.5px/1.3 var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  .ev-cap b{font:800 11px/1.2 var(--font-heading);letter-spacing:.03em;color:var(--ink-1)}
  .ev-hint::after{content:'ENLARGE'} .ev-card[open] .ev-hint::after{content:'CLOSE'}
  .ev-plain{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:44px;
    max-width:100%;margin:0;padding:8px 10px;border:1px dashed var(--color-divider);
    font:600 9.5px/1.3 var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  .ev-plain b{font:800 11px/1.2 var(--font-heading);letter-spacing:.03em;color:var(--ink-1)}
  .ev-alt{margin-top:12px;border-top:1px solid color-mix(in srgb,var(--color-bg) 30%,transparent);padding-top:6px}
  .ev-alt__sum{display:flex;align-items:center;min-height:44px;list-style:none;cursor:pointer;
    font:600 10px/1.3 var(--font-body);letter-spacing:.1em;text-transform:uppercase}
  .ev-alt__sum::-webkit-details-marker{display:none} .ev-alt__sum::marker{content:''}
  .on-plum .ev-card,.on-plum .ev-plain{border-color:color-mix(in srgb,var(--color-bg) 40%,transparent);background:transparent}
  .on-plum .ev-cap,.on-plum .ev-plain,.on-plum .ev-alt__sum{color:color-mix(in srgb,var(--color-bg) 70%,transparent)}
  .on-plum .ev-cap b,.on-plum .ev-plain b{color:var(--color-bg)}
  .on-plum .ev-full{border-top-color:color-mix(in srgb,var(--color-bg) 40%,transparent)}
</style>`;

/* the one panel that changes with role + stage — everything derived, no switch
   on a hard-coded id list */
function actionPanel(o, r) {
  const s = o.stage;
  const B = (act, label, cls = 'btn--primary') =>
    `<button class="btn ${cls} btn--lg btn--block" style="justify-content:flex-start" data-act="${act}" data-id="${o.id}">${label}</button>`;

  if (r.isPartner) {
    if (s === 'MATCHING')    return panel('New job for you', B('stage.accept', 'Accept this job'));
    if (s === 'ASSIGNED')    return panel('Head to the customer', `${whereTo(o)}${B('stage.enroute', 'Start travelling')}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);

    /* THE WORST DEAD END IN THE PRODUCT. A dispute raised against him showed
       the header "under review" and nothing else: not the reason, not that a
       complaint had been made, not that his money was frozen, not for how
       long, and no way to put his side. "Report an issue" also vanished at the
       same moment, because DISPUTED cannot transition to DISPUTED — so his
       only escalation route disappeared exactly when he needed it. */
    if (s === 'DISPUTED') {
      const d = (getState().disputes || []).find(x => x.orderId === o.id) || {};
      const mine = d.by && me() && d.by === me().key;
      return panel(mine ? 'You reported this — it is with the owner' : 'A complaint was raised on this job', `
        <p class="tiny" style="margin-bottom:10px"><b>${esc(d.reason || o.disputeReason || 'Reported')}</b>${d.note ? ` — ${esc(d.note)}` : ''}</p>
        <div class="m-kv"><span>Your payout, frozen for now</span><span class="num">${M.fmt(o.deal)}</span></div>
        ${o.stake ? `<div class="m-kv"><span>Your stake, frozen with it</span><span class="num">${M.fmt(o.stake.need)}</span></div>` : ''}
        <p class="micro muted" style="margin-top:10px">${mine
          ? 'Nobody is paid while this is open. The owner reads both sides, usually within 24 hours.'
          : 'Nothing is decided yet and nothing is held against you for one complaint. Put your side on the record — the owner reads both, usually within 24 hours. If it is upheld, your stake goes to the customer and it counts against SAAHAA Certified.'}</p>
        ${o.disputeReason === 'Code would not verify at the door' ? `
          <button class="btn btn--primary btn--block" style="margin-top:10px"
            data-act="code.retry" data-id="${o.id}">Let me try the code again</button>` : ''}
        <button class="btn btn--secondary btn--block" style="margin-top:10px"
          data-act="nav.chat" data-id="${o.id}">Put my side on the record</button>
        ${(o.evidence || []).length ? `<p class="micro muted" style="margin-top:8px">Your ${(o.evidence || []).length} piece${(o.evidence || []).length === 1 ? '' : 's'} of evidence ${(o.evidence || []).length === 1 ? 'is' : 'are'} attached to this job and the owner can see ${(o.evidence || []).length === 1 ? 'it' : 'them'}.</p>` : ''}`);
    }
    /* The pro is travelling to a place, not to a word. The same map the
       customer is looking at, without the controls. */
    if (s === 'EN_ROUTE')    return panel('Arrived?',
      `${whereTo(o)}${mapCard(o, { interactive: false, id: 'jobMap' })}
       <div style="height:12px"></div>${B('stage.arrived', "I've arrived")}
       <!-- EN_ROUTE is the stage where "I cannot come" actually happens — a
            breakdown, a job overrunning — and it was the one stage with no
            cancel control, which left no-showing as the only way out. -->
       <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
         data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);
    if (s === 'ARRIVED')     return panel(t('door.pro.title'), `
      ${whereTo(o)}${mapCard(o, { interactive: false, id: 'jobMap' })}
      <div style="height:12px"></div>
      <!-- The hint gives the SHAPE, never a specimen. An example like "C20262001"
           is a real person's code — the first customer of 2026 — so printing one
           here would hand the pro a code they might not have been given. -->
      <p class="tiny muted" style="margin:0 0 10px">${esc(t('door.pro.shape'))}</p>
      <div class="field" style="margin-bottom:14px">
        <input id="otpCode" data-role="otp" autocapitalize="characters" autocomplete="off"
          spellcheck="false" maxlength="12" placeholder=" "
          style="font-family:var(--font-mono,inherit);letter-spacing:.12em;text-transform:uppercase">
        <label>${esc(t('door.pro.field'))}</label>
      </div>
      <!-- The code is what LOCKS the stake. Saying so afterwards is telling
           somebody their money moved; saying it here is asking them. -->
      <p class="tiny muted" style="margin:0 0 12px">${esc(t('door.pro.stake', { amount: M.fmt(W.stakeFor(o.deal)) }))}</p>
      ${B('otp.submit', t('door.pro.submit'))}
      <!-- A PRO COULD NOT CANCEL. The agreement he signs says "I will cancel
           early if I cannot come, never just not show up", and the conduct quiz
           marks that as the right answer — while the app gave him no control to
           do it at any stage. His only options were to no-show (stake forfeit,
           trust penalty) or to talk the customer into cancelling for him. -->
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);
    /* The camera IS the step. The label-only path stays — a pro whose camera
       is broken must still be able to finish a paid job — but it is folded
       away, because a word is not evidence and should not look like it. */
    if (s === 'IN_PROGRESS') return panel(t('job.photoNeeded'), `
      ${o.stake ? `<p class="tiny" style="margin-bottom:10px"><span class="state state--held">${M.fmt(o.stake.need)} locked</span>
        <span class="muted">${o.stake.onCredit ? `(${M.fmt(o.stake.onCredit)} on credit against this payout) ` : ''}${esc(t('money.stakeBack', { amount: M.fmt(o.stake.need) }))}</span></p>` : ''}
      <div class="row" style="gap:8px;margin-bottom:10px">
        <button class="btn btn--primary grow" data-act="photo.evidence" data-id="${o.id}" data-label="Before">${icon('camera', { size: 16 })} Before</button>
        <button class="btn btn--primary grow" data-act="photo.evidence" data-id="${o.id}" data-label="After">${icon('camera', { size: 16 })} After</button>
      </div>
      <p class="micro muted" style="margin-bottom:12px">${esc(t('job.photoWhy'))}</p>
      ${(o.evidence || []).length ? `${evidenceTiles(o)}
        <p class="micro muted" style="margin:8px 0 12px">${(o.evidence || []).length} attached${
          shot(o) < (o.evidence || []).length ? ` · ${(o.evidence || []).length - shot(o)} without a photograph` : ''}</p>`
        : '<div style="height:2px"></div>'}
      ${(o.evidence || []).length
        ? B('stage.done', 'Mark work finished')
        : `<button class="btn btn--primary btn--lg btn--block" disabled
             style="opacity:.5;cursor:not-allowed">Add a photo first</button>`}
      <details class="ev-alt">
        <summary class="ev-alt__sum tap">Camera not working?</summary>
        <p class="micro muted" style="margin:2px 0 8px">Record the step by name instead. It still lets you finish the job, but the
          customer sees a word where a picture should be.</p>
        <div class="row" style="gap:8px">
          <button class="btn btn--secondary btn--sm grow" data-act="ev.add" data-id="${o.id}" data-label="Before">Note Before</button>
          <button class="btn btn--secondary btn--sm grow" data-act="ev.add" data-id="${o.id}" data-label="After">Note After</button>
        </div>
      </details>`);
    if (s === 'WORK_DONE')   return panel('Waiting on the customer',
      /* "Auto-releases if the customer does not respond" with no time on it was
         the pro's half of the same lie the customer was told: for a new pro it
         is not true at all (first three jobs are reviewed), and for everyone
         else the hour count was never shown. Both are stated now. */
      `<p class="tiny muted">${o.escrowTier === 'HOLD'
        ? 'A person at SAAHAA is checking this one — the first few jobs always are. Nothing is wrong.'
        : `${esc((ESCROW[o.escrowTier] || {}).label || 'Auto-releases')} if the customer does not confirm before then.`}</p>`);
  }

  if (r.isCustomer) {
    if (s === 'ARRIVED') return panel(t('door.customer.title'), `
      ${codeBig(o.otp)}
      <p class="tiny muted" style="text-align:center;margin-top:8px">${esc(t('door.customer.body'))}</p>`);
    if (s === 'WORK_DONE') return panel('Work finished — confirm to release payment', `
      ${(o.evidence || []).length ? `${evidenceTiles(o)}
        <p class="micro muted" style="margin:8px 0 12px">${shot(o)
          ? 'This is what you are paying for. Nothing leaves SAAHAA until you confirm against it.'
          : 'Your pro could not attach a photograph, so this is a note, not a picture. Report an issue if the work is not done.'}</p>` : ''}
      <div class="m-kv" style="margin-bottom:10px"><span>Held by SAAHAA for ${esc(o.partnerName)}</span>
        <span><b class="num">${M.fmt(o.deal)}</b> <span class="state state--held">not yet released</span></span></div>
      <!-- SHE WAS NEVER TOLD THE CLOCK EXISTED. The pro's screen showed the
           release window and hers did not, while nine screens promised the
           money moved only when she confirmed. If a deadline exists she has to
           be the first to know it, not the last. -->
      ${releaseLine(o)}
      ${B('release.full', `Confirm & release ${M.fmt(o.deal)}`)}
      <button class="btn btn--ghost btn--block" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="dispute.open" data-id="${o.id}">Something was wrong</button>`);
    /* 1d RATINGS & REVIEWS. Tapping a star posts the rating; the engine stores
       stars only, so there are no "what was good" chips and no text box —
       a control that goes nowhere is not drawn. */
    if ((s === 'SETTLED' || s === 'PARTIAL') && !o.rated) {
      const cat = get('category', o.catId);
      const done = (o.history || []).find(h => h.stage === 'WORK_DONE');
      return panel('How did it go?', `
      <div style="font:800 19px/1.2 var(--font-heading)">${esc(o.partnerName)} did ${esc((o.sub || cat.name).toLowerCase())} for ${M.fmt(o.deal)}</div>
      <p class="tiny muted" style="margin-top:5px">${done ? `Finished ${timeAgo(done.at)}` : 'Paid & settled'} · your rating decides who gets recommended next.</p>
      <div class="m-stars" style="margin-top:14px" role="group" aria-label="Rate from 1 to 5 stars">
        ${[1,2,3,4,5].map(n => `<button data-act="rate.submit" data-id="${o.id}" data-stars="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">★</button>`).join('')}
      </div>
      <p class="micro muted" style="margin-top:6px">Tap a star to post your review.</p>
      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn btn--secondary" data-act="rate.skip" data-id="${o.id}">Skip</button>
      </div>`);
    }
    /* A RETURN WAS A TRAP: the money froze and this screen had no control at
       all. She can escalate now, and if the shop simply never answers the sweep
       pays her back within a day — which the panel says, so she is not left
       wondering whether tapping return was a mistake. */
    if (s === 'R_RETURN') return panel('Return requested', `
      <p class="tiny" style="margin-bottom:10px">${esc(o.returnReason || 'You asked to return this order.')}</p>
      <div class="m-kv"><span>Held, going nowhere else</span><span class="num">${M.fmt(o.customerPays)}</span></div>
      <p class="micro muted" style="margin-top:10px">${esc(o.shopName || 'The shop')} can accept it now. If they do not
        answer within ${Math.round(flow.RETURN_WINDOW_MS / 3600e3)} hours, SAAHAA refunds you in full automatically —
        you do not have to chase it.</p>
      <button class="btn btn--secondary btn--block" style="margin-top:10px"
        data-act="dispute.open" data-id="${o.id}">Ask SAAHAA to step in now</button>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
        data-act="nav.chat" data-id="${o.id}">Message ${esc(String(o.shopName || 'the shop').split(' ')[0])}</button>`);

    if (s === 'R_DELIVERED') return panel('Delivered — confirm', `${B('retail.settle', 'Confirm delivery')}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="retail.return" data-id="${o.id}">Something was wrong — return this order</button>`);
    if (s === 'R_PICKUP_READY') return panel('Ready at the shop — collect it', `
      <p class="tiny muted" style="margin-bottom:10px">Show your SAAHAA code at the counter.</p>
      ${codeBig(o.otp)}
      ${B('retail.collected', 'I have collected it')}`);
    if (s === 'R_SUB_PENDING') return panel('The shop needs your call', `
      ${(o.lines || []).filter(l => l.status === 'asking').map(l => `<div class="card" style="padding:12px;margin-bottom:8px">
        <b class="tiny">${esc(l.name)}</b><p class="micro muted">${esc(l.qty)} × ${M.fmt(l.unitPrice)} · not in stock right now</p>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn btn--secondary btn--sm grow" data-act="retail.sub" data-id="${o.id}" data-line="${l.lineId}" data-choice="similar">Similar brand is fine</button>
          <button class="btn btn--ghost btn--sm grow" data-act="retail.sub" data-id="${o.id}" data-line="${l.lineId}" data-choice="refund">Just refund it</button>
        </div></div>`).join('')}
      <p class="micro muted">No reply in 90 seconds means that item is refunded automatically.</p>`);
    if (s === 'R_RETURN') return panel('Return requested', '<p class="tiny muted">The shop or SAAHAA confirms the return; your money comes back in full.</p>');
    /* THE PANEL IS CALLED "WHAT HAPPENS NEXT" AND IT SAID "Need to cancel?".
       For the whole of the wait — matching, accepted, travelling, which is
       most of the time a customer spends on this screen — the only thing the
       product offered was a way out. Everything below is read off the order
       and the machine's own tracker; the cancel button is untouched and still
       one tap away. */
    if (['MATCHING','ASSIGNED','EN_ROUTE'].includes(s)) {
      /* NOBODY HAS ACCEPTED AT MATCHING. The 900ms fake was removed from the
         stage machine and left here: the header, the ETA and the code line all
         read o.partnerName, which is written at booking time, so an unaccepted
         job showed a named tradesman 0.4 km away — and if the sweep then
         refunded it, told her he had cancelled. No name until it is true. */
      const accepted = s !== 'MATCHING';
      const first = accepted ? String(o.partnerName || 'Your pro').split(' ')[0] : 'Your pro';
      const trk = trackerFor(o.kind), i = trackerIndex(o);
      const next = trk[i + 1];
      const title = s === 'MATCHING' ? `Finding a pro for you`
        : s === 'ASSIGNED' ? `${first} has accepted`
        : `${first} is on the way`;
      const line = s === 'MATCHING'
        ? `As soon as one accepts, this screen shows their name and how far away they are. If nobody takes it within ${Math.round(flow.ACCEPT_WINDOW_MS / 60000)} minutes, the booking ends by itself and every rupee comes straight back to you.`
        : s === 'EN_ROUTE' ? `About ${o.eta || etaMins(kmOf(o))} minutes away. Tap MAP above to watch.`
        : `They set out next — you will see them move on the map.`;
      return panel(title, `
        <p class="tiny" style="margin-bottom:12px">${esc(line)}</p>
        <ol class="m-steps" style="gap:8px;margin-bottom:12px">
          ${next ? `<li class="m-step pend"><span class="m-step__dot"></span>
            <span class="m-step__t">Then: ${esc(next.label)}</span></li>` : ''}
          ${o.otp && accepted ? `<li class="m-step pend"><span class="m-step__dot"></span>
            <span class="m-step__t">Read ${esc(first)} your code <b class="num">${esc(o.otp)}</b> at your door — never before</span></li>` : ''}
          <li class="m-step pend"><span class="m-step__dot"></span>
            <span class="m-step__t">${M.fmt(o.customerPays)} is held by SAAHAA. ${esc(first)} is paid only after you confirm the work</span></li>
        </ol>
        ${(s === 'ASSIGNED' || s === 'EN_ROUTE') && Date.now() - (o.stageTs || 0) > NO_SHOW_AFTER_MS ? `
          <!-- THE MISSING ESCAPE. When a pro simply does not turn up, the only
               control here used to be Cancel — which at EN_ROUTE hands 40% of
               her money to a journey nobody made. WORKER_NO_SHOW (full refund
               plus a credit) has been in the engine and on the published
               refunds page the whole time with nothing able to call it. -->
          <button class="btn btn--secondary btn--block" style="margin-bottom:6px"
            data-act="noshow.open" data-id="${o.id}">${esc(first)} never arrived</button>` : ''}
        <button class="btn btn--ghost btn--block" style="color:var(--color-accent-400)"
          data-act="cancel.open" data-id="${o.id}">Cancel this booking</button>`);
    }

    /* A REFUNDED ORDER SHOWED HER THE BILL SHE PAID AND NOTHING ELSE. The money
       was genuinely back in her wallet — the ledger proved it — and the screen
       still read "You pay ₹450 … held until you confirm", so the only
       reasonable conclusion was that she was out the money. */
    if (s === 'CANCELLED' || s === 'NO_MATCH' || s === 'REFUNDED') {
      const back = o.refund != null ? o.refund : o.customerPays;
      const why = o.cancelRule === 'WORKER_NO_SHOW' ? 'Your pro did not arrive.'
        : o.cancelRule === 'WORKER_CANCEL' ? 'Your pro could not make it, and told us rather than not turning up.'
        : o.noMatchAt ? 'Nobody was free to take this one, so it ended by itself.'
        : 'This booking was cancelled.';
      return panel('Your money is back', `
        <p class="tiny" style="margin-bottom:10px">${esc(why)}</p>
        <div class="m-kv"><span>Back in your SAAHAA wallet</span><span class="num">${M.fmt(back)}</span></div>
        ${o.goodwill ? `<div class="m-kv"><span>Credit for the trouble</span><span class="num">${M.fmt(o.goodwill)}</span></div>` : ''}
        <p class="micro muted" style="margin-top:10px">Spend it on the next booking or take it out from My SAAHAA — it is yours either way.</p>
        <button class="btn btn--secondary btn--block" style="margin-top:10px" data-act="nav.home">Find someone else</button>`);
    }

    /* A DISPUTED JOB USED TO BE A DEAD END FOR THE CUSTOMER TOO — this branch
       simply did not exist, so the screen said "under review" and stopped. */
    if (s === 'DISPUTED') {
      const d = (getState().disputes || []).find(x => x.orderId === o.id) || {};
      return panel('A person is looking at this', `
        <p class="tiny" style="margin-bottom:10px">${esc(d.reason || o.disputeReason || 'Reported')}${d.note ? ` — ${esc(d.note)}` : ''}</p>
        <div class="m-kv"><span>Frozen, and going nowhere</span><span class="num">${M.fmt(o.customerPays)}</span></div>
        <p class="micro muted" style="margin-top:10px">Nobody is paid while this is open. Most are settled
          within 24 hours, and you will see the outcome and the reason on this screen.</p>
        <button class="btn btn--ghost btn--block btn--sm" style="margin-top:10px"
          data-act="nav.chat" data-id="${o.id}">Add something to the record</button>`);
    }
  }

  if (r.isShop) {
    if (s === 'R_PLACED')   return panel('New order', B('stage.accept', 'Accept order'));
    if (s === 'R_ACCEPTED') return panel('Pack this order', B('stage.picking', 'Start packing'));
    if (s === 'R_PICKING')  return panel('Weigh and pack', `
      ${(o.lines || []).map(l => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--hairline)">
        <span class="tiny">${esc(l.name)} <span class="micro muted">× ${esc(l.qty)}</span>
          ${l.status === 'unavailable' ? '<span class="tag tag-accent">Refunded</span>' : l.status === 'substituted' ? '<span class="tag tag-neutral">Similar</span>' : ''}</span>
        ${['unavailable', 'substituted'].includes(l.status) ? '' : `<button class="btn btn--ghost btn--sm" data-act="retail.out"
          data-id="${o.id}" data-line="${l.lineId}">Not in stock</button>`}</div>
        ${l.variableWeight && !['unavailable', 'substituted'].includes(l.status) ? `
        <!-- THE SCALE. This screen was called "Weigh and pack" and had nothing to
             weigh with: pickedQty was never set by any control, so loose goods
             were always charged at the estimate the customer was shown. -->
        <div class="row" style="gap:8px;align-items:center;padding:0 0 8px">
          <span class="micro muted grow">Ordered ${esc(l.qty)} — what did it actually weigh?</span>
          <input class="input" style="width:92px" type="number" min="0" step="0.05"
            inputmode="decimal" data-role="picked" data-id="${o.id}" data-line="${l.lineId}"
            value="${l.pickedQty != null ? l.pickedQty : l.qty}">
        </div>` : ''}`).join('')}
      ${o.overEstimate ? `<p class="m-note" style="margin:8px 0 0">This weighs out at ${M.fmt(o.weighedTotal)} —
        ${M.fmt(o.overEstimate)} more than she agreed to. <b>She is not charged the extra.</b> Give her the
        weight she paid for, or message her and let her decide before you pack it.</p>` : ''}
      ${o.reweighed ? `<p class="m-note" style="margin:8px 0 0">Weighed lighter than the estimate — her bill
        has come down to ${M.fmt(o.customerPays)} and the difference goes back to her automatically.</p>` : ''}
      <div style="height:10px"></div>${B('stage.packed', 'Weighed & packed')}`);
    if (s === 'R_SUB_PENDING') return panel('Waiting for the customer', '<p class="tiny muted">They are choosing a substitute or a refund. No reply in 90 seconds means a refund for that item.</p>');
    if (s === 'R_PACKED')   return o.mode === 'pickup'
      ? panel('Packed — customer collects', B('retail.ready', 'Ready for pickup'))
      : panel('Hand over', B('stage.out', 'Out for delivery'));
    /* THE SHOP WAS SHOWN THE CUSTOMER'S PERMANENT CODE AND TOLD TO ASK FOR IT.
       That is the same code a plumber must type to prove he is standing at her
       door, it is hers for life, and it cannot be rotated — so every shop she
       ever ordered from learned it. The service side already refuses to print a
       specimen for exactly this reason and says so. The shop is told the shape
       and types what she says, like the pro does. */
    if (s === 'R_PICKUP_READY') return panel('Waiting at the counter', `
      <p class="tiny muted" style="margin:0 0 10px">Ask for their SAAHAA code when they collect —
        it starts with a letter and has eight digits after it.</p>
      <div class="field" style="margin-bottom:12px">
        <input id="otpCode" data-role="otp" autocapitalize="characters" autocomplete="off"
          spellcheck="false" maxlength="12" placeholder=" "
          style="letter-spacing:.12em;text-transform:uppercase">
        <label>${esc(t('door.pro.field'))}</label>
      </div>
      ${B('retail.collected', 'Check the code & hand it over')}`);
    if (s === 'R_RETURN') return panel('Return requested', `<p class="tiny muted" style="margin-bottom:10px">${esc(o.returnReason || '')}</p>${B('retail.acceptreturn', 'Accept return — refund in full')}`);
    if (s === 'R_OUT')      return panel('Ask for their code at the door', `
      <p class="tiny muted" style="margin:0 0 10px">Their own SAAHAA code — it starts with a letter and has
        eight digits after it. Typing it is how the handover is recorded.</p>
      <div class="field" style="margin-bottom:12px">
        <input id="otpCode" data-role="otp" autocapitalize="characters" autocomplete="off"
          spellcheck="false" maxlength="12" placeholder=" "
          style="letter-spacing:.12em;text-transform:uppercase">
        <label>${esc(t('door.pro.field'))}</label>
      </div>
      ${B('retail.delivered', 'Check the code & mark delivered')}`);
  }
  return '';
}
/* ONE CODE, EVERYWHERE. A person's SAAHAA code is 9 characters, not 4 digits,
   so it gets its own treatment: it must never overflow a 375px screen and it
   must be readable across a doorway. */
const codeBig = v => `<div class="num" style="text-align:center;font-size:clamp(24px,7.5vw,34px);letter-spacing:.12em;word-break:break-all">${esc(v)}</div>`;

/* WHERE THE JOB ACTUALLY IS. A pin on an area centroid is not an address, and
   for eight versions this is all a tradesperson got: a name, a distance and a
   dot in the middle of Madhapur. He now gets the door he has to knock on, as
   soon as the job is his, and it is selectable so he can paste it into his own
   maps app. Bookings taken before 8.6.0 have no address, so the block says so
   rather than pretending. */
function whereTo(o) {
  const addr = (o.customerAddress || '').trim();
  const mark = (o.customerLandmark || '').trim();
  const area = o.customerArea || '';
  return `<div class="card" style="padding:12px;margin-bottom:12px;background:var(--color-bg);color:var(--color-text)">
    <div class="m-cap" style="margin:0 0 4px">Where to go</div>
    ${addr ? `<div style="font:700 14px/1.35 var(--font-body);user-select:text">${esc(addr)}</div>` : ''}
    ${mark ? `<div class="tiny" style="margin-top:2px;user-select:text">Landmark: ${esc(mark)}</div>` : ''}
    <div class="micro muted" style="margin-top:${addr ? '4px' : '0'}">${esc(area)}${o.km != null ? ` · ${o.km} km away` : ''}</div>
    ${addr ? '' : `<p class="micro muted" style="margin-top:6px">This booking was taken before addresses were collected.
      Message the customer for the door number before you set out.</p>`}
    <button class="btn btn--ghost btn--sm" style="margin-top:8px" data-act="nav.chat" data-id="${esc(o.id)}">Message the customer</button>
  </div>`;
}

/* HOW LONG BEFORE "THEY NEVER ARRIVED" IS A FAIR THING TO SAY. The button used
   to appear the instant a job was assigned, and because nothing was recorded
   against the pro it was a repeatable ₹100 credit farm: book, tap, full refund
   plus the credit, repeat. A real no-show takes at least as long as the journey
   she was quoted, plus a grace period for traffic. */
const NO_SHOW_AFTER_MS = 20 * 60 * 1000;

/* The stage a person is looking at, in their own language. The engine keeps the
   English label as its source of truth (domain/orders.js) and a translation is
   looked up by stage id — so a language that has not translated a stage falls
   back to the engine's own word rather than to a blank. */
const stageLabel = st => {
  /* Written out rather than built as 'stage.' + id, so tools/lint-i18n.mjs can
     see each key. A key a static check cannot find is a key that silently rots
     — which is exactly how seven of these sat translated and unrendered. */
  switch (st.id) {
    case 'MATCHING':    return t('stage.MATCHING');
    case 'ASSIGNED':    return t('stage.ASSIGNED');
    case 'EN_ROUTE':    return t('stage.EN_ROUTE');
    case 'ARRIVED':     return t('stage.ARRIVED');
    case 'IN_PROGRESS': return t('stage.IN_PROGRESS');
    case 'WORK_DONE':   return t('stage.WORK_DONE');
    case 'SETTLED':     return t('stage.SETTLED');
    default:            return st.label;      // retail stages keep the engine's word
  }
};



/* What the customer is told about the deadline on her own job. A job under
   review has no clock at all and must not pretend to; one with a window states
   the hour, because "auto-releases" without a number is not information. */
function releaseLine(o) {
  const tier = ESCROW[o.escrowTier] || null;
  if (!tier || !isFinite(tier.holdMs)) {
    return `<p class="tiny" style="margin:0 0 10px;opacity:.85">A person at SAAHAA is checking this job before
      any money moves. Nothing releases on a timer while that is open.</p>`;
  }
  const at = (o.releaseAt || 0);
  const left = at - Date.now();
  if (left <= 0) return `<p class="tiny" style="margin:0 0 10px;opacity:.85">Confirm to release it now.</p>`;
  const h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60000);
  const when = h ? `${h}h ${m}m` : `${m} min`;
  return `<p class="tiny" style="margin:0 0 10px;opacity:.85">Confirm when you are happy with the work.
    If you do nothing, this releases by itself in <b>${when}</b> — so look at the pictures before then,
    or report a problem and the money stops where it is.</p>`;
}

/* the "what happens next" block: a strong moment, so it is ink-inverted */
const panel = (title, body) => `<div class="sec"><div class="on-plum" style="padding:14px">
  <p class="m-cap" style="color:color-mix(in srgb,var(--color-bg) 70%,transparent)">What happens next</p>
  <b style="display:block;font:800 17px/1.2 var(--font-heading);margin-bottom:12px">${esc(title)}</b>${body}</div></div>`;

/* ── dispute: 3 taps ───────────────────────────────────────────
   THE PRO USED TO GET THE CUSTOMER'S LIST. His "Report an issue" offered him
   Not done, Damage, Overcharged and Rude or unsafe — seven accusations against
   himself, every one of which froze his own payment. Each side now gets the
   things that actually go wrong on their side of the doorstep. */
export function openDispute(orderId) {
  const s = me() || {};
  const mine = flow.reasonsFor(s.role);
  const isPro = s.role === 'partner' || s.role === 'shop';
  sheet(isPro ? 'Something is wrong at this job' : 'Report an issue', `
    <p class="tiny muted" style="margin-bottom:14px">Pick what happened. The money on this job freezes immediately, on both sides.</p>
    <p class="m-note" style="margin-bottom:14px">${isPro
      ? 'Nothing here counts against you by itself. It stops the clock and puts the job in front of the owner with your reason on it.'
      : 'Your money is <b>frozen on tap</b> and stays with SAAHAA until the owner has read both sides.'}</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${mine.map(r => `<button class="chip" data-act="dispute.pick"
        data-id="${orderId}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <p class="micro muted" style="margin-top:16px">${isPro
      ? 'Most are settled within 24 hours. Your stake is not forfeit for raising this — only an upheld complaint against you moves it.'
      : 'Most issues are settled within 24 hours. If your pro never arrived and no start code was entered, you are refunded in full.'}</p>${SYS_CSS}`);
}

/* THE NO-SHOW BUTTON THAT WAS NEVER WIRED. CANCEL_RULES.WORKER_NO_SHOW — a
   full refund plus a credit — has been in the engine since v6 with nothing able
   to call it, while the only control on screen when a pro fails to arrive was
   Cancel, which at EN_ROUTE hands 40% of her money to a journey nobody made.
   The refunds page has been publishing that rule the whole time. */
export function openNoShow(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const p = getState().partners.find(x => x.id === o.partnerId) || null;
  const split = cancelSplit(o.deal, 'WORKER_NO_SHOW', { markup: markupFor(p) });
  const first = String(o.partnerName || 'Your pro').split(' ')[0];
  sheet('They never arrived?', `
    <p>${esc(first)} has not entered your code, so nothing has started. This is on them, not on you.</p>
    <div class="m-kv" style="margin-top:14px"><span>You paid</span><span class="num">${M.fmt(o.customerPays)}</span></div>
    <div class="m-kv"><span>Back in your wallet</span><span class="num">${M.fmt(split.refund)}</span></div>
    ${split.credit ? `<div class="m-kv"><span>Credit for the wasted wait</span><span class="num">${M.fmt(split.credit)}</span></div>` : ''}
    <div class="m-kv"><span>${esc(first)} keeps</span><span class="num">${M.fmt(split.worker)}</span></div>
    <p class="micro muted" style="margin:12px 0 0">Every rupee comes back${split.credit ? `, and ${M.fmt(split.credit)} is added for the trouble` : ''}.
      It is recorded against them, so it cannot happen quietly twice.</p>
    <button class="btn btn-primary btn--block" style="margin-top:14px"
      data-act="noshow.confirm" data-id="${esc(orderId)}">They did not come — refund me</button>
    <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px" data-act="sheet.close">Wait a bit longer</button>
    ${SYS_CSS}`);
}
export function submitDispute(orderId, reason) {
  flow.raiseDispute(orderId, reason, '');
  closeSheet();
  ctx.render();
}

/* CANCELLING WITHOUT A NUMBER. The sheet said "they keep a small travel
   compensation" and "more than 2 hours before the slot" — a word for an
   amount, and a slot this booking does not have. `cancelSplit()` is the same
   function `flow.cancelOrder()` settles by, priced at the same markup the
   booking was escrowed at, so the three lines below are exactly what will
   happen when the button is pressed. */
export function openCancel(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const rule = o.stage === 'MATCHING' ? 'BEFORE_ACCEPT' : o.stage === 'EN_ROUTE' ? 'EN_ROUTE' : 'AFTER_ACCEPT_2H';
  const p = getState().partners.find(x => x.id === o.partnerId) || null;
  const split = cancelSplit(o.deal, rule, { markup: markupFor(p) });
  const first = String(o.partnerName || 'Your pro').split(' ')[0];
  sheet('Cancel booking?', `
    <p>${rule === 'BEFORE_ACCEPT' ? 'No pro has accepted this job yet.'
        : rule === 'EN_ROUTE' ? `${esc(first)} is already travelling to you.`
        : `${esc(first)} has accepted but has not set out yet.`}</p>
    <div class="m-kv" style="margin-top:14px"><span>You paid</span><span class="num">${M.fmt(o.customerPays)}</span></div>
    ${split.worker ? `<div class="m-kv"><span class="muted">${esc(first)} keeps, for the journey</span><span class="num">${M.fmt(split.worker)}</span></div>` : ''}
    ${split.platform > 0 ? `<div class="m-kv"><span class="muted">SAAHAA keeps</span><span class="num">${M.fmt(split.platform)}</span></div>` : ''}
    <div class="m-kv m-kv--total"><span>Back in your wallet</span><span class="num">${M.fmt(split.refund)}</span></div>
    <p class="micro muted" style="margin-top:8px">It lands in your SAAHAA wallet, to spend on the next job or to take out to your UPI.</p>
    <button class="btn btn--danger btn--block" style="margin-top:16px"
      data-act="cancel.confirm" data-id="${orderId}" data-rule="${rule}">Yes, cancel · ${M.fmt(split.refund)} back</button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="sheet.close">Keep it</button>${SYS_CSS}`);
}
