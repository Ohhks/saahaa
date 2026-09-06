/* SAAHAA · domain/autoverify.js — approvals that happen by themselves.

   Tier 2 was always automatic (the seven-step ladder). Tiers 3 and 4 used
   to wait on the owner: a phone call for the background check, a click for
   the Certified badge. Both are now earned mechanically, by the network
   itself — peer-to-peer verification — and the owner keeps a kill switch and
   the right to suspend.

   TIER 3 · BACKGROUND CHECKED, granted when ALL of these hold:
     · the ladder is complete (tier 2)
     · at least `bgJobs` REAL jobs settled cleanly (OTP + photo, no upheld
       dispute) — countedJobs, the number the provisional cap already uses
     · average rating ≥ `bgRating` over those jobs
     · zero upheld disputes
     · at least `bgVouches` vouches from people who can know: a Background-
       Checked (tier ≥ 3) pro in the SAME trade, or a customer who has had a
       job with this pro settle. One vouch per person, ever.
     · the reference the pro named has confirmed by code (the reference gets
       a 4-digit code; until the SMS rail exists it is shown on screen, the
       same honest sandbox the phone step uses)

   TIER 4 · SAAHAA CERTIFIED, granted when the numbers hold (25 jobs,
   rating ≥ 4.6, 0 upheld disputes — CERTIFIED_RULE) AND tier 3 has been held
   for `certDays` days AND no dispute is open.

   Every promotion is audited with actor 'auto' and the evidence it was
   granted on. The owner's dials live in settings.automation; the kill switch
   is `autoApprove`. Suspension always wins: a suspended pro is never touched.

   Nothing here posts money. Nothing here touches the DOM. */

import { getState, dispatch, me } from '../core/ctx.js';
import * as audit from '../core/audit.js';
import { otp as makeOtp } from '../core/id.js';
import { getAutomation } from './settings.js';
import * as V from './verification.js';

const SETTLED = new Set(['SETTLED', 'RATED', 'CLOSED', 'PARTIAL']);
const partnerById = id => getState().partners.find(p => p.id === id) || null;

/* ── who may vouch ──────────────────────────────────────────── */
export function canVouch(user, partner) {
  if (!user || !partner) return { ok: false, reason: 'Sign in to vouch.' };
  if (user.key === partner.userKey) return { ok: false, reason: 'You cannot vouch for yourself.' };
  if ((partner.vouches || []).some(v => v.byKey === user.key)) return { ok: false, reason: 'You have already vouched for this pro.' };
  const st = getState();
  const asPro = st.partners.find(p => p.userKey === user.key);
  if (asPro && (asPro.tier | 0) >= 3 && asPro.cat === partner.cat && !asPro.suspended) return { ok: true, role: 'pro' };
  const worked = st.orders.some(o => o.kind === 'service' && o.partnerId === partner.id && o.customerKey === user.key && SETTLED.has(o.stage));
  if (worked) return { ok: true, role: 'customer' };
  if (asPro) return { ok: false, reason: 'Only a Background-Checked pro in the same trade can vouch as a pro.' };
  return { ok: false, reason: 'Vouching is for customers who have had a job with this pro settle.' };
}

/** Record a vouch from the signed-in user. Returns the vouch or null. */
export function vouch(partnerId) {
  const user = me(), p = partnerById(partnerId);
  const c = canVouch(user, p);
  if (!c.ok) return { ok: false, reason: c.reason };
  const v = { byKey: user.key, byName: user.name, role: c.role, at: Date.now() };
  dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { vouches: (p.vouches || []).concat([v]) } } });
  audit.record('verify.vouch', { partner: p.id, role: c.role }, user.key);
  return { ok: true, vouch: v };
}

/* ── the reference's code ───────────────────────────────────── */
export function sendReferenceCode(p) {
  const bg = V.backgroundRecord(p);
  if (!bg || !bg.refName) return null;
  const code = makeOtp();
  V.patchBackground(p, b => ({ ...b, refCode: code, refCodeAt: Date.now(), refConfirmed: false }));
  audit.record('verify.refCodeSent', { partner: p.id }, p.userKey);
  return code;                    // shown on screen until the SMS rail exists
}
export function confirmReference(p, entered) {
  const bg = V.backgroundRecord(p);
  if (!bg || !bg.refCode) return false;
  if (String(entered || '').trim() !== String(bg.refCode)) { audit.record('verify.refCodeWrong', { partner: p.id }, p.userKey); return false; }
  V.patchBackground(p, b => ({ ...b, refConfirmed: true, refConfirmedAt: Date.now(), refCode: null }));
  audit.record('verify.refConfirmed', { partner: p.id }, p.userKey);
  return true;
}

/* ── where a pro stands ─────────────────────────────────────── */
function avgRating(p) { const rs = p.ratings || []; return rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 0; }
function openDisputes(p) { return getState().disputes.filter(d => d.partnerId === p.id && d.status !== 'RESOLVED').length; }

/** The tier-3 checklist, each line with have / need / ok. */
export function progress(p) {
  const A = getAutomation();
  const r = V.readiness(p);
  const bg = V.backgroundRecord(p) || {};
  const jobs = p.countedJobs ?? 0, avg = avgRating(p), vouches = (p.vouches || []).length;
  const lines = {
    ladder:    { ok: r.complete, have: r.done.length, need: V.CORE_IDS.length, label: 'Verification ladder complete' },
    jobs:      { ok: jobs >= A.bgJobs, have: jobs, need: A.bgJobs, label: 'Real jobs settled cleanly (code + photo)' },
    rating:    { ok: jobs >= A.bgJobs && avg >= A.bgRating, have: +avg.toFixed(2), need: A.bgRating, label: 'Average rating' },
    disputes:  { ok: (p.disputesUpheld | 0) === 0, have: p.disputesUpheld | 0, need: 0, label: 'Upheld disputes' },
    vouches:   { ok: vouches >= A.bgVouches, have: vouches, need: A.bgVouches, label: 'Vouches from customers or same-trade pros' },
    reference: { ok: !A.bgReference || !!bg.refConfirmed, have: bg.refConfirmed ? 1 : 0, need: A.bgReference ? 1 : 0,
                 label: bg.refName ? 'Reference confirmed by code' : 'Name a reference', named: !!bg.refName },
  };
  const ready = Object.values(lines).every(l => l.ok) && !p.suspended && (p.tier | 0) === 2;
  return { lines, ready, tier: p.tier | 0, suspended: !!p.suspended, automation: A.autoApprove };
}

/** The tier-4 checklist. */
export function certifiedProgress(p) {
  const A = getAutomation();
  const e = V.certifiedEligible(p);
  const heldDays = p.tier3At ? (Date.now() - p.tier3At) / 86400000 : 0;
  const lines = {
    jobs:     { ok: e.jobs, have: e.completed, need: V.CERTIFIED_RULE.jobs, label: 'Jobs completed' },
    rating:   { ok: e.rating, have: +e.avg.toFixed(2), need: V.CERTIFIED_RULE.rating, label: 'Average rating' },
    disputes: { ok: e.disputes, have: p.disputesUpheld | 0, need: 0, label: 'Upheld disputes' },
    tenure:   { ok: heldDays >= A.certDays, have: Math.floor(heldDays), need: A.certDays, label: 'Days as Background Checked' },
    open:     { ok: openDisputes(p) === 0, have: openDisputes(p), need: 0, label: 'Open disputes' },
  };
  const ready = Object.values(lines).every(l => l.ok) && !p.suspended && (p.tier | 0) === 3;
  return { lines, ready, tier: p.tier | 0, automation: A.autoApprove };
}

/* ── the sweep ──────────────────────────────────────────────── */
/** Promote everyone who has earned it. Returns the promotions made. */
export function sweepAutoApprovals(now = Date.now()) {
  const A = getAutomation();
  if (!A.autoApprove) return [];
  const made = [];
  for (const p0 of getState().partners.slice()) {
    const p = partnerById(p0.id);
    if (!p || p.suspended) continue;
    if ((p.tier | 0) === 2) {
      const pr = progress(p);
      if (pr.ready && V.approveTier(p, 3, 'auto')) {
        dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { tier3At: now } } });
        audit.record('verify.auto', { partner: p.id, tier: 3, evidence: summary(pr.lines) }, 'auto');
        made.push({ id: p.id, name: p.name, tier: 3 });
      }
    } else if ((p.tier | 0) === 3) {
      const cp = certifiedProgress(p);
      if (cp.ready && V.approveTier(p, 4, 'auto')) {
        audit.record('verify.auto', { partner: p.id, tier: 4, evidence: summary(cp.lines) }, 'auto');
        made.push({ id: p.id, name: p.name, tier: 4 });
      }
    }
  }
  return made;
}
const summary = lines => Object.fromEntries(Object.entries(lines).map(([k, l]) => [k, `${l.have}/${l.need}`]));

/** For the admin: who is close, and what they are waiting on. */
export function pipeline() {
  return getState().partners
    .filter(p => !p.suspended && ((p.tier | 0) === 2 || (p.tier | 0) === 3))
    .map(p => { const pr = (p.tier | 0) === 2 ? progress(p) : certifiedProgress(p);
                const missing = Object.values(pr.lines).filter(l => !l.ok).map(l => l.label);
                return { id: p.id, name: p.name, cat: p.cat, tier: p.tier | 0, next: (p.tier | 0) + 1, missing, ready: pr.ready }; })
    .sort((a, b) => a.missing.length - b.missing.length);
}
