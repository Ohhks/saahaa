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
import { subKey } from '../../domain/catalog.services.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { trackerFor, trackerIndex, stage, canTransition, isTerminal, isDone } from '../../domain/orders.js';
import { kmBetween, etaMins, geoOf, nameOf } from '../../domain/match.js';
import * as gmap from '../map.js';
import * as photo from '../photo.js';
import * as flow from '../../domain/flow.js';
import * as PAY from '../../domain/payments.js';
import * as flags from '../../core/flags.js';
import * as M from '../../core/money.js';
import * as W from '../../domain/wallet.js';
import * as gateway from '../../core/gateway.js';
import { getPricing } from '../../domain/settings.js';
import { cancelSplit, CANCEL_RULES } from '../../domain/pricing.js';
import { markupFor, ESCROW, effectiveCap } from '../../domain/trust.js';
import { t, catName, subName } from '../i18n.js';
import { header, emptyBlock, SYS_CSS } from './shops.js';
/* When the product started collecting a real door number (8.6.0, services) —   so an order older than this genuinely predates the field and one newer than   it genuinely just does not have one. A guess about a date belongs in one   named constant, not inside a sentence shown to a tradesperson. */const ADDRESSES_SINCE = Date.parse('2026-09-01T00:00:00Z');

/* How the order was paid. EVERYONE PAYS SAAHAA: the wallet is drawn first
   and only the shortfall is collected through the gateway. Orders written
   before 7.0 carry neither field — they were collected in one go. */
/* THE ROUNDED DEAL, ANYWHERE. `dealText(o)` is only in scope inside the detail
   view, and replacing every raw `M.fmt(o.deal)` with it put an undefined name
   into three other functions — the screen caught it and painted the error page.
   The rounding is a property of the ORDER, so it lives in a function that takes
   one, and every screen that names the pro's price calls it. */
/* AND THIS CALL SITE NEVER GOT THE FIX. `absorb` was added to core/money.js
   for exactly this defect, and applied to the bill twelve lines down -- not
   here. So the release line and its button read "₹539" while the bill on the
   same screen read "₹540" and said he "receives the full ₹540". An audit
   pointed at the comment in money.js describing the bug it was still shipping.
   Index 1 is SAAHAA's fee: it absorbs the rounding, his quote never does. */
/* WHAT THE SHOP GAVE AWAY, ONE DEFINITION. The weigh screen said "₹73 more
   than she agreed to" while the bill three lines down said "− ₹91.99", and both
   were true of different things: the goods went up ₹92, but the heavier basket
   crossed the shop's free-delivery line, so her TOTAL would only have risen ₹73.
   A shopkeeper reads those as one number, and the one that matters to him is
   the stock leaving his shelf unpaid. This is the figure the bill column needs
   in order to sum, so both places quote it. */
const giveawayOf = o => {
  /* AND ONCE A RETURN LANDED, THIS SWALLOWED THE REFUND TOO. `customerPays`
     falls by the refund, so the residual grew by it: the bill read "Returned —
     refunded to you − ₹104.00" where ₹83.60 went back and ₹20.40 was free
     weight, three lines above a sentence correctly saying "₹84 back to the
     customer". One number doing two jobs, on the screen a shopkeeper checks to
     see what a return cost. The returned lines are not part of this: they have
     a line of their own. */
  const back = new Set(o.returnLines || []);
  const kept = (o.lines || []).filter(l => !back.has(l.lineId)).reduce((n, l) =>
    n + Math.round((l.unitPrice | 0) * (l.pickedQty != null ? l.pickedQty : l.qty)), 0);
  return Math.max(0, kept + (o.deliveryFee | 0) - (o.customerPays | 0));
};

const dealShown = o => M.roundParts(
  [o.deal | 0, o.platformFee | 0, o.gst | 0], o.customerPays | 0, { absorb: 1 })[0];
const dealText = o => M.fmt(dealShown(o));

function paidWith(o, showing) {
  if (o.paidFromWallet == null && o.collected == null) return 'Paid via UPI';
  const parts = [];
  /* "₹17 from wallet · ₹999 via UPI" under a total of ₹1,017 — the last bare
     pair of independently-rounded figures on the order screen. */
  /* AND AFTER A RE-WEIGH THIS WAS THE WRONG TOTAL. `customerPays` comes DOWN
     when the shop weighs short, while what she actually handed over does not —
     so this asked the helper to fit ₹1,413 of payments into a ₹1,376 order and
     the guard had to rescue it. What she paid is the sum of what she paid. */
  const paidRow = M.fmtParts([o.paidFromWallet | 0, o.collected | 0],
    (o.paidFromWallet | 0) + (o.collected | 0));
  if (o.paidFromWallet > 0) parts.push(`${paidRow[0]} from wallet`);
  if (o.collected > 0) parts.push(`${paidRow[1]} via ${gateway.label().split(' — ')[0]}`);
  /* AT AWAITING_APPROVAL ONLY THE ESTIMATE HAS BEEN COLLECTED. The pair is
     internally exact now and still sat under a total ₹816 larger, with nothing
     saying why. A figure that is deliberately short says so. */
  /* AND THE CLAUSE NEVER FIRED, because this compared against `customerPays` —
     which at AWAITING_APPROVAL is still the ESTIMATE, so `owed` was zero while
     the bill above printed the proposal. The bill has to tell this function
     which total it is showing, or the two describe different orders. */
  const got = (o.paidFromWallet | 0) + (o.collected | 0);
  const owed = ((showing == null ? o.customerPays : showing) | 0) - got;
  if (parts.length && owed > 0) parts.push(`${M.fmt(owed)} more when the price is agreed`);
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

  /* AND MY OWN FIX MADE HER FINISHED JOB DISAPPEAR ALTOGETHER. `live` became
     `!isDone` and `past` stayed `isTerminal` — and SETTLED is "done" without
     being "terminal", so it belonged to neither list. The header counted two
     orders over a list of one, and the receipt for the job she had just paid
     for, with its proof-of-work photo and its unrated stars, was simply gone.
     Two predicates that are meant to partition a list must be one predicate
     and its negation, or they leave a hole. */
  const liveList = list.filter(o => !isDone(o.stage));
  const past = list.filter(o => isDone(o.stage));

  const row = (o, live) => {
    const st = stage(o.stage);
    const cat = get('category', o.catId);
    const track = trackerFor(o.kind); const idx = trackerIndex(o);
    const title = o.kind === 'service' ? `${catName(cat)}${o.sub ? ' · ' + subName(o.sub, subKey(o.sub)) : ''}` : `${o.lines.length} item${o.lines.length === 1 ? '' : 's'} from ${o.shopName}`;
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
        <span class="grow"><!-- the header resolved these through stageLabel and the TIMELINE did
               not, so the translations sat unused and a Telugu customer watched
               an English tracker for the whole delivery -->
          <span class="m-step__t" style="display:block">${esc(stageLabel(sg))}</span>
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
  /* the day after a grocery order closes, in which she can still say something
     went wrong — domain/flow.js `complaintWindow` */
  const win = flow.complaintWindow(o);
  /* the service bill, rounded ONCE so the column adds up on screen — the three
     lines are derived from the total, never formatted independently */
  /* WHILE SHE IS BEING ASKED TO APPROVE A NEW PRICE, THE BILL SHOWED THE OLD
     ONE. At AWAITING_APPROVAL `o.deal` and `o.customerPays` still hold the
     estimate — they are not repointed until she taps approve — so the panel
     above said "his price ₹942 · you pay ₹1,017" under a quote of ₹1,200, and
     the only Telugu money sentence on the screen stated the superseded figure.
     The proposal is what is on the table; the bill shows the proposal. */
  const pending = o.stage === 'AWAITING_APPROVAL' && o.proposedDeal != null;
  const billDeal = pending ? o.proposedDeal : (o.deal | 0);
  const billPays = pending ? o.proposedPays : (o.customerPays | 0);
  const billFee = pending ? Math.max(0, billPays - billDeal - Math.round((billPays - billDeal) * 0.18 / 1.18)) : (o.platformFee | 0);
  const billGst = pending ? Math.max(0, billPays - billDeal - billFee) : (o.gst | 0);
  /* BOTH BILL SHAPES WERE COMPUTED FOR EVERY ORDER. A retail order ran the
     service arithmetic and a service order ran the retail arithmetic, so two of
     the five guard trips in one session were screens computing a bill for a
     kind of order they were never going to render. */
  /* ONE NUMBER FOR ONE JOB. `billRow[0]` is the rounded deal the bill prints;
     eight other places printed `M.fmt(o.deal)` raw, and on a ₹402.40 quote the
     two differ by a rupee — so she was asked to authorise "Confirm & release
     ₹402" four inches under a bill reading ₹403, and the pro read "receives the
     full ₹403" directly above "the whole ₹402 is yours". That is the single
     moment this product exists for, and it disagreed with itself.

     `M.fmt(o.deal)` does not appear in this file any more. */
  const billParts = o.kind === 'service'
    /* index 1 is SAAHAA's own fee: it absorbs the rounding so the worker's
       quote reads the same rupee here as on the booking sheet, which splits
       the identical bill two ways instead of three. */
    ? M.roundParts([billDeal, billFee, billGst], billPays, { absorb: 1 })
    : [0, 0, 0];
  const billRow = billParts.map(v => M.fmt(v));
  /* has the shop actually weighed it, and what came back because of that */
  const weighed = !!(o.lines || []).some(l => l.pickedQty != null);
  const backToHer = (o.reweighRefund | 0) || Math.max(0, (o.agreedTotal | 0) - (o.customerPays | 0));
  /* THE GROCERY RECEIPT WAS THE PANEL LEFT BEHIND. Its lines were formatted
     independently and summed ₹485 under a total of ₹486, with "₹18.58 back to
     you" beside a difference of ₹18 — three figures, three stories, on the one
     screen the product invites her to police after a short weigh. The service
     bill twelve lines up got this treatment and this did not.

     The refund is stated as the difference between the two figures SHE CAN SEE.
     A receipt that cannot be checked is not a receipt. */
  /* EACH LINE PRINTS WHAT SHE WAS BILLED FOR IT, which on an over-weighed item
     is the quantity she agreed to and not the heavier quantity that was packed.
     Printing the weighed value put the column ₹220 out on a settled receipt:
     the returned mutton showed at its weighed ₹1,100 while the refund -- rightly
     -- gave back the ₹880 she had paid, and the difference had nowhere to go.
     Billed values make the column close by construction: lines + delivery minus
     anything returned IS what she pays, which is what the total says. The stock
     the shop gave away is real and still told to him, as a sentence, because it
     is a fact about his shelf and not a line in her bill. */
  const billedQty = l => (l.pickedQty != null ? Math.min(l.pickedQty, l.qty) : l.qty);
  const retailParts = (o.lines || []).map(l => Math.round((l.unitPrice | 0) * billedQty(l)))
    .concat([o.deliveryFee | 0]);
  /* AND THE RECEIPT WALKED INTO THE TRAP FROM THE OTHER SIDE. The cart rounds
     each line honestly and this forced the column to sum, dumping the drift on
     the largest line — so a ₹702 can on the shelf and in the cart became ₹701
     on the order, and the rupee appeared only AFTER she had paid. Two rounding
     regimes for one shelf is the defect either way round.

     One regime: every line prints its own honest rounding on both screens, and
     the total shows paise when the column cannot be added up in whole rupees.
     A receipt that is checkable is worth more than a receipt that is tidy. */
  /* AND IT STOPPED EXACTLY HALF WAY. The check below is right -- it notices
     when the column cannot be added up in whole rupees -- and then it moved
     only the TOTAL to paise. So she read

         28 + 279 + 142 + 344 + 42   beside   Total 836.76

     and the 1.76 was nowhere on the screen. Showing paise on the total alone
     does not make a column checkable; it only makes the mismatch visible and
     leaves her to wonder who took the rupee. If the receipt has to descend to
     paise, the WHOLE column descends with it -- and 28.49 is the number on the
     shelf and in the cart anyway, so this is also the regime that agrees with
     the other two screens. One receipt, one precision, and it adds up. */
  /* SHE WAS GIVEN ₹25.87 AND NEVER TOLD. When a basket weighs HEAVIER than
     ordered the shop absorbs it -- her total stays at what she agreed -- but the
     item lines are printed at the weighed quantity, so her column summed
     ₹2,530.78 above a total reading ₹2,504.91 with nothing between them. The
     shop's own screen says "She is not charged the extra"; hers did not. Good
     news, invisible, on a receipt that then failed to add up. */
  /* ONE SOURCE FOR ONE FACT. The money block reads the stored measurement and
     this derived its own, so the same giveaway printed ₹352.00 in one place and
     ₹142.00 four lines below it on the same screen — the derived one had the
     returned item subtracted out of it, which is a different quantity entirely.
     And now that the lines print BILLED values the derived figure is
     structurally zero anyway. What the shop handed over unpaid is measured at
     the scale and recorded on the order; both screens read that. */
  const notCharged = o.overWeighAbsorbed | 0;
  const retailShown = retailParts.reduce((n, v) => n + Math.round(v / 100) * 100, 0);
  const needsPaise = retailShown - Math.round(notCharged / 100) * 100
    !== Math.round((o.customerPays | 0) / 100) * 100;
  const retailRow = retailParts.map(v => needsPaise ? M.fmt2(v) : M.fmt(v));
  const totalShown = needsPaise ? M.fmt2(o.customerPays) : M.fmt(o.customerPays);
  const shownBack = Math.max(0, Math.round((o.agreedTotal | 0) / 100) * 100 - Math.round((o.customerPays | 0) / 100) * 100);
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
  /* A CANCELLED JOB STILL SAID "You pay ₹875". The bill is written in the
     present tense because almost every stage it renders in IS the present --
     but on a cancelled or refunded order the money has already gone back, and
     the paragraph directly above it says so. One screen, both directions, on
     the question of whether she owes anything. Past tense once it is past. */
  const settledUp = ['CANCELLED', 'REFUNDED', 'R_CANCELLED', 'R_REFUNDED'].includes(o.stage);
  const payer = t(settledUp ? 'bill.youPaid'
    : (isPartner || isShop) ? 'bill.customerPays' : 'bill.youPay');
  /* the open complaint on THIS order, whatever stage it is in */
  /* NOT `openDispute` — that is an exported FUNCTION in this module, the sheet
     opener. A const of the same name shadows it inside this render, and the
     day someone calls it here they get a dispute object instead. Worse, it hid
     its own absence: with the const removed the name still resolved, to a
     truthy function, so the banner rendered unconditionally with undefined
     fields and the render gate could not tell the difference. */
  const openComplaint = (getState().disputes || []).find(d => d.orderId === o.id && !d.resolvedAt) || null;
  /* and one that has been settled stays on the record: it vanished the moment a
     refund closed it, so the only evidence she had ever complained disappeared
     along with the thing she complained about */
  const pastComplaint = openComplaint ? null
    : (getState().disputes || []).find(d => d.orderId === o.id && d.resolvedAt) || null;
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
        <div style="font-size:12px;color:var(--ink-3);margin-top:2px">${running
          ? `${km} km away · ~${o.eta || etaMins(km)} min · step ${idx + 1} of ${track.length}`
          : `${esc(st.short)} · ${timeAgo(o.createdAt)}`}</div>
      </div>
      <button class="btn btn--secondary btn--sm tap" data-act="order.map" data-id="${esc(o.id)}"
        aria-pressed="${showMap}" style="font-size:12px;letter-spacing:.04em;min-height:44px">${showMap ? 'HIDE MAP' : 'MAP'}</button>
    </div>

    ${o.otp && running && isCustomer && !o.otpVerified && o.stage !== 'ARRIVED' && o.stage !== 'R_PICKUP_READY' ? `
      <div class="between" style="padding:9px 0;border-bottom:1px solid var(--color-divider)">
        <span class="tiny muted">${esc(t('order.codeAtDoor'))}</span>
        <b class="num" style="font-size:15px;letter-spacing:.1em">${esc(o.otp)}</b></div>` : ''}

    <div class="m-two">
      <div>
        <div class="sec">
          <p class="m-cap">${esc(t('order.capProgress'))}</p>
          ${timeline(o, track, idx)}
        </div>

        ${actionPanel(o, { isCustomer, isPartner, isShop })}
      </div>

      <div>
        ${o.kind === 'service' ? `
          <div class="sec">
            <p class="m-cap">${esc(t('bill.title'))}</p>
            <!-- ROUNDED ONCE, TOGETHER. These three lines used to go through
                 fmt() independently and printed ₹685 + ₹46 + ₹8 under a total
                 reading ₹740. The paise were exact; the arithmetic on screen
                 was not, in front of somebody who checks it in her head at a
                 kirana counter. M.fmtParts derives the lines FROM the total,
                 so the column always adds up — see core/money.js. -->
            <div class="m-kv"><span>${esc(t(pending ? 'bill.proPriceNew' : 'bill.proPrice', { cat: catName(cat), sub: o.sub ? subName(o.sub, subKey(o.sub)) : cat.unit, name: o.partnerName }))}</span><span class="num">${billRow[0]}</span></div>
            <!-- "SAAHAA charge · 8% on top" sat beside the platform fee alone,
                 which is not 8% of anything on this screen: the 8% is the fee
                 PLUS the GST under it. Two lines that can be added up, and the
                 percentage stated once, over the sum it actually describes. -->
            <div class="m-kv"><span class="muted">${esc(t('bill.platformFee'))}</span><span class="num">${billRow[1]}</span></div>
            <div class="m-kv"><span class="muted">${esc(t('bill.gstOnFee'))}</span><span class="num">${billRow[2]}</span></div>
            <div class="m-kv m-kv--total"><span>${payer}${o.provisional ? ' (est.)' : ''}</span><span class="num">${M.fmt(billPays)}</span></div>
            <p class="micro muted" style="margin-top:8px">${esc(t('bill.feePlusGst', { amount: M.fmt(billParts[1] + billParts[2]), pct }))}</p>
            <!-- "receives the full" kept printing after a partial resolution, so a
                 pro paid ₹360 of a ₹600 job read that he had received all of it.
                 A bill must describe what happened, not what was going to. -->
            <!-- AND IT STILL SAID "RECEIVES THE FULL ₹385" ON A CANCELLED JOB —
                 a fully refunded order, on which he received nothing and had
                 just been charged ₹40. The sentence was fixed once for partial
                 resolutions and never asked whether the job had happened. -->
            <p class="micro muted" style="margin-top:6px">${esc(paidWith(o, billPays))}. ${
              ['CANCELLED', 'REFUNDED'].includes(o.stage)
                ? `This job was cancelled. ${esc(String(o.partnerName || 'The pro').split(' ')[0])} ${(o.workerKept | 0)
                    ? `was paid ${M.fmt(o.workerKept)} for the journey` : 'was not paid for it'}, and ${M.fmt(o.refund | 0)} went back to the customer.`
              : o.releasedPaise != null && o.releasedPaise < (o.deal | 0)
                ? `${esc(o.partnerName)} received ${M.fmt(o.releasedPaise)} of the ${billRow[0]} after this job was reviewed —
                   SAAHAA never takes a cut of their quote.`
                : pending
                  ? `${esc(o.partnerName)} keeps the whole ${billRow[0]} once she agrees. SAAHAA is holding
                     ${M.fmt((o.paidFromWallet | 0) + (o.collected | 0))} so far — the rest is collected the moment she approves,
                     and nothing starts before that.`
                /* AND IT BUILT A TELUGU SENTENCE ROUND AN ENGLISH PHRASE.
                   `confirms` is the literal string "you confirm", interpolated
                   into a translated sentence, so a Telugu reader got
                   "— you confirm పనిని నిర్ధారించే వరకు సాహా దాన్ని ఆపి ఉంచుతుంది".
                   Who confirms is a fact about WHO IS READING, not a word to
                   splice in: two whole sentences, each written in its own
                   language. */
                : esc(t((isPartner || isShop) ? 'order.getsFullThem' : 'order.getsFullYou',
                        { who: o.partnerName, amount: billRow[0] }))}</p>
            <!-- "and your pro was paid more" is the OTHER counterfactual. The
                 booking sheet holds his take-home equal to derive her saving;
                 this clause silently switched to holding her price equal to
                 derive his. Both cannot be true, and she reads them ten seconds
                 apart. The clause goes; the claim it belonged to stays. -->
            <!-- AND HERS STILL BOASTED ON A JOB THAT NEVER HAPPENED. The
                 partner side of this exact sentence learned to ask whether the
                 job survived; the customer side never did, so a cancelled and
                 fully refunded order told her she had saved ₹197 on it. -->
            ${o.saved && !(isPartner || isShop) && !settledUp
              ? `<p class="micro" style="margin-top:6px;color:var(--color-accent-text)">${esc(t('bill.youSavedVs', { amount: M.fmt(o.saved) }))}</p>` : ''}
            <!-- AND THE TELUGU SENTENCE BESIDE IT PRINTED o.deal. On a repriced
                 job that is the SUPERSEDED estimate — "the whole ₹942 is yours"
                 under a bill reading ₹1,400 — and on a cancelled job it is a
                 live figure for money he never received and was charged ₹40
                 over. The English branch was fixed for both and this was not:
                 only the earning side, and only in his own language. -->
            ${o.saved && (isPartner || isShop) && !['CANCELLED', 'REFUNDED'].includes(o.stage)
              ? `<p class="micro" style="margin-top:6px;color:var(--color-accent-text)">${esc(t('money.youKeep', { amount: M.fmt(billDeal) }))}</p>` : ''}
          </div>` : `
          <!-- THREE DIFFERENT TOTALS AND NO MENTION OF THE REFUND. Every line
               rendered unitPrice x qty — what she ORDERED — and never read
               pickedQty, so after a reweigh the lines summed to ₹522, the
               total said ₹489 and the payment line said ₹521, and the ₹32.86
               that came back appeared only in her wallet as an unlabelled
               "Refund · just now". It also said "(est.)" and "held until you
               confirm" on an order that had settled hours earlier. The screen
               now shows the weighed quantity, the ordered one beside it, and
               the money that came back because of the difference. -->
          <div class="sec">
            <!-- BOTH AUDITS MEASURED THIS BLOCK AT 100% ENGLISH on an otherwise Telugu
                 screen: the item count, Delivery, Free, Total, the payment line and the
                 escrow sentence. i18n.js promises "the money words" are translated, and
                 this is the bill. -->
            <p class="m-cap">${esc(t(o.lines.length === 1 ? 'order.itemOne' : 'order.itemsN', { n: o.lines.length }))}${o.provisional && !weighed ? ' · ' + esc(t('order.estUntilWeighed')) : ''}</p>
            ${o.lines.map((l, li) => { const q = l.pickedQty != null ? l.pickedQty : l.qty;
              const reweighed = l.pickedQty != null && l.pickedQty !== l.qty;
              return `<div class="m-kv"><span>${esc(l.name)} × ${q}${
              l.variableWeight && l.pickedQty == null ? ' (est.)' : ''}${
              reweighed ? ` <span class="micro muted">(${esc(t('order.ordered', { n: l.qty }))})</span>` : ''}${
              l.status === 'unavailable' ? ' <span class="tag tag-accent">' + esc(t('order.tagRefunded')) + '</span>' : l.status === 'substituted' ? ' <span class="tag tag-neutral">' + esc(t('order.tagSimilar')) + '</span>' : ''}</span>
              <span class="num">${retailRow[li]}</span></div>`; }).join('')}
            <div class="m-kv"><span class="muted">${esc(t('order.delivery'))}${o.mode === 'pickup' ? ' · ' + esc(t('order.pickup')) : ''}</span><span class="num">${o.deliveryFee ? retailRow[retailRow.length - 1] : esc(t('order.free'))}</span></div>
            <!-- money-ok: reconciled by precision, not by roundParts. Every line
                 and this total share one regime (needsPaise), so the column sums
                 exactly as printed. roundParts is wrong HERE because it would
                 dump the drift on the largest line and make the receipt disagree
                 with the shelf price and the cart, which is the same bug from
                 the other side. -->
            <!-- AND THE RECEIPT TOLD THE WRONG STORY ABOUT IT FOR EVER. She
                 returned a damaged jar; the permanent record said "Extra weight,
                 not charged to you" and "Weighed lighter than ordered". The money
                 was right and the reason was false — and if she ever disputed it,
                 the record accused the shop of short-weighing her. A returned
                 item is a return, on both lines. -->
            ${(o.returnedValue | 0) ? `<div class="m-kv"><span style="color:var(--color-accent-text)">${esc(t('order.returnedRefund'))}</span>
              <span class="num" style="color:var(--color-accent-text)">− ${M.fmt2(o.returnedValue)}</span></div>` : ''}
            
            <div class="m-kv m-kv--total"><span>${esc(t('order.total'))}${o.provisional && !weighed ? ' ' + esc(t('order.estShort')) : ''}</span><span class="num">${totalShown}</span></div>
            ${notCharged ? `<p class="micro" style="margin-top:6px;color:var(--color-accent-text)">${esc(t(
              (isPartner || isShop) ? 'order.extraYouGave' : 'order.extraNotCharged'))} — ${M.fmt2(notCharged)}</p>` : ''}
            ${(backToHer && !o.partialReturn) ? `<div class="m-kv"><span style="color:var(--color-accent-text)">${esc(t('order.weighedLighter'))}</span>
              <span class="num" style="color:var(--color-accent-text)">${(isPartner || isShop)
                ? esc(t('order.backToCustomer', { amount: M.fmt(shownBack) }))
                : esc(t('order.backToYou', { amount: M.fmt(shownBack) }))}</span></div>` : ''}
            ${o.goodwillPaise ? `<div class="m-kv"><span style="color:var(--color-accent-text)">${esc(t('order.creditedAfterReport'))}</span>
              <span class="num" style="color:var(--color-accent-text)">${M.fmt2(o.goodwillPaise)}</span></div>` : ''}
            <p class="micro muted" style="margin-top:8px">${esc(paidWith(o, billPays))}. ${isTerminal(o.stage)
              ? esc(t('order.settledNothing'))
              : esc(t((isPartner || isShop) ? 'order.heldTillThem' : 'order.heldTillYou'))}</p>
          </div>`}

        ${showEv ? evidenceSection(o, isPartner) : ''}

        <div class="sec">
          <div class="between" style="margin-bottom:6px"><p class="m-cap" style="margin:0">${esc(t('order.capMessages'))}</p>
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

        <!-- AND THE GROCERY ORDER LOST THIS BUTTON THE INSTANT SHE CONFIRMED IT.
             settleRetail runs straight through to R_CLOSED, R_CLOSED has no
             edges, so the gate below hid the only control that leads anywhere.
             A basket is confirmed at the door and unpacked in the kitchen —
             the leaking pouch is always found afterwards. She has a day. -->
        <!-- SHE FILED A COMPLAINT AND THE APP NEVER MENTIONED IT AGAIN. A toast
             said "Reported. Your money is frozen until this is settled", and on
             the next render there was no reference, no status, nothing -- while
             the screen went on offering "you can still cancel and get everything
             back". raiseDispute advances the order to DISPUTED only where the
             stage machine allows it, and a grocery order at R_ACCEPTED does not,
             so the only record lived in state.disputes and no screen read it.
             A vanishing toast is not a receipt. -->
        ${openComplaint ? `<div class="m-note" style="margin-top:12px;border-color:var(--warn)">
          <b class="tiny">${esc(t('order.disputeOpen'))}</b>
          <!-- AND IT SAID "YOU REPORTED" TO BOTH SIDES. The shop opened the order
               and was told it had filed the customer's complaint against itself.
               Who reported it is recorded on the dispute; the sentence reads it. -->
          <p class="micro muted" style="margin:4px 0 0">${esc(t(
            (openComplaint.by && me() && openComplaint.by === me().key) ? 'order.disputeOpenNote' : 'order.disputeOpenTheirs', {
            reason: openComplaint.reason || '', when: timeAgo(openComplaint.openedAt || openComplaint.ts || Date.now()) }))}</p>
        </div>` : ''}
        ${pastComplaint ? `<p class="micro muted" style="margin-top:10px">${esc(t(
          (pastComplaint.by && me() && pastComplaint.by === me().key) ? 'order.disputeClosed' : 'order.disputeClosedTheirs', {
          reason: pastComplaint.reason || '', when: timeAgo(pastComplaint.resolvedAt) }))}</p>` : ''}
        ${!openComplaint && (isCustomer || isPartner || isShop) && (canTransition(o.stage, 'DISPUTED') || win.open) ? `
        <button class="btn btn--ghost btn--block" style="margin-top:12px;color:var(--danger)"
          data-act="dispute.open" data-id="${o.id}">${esc(t('order.reportIssue'))}</button>
        ${win.open && !canTransition(o.stage, 'DISPUTED')
          ? `<p class="micro muted" style="margin-top:6px;text-align:center">${esc(t('order.stillTell', { hours: win.hoursLeft }))}</p>` : ''}` : ''}
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
    ? `${catName(cat)}${o.sub ? ' · ' + subName(o.sub, subKey(o.sub)) : ''}`
    : `${(o.lines || []).length} item${(o.lines || []).length === 1 ? '' : 's'} from ${o.shopName || ''}`;
  const pct = o.deal ? Math.round(((o.platformFee | 0) + (o.gst | 0)) / o.deal * 100) : P.serviceMarkupPct;
  return `<div class="ch-job">
    <p class="m-cap" style="margin:0">Job confirmed</p>
    <b>${esc(title)} · ${M.fmt(o.kind === 'service' ? o.deal : o.customerPays)}</b>
    <p class="micro muted" style="margin:4px 0 0">${o.kind === 'service'
      ? `${esc(o.partnerName || '')} keeps the full ${dealText(o)}. ${mine ? 'The customer pays' : 'You pay'} ${M.fmt(o.customerPays)} — SAAHAA's ${pct}% sits on top of the quote and is held until ${mine ? 'the customer confirms' : 'you confirm'} the work.`
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
  .ch-hdr .ch-state{font-size:12px;line-height:1.3;color:var(--color-accent-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
    <p class="m-cap">${esc(t('order.capProof'))} · ${(o.evidence || []).length}</p>
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
  /* the manual rail's state for THIS order, read once and used by both sides */
  const payClaim = PAY.paymentFor(o.id);
  const payDue = !!o.awaitingPayment && (!payClaim || payClaim.state === 'AWAITING_UTR');
  const B = (act, label, cls = 'btn--primary') =>
    `<button class="btn ${cls} btn--lg btn--block" style="justify-content:flex-start" data-act="${act}" data-id="${o.id}">${label}</button>`;

  if (r.isPartner) {
    /* HIS SIDE OF THE MANUAL RAIL. She says she has paid; he is standing there
       and can see her bank app. His check is not proof — the statement is — but
       it is the check that takes two seconds and lets the job start. */
    if (payClaim && payClaim.state === 'CLAIMED') return panel(t('pay.didYouSee'), `
      <div class="m-kv"><span>${esc(t('pay.utrShort'))}</span><span class="num">${esc(payClaim.utr)}</span></div>
      <!-- The amount he is checking against her bank app is the amount she was
           told to send, and she was told a whole rupee. fmt2 printed ₹435.00
           here while her screen said ₹435 — the same figure, written two ways,
           on the two screens that have to agree for a job to start. -->
      <div class="m-kv m-kv--total"><span>${esc(t('pay.sheSent'))}</span><span class="num">${M.fmtMax(payClaim.expected)}</span></div>
      <p class="micro muted" style="margin:10px 0 0">${esc(t('pay.proCheckNote'))}</p>
      ${B('pay.procheck.yes', t('pay.iSawIt'))}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
        data-act="pay.procheck.no" data-id="${esc(o.id)}">${esc(t('pay.cannotSee'))}</button>`);
    if (s === 'MATCHING')    return panel(t('job.newForYou'), B('stage.accept', t('job.acceptThis')));
    if (s === 'ASSIGNED')    return panel(t('job.headToCustomer'), `${whereTo(o)}${B('stage.enroute', t('job.startTravelling'))}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);

    /* HE WAS NEVER TOLD THE OUTCOME. After a 60% resolution his screen simply
       lost its panel — no decision, no reason, no mention a complaint had
       existed — while the bill above it still said he had received the full
       amount. The one thing a person needs after a ruling is the ruling. */
    if (['SETTLED', 'PARTIAL', 'REFUNDED', 'CLOSED'].includes(s) && o.disputeOutcome) {
      const got = o.releasedPaise != null ? o.releasedPaise : o.deal;
      return panel(o.disputeOutcome === 'release' ? 'Settled in your favour' : 'A decision was made on this job', `
        <p class="tiny" style="margin-bottom:10px">${esc(o.disputeReason || 'A complaint was raised')}${
          o.disputeNote ? ` — ${esc(o.disputeNote)}` : ''}</p>
        <div class="m-kv"><span>Your quote</span><span class="num">${dealText(o)}</span></div>
        <div class="m-kv"><span>Paid to you</span><span class="num">${M.fmt(got)}</span></div>
        ${got < (o.deal | 0) ? `<div class="m-kv"><span>Returned to the customer</span><span class="num">${M.fmt((o.deal | 0) - got)}</span></div>` : ''}
        <p class="micro muted" style="margin-top:10px">${o.disputeDecidedNote
          ? esc(o.disputeDecidedNote)
          : 'The owner read both sides before deciding.'} ${got < (o.deal | 0)
          ? 'An upheld complaint counts against SAAHAA Certified, and two of them put every future payout under review.'
          : 'Nothing was held against you.'}</p>`);
    }

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
        <div class="m-kv"><span>Your payout, frozen for now</span><span class="num">${dealText(o)}</span></div>
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
    /* THE PROMISE NOBODY COULD KEEP. The booking sheet tells her in bold that
       he confirms the price when he arrives; he had no box to type it in. */
    if (s === 'ARRIVED' && o.pricedOnSite && !o.onSiteAgreedAt) {
      /* TWO CEILINGS APPLY AND THE SCREEN PRINTED ONE. The multiple of her
         estimate is what the panel has always named; the cap on what a pro
         three jobs old may take is enforced in the engine and was never shown,
         so it arrived as a rejection AFTER he had pressed Send with a customer
         watching. He is told the lower of the two, before he types. */
      const pro = getState().partners.find(x => x.id === o.partnerId) || {};
      const ceilingHere = Math.round((o.deal | 0) * flow.ON_SITE_MAX_MULTIPLE);
      const capHere = effectiveCap(pro) | 0;
      const onSiteMax = Math.min(ceilingHere, capHere || ceilingHere);
      return panel(t('job.priceThis'), `
      ${whereTo(o)}
      <p class="tiny" style="margin:0 0 10px">${esc(t('job.pricedOnSite', { amount: M.fmt(o.customerPays) }))}</p>
      <div class="search" style="border:2px solid var(--color-text);height:48px;margin-bottom:8px">
        <span class="tiny muted" aria-hidden="true">₹</span>
        <input id="onSitePrice" type="number" inputmode="numeric" min="1" step="1" max="${Math.round(onSiteMax / 100)}"
          placeholder="${esc(t('job.yourPriceField'))}" aria-label="${esc(t('job.yourPriceField'))}">
      </div>
      <!-- IT INVITED ₹3,600 AND REFUSED ₹1,501 AFTER SEND, while he was standing
           in her house having already said a number out loud. Two ceilings apply
           here — the multiple of HER estimate, and the cap on what a pro three
           jobs old may take — and the screen printed only the first, so the
           second arrived as a rejection. A control names the lower of the two
           before he types, the same rule the bid slider learned. -->
      <p class="micro muted" style="margin:0 0 12px">${esc(t('job.keepAllOfIt', { ceiling: M.fmt(onSiteMax) }))}${
        capHere < ceilingHere ? ' ' + esc(t('job.capWhileNew', { amount: M.fmt(capHere) })) : ''}</p>
      ${B('onsite.quote', t('job.sendHerPrice'))}
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);
    }
    /* THIS SENTENCE SWAPPED THE TWO PEOPLE IN IT. A plumber typed 1200 under
       "You keep 100% of this" and the next screen told him he had quoted
       ₹1,296 and that SHE keeps ₹1,200 of it — his own number handed to the
       customer, and SAAHAA's markup presented as his quote. A man deciding
       whether to spend an afternoon replacing a pipeline read that he was
       getting ₹96. The customer's copy of the same screen was correct, which
       is how it survived: only the earning side was told the lie. */
    if (s === 'AWAITING_APPROVAL') return panel(t('job.waitingHerAnswer'), `
      <p class="tiny" style="margin:0">You quoted <b>${M.fmt(o.proposedDeal || 0)}</b>, and it is yours in full.
        She pays <b>${M.fmt(o.proposedPays || 0)}</b> — SAAHAA's ${M.fmt(Math.max(0, (o.proposedPays | 0) - (o.proposedDeal | 0)))}
        goes on top of your price, not out of it. Nothing starts until she agrees.</p>
      <p class="micro muted" style="margin-top:8px">If she says no, the job ends there and nothing is held against you.</p>`);
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
      <!-- IT PROMISED "LOCKS ₹100 OF YOUR OWN MONEY" WHEN NOTHING OF HIS MOVED.
           A pro with an empty wallet funds the stake out of the job's own
           payout — which is the right design, and is why he never pays to start
           — but the screen told him his money was locked and that every rupee
           of it would come back. Both halves were vacuous: there was no rupee.
           A promise with nothing behind it reads as reassurance right up until
           somebody checks. It now says which of the two actually happened. -->
      <p class="tiny muted" style="margin:0 0 12px">${esc(stakeLine(o))}</p>
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
      ${o.stake ? `<p class="tiny" style="margin-bottom:10px"><span class="state state--held">${M.fmt(o.stake.need)} ${o.stake.funded ? 'locked' : 'committed'}</span>
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
      </details>
      <!-- AND THE ONE STAGE WHERE HE ACTUALLY DISCOVERS HE CANNOT DO IT still
           had no way out. ASSIGNED, EN_ROUTE and ARRIVED each got this control;
           IN_PROGRESS — where he has opened the wall, found the leak is not the
           one he was called for, and has no part for it — did not. His options
           were to walk away as a no-show, or to mark work finished he had not
           done. Both are worse for her than being told now. -->
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="worker.cancel" data-id="${o.id}">${esc(t('job.cannotDo'))}</button>`);
    /* A PRO WHO CANCELLED WAS LEFT STARING AT A BILL FOR MONEY THAT NO LONGER
       EXISTS. No panel, no ruling, no mention of the ₹40 just taken — and the
       only sentence on the screen was written TO THE CUSTOMER, about him, in
       the third person. He had to find the Earnings tab to learn what had
       happened to his own job. All four facts already exist on the order. */
    if (['CANCELLED', 'REFUNDED'].includes(s)) {
      const fee = o.cancelRule === 'WORKER_CANCEL' ? (CANCEL_RULES.WORKER_CANCEL.workerFee | 0) : 0;
      const noShow = o.cancelRule === 'WORKER_NO_SHOW';
      return panel(noShow ? 'Recorded as a no-show' : 'This job ended', `
        <p class="tiny" style="margin:0">${(o.workerKept | 0)
          ? `You were paid ${M.fmt(o.workerKept)} for the journey, and ${M.fmt(o.refund | 0)} went back to the customer.`
          : `You were not paid for it, and ${M.fmt(o.refund | 0)} went back to the customer.`}</p>
        ${(o.platformKept | 0) ? `<p class="tiny" style="margin-top:8px">${esc(t('job.saahaaKeptOnCancel', {
          amount: M.fmt(o.platformKept), paid: M.fmt(o.customerPays | 0) }))}</p>` : ''}
        ${o.stake && o.stake.returned ? `<p class="tiny" style="margin-top:8px">Your ${M.fmt(o.stake.need)} deposit came straight back.</p>` : ''}
        ${o.stake && o.stake.forfeited ? `<p class="tiny" style="margin-top:8px;color:var(--warn)">Your ${M.fmt(o.stake.need)} deposit went to the customer.</p>` : ''}
        ${fee ? `<p class="tiny" style="margin-top:8px;color:var(--warn)">${M.fmt(fee)} was charged for cancelling. It is on your Earnings tab.</p>` : ''}
        <p class="micro muted" style="margin-top:10px">${noShow
          ? 'A no-show counts against SAAHAA Certified. Cancelling in the app instead costs far less.'
          : 'This counts as a cancellation, not a no-show — nothing else is held against you.'}</p>`);
    }
    if (s === 'WORK_DONE')   return panel(t('job.waitingCustomer'),
      /* "Auto-releases if the customer does not respond" with no time on it was
         the pro's half of the same lie the customer was told: for a new pro it
         is not true at all (first three jobs are reviewed), and for everyone
         else the hour count was never shown. Both are stated now. */
      `<p class="tiny muted">${o.escrowTier === 'HOLD'
        ? esc(t('job.underReview'))
        : esc(t('job.autoIfNoConfirm', { when: escrowWord(o.escrowTier) }))}</p>`);
  }

  if (r.isCustomer) {
    /* NOTHING ELSE MATTERS UNTIL SHE HAS PAID. On the manual rail the order
       exists and no money does, so this stands in front of every other panel:
       one UPI id, the exact amount, a reference short enough to survive a bank
       narration, and a button that opens her own UPI app with all three filled
       in. Then the one number only her bank can give her. */
    if (payDue || (payClaim && payClaim.state === 'CLAIMED')) {
      const ins = PAY.instruction(o);
      const waiting = payClaim && payClaim.state === 'CLAIMED';
      return panel(t(waiting ? 'pay.checkingTitle' : 'pay.payTitle'), `
        ${waiting ? `<p class="m-note" style="margin:0 0 12px">${esc(t('pay.waitingNote', { utr: payClaim.utr }))}</p>` : `
        <div class="m-kv"><span>${esc(t('pay.payTo'))}</span><span class="num" style="user-select:text">${esc(ins.upi)}</span></div>
        <div class="m-kv"><span>${esc(t('pay.reference'))}</span><span class="num" style="user-select:text">${esc(ins.reference)}</span></div>
        <div class="m-kv m-kv--total"><span>${esc(t('pay.exactly'))}</span><span class="num">${esc(ins.amountText)}</span></div>
        <a class="btn btn-primary btn--block" style="margin-top:14px" href="${esc(ins.link)}">${esc(t('pay.openUpiApp'))}</a>
        <p class="micro muted" style="margin:10px 0 4px">${esc(t('pay.thenUtr'))}</p>
        <div class="field">
          <input id="utrBox" inputmode="numeric" maxlength="12" placeholder=" " autocomplete="off">
          <label>${esc(t('pay.utrLabel'))}</label>
        </div>
        <button class="btn btn-primary btn--block" data-act="pay.claim" data-id="${esc(o.id)}">${esc(t('pay.iHavePaid'))}</button>
        <p class="micro muted" style="margin-top:10px">${esc(t('pay.safetyNote'))}</p>`}`);
    }
    /* THE MOMENT THE BOOKING SHEET PROMISED HER, FINALLY EXISTING. "He confirms
       it when they arrive and nothing starts until you approve the number" —
       and until now no screen ever showed her a number to approve. */
    if (s === 'AWAITING_APPROVAL') {
      const est = o.estimateDeal != null ? o.estimateDeal : o.deal;
      const more = (o.proposedDeal | 0) - (est | 0);
      return panel(`${esc(String(o.partnerName || 'Your pro').split(' ')[0])} has seen the job`, `
        <p class="tiny" style="margin:0 0 10px">You were quoted an estimate. This is the real price, and nothing
          has started yet.</p>
        <div class="m-kv"><span>Estimate you agreed</span><span class="num">${M.fmt(o.customerPays)}</span></div>
        <div class="m-kv m-kv--total"><span>${esc(String(o.partnerName || '').split(' ')[0])}'s price now</span>
          <span class="num">${M.fmt(o.proposedPays || 0)}</span></div>
        <p class="micro muted" style="margin:6px 0 12px">${more > 0
          ? `${M.fmt(Math.abs((o.proposedPays | 0) - (o.customerPays | 0)))} more than the estimate — taken the same way you paid the first time.`
          : more < 0 ? `${M.fmt(Math.abs((o.proposedPays | 0) - (o.customerPays | 0)))} less — the difference comes back to your wallet.`
          : 'The same as your estimate.'}
          ${esc(String(o.partnerName || 'He').split(' ')[0])} keeps ${M.fmt(o.proposedDeal || 0)}; SAAHAA's charge is the rest.</p>
        ${B('onsite.approve', `Agree ${M.fmt(o.proposedPays || 0)} and let them start`)}
        <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--danger)"
          data-act="onsite.decline" data-id="${o.id}">No — end this, refund me in full</button>
        <button class="btn btn--ghost btn--block btn--sm" style="margin-top:4px"
          data-act="nav.chat" data-id="${o.id}">Ask them about it first</button>`);
    }
    if (s === 'ARRIVED') return panel(t('door.customer.title'), `
      ${codeBig(o.otp)}
      <p class="tiny muted" style="text-align:center;margin-top:8px">${esc(t('door.customer.body'))}</p>`);
    /* THE DECISION SCREEN WAS ~10% TRANSLATED. An audit measured it: the panel
       that hands over her money -- the only irreversible money button a customer
       ever presses -- was in English on a phone set to Telugu, beside a claim
       that a person at SAAHAA was reviewing the job. */
    if (s === 'WORK_DONE') return panel(t('order.workFinished'), `
      ${(o.evidence || []).length ? `${evidenceTiles(o)}
        <p class="micro muted" style="margin:8px 0 12px">${shot(o)
          ? 'This is what you are paying for. Nothing leaves SAAHAA until you confirm against it.'
          : 'Your pro could not attach a photograph, so this is a note, not a picture. Report an issue if the work is not done.'}</p>` : ''}
      <div class="m-kv" style="margin-bottom:10px"><span>Held by SAAHAA for ${esc(o.partnerName)}</span>
        <span><b class="num">${dealText(o)}</b> <span class="state state--held">not yet released</span></span></div>
      <!-- SHE WAS NEVER TOLD THE CLOCK EXISTED. The pro's screen showed the
           release window and hers did not, while nine screens promised the
           money moved only when she confirmed. If a deadline exists she has to
           be the first to know it, not the last. -->
      ${releaseLine(o)}
      ${B('release.full', t('order.confirmRelease', { amount: dealText(o) }))}
      <button class="btn btn--ghost btn--block" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="dispute.open" data-id="${o.id}">${esc(t('order.somethingWrongBtn'))}</button>`);
    /* 1d RATINGS & REVIEWS. Tapping a star posts the rating; the engine stores
       stars only, so there are no "what was good" chips and no text box —
       a control that goes nowhere is not drawn. */
    if ((s === 'SETTLED' || s === 'PARTIAL') && !o.rated) {
      const cat = get('category', o.catId);
      const done = (o.history || []).find(h => h.stage === 'WORK_DONE');
      return panel('How did it go?', `
      <div style="font:800 19px/1.2 var(--font-heading)">${esc(o.partnerName)} did ${esc(o.sub ? subName(o.sub, subKey(o.sub)) : catName(cat))} for ${dealText(o)}</div>
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
    if (s === 'R_RETURN') {
      /* IT SAID ₹974 AND "IN FULL" WHEN SHE SENT BACK ONE ₹331 JAR. Partial
         returns were added to the engine and this panel was not told: it printed
         the whole basket and promised a full refund for the twenty-four hours
         she is most anxious about. The order already knows which lines are going
         back; the screen says so. */
      const backIds = new Set(o.returnLines || []);
      const partial = backIds.size > 0;
      const backNames = (o.lines || []).filter(l => backIds.has(l.lineId)).map(l => l.name);
      const backAmt = partial ? flow.returnedValueOf(o) : (o.customerPays | 0);
      return panel('Return requested', `
      <p class="tiny" style="margin-bottom:10px">${esc(o.returnReason || 'You asked to return this order.')}</p>
      ${partial ? `<p class="tiny muted" style="margin-bottom:10px">${esc(t('ret.goingBack', { items: backNames.join(', ') }))}</p>` : ''}
      <div class="m-kv"><span>${esc(t(partial ? 'ret.comingBackToYou' : 'ret.heldGoingNowhere'))}</span><span class="num">${M.fmt2(backAmt)}</span></div>
      ${partial ? `<div class="m-kv"><span class="muted">${esc(t('ret.youStillPay'))}</span><span class="num">${M.fmt2(Math.max(0, (o.customerPays | 0) - backAmt))}</span></div>` : ''}
      <p class="micro muted" style="margin-top:10px">${esc(o.shopName || 'The shop')} can accept it now. If they do not
        answer within ${Math.round(flow.RETURN_WINDOW_MS / 3600e3)} hours, SAAHAA refunds ${partial ? esc(t('ret.thoseItems')) : 'you in full'} automatically —
        you do not have to chase it.</p>
      <button class="btn btn--secondary btn--block" style="margin-top:10px"
        data-act="dispute.open" data-id="${o.id}">Ask SAAHAA to step in now</button>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
        data-act="nav.chat" data-id="${o.id}">Message ${esc(String(o.shopName || 'the shop').split(' ')[0])}</button>`);
    }

    /* ₹954 OF HER MONEY AND THREE BUTTONS, NONE OF THEM AN EXIT. A live
       grocery order offered Map, "Message the shop" and nothing else -- while
       the service order beside it has had both a cancel and a "report an issue"
       for versions. The engine has always allowed it: R_PLACED and
       R_ACCEPTED both list R_CANCELLED among their next stages. Only the
       screen never offered it, so four separate audits reported being trapped
       with a basket they had already paid for.

       It stops at R_PICKING, and says why: once he is weighing her order the
       goods are off his shelf, and the way back from there is a return. */
    if (['R_PLACED', 'R_ACCEPTED'].includes(s)) return panel(t('order.waitingOnShop'), `
      <p class="tiny" style="margin:0 0 10px">${esc(t('order.notPackedYet', { shop: o.shopName || 'The shop' }))}</p>
      <!-- a RETAIL action: cancel.open leads to the service split, which
           prices o.deal and advances to CANCELLED. A basket has no deal and
           its stage machine wants R_CANCELLED. -->
      <button class="btn btn--secondary btn--block" data-act="retail.cancel" data-id="${esc(o.id)}">${esc(t('order.cancelOrder', { amount: M.fmtMax(o.customerPays | 0) }))}</button>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
        data-act="dispute.open" data-id="${esc(o.id)}">${esc(t('order.reportIssue'))}</button>`);

    if (s === 'R_DELIVERED') return panel(t('order.delivered'), `${B('retail.settle', t('order.confirmDelivery'))}
      <!-- SAY THE DEADLINE, ON BOTH SCREENS. Without an auto-settle the shop's
           money sat here for ever if she simply closed the app; with one and no
           date on it, she is being given a silent countdown over her own money.
           The service side has printed this since 7.0. -->
      <p class="micro muted" style="margin-top:8px">${settleDeadline(o)}</p>
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px;color:var(--color-accent-400)"
        data-act="retail.return" data-id="${o.id}">${esc(t('order.somethingWrong'))}</button>`);
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
    /* a second `s === 'R_RETURN'` stood here, unreachable behind the fuller one
       forty lines up. dead-ok: none — it is deleted, not excused. */
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
          data-act="cancel.open" data-id="${o.id}">${esc(t('order.cancelThis'))}</button>`);
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
        <!-- AND A RETURN DEAD-ENDED THE MOMENT A COMPLAINT EXISTED. Filing one
             moves a retail order to DISPUTED, which took the shop out of the
             R_RETURN branch entirely — so the return vanished from both screens
             and the shop had no control at all, while the copy said the money
             was held "until both sides are heard". Accepting the return IS his
             side of it, and it settles the thing outright. -->
        ${(o.returnLines || []).length ? `<button class="btn btn--secondary btn--block" style="margin-top:10px"
          data-act="retail.acceptreturn" data-id="${esc(o.id)}">${esc(t('ret.acceptPart', { amount: M.fmt2(flow.returnedValueOf(o)) }))}</button>` : ''}
        <button class="btn btn--ghost btn--block btn--sm" style="margin-top:10px"
          data-act="nav.chat" data-id="${o.id}">Add something to the record</button>`);
    }
  }

  /* HIS TILL, ON EVERY SCREEN HE STANDS IN FRONT OF. This existed at exactly
     one of six shop stages: it appeared while he weighed and vanished the
     moment he tapped "Weighed & packed", after which every panel showed HER
     bill — "Total ₹235 · held by SAAHAA until the customer confirms". The last
     thing he read before the goods left his shop was her number. */
  if (r.isShop) {
    /* R_PLACED was missing, which is the one screen where he DECIDES. He was
       shown the customer's total and asked to accept or not, without being
       told what the order pays him. */
    const till = ['R_PLACED', 'R_ACCEPTED', 'R_PICKING', 'R_PACKED', 'R_OUT', 'R_DELIVERED', 'R_PICKUP_READY'].includes(s)
      ? shopSide(o) : '';
    /* THE ONE SCREEN WHERE HE DECIDES, AND IT SHOWED HIM HER TOTAL. He was
       asked to accept or refuse an order while being told only what the
       customer pays; what it earns him lived two tabs away. */
    if (s === 'R_PLACED')   return panel('New order', `${till}<div style="height:10px"></div>${B('stage.accept', 'Accept order')}`);
    if (s === 'R_ACCEPTED') return panel('Pack this order', `${till}<div style="height:10px"></div>${B('stage.picking', 'Start packing')}`);
    if (s === 'R_PICKING')  return panel(t('shop.weighAndPack'), `
      ${(o.lines || []).map(l => `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--hairline)">
        <span class="tiny">${esc(l.name)} <span class="micro muted">× ${esc(l.qty)}</span>
          ${l.status === 'unavailable' ? '<span class="tag tag-accent">Refunded</span>' : l.status === 'substituted' ? '<span class="tag tag-neutral">Similar</span>' : ''}</span>
        ${['unavailable', 'substituted'].includes(l.status) ? '' : `<button class="btn btn--ghost btn--sm" data-act="retail.out"
          data-id="${o.id}" data-line="${l.lineId}">${esc(t('shop.notInStock'))}</button>`}</div>
        ${l.variableWeight && !['unavailable', 'substituted'].includes(l.status) ? `
        <!-- THE SCALE. This screen was called "Weigh and pack" and had nothing to
             weigh with: pickedQty was never set by any control, so loose goods
             were always charged at the estimate the customer was shown. -->
        <div class="row" style="gap:8px;align-items:center;padding:0 0 8px">
          <span class="micro muted grow">${esc(t('shop.orderedWhatWeigh', { n: l.qty }))}</span>
          <input class="input" style="width:92px" type="number" min="0" step="0.05"
            inputmode="decimal" data-role="picked" data-id="${o.id}" data-line="${l.lineId}"
            value="${l.pickedQty != null ? l.pickedQty : l.qty}">
        </div>` : ''}`).join('')}
      ${o.overEstimate ? `<p class="m-note" style="margin:8px 0 0">This weighs out at ${M.fmt(o.weighedTotal)} —
        ${M.fmt(giveawayOf(o))} of stock more than she is paying for. <b>She is not charged the extra.</b> Give her the
        weight she paid for, or message her and let her decide before you pack it.</p>` : ''}
      ${o.reweighed ? `<p class="m-note" style="margin:8px 0 0">Weighed lighter than the estimate — her bill
        has come down to ${M.fmt(o.customerPays)} and the difference goes back to her automatically.</p>` : ''}
      <!-- HE WEIGHED RICE WITHOUT BEING TOLD WHAT THE ORDER PAID HIM. Every
           panel on this side rendered the CUSTOMER's bill in the customer's
           voice — "Total ₹475", "Held by SAAHAA until the customer confirms" —
           and no payout figure appeared anywhere until settlement, on a
           different tab. This is his side of the same order, live, and it moves
           as he types on the scale. -->
      ${till}
      <div style="height:10px"></div>${B('stage.packed', t('shop.weighedPacked'))}`);
    if (s === 'R_SUB_PENDING') return panel('Waiting for the customer', '<p class="tiny muted">They are choosing a substitute or a refund. No reply in 90 seconds means a refund for that item.</p>');
    if (s === 'R_PACKED')   return o.mode === 'pickup'
      ? panel('Packed — customer collects', `${till}<div style="height:10px"></div>${B('retail.ready', 'Ready for pickup')}`)
      : panel('Hand over', `${till}<div style="height:10px"></div>${B('stage.out', 'Out for delivery')}`);
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
    /* THIS PANEL WAS PASTED INTO THE CUSTOMER'S BRANCH BY MISTAKE, and because
       her own R_DELIVERED panel sits below it, hers became unreachable: the
       last step of every grocery order — Confirm delivery, and "Something was
       wrong — return this order" — was replaced by the shop's copy, written in
       the third person ABOUT her. Her money was then released only by a timer
       she had no button for. It belongs here. */
    if (s === 'R_DELIVERED') return panel('Handed over — waiting on the customer', `
      ${till}
      <p class="tiny" style="margin:10px 0 0">${settleDeadline(o, true)}</p>
      <p class="micro muted" style="margin-top:8px">She can ask to return it until then. Nothing else is needed from you.</p>`);
    /* HIS ONLY MOVE WAS TO LOSE. "Accept return — refund in full" was the whole
       panel: doing nothing refunded in full after 24 hours, and escalating hit
       the same sweep, so a kirana that had already handed over weighed rice had
       no point anywhere in the flow at which he could say no. He can now. */
    if (s === 'R_RETURN') return panel('Return requested', `
      <p class="tiny muted" style="margin-bottom:10px">${esc(o.returnReason || '')}</p>
      <!-- AND THE MONEY BLOCK VANISHED ON THE ONE SCREEN THAT ASKS HIM TO GIVE
           IT UP. Every other stage of this order shows what reaches the till;
           here, where he decides whether to accept a full refund, he was shown
           the reason, two buttons and no figure at all. -->
      ${shopSide(o)}
      ${o.returnContested
        ? `<p class="m-note" style="margin:0">You refused this and SAAHAA is looking at it. Nothing is refunded until
            somebody has read both sides.</p>
           <p class="tiny muted" style="margin-top:8px">Your reason: ${esc(o.returnRefusedReason || '')}</p>`
        : `${(() => {
             /* "ACCEPT RETURN — REFUND IN FULL", ON A PARTIAL RETURN, with no
                item named and no amount, above a panel still reading "You
                receive ₹454". A shop owner tapped it blind and it cost ₹322.
                This is several taps a day for a kirana; it says what it costs. */
             const ids = new Set(o.returnLines || []);
             const names = (o.lines || []).filter(l => ids.has(l.lineId)).map(l => l.name);
             const amt = ids.size ? flow.returnedValueOf(o) : (o.customerPays | 0);
             return `${names.length ? `<p class="tiny" style="margin-bottom:8px">${esc(t('ret.goingBack', { items: names.join(', ') }))}</p>` : ''}
               ${B('retail.acceptreturn', t(ids.size ? 'ret.acceptPart' : 'ret.acceptAll', { amount: M.fmt2(amt) }))}`;
           })()}
           <div class="field" style="margin:12px 0 8px">
             <input id="refuseWhy" autocomplete="off" placeholder=" " maxlength="200">
             <label>Or say why this is not fair</label>
           </div>
           <button class="btn btn--secondary btn--block" data-act="retail.refusereturn" data-id="${o.id}">Refuse this return</button>
           <!-- "SENDS IT TO SAAHAA WITH YOUR PHOTOS" — and a shop has no photo
                step anywhere in the product. A pro's finished-work photograph
                protects him; a kirana was promised evidence it was never given
                a way to take. What SAAHAA actually reads is the order itself:
                what was picked, what it weighed, and the messages between them. -->
           <p class="micro muted" style="margin-top:6px">A refusal stops the ${Math.round(flow.RETURN_WINDOW_MS / 3600e3)}-hour clock and sends it to
             SAAHAA, with what you picked, what it weighed and your messages with the customer.
             Saying nothing refunds it in full tomorrow.</p>`}`);
    if (s === 'R_OUT')      return panel('Ask for their code at the door', `${till}
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
/* When a delivered grocery order pays itself out, in words. The figure comes
   from domain/flow.js `retailSettleAt` — never a number typed here, which is
   how the service side's deadline and its sweep drifted apart once already. */
/* Which stake sentence is true for this pro, right now. `fundStake` is the
   same function `lockStake` will use a moment later, so the screen cannot
   promise one thing and the ledger do another. */
function stakeLine(o) {
  const need = W.stakeFor(o.deal);
  const p = getState().partners.find(x => x.id === o.partnerId);
  const w = p ? W.walletOf(getState().ledger, p.id, p) : { available: 0 };
  const f = W.fundStake(need, w.available);
  return f.funded
    ? t('door.pro.stake', { amount: M.fmt(f.funded) })
    : t('door.pro.stakeCredit', { amount: M.fmt(need) });
}

/* HIS SIDE OF THE ORDER, AND IT HAS TO ADD UP.
   My first version of this printed "Basket ₹250 − fee ₹7 − dispatch ₹5" over a
   total of ₹242, because the dispatch cut comes out of the DELIVERY the
   customer paid, not out of his basket — the same defect as her bill, and as
   the shop statement, reproduced a third time on a third screen.

   So it is built the way those two ended up: the basket and the payout are
   measured, and the deductions between them are DEFINED as the difference and
   rounded together. It cannot disagree with itself, whatever the engine does
   with the delivery fee next. */
/* The tier's own words, in his language. `ESCROW[tier].label` is an English
   constant and was dropped straight into a Telugu sentence. */
function escrowWord(tier) {
  const e = ESCROW[tier];
  if (!e) return t('escrow.autoIn', { hours: 24 });
  if (tier === 'HOLD') return t('escrow.teamReview');
  if (tier === 'FREEZE') return t('escrow.frozen');
  return t('escrow.autoIn', { hours: Math.round((e.holdMs || 0) / 3600e3) });
}

function shopSide(o) {
  /* WHAT SHE PAID, AND WHERE IT WENT. This panel used to start from the basket
     and derive the giveaways as RESIDUALS -- "free delivery you gave" was
     `basket − payout − fee`, whatever was left over.

     On an over-weighed order that produces nonsense. `setPickedQty` scales
     `itemsTotal` down so the order fits what she is actually charged, so the
     residual collapses to zero: the "Free delivery you gave − ₹39" line
     VANISHED, the panel printed "Basket ₹494" while the item list under it
     totalled ₹533.02, and the shop's stated receipt went UP from ₹512 to ₹513
     after giving away 350g of free rice. An audit reasonably read that as the
     app telling it overweighing is profitable.

     A residual is only ever as true as the number it is subtracted from. So
     this starts from the one figure that is never scaled and never estimated --
     what the customer actually pays -- and names the two deductions SAAHAA
     takes. Those three always sum, on every path, because settlement is
     defined that way: she pays, SAAHAA takes its fee and its dispatch cut, the
     shop gets the rest including any delivery it made itself.

     What the shop GAVE is real and stays on the panel, but as what it is: a
     note about generosity, not a deduction from a basket. */
  const paid = o.customerPays | 0;
  /* `platformFee` already contains its GST — `o.gst` is the component, not an
     extra charge. Adding them told the shop SAAHAA had taken the tax twice. */
  const saahaa = o.platformFee | 0;
  const dispatch = o.dispatchCut | 0;

  /* THE DELIVERY MONEY GOES TO WHOEVER ACTUALLY DROVE. There is no rider
     network yet, so on a shop-delivered order the RIDER leg is credited to the
     shop at settlement (domain/flow.js). A panel reading only `shopPayout`
     understated what reaches the till by the whole delivery. */
  const ownDelivery = flags.isOn('RIDER_POOL') ? 0 : (o.riderPayout | 0);
  /* AND "YOU RECEIVE ₹755" NEVER MOVED THROUGH A RETURN, under the caption
     "This moves as you weigh". `acceptReturn` lowers `shopPayout` only once he
     has ACCEPTED, so the figure he decides against is the one from before she
     asked for anything back -- on the screen whose only question is whether to
     refund ₹340. He tapped it blind and the true outcome was ₹415.
     The column above still sums to what she paid, because that is what it is
     for; the pending return is answered underneath it. */
  const pendingBack = o.stage === 'R_RETURN' ? (flow.returnedValueOf(o) | 0) : 0;
  const gets = (o.shopPayout | 0) + ownDelivery;

  /* the three parts of one number, rounded together so the column she is shown
     adds up exactly as printed */
  const [rSaahaa, rDispatch, rGets] = M.roundParts([saahaa, dispatch, gets], paid);

  const shop = getState().shops.find(x => x.id === o.shopId) || {};
  const freeLeft = flow.freeOrdersLeft(shop);

  /* what the shop handed over and was not paid for — stated, never derived */
  const extraWeight = o.overWeighAbsorbed | 0;
  const coveredDelivery = o.shopAbsorbedDelivery
    ? (o.riderPayout | 0) + (o.dispatchCut | 0) : 0;

  return `
      <div class="m-kv" style="margin-top:10px"><span class="muted">${esc(t('shop.shePaid'))}</span><span class="num">${M.fmt(paid)}</span></div>
      <div class="m-kv"><span class="muted">${esc(t('shop.saahaaFee'))}${freeLeft ? ' · ' + esc(t('shop.freeForNext', { n: freeLeft })) : ''}</span><span class="num">− ${M.fmt(rSaahaa)}</span></div>
      ${rDispatch ? `<div class="m-kv"><span class="muted">${esc(t('shop.dispatchShort'))}</span><span class="num">− ${M.fmt(rDispatch)}</span></div>` : ''}
      <div class="m-kv m-kv--total"><span>${esc(t('shop.youReceive'))}</span><span class="num good">${M.fmt(rGets)}</span></div>
      <!-- ONE sentence, not a second total: the column above sums to what she
           paid and must keep doing that. This answers the question the screen
           is actually asking him. -->
      ${pendingBack ? `<p class="m-note" style="margin-top:8px">${esc(t('shop.ifYouAcceptNote', {
        back: M.fmt2(pendingBack), left: M.fmt2(Math.max(0, rGets - pendingBack)) }))}</p>` : ''}
      ${ownDelivery ? `<p class="micro muted" style="margin-top:4px">${esc(t('shop.includesYourDelivery', { amount: M.fmt(ownDelivery) }))}</p>` : ''}
      ${coveredDelivery ? `<p class="micro muted" style="margin-top:4px">${esc(t('shop.youCoveredDelivery', { amount: M.fmt(coveredDelivery) }))}</p>` : ''}
      ${extraWeight ? `<p class="micro" style="margin-top:4px;color:var(--color-accent-text)">${esc(t('shop.youGaveExtra', { amount: M.fmt2(extraWeight) }))}</p>` : ''}
      <p class="micro muted" style="margin-top:4px">${esc(t('shop.movesAsYouWeigh'))}</p>`;
}

function settleDeadline(o, forShop) {
  const at = flow.retailSettleAt(o);
  if (!at) return '';
  const hrs = Math.max(0, Math.ceil((at - Date.now()) / 3600000));
  const when = hrs <= 1 ? 'within the hour' : `in about ${hrs} hours`;
  return forShop
    ? `If she does not confirm, this settles by itself ${when} and your money is released.`
    : `If you do nothing, this settles by itself ${when} and the shop is paid.`;
}
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
    <div class="m-cap" style="margin:0 0 4px">${esc(t('job.whereToGo'))}</div>
    ${addr ? `<div style="font:700 14px/1.35 var(--font-body);user-select:text">${esc(addr)}</div>` : ''}
    ${mark ? `<div class="tiny" style="margin-top:2px;user-select:text">${esc(t('job.landmarkIs'))}: ${esc(mark)}</div>` : ''}
    <div class="micro muted" style="margin-top:${addr ? '4px' : '0'}">${esc(area)}${o.km != null ? ' · ' + esc(t('job.kmAway', { km: o.km })) : ''}</div>
    <!-- THIS SENTENCE WAS A LIE ON A THIRTY-SECOND-OLD ORDER. Every grocery
         order carried an empty address, because the cart never asked for one —
         so the pro was told the order predated a feature it was placed after.
         A fallback cannot date an order; only the order can. It says what is
         actually true now, and dates itself from the order's own timestamp. -->
    ${addr ? '' : `<p class="micro muted" style="margin-top:6px">${
      o.createdAt && o.createdAt < ADDRESSES_SINCE
        ? 'This booking was taken before addresses were collected.'
        : 'No door number was given for this one.'}
      Message the customer for the door number before you set out.</p>`}
    <button class="btn btn--ghost btn--sm" style="margin-top:8px" data-act="nav.chat" data-id="${esc(o.id)}">${esc(t('job.messageCustomer'))}</button>
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
    /* AND THE RETAIL ONES FELL THROUGH TO THE ENGINE'S ENGLISH. She got a
       Telugu cart, paid, and then watched an English tracker for the entire
       delivery — the screen she actually refreshes while she waits. */
    case 'R_PLACED':       return t('stage.R_PLACED');
    case 'R_ACCEPTED':     return t('stage.R_ACCEPTED');
    case 'R_PICKING':      return t('stage.R_PICKING');
    case 'R_SUB_PENDING':  return t('stage.R_SUB_PENDING');
    case 'R_PACKED':       return t('stage.R_PACKED');
    case 'R_PICKUP_READY': return t('stage.R_PICKUP_READY');
    case 'R_OUT':          return t('stage.R_OUT');
    case 'R_DELIVERED':    return t('stage.R_DELIVERED');
    case 'R_FAILED':       return t('stage.R_FAILED');
    case 'R_RETURN':       return t('stage.R_RETURN');
    case 'R_REFUNDED':     return t('stage.R_REFUNDED');
    case 'R_SETTLED':      return t('stage.R_SETTLED');
    case 'R_CANCELLED':    return t('stage.R_CANCELLED');
    case 'R_CLOSED':       return t('stage.R_CLOSED');
    default:            return st.label;
  }
};



/* What the customer is told about the deadline on her own job. A job under
   review has no clock at all and must not pretend to; one with a window states
   the hour, because "auto-releases" without a number is not information. */
function releaseLine(o) {
  const tier = ESCROW[o.escrowTier] || null;
  if (!tier || !isFinite(tier.holdMs)) {
    return `<p class="tiny" style="margin:0 0 10px;opacity:.85">${esc(t('order.underReviewNote'))}</p>`;
  }
  const at = (o.releaseAt || 0);
  const left = at - Date.now();
  if (left <= 0) return `<p class="tiny" style="margin:0 0 10px;opacity:.85">${esc(t('order.confirmNow'))}</p>`;
  /* "RELEASES BY ITSELF IN 1H 60M", on the screen where her ₹510 is at stake.
     The minutes were rounded independently of the hours, so a remainder of
     59m30s printed as 60. Round the whole thing once, then split it. */
  const mins = Math.max(0, Math.round(left / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  const when = h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m} min`;
  /* and it said "look at the pictures" over a panel reading NOTED, NO PHOTOGRAPH */
  const shots = (o.evidence || []).length;
  return `<p class="tiny" style="margin:0 0 10px;opacity:.85">Confirm when you are happy with the work.
    If you do nothing, this releases by itself in <b>${when}</b> — so ${shots ? 'look at the pictures' : 'read what they left'} before then,
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
  const ord = getState().orders.find(x => x.id === orderId) || {};
  const mine = flow.reasonsFor(s.role, ord.kind);
  const isPro = s.role === 'partner' || s.role === 'shop';
  const isBasket = ord.kind === 'retail';
  sheet(isPro ? 'Something is wrong at this job' : 'Report an issue', `
    <p class="tiny muted" style="margin-bottom:14px">${esc(t(isBasket ? 'order.reportLeadBasket' : 'order.reportLeadJob'))}</p>
    <p class="m-note" style="margin-bottom:14px">${isPro
      ? esc(t('order.reportNotePro')) : esc(t('order.reportNoteCustomer'))}</p>
    <div class="chiprow" style="flex-wrap:wrap;gap:8px">
      ${mine.map(r => `<button class="chip" data-act="dispute.pick"
        data-id="${orderId}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <p class="micro muted" style="margin-top:16px">${isPro ? esc(t('order.reportFootPro'))
      : isBasket ? esc(t('order.reportFootBasket')) : esc(t('order.reportFootJob'))}</p>${SYS_CSS}`);
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
  /* the sibling sheet does this and this one only claimed to — four bare
     bare M.fmt calls under a comment saying they were rounded together */
  /* THE CREDIT IS NOT PART OF WHAT SHE PAID. `cancelSplit` guarantees refund +
     worker + platform sums to what she paid; the goodwill credit is SAAHAA's
     own money on top, so folding it in asked the helper to fit ₹914 into ₹814
     and tripped the guard on every no-show. Only the parts that belong. */
  const noShowRow = M.fmtParts([split.refund, split.worker | 0, split.platform | 0], o.customerPays | 0);
  const first = String(o.partnerName || 'Your pro').split(' ')[0];
  sheet('They never arrived?', `
    <p>${esc(first)} has not entered your code, so nothing has started. This is on them, not on you.</p>
    <!-- the three halves of what she paid, rounded together: this sheet asks
         her to accept a split, so the split has to survive being added up -->
    <div class="m-kv" style="margin-top:14px"><span>You paid</span><span class="num">${M.fmt(o.customerPays)}</span></div>
    <div class="m-kv"><span>Back in your wallet</span><span class="num">${noShowRow[0]}</span></div>
    ${split.credit ? `<div class="m-kv"><span>Credit for the wasted wait</span><span class="num">${M.fmt(split.credit)}</span></div>` : ''}
    ${split.worker ? `<div class="m-kv"><span>${esc(first)} keeps</span><span class="num">${noShowRow[1]}</span></div>` : ''}
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
  /* refund / his share / ours, rounded against what she actually paid — she is
     being asked to accept this split, so it has to survive being added up */
  const cancelRow = M.fmtParts([split.refund, split.worker, split.platform], o.customerPays | 0);
  const first = String(o.partnerName || 'Your pro').split(' ')[0];
  sheet('Cancel booking?', `
    <p>${rule === 'BEFORE_ACCEPT' ? 'No pro has accepted this job yet.'
        : rule === 'EN_ROUTE' ? `${esc(first)} is already travelling to you.`
        : `${esc(first)} has accepted but has not set out yet.`}</p>
    <div class="m-kv" style="margin-top:14px"><span>You paid</span><span class="num">${M.fmt(o.customerPays)}</span></div>
    ${split.worker ? `<div class="m-kv"><span class="muted">${esc(first)} keeps, for the journey</span><span class="num">${cancelRow[1]}</span></div>` : ''}
    ${split.platform > 0 ? `<div class="m-kv"><span class="muted">SAAHAA keeps</span><span class="num">${cancelRow[2]}</span></div>` : ''}
    <div class="m-kv m-kv--total"><span>Back in your wallet</span><span class="num">${cancelRow[0]}</span></div>
    <p class="micro muted" style="margin-top:8px">It lands in your SAAHAA wallet, to spend on the next job or to take out to your UPI.</p>
    <!-- The breakdown is derived from what she actually paid, so it survives
         being added up; the button used to re-round the raw split on its own and
         read "₹272 back" under a total line saying ₹273. She is being asked to
         accept this split, so the button quotes the figure the sheet showed her.
         (This comment lived INSIDE the button tag for one build. The parser ate
         data-act with it, and cancelling was dead app-wide.) -->
    <button class="btn btn--danger btn--block" style="margin-top:16px"
      data-act="cancel.confirm" data-id="${orderId}" data-rule="${rule}">Yes, cancel · ${cancelRow[0]} back</button>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="sheet.close">Keep it</button>${SYS_CSS}`);
}
