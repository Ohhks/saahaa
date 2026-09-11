/* SAAHAA · domain/auction.js — the P2P ask-and-bid use-cases.

   THE SHAPE OF THE THING. A customer posts what they need. Pros nearby are
   invited in waves and each sends ONE sealed price. Nobody sees anybody else's
   number while the window is open. When it closes, the customer gets a
   recommendation and can take it, take someone else, or make one counter-offer.

   WHY SEALED. An open descending auction is the fastest way to destroy the
   product's whole promise — pros would compete the "you keep 100%" advantage
   straight into the customer's pocket and end up earning less than they would
   on a commission app. Sealed bids plus a PUBLISHED FAIR PRICE means a pro
   quotes against the band, not against a rival.

   WHY THE PRICE SCORE PEAKS AT FAIR VALUE. A floor alone just becomes the new
   market price. Because scoring is highest AT the fair price, undercutting
   costs points and wins nothing — which is what actually stops the race to the
   bottom. See domain/bidding.js. */

import { getState, dispatch, me, myArea } from '../core/ctx.js';
import * as flags from '../core/flags.js';
import { nid } from '../core/id.js';
import { find } from '../core/registry.js';
import * as audit from '../core/audit.js';
import { toast } from '../ui/dom.js';
import { bookService } from './flow.js';
import { rankPartners, kmBetween } from './match.js';
import { subSize } from './catalog.services.js';
import * as M from '../core/money.js';
import { blocker, categoryAllowed } from './verification.js';
import { capOk, effectiveCap } from './trust.js';
import {
  priceBand, validateBid, biddingAllowed, rankBids, counterOffer,
  auctionState, loserFeedback, WINDOW, MAX_BIDS, WAVE_SIZE, MAX_INVITES,
  HOLD_MS, waveRadiusKm,
} from './bidding.js';

/* ── reads ─────────────────────────────────────────────────── */
export const requestById = id => getState().requests.find(r => r.id === id) || null;
export const bidsFor = id => getState().bids.filter(b => b.requestId === id);
export function myRequests() {
  const s = me(); if (!s) return [];
  return getState().requests.filter(r => r.customerKey === s.key);
}
/* WHAT HE HAS QUOTED ON AND IS STILL WAITING TO HEAR ABOUT. The lead list
   below deliberately drops a request the moment he bids on it -- correctly, it
   is a list of work he has NOT answered -- and nothing anywhere picked it up.
   So a pro sent a rate and it vanished: Leads 0, Jobs 0, no "awaiting reply"
   on any screen. He had no way to tell whether he had bid at all, and when a
   customer accepted and the booking failed he could not even tell it had
   happened. A quote is a commitment; it stays visible until it resolves. */
export function sentQuotesFor(partner) {
  if (!partner) return [];
  const st = getState();
  return st.bids
    .filter(b => b.partnerId === partner.id && b.status === 'submitted')
    .map(b => ({ bid: b, req: st.requests.find(r => r.id === b.requestId) }))
    .filter(x => x.req && !x.req.awardedBidId)
    .sort((a, b) => b.bid.submittedAt - a.bid.submittedAt);
}

export function openRequestsForPartner(partner) {
  if (!partner) return [];
  const now = Date.now();
  if (blocker(partner)) return [];
  return getState().requests.filter(r =>
    r.status === 'bidding' && r.closesAt > now &&
    r.catId === partner.cat && capOk(partner, r.target) &&
    !getState().bids.some(b => b.requestId === r.id && b.partnerId === partner.id));
}
export const myBid = (requestId, partnerId) =>
  getState().bids.find(b => b.requestId === requestId && b.partnerId === partnerId) || null;

/** How many pros could actually bid — the number that decides whether an
    auction is worth running at all. Fewer than six and it is theatre. */
export function poolSize(catId, area) {
  return rankPartners(getState().partners, { catId, area: area || myArea() }).length;
}

/* ── the entry gate ────────────────────────────────────────────
   The DOMAIN floor is 6 pros (below that an auction is theatre). The UI floor
   is 8, because 6 invitations at a ~45% reply rate is a two-reply screen that
   looks broken — and a feature that looks broken on first exposure is dead for
   that customer forever. Correctness gate and product gate are different
   numbers on purpose. */
export const UI_MIN_POOL = 8;
const NIGHT = h => h < 6 || h >= 21;

/**
 * Should the "Ask rates" row appear under this locked-match card?
 * Suppressed SILENTLY when there is nothing to win — twelve minutes spent to
 * save nothing is a pure loss, and offering it teaches the customer the
 * feature is noise.
 */
export function askOffer(catId, heldAmount, opts = {}) {
  const no = why => ({ show: false, why });
  if (!flags.isOn('ASK_RATES')) return no('off');
  const gate = canAuction(catId, opts);
  if (!gate.allowed) return no(gate.why);
  const band = priceBand(catId, { complexity: opts.complexity || 'simple', sub: opts.sub || null });
  if (!band || band.quoteOnly) return no('This job is quoted, not rated.');
  if (poolSize(catId) < UI_MIN_POOL) return no('Not enough workers nearby right now.');
  /* Nobody waits twelve minutes at 10pm for a leaking tap — a real rule, and
     it stays a real rule. It rides a flag only so the prototype can be shown
     at any hour; in production ASK_NIGHT_GUARD is on. */
  if (flags.isOn('ASK_NIGHT_GUARD') && NIGHT(new Date().getHours()))
    return no('Rates are asked between 6am and 9pm.');
  if (myRequests().some(r => ['bidding', 'awaiting_choice'].includes(r.status)))
    return no('You already have one going.');
  /* Compare the held price against what the ask would ACTUALLY produce, not
     against the fair price. The locked match is already chosen partly on
     price, so it usually quotes at or below fair — measuring the gap from
     `target` therefore suppressed the feature on almost every real job, which
     is not a tuning problem but the wrong question. The right question is
     "would asking beat what you already have?", and the answer is the
     expected best of five bids. */
  const gap = heldAmount - expectedBest(band);
  if (!(gap >= 2500 && heldAmount >= expectedBest(band) * 1.03))
    return no('Your price is already the best rate here.');
  return { show: true, band, est: roundEst(gap), mins: Math.round(WINDOW.now / 60000) };
}
/* Bids cluster in a narrow band around the fair price, so the best of five
   draws lands a little under it. 0.955 is that empirical centre — see the
   spread in seed.depth.js and the simulated supply in scheduleSimulatedBids. */
export const expectedBest = band => Math.round(band.target * 0.955);
const roundEst = paise => Math.max(2500, Math.round(paise / 2500) * 2500);

/* ── post a request ────────────────────────────────────────── */
export function canAuction(catId, opts = {}) {
  const band = priceBand(catId);
  return biddingAllowed(catId, { ...opts, poolSize: poolSize(catId), band });
}

export function postRequest({ catId, sub, note, complexity = 'simple', budgetBand = 'standard', slotType = 'now', held = null }) {
  const s = me();
  if (!s) throw new Error('Please sign in first');
  const gate = canAuction(catId);
  if (!gate.allowed) { toast(gate.why, 'warn'); return null; }

  /* the same job the booking sheet priced, or the two disagree */
  const band = priceBand(catId, { complexity, sub: sub || null });
  const cat = find('category', catId);
  const now = Date.now();
  const req = {
    id: nid('req'), customerKey: s.key, customerName: s.name, area: s.area,
    catId, sub: sub || null, note: note || '', complexity, budgetBand, slotType,
    /* the band is SNAPSHOTTED here. Editing a category's base price later must
       never retroactively invalidate a bid someone already placed. */
    beff: band.beff, floor: band.floor, target: band.target, ceiling: band.ceiling,
    status: 'bidding', bidCount: 0, counterUsed: false,
    openedAt: now, closesAt: now + (WINDOW[slotType] || WINDOW.now), holdUntil: null,
    invited: WAVE_SIZE, awardedBidId: null,
    /* The held price is the ENTIRE conversion mechanism. The customer's
       locked match stays reserved for the whole window, so asking cannot
       lose them anything — and because it cannot, they will try it once. */
    held: held ? { ...held } : null,
  };
  dispatch({ type: 'request/add', payload: req });
  audit.record('request.posted', { id: req.id, catId, target: band.target }, s.key);
  if (flags.isOn('SIM_MARKET')) scheduleSimulatedBids(req);   // demos only; real pros bid from their phones
  return req;
}

/* ── the demo's supply side ────────────────────────────────────
   In production a real pro taps "Bid" on their phone. Here we let ranked
   local pros answer in waves so the flow can be seen end to end. Their bids
   cluster near the FAIR price, not the floor, because that is what the
   scoring actually rewards — the simulation must not teach a lesson the
   mechanism contradicts. */
const SIM_MAX_BIDS = MAX_BIDS - 2;      // three of five; two stay open for real pros
const timers = new Map();
function scheduleSimulatedBids(req) {
  const pool = rankPartners(getState().partners, { catId: req.catId, area: req.area }).slice(0, MAX_INVITES);
  if (!pool.length) return;
  const ids = [];
  pool.forEach((p, i) => {
    /* Replies must start landing while the customer is still looking. The
       first at ~2.5s, the rest inside ~20s: slow enough to feel like people
       answering, fast enough that the screen never looks dead. */
    const delay = 2500 + i * (1800 + Math.random() * 2600);
    if (delay > (req.closesAt - req.openedAt)) return;
    ids.push(setTimeout(() => {
      const live = requestById(req.id);
      if (!live || live.status !== 'bidding') return;
      /* Leave room for a REAL worker. Simulated supply filling all five slots
         early-closed the window within ~20 seconds, so a partner signing in to
         bid always found the job already gone — the entire worker-side flow
         was unreachable in practice. */
      if (bidsFor(req.id).length >= SIM_MAX_BIDS) return;
      const spread = 0.94 + Math.random() * 0.10;          // clustered around target
      /* and never above what this pro charges for the job on his own page */
      const own = Math.round((p.ask | 0) * ((subSize(req.catId, req.sub) || {}).x || 1));
      const amount = Math.min(own || Infinity,
        Math.max(Math.min(req.floor, own || req.floor), Math.min(req.ceiling, Math.round(req.target * spread))));
      placeBid({ requestId: req.id, partner: p, amount, quiet: true });
    }, delay));
  });
  timers.set(req.id, ids);
}
function clearTimers(id) { (timers.get(id) || []).forEach(clearTimeout); timers.delete(id); }

/* ── place a bid ───────────────────────────────────────────── */
export function placeBid({ requestId, partner, amount, note, quiet }) {
  const req = requestById(requestId);
  if (!req) return null;
  if (req.status !== 'bidding' || Date.now() > req.closesAt) {
    if (!quiet) toast('Bidding on this job has closed', 'warn');
    return null;
  }
  /* The self-bid guard must compare the BIDDER to the customer, not the
     current session to the customer. Comparing to me() meant every simulated
     bid on your own request tripped it — the customer sat on a waiting screen
     being told they could not bid on their own job, and no rate ever landed. */
  if (partner.userKey && partner.userKey === req.customerKey) {
    if (!quiet) toast('You cannot bid on your own request', 'danger');
    return null;
  }
  // the gate holds here too: a tier-0 partner who reaches this function by
  // any path is refused, with the reason
  const why = blocker(partner);
  if (why) { if (!quiet) toast(why, 'warn'); return null; }
  // the auction was a complete bypass of minTier and of the tier cap
  if (!categoryAllowed(partner, req.catId)) { if (!quiet) toast('Your tier does not cover this job yet', 'warn'); return null; }
  /* AND IT SAID SO ONLY AFTER HE PRESSED SEND, with no figure and the word
     "tier", which no plumber has ever seen. The customer's list was meanwhile
     advertising him at a price the platform would refuse. He is told the
     number, in rupees, in the words he was recruited in. */
  if (!capOk(partner, amount)) {
    if (!quiet) toast(`Your first jobs are capped at ${M.fmt(effectiveCap(partner))} for now — finish three with no complaint and it lifts by itself.`, 'warn');
    return null;
  }
  if (myBid(requestId, partner.id)) {
    if (!quiet) toast('You have already bid on this job — one bid each', 'warn');
    return null;
  }
  /* NOBODY MAY BID ABOVE THEIR OWN SHELF PRICE. The band is built from the
     CATEGORY base, so its floor sat at ₹430 for a job that a pro asking ₹428
     charges ₹385 for on his own booking sheet. He could not bid his own price
     if he wanted to -- the auction forced him above it, and the customer who
     used "ask several pros" paid ₹74 MORE than tapping Confirm twelve minutes
     earlier, under a sheet reading "You saved ₹89".

     A marketplace may help a worker charge less. It must never quietly help him
     charge more than he publicly advertises for the same work. His own listed
     price is the ceiling on his own bid; the band's floor cannot push him past
     it either. */
  const ownPrice = Math.round((partner.ask | 0) * ((subSize(req.catId, req.sub) || {}).x || 1));
  if (ownPrice > 0 && amount > ownPrice) {
    if (!quiet) toast(`Your own price for this job is ${M.fmt(ownPrice)} — a rate here cannot be above it.`, 'warn');
    return null;
  }
  /* the band may not price him out of his own storefront in either direction:
     it cannot force him above his listed rate, and it cannot cap him below it */
  const band = { beff: req.beff, floor: Math.min(req.floor, ownPrice || req.floor),
                 target: req.target,
                 ceiling: Math.max(req.ceiling, ownPrice || 0), quoteOnly: false };
  const v = validateBid(amount, band);
  if (!v.ok) { if (!quiet) toast(v.reason, 'danger'); return null; }

  const bid = {
    id: nid('bid'), requestId, partnerId: partner.id, partnerName: partner.name,
    amount, note: note || null, status: 'submitted',
    afterSeconds: Math.max(0, Math.round((Date.now() - req.openedAt) / 1000)),
    km: kmBetween(req.area, partner.area),
    submittedAt: Date.now(), expiresAt: req.closesAt + HOLD_MS,
  };
  dispatch({ type: 'bid/add', payload: bid });

  const count = bidsFor(requestId).length;
  const patch = { bidCount: count };
  // early close: once enough pros have answered there is nothing to wait for
  if (count >= MAX_BIDS) { patch.status = 'awaiting_choice'; patch.holdUntil = Date.now() + HOLD_MS; clearTimers(requestId); }
  dispatch({ type: 'request/patch', payload: { id: requestId, patch } });

  if (!quiet) toast(`Your price of ${amount / 100} is in. You will know shortly.`);
  return bid;
}

/* ── close, accept, counter ────────────────────────────────── */
export function closeIfDue(requestId) {
  const req = requestById(requestId);
  if (!req) return null;
  const st = auctionState({ ...req, bids: bidsFor(requestId) });
  if (req.status === 'bidding' && st.phase !== 'bidding') {
    clearTimers(requestId);
    const patch = bidsFor(requestId).length
      ? { status: 'awaiting_choice', holdUntil: Date.now() + HOLD_MS }
      : { status: 'no_bids' };
    dispatch({ type: 'request/patch', payload: { id: requestId, patch } });
  }
  /* A request left in awaiting_choice used to sit there forever, and because
     askOffer refuses while one is open, a single backgrounded ask removed the
     feature for that customer permanently. The abandonment rule is: the held
     price stands. Book it, and close the request. */
  if (req.status === 'awaiting_choice' && req.holdUntil && Date.now() > req.holdUntil) {
    if (req.held) return bookHeld(requestId).then(() => auctionState({ ...req, bids: bidsFor(requestId) })), st;
    dispatch({ type: 'request/patch', payload: { id: requestId, patch: { status: 'expired' } } });
  }
  return st;
}

export function ranked(requestId) {
  const req = requestById(requestId);
  if (!req) return { hero: null, others: [], cheapest: null, all: [] };
  const byId = {};
  getState().partners.forEach(p => { byId[p.id] = p; });
  const band = { beff: req.beff, floor: req.floor, target: req.target, ceiling: req.ceiling, quoteOnly: false };
  return rankBids(bidsFor(requestId), byId, band, { area: req.area });
}

export async function acceptBid(requestId, bidId) {
  const req = requestById(requestId);
  const bid = getState().bids.find(b => b.id === bidId);
  if (!req || !bid) return null;
  if (req.awardedBidId) { toast('This request is already awarded', 'warn'); return null; }
  if (req.customerKey !== (me() && me().key)) { toast('Only the person who asked can accept', 'danger'); return null; }
  const partner = getState().partners.find(p => p.id === bid.partnerId);
  if (!partner) return null;

  /* THE SAME ORDERING DEFECT AS `bookHeld`, one function down: this awarded the
     bid, rejected every rival and marked the request awarded BEFORE calling a
     booking that can refuse -- leaving a closed request, a pro told he had won,
     and no job anywhere. The award is the LAST thing that happens, not the
     first. */
  const order = await bookService({
    catId: req.catId, partner, sub: req.sub,
    deal: bid.countered || bid.amount, slot: req.slotType,
  });
  if (!order) return null;

  clearTimers(requestId);
  dispatch({ type: 'bid/patch', payload: { id: bidId, patch: { status: 'accepted' } } });
  dispatch({ type: 'bid/rejectOthers', payload: { requestId, keepId: bidId } });
  dispatch({ type: 'request/patch', payload: { id: requestId, patch: { status: 'awarded', awardedBidId: bidId } } });
  audit.record('bid.accepted', { requestId, bidId, amount: bid.amount }, me().key);
  return order;
}

/** The one-tap counter. Deliberately UNAVAILABLE against a pro who already
    bid at or below the fair price — so bidding honestly is strictly safer
    than bidding high, which is the whole meaning of "reasonably". */
export function counterFor(requestId, bidId) {
  const req = requestById(requestId);
  const bid = getState().bids.find(b => b.id === bidId);
  if (!req || !bid) return { available: false };
  const band = { beff: req.beff, floor: req.floor, target: req.target, ceiling: req.ceiling, quoteOnly: false };
  return counterOffer(bid, band, { counterUsed: req.counterUsed });
}

export function sendCounter(requestId, bidId) {
  const c = counterFor(requestId, bidId);
  if (!c.available) { toast(c.why || 'Cannot counter this quote', 'warn'); return null; }
  dispatch({ type: 'bid/patch', payload: { id: bidId, patch: { status: 'countered', countered: c.amount } } });
  dispatch({ type: 'request/patch', payload: { id: requestId, patch: { counterUsed: true } } });
  toast(`Asked for ${c.amount / 100}. If they say no, their original price still stands.`);

  // the pro answers; declining is free and costs them nothing in score
  setTimeout(() => {
    const bid = getState().bids.find(b => b.id === bidId);
    if (!bid || bid.status !== 'countered') return;
    const accepts = Math.random() < 0.62;
    dispatch({ type: 'bid/patch', payload: { id: bidId, patch: accepts
      ? { status: 'submitted', amount: c.amount, counterAccepted: true }
      : { status: 'submitted', countered: null, counterDeclined: true } } });
    toast(accepts ? 'They agreed to your price.' : 'They kept their original price.');
  }, 2600);
  return c;
}

/** Take the original locked match instead. Always one tap, never confirmed —
    a customer who has to argue with a dialog to escape will not enter again. */
export async function bookHeld(requestId) {
  const req = requestById(requestId);
  if (!req || !req.held) return null;
  if (req.status === 'awarded' || req.status === 'held_booked') return null;
  const partner = getState().partners.find(p => p.id === req.held.partnerId);
  if (!partner) { toast('That worker is no longer free', 'warn'); return null; }
  /* AND THE PLATFORM BID AGAINST THE WORKER UNDER HIS OWN NAME. The held match
     is a price SAAHAA computes from a pro's listed rate and shows beside his
     photograph. If that same pro then answers the ask with a real quote, he was
     on the screen twice at two prices -- and this function booked the one HE
     did not write. An audit watched SAAHAA offer ₹583 "from Ramesh Yadav" while
     Ramesh had quoted ₹560, and the customer could only accept SAAHAA's number.

     A worker's own quote is the only price that carries his name. Where he has
     given one, it stands -- and the customer pays the lower of the two, because
     the held price was a ceiling promised to her, not a floor owed to us. */
  const own = bidsFor(requestId).find(b => b.partnerId === req.held.partnerId);
  const deal = own ? Math.min(own.amount | 0, req.held.amount | 0) : req.held.amount;
  /* THE REQUEST WAS CLOSED BEFORE THE JOB WAS CREATED, AND THE JOB CAN FAIL.
     `bookService` refuses without an address -- among other guards -- and this
     had already rejected every rival bid and marked the request `held_booked`.
     So the toast read "Add the flat or house and street first", the customer
     was left on "This request is closed. Nothing was charged." with no way
     back, no order existed, and the winning pro's console went on saying
     "waiting on the customer" about a request that could never be answered.
     He would have sat on that lead all day.

     Nothing is torn down until there is something to show for it. If the
     booking refuses, the request is exactly as it was and she can fix the
     address and tap again. */
  const order = await bookService({ catId: req.catId, partner, sub: req.sub, deal, slot: req.slotType });
  if (!order) return null;

  clearTimers(requestId);
  /* AND THEN IT TOLD HIM HE HAD LOST IT. `keepId: null` rejected every bid on
     the request -- including the bid of the very pro who just got the job. His
     LEADS tab showed the quote as "Lost", set his win rate to 0%, and answered
     "tap to see why" with "This job was not awarded to anyone", while the job
     sat in his JOBS tab in progress. The bid that won is kept. */
  dispatch({ type: 'bid/rejectOthers', payload: { requestId, keepId: own ? own.id : null } });
  dispatch({ type: 'request/patch', payload: { id: requestId, patch: { status: 'held_booked' } } });
  audit.record('request.tookHeld', { requestId, amount: deal, held: req.held.amount }, me().key);
  return order;
}

/** What the customer actually saved, for the receipt. Never rendered as
    "You saved 0" — a zero shown as zero kills the second use permanently. */
export function savings(req, paid) {
  if (!req || !req.held) return { amount: 0, replies: 0 };
  return { amount: Math.max(0, req.held.amount - paid), replies: bidsFor(req.id).length, held: req.held.amount, paid };
}

export function cancelRequest(requestId) {
  clearTimers(requestId);
  dispatch({ type: 'request/patch', payload: { id: requestId, patch: { status: 'cancelled' } } });
}

export { priceBand, auctionState, loserFeedback, waveRadiusKm, MAX_BIDS, MAX_INVITES };
