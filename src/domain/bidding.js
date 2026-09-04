/* SAAHAA · domain/bidding.js — multi-pro bidding, done "reasonably".

   The requirement: when more than one pro is available, they should be able to
   ask and bid — reasonably. "Reasonably" is the hard part, and the panel made
   it mechanical rather than aspirational with four interlocking rules:

     1. THE FLOOR stops the cliff.     No bid below 0.85 x fair price. The worst
        possible SAAHAA outcome still beats a 25%-commission app's typical one,
        so the "pros keep more" promise is a constraint, not a slogan.
     2. THE PEAKED SCORE stops the slide. The price score is highest AT the fair
        price, not at the floor. Undercutting to the floor costs 7.8 points and
        wins nothing. A floor alone just becomes the new market price; this is
        what actually prevents the race to the bottom.
     3. THE CEILING caps collusion.    A ring cannot extract more than 1.30x,
        and the fixed-price fallback is the credible threat against one.
     4. THE COUNTER is blocked against honest bidders. A pro who bids at or
        below fair price cannot be haggled with at all. Bidding honestly is
        strictly safer than bidding opportunistically.

   Bids are SEALED: nobody sees another's price during the window. Transparency
   is delayed to after the close, where it teaches ("you lost on distance, not
   price") instead of inviting an undercut ladder. */

import * as M from '../core/money.js';
import { find } from '../core/registry.js';
import { kmBetween, etaMins } from './match.js';
import { trustScore, tierMeets } from './trust.js';

/* ── rounding: never show a pro an unrounded rupee figure ──── */
export function roundPrice(paise, dir = 'near') {
  const rupees = paise / 100;
  const step = rupees >= 1000 ? 50 : 10;
  const f = dir === 'up' ? Math.ceil : dir === 'down' ? Math.floor : Math.round;
  return f(rupees / step) * step * 100;
}

/* ── complexity, from the request chips ────────────────────── */
export const COMPLEXITY = { simple: 1.00, medium: 1.25, complex: 1.60 };
export const ABS_MIN = 19900;                 // ₹199 — travel + an hour of a tradesman's time

/* ── per-unit band shape (panel V-C, S3) ───────────────────────
   Tighter where scope is unambiguous: a wide band on a known-scope job is not
   risk pricing, it is dispersion that makes the category look random. */
const BANDS = {
  'per visit': { floor: 0.85, target: 0.95, ceiling: 1.30 },
  'per item':  { floor: 0.90, target: 0.97, ceiling: 1.25 },
  'per hour':  { floor: 0.90, target: 0.97, ceiling: 1.35 },
  'per sq.ft': { floor: 0.88, target: 0.96, ceiling: 1.30 },
  'per kg':    { floor: 0.90, target: 0.97, ceiling: 1.25 },
  'per session':{ floor: 0.88, target: 0.96, ceiling: 1.30 },
  'on survey': null,                          // itemised quotes, no percentage band
  DEFAULT:     { floor: 0.85, target: 0.95, ceiling: 1.30 },
};

/**
 * The published band. Snapshotted onto the request at post time so that
 * editing a category's base price can never retroactively void live bids.
 */
export function priceBand(catId, { complexity = 'simple', units = 1, damagePhoto = false } = {}) {
  const cat = find('category', catId);
  // A retail category has no `base`, so every arithmetic result was NaN — and
  // because every NaN comparison is false, floor/ceiling/tooSmall ALL passed.
  // A Rs.1 bid on a bag of rice validated. Bands are for services only.
  if (!cat || cat.__tombstone || cat.kind !== 'service' || !Number.isFinite(cat.base)) return null;
  const shape = (cat.unit in BANDS) ? BANDS[cat.unit] : BANDS.DEFAULT;
  if (shape === null) return { quoteOnly: true, cat };

  const cx = COMPLEXITY[complexity] ?? 1;
  const beff = Math.round(cat.base * cx * (units > 1 ? units : 1));
  let ceilMul = shape.ceiling;
  if (cx >= 1.25) ceilMul = Math.max(ceilMul, 1.40);
  if (damagePhoto) ceilMul = Math.max(ceilMul, 1.60);

  // The absolute minimum can exceed a cheap category's fair price (a Rs.180
  // ironing job cannot pay for travel). When it binds, lift the whole band
  // with it rather than inverting it.
  const floor   = Math.max(roundPrice(beff * shape.floor, 'up'), ABS_MIN);
  const target  = Math.max(roundPrice(beff * shape.target), floor);
  const ceiling = Math.max(roundPrice(beff * ceilMul, 'down'), target);
  return { quoteOnly: false, cat, complexity, cx, units, beff, floor, target, ceiling, minBinds: floor === ABS_MIN };
}

/** The three budget chips a customer picks from. No keyboard, so no ₹200. */
export function budgetChips(band) {
  if (!band || band.quoteOnly) return [];
  return [
    { id: 'budget',   label: 'Budget',   amount: band.floor },
    { id: 'standard', label: 'Standard', amount: band.target, recommended: true },
    { id: 'premium',  label: 'Premium',  amount: band.ceiling },
  ];
}

export function validateBid(amount, band) {
  if (!band) return { ok: false, reason: 'This category is not open to bidding.' };
  if (band.quoteOnly) return { ok: true };
  if (!Number.isInteger(amount)) return { ok: false, reason: 'Price must be a whole rupee amount.' };
  if (amount < band.floor)
    return { ok: false, reason: `Minimum for this job is ${M.fmt(band.floor)} — below that it is not worth your travel.` };
  if (amount > band.ceiling)
    return { ok: false, reason: `Maximum for this job is ${M.fmt(band.ceiling)}.` };
  return { ok: true };
}

/* ── categories where bidding is banned outright ───────────────
   Each of these is a case where an auction actively harms someone. */
export const NO_BID_REASONS = {
  emergency:  'Emergency work is booked instantly at the fair price — a 12-minute auction while a pipe floods is a product failure.',
  tooSmall:   'Under ₹300 the whole spread is about ₹40. Twelve minutes of five pros’ attention for ₹40 destroys supply.',
  licensed:   'Price competition on licence-gated safety work selects for whoever will skip a step. Fixed rate, matched on credential.',
  care:       'Bidding on a caregiver ranks the cheapest human on the most trust-sensitive job. Fixed rate, profile and a call instead.',
  renewal:    'A subscription re-bids once, then locks for 3 months. Re-auctioning a relationship every month manufactures churn.',
  thinSupply: 'Fewer than 6 verified pros here — a two-bidder auction is theatre and invites collusion.',
};

const LICENCE_GATED = new Set(['health']);
const CARE_WORK     = new Set(['help', 'health', 'wellness']);
export const MIN_POOL_FOR_BIDDING = 6;

/**
 * Can this request go to auction at all?
 * @returns {{allowed:boolean, reason?:string, why?:string}}
 */
export function biddingAllowed(catId, { urgent = false, poolSize = 99, isRenewal = false, band } = {}) {
  const cat = find('category', catId);
  if (!cat || cat.__tombstone) return { allowed: false, reason: 'thinSupply', why: NO_BID_REASONS.thinSupply };
  if (urgent)                  return { allowed: false, reason: 'emergency', why: NO_BID_REASONS.emergency };
  if (LICENCE_GATED.has(catId) || cat.licenceRequired)
                               return { allowed: false, reason: 'licensed', why: NO_BID_REASONS.licensed };
  if (CARE_WORK.has(catId))    return { allowed: false, reason: 'care', why: NO_BID_REASONS.care };
  if (isRenewal)               return { allowed: false, reason: 'renewal', why: NO_BID_REASONS.renewal };
  if (poolSize < MIN_POOL_FOR_BIDDING)
                               return { allowed: false, reason: 'thinSupply', why: NO_BID_REASONS.thinSupply };
  const b = band || priceBand(catId);
  if (!b) return { allowed: false, reason: 'thinSupply', why: NO_BID_REASONS.thinSupply };
  if (!b.quoteOnly && b.beff < 30000)
                               return { allowed: false, reason: 'tooSmall', why: NO_BID_REASONS.tooSmall };
  return { allowed: true };
}

/* ── scoring ───────────────────────────────────────────────────
   Weights sum to exactly 100 — asserted in the self-test suite. */
export const WEIGHTS = { price: 35, trust: 25, rating: 15, distance: 15, quickness: 10 };
const clamp01 = x => Math.max(0, Math.min(1, x));

/** THE anti-race lever: peaks at the fair price, not at the floor. */
export function priceScore(amount, band) {
  if (!band || band.quoteOnly) return 0.5;
  return clamp01(1 - Math.abs(amount - band.target) / (0.45 * band.beff));
}

/** Bayesian shrink toward the platform mean, so 5.0 from two friends loses
    to 4.6 from forty jobs. New pros get a floor and a visible badge. */
export function ratingScore(partner) {
  const jobs = partner.completed || 0;
  const rs = partner.ratings || [];
  const raw = rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 4.2;
  const eff = (jobs * raw + 10 * 4.2) / (jobs + 10);
  const s = clamp01((eff - 3.0) / 2.0);
  return jobs < 3 ? Math.max(s, 0.60) : s;
}

/** The 20-second dead zone removes any payoff for a scripted sniper. */
export function quicknessScore(bidAfterSeconds) {
  return clamp01(1 - (bidAfterSeconds - 20) / 900);
}

export function scoreBid(bid, partner, band, ctx = {}) {
  const km = bid.km ?? kmBetween(ctx.area || 'Madhapur', partner.area);
  const t = trustScore(partner);
  const parts = {
    price:     priceScore(bid.amount, band),
    trust:     t.score / 100,
    rating:    ratingScore(partner),
    distance:  clamp01(1 - km / 6),
    quickness: quicknessScore(bid.afterSeconds ?? 60),
  };
  const score = Object.entries(WEIGHTS).reduce((n, [k, w]) => n + w * parts[k], 0);
  return {
    ...bid, partnerId: partner.id, partnerName: partner.name,
    km, eta: etaMins(km), trust: t.score, band: t.band,
    score: Math.round(score * 10) / 10,
    parts,
    isNew: (partner.completed || 0) < 3,
  };
}

/** Plain-language reason for the hero card. Never show a number nobody asked for. */
export function reasonFor(scored, all) {
  const wins = [];
  const best = k => all.every(o => (o.parts ? o.parts[k] : 0) <= scored.parts[k]);
  if (best('distance')) wins.push('nearest');
  if (best('price'))    wins.push('fair price');
  if (best('trust'))    wins.push('most trusted');
  if (best('rating') && !scored.isNew) wins.push('best rated');
  if (!wins.length) wins.push('best overall');
  return wins.slice(0, 3).join(' + ');
}

/** Rank sealed bids. Returns the hero, the rest, and the cheapest for the
    transparency tab — hiding the cheap bid entirely reads as a con. */
export function rankBids(bids, partnersById, band, ctx = {}) {
  const scored = bids
    .filter(b => b.status === 'submitted' || b.status === 'shortlisted')
    .map(b => {
      const p = partnersById[b.partnerId];
      return p ? scoreBid(b, p, band, ctx) : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.trust - a.trust || a.submittedAt - b.submittedAt);

  const cheapest = scored.slice().sort((a, b) => a.amount - b.amount)[0] || null;
  const hero = scored[0] || null;
  if (hero) hero.reason = reasonFor(hero, scored);
  return { hero, others: scored.slice(1), cheapest, all: scored };
}

/* ── the auction clock ─────────────────────────────────────── */
export const WINDOW = {
  now: 12 * 60e3, today: 12 * 60e3, scheduled: 45 * 60e3, quote: 4 * 3600e3,
};
export const WAVE_MS = 3 * 60e3;      // invite 4 more pros every 3 minutes
export const WAVE_SIZE = 4;
export const MAX_INVITES = 12;
export const MAX_BIDS = 5;            // early-close once 5 qualified bids land
export const HOLD_MS = 5 * 60e3;      // the customer's window to choose
export const CONFIRM_MS = 5 * 60e3;   // winner must say "on my way" or it reassigns

export function waveRadiusKm(round) { return [3, 6, 10][Math.min(2, round)] || 10; }

export function auctionState(req, now = Date.now()) {
  const opened = req.openedAt || now;
  const closes = req.closesAt || (opened + (WINDOW[req.slotType] || WINDOW.now));
  const round = Math.min(2, Math.floor((now - opened) / WAVE_MS));
  const bidCount = (req.bids || []).length;
  if (bidCount >= MAX_BIDS || now >= closes) {
    const hold = (req.closedAt || closes) + HOLD_MS;
    return now < hold
      ? { phase: 'awaiting_choice', msLeft: hold - now, round }
      : { phase: 'expired', msLeft: 0, round };
  }
  return {
    phase: 'bidding', msLeft: closes - now, round,
    invited: Math.min(MAX_INVITES, WAVE_SIZE * (round + 1)),
    radiusKm: waveRadiusKm(round),
  };
}

/* ── the one-tap counter ───────────────────────────────────────
   Unavailable when the pro already bid at or below fair price. That single
   rule is what makes honest bidding strictly safer than opportunistic
   bidding — and it is the cleanest expression of "reasonably" in the design. */
export const COUNTER_STEP = 0.07;

export function counterOffer(bid, band, req = {}) {
  if (!band || band.quoteOnly) return { available: false, why: 'Quotes are revised by line item, not haggled.' };
  if (req.counterUsed) return { available: false, why: 'You have already made your one counter-offer.' };
  if (bid.amount <= band.target)
    return { available: false, why: 'This pro already bid at or below the fair price.' };
  /* Clamp to the FAIR price, not the floor. A -7% counter on a bid just above
     target would otherwise land BELOW target — which is the product using its
     own haggle button to defeat the anti-undercutting rule it is built on. */
  const amount = Math.max(band.target, roundPrice(bid.amount * (1 - COUNTER_STEP), 'up'));
  if (amount >= bid.amount) return { available: false, why: 'Already at the fair price.' };
  return { available: true, amount, expiresMs: CONFIRM_MS };
}

/* ── post-auction coaching: the delayed transparency loop ───── */
export function loserFeedback(mine, winner) {
  if (!mine || !winner) return null;
  const gaps = Object.keys(WEIGHTS)
    .map(k => ({ k, gap: (winner.parts[k] - mine.parts[k]) * WEIGHTS[k] }))
    .filter(g => g.gap > 2)
    .sort((a, b) => b.gap - a.gap)
    .map(g => ({ distance: 'distance', trust: 'trust score', rating: 'reviews',
                 price: 'price', quickness: 'response time' }[g.k]));
  const cheaperAndLost = mine.amount < winner.amount;
  return {
    winningBid: winner.amount, yourBid: mine.amount,
    yourScore: mine.score, winnerScore: winner.score,
    lostOn: gaps.slice(0, 2),
    message: cheaperAndLost
      ? `You were ${M.fmt(winner.amount - mine.amount)} cheaper and still lost. It came down to ${gaps.slice(0, 2).join(' and ') || 'overall score'} — not price. Bidding the fair price and taking jobs closer to you wins more.`
      : `Lost on ${gaps.slice(0, 2).join(' and ') || 'overall score'}.`,
  };
}
