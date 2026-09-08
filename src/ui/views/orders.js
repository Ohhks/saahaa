/* SAAHAA · ui/views/orders.js — order list, live tracker, OTP, evidence,
   chat and the 3-tap dispute.

   MODERNIST. The mockup's 1c "Order tracking": the order number and shop
   line in the header, the map, the person-on-the-way line, the stepped
   timeline with times, and the items / delivery / total block. The service
   order carries the same hierarchy; the ratings panel is 1d "Ratings &
   reviews". One rule governs this screen: nobody should ever have to hunt for
   the status, and the one thing you can do about it sits right under it.

   The stage labels are the machine's own. They are never renamed here. Every
   rupee is the order's: deal, platformFee, gst, deliveryFee, customerPays. */

import { mount, esc, sheet, closeSheet, toast, clockTime, timeAgo } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage, canTransition, isTerminal } from '../../domain/orders.js';
import { kmBetween, etaMins, geoOf, nameOf } from '../../domain/match.js';
import * as gmap from '../map.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import * as gateway from '../../core/gateway.js';
import { getPricing } from '../../domain/settings.js';
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

function mapCard(o, { interactive = true, id = 'orderMap' } = {}) {
  const e = endsOf(o);
  const km = kmBetween(e.cust, e.them);
  const eta = etaMins(km);
  const plotted = !!(geoOf(e.cust) && geoOf(e.them));
  return `<div style="${interactive ? 'margin:0 calc(-1 * var(--gutter));' : ''}border-bottom:2px solid var(--color-text);position:relative">
    <div id="${id}" style="height:${interactive ? 200 : 160}px;overflow:hidden;background:var(--surface-2)"></div>
    <span style="position:absolute;left:12px;bottom:10px;background:var(--surface);border:2px solid var(--color-text);padding:5px 9px;font:800 10px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase">${esc(e.name)} · ${km} km · ~${eta} min</span>
    <span style="position:absolute;right:12px;top:10px;background:var(--color-accent);color:#fff;padding:5px 9px;font:800 10px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase">You · ${esc(nameOf(e.cust))}</span>
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
        <div class="m-row__m">${esc(who)} · ${esc(st.label.toLowerCase())}${live ? ` · step ${idx + 1} of ${track.length}` : ''} · ${timeAgo(o.createdAt)}</div>
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
  const who = o.kind === 'service' ? o.partnerName : o.shopName;
  const placed = clockTime(o.createdAt);

  sweepMaps();
  setTimeout(() => {
    if (showMap) mountMap(o.id, 'orderMap', true); else kill('orderMap');
    if (document.getElementById('jobMap')) mountMap(o.id, 'jobMap', false); else kill('jobMap');
  }, 0);

  const pct = o.deal ? Math.round(((o.platformFee | 0) + (o.gst | 0)) / o.deal * 100) : 0;

  return `
  ${header(`Order ${orderNo(o)}`, `${who} · placed ${placed}`)}
  <main class="wrap">

    ${showMap ? mapCard(o) : ''}

    <!-- STATUS IS THE HERO. The person on the way, the stage, the one thing to do. -->
    <div class="row" style="gap:10px;padding:12px 0;border-bottom:2px solid var(--color-divider)">
      <span class="thumb m-thumb" style="width:40px;height:40px" aria-hidden="true">${hasIcon(cat.id) ? icon(cat.id, { size: 18 }) : icon('box', { size: 18 })}</span>
      <div class="grow" style="min-width:0">
        <div style="font:800 13.5px/1.2 var(--font-heading)">${esc(who)} · ${esc(st.label.toLowerCase())}</div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px">${running
          ? `${km} km away · ~${o.eta || etaMins(km)} min · step ${idx + 1} of ${track.length}`
          : `${esc(st.short)} · ${timeAgo(o.createdAt)}`}</div>
      </div>
      <button class="btn btn--secondary btn--sm tap" data-act="order.map" data-id="${esc(o.id)}"
        aria-pressed="${showMap}" style="font-size:11px;letter-spacing:.04em;min-height:44px">${showMap ? 'HIDE MAP' : 'MAP'}</button>
    </div>

    ${o.otp && running && isCustomer && o.stage !== 'ARRIVED' && o.stage !== 'R_PICKUP_READY' ? `
      <div class="between" style="padding:9px 0;border-bottom:1px solid var(--color-divider)">
        <span class="tiny muted">Your 4-digit code — share it only at the door</span>
        <b class="num" style="font-size:17px;letter-spacing:.14em">${esc(o.otp)}</b></div>` : ''}

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
            <div class="m-kv"><span class="muted">SAAHAA charge · ${pct}% on top</span><span class="num">${M.fmt(o.platformFee)}</span></div>
            <div class="m-kv"><span class="muted">GST on that charge</span><span class="num">${M.fmt(o.gst)}</span></div>
            <div class="m-kv m-kv--total"><span>You pay${o.provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(o.customerPays)}</span></div>
            <p class="micro muted" style="margin-top:8px">${esc(paidWith(o))}. ${esc(o.partnerName)} receives the full ${M.fmt(o.deal)} —
              SAAHAA holds it until you confirm the work and never takes a cut of their quote.</p>
            ${o.saved ? `<p class="micro" style="margin-top:6px;color:var(--color-accent)">You saved ${M.fmt(o.saved)} against a commission app — and your pro was paid more.</p>` : ''}
          </div>` : `
          <div class="sec">
            <p class="m-cap">${o.lines.length} item${o.lines.length === 1 ? '' : 's'}${o.provisional ? ' · est. until weighed' : ''}</p>
            ${o.lines.map(l => `<div class="m-kv"><span>${esc(l.name)} × ${l.qty}${l.variableWeight ? ' (est.)' : ''}${
              l.status === 'unavailable' ? ' <span class="tag tag-accent">refunded</span>' : l.status === 'substituted' ? ' <span class="tag tag-neutral">similar</span>' : ''}</span>
              <span class="num">${M.fmt(l.unitPrice * l.qty)}</span></div>`).join('')}
            <div class="m-kv"><span class="muted">Delivery${o.mode === 'pickup' ? ' · pickup' : ''}</span><span class="num">${o.deliveryFee ? M.fmt(o.deliveryFee) : 'Free'}</span></div>
            <div class="m-kv m-kv--total"><span>Total${o.provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(o.customerPays)}</span></div>
            <p class="micro muted" style="margin-top:8px">${esc(paidWith(o))}. Held by SAAHAA until you confirm the delivery; an item the shop could not supply comes back to your wallet.</p>
          </div>`}

        <div class="sec">
          <div class="between" style="margin-bottom:6px"><p class="m-cap" style="margin:0">Messages</p>
            <button class="more tap" data-act="nav.chat" data-id="${esc(o.id)}"
              style="min-height:44px;padding-inline:2px">${chats.length ? `Open all ${chats.length} →` : `Message ${esc((who || '').split(' ')[0])} →`}</button></div>
          <div style="max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
            ${chats.length ? chats.slice(-4).map(m => `<div class="msg${s && m.name === s.name ? ' mine' : ''}">
              <span class="micro" style="display:block;opacity:.7">${esc(m.name)} · ${clockTime(m.ts)}</span>
              ${esc(m.text)}
              ${m.flagged ? '<span class="micro" style="display:block;margin-top:4px;opacity:.8">Contact details hidden — keep payments in SAAHAA.</span>' : ''}
            </div>`).join('') : '<p class="tiny muted">No messages yet.</p>'}
          </div>
          ${(isCustomer || isPartner || isShop) ? `
          <div class="row" style="margin-top:10px;gap:0;border:1px solid var(--color-divider)">
            <input id="chatIn" class="grow" placeholder="Message"
              style="height:44px;padding:0 12px;border:0;background:var(--surface);color:var(--ink-1);font-size:14px;min-width:0">
            <button class="btn btn--primary" style="min-height:44px;padding-inline:14px" data-act="chat.send" data-id="${o.id}" aria-label="Send">↑</button>
          </div>` : '<p class="micro muted" style="margin-top:10px">Sign in to reply.</p>'}
        </div>

        ${(isCustomer || isPartner || isShop) && canTransition(o.stage, 'DISPUTED') ? `
        <button class="btn btn--ghost btn--block" style="margin-top:12px;color:var(--danger)"
          data-act="dispute.open" data-id="${o.id}">Report an issue</button>` : ''}
      </div>
    </div>
    <div style="height:40px"></div>
  </main>${SYS_CSS}`;
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
function jobCard(o, cat) {
  const P = getPricing();
  const title = o.kind === 'service'
    ? `${cat.name}${o.sub ? ' · ' + o.sub : ''}`
    : `${(o.lines || []).length} item${(o.lines || []).length === 1 ? '' : 's'} from ${o.shopName || ''}`;
  const pct = o.deal ? Math.round(((o.platformFee | 0) + (o.gst | 0)) / o.deal * 100) : P.serviceMarkupPct;
  return `<div class="ch-job">
    <p class="m-cap" style="margin:0">Job confirmed</p>
    <b>${esc(title)} · ${M.fmt(o.kind === 'service' ? o.deal : o.customerPays)}</b>
    <p class="micro muted" style="margin:4px 0 0">${o.kind === 'service'
      ? `${esc(o.partnerName || '')} keeps the full ${M.fmt(o.deal)}. You pay ${M.fmt(o.customerPays)} — SAAHAA's ${pct}% sits on top of the quote and is held until you confirm the work.`
      : `You pay ${M.fmt(o.customerPays)}, held by SAAHAA until you confirm the delivery. SAAHAA's charge on a shop order comes out of the shop's side, not your basket.`}</p>
  </div>`;
}

export function renderChat(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return renderList();
  const s = me();
  const cat = get('category', o.catId);
  const st = stage(o.stage);
  const who = (o.kind === 'service' ? o.partnerName : o.shopName) || 'SAAHAA';
  const msgs = getState().chats[o.id] || [];
  const isCustomer = !!(s && o.customerKey === s.key);
  const isPartner = !!(s && s.role === 'partner' && getState().partners.some(p => p.userKey === s.key && p.id === o.partnerId));
  const isShop = !!(s && s.role === 'shop' && getState().shops.some(x => x.ownerKey === s.key && x.id === o.shopId));
  const canPost = isCustomer || isPartner || isShop;

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
      ${m.flagged ? '<span class="micro" style="display:block;margin-top:4px;opacity:.85">Contact details hidden — keep the job and the payment inside SAAHAA and you are both covered.</span>' : ''}
    </div>`;
  }).join('');

  return `${CHAT_CSS}
  <header class="apphdr ch-hdr">
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="nav.back" aria-label="Back">${icon('back', { size: 18 })}</button>
    <span class="thumb" style="width:34px;height:34px;display:grid;place-items:center;color:var(--ink-3)" aria-hidden="true">${
      hasIcon(cat.id) ? icon(cat.id, { size: 16 }) : icon('chat', { size: 16 })}</span>
    <div class="grow" style="min-width:0">
      <div class="ch-who">${esc(who)}</div>
      <div class="ch-state">${esc(st.label)} · ${M.fmt(o.kind === 'service' ? o.deal : o.customerPays)} · ${esc(clockTime(o.createdAt))}</div>
    </div>
    <button class="btn btn-secondary" style="flex:none" data-act="order.open" data-id="${esc(o.id)}">Order</button>
  </header>

  <main class="wrap ch-wrap">
    <div id="chatThread" class="ch-thread">
      ${jobCard(o, cat)}
      ${thread || `<p class="tiny muted" style="text-align:center;margin:auto 0">No messages yet. Say what you need — ${esc(who.split(' ')[0])} sees it straight away.</p>`}
    </div>

    ${canPost ? `<div class="ch-bar">
      <input id="chatIn" class="grow ch-in" placeholder="Message ${esc(who.split(' ')[0])}" aria-label="Message ${esc(who)}">
      <button class="btn btn--primary ch-send" data-act="chat.send" data-id="${esc(o.id)}" aria-label="Send">↑</button>
    </div>
    <p class="micro muted ch-foot">Phone numbers and payment ids are hidden automatically. Keep the money in SAAHAA:
      it is held until you confirm the work, and it is the only thing a dispute can be settled from.</p>`
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

/* the one panel that changes with role + stage — everything derived, no switch
   on a hard-coded id list */
function actionPanel(o, r) {
  const s = o.stage;
  const B = (act, label, cls = 'btn--primary') =>
    `<button class="btn ${cls} btn--lg btn--block" style="justify-content:flex-start" data-act="${act}" data-id="${o.id}">${label}</button>`;

  if (r.isPartner) {
    if (s === 'MATCHING')    return panel('New job for you', B('stage.accept', 'Accept this job'));
    if (s === 'ASSIGNED')    return panel('Head to the customer', B('stage.enroute', 'Start travelling'));
    /* The pro is travelling to a place, not to a word. The same map the
       customer is looking at, without the controls. */
    if (s === 'EN_ROUTE')    return panel('Arrived?',
      `${mapCard(o, { interactive: false, id: 'jobMap' })}
       <div style="height:12px"></div>${B('stage.arrived', "I've arrived")}`);
    if (s === 'ARRIVED')     return panel('Ask the customer for their 4-digit code', `
      ${mapCard(o, { interactive: false, id: 'jobMap' })}
      <div style="height:12px"></div>
      <div class="otp-row" style="justify-content:center;margin-bottom:14px">
        ${[0,1,2,3].map(i => `<input id="otp${i}" inputmode="numeric" maxlength="1" data-role="otp" class="input" style="width:56px">`).join('')}
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
      <div class="m-kv" style="margin-bottom:10px"><span>Held by SAAHAA for ${esc(o.partnerName)}</span>
        <span><b class="num">${M.fmt(o.deal)}</b> <span class="state state--held">not yet released</span></span></div>
      ${B('release.full', `Confirm & release ${M.fmt(o.deal)}`)}
      <button class="btn btn--ghost btn--block" style="margin-top:8px;color:var(--danger)"
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
    if (s === 'R_DELIVERED') return panel('Delivered — confirm', `${B('retail.settle', 'Confirm delivery')}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--danger)"
        data-act="retail.return" data-id="${o.id}">Something was wrong — return this order</button>`);
    if (s === 'R_PICKUP_READY') return panel('Ready at the shop — collect it', `
      <p class="tiny muted" style="margin-bottom:10px">Show this code at the counter.</p>
      <div style="text-align:center" class="num num-xl">${esc(o.otp)}</div>
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
    if (['MATCHING','ASSIGNED','EN_ROUTE'].includes(s))
      return panel('Need to cancel?', `<button class="btn btn--ghost btn--block" style="color:var(--danger)"
        data-act="cancel.open" data-id="${o.id}">Cancel this booking</button>`);
  }

  if (r.isShop) {
    if (s === 'R_PLACED')   return panel('New order', B('stage.accept', 'Accept order'));
    if (s === 'R_ACCEPTED') return panel('Pack this order', B('stage.picking', 'Start packing'));
    if (s === 'R_PICKING')  return panel('Weigh and pack', `
      ${(o.lines || []).map(l => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--hairline)">
        <span class="tiny">${esc(l.name)} <span class="micro muted">× ${esc(l.qty)}</span>
          ${l.status === 'unavailable' ? '<span class="tag tag-accent">Refunded</span>' : l.status === 'substituted' ? '<span class="tag tag-neutral">Similar</span>' : ''}</span>
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
/* the "what happens next" block: a strong moment, so it is ink-inverted */
const panel = (title, body) => `<div class="sec"><div class="on-plum" style="padding:14px">
  <p class="m-cap" style="color:color-mix(in srgb,var(--color-bg) 70%,transparent)">What happens next</p>
  <b style="display:block;font:800 17px/1.2 var(--font-heading);margin-bottom:12px">${esc(title)}</b>${body}</div></div>`;

/* ── dispute: 3 taps ───────────────────────────────────────── */
export function openDispute(orderId) {
  sheet('Report an issue', `
    <p class="tiny muted" style="margin-bottom:14px">Pick what went wrong. Your money freezes immediately.</p>
    <p class="m-note" style="margin-bottom:14px">Your money is <b>frozen on tap</b> and stays with SAAHAA until the owner has read both sides.</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${flow.DISPUTE_REASONS.map(r => `<button class="chip" data-act="dispute.pick"
        data-id="${orderId}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <p class="micro muted" style="margin-top:16px">
      Most issues are settled within 24 hours. If your pro never arrived and no start code was
      entered, you are refunded in full automatically.</p>${SYS_CSS}`);
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
  sheet('Cancel booking?', `
    <p>${rule === 'BEFORE_ACCEPT' ? 'No pro has accepted yet — you get a full refund.'
        : rule === 'EN_ROUTE' ? 'Your pro is already travelling. They keep a small travel compensation.'
        : 'More than 2 hours before the slot — full refund.'}</p>
    <button class="btn btn--danger btn--block" style="margin-top:16px"
      data-act="cancel.confirm" data-id="${orderId}" data-rule="${rule}">Yes, cancel</button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="sheet.close">Keep it</button>`);
}
