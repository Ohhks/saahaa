/* SAAHAA · domain/trust.js — verification ladder, trust score, escrow tiering.
   Adopted from the trust & ops ballot (V4). Every tier must BUY the partner
   something they can feel, or nobody climbs it. */

import * as M from '../core/money.js';
import { getPricing } from './settings.js';

/* ── verification ladder ───────────────────────────────────── */
export const TIERS = [
  { n:0, id:'unverified', label:'Unverified',        badge:'',                   tone:'soft',
    capPaise:0,       unlocks:'Browse only. Cannot bid, cannot be booked.' },
  { n:1, id:'phone',      label:'Number confirmed',  badge:'Number confirmed',   tone:'soft',
    capPaise:150000,  unlocks:'Bid and accept jobs. Max ₹1,500 a job.' },
  { n:2, id:'id',         label:'ID Verified',       badge:'ID Verified',        tone:'info',
    capPaise:1000000, unlocks:'Higher caps, appears in the Verified filter, can list products.' },
  { n:3, id:'background', label:'Background Checked',badge:'Background Checked', tone:'ok',
    capPaise:5000000, unlocks:'Unlocks in-home work: maid, cook, childcare, elder care, tuition.' },
  { n:4, id:'certified',  label:'SAAHAA Certified',  badge:'SAAHAA Certified',   tone:'gold',
    capPaise:Infinity,unlocks:'Top of search, instant payouts, platform fee 8% → 6%.' },
];
export const tier = n => TIERS[Math.max(0, Math.min(4, n | 0))];
export const tierMeets = (partnerTier, required) => (partnerTier | 0) >= (required | 0);

/* ── trust score (0-100) ───────────────────────────────────────
   TRUST = 100 x [0.30R + 0.20C + 0.15V + 0.12D + 0.10E + 0.08T + 0.05F] - penalties
   weights sum to exactly 1.00 (asserted in the self-test suite). */
export const WEIGHTS = { R:0.30, C:0.20, V:0.15, D:0.12, E:0.10, T:0.08, F:0.05 };
const PRIOR_K = 5, PRIOR_MEAN = 3.8, HALF_LIFE_DAYS = 180;

export function trustScore(p, now = Date.now()) {
  const ratings = (p.ratings || []).slice(-50);

  // R — Bayesian-smoothed, recency-weighted rating quality
  let num = PRIOR_K * PRIOR_MEAN, den = PRIOR_K;
  for (const r of ratings) {
    const stars = Number(r && r.stars);
    if (!Number.isFinite(stars)) continue;        // a malformed rating is ignored, not fatal
    const ageDays = (now - (r.ts || now)) / 86400000;
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    num += stars * w; den += w;
  }
  const R = Math.max(0, Math.min(1, (num / den - 1) / 4));

  // C — completion reliability; no-shows count double
  const done = p.completed || 0, wc = p.workerCancels || 0, ns = p.noShows || 0;
  const C = (done + wc + ns) === 0 ? 0.5 : done / (done + wc + ns * 2);

  // V — verification tier
  const V = [0, 0.25, 0.55, 0.85, 1.0][Math.max(0, Math.min(4, p.tier | 0))];

  // D — dispute cleanliness
  const D = Math.max(0, 1 - Math.min(1, (p.disputesUpheld || 0) * 0.25 + (p.disputesPartial || 0) * 0.12));

  // E — experience, log-scaled so it saturates near 100 jobs
  const E = Math.min(1, Math.log(1 + done) / Math.log(101));

  // T — timeliness
  const starts = p.starts || 0;
  const T = starts < 5 ? 0.6 : (p.onTimeStarts || 0) / starts;

  // F — freshness
  const idleDays = (now - (p.lastActiveTs || now)) / 86400000;
  const F = idleDays <= 14 ? 1 : idleDays <= 45 ? 0.7 : idleDays <= 90 ? 0.4 : 0.1;

  const base = 100 * (WEIGHTS.R*R + WEIGHTS.C*C + WEIGHTS.V*V + WEIGHTS.D*D +
                      WEIGHTS.E*E + WEIGHTS.T*T + WEIGHTS.F*F);

  const penalties =
      (p.suspended ? 25 : 0)
    + (p.offPlatformFlags || 0) * 15
    + (p.fakeReviewFlags || 0) * 10
    + (p.idMismatch ? 10 : 0)
    + (p.staleComplaints || 0) * 5;

  const score = Math.round(Math.max(0, Math.min(100, base - penalties)));
  return { score, band: band(score), parts: { R, C, V, D, E, T, F }, penalties };
}

export function band(score) {
  // fail CLOSED: every comparison against NaN is false, so the old version fell
  // through every branch and returned Elite
  if (!Number.isFinite(score)) return { id:'restricted', label:'Unrated', tone:'bad' };
  if (score < 40) return { id:'restricted', label:'Restricted', tone:'bad' };
  if (score < 55) return { id:'watch',      label:'New / Watch', tone:'warn' };
  if (score < 70) return { id:'standard',   label:'Standard',    tone:'info' };
  if (score < 85) return { id:'trusted',    label:'Trusted',     tone:'ok' };
  return { id:'elite', label:'Elite', tone:'gold' };
}

/* ── escrow tiering (V4-B1: tiered, not all-manual, not all-auto) ──
   Manual review on every job does not scale past ~30 bookings/day for a solo
   admin; pure auto-release hands fraudsters a free ATM. The risk score picks. */
export const ESCROW = {
  INSTANT:  { id:'INSTANT',  holdMs: 0,             label:'Instant on confirm' },
  FAST:     { id:'FAST',     holdMs: 6*3600e3,      label:'Auto-release in 6h' },
  STANDARD: { id:'STANDARD', holdMs: 24*3600e3,     label:'Auto-release in 24h' },
  HOLD:     { id:'HOLD',     holdMs: Infinity,      label:'Team review required' },
  FREEZE:   { id:'FREEZE',   holdMs: Infinity,      label:'Frozen — under investigation' },
};

export function escrowTier(order, partner) {
  const t = trustScore(partner).score;
  const D = order.deal | 0;
  if (partner.suspended || (partner.disputesUpheld || 0) >= 2) return ESCROW.FREEZE;
  if (order.disputed) return ESCROW.HOLD;
  if (!order.evidence || !order.evidence.length) return ESCROW.HOLD;  // no photo -> never auto
  if (D > 1000000 || t < 55 || (partner.completed || 0) < 3) return ESCROW.HOLD;
  if (D <= 150000 && t >= 70 && (partner.completed || 0) >= 10 && order.otpVerified) return ESCROW.INSTANT;
  if (D <= 500000 && t >= 55 && order.otpVerified) return ESCROW.FAST;
  return ESCROW.STANDARD;
}

/* effective platform markup — Tier-4 loyalty rebate is the ONLY discount */
export function markupFor(partner) {
  const P = getPricing();
  return ((partner && (partner.tier | 0) >= 4) ? P.loyaltyMarkupPct : P.serviceMarkupPct) / 100;
}

/* rating tag chips (two-sided) */
export const TAGS = {
  workerGood: ['On time', 'Neat work', 'Fair price', 'Polite', 'Well equipped', 'Explained clearly'],
  workerBad:  ['Late', 'Rushed job', 'Asked extra cash', 'Unprofessional', 'Left mess', 'Not skilled'],
  shopGood:   ['Fresh', 'Correct weight', 'Well packed', 'Cold on arrival', 'On time'],
  shopBad:    ['Stale', 'Short weight', 'Leaked', 'Warm', 'Late'],
  customerGood: ['Easy to deal with', 'Clear brief', 'Paid on time', 'Safe premises'],
  customerBad:  ['Rude', 'Unclear scope', 'Haggled hard', 'Unsafe premises'],
};

/* PROVISIONAL. A newly verified pro is tier 2 by document and quiz, but by
   track record they are nobody yet. Rather than lock them out of their own
   trade (which is what a category gate does, and what makes real plumbers walk
   away), bound the damage: Rs.1,500 a job until three jobs have settled
   without a complaint. Then the full tier-2 cap opens by itself. */
export const PROVISIONAL_CAP = 150000;
export const PROVISIONAL_JOBS = 3;
export const isProvisional = p => !!p && (p.tier | 0) >= 2 && (p.countedJobs ?? p.completed ?? 0) < PROVISIONAL_JOBS
                                  && !!p.verification;      // legacy seeds are not provisional
export const effectiveCap = p => isProvisional(p) ? PROVISIONAL_CAP : tier(p && p.tier).capPaise;
export const capOk = (partner, dealPaise) => dealPaise <= effectiveCap(partner);
export { M as money };
