/* SAAHAA · domain/payments.js — the manual UPI rail, until volume earns a PSP.

   WHY MANUAL FIRST. A payment aggregator licence, a nodal account and a
   settlement integration are months and a company. A UPI ID and a human reading
   a bank statement are today. This module is the honest version of that: the
   customer pays SAAHAA's UPI directly, types the UTR their own bank gave them,
   and two different people confirm it before anybody is paid.

   THE TWO CHECKS, AND WHY THERE ARE TWO.
     1. THE PRO checks first. He is standing there; he can see her phone showing
        "paid ₹416 to saahaa@ptyes". His check is what lets the job start — it
        costs SAAHAA nothing and it is the check that happens in seconds.
     2. THE ADMIN checks second, against the actual bank statement. That is the
        one that moves money: escrow is funded only here, and payouts are drawn
        only from admin-cleared payments.

   So a pro may begin work on a claim, and is settled the next morning on a
   fact. That gap is deliberate and it is the whole risk of running manually —
   it is bounded by one job, it is visible on his screen, and it is the reason
   the settlement batch runs after the statement is read, not before.

   WHAT A UTR IS. The 12-digit reference NPCI puts on a UPI transaction; every
   bank app shows it. It is not a secret and it is not proof on its own — two
   customers can type the same one, honestly or otherwise — so this module
   treats a UTR as a CLAIM until cleared, and refuses to let one be claimed
   twice. That refusal is the single most important line here.

   NOTHING IN THIS FILE TOUCHES THE LEDGER. It records claims and decisions;
   domain/flow.js posts the legs when a claim becomes a fact. A claim that could
   write to the ledger would be a way to mint money by typing. */

import { getState, dispatch, me } from '../core/ctx.js';
import { nid } from '../core/id.js';
import * as audit from '../core/audit.js';
import * as M from '../core/money.js';

/** Where customers pay. One ID, printed on the screen, never guessed. */
export const PAYEE_UPI = 'saahaa@ptyes';

/** NPCI's reference: exactly 12 digits. Nothing else is a UTR. */
export const UTR_RE = /^\d{12}$/;

export const STATES = ['AWAITING_UTR', 'CLAIMED', 'PRO_CHECKED', 'CLEARED', 'REJECTED'];

/* A pro may start work here; money may move only at CLEARED. */
export const CAN_START_WORK = new Set(['PRO_CHECKED', 'CLEARED']);
export const IS_SETTLED_FUNDS = new Set(['CLEARED']);

/** The short code the customer puts in the UPI note, so a human can match it
    to a row in a statement that carries no order id of its own. */
export const refFor = orderId => 'SA' + String(orderId || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();

export const paymentsOf = orderId => (getState().payments || []).filter(p => p.orderId === orderId);
export const paymentFor = orderId =>
  paymentsOf(orderId).find(p => p.state !== 'REJECTED') || null;
export const byUtr = utr => (getState().payments || []).find(p => p.utr === utr && p.state !== 'REJECTED') || null;

/** What a customer is told to do, with everything a payment needs in one place. */
export function instruction(order) {
  const paise = order ? (order.customerPays | 0) : 0;
  return {
    upi: PAYEE_UPI,
    amount: paise,
    amountText: M.fmt2(paise),
    reference: refFor(order && order.id),
    /* the deep link every Indian UPI app understands; `tn` is the note the
       admin reads in the statement, `am` is in rupees with two decimals */
    link: `upi://pay?pa=${encodeURIComponent(PAYEE_UPI)}&pn=SAAHAA`
        + `&am=${(paise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(refFor(order && order.id))}`,
  };
}

/** The customer says "I have paid, here is the UTR". A claim, not a payment. */
export function claimUtr(orderId, utrRaw) {
  const utr = String(utrRaw || '').replace(/\s+/g, '');
  const order = (getState().orders || []).find(o => o.id === orderId);
  if (!order) return { ok: false, reason: 'no such order' };
  if (!UTR_RE.test(utr)) {
    return { ok: false, reason: 'A UTR is the 12-digit number your bank app shows for the payment.' };
  }
  /* THE LINE THAT MATTERS. A UTR names one real transfer. If it is already
     against another order then either somebody mistyped or somebody is paying
     once and claiming twice, and both must stop here rather than at the bank
     statement three days later. */
  const clash = byUtr(utr);
  if (clash && clash.orderId !== orderId) {
    return { ok: false, reason: 'That UTR is already recorded against another order. Check the number.' };
  }
  const existing = paymentFor(orderId);
  if (existing && existing.state === 'CLEARED') return { ok: false, reason: 'This order is already paid.' };

  const row = existing ? { ...existing } : {
    id: nid('pay'), orderId, createdAt: Date.now(),
    expected: order.customerPays | 0, reference: refFor(orderId), payee: PAYEE_UPI,
  };
  row.utr = utr;
  row.state = 'CLAIMED';
  row.claimedAt = Date.now();
  row.claimedBy = (me() && me().key) || order.customerKey || '';
  dispatch({ type: existing ? 'payment/patch' : 'payment/add', payload: existing ? { id: row.id, patch: row } : row });
  audit.record('payment.claimed', { orderId, utr, paise: row.expected }, row.claimedBy);
  return { ok: true, payment: row };
}

/** The pro's check: he has seen her screen. Lets the job start, moves no money. */
export function proCheck(orderId, ok, note = '') {
  const p = paymentFor(orderId);
  if (!p) return { ok: false, reason: 'nothing claimed yet' };
  if (p.state !== 'CLAIMED') return { ok: false, reason: 'already past this step' };
  const who = (me() && me().key) || 'pro';
  const patch = ok
    ? { state: 'PRO_CHECKED', proCheckedAt: Date.now(), proCheckedBy: who, proNote: note }
    : { state: 'REJECTED', rejectedAt: Date.now(), rejectedBy: who, rejectReason: note || 'the pro could not see the payment' };
  dispatch({ type: 'payment/patch', payload: { id: p.id, patch } });
  audit.record(ok ? 'payment.proChecked' : 'payment.proRejected', { orderId, utr: p.utr }, who);
  return { ok: true, payment: { ...p, ...patch } };
}

/** The admin's check, against the bank statement. THIS is what funds escrow.
    The caller posts the ledger legs; this records the decision and the amount
    the statement actually showed, which is not always what was expected. */
export function adminClear(orderId, { ok = true, seenPaise = null, note = '' } = {}) {
  const p = paymentFor(orderId);
  if (!p) return { ok: false, reason: 'nothing claimed yet' };
  if (p.state === 'CLEARED') return { ok: false, reason: 'already cleared' };
  const who = (me() && me().key) || 'admin';
  if (!ok) {
    const patch = { state: 'REJECTED', rejectedAt: Date.now(), rejectedBy: who, rejectReason: note || 'not found in the statement' };
    dispatch({ type: 'payment/patch', payload: { id: p.id, patch } });
    audit.record('payment.adminRejected', { orderId, utr: p.utr, note }, who);
    return { ok: true, payment: { ...p, ...patch } };
  }
  /* A SHORT PAYMENT IS NOT A PAID ORDER. The statement is the fact; if it shows
     less than the bill, the difference is recorded and the order stays unpaid
     rather than quietly becoming paid for the smaller number. */
  const seen = seenPaise == null ? (p.expected | 0) : (seenPaise | 0);
  const short = (p.expected | 0) - seen;
  const patch = {
    state: 'CLEARED', clearedAt: Date.now(), clearedBy: who,
    seen, shortBy: short > 0 ? short : 0, adminNote: note,
  };
  dispatch({ type: 'payment/patch', payload: { id: p.id, patch } });
  audit.record('payment.cleared', { orderId, utr: p.utr, seen, short }, who);
  return { ok: true, payment: { ...p, ...patch }, short: short > 0 ? short : 0 };
}

/** Everything a human has to look at, oldest first — the admin's morning list. */
export const queue = (state = 'PRO_CHECKED') =>
  (getState().payments || []).filter(p => p.state === state).sort((a, b) => a.claimedAt - b.claimedAt);

/** What the pro is owed once the statement is read. Settlement runs on this. */
export const clearedFor = orderId => {
  const p = paymentFor(orderId);
  return p && p.state === 'CLEARED' ? p : null;
};
