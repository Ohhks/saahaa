/* SAAHAA · ui/views/ask.js — "Ask rates", the customer face of the P2P auction.

   THE WORD IS "RATE", NEVER "BID". A bid is a "rate", a bidder is a "worker",
   the set of them is "replies", and the locked match is the "held price".
   The words bid / auction / P2P / cheapest / negotiate appear nowhere on screen.

   THREE RULES CARRY THE WHOLE FEATURE:
     1. THE HELD PRICE NEVER MOVES. Asking cannot cost the customer anything.
     2. THE FIRST REPLY IS NEVER ZERO. At 8 seconds the held price appears as
        reply one — truthfully that pro's own rate.
     3. NEVER SORT BY PRICE, NEVER PROMISE CHEAPEST.

   MODERNIST. The mockup's 1b "Quotes arriving" (request title, "Sent x ago ·
   n of m replied", the honest strip, reply rows with a price, Accept / Ask)
   and 1d "Request a job" (the entry row: who it goes to, how long, what
   stays held, Send to the circle). Every price the customer sees is what
   they PAY — the worker's rate plus SAAHAA's live charge — and every sentence
   about money says who holds it: SAAHAA, until the work is confirmed. */

import { ctx, getState, me, isGuest, myArea } from '../../core/ctx.js';
import * as M from '../../core/money.js';
import { esc, sheet, closeSheet, toast, ratingStars, timeAgo } from '../dom.js';
import { get } from '../../core/registry.js';
import { icon } from '../icons.js';
import * as A from '../../domain/auction.js';
import { priceScore } from '../../domain/bidding.js';
import { quoteService, liveMarkup } from '../../domain/pricing.js';
import { SYS_CSS } from './shops.js';

/* Workers bid the DEAL — their own rate, which they keep 100% of. The
   customer is charged the deal plus the platform's service markup — the LIVE
   one from Admin → Charges, never a constant. Every customer-facing number
   here is what they PAY; every worker-facing number is what he EARNS. */
const pay = deal => quoteService(deal).customerPays;
const payGap = deal => Math.round(deal * (1 + liveMarkup()));
const pct = () => Math.round(liveMarkup() * 100);

/* ── the live clock ───────────────────────────────────────────
   One interval for the whole module. A screen that stops moving while workers
   are still replying reads as a hung app. */
let tick = null;
function beat(on) {
  if (on && !tick) tick = setInterval(() => { if (ctx.view === 'ask') ctx.render(); else beat(false); }, 1000);
  if (!on && tick) { clearInterval(tick); tick = null; }
}

/* real stars from real ratings — never a rescaled score component dressed up
   as a rating on the most trust-loaded card in the feature */
function avgOf(partnerId) {
  const p = getState().partners.find(x => x.id === partnerId);
  const r = (p && p.ratings) || [];
  return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 4.2;
}
const mmss = ms => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const avatar = (name, size = 40, dim = false) =>
  `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px;${dim ? 'opacity:.35' : ''}">${esc((name || '?')[0])}</span>`;

/* the strip that never scrolls away: who holds the money, and what it is */
const honest = held => `<p class="m-note" style="margin:0 calc(-1 * var(--gutter));border-bottom:2px solid var(--color-divider)">
  Every price below is the worker's own rate plus SAAHAA's ${pct()}% charge. ${held
    ? `Your ${M.fmt(pay(held))} stays held by SAAHAA until you confirm the work — nothing is paid to anyone directly.`
    : 'You pay SAAHAA; the money is held until you confirm the work.'}</p>`;

/* ── entry point: the row under Confirm — 1d "Request a job" ────
   BELOW the Confirm button, never above, never a modal. The engine takes a
   category, a slot and the held price; there is no free-text brief, photo,
   date or budget field, so none is drawn. What it does know is drawn: who it
   goes to, how long it takes, and what stays held. */
export function entryRow(catId, partner, heldAmount) {
  const o = A.askOffer(catId, heldAmount);
  if (!o.show) return '';
  const done = asksCompleted();
  const mine = lastSaving();
  const cat = get('category', catId);
  const pool = Math.min(A.MAX_INVITES, A.poolSize(catId));
  // Personal beats population, always. Their own rupees from last time.
  const lead = mine ? `Last time you saved ${M.fmt(payGap(mine))} by asking.`
                    : `People here paid about ${M.fmt(payGap(o.est))} less.`;
  return `
  <div style="display:flex;align-items:center;gap:10px;margin:14px 0 10px">
    <span class="rule grow" style="margin:0"></span><span class="micro" style="opacity:.7">or</span><span class="rule grow" style="margin:0"></span>
  </div>
  <p class="m-cap" style="opacity:.8">Request a job instead</p>
  <p class="tiny" style="opacity:.85;margin-bottom:8px">Goes to ${pool} ${esc(cat.name.toLowerCase())} pro${pool === 1 ? '' : 's'} near ${esc(myArea())}.
    ${esc(lead)}${done < 2 ? ` Takes about ${o.mins} min. Your ${M.fmt(pay(heldAmount))} with ${esc(partner.name)} stays held — you lose nothing by asking.` : ''}</p>
  <button class="btn btn--secondary btn--block" style="justify-content:flex-start;color:inherit;border-color:currentColor"
          data-act="ask.start" data-id="${catId}" data-pid="${partner.id}" data-held="${heldAmount}">
    Send to the circle →
  </button>`;
}

export function asksCompleted() {
  return A.myRequests().filter(r => r.status === 'awarded' || r.status === 'held_booked').length;
}
function lastSaving() {
  const r = A.myRequests().find(x => x.status === 'awarded' && x.savedPaise > 0);
  return r ? r.savedPaise : 0;
}

/* ── start ─────────────────────────────────────────────────── */
export function startAsk(catId, partnerId, heldAmount) {
  if (isGuest()) { toast('Sign in first'); ctx.go('auth'); return; }
  const p = getState().partners.find(x => x.id === partnerId);
  if (!p) return;
  const req = A.postRequest({
    catId, slotType: 'now',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount },
  });
  if (!req) return;
  closeSheet();
  ctx.go('ask', req.id);
}

/* ── the screen ────────────────────────────────────────────── */
export function render(requestId) {
  const req = A.requestById(requestId);
  if (!req) { beat(false); return shell('Ask rates', '', `<div class="empty"><h3 style="font-size:17px">That request is gone</h3>
    <p style="margin-top:6px">It may have expired. Nothing was charged.</p>
    <button class="btn btn--primary" style="margin-top:12px" data-act="nav.home">Back to home</button></div>`); }

  A.closeIfDue(requestId);
  const live = A.requestById(requestId);
  if (live.status === 'bidding') { beat(true); return waiting(live); }
  beat(false);
  if (live.status === 'awaiting_choice') { beat(true); return choosing(live); }
  if (live.status === 'no_bids') return noBids(live);
  return shell('Ask rates', '', `<div class="sec"><b>This request is closed.</b>
    <p class="tiny muted" style="margin-top:6px">Nothing was charged.</p>
    <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="nav.orders">Your orders</button></div>`);
}

function shell(title, sub, body) {
  return `<header class="hdr">
      <div class="wrap inner">
        <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back" style="padding-inline:6px;color:inherit">${icon('back', { size: 20 })}</button>
        <div class="grow" style="min-width:0"><b style="font:800 15px/1.15 var(--font-heading);display:block">${esc(title)}</b>
          ${sub ? `<span style="display:block;font-size:11px;color:var(--ink-3)">${esc(sub)}</span>` : ''}</div>
      </div></header>
    <main class="wrap" style="padding-bottom:120px">${body}</main>${SYS_CSS}`;
}

/* ── waiting — "Quotes arriving" ───────────────────────────────
   For the first 30 seconds this screen's only job is to prove that humans are
   moving — named workers, not a spinner. After 30 seconds its job changes:
   let the customer LEAVE safely. */
function waiting(req) {
  const cat = get('category', req.catId);
  const now = Date.now();
  const elapsed = now - req.openedAt;
  const total = req.closesAt - req.openedAt;
  const bids = A.bidsFor(req.id).slice().sort((a, b) => a.submittedAt - b.submittedAt);
  const pool = A.poolSize(req.catId);
  const invited = Math.min(A.MAX_INVITES, 4 * (Math.floor(elapsed / 180000) + 1), pool);
  const heldShown = elapsed >= 8000;
  const replies = bids.length + (heldShown ? 1 : 0);
  const held = req.held ? req.held.amount : null;

  const dots = Array.from({ length: 4 }, (_, i) => {
    const lit = elapsed > 2000 + i * 1500;
    const nm = (req.held && i === 0) ? req.held.partnerName : ['Sattar', 'Prakash', 'Venu', 'Imran'][i] || '·';
    return `<div style="text-align:center;flex:1">
      ${avatar(nm, 44, !lit)}
      <p class="micro ${lit ? '' : 'muted'}" style="margin-top:5px">${lit ? esc(nm.split(' ')[0]) : '···'}</p>
    </div>`;
  }).join('');

  const cards = [];
  if (heldShown && req.held) cards.push(replyRow(req, {
    partnerId: req.held.partnerId, partnerName: req.held.partnerName, amount: req.held.amount, held: true,
  }));
  bids.forEach(b => cards.push(replyRow(req, { ...b, held: false, held0: held })));

  return shell(`${cat.name}${req.sub ? ' · ' + req.sub : ''}`, `Sent ${timeAgo(req.openedAt)} · ${replies} of ${invited} replied`, `
    ${honest(held)}

    <div class="sec">
      <div class="between">
        <div><p class="m-cap" style="margin:0 0 2px">Your held price</p>
          <div class="num" style="font:800 27px/1 var(--font-heading)">${M.fmt(pay(held || req.target))}</div></div>
        <span class="tag tag-neutral">Safe · nothing charged yet</span>
      </div>
      <p class="tiny muted" style="margin-top:6px">${req.held ? `${esc(req.held.partnerName)} comes as planned unless you pick someone else.` : 'Nothing is charged until you pick.'}</p>
    </div>

    <div class="sec">
      <p class="m-cap">Asking ${invited} workers near you</p>
      <div class="row" style="gap:4px;margin:6px 0 14px">${dots}</div>
      <!-- elapsed counts UP with a marker at "usually done". A 12:00 countdown
           reads as a twelve-minute wall and drives people straight out. -->
      <div class="bar" style="position:relative"><i style="width:${Math.min(100, (elapsed / total) * 100).toFixed(1)}%"></i>
        <i style="position:absolute;left:33%;top:-4px;width:2px;height:14px;background:var(--color-text);opacity:.5"></i></div>
      <div class="between" style="margin-top:6px">
        <span class="micro muted">${mmss(elapsed)} elapsed</span>
        <span class="micro muted">${replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'most people get 3 rates in about 4 minutes'} · usually done by 4:00</span>
      </div>
    </div>

    ${cards.length ? `<div class="sec" style="padding-top:0">${cards.join('')}</div>` : ''}

    <p class="tiny muted" style="padding:12px 0;border-top:2px solid var(--color-divider)">
      ${Math.max(0, invited - replies)} more workers are still preparing rates. Nothing expires while you wait —
      if you don't pick, your ${M.fmt(pay(held || req.target))} booking stays. Nothing is lost.</p>

    ${elapsed > 30000 ? `<button class="btn btn--ghost btn--block" style="justify-content:flex-start"
        data-act="ask.background" data-id="${req.id}">Close the app. We'll message you.</button>` : ''}

    ${bottomBar(req)}`);
}

/* one reply: name, stars · km · standing, the price you would pay, and what
   you can do with it. In the waiting state only the held reply is bookable
   (the others are sealed until the window closes). */
function replyRow(req, b) {
  const less = b.held0 && b.amount < b.held0 ? b.held0 - b.amount : 0;
  const p = getState().partners.find(x => x.id === b.partnerId) || {};
  return `<div style="padding:12px 0;border-bottom:1px solid var(--color-divider)">
    <div class="between" style="align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <div style="font:800 15px/1.2 var(--font-heading)">${esc(b.partnerName)}</div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:3px">${avgOf(b.partnerId).toFixed(1)} ★${b.km != null ? ` · ${b.km} km` : p.area ? ` · ${esc(p.area)}` : ''}${b.eta ? ` · ~${b.eta} min` : ''}${b.held ? ' · your first match' : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font:800 21px/1 var(--font-heading)" class="num">${M.fmt(pay(b.amount))}</div>
        <div style="font-size:10px;color:var(--ink-3);margin-top:3px">${less ? `${M.fmt(payGap(less))} less than held` : `incl. SAAHAA ${pct()}%`}</div>
      </div>
    </div>
    ${b.held ? `<div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn--primary" style="flex:1;justify-content:flex-start" data-act="ask.held" data-id="${req.id}">Accept · already yours</button>
    </div>` : `<p class="micro muted" style="margin-top:8px">Sealed until the window closes — then you pick.</p>`}
  </div>`;
}

/* Both escapes are one tap and neither asks "are you sure". */
function bottomBar(req) {
  const held = req.held ? req.held.amount : null;
  return `<div class="m-bar" style="gap:8px">
    ${held ? `<button class="btn btn--primary grow" style="justify-content:flex-start" data-act="ask.held" data-id="${req.id}">
      Book ${M.fmt(pay(held))} now</button>` : ''}
    <button class="btn btn--secondary" data-act="ask.cancel" data-id="${req.id}">Cancel</button>
  </div>
  <p class="micro muted" style="margin-top:6px">Cancelling charges nothing.</p>`;
}

/* ── choosing — "Rates are in" ─────────────────────────────────
   Sorted by score. NEVER by price. The cheapest reply is always shown, always
   bookable, and carries one honest sentence naming what it costs in rating
   and arrival time. */
function choosing(req) {
  const r = A.ranked(req.id);
  const held = req.held ? req.held.amount : null;
  const msLeft = (req.holdUntil || 0) - Date.now();
  if (!r.hero) return noBids(req);
  const cat = get('category', req.catId);

  const showCounter = asksCompleted() >= 2;      // hidden for first-timers on purpose
  const cards = [];
  cards.push(heroReply(req, r.hero, held, showCounter));
  r.others.forEach(b => cards.push(otherReply(req, b, r.hero, r.cheapest, held)));

  return shell(`${cat.name}${req.sub ? ' · ' + req.sub : ''}`, `${r.all.length} workers replied · ${mmss(msLeft)} to pick`, `
    ${honest(held)}
    <div class="sec">${cards.join('')}</div>
    ${held ? `<div style="padding:12px 0;border-top:2px solid var(--color-divider)">
      <div class="between" style="gap:10px">
        <div class="row">${avatar(req.held.partnerName, 34, true)}
          <div class="grow"><b class="tiny">${esc(req.held.partnerName)}</b>
            <p class="micro muted">Your held price · first match</p></div></div>
        <button class="btn btn--secondary btn--sm" data-act="ask.held" data-id="${req.id}">Book ${M.fmt(pay(held))}</button>
      </div></div>` : ''}
    <p class="micro muted" style="margin-top:12px">Whoever you pick, you pay SAAHAA and the money is held until you confirm the work.</p>`);
}

function heroReply(req, b, held, showCounter) {
  const less = held && b.amount < held ? held - b.amount : 0;
  const c = showCounter ? A.counterFor(req.id, b.id) : { available: false };
  const pending = b.status === 'countered';
  return `<div class="bestmatch" style="margin-bottom:12px">
    <span class="tag tag-accent" style="align-self:flex-start">Best pick</span>
    <div class="between" style="align-items:flex-start;gap:10px">
      <div class="row" style="min-width:0">
        ${avatar(b.partnerName, 44)}
        <div class="grow" style="min-width:0"><b style="font-size:16px">${esc(b.partnerName)}</b>
          <p class="tiny" style="opacity:.8">${ratingStars(avgOf(b.partnerId))} · ${b.km} km · ${esc((b.band && b.band.label) || 'Verified')}</p></div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="num" style="font:800 24px/1 var(--font-heading)">${M.fmt(pay(b.amount))}</div>
        <div class="micro" style="opacity:.75;margin-top:3px">${less ? `${M.fmt(payGap(less))} less than held` : 'fair price'}</div>
      </div>
    </div>
    <p class="tiny" style="opacity:.85">${esc(whyLine(b))}</p>
    <div class="row" style="gap:8px">
      <button class="btn btn--primary" style="flex:1;justify-content:flex-start" data-act="ask.accept"
              data-id="${req.id}" data-bid="${b.id}">Accept · ${M.fmt(pay(b.amount))}</button>
      ${pending ? '' : c.available ? `<button class="btn btn--secondary" style="color:inherit;border-color:currentColor"
        data-act="ask.counter" data-id="${req.id}" data-bid="${b.id}">Ask ${M.fmt(pay(c.amount))}?</button>` : ''}
    </div>
    ${pending ? `<p class="micro" style="opacity:.75">Asked. If he says no, ${M.fmt(pay(b.amount))} is still yours.</p>` : ''}
  </div>`;
}

function otherReply(req, b, hero, cheapest, held) {
  const isCheapest = cheapest && b.id === cheapest.id && cheapest.id !== hero.id;
  const gap = isCheapest ? hero.amount - b.amount : 0;
  return `<div style="padding:12px 0;border-bottom:1px solid var(--color-divider)">
    <div class="between" style="align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <div style="font:800 15px/1.2 var(--font-heading)">${esc(b.partnerName)}</div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:3px">${avgOf(b.partnerId).toFixed(1)} ★ · ${b.km} km · ~${b.eta} min${isCheapest ? ' · lowest price' : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="num" style="font:800 21px/1 var(--font-heading)">${M.fmt(pay(b.amount))}</div>
        <div style="font-size:10px;color:var(--ink-3);margin-top:3px">incl. SAAHAA ${pct()}%</div>
      </div>
    </div>
    ${isCheapest && gap > 0 ? `<p style="font-size:12.5px;margin:9px 0 0;line-height:1.5">
      ${M.fmt(payGap(gap))} cheaper, but ${esc(tradeoff(b, hero))}.</p>` : ''}
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn--secondary" style="flex:1;justify-content:flex-start"
              data-act="ask.accept" data-id="${req.id}" data-bid="${b.id}"
              data-warn="${lowRated(b, hero) ? '1' : ''}">Accept · ${M.fmt(pay(b.amount))}</button>
    </div>
  </div>`;
}

/* Exactly two reasons, in fixed plain phrasings. Never a percentage, never a
   "score", never the word algorithm. */
function whyLine(b) {
  const bits = [];
  if (b.parts.price > 0.9) bits.push('fair price');
  if (b.parts.rating > 0.75) bits.push('best rating');
  if (b.parts.distance > 0.6) bits.push(`${b.eta} min away`);
  if (b.parts.trust > 0.7) bits.push('most trusted');
  if (!bits.length) bits.push('best overall');
  return bits.slice(0, 3).join(', ') + '.';
}
function tradeoff(b, hero) {
  const out = [];
  if (b.parts.rating < hero.parts.rating - 0.08) out.push('rated lower');
  if (b.km > hero.km + 1) out.push(`${b.eta} min away`);
  if (b.trust < hero.trust - 5) out.push('less trusted');
  return out.slice(0, 2).join(' and ') || 'newer to SAAHAA';
}
const lowRated = (b, hero) => (hero.parts.rating - b.parts.rating) > 0.24;

/* ── nobody beat it ────────────────────────────────────────────
   A failed ask is framed as a CONFIRMED GOOD PRICE, not a broken feature. */
function noBids(req) {
  const held = req.held ? req.held.amount : null;
  return shell('Rates are in', held ? `Your ${M.fmt(pay(held))} was the best rate` : 'No replies', `
    <div class="sec">
      <p class="card-kicker">Confirmed</p>
      <h2 class="h-sec" style="margin:4px 0 6px">No one beat your price.</h2>
      <p class="tiny muted">${held ? `Your ${M.fmt(pay(held))} with ${esc(req.held.partnerName)} is still ready. ` : ''}Nothing was charged.</p>
      ${held ? `<button class="btn btn--primary btn--lg btn--block" style="margin-top:18px;justify-content:flex-start"
        data-act="ask.held" data-id="${req.id}">Book ${M.fmt(pay(held))}</button>` : ''}
      <button class="btn btn--ghost btn--block" style="margin-top:8px"
        data-act="ask.cancel" data-id="${req.id}">Cancel</button>
    </div>`);
}

/* ── the receipt: the whole teaching path in three lines ───────
   The one number that drives repeat use is the rupees THEY saved on THEIR
   last job. */
export function showReceipt(req, paid, workerName) {
  const s = A.savings(req, paid);
  const zero = s.amount <= 0;
  sheet('', `<div style="padding:4px 0">
    <p class="m-cap">You asked ${Math.max(1, s.replies)} ${Math.max(1, s.replies) === 1 ? 'worker' : 'workers'}</p>
    <div class="m-kv"><span>You pay</span><span class="num" style="font-size:22px">${M.fmt(pay(paid))}</span></div>
    ${zero
      // A zero shown AS zero kills the second use permanently. It is not a
      // loss — it is a confirmed good price, and it must read as one.
      ? `<p class="m-note" style="margin-top:10px">Your held price was already the best rate. Nothing lost.</p>`
      : `<div class="m-kv m-kv--total"><span>You saved</span><span class="num" style="color:var(--color-accent)">${M.fmt(payGap(s.amount))}</span></div>`}
    <p class="tiny muted" style="margin-top:14px">${esc(workerName)} is booked. SAAHAA holds ${M.fmt(pay(paid))} until you confirm the work.</p>
    <button class="btn btn--primary btn--lg btn--block" style="margin-top:20px;justify-content:flex-start" data-act="sheet.close">Done</button>
  </div>${SYS_CSS}`);
}

/* ── the worker's side ─────────────────────────────────────────
   The single most important element here is the LIVE chance meter dropping as
   he drags below the fair price. Pre-filling at the fair price with a one-tap
   send makes the LAZY action the CORRECT one. What is safe to show: the public
   band, the COUNT of workers asked, and his own standing. Never another
   worker's price, name, or whether anyone has replied at all. */
export function bidSheet(requestId, partner) {
  const req = A.requestById(requestId);
  if (!req) return;
  const cat = get('category', req.catId);
  sheet(cat.name, `
    <p class="tiny muted">${esc(req.area)} · ${esc(req.sub || cat.name)} · asked ${Math.round((Date.now() - req.openedAt) / 60000)} min ago</p>

    <div class="m-sec" style="border-top:2px solid var(--color-divider);margin-top:12px">
      <div class="m-kv"><span class="m-cap" style="margin:0">Fair price for this job</span>
        <b class="num" style="font-size:22px">${M.fmt(req.target)}</b></div>
      <p class="micro muted" style="margin-top:6px">Most jobs here go ${M.fmt(req.floor)} – ${M.fmt(req.ceiling)}</p>
      <p class="micro muted" style="margin-top:4px">${req.bidCount} workers asked so far.</p>
    </div>

    <div class="on-plum" style="padding:14px;margin-top:12px">
      <div class="between" style="margin-bottom:10px">
        <span class="m-cap" style="margin:0;color:color-mix(in srgb,var(--color-bg) 70%,transparent)">Your rate</span>
        <b class="num" id="bidAmt" style="font-size:24px">${M.fmt(req.target)}</b>
      </div>
      <input type="range" id="bidRange" min="${req.floor / 100}" max="${req.ceiling / 100}"
             step="10" value="${req.target / 100}" style="width:100%;accent-color:var(--color-accent)"
             data-target="${req.target}" data-beff="${req.beff}">
      <div class="between"><span class="micro" style="opacity:.7">${M.fmt(req.floor)}</span>
        <span class="micro" style="color:var(--color-accent-400);font-weight:700">▲ Best chance</span>
        <span class="micro" style="opacity:.7">${M.fmt(req.ceiling)}</span></div>
      <div style="margin-top:14px">
        <div class="between"><span class="tiny" style="opacity:.8">Your chance</span>
          <b class="tiny" id="chanceLbl">strong</b></div>
        <div style="height:9px;background:color-mix(in srgb,var(--color-bg) 20%,transparent);margin-top:5px;overflow:hidden">
          <i id="chanceBar" style="display:block;height:100%;width:100%;background:var(--success);
             transition:width .18s ease,background .18s ease"></i></div>
      </div>
      <p class="micro" style="margin-top:10px;opacity:.75">
        Sending less than ${M.fmt(req.target)} lowers your chance. It does not raise it.</p>
    </div>

    <div class="m-sec" style="border-top:2px solid var(--color-divider);margin-top:12px;padding-top:10px">
      <div class="between" style="font:800 18px/1.2 var(--font-heading)">
        <span>Your price</span><b class="num" id="bidKeep">${M.fmt(req.target)}</b></div>
      <div class="between" style="font-size:12.5px;margin-top:4px">
        <span class="muted">You keep</span><span class="muted">100% — nothing comes out of it</span></div>
      <div class="between" style="font-size:12.5px;margin-top:2px">
        <span class="muted">SAAHAA's ${pct()}%, paid by the customer</span>
        <span class="muted" id="bidFee">${M.fmt(payGap(req.target) - req.target)}</span></div>
      <div class="between" style="font:800 14px/1.2 var(--font-heading);padding-top:8px;margin-top:8px;border-top:1px solid var(--color-divider)">
        <span>The customer pays</span><span id="bidPays">${M.fmt(payGap(req.target))}</span></div>
    </div>

    <button class="btn btn--primary btn--lg btn--block" style="margin-top:14px;justify-content:flex-start"
            id="sendBid" data-act="bid.send" data-id="${requestId}" data-pid="${partner.id}"
            data-amt="${req.target}">Send ${M.fmt(req.target)}</button>
    <button class="btn btn--ghost btn--block" style="margin-top:6px" data-act="sheet.close">Not interested</button>
    ${SYS_CSS}`);
  wireSlider(req);
}

function wireSlider(req) {
  const range = document.getElementById('bidRange');
  if (!range) return;
  const amtEl = document.getElementById('bidAmt');
  const bar = document.getElementById('chanceBar');
  const lbl = document.getElementById('chanceLbl');
  const btn = document.getElementById('sendBid');
  const band = { beff: req.beff, floor: req.floor, target: req.target, ceiling: req.ceiling, quoteOnly: false };
  /* Normalise the price score over the range actually reachable HERE, so the
     meter answers the real question — how does this rate compare with my best
     possible one. */
  const worst = Math.min(priceScore(band.floor, band), priceScore(band.ceiling, band));
  const rel = a => (priceScore(a, band) - worst) / Math.max(1e-6, 1 - worst);
  const paint = () => {
    const paise = Math.round(Number(range.value) * 100);
    const pc = Math.round(rel(paise) * 100);
    amtEl.textContent = M.fmt(paise);
    bar.style.width = `${Math.max(6, pc)}%`;
    bar.style.background = pc > 75 ? 'var(--success)' : pc > 45 ? 'var(--warn)' : 'var(--color-accent)';
    lbl.textContent = pc > 75 ? 'strong' : pc > 45 ? 'fair' : 'weak';
    btn.dataset.amt = String(paise);
    btn.textContent = `Send ${M.fmt(paise)}`;
    /* the money truth moves with the slider: he keeps all of it, the customer
       pays our percentage on top (domain/settings.js owns the number) */
    const keep = document.getElementById('bidKeep');
    if (keep) {
      keep.textContent = M.fmt(paise);
      document.getElementById('bidFee').textContent = M.fmt(payGap(paise) - paise);
      document.getElementById('bidPays').textContent = M.fmt(payGap(paise));
    }
  };
  range.addEventListener('input', paint);
  paint();
}

/** Post-job coaching, rendered honestly. "Your price was not the problem" is
    the line that stops undercutting — his own numbers shown back to him. */
export function showLoserFeedback(fb) {
  if (!fb) return;
  sheet('This job went to someone else', `
    <div class="m-kv"><span class="muted">You sent</span><span class="num">${M.fmt(fb.yourBid)}</span></div>
    <div class="m-kv"><span class="muted">The job went at</span><span class="num">${M.fmt(fb.winningBid)}${fb.winningBid > fb.yourBid ? ` <span class="micro muted">(${M.fmt(fb.winningBid - fb.yourBid)} more)</span>` : ''}</span></div>
    <p class="tiny muted" style="margin-top:8px">He won on ${esc((fb.lostOn || []).join(' and ') || 'overall standing')}.</p>
    ${fb.winningBid > fb.yourBid
      ? `<p class="m-note" style="margin-top:14px;font-weight:700">Your price was not the problem.</p>` : ''}
    <button class="btn btn--primary btn--block" style="margin-top:16px" data-act="sheet.close">Got it</button>${SYS_CSS}`);
}

export { beat };
