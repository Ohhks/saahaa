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
import { markupFor, ratingOf, ratingLabel, effectiveCap } from '../../domain/trust.js';
import { SYS_CSS } from './shops.js';
import { subSize } from '../../domain/catalog.services.js';
import { t } from '../i18n.js';

/* Workers bid the DEAL — their own rate, which they keep 100% of. The
   customer is charged the deal plus the platform's service markup — the LIVE
   one from Admin → Charges, never a constant. Every customer-facing number
   here is what they PAY; every worker-facing number is what he EARNS. */
const payGap = deal => Math.round(deal * (1 + liveMarkup()));   // population estimates, not one person's bill

/* WHOSE MARKUP (8.2 guardian). The markup is not one number: domain/trust.js
   `markupFor()` gives a tier-4 pro the loyalty rate, and domain/flow.js prices
   the real order with it. Every figure on this screen belongs to ONE named
   worker's bid, so it has to be quoted at that worker's rate — quoting the
   general one made an Elite pro's card read "incl. SAAHAA 8% · Rs.764" and then
   charged Rs.750 at 6% on the very next screen. The general helpers above stay
   for the sentences that are about SAAHAA rather than about a person. */
const partnerOf = pid => (pid && getState().partners.find(x => x.id === pid)) || null;

/* WHAT THIS BID SAVES HER AGAINST THE ONE SHE IS HOLDING, in the only terms
   that can be checked: the two prices as they are PRINTED. The old version was
   a difference of deals multiplied by the rival's markup, which overstated the
   gap by ₹16 whenever the two pros sat on different tiers and credited two
   identical ₹403 quotes with different savings.

   It lives here, at module scope, because the fix for that was written into the
   rival card and used in the HERO card as well -- `saving` was a const in one
   function read from another, and the entire quote-picking screen died with
   "saving is not defined" the moment the sealed window closed. One definition,
   both callers, no scope to get wrong. */
const rupeesOf = v => Math.round((v | 0) / 100) * 100;
const savingVs = (req, b) => {
  const heldPay = req && req.held ? payP(req.held.amount, req.held.partnerId) : 0;
  const mine = rupeesOf(payP(b.amount, b.partnerId));
  const held = rupeesOf(heldPay);
  return held && mine < held ? held - mine : 0;
};
const mkOf = pid => markupFor(partnerOf(pid));
const payP = (deal, pid) => quoteService(deal, { markup: mkOf(pid) }).customerPays;
const gapP = (deal, pid) => Math.round(deal * (1 + mkOf(pid)));
const pctP = pid => Math.round(mkOf(pid) * 100);

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
/* AND IT DID EXACTLY THAT, ONE LINE BELOW THE PROMISE. An unrated partner was
   given 4.2 ★ here — a number with no rating behind it, printed on the card a
   customer uses to choose between two strangers' bids, next to a rival whose
   4.2 was real. `domain/trust.js ratingLabel` says "New" instead. */
const avgOf = pid => ratingOf(partnerOf(pid)).avg;          // null until somebody has actually rated
const starsFor = pid => ratingLabel(partnerOf(pid));
const mmss = ms => {
  /* was `const t`, which shadowed the translator the moment this file started
     importing one — harmless here only because this function never translates */
  const secs = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};
const avatar = (name, size = 40, dim = false) =>
  `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px;${dim ? 'opacity:.35' : ''}">${esc((name || '?')[0])}</span>`;

/* the strip that never scrolls away: who holds the money, and what it is */
const honest = (held, pid) => `<p class="m-note" style="margin:0 calc(-1 * var(--gutter));border-bottom:2px solid var(--color-divider)">
  Every price below is the worker's own rate plus SAAHAA's charge. ${held
    ? `Nothing is charged while you wait. Your ${M.fmt(payP(held, pid))} match is reserved, so asking cannot cost you it.`
    : 'You pay SAAHAA; the money is held until you confirm the work, or until the wait on that job runs out.'}</p>`;

/* ── entry point: the row under Confirm — 1d "Request a job" ────
   BELOW the Confirm button, never above, never a modal. The engine takes a
   category, a slot and the held price; there is no free-text brief, photo,
   date or budget field, so none is drawn. What it does know is drawn: who it
   goes to, how long it takes, and what stays held. */
export function entryRow(catId, partner, heldAmount, sub = null) {
  const o = A.askOffer(catId, heldAmount, { sub });
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
    <!-- "YOUR ₹680 STAYS HELD" WAS SHOWN TO A SIGNED-OUT VISITOR, who had no
         account and no money anywhere near this app. The sentence is a promise
         about money already committed; before she has committed any, it is a
         claim about a thing that does not exist. Held means held. -->
    ${esc(lead)}${done < 2 ? ` Takes about ${o.mins} min.${isGuest() ? '' : ` Your ${M.fmt(payP(heldAmount, partner.id))} with ${esc(partner.name)} stays held — you lose nothing by asking.`}` : ''}</p>
  <!-- "Send to the circle" is the brand talking, not the button. A label has to
       name its own destination, which is the rule this file's own header states.
       The paragraph above already says who it goes to; the button now agrees. -->
  <button class="btn btn--secondary btn--block" style="justify-content:flex-start;color:inherit;border-color:currentColor"
          data-act="ask.start" data-id="${catId}" data-pid="${partner.id}" data-held="${heldAmount}" data-sub="${esc(sub || '')}">
    <!-- SIX NUMBERS FOR ONE SET OF PLUMBERS, inside three taps: the tile said
         11 nearby, this button said "Ask 10", the next screen said "ASKING 4",
         the header said "0 of 4 replied" and the pro's own dashboard said
         3 asked. Every one was arithmetically true -- they count the area, the
         first wave, the replies -- and presented as the same thing they read as
         the app not knowing its own business. Invitations go out in waves, so
         the button says the scale and the screen says the wave. -->
    ${esc(t('ask.askUpTo', { n: pool, trade: cat.name.toLowerCase() }))} →
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
export function startAsk(catId, partnerId, heldAmount, sub = null) {
  if (isGuest()) { toast('Sign in first'); ctx.go('auth'); return; }
  const p = getState().partners.find(x => x.id === partnerId);
  if (!p) return;
  /* THE JOB SHE PICKED WAS DROPPED HERE. `postRequest` takes a `sub` and this
     never passed one, so every ask went out as a bare category: the pros bid
     blind against the category band, the winning bid was priced off `cat.base`
     rather than the sub-job, and the bill printed "Plumbing · per item".

     An audit booked Ramesh directly for a blocked drain at ₹416, then asked the
     same nine pros ten minutes later and was quoted ₹551 by the same man for
     the same job — labelled "Best pick" and "₹28 less than held", in a feature
     sold as the way to save money. It called that the single biggest loss of
     trust in the app, and it was one argument. */
  const req = A.postRequest({
    catId, sub: sub || null, slotType: 'now',
    held: { partnerId: p.id, partnerName: p.name, amount: heldAmount },
  });
  if (!req) return;
  closeSheet();
  ctx.go('ask', req.id);
}

/* ── the screen ────────────────────────────────────────────── */
export function render(requestId) {
  const req = A.requestById(requestId);
  if (!req) { beat(false); return shell('Ask rates', '', `<div class="empty"><h3 style="font-size:17px">${esc(t('ask.requestGone'))}</h3>
    <p style="margin-top:6px">${esc(t('ask.mayHaveExpired'))}</p>
    <button class="btn btn--primary" style="margin-top:12px" data-act="nav.home">${esc(t('ask.backHome'))}</button></div>`); }

  A.closeIfDue(requestId);
  const live = A.requestById(requestId);
  if (live.status === 'bidding') { beat(true); return waiting(live); }
  beat(false);
  if (live.status === 'awaiting_choice') { beat(true); return choosing(live); }
  if (live.status === 'no_bids') return noBids(live);
  return shell('Ask rates', '', `<div class="sec"><b>${esc(t('ask.requestClosed'))}</b>
    <p class="tiny muted" style="margin-top:6px">${esc(t('ask.nothingCharged'))}</p>
    <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="nav.orders">${esc(t('ask.yourOrders'))}</button></div>`);
}

function shell(title, sub, body) {
  return `<header class="hdr">
      <div class="wrap inner">
        <button class="btn btn--ghost tap" data-act="nav.back" aria-label="Back" style="padding-inline:6px;color:inherit">${icon('back', { size: 20 })}</button>
        <div class="grow" style="min-width:0"><b style="font:800 15px/1.15 var(--font-heading);display:block">${esc(title)}</b>
          ${sub ? `<span style="display:block;font-size:12px;color:var(--ink-3)">${esc(sub)}</span>` : ''}</div>
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
  /* ONE PERSON, ONE PRICE. The held row is a price SAAHAA computed and printed
     under a pro's name; the bid list is what pros actually wrote. When the same
     pro is in both, he appeared twice at two figures, directly beneath the
     words "Price locked before you book". His own quote wins, and he keeps one
     row -- still bookable, because it is still her locked match. */
  const ownBid = req.held ? bids.find(b => b.partnerId === req.held.partnerId) : null;
  if (heldShown && req.held) cards.push(replyRow(req, {
    partnerId: req.held.partnerId, partnerName: req.held.partnerName,
    amount: ownBid ? Math.min(ownBid.amount | 0, req.held.amount | 0) : req.held.amount,
    /* AND THE CARD CARRIED NO BID ID, so the rule below it — accept the price
       on the card, not the one she was holding before he bid — could never
       fire. The button kept booking the held price under his lower number, and
       once the window closed that booking failed outright: a pro watched a
       customer accept his quote and no order existed afterwards, with nothing
       anywhere telling either of them. The row is his bid, so it carries it. */
    id: ownBid ? ownBid.id : null,
    held: true, held0: ownBid ? held : 0,
  }));
  bids.forEach(b => { if (ownBid && b.id === ownBid.id) return;
    cards.push(replyRow(req, { ...b, held: false, held0: held })); });

  return shell(`${cat.name}${req.sub ? ' · ' + req.sub : ''}`, `Sent ${timeAgo(req.openedAt)} · ${replies} of ${invited} replied`, `
    ${honest(held, req.held && req.held.partnerId)}

    <div class="sec">
      <div class="between">
        <div><p class="m-cap" style="margin:0 0 2px">${esc(t('ask.heldPrice'))}</p>
          <div class="num" style="font:800 27px/1 var(--font-heading)">${M.fmt(payP(held || req.target, req.held && req.held.partnerId))}</div></div>
        <span class="tag tag-neutral">${esc(t('ask.safeNothingYet'))}</span>
      </div>
      <p class="tiny muted" style="margin-top:6px">${req.held ? `${esc(req.held.partnerName)} comes as planned unless you pick someone else.` : 'Nothing is charged until you pick.'}</p>
    </div>

    <div class="sec">
      <p class="m-cap">${esc(t('ask.askingWave', { n: invited, pool }))}</p>
      <div class="row" style="gap:4px;margin:6px 0 14px">${dots}</div>
      <!-- AND HIDING THE WALL DID NOT REMOVE THE WALL. This counted up and put
           "usually done by 4:00" on the screen -- the 12-minute window divided
           by three, printed as if it were the deadline -- on the reasoning that
           a 12:00 countdown drives people out. An audit waited past 4:00 to
           5:06, saw the same sealed rates and "3 more workers are still
           preparing rates", and concluded the auction had hung. It had not. It
           had eight minutes left and had told her four.

           The true story is kinder than the fiction anyway: she can book her
           held price at any second, and it is only the SEALED rates that wait.
           So the screen says when they open, and stops pretending that is a
           deadline she is trapped behind. -->
      <div class="bar" style="position:relative"><i style="width:${Math.min(100, (elapsed / total) * 100).toFixed(1)}%"></i>
        <i style="position:absolute;left:33%;top:-4px;width:2px;height:14px;background:var(--color-text);opacity:.5"></i></div>
      <div class="between" style="margin-top:6px">
        <span class="micro muted">${mmss(elapsed)} elapsed</span>
        <span class="micro muted">${replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : `most people get 3 rates in about ${Math.round(total / 3 / 60000)} minutes`} · sealed rates open at ${mmss(total)}</span>
      </div>
    </div>

    ${cards.length ? `<div class="sec" style="padding-top:0">${cards.join('')}</div>` : ''}

    <p class="tiny muted" style="padding:12px 0;border-top:2px solid var(--color-divider)">
      ${Math.max(0, invited - replies)} more workers are still preparing rates. Nothing expires while you wait —
      if you don't pick, your ${M.fmt(payP(held || req.target, req.held && req.held.partnerId))} booking stays. Nothing is lost.</p>

    <!-- This used to say "We'll message you." SAAHAA does not message anybody —
         there is no SMS rail and there is not going to be one. What is true is
         that nothing here is lost by leaving, which is the reassurance the
         person actually wanted. -->
    ${elapsed > 30000 ? `<button class="btn btn--ghost btn--block" style="justify-content:flex-start"
        data-act="ask.background" data-id="${req.id}">${esc(t('ask.leaveOpen'))}</button>` : ''}

    ${bottomBar(req)}`);
}

/* one reply: name, stars · km · standing, the price you would pay, and what
   you can do with it. In the waiting state only the held reply is bookable
   (the others are sealed until the window closes). */
function replyRow(req, b) {
  /* "₹457 LESS THAN HELD" WHERE THE TWO NUMBERS ON SCREEN DIFFER BY ₹441.
     `less` was a difference of DEALS, and `gapP` then multiplied it by the
     RIVAL's markup -- while the held price beside it had been priced at the
     HERO's. A tier-4 pro pays 6% and a tier-2 pro 8%, so the saving was
     overstated by ₹16, and two rivals quoting the IDENTICAL ₹403 were credited
     with ₹434 and ₹450 of saving side by side.

     This is the screen where she chooses who comes into her house.

     Same rule as the receipt and the shop's column: a number describing the
     relationship between two figures on a screen is derived from THOSE FIGURES,
     as displayed, and never recomputed from the sources behind them. */
  const saving = savingVs(req, b);
  const p = getState().partners.find(x => x.id === b.partnerId) || {};
  return `<div style="padding:12px 0;border-bottom:1px solid var(--color-divider)">
    <div class="between" style="align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <div style="font:800 15px/1.2 var(--font-heading)">${esc(b.partnerName)}</div>
        <div style="font-size:12px;color:var(--ink-3);margin-top:3px">${starsFor(b.partnerId)}${b.km != null ? ` · ${b.km} km` : p.area ? ` · ${esc(p.area)}` : ''}${b.eta ? ` · ~${b.eta} min` : ''}${b.held ? ' · your first match' : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font:800 21px/1 var(--font-heading)" class="num">${M.fmt(payP(b.amount, b.partnerId))}</div>
        <div style="font-size:12px;color:var(--ink-3);margin-top:3px">${saving ? `${M.fmt(saving)} less than held` : `incl. SAAHAA ${pctP(b.partnerId)}%`}</div>
      </div>
    </div>
    ${b.held ? `<div class="row" style="gap:8px;margin-top:10px">
      <!-- THE CARD SHOWED ₹384 AND THE BUTTON CHARGED ₹837. This is the held
           pro's own card, and when he has since bid LOWER it prints that better
           price — while the accept-my-held action books the price she was
           holding before he bid. Two numbers a thumb's width apart, ₹453 apart, during the
           sealed phase the app tells her to wait through. She accepts the price
           she is looking at; if that is his new bid, it is his new bid. -->
      ${(b.id && (b.amount | 0) < (b.held0 | 0))
        ? `<button class="btn btn--primary" style="flex:1;justify-content:flex-start"
             data-act="ask.accept" data-id="${req.id}" data-bid="${esc(b.id)}">${esc(t('ask.acceptThis', { amount: M.fmt(payP(b.amount, b.partnerId)) }))}</button>`
        : `<button class="btn btn--primary" style="flex:1;justify-content:flex-start" data-act="ask.held" data-id="${req.id}">${esc(t('ask.acceptYours'))}</button>`}
    </div>` : `<p class="micro muted" style="margin-top:8px">Sealed until ${mmss(req.closesAt - req.openedAt)} — then you pick. Your held price is bookable now.</p>`}
  </div>`;
}

/* Both escapes are one tap and neither asks "are you sure". */
function bottomBar(req) {
  const held = req.held ? req.held.amount : null;
  return `<div class="m-bar" style="gap:8px">
    ${held ? `<button class="btn btn--primary grow" style="justify-content:flex-start" data-act="ask.held" data-id="${req.id}">
      Book ${M.fmt(payP(held, req.held && req.held.partnerId))} now</button>` : ''}
    <button class="btn btn--secondary" data-act="ask.cancel" data-id="${req.id}">${esc(t('ask.cancel'))}</button>
  </div>
  <p class="micro muted" style="margin-top:6px">${esc(t('ask.cancelFree'))}</p>`;
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
    ${honest(held, req.held && req.held.partnerId)}
    <div class="sec">${cards.join('')}</div>
    ${held ? `<div style="padding:12px 0;border-top:2px solid var(--color-divider)">
      <div class="between" style="gap:10px">
        <div class="row">${avatar(req.held.partnerName, 34, true)}
          <div class="grow"><b class="tiny">${esc(req.held.partnerName)}</b>
            <p class="micro muted">${esc(t('ask.heldFirstMatch'))}</p></div></div>
        <button class="btn btn--secondary btn--sm" data-act="ask.held" data-id="${req.id}">Book ${M.fmt(payP(held, req.held && req.held.partnerId))}</button>
      </div></div>` : ''}
    <p class="micro muted" style="margin-top:12px">Whoever you pick, you pay SAAHAA and the money is held until you confirm the work — or until the wait on that job runs out.</p>`);
}

function heroReply(req, b, held, showCounter) {
  const saving = savingVs(req, b);
  const c = showCounter ? A.counterFor(req.id, b.id) : { available: false };
  const pending = b.status === 'countered';
  return `<div class="bestmatch" style="margin-bottom:12px">
    <span class="tag tag-accent" style="align-self:flex-start">${esc(t('ask.bestPick'))}</span>
    <div class="between" style="align-items:flex-start;gap:10px">
      <div class="row" style="min-width:0">
        ${avatar(b.partnerName, 44)}
        <div class="grow" style="min-width:0"><b style="font-size:16px">${esc(b.partnerName)}</b>
          <p class="tiny" style="opacity:.8">${avgOf(b.partnerId) == null ? '' : ratingStars(avgOf(b.partnerId)) + ' · '}${starsFor(b.partnerId)} · ${b.km} km · ${esc((b.band && b.band.label) || 'Verified')}</p></div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="num" style="font:800 24px/1 var(--font-heading)">${M.fmt(payP(b.amount, b.partnerId))}</div>
        <div class="micro" style="opacity:.75;margin-top:3px">${saving ? `${M.fmt(saving)} less than held` : 'fair price'}</div>
      </div>
    </div>
    <p class="tiny" style="opacity:.85">${esc(whyLine(b, A.bidsFor(req.id)))}</p>
    <div class="row" style="gap:8px">
      <button class="btn btn--primary" style="flex:1;justify-content:flex-start" data-act="ask.accept"
              data-id="${req.id}" data-bid="${b.id}">Accept · ${M.fmt(payP(b.amount, b.partnerId))}</button>
      ${pending ? '' : c.available ? `<button class="btn btn--secondary" style="color:inherit;border-color:currentColor"
        data-act="ask.counter" data-id="${req.id}" data-bid="${b.id}">Ask ${M.fmt(payP(c.amount, b.partnerId))}?</button>` : ''}
    </div>
    ${pending ? `<p class="micro" style="opacity:.75">Asked. If he says no, ${M.fmt(payP(b.amount, b.partnerId))} is still yours.</p>` : ''}
  </div>`;
}

function otherReply(req, b, hero, cheapest, held) {
  const isCheapest = cheapest && b.id === cheapest.id && cheapest.id !== hero.id;
  const gap = isCheapest ? hero.amount - b.amount : 0;
  return `<div style="padding:12px 0;border-bottom:1px solid var(--color-divider)">
    <div class="between" style="align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <div style="font:800 15px/1.2 var(--font-heading)">${esc(b.partnerName)}</div>
        <div style="font-size:12px;color:var(--ink-3);margin-top:3px">${starsFor(b.partnerId)} · ${b.km} km · ~${b.eta} min${isCheapest ? ' · lowest price' : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="num" style="font:800 21px/1 var(--font-heading)">${M.fmt(payP(b.amount, b.partnerId))}</div>
        <div style="font-size:12px;color:var(--ink-3);margin-top:3px">incl. SAAHAA ${pctP(b.partnerId)}%</div>
      </div>
    </div>
    ${isCheapest && gap > 0 ? `<p style="font-size:12.5px;margin:9px 0 0;line-height:1.5">
      ${M.fmt(gapP(gap, b.partnerId))} cheaper, but ${esc(tradeoff(b, hero))}.</p>` : ''}
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn--secondary" style="flex:1;justify-content:flex-start"
              data-act="ask.accept" data-id="${req.id}" data-bid="${b.id}"
              data-warn="${lowRated(b, hero) ? '1' : ''}">Accept · ${M.fmt(payP(b.amount, b.partnerId))}</button>
    </div>
  </div>`;
}

/* Exactly two reasons, in fixed plain phrasings. Never a percentage, never a
   "score", never the word algorithm. */
/* "MOST TRUSTED" WAS AN ABSOLUTE THRESHOLD, NOT A COMPARISON. Any bid scoring
   over 0.7 on trust was captioned "most trusted" -- so the app recommended a pro
   who was dearer, further and slower than the one beside him, on the claim that
   he was the most trusted of the two, while both showed Trust 92. Same for
   "best rating" at 0.75. An audit checked it and it was simply not true.

   `domain/bidding.js` has always had the right shape for this: a superlative is
   earned by beating everyone else on that dimension, not by clearing a bar. A
   claim that cannot be checked against the card below it should not be made --
   so where he is merely good rather than best, it says so. */
function whyLine(b, all = []) {
  const rivals = all.filter(x => x && x.id !== b.id && x.parts);
  const best = k => rivals.every(x => (x.parts[k] || 0) <= (b.parts[k] || 0));
  /* AND I TURNED A SCORE INTO A CLAIM ABOUT RUPEES. Fixing "most trusted" last
     pass, I gave the price line the same treatment -- but `parts.price` is
     `priceScore(amount, band)`, which rewards sitting near the band's fair
     target and PENALISES a suspiciously low bid. So the best price SCORE is not
     the lowest price, and the hero card read "cheapest here" at ₹392 while the
     same screen tagged another pro "lowest price" at ₹341. An audit called it
     the worst thing in the product and marked the round down for it.
     Cheapest is a fact about money. It is decided on the money. */
  /* AND I COMPARED THE WRONG NUMBER AGAIN. `amount` is the pro's own deal; what
     she sees, and what "cheapest" is a claim about, is that deal plus THAT
     pro's markup — 6% for a tier-4, 8% for everyone else. So a higher deal can
     be the cheaper price and the card said "cheapest here" on a ₹1,216 bid
     sitting above a ₹1,017 one.
     THE RULE, third time of asking: a claim about a number on the screen is
     decided on the number on the screen. Not the score behind it, not the deal
     behind that. */
  const shownPrice = x => payP(x.amount, x.partnerId);
  const cheapest = rivals.every(x => shownPrice(x) >= shownPrice(b));
  const bits = [];
  if (cheapest) bits.push('cheapest here');
  else if (b.parts.price > 0.9) bits.push('fair price');
  if (b.parts.rating > 0.75) bits.push(best('rating') ? 'best rated' : 'well rated');
  if (b.parts.distance > 0.6) bits.push(`${b.eta} min away`);
  if (b.parts.trust > 0.7) bits.push(best('trust') ? 'most trusted' : 'trusted');
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
  return shell('Rates are in', held ? `Your ${M.fmt(payP(held, req.held && req.held.partnerId))} was the best rate` : 'No replies', `
    <div class="sec">
      <p class="card-kicker">${esc(t('ask.confirmed'))}</p>
      <h2 class="h-sec" style="margin:4px 0 6px">${esc(t('ask.noneBeat'))}</h2>
      <p class="tiny muted">${held ? `Your ${M.fmt(payP(held, req.held.partnerId))} with ${esc(req.held.partnerName)} is still ready. ` : ''}${esc(t('ask.nothingCharged'))}</p>
      ${held ? `<button class="btn btn--primary btn--lg btn--block" style="margin-top:18px;justify-content:flex-start"
        data-act="ask.held" data-id="${req.id}">Book ${M.fmt(payP(held, req.held.partnerId))}</button>` : ''}
      <button class="btn btn--ghost btn--block" style="margin-top:8px"
        data-act="ask.cancel" data-id="${req.id}">${esc(t('ask.cancel'))}</button>
    </div>`);
}

/* ── the receipt: the whole teaching path in three lines ───────
   The one number that drives repeat use is the rupees THEY saved on THEIR
   last job. */
export function showReceipt(req, paid, workerName) {
  const s = A.savings(req, paid);
  /* app.js hands us the name, not the id — so find the bid this receipt is for
     and quote it at THAT worker's markup, the one the order was just escrowed
     at. Falls back to the held match, then to the general rate. */
  const booked = (A.bidsFor(req.id) || []).find(b => b.partnerName === workerName && b.amount === paid)
    || (req.held && req.held.partnerName === workerName ? req.held : null);
  const bid = booked ? booked.partnerId : null;
  const zero = s.amount <= 0;
  sheet('', `<div style="padding:4px 0">
    <p class="m-cap">You asked ${Math.max(1, s.replies)} ${Math.max(1, s.replies) === 1 ? 'worker' : 'workers'}</p>
    <div class="m-kv"><span>${esc(t('ask.youPay'))}</span><span class="num" style="font-size:22px">${M.fmt(payP(paid, bid))}</span></div>
    ${zero
      // A zero shown AS zero kills the second use permanently. It is not a
      // loss — it is a confirmed good price, and it must read as one.
      ? `<p class="m-note" style="margin-top:10px">${esc(t('ask.heldWasBest'))}</p>`
      : `<div class="m-kv m-kv--total"><span>${esc(t('ask.youSaved'))}</span><span class="num" style="color:var(--color-accent-text)">${
          /* A SAVING IS NOT A PRICE AND MUST NOT CARRY A FEE. `gapP` multiplies
             what it is given by the worker's markup, which is right for a quote
             and wrong for a difference: it inflated the saving by 8% and gave a
             third figure for one job — the auction row said ₹418, this said
             ₹434 and the bill said ₹197. What she saved is the difference
             between the two prices she was shown. */
          M.fmt(Math.max(0, rupeesOf(payP(req.held ? req.held.amount : paid, req.held && req.held.partnerId))
                            - rupeesOf(payP(paid, bid))))}</span></div>`}
    <p class="tiny muted" style="margin-top:14px">${esc(workerName)} is booked. SAAHAA holds ${M.fmt(payP(paid, bid))} until you confirm the work, or until the wait shown on the job runs out.</p>
    <button class="btn btn--primary btn--lg btn--block" style="margin-top:20px;justify-content:flex-start" data-act="sheet.close">${esc(t('ask.done'))}</button>
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
  /* his own shelf price for this job — the ceiling the band may not lower */
  const ownPrice = Math.round((partner.ask | 0) * ((subSize(req.catId, req.sub) || {}).x || 1));
  /* AND IT OFFERED HIM A PRICE THE ENGINE WOULD REFUSE. His own listed rate can
     sit above the band -- that is the point of the line above -- but it cannot
     sit above the cap on how much a new pro may take, and the slider went on
     letting him drag there and reject him after Send. A control does not offer
     what it will not accept. */
  const bidMax = Math.min(effectiveCap(partner) || Infinity, Math.max(req.ceiling | 0, ownPrice));
  const cat = get('category', req.catId);
  sheet(cat.name, `
    <p class="tiny muted">${esc(req.area)} · ${esc(req.sub || cat.name)} · asked ${Math.round((Date.now() - req.openedAt) / 60000)} min ago</p>

    <div class="m-sec" style="border-top:2px solid var(--color-divider);margin-top:12px">
      <div class="m-kv"><span class="m-cap" style="margin:0">${esc(t('ask.fairPrice'))}</span>
        <b class="num" style="font-size:22px">${M.fmt(req.target)}</b></div>
      <!-- THE PASSBOOK IS TRANSLATED AND THE PRICING SCREEN IS NOT. A Telugu
             plumber could read what he had been paid but not the sheet where he
             decides what to ask for. This is that sheet. -->
        <p class="micro muted" style="margin-top:6px">${esc(t('ask.mostJobsGo', { low: M.fmt(req.floor), high: M.fmt(req.ceiling) }))}</p>
      <p class="micro muted" style="margin-top:4px">${req.bidCount} workers asked so far.</p>
    </div>

    <div class="on-plum" style="padding:14px;margin-top:12px">
      <div class="between" style="margin-bottom:10px">
        <span class="m-cap" style="margin:0;color:color-mix(in srgb,var(--color-bg) 70%,transparent)">${esc(t('ask.yourRate'))}</span>
        <b class="num" id="bidAmt" style="font-size:24px">${M.fmt(req.target)}</b>
      </div>
      <!-- THE APP WOULD NOT LET HIM ASK HIS OWN PRICE. The band is built from
           the CATEGORY base, so for a job whose category prices at 520 the
           ceiling sat at 450 -- while a plumber listing 900 sells that same job
           for 630 on the page customers already see. He was capped 180 under
           his own storefront by a screen that had just told him his rate is his.
           The band guides; it does not overrule what he publicly advertises. -->
      <input type="range" id="bidRange" min="${req.floor / 100}" max="${bidMax / 100}"
             step="10" value="${req.target / 100}" style="width:100%;accent-color:var(--color-accent)"
             data-target="${req.target}" data-beff="${req.beff}">
      <div class="between"><span class="micro" style="opacity:.7">${M.fmt(req.floor)}</span>
        <span class="micro" style="color:var(--color-accent-400);font-weight:700">▲ ${esc(t('ask.bestChance'))}</span>
        <!-- THE LABEL AT THE END OF THE BAR MUST BE THE END OF THE BAR. The
             track was widened to reach his own listed rate and narrowed to his
             cap, and this went on printing the band ceiling — ₹1,400 drawn at
             the end of a track that runs to ₹1,500. -->
        <span class="micro" style="opacity:.7">${M.fmt(bidMax)}</span></div>
      <div style="margin-top:14px">
        <div class="between"><span class="tiny" style="opacity:.8">${esc(t('ask.yourChance'))}</span>
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
        <span>${esc(t('ask.yourPrice'))}</span><b class="num" id="bidKeep">${M.fmt(req.target)}</b></div>
      <div class="between" style="font-size:12.5px;margin-top:4px">
        <span class="muted">${esc(t('ask.youKeep'))}</span><span class="muted">${esc(t('ask.keepAll'))}</span></div>
      <div class="between" style="font-size:12.5px;margin-top:2px">
        <span class="muted">${esc(t('ask.ourCutPaidByHer', { pct: pctP(partner.id) }))}</span>
        <span class="muted" id="bidFee">${M.fmt(gapP(req.target, partner.id) - req.target)}</span></div>
      <div class="between" style="font:800 14px/1.2 var(--font-heading);padding-top:8px;margin-top:8px;border-top:1px solid var(--color-divider)">
        <span>${esc(t('ask.customerPays'))}</span><span id="bidPays">${M.fmt(gapP(req.target, partner.id))}</span></div>
    </div>

    <button class="btn btn--primary btn--lg btn--block" style="margin-top:14px;justify-content:flex-start"
            id="sendBid" data-act="bid.send" data-id="${requestId}" data-pid="${partner.id}"
            data-amt="${req.target}">${esc(t('ask.sendAmount', { amount: M.fmt(req.target) }))}</button>
    <button class="btn btn--ghost btn--block" style="margin-top:6px" data-act="sheet.close">${esc(t('ask.notInterested'))}</button>
    ${SYS_CSS}`);
  wireSlider(req, partner);
}

function wireSlider(req, partner) {
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
    lbl.textContent = t(pc > 75 ? 'ask.chanceStrong' : pc > 45 ? 'ask.chanceFair' : 'ask.chanceWeak');
    btn.dataset.amt = String(paise);
    btn.textContent = t('ask.sendAmount', { amount: M.fmt(paise) });
    /* the money truth moves with the slider: he keeps all of it, the customer
       pays our percentage on top (domain/settings.js owns the number) */
    const keep = document.getElementById('bidKeep');
    if (keep) {
      keep.textContent = M.fmt(paise);
      const pid = partner && partner.id;
      document.getElementById('bidFee').textContent = M.fmt(gapP(paise, pid) - paise);
      document.getElementById('bidPays').textContent = M.fmt(gapP(paise, pid));
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
