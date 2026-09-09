/* SAAHAA · domain/verification.js — the professional gate.

   THE PROBLEM IT SOLVES. Signing up used to create a partner at tier 1,
   online, bookable — with no check of any kind between "typed a name" and
   "in a customer's home holding their money". At the same time nearly every
   category has minTier 2, so that same new partner could not actually get
   jobs, and the only way up was an admin tapping Approve on a name with no
   evidence behind it. Neither safe nor fair, and a dead end for the pro.

   THE SHAPE. A fixed chronology of steps, each one screen, each ≤2 taps or
   one photo. Everything that CAN be checked by a machine is checked by a
   machine, immediately, so a pro who starts at 9am can be taking jobs by
   9:20 — and the single owner touches nothing until tier 3.

     phone     · OTP to their number                            AUTO
     identity  · Aadhaar / PAN / DL — we keep a HASH + last 4   AUTO (name-match: production)
     selfie    · one photo, liveness deferred to production     AUTO
     trade     · 5-question trade quiz, pass 4/5                AUTO
     conduct   · 6-question rules quiz, pass 5/6                AUTO
     payout    · a valid UPI id                                 AUTO
     agreement · the partner terms, one tap                     AUTO
     ───────────────────────────── all seven ⇒ TIER 2, can take jobs
     background· reference + consent to police verification    OWNER approves ⇒ tier 3
     certified · 25 jobs · rating ≥ 4.6 · no upheld disputes    OWNER approves ⇒ tier 4

   WHAT WE STORE. Never a document number. A SHA-256 of it plus the last four
   digits is enough to detect the same ID used twice and to show the pro
   "…4821" as proof we have it. If a device's storage were ever read,
   there would be nothing in it to steal. */

import { getState, dispatch, me } from '../core/ctx.js';
import { sha256 } from '../core/crypto.js';
import { otp as makeOtp } from '../core/id.js';
import { find } from '../core/registry.js';
import * as audit from '../core/audit.js';
import { toast } from '../ui/dom.js';
import { TIERS } from './trust.js';
import { tradeBank, CONDUCT, shuffled, score, PASS, MAX_ATTEMPTS, LOCK_MS } from './quiz.js';

/* ── the chronology ────────────────────────────────────────── */
export const STEPS = [
  { id: 'phone',     n: 1, title: 'Confirm your number',   sub: 'A 4-digit code confirms your number.',                 mins: 1 },
  { id: 'identity',  n: 2, title: 'Show us your ID',       sub: 'Aadhaar, PAN or licence. We keep only the last 4 digits.', mins: 2 },
  { id: 'selfie',    n: 3, title: 'One photo of you',      sub: 'For SAAHAA only — never shown to a customer.',              mins: 1 },
  { id: 'trade',     n: 4, title: 'Five trade questions',  sub: 'Things every real pro knows. Get 4 right.',                mins: 3 },
  { id: 'conduct',   n: 5, title: 'How SAAHAA works',      sub: 'Six questions on the rules. Get 5 right.',                 mins: 2 },
  { id: 'payout',    n: 6, title: 'Where to pay you',      sub: 'Your UPI id. Money lands here after every job.',           mins: 1 },
  { id: 'agreement', n: 7, title: 'Agree and go',          sub: 'One tap. You are a SAAHAA pro.',                           mins: 1 },
];
export const CORE_IDS = STEPS.map(s => s.id);
export const VERIFIED_TIER = 2;

/* what the higher rungs demand, spelled out so the screen and the code agree */
export const CERTIFIED_RULE = { jobs: 25, rating: 4.6, upheldDisputes: 0 };

/* ── reads ─────────────────────────────────────────────────── */
export function myPartner() {
  const s = me(); if (!s) return null;
  return getState().partners.find(p => p.userKey === s.key) || null;
}
export const partnerById = id => getState().partners.find(p => p.id === id) || null;

const rec = p => (p && p.verification) || { steps: {}, attempts: {} };
const stepDone = (p, id) => !!(rec(p).steps[id] && rec(p).steps[id].done);

/**
 * Where a partner is on the ladder. Seeded pros predate the ladder and carry
 * no record; for them a tier ≥ 2 is taken as "verified under the old scheme"
 * so the gate never retroactively strands a working pro.
 */
export function readiness(p) {
  if (!p) return { legacy: false, done: [], next: STEPS[0], complete: false, canWork: false, pct: 0 };
  // a record that holds only a background/reference entry (no ladder steps) does not make a pro un-legacy
  const hasSteps = !!(p.verification && p.verification.steps && Object.keys(p.verification.steps).length);
  const legacy = !hasSteps && (p.tier | 0) >= VERIFIED_TIER;
  const done = legacy ? CORE_IDS.slice() : CORE_IDS.filter(id => stepDone(p, id));
  const next = STEPS.find(s => !done.includes(s.id)) || null;
  const complete = done.length === CORE_IDS.length;
  return {
    legacy, done, next, complete,
    canWork: complete && (p.tier | 0) >= VERIFIED_TIER && !p.suspended,
    pct: Math.round((done.length / CORE_IDS.length) * 100),
    lockedUntil: rec(p).lockedUntil || 0,
    tier: TIERS[Math.max(0, Math.min(4, p.tier | 0))],
  };
}

/** The strict reason a partner cannot take a job right now, or null. */
export function blocker(p) {
  if (!p) return 'No partner profile.';
  if (p.suspended) return 'Your account is paused. Contact SAAHAA.';
  const r = readiness(p);
  if (!r.complete) return `Finish verification — ${r.next ? r.next.title.toLowerCase() : 'one step left'}.`;
  if ((p.tier | 0) < VERIFIED_TIER) return 'Verification is being applied.';
  return null;
}

/* ── writes ────────────────────────────────────────────────── */
function patchVerification(p, fn) {
  const cur = rec(p);
  const next = fn({ ...cur, steps: { ...cur.steps }, attempts: { ...cur.attempts } });
  dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { verification: next } } });
  return partnerById(p.id);
}
function markDone(p, id, meta = {}) {
  const after = patchVerification(p, v => { v.steps[id] = { done: true, at: Date.now(), ...meta }; return v; });
  audit.record('verify.step', { partner: p.id, step: id }, p.userKey);
  return settle(after);
}

/** Apply the outcome: all core steps ⇒ tier 2, exactly once. */
export function settle(p) {
  const r = readiness(p);
  if (r.complete && (p.tier | 0) < VERIFIED_TIER) {
    dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { tier: VERIFIED_TIER, online: true, verifiedAt: Date.now() } } });
    // the user row carries a tier too, for the account screen
    dispatch({ type: 'user/patch', payload: { key: p.userKey, patch: { tier: VERIFIED_TIER } } });
    audit.record('verify.passed', { partner: p.id, tier: VERIFIED_TIER }, p.userKey);
    return partnerById(p.id);
  }
  return p;
}

/* 1 · phone — the same virtual-OTP pattern the rest of the product uses.
   Until the SMS rail is wired (docs/LAUNCH.md) the code is shown on screen. */
export function sendPhoneCode(p) {
  const code = makeOtp();
  patchVerification(p, v => { v.phoneCode = code; v.phoneSentAt = Date.now(); return v; });
  return code;
}
export function confirmPhone(p, entered) {
  const v = rec(p);
  if (!v.phoneCode) { toast('Send the code first', 'warn'); return false; }
  if (String(entered).trim() !== String(v.phoneCode)) { toast('That code is not right', 'danger'); return false; }
  markDone(p, 'phone', { mobileLast4: String(p.mobile || (me() || {}).mobile || '').slice(-4) });
  return true;
}

/* 2 · identity — hash + last 4, never the number. Format-checked per type. */
export const ID_TYPES = {
  aadhaar: { label: 'Aadhaar',          test: v => /^\d{12}$/.test(v),                    hint: '12 digits' },
  pan:     { label: 'PAN',              test: v => /^[A-Z]{5}\d{4}[A-Z]$/.test(v),        hint: 'ABCDE1234F' },
  dl:      { label: 'Driving licence',  test: v => /^[A-Z]{2}[\-\s]?\d{2}[\-\s]?\d{4,11}$/.test(v), hint: 'TS09 20200012345' },
};
export async function submitIdentity(p, type, raw) {
  const t = ID_TYPES[type];
  const v = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!t) { toast('Pick an ID type', 'warn'); return false; }
  if (!t.test(v)) { toast(`That does not look like a valid ${t.label} (${t.hint})`, 'danger'); return false; }
  const hash = await sha256('SAAHAA-ID|' + type + '|' + v);
  // the same document on two accounts is the single most reliable fraud signal we have
  const dup = getState().partners.find(x => x.id !== p.id && x.verification && x.verification.idHash === hash);
  if (dup) { toast('This ID is already registered to another partner', 'danger'); audit.record('verify.idDuplicate', { partner: p.id, other: dup.id }, p.userKey); return false; }
  patchVerification(p, vv => { vv.idType = type; vv.idHash = hash; vv.idLast4 = v.slice(-4); return vv; });
  markDone(partnerById(p.id), 'identity', { type, last4: v.slice(-4) });
  return true;
}

/* 3 · selfie — a capture flag today; liveness + face-match against the ID
   is a production service (DigiLocker / a KYC vendor), tagged DEFERRED. */
export function submitSelfie(p) {
  markDone(p, 'selfie', { captured: true });
  return true;
}

/* 4 + 5 · the quizzes. Three attempts, then a 24-hour lock — long enough to
   stop guessing, short enough that an honest pro who misread is back
   tomorrow. */
export function quizFor(p, kind) {
  const bank = kind === 'trade' ? tradeBank(p.cat) : CONDUCT;
  const attempt = (rec(p).attempts[kind] || 0) + 1;
  return shuffled(bank, attempt * 7 + (kind === 'trade' ? 1 : 2));
}
export function quizState(p, kind) {
  const v = rec(p);
  const locked = (v.lockedUntil || 0) > Date.now();
  return { attempts: v.attempts[kind] || 0, left: MAX_ATTEMPTS - (v.attempts[kind] || 0), locked, lockedUntil: v.lockedUntil || 0 };
}
export function submitQuiz(p, kind, answers) {
  const st = quizState(p, kind);
  if (st.locked) { toast('Try again after the wait', 'warn'); return { ok: false, locked: true }; }
  const bank = quizFor(p, kind);
  const sc = score(bank, answers);
  const pass = sc.right >= PASS[kind];
  /* The TRADE quiz is a filter: three tries, then a day's wait. The CONDUCT
     quiz is a teaching instrument: it must not be able to reject anyone, but
     it must not be passable without reading — so a wrong answer shows the
     rule and the pro simply tries again. */
  const teaching = kind === 'conduct';
  const wrong = teaching ? bank.map((item, i) => answers[i] === item.a ? null : { q: item.q, right: item.o[item.a] }).filter(Boolean) : [];
  let after = patchVerification(p, v => {
    v.attempts[kind] = (v.attempts[kind] || 0) + 1;
    if (!teaching && !pass && v.attempts[kind] >= MAX_ATTEMPTS) { v.lockedUntil = Date.now() + LOCK_MS; v.attempts[kind] = 0; }
    return v;
  });
  if (pass) after = markDone(after, kind, { right: sc.right, total: sc.total });
  else audit.record('verify.quizFail', { partner: p.id, kind, right: sc.right }, p.userKey);
  const qs = quizState(after, kind);
  return { ok: pass, ...sc, need: PASS[kind], wrong, teaching,
           attemptsLeft: teaching ? Infinity : qs.left, locked: teaching ? false : qs.locked };
}
export function quizStateFor(p, kind) { const s = quizState(p, kind); return kind === 'conduct' ? { ...s, locked: false, left: Infinity } : s; }

/* 6 · payout — a UPI id, format only. A penny-drop verification is a
   production step (Razorpay/Cashfree), tagged DEFERRED. */
export const UPI_RE = /^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i;
export function submitPayout(p, upi) {
  const v = String(upi || '').trim();
  if (!UPI_RE.test(v)) { toast('A UPI id looks like name@bank', 'danger'); return false; }
  patchVerification(p, vv => { vv.upi = v; return vv; });
  markDone(partnerById(p.id), 'payout', { upiMasked: v.replace(/^(.{2}).*(@.*)$/, '$1…$2') });
  return true;
}

/* 7 · agreement */
export const TERMS = [
  'I will enter the customer’s code at the door before starting.',
  'I will never take payment outside SAAHAA.',
  'I will take a clear photo of finished work before asking for release.',
  'I will cancel early if I cannot come, never just not show up.',
  'I understand my quote is exactly what I am paid, and the customer pays the fee.',
];
export function acceptAgreement(p) {
  markDone(p, 'agreement', { version: 1 });
  return true;
}

/* ── the owner's rungs ─────────────────────────────────────── */
/** Tier 3: the pro submits a reference and consents; the owner approves. */
export function requestBackground(p, { refName, refPhone, consent }) {
  if (!consent) { toast('Consent is required for a background check', 'warn'); return false; }
  if (!refName || !/^\d{10}$/.test(String(refPhone || ''))) { toast('A reference name and 10-digit number, please', 'danger'); return false; }
  patchVerification(p, v => { v.background = { refName, refPhone: String(refPhone).slice(-4), status: 'pending', at: Date.now() }; return v; });
  audit.record('verify.bgRequested', { partner: p.id }, p.userKey);
  toast('Saved. Send your reference their code from the Standing screen — the check completes by itself.');
  return true;
}
export function backgroundStatus(p) { return (rec(p).background || {}).status || null; }
export function backgroundRecord(p) { return rec(p).background || null; }
export function patchBackground(p, fn) { return patchVerification(p, v => { v.background = fn({ ...(v.background || {}) }); return v; }); }

/** Tier 4 is earned by numbers, then confirmed by a human. */
export function certifiedEligible(p) {
  const rs = p.ratings || [];
  const avg = rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 0;
  return {
    jobs: (p.completed || 0) >= CERTIFIED_RULE.jobs,
    rating: avg >= CERTIFIED_RULE.rating,
    disputes: (p.disputesUpheld || 0) <= CERTIFIED_RULE.upheldDisputes,
    avg, completed: p.completed || 0,
  };
}

/** Admin: approve the next rung. Refuses to skip the automatic gate. */
export function approveTier(p, target, actor = 'admin') {
  const t = Math.max(0, Math.min(4, target | 0));
  const r = readiness(p);
  if (t >= 2 && !r.complete) { toast('This partner has not finished self-verification yet', 'warn'); return false; }
  if (t >= 3 && !r.legacy && backgroundStatus(p) !== 'pending' && backgroundStatus(p) !== 'approved') {
    toast('No background request on file for this partner', 'warn'); return false;
  }
  const patch = { tier: t };
  dispatch({ type: 'partner/patch', payload: { id: p.id, patch } });
  dispatch({ type: 'user/patch', payload: { key: p.userKey, patch: { tier: t } } });
  if (t >= 3) patchVerification(partnerById(p.id), v => { v.background = { ...(v.background || {}), status: 'approved', approvedAt: Date.now() }; return v; });
  audit.record(audit.ACTIONS.PARTNER_APPROVE, { id: p.id, tier: t }, actor);
  return true;
}

/** Pros waiting on the owner — the only queue the owner should ever see. */
export function ownerQueue() {
  const kind = p => ((p.tier | 0) === 2 && backgroundStatus(p) === 'pending') ? 'background'
                  : ((p.tier | 0) === 3 && (e => e.jobs && e.rating && e.disputes)(certifiedEligible(p))) ? 'certified' : null;
  return getState().partners
    .filter(p => readiness(p).complete && kind(p))
    .map(p => ({ ...p, queueKind: kind(p), queuedAt: kind(p) === 'background' ? (rec(p).background || {}).at || 0 : p.verifiedAt || 0 }))
    /* A background request is a person waiting on a phone call; a Certified
       candidate is a badge that can wait a week. People first, oldest first. */
    .sort((a, b) => (a.queueKind === b.queueKind ? a.queuedAt - b.queuedAt : a.queueKind === 'background' ? -1 : 1));
}

/** Which categories this partner may work, given tier and licence. */
export function categoryAllowed(p, catId) {
  const c = find('category', catId);
  if (!c) return false;
  if ((p.tier | 0) < (c.minTier || 1)) return false;
  if (c.licenceRequired && !(rec(p).licence && rec(p).licence.number)) return false;
  return true;
}
