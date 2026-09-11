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

     phone     · confirm their number, receive their code        AUTO
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
import { find } from '../core/registry.js';
import * as audit from '../core/audit.js';
import { toast } from '../ui/dom.js';
import { TIERS } from './trust.js';
import { HOLDBACK_PCT, HOLDBACK_DAYS } from './ledger.js';
import { MIN_STAKE } from './wallet.js';
import { CANCEL_RULES } from './pricing.js';
import * as M from '../core/money.js';
import { tradeBank, CONDUCT, conductFor, shuffled, score, PASS, MAX_ATTEMPTS, LOCK_MS } from './quiz.js';

/* ── the chronology ────────────────────────────────────────── */
/* Each step carries its English words AND the key that translates them. The
   domain must not import the UI, so it hands the view a key rather than a
   translated string — `ui/i18n.js` had Telugu and Hindi for all seven steps and
   nothing ever rendered them, because onboard.js printed `s.title` directly. */
export const STEPS = [
  { id: 'phone',     n: 1, k: 'ob.s1', title: 'Confirm your number',   sub: 'Type your number and collect your SAAHAA code.',       mins: 1 },
  { id: 'identity',  n: 2, k: 'ob.s2', title: 'Show us your ID',       sub: 'Aadhaar, PAN or licence. We keep only the last 4 digits.', mins: 2 },
  { id: 'selfie',    n: 3, k: 'ob.s3', title: 'One photo of you',      sub: 'For SAAHAA only — never shown to a customer.',              mins: 1 },
  { id: 'trade',     n: 4, k: 'ob.s4', title: 'Five trade questions',  sub: 'Things every real pro knows. Get 4 right.',                mins: 3 },
  { id: 'conduct',   n: 5, k: 'ob.s5', title: 'How SAAHAA works',      sub: 'Six questions on the rules. Get 5 right.',                 mins: 2 },
  { id: 'payout',    n: 6, k: 'ob.s6', title: 'Where to pay you',      sub: 'Your UPI id. You send your earnings here whenever you like.',           mins: 1 },
  { id: 'agreement', n: 7, k: 'ob.s7', title: 'Agree and go',          sub: 'One tap. You are a SAAHAA pro.',                           mins: 1 },
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
  /* READ THE PARTNER AS HE IS NOW, NOT AS SOME SCREEN LAST SAW HIM. This read
     the record off the object handed in, and a view holds the partner it
     captured when it rendered. So a handler firing against a stale snapshot
     rebuilt the whole verification record from an old copy and wrote it back:
     an audit finished all seven steps, was told "You are live", then had trade,
     conduct, payout and agreement silently vanish -- account stuck on
     "verification pending", and recovery meant re-sitting a quiz that locks for
     24 hours after three wrong attempts. His UPI went with it.
     A partial write built on current state can only ever lose the field it is
     setting; one built on a stale snapshot loses everything saved since. */
  const cur = rec(partnerById(p.id) || p);
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

/* 1 · your number, and the code that comes with it.

   THIS STEP USED TO BE A FAKE SMS: the app generated four digits, printed them
   on the screen, and asked the pro to type them back. It proved nothing — it
   only looked like the verification everyone expects. There is no SMS rail and
   there is not going to be one, so the pretence is gone.

   What the step does now is the thing that actually matters on day one: it
   confirms the number the pro will be reached on, and hands them their SAAHAA
   code. That code is permanent, it is theirs, and it is the ONLY code this
   product uses — at a customer's door, on their public page, on a receipt.
   Learning it here is why nobody ever has to receive a code later. */
export function confirmPhone(p, entered) {
  const mine = String(p.mobile || (me() || {}).mobile || '');
  const typed = String(entered == null ? '' : entered).replace(/[^\d]/g, '').slice(-10);
  if (typed.length !== 10) { toast('Type your 10-digit mobile number', 'warn'); return false; }
  if (mine && typed !== mine.replace(/[^\d]/g, '').slice(-10)) {
    toast('That is not the number this account was opened with', 'danger'); return false;
  }
  markDone(p, 'phone', { mobileLast4: typed.slice(-4) });
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
/* `lang` only changes the WORDS. `conductFor` maps options positionally and
   carries the correct index straight from the English bank, so the shuffle seed
   and every answer index are identical in all three languages — which is why
   `submitQuiz` below can score against the English bank and still be right, and
   why a translation can never silently move the correct answer. */
export function quizFor(p, kind, lang) {
  const bank = kind === 'trade' ? tradeBank(p.cat) : conductFor(lang);
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
  /* THE AGREEMENT NAMED EVERY DUTY HE TAKES ON AND NOT ONE THING SAAHAA CAN
     TAKE FROM HIM. Five terms, all obligations, signed at step 7 -- and only
     AFTERWARDS did the app mention a 10% holdback, a stake locked against a
     live job, a cancellation fee, and that the fee is "added to what you owe if
     your wallet is empty". An audit found the debt line flatly incompatible
     with the "₹0 to join, ever" and "Cost per order ₹0" it had been recruited
     on, and named it the reason it would not run a month's income through the
     platform.

     Every one of these is defensible. None of them was disclosed before he
     committed, which is the only thing that made them indefensible. They are
     terms six and seven now, in the language he reads, above the button. */
  '{pct}% of each payout waits {days} days before it reaches me, and starting a job locks {stake} out of that same job’s payout. Both come back to me when the job ends cleanly.',
  'If I cancel a job I have already started, {fee} is taken from my wallet — or added to what I owe, if my wallet is empty. SAAHAA never charges me to join, to be listed, or to be paid.',
];
/* THE FIVE PROMISES HE SIGNS, IN THE LANGUAGE HE READS.
   These are not marketing copy. Term 1 is the door code, term 2 is the rule
   that keeps his money inside the escrow that protects him, term 4 is the one
   the conduct quiz marks him on. He was asked to accept all five in English —
   a language the onboarding itself acknowledges he may not read, two screens
   earlier, in Telugu. Asking a man to agree to terms he cannot read is not
   consent, and it is the single loudest complaint on the earning side.

   The per-trade question banks in domain/quiz.js stay English for now and say
   so honestly (`ob.quizEnglish`) — a plumbing question is about plumbing. The
   rules are not; they are about what happens to his money. */
const TERMS_I18N = {
  hi: [
    'काम शुरू करने से पहले दरवाज़े पर ही ग्राहक का कोड मैं डालूँगा।',
    'SAAHAA के बाहर मैं कभी पैसा नहीं लूँगा।',
    'पैसा माँगने से पहले पूरे हुए काम की साफ़ फ़ोटो लूँगा।',
    'न आ पाऊँ तो पहले ही रद्द कर दूँगा — बिना बताए ग़ायब नहीं रहूँगा।',
    'मैं समझता हूँ कि मेरा बताया रेट ही मुझे मिलेगा, और फ़ीस ग्राहक भरता है।',
    'हर भुगतान का {pct}% सात नहीं, {days} दिन रुकता है, और काम शुरू करने पर उसी काम की कमाई से {stake} की ज़मानत रुक जाती है। काम ठीक से पूरा होने पर दोनों मुझे वापस मिल जाते हैं।',
    'शुरू किया हुआ काम अगर मैं रद्द करूँ तो मेरे वॉलेट से {fee} लिए जाएँगे — वॉलेट ख़ाली हो तो वह मेरे बकाया में जुड़ जाएगा। जुड़ने, लिस्ट होने या पैसा पाने के लिए SAAHAA मुझसे कभी कुछ नहीं लेता।',
  ],
  te: [
    'పని మొదలుపెట్టే ముందు, తలుపు దగ్గరే కస్టమర్ కోడ్‌ను నేను ఎంటర్ చేస్తాను.',
    'సాహా బయట నేను ఎప్పుడూ డబ్బు తీసుకోను.',
    'డబ్బు అడిగే ముందు, పూర్తయిన పనికి స్పష్టమైన ఫోటో తీస్తాను.',
    'రాలేకపోతే ముందుగానే రద్దు చేస్తాను — ఏమీ చెప్పకుండా మానేయను.',
    'నేను చెప్పిన రేటు ఎంతో నాకు అంతే వస్తుందని, ఫీజు కస్టమర్ కడతారని నాకు తెలుసు.',
    'ప్రతి చెల్లింపులో {pct}% {days} రోజులు ఆగి నాకు చేరుతుంది, పని మొదలుపెట్టినప్పుడు అదే పని సంపాదన నుంచి {stake} ష్యూరిటీగా ఆగుతుంది. పని సవ్యంగా ముగిస్తే రెండూ నాకు తిరిగి వస్తాయి.',
    'మొదలుపెట్టిన పనిని నేను రద్దు చేస్తే, నా వాలెట్ నుంచి {fee} తీసుకుంటారు — వాలెట్ ఖాళీగా ఉంటే నా బాకీలో కలుస్తుంది. చేరడానికి, జాబితాలో ఉండటానికి, డబ్బు అందుకోవడానికి సాహా నా దగ్గర ఎప్పుడూ ఏమీ తీసుకోదు.',
  ],
};
/** The agreement in `lang`, falling back term by term — a missing translation
    shows the English line rather than a blank promise. */
export function termsFor(lang) {
  const t = TERMS_I18N[lang];
  /* AND THE TWO TERMS THAT COST HIM MONEY HAD NO NUMBERS IN THEM. He signed
     "a tenth of each payout waits seven days" and "a fee is taken from my
     wallet" -- then met ₹100, ₹40 and 10%/7 days for the first time on a door
     screen, a cancel sheet and an Earnings tab, all AFTER he had committed. An
     audit called this the single most misleading thing in the funnel.

     The figures are read from the engine that charges them, so the terms cannot
     drift from the rules: change MIN_STAKE or the cancel fee and this sentence
     changes with it. */
  const fill = str => String(str)
    .replace('{pct}', String(HOLDBACK_PCT))
    .replace('{days}', String(HOLDBACK_DAYS))
    .replace('{stake}', M.fmt(MIN_STAKE))
    .replace('{fee}', M.fmt((CANCEL_RULES.WORKER_CANCEL || {}).workerFee || 0));
  return TERMS.map((en, i) => fill((t && t[i]) || en));
}

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
