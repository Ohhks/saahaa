/* SAAHAA · domain/flow.js — the use-cases. Views call these; they never
   dispatch raw actions themselves, so every money movement and every state
   transition goes through one auditable place. */

import { ctx, getState, dispatch, me, myArea } from '../core/ctx.js';
import { nid, otp as makeOtp } from '../core/id.js';
import { appendBlock } from '../core/crypto.js';
import * as audit from '../core/audit.js';
import * as M from '../core/money.js';
import { find } from '../core/registry.js';
import { applyTransition, canTransition } from './orders.js';
import { acct, holdbackFor, balanceOf } from './ledger.js';
import * as gateway from '../core/gateway.js';
import * as W from './wallet.js';
import * as photos from '../core/photos.js';
import { quoteService, quoteRetail, compareWithApps, releaseService, cancelSplit } from './pricing.js';
import { lockedMatch, rankShops, kmBetween, etaMins } from './match.js';
import { escrowTier, markupFor, trustScore } from './trust.js';
import { toast } from '../ui/dom.js';

/* ── ledger (double-entry, hash-chained) ───────────────────── */
/* Serialised. The chain head used to be read BEFORE `await digest(...)`, so
   two overlapping calls both claimed the same blockIdx and prevHash, and the
   admin's "Verify chain" then reported the book tampered. A double-tap on
   Confirm was enough to cause it. */
let ledgerQ = Promise.resolve();
function ledger(kind, amountPaise, partyA, partyB, meta = {}) {
  ledgerQ = ledgerQ.then(async () => {
    const rec = { id: nid('led'), kind, amountPaise, partyA, partyB, ts: Date.now(), meta };
    const block = await appendBlock(getState().chain, rec);   // read AFTER the await
    dispatch({ type: 'ledger/append', payload: block });
    return block;
  }).catch(err => { console.error('[ledger]', err); });
  return ledgerQ;
}
/** The same posting queue, for modules that own money moves of their own (treasury). */
export const postLedger = ledger;

/* ── the customer's wallet ──────────────────────────────────────
   EVERYONE PAYS SAAHAA. A customer's money lands in CUSTOMER:<key> first —
   through the gateway — and only then moves into an order's escrow. A refund
   comes back to the same account, so it is money the customer can spend on
   the next order or take out. Nothing is ever paid to a worker directly. */
export function customerWallet(key = me() && me().key) {
  if (!key) return { balance: 0, key: null };
  return { balance: Math.max(0, balanceOf(getState().ledger, acct.customer(key))), key };
}
/** Fund a payment: wallet first, the shortfall collected through the gateway. */
async function fund(key, paise, purpose, meta = {}) {
  const have = customerWallet(key).balance;
  const short = Math.max(0, paise - have);
  if (short) {
    const r = await gateway.collect({ paise: short, purpose, key });
    if (!r.ok) throw new Error('payment failed: ' + (r.reason || 'gateway'));
    await ledger('PAYMENT_IN', short, acct.world(), acct.customer(key), { via: r.via, ref: r.ref, ...meta });
  }
  return { fromWallet: paise - short, collected: short };
}
export async function customerTopUp(paise) {
  const s = me(); if (!s) return null;
  const amt = M.int(paise);
  if (amt < 1000) { toast('Minimum top-up is ₹10', 'warn'); return null; }
  const r = await gateway.collect({ paise: amt, purpose: 'topup', key: s.key });
  if (!r.ok) { toast('Payment did not go through', 'danger'); return null; }
  await ledger('TOPUP', amt, acct.world(), acct.customer(s.key), { via: r.via, ref: r.ref });
  audit.record('cwallet.topup', { amt }, s.key);
  toast(`${M.fmt(amt)} added to your wallet`);
  return amt;
}
export async function customerWithdraw(paise) {
  const s = me(); if (!s) return null;
  const amt = M.int(paise), w = customerWallet(s.key);
  if (amt < 1000) { toast('The smallest take-out is ₹10', 'warn'); return null; }
  if (amt > w.balance) { toast(`You can take out up to ${M.fmt(w.balance)}`, 'warn'); return null; }
  const r = await gateway.payout({ paise: amt, purpose: 'refund-out', key: s.key, upi: s.upi || (getState().users.find(u => u.key === s.key) || {}).upi || '' });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.customer(s.key), acct.world(), { via: r.via, ref: r.ref });
  audit.record('cwallet.withdraw', { amt }, s.key);
  toast(`${M.fmt(amt)} sent to your UPI`);
  return amt;
}

/* ── SERVICE: the 3-tap booking ────────────────────────────── */
export function findMatch(catId, opts = {}) {
  const st = getState();
  const cat = find('category', catId);
  const deal = opts.deal || (cat && cat.base) || 50000;
  return lockedMatch(st.partners, { catId, area: opts.area || myArea(), dealPaise: deal });
}

export function previewBooking(catId, partner, sub) {
  const cat = find('category', catId);
  const deal = partner ? partner.ask : (cat && cat.base) || 50000;
  const q = quoteService(deal, { markup: markupFor(partner || {}) });
  const cmp = compareWithApps(deal);
  return { cat, partner, sub, deal, quote: q, compare: cmp };
}

export async function bookService({ catId, partner, sub, deal, slot }) {
  const s = me();
  if (!s) throw new Error('Please sign in first');
  const cat = find('category', catId);
  const price = deal ?? partner.ask;
  const q = quoteService(price, { markup: markupFor(partner) });
  const km = kmBetween(s.area, partner.area);
  const now = Date.now();

  const order = {
    id: nid('ord'), kind: 'service', catId, sub: sub || null,
    customerKey: s.key, customerName: s.name, customerArea: s.area, customerLoc: s.loc || null,
    partnerId: partner.id, partnerName: partner.name, partnerArea: partner.area,
    km, eta: etaMins(km),
    deal: q.deal, customerPays: q.customerPays, platformFee: q.platformFee, gst: q.gst,
    saved: compareWithApps(price).saved,
    slot: slot || 'now',
    stage: 'MATCHING', stageTs: now, createdAt: now,
    history: [{ stage: 'DRAFT', at: now }, { stage: 'MATCHING', at: now }],
    /* THE DOOR CODE IS THE CUSTOMER'S OWN SAAHAA CODE — not a per-job number.
       Nothing is generated, delivered or expires; there is no SMS rail to need.
       She already knows it, it is the same every job, and the pro typing it is
       proof he is standing in front of her. The FIELD NAME does not change, so
       jobs booked before this release keep their old number and still work. */
    otp: String(s.code || '') || makeOtp(), otpVerified: false, evidence: [], escrowed: q.customerPays,
  };
  dispatch({ type: 'order/add', payload: order });
  // the customer's money is in their SAAHAA wallet first (wallet balance, then the gateway for the rest); only then is it locked
  const paid = await fund(s.key, q.customerPays, 'service', { orderId: order.id });
  dispatch({ type: 'order/patch', payload: { id: order.id, patch: { paidFromWallet: paid.fromWallet, collected: paid.collected } } });
  await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id,
               { catId, deal: q.deal, fee: q.platformFee, gst: q.gst });
  bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  audit.record('booking.created', { id: order.id, catId, deal: q.deal }, s.key);

  // The hero card is a pro who has ALREADY accepted, so the demo mirrors
  // reality: acceptance lands in a moment, not never.
  setTimeout(() => advance(order.id, 'ASSIGNED', {}), 900);
  return order;
}

/* ── stage machine driver ──────────────────────────────────── */
export function advance(orderId, toStage, patch = {}) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (!canTransition(o.stage, toStage)) { toast(`Cannot go ${o.stage} → ${toStage}`, 'danger'); return null; }
  const next = applyTransition(o, toStage, patch);
  dispatch({ type: 'order/replace', payload: { id: orderId, order: next } });
  ctx.render();
  return next;
}

/* Typed by a person standing on a doorstep, so it is read forgivingly: case,
   spaces and hyphens are noise, not a wrong answer. Exported because this one
   comparison is now the whole door check — it is worth pinning down in a test
   rather than trusting by eye. */
const tidyCode = v => String(v == null ? '' : v).replace(/[\s-]/g, '').toUpperCase();
export const sameCode = (a, b) => {
  const x = tidyCode(a);
  /* Nothing matches nothing. Without this an order that somehow carried no code
     would be opened by an empty field — the test that found it is in
     core/selftests.doorcode.js. */
  return x !== '' && x === tidyCode(b);
};

export function verifyOtp(orderId, entered) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return false;
  if (!sameCode(entered, o.otp)) {
    const fails = (o.otpFails || 0) + 1;
    dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpFails: fails } } });
    audit.record('otp.failed', { id: orderId, fails });
    toast(fails >= 3 ? 'Too many wrong codes — this job is now flagged' : 'Wrong code', 'danger');
    if (fails >= 3) advance(orderId, 'DISPUTED', { disputed: true, disputeReason: 'otp_fail' });
    return false;
  }
  audit.record('otp.verified', { id: orderId });
  advance(orderId, 'IN_PROGRESS', { otpVerified: true, startedAt: Date.now() });
  lockStake(orderId);
  toast('Verified — work started');
  return true;
}

export function addEvidence(orderId, label, photo = null) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const ev = (o.evidence || []).concat([{ id: nid('ev'), label, photo: photo || null, ts: Date.now() }]);
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { evidence: ev } } });
  toast(photo ? `${label} photo attached` : `${label} noted`);
  ctx.render();
}

/* ── pictures ──────────────────────────────────────────────────
   A record keeps the picture's ID; the bytes live in core/photos.js, outside
   the state blob. Replacing a picture frees the one it replaces, so a shop
   that re-photographs its front ten times does not spend ten pictures' worth
   of a device's budget. */
function swapPhoto(oldId, newId) { if (oldId && oldId !== newId) photos.remove(oldId); }

export function setShopPhoto(shopId, photoId) {
  const s = getState().shops.find(x => x.id === shopId); if (!s) return false;
  swapPhoto(s.photo, photoId);
  dispatch({ type: 'shop/patch', payload: { id: shopId, patch: { photo: photoId || null } } });
  audit.record('shop.photo', { shopId }, me() ? me().key : 'system');
  ctx.render(); return true;
}
export function setProductPhoto(productId, photoId) {
  const p = getState().products.find(x => x.id === productId); if (!p) return false;
  swapPhoto(p.photo, photoId);
  dispatch({ type: 'product/patch', payload: { id: productId, patch: { photo: photoId || null } } });
  ctx.render(); return true;
}
/* THE VERIFICATION SELFIE IS NOT THE PUBLIC PORTRAIT.
   They were one field. The ladder asked for a picture to prove who somebody is
   — "this is what the customer sees at the door" — and it was then published on
   their public page to anyone browsing, while the privacy policy promised a
   customer never sees a pro's selfie. One photograph, two purposes, and the
   person photographed was told only about the first.

   `selfie` proves identity and stays private. `photo` is the face a pro
   chooses to trade under. A pro may use the same picture for both, but only by
   saying so. */
export function setPartnerSelfie(partnerId, photoId) {
  const p = getState().partners.find(x => x.id === partnerId); if (!p) return false;
  if (p.selfie && p.selfie !== photoId && p.selfie !== p.photo) photos.remove(p.selfie);
  dispatch({ type: 'partner/patch', payload: { id: partnerId, patch: { selfie: photoId || null } } });
  ctx.render(); return true;
}

export function setPartnerPhoto(partnerId, photoId) {
  const p = getState().partners.find(x => x.id === partnerId); if (!p) return false;
  if (p.photo !== p.selfie) swapPhoto(p.photo, photoId);   // shared with the selfie? keep the bytes
  dispatch({ type: 'partner/patch', payload: { id: partnerId, patch: { photo: photoId || null } } });
  ctx.render(); return true;
}
/** A pro's work gallery. Capped, because a budget shared with everything else
    is not somewhere to put forty photographs of the same fan. */
export const MAX_WORK_PHOTOS = 8;
export function addWorkPhoto(partnerId, photoId) {
  const p = getState().partners.find(x => x.id === partnerId); if (!p || !photoId) return false;
  const work = (p.work || []).slice();
  if (work.length >= MAX_WORK_PHOTOS) {
    toast(`Your page holds ${MAX_WORK_PHOTOS} photos — remove one to add another`, 'warn');
    photos.remove(photoId); return false;
  }
  work.push(photoId);
  dispatch({ type: 'partner/patch', payload: { id: partnerId, patch: { work } } });
  ctx.render(); return true;
}
export function removeWorkPhoto(partnerId, photoId) {
  const p = getState().partners.find(x => x.id === partnerId); if (!p) return false;
  dispatch({ type: 'partner/patch', payload: { id: partnerId, patch: { work: (p.work || []).filter(x => x !== photoId) } } });
  photos.remove(photoId);
  ctx.render(); return true;
}
/** Pictures nothing points at any more stop costing the device anything. */
export function sweepPhotos() { return photos.gc(photos.referenced(getState())); }

/** Worker marks done. No photo -> never auto-release (V4: the single highest
    value anti-fraud rule in the system). */
export function markDone(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  if (!o.evidence || !o.evidence.length) { toast('Attach at least one photo of the finished work', 'warn'); return; }
  const st = getState();
  const partner = st.partners.find(p => p.id === o.partnerId) || {};
  const tierInfo = escrowTier({ ...o, stage: 'WORK_DONE' }, partner);
  advance(orderId, 'WORK_DONE', { escrowTier: tierInfo.id, releaseAt: Date.now() + (isFinite(tierInfo.holdMs) ? tierInfo.holdMs : 0) });
  toast(tierInfo.id === 'HOLD' ? 'Sent for team review' : `Done — ${tierInfo.label.toLowerCase()}`);
}

/** Customer taps Confirm — the second factor without typing a second code. */
/* ── the commitment stake ──────────────────────────────────────
   Locked the moment the customer's code is entered, returned in full the
   moment the customer confirms the work. See domain/wallet.js. */
export function lockStake(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.kind !== 'service' || o.stake) return null;
  const p = getState().partners.find(x => x.id === o.partnerId);
  if (!p) return null;
  const need = W.stakeFor(o.deal);
  const w = W.walletOf(getState().ledger, p.id, p);
  const f = W.fundStake(need, w.available);
  if (f.funded) ledger('STAKE_LOCK', f.funded, acct.partner(p.id), W.stakeAcct(p.id), { orderId });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { stake: { need, funded: f.funded, onCredit: f.onCredit, lockedAt: Date.now() } } } });
  audit.record('stake.locked', { id: orderId, need, funded: f.funded, onCredit: f.onCredit }, p.userKey);
  return f;
}
/** Finished and confirmed: the whole locked amount goes back. */
async function returnStake(o) {
  if (!o.stake || o.stake.returned || o.stake.forfeited) return 0;
  if (o.stake.funded) await ledger('STAKE_RELEASE', o.stake.funded, W.stakeAcct(o.partnerId), acct.partner(o.partnerId), { orderId: o.id });
  dispatch({ type: 'order/patch', payload: { id: o.id, patch: { stake: { ...o.stake, returned: true, returnedAt: Date.now() } } } });
  return o.stake.funded;
}
/** Walked out after starting: the stake goes to the customer as goodwill
    credit; the part that was on credit becomes a debt against the next payout. */
async function forfeitStake(o, reason) {
  if (!o.stake || o.stake.returned || o.stake.forfeited) return 0;
  if (o.stake.funded) await ledger('STAKE_FORFEIT', o.stake.funded, W.stakeAcct(o.partnerId), acct.customer(o.customerKey), { orderId: o.id, reason });
  const p = getState().partners.find(x => x.id === o.partnerId);
  if (p && o.stake.onCredit) dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { walletDebt: (p.walletDebt | 0) + o.stake.onCredit } } });
  dispatch({ type: 'order/patch', payload: { id: o.id, patch: { stake: { ...o.stake, forfeited: true, forfeitedAt: Date.now(), reason } } } });
  audit.record('stake.forfeited', { id: o.id, funded: o.stake.funded, onCredit: o.stake.onCredit, reason }, 'system');
  return o.stake.need;
}
/** Wallet: top up (UPI in production; simulated here) and withdraw to UPI. */
export async function walletTopUp(partnerId, paise) {
  const amt = M.int(paise);
  if (amt < 1000) { toast('Minimum top-up is ₹10', 'warn'); return null; }
  const r = await gateway.collect({ paise: amt, purpose: 'stake-topup', key: partnerId });
  if (!r.ok) { toast('Payment did not go through', 'danger'); return null; }
  await ledger('TOPUP', amt, acct.world(), acct.partner(partnerId), { via: r.via, ref: r.ref });
  audit.record('wallet.topup', { partnerId, amt }, me() ? me().key : 'system');
  toast(`${M.fmt(amt)} added to your wallet`);
  return amt;
}
export async function walletWithdraw(partnerId, paise) {
  const amt = M.int(paise);
  const w = W.walletOf(getState().ledger, partnerId, getState().partners.find(x => x.id === partnerId) || {});
  if (amt < 1000 || amt > w.available) { toast(`You can withdraw up to ${M.fmt(w.available)}`, 'warn'); return null; }
  const pUpi = ((getState().partners.find(x => x.id === partnerId) || {}).verification || {}).upi || '';
  const r = await gateway.payout({ paise: amt, purpose: 'earnings', key: partnerId, upi: pUpi });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.partner(partnerId), acct.world(), { via: r.via, ref: r.ref });
  audit.record('wallet.withdraw', { partnerId, amt }, me() ? me().key : 'system');
  toast(`${M.fmt(amt)} sent to your UPI`);
  return amt;
}
/** The 7-day holdback comes back by itself. Runs at boot and on the order screen. */
export async function sweepHoldbacks(now = Date.now()) {
  const due = W.holdbackDue(getState().ledger, now);
  for (const e of due) await ledger('HOLDBACK_RELEASE', e.amountPaise, e.partyB, e.partyA, { of: e.id });
  return due.length;
}

export async function confirmAndRelease(orderId, pct = 1) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  if (o.kind !== 'service') { toast('That is a shop order — settle it from the order screen.', 'warn'); return; }
  // Must use the markup this order was ESCROWED at. markupFor({}) always
  // returned 10%, so a Tier-4 job (escrowed at 6%) released 4% MORE than was
  // ever locked, quietly draining other orders' money out of escrow.
  const partner0 = getState().partners.find(p => p.id === o.partnerId) || {};
  const r = releaseService(o.deal, pct, { markup: markupFor(partner0) });

  // THE GUARD. advance() returns null on an illegal transition, and this used
  // to ignore it and post to the ledger regardless — so a double-tap on
  // "Confirm & release" paid the pro twice and double-counted every total.
  /* A full refund landed the order in PARTIAL ("Partly released") and posted
     a zero-value ESCROW_RELEASE block. The money was right; the record was a
     lie, and REFUNDED existed the whole time with no caller. */
  const endStage = pct >= 1 ? 'SETTLED' : pct <= 0 ? 'REFUNDED' : 'PARTIAL';
  const moved = advance(orderId, endStage, {
    releasedPct: pct, workerPayout: r.workerPayout, refund: r.refund,
    platformFee: r.platformFee, gst: r.gst, settledAt: Date.now(),
  });
  if (!moved) return;

  if (r.workerPayout) await ledger('ESCROW_RELEASE', r.workerPayout, acct.escrow(o.id), acct.partner(o.partnerId), { pct });
  /* THE PROMISE: on a finished job the worker receives the whole locked stake
     back and the whole of their quote; on a fully upheld dispute (nothing
     released) the stake goes to the customer instead. */
  if (pct > 0) await returnStake(getState().orders.find(x => x.id === orderId));
  else await forfeitStake(getState().orders.find(x => x.id === orderId), 'dispute upheld');
  if (r.workerPayout) {
    const p0 = getState().partners.find(x => x.id === o.partnerId) || {};
    // a debt from a walked-out job is recovered from the next payout, once
    const debt = Math.min(p0.walletDebt | 0, r.workerPayout);
    if (debt) { await ledger('DEBT_RECOVERY', debt, acct.partner(o.partnerId), acct.goodwill(), { orderId }); dispatch({ type: 'partner/patch', payload: { id: o.partnerId, patch: { walletDebt: (p0.walletDebt | 0) - debt } } }); }
    // the ledger's holdback policy, posted for real: 10% of a payout, capped at Rs.500 cumulative, back after 7 days
    const held = W.walletOf(getState().ledger, o.partnerId, p0).pending;
    const hb = holdbackFor(r.workerPayout - debt, held);
    if (hb) await ledger('HOLDBACK', hb, acct.partner(o.partnerId), acct.holdback(o.partnerId), { orderId });
  }
  if (r.platformFee) await ledger('FEE', r.platformFee, acct.escrow(o.id), acct.fee(), {});
  if (r.gst)         await ledger('GST', r.gst, acct.escrow(o.id), acct.gst(), {});
  if (r.refund)      await ledger('REFUND', r.refund, acct.escrow(o.id), acct.customer(o.customerKey), {});

  const a = getState().agg;
  bumpAgg({
    serviceOrders: a.serviceOrders + (pct > 0 ? 1 : 0),
    gmv: a.gmv + r.workerPayout,
    revenue: a.revenue + r.platformFee,
    gst: a.gst + r.gst,
    refunds: a.refunds + r.refund,
    escrow: Math.max(0, a.escrow - (o.customerPays | 0)),
    saved: a.saved + (o.saved || 0),
  });
  // Losing a dispute used to RAISE the pro's trust score, because this ran
  // unconditionally — including on the admin's full-refund path.
  const p = getState().partners.find(x => x.id === o.partnerId);
  /* `completed` is what the profile shows; `countedJobs` is what the ladder
     and the provisional cap use, and it only moves for a job with a code
     check-in AND a work photo. A friend booking and releasing without ever
     opening the door is a display number, not a credential. */
  const real = !!o.otpVerified && (o.evidence || []).length > 0;
  if (p && pct > 0) dispatch({ type: 'partner/patch', payload: { id: p.id, patch: {
    completed: (p.completed || 0) + 1, starts: (p.starts || 0) + 1,
    countedJobs: (p.countedJobs || 0) + (real ? 1 : 0),
    onTimeStarts: (p.onTimeStarts || 0) + 1, lastActiveTs: Date.now() } } });
  else if (p) dispatch({ type: 'partner/patch', payload: { id: p.id, patch: {
    disputesUpheld: (p.disputesUpheld || 0) + 1 } } });

  /* Releasing escrow on a disputed order left the dispute OPEN, and its three
     Resolve buttons then all failed on an illegal transition — while
     dispute/resolve had ALREADY marked it resolved. Close it here, where the
     money actually moved. */
  const open = getState().disputes.find(d => d.orderId === o.id && !d.resolvedAt);
  // status must flip too: the admin's Disputes list filters on status === 'OPEN',
  // so a dispute closed by the money moving was still shown as open
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id,
    patch: { status: 'RESOLVED', outcome: pct >= 1 ? 'released' : pct <= 0 ? 'refund' : 'partial', resolvedBy: 'release' } } });

  audit.record(pct >= 1 ? audit.ACTIONS.ESCROW_RELEASE : audit.ACTIONS.ESCROW_PARTIAL,
               { id: o.id, amount: r.workerPayout, refund: r.refund, pct }, me() ? me().key : 'admin');
  toast(pct >= 1 ? `${M.fmt(r.workerPayout)} released to ${o.partnerName}` : `Partial — ${M.fmt(r.refund)} refunded`);
}

export async function cancelOrder(orderId, ruleId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const pc = getState().partners.find(p => p.id === o.partnerId) || {};
  const split = cancelSplit(o.deal, ruleId, { markup: markupFor(pc) });
  if (!advance(orderId, 'CANCELLED', { cancelRule: ruleId, refund: split.refund, cancelledAt: Date.now() })) return;
  if ((ruleId === 'WORKER_CANCEL' || ruleId === 'WORKER_NO_SHOW') && o.stake) await forfeitStake(o, ruleId);
  else if (o.stake) await returnStake(o);          // the customer cancelled after work began — not the worker's fault
  if (split.refund) await ledger('REFUND', split.refund, acct.escrow(o.id), acct.customer(o.customerKey), { ruleId });
  if (split.worker) await ledger('COMPENSATION', split.worker, acct.escrow(o.id), acct.partner(o.partnerId), { ruleId });
  // The rule promised "full refund + Rs.100 credit" and the toast said so, but
  // the credit was computed and then thrown away — the customer never got it.
  if (split.credit) await ledger('GOODWILL', split.credit, acct.goodwill(), acct.customer(o.customerKey), { ruleId });
  const a = getState().agg;
  bumpAgg({ escrow: Math.max(0, a.escrow - (o.customerPays | 0)), refunds: a.refunds + split.refund });
  audit.record('booking.cancelled', { id: o.id, ruleId, refund: split.refund }, me() ? me().key : 'system');
  toast(split.label);
}

/* ── DISPUTE: 3 taps to raise ──────────────────────────────── */
export const DISPUTE_REASONS = ['Not done', 'Partly done', 'Damage', 'Late / No-show',
                                'Overcharged', 'Rude or unsafe', 'Wrong person came'];
export function raiseDispute(orderId, reason, note) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const d = { id: nid('dsp'), orderId, reason, note: note || '', by: me() && me().key,
              openedAt: Date.now(), status: 'OPEN', amount: o.customerPays };
  dispatch({ type: 'dispute/open', payload: d });
  if (canTransition(o.stage, 'DISPUTED')) advance(orderId, 'DISPUTED', { disputed: true, disputeReason: reason });
  audit.record('dispute.opened', { id: d.id, orderId, reason }, me() && me().key);
  toast('Reported. Your money is frozen until this is settled.');
  return d;
}

/* ── RETAIL: cart + checkout ───────────────────────────────── */
export function getCart() {
  const s = me(); if (!s) return null;
  return getState().carts[s.key] || null;
}
/** One shop per cart, enforced (V2-B4, confidence 5). */
export function addToCart(product, qty = 1) {
  const s = me();
  if (!s) { toast('Sign in to start a cart'); return { needsAuth: true }; }
  /* The shop's Close switch flipped a badge and nothing else: closed shops
     still ranked, their products still showed an Add button, and checkout
     never looked. Customers could order from a shop that was shut. */
  const shop0 = getState().shops.find(x => x.id === product.shopId);
  if (shop0 && shop0.isOpen === false) {
    toast(`${shop0.name} is closed right now`, 'warn');
    return { closed: true };
  }
  const cart = getCart();
  if (cart && cart.shopId !== product.shopId && cart.lines.length) {
    return { conflict: true, currentShopId: cart.shopId, product, qty };
  }
  const lines = (cart && cart.shopId === product.shopId ? cart.lines : []).slice();
  const i = lines.findIndex(l => l.productId === product.id);
  if (i >= 0) lines[i] = { ...lines[i], qty: lines[i].qty + qty };
  else lines.push({
    lineId: nid('ln'), productId: product.id, shopId: product.shopId,
    name: product.name, unit: product.unit, unitPrice: product.price, mrp: product.mrp,
    qty, variableWeight: product.variableWeight, subPolicy: product.subPolicyDefault || 'call',
    rxRequired: product.rxRequired, addedAt: Date.now(),
  });
  dispatch({ type: 'cart/set', payload: { key: s.key, cart: { shopId: product.shopId, lines } } });
  return { ok: true, count: lines.reduce((n, l) => n + l.qty, 0) };
}
export function setLineQty(lineId, qty) {
  const s = me(); const cart = getCart(); if (!cart) return;
  const lines = cart.lines.map(l => l.lineId === lineId ? { ...l, qty } : l).filter(l => l.qty > 0);
  if (!lines.length) dispatch({ type: 'cart/clear', payload: { key: s.key } });
  else dispatch({ type: 'cart/set', payload: { key: s.key, cart: { ...cart, lines } } });
}
export function setLineSubPolicy(lineId, policy) {
  const s = me(); const cart = getCart(); if (!cart) return;
  const lines = cart.lines.map(l => l.lineId === lineId ? { ...l, subPolicy: policy } : l);
  dispatch({ type: 'cart/set', payload: { key: s.key, cart: { ...cart, lines } } });
}
export function clearCart() { const s = me(); if (s) dispatch({ type: 'cart/clear', payload: { key: s.key } }); }

export function cartQuote(mode = 'rider') {
  const cart = getCart(); if (!cart) return null;
  const shop = getState().shops.find(s => s.id === cart.shopId);
  if (!shop) return null;
  const km = kmBetween(myArea(), shop.area);
  const first = (shop.ordersCompleted || 0) < 30;
  return { shop, km, ...quoteRetail(cart.lines, { catId: shop.catId, km, mode, firstOrders: first,
                                                  freeDeliveryAbove: shop.freeDeliveryAbove }) };
}

export async function placeRetailOrder(mode = 'rider') {
  const s = me(); if (!s) throw new Error('Please sign in first');
  const c0 = getCart();
  const sh0 = c0 && getState().shops.find(x => x.id === c0.shopId);
  if (sh0 && sh0.isOpen === false) { toast(`${sh0.name} closed before you checked out`, 'warn'); return null; }
  // the "Min Rs.149" printed on every shop card was never enforced
  const q0 = cartQuote(mode);
  if (q0 && sh0 && sh0.minOrder && q0.itemsTotal < sh0.minOrder) {
    toast(`${sh0.name} needs a minimum order of ${M.fmt(sh0.minOrder)}`, 'warn'); return null;
  }
  // a shop set to "pickup only" was still receiving rider orders
  // the shop's setting is 'pickup_only' — the console writes that key, not 'pickup'
  if (sh0 && sh0.deliveryMode === 'pickup_only' && mode !== 'pickup') { toast('This shop is pickup only', 'warn'); return null; }
  if (sh0 && sh0.deliveryMode === 'self' && mode === 'rider') mode = 'self';
  const cart = getCart(); const q = cartQuote(mode);
  if (!cart || !q) return null;
  const now = Date.now();
  const order = {
    id: nid('ord'), kind: 'retail', catId: q.shop.catId, shopId: q.shop.id, shopName: q.shop.name,
    customerKey: s.key, customerName: s.name, customerArea: s.area, customerLoc: s.loc || null,
    lines: cart.lines.map(l => ({ ...l, pickedQty: null, status: 'pending' })),
    itemsTotal: q.itemsTotal, deliveryFee: q.deliveryFee, customerPays: q.customerPays,
    platformFee: q.platformFee, gst: q.platformFeeGst, shopPayout: q.shopPayout,
    riderPayout: q.riderPayout, mode, km: q.km, eta: q.shop.prepMins + etaMins(q.km),
    provisional: cart.lines.some(l => l.variableWeight),
    stage: 'R_PLACED', stageTs: now, createdAt: now,
    history: [{ stage: 'R_CART', at: now }, { stage: 'R_PLACED', at: now }],
    otp: String(s.code || '') || makeOtp(), evidence: [],   // the shopper's own code — see bookService
  };
  dispatch({ type: 'order/add', payload: order });
  // the customer's payment arrives from the world first; only then is it locked
  const paid = await fund(s.key, q.customerPays, 'retail', { orderId: order.id });
  dispatch({ type: 'order/patch', payload: { id: order.id, patch: { paidFromWallet: paid.fromWallet, collected: paid.collected } } });
  await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id, { shopId: q.shop.id });
  bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  clearCart();
  audit.record('retail.placed', { id: order.id, shopId: q.shop.id, total: q.customerPays }, s.key);
  setTimeout(() => advance(order.id, 'R_ACCEPTED', {}), 1100);
  return order;
}

/* ── the retail processes the machine declared but nothing drove ──────
   R_SUB_PENDING, R_PICKUP_READY, R_RETURN and R_REFUNDED all existed in the
   state registry with no use-case behind them: a shop could not say "this
   item is out", a pickup order still went out with a rider, and a customer
   could never return anything. The cart's promise — "the shop follows your
   choice; no reply means we refund that item" — is honoured here. */

/** Shop: an item is not available. The line's own policy decides. */
export function markLineUnavailable(orderId, lineId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.kind !== 'retail' || o.stage !== 'R_PICKING') return null;
  const line = (o.lines || []).find(l => l.lineId === lineId);
  if (!line || line.status === 'unavailable' || line.status === 'substituted') return null;
  const policy = line.subPolicy || 'call';
  const lines = o.lines.map(l => l.lineId !== lineId ? l
    : policy === 'similar' ? { ...l, status: 'substituted', note: 'similar brand' }
    : policy === 'refund'  ? { ...l, status: 'unavailable', refundPaise: l.qty * l.unitPrice }
    :                        { ...l, status: 'asking' });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { lines } } });
  if (policy === 'call') {
    advance(orderId, 'R_SUB_PENDING', { subAskedAt: Date.now() });
    toast('Asked the customer. No reply in 90 seconds means that item is refunded.');
  } else {
    toast(policy === 'similar' ? 'Marked: send a similar brand' : `${M.fmt(line.qty * line.unitPrice)} will be refunded for that item`);
  }
  audit.record('retail.lineUnavailable', { id: orderId, lineId, policy }, me() ? me().key : 'system');
  return policy;
}

/** Customer: answer the shop's substitution question. */
export function decideSubstitution(orderId, lineId, choice) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_SUB_PENDING') return null;
  const lines = o.lines.map(l => l.lineId !== lineId ? l
    : choice === 'similar' ? { ...l, status: 'substituted', note: 'similar brand' }
    :                        { ...l, status: 'unavailable', refundPaise: l.qty * l.unitPrice });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { lines } } });
  if (!lines.some(l => l.status === 'asking')) advance(orderId, 'R_PICKING', {});
  toast(choice === 'similar' ? 'Told the shop: a similar brand is fine' : 'Told the shop: refund that item');
  return choice;
}

/** The 90-second promise: an unanswered ask becomes a refund, automatically. */
export const SUB_REPLY_MS = 90e3;
export function sweepSubstitutions(now = Date.now()) {
  let n = 0;
  getState().orders.filter(o => o.stage === 'R_SUB_PENDING' && o.subAskedAt && now - o.subAskedAt > SUB_REPLY_MS).forEach(o => {
    const lines = o.lines.map(l => l.status === 'asking' ? { ...l, status: 'unavailable', refundPaise: l.qty * l.unitPrice, note: 'no reply — refunded' } : l);
    dispatch({ type: 'order/patch', payload: { id: o.id, patch: { lines } } });
    advance(o.id, 'R_PICKING', {}); n++;
  });
  return n;
}

/** Shop: a pickup order is packed and waiting; customer collects it. */
export function readyForPickup(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.mode !== 'pickup') return null;
  return advance(orderId, 'R_PICKUP_READY', { readyAt: Date.now() });
}
export function collected(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_PICKUP_READY') return null;
  return advance(orderId, 'R_DELIVERED', { deliveredAt: Date.now(), otpVerified: true });
}

/** Customer: return an order after delivery; shop or admin accepts → refund. */
export function requestReturn(orderId, reason) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_DELIVERED') return null;
  const moved = advance(orderId, 'R_RETURN', { returnReason: reason || 'not as expected', returnAt: Date.now() });
  if (moved) { audit.record('retail.return', { id: orderId, reason }, me() ? me().key : 'system'); toast('Return requested. The shop will confirm.'); }
  return moved;
}
export async function acceptReturn(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_RETURN') return null;
  if (!advance(orderId, 'R_REFUNDED', { refund: o.customerPays, refundedAt: Date.now() })) return null;
  await ledger('REFUND', o.customerPays, acct.escrow(o.id), acct.customer(o.customerKey), { reason: 'return' });
  const a = getState().agg;
  bumpAgg({ refunds: a.refunds + o.customerPays, escrow: Math.max(0, a.escrow - (o.customerPays | 0)) });
  advance(orderId, 'R_CLOSED', { closedAt: Date.now() });
  audit.record('retail.refunded', { id: o.id, amount: o.customerPays, reason: 'return' }, me() ? me().key : 'admin');
  toast(`${M.fmt(o.customerPays)} refunded for the return`);
  return o;
}

export async function settleRetail(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  // items the shop could not supply come back to the customer, out of the
  // shop's share — the fee, GST and rider are untouched, so the books still
  // sum to exactly what the customer paid
  const lineRefund = (o.lines || []).filter(l => l.status === 'unavailable').reduce((n, l) => n + (l.refundPaise || 0), 0);
  if (!advance(orderId, 'R_SETTLED', { settledAt: Date.now(), lineRefund })) return;
  // The dispatch cut was posted NOWHERE, stranding Rs.5 in escrow on every
  // rider order; and GST sat inside the fee leg, so `revenue` mixed
  // gross-of-GST retail with net-of-GST service in the same total.
  const feeExGst = Math.max(0, o.platformFee - (o.gst | 0));
  // the dispatch cut is the RESIDUAL of what the customer paid after the shop,
  // the fee, the GST and the rider — so a free-delivery rider order (shop
  // absorbed the ride, cut still carved) leaves nothing stranded in escrow
  const dispatchCut = Math.max(0, (o.customerPays | 0) - (o.shopPayout | 0) - (o.platformFee | 0) - (o.riderPayout | 0));
  const shopPayout = Math.max(0, o.shopPayout - lineRefund);
  await ledger('SHOP_PAYOUT', shopPayout, acct.escrow(o.id), acct.shop(o.shopId), {});
  if (lineRefund) await ledger('REFUND', lineRefund, acct.escrow(o.id), acct.customer(o.customerKey), { reason: 'unavailable items' });
  if (lineRefund) dispatch({ type: 'order/patch', payload: { id: orderId, patch: { shopPayout, refund: lineRefund } } });
  if (feeExGst)      await ledger('FEE', feeExGst, acct.escrow(o.id), acct.fee(), {});
  if (o.gst)         await ledger('GST', o.gst, acct.escrow(o.id), acct.gst(), {});
  if (o.riderPayout) await ledger('RIDER', o.riderPayout, acct.escrow(o.id), acct.rider(), {});
  if (dispatchCut)   await ledger('DISPATCH', dispatchCut, acct.escrow(o.id), acct.fee(), {});
  const a = getState().agg;
  bumpAgg({ retailOrders: a.retailOrders + 1, gmv: a.gmv + o.itemsTotal - lineRefund,
            revenue: a.revenue + feeExGst, gst: a.gst + (o.gst | 0), refunds: a.refunds + lineRefund,
            escrow: Math.max(0, a.escrow - (o.customerPays | 0)) });
  // R_SETTLED was the end of the road: nothing advanced to R_CLOSED, so every
  // retail order sat in a non-terminal stage forever and two views had to
  // hard-code R_SETTLED into their "hide it" lists instead of using isTerminal.
  advance(orderId, 'R_CLOSED', { closedAt: Date.now() });
  toast(`Settled — ${M.fmt(shopPayout)} to ${o.shopName}`);
}

/* ── the admin's escape hatch for a stuck shop order ──────────
   A retail order abandoned at R_ACCEPTED/R_PICKING/R_PACKED/R_OUT (shop went
   dark) had NO admin remedy: the escrow queue listed service orders only, and
   the disputes path called confirmAndRelease, which early-returns for retail
   — after dispute/resolve had already marked the dispute resolved. The
   customer's money was frozen permanently. The correct remedy when a shop
   goes dark is to give it back. */
export async function refundRetail(orderId, reason = 'shop unresponsive') {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (o.kind !== 'retail') { toast('That is a service order — release it from Escrow.', 'warn'); return null; }
  if (['R_SETTLED', 'R_CLOSED', 'R_CANCELLED'].includes(o.stage)) { toast('Already closed', 'warn'); return null; }

  // R_OUT cannot cancel directly; it must fail first. Walk the legal path
  // rather than forcing an illegal jump.
  if (o.stage === 'R_OUT') advance(orderId, 'R_FAILED', {});
  if (!advance(orderId, 'R_CANCELLED', { refund: o.customerPays, cancelledAt: Date.now(), cancelReason: reason })) {
    toast('That order cannot be cancelled from its current stage', 'danger');
    return null;
  }
  await ledger('REFUND', o.customerPays, acct.escrow(o.id), acct.customer(o.customerKey), { reason });
  const a = getState().agg;
  bumpAgg({ refunds: a.refunds + o.customerPays, escrow: Math.max(0, a.escrow - (o.customerPays | 0)) });

  const open = getState().disputes.find(d => d.orderId === o.id && !d.resolvedAt);
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id, patch: { status: 'RESOLVED', outcome: 'refund' } } });
  audit.record('retail.refunded', { id: o.id, amount: o.customerPays, reason }, me() ? me().key : 'admin');
  toast(`${M.fmt(o.customerPays)} refunded to ${o.customerName}`);
  return o;
}

/* ── rating: the missing terminal step of a service order ─────
   Without this nothing ever dispatched partner/rate or review/add, so trust
   scores were frozen at their seed values and admin's review moderation list
   could never be anything but empty. */
export function rateOrder(orderId, starsRaw, text = '') {
  const stars = Math.max(1, Math.min(5, Math.round(Number(starsRaw) || 0)));
  const o = getState().orders.find(x => x.id === orderId);
  const s = me();
  if (!o || !s) return null;
  if (o.customerKey !== s.key) { toast('Only the customer can rate this job', 'warn'); return null; }
  if (o.rated) return null;                       // idempotent: one rating per order
  const now = Date.now();
  if (o.partnerId) dispatch({ type: 'partner/rate', payload: { id: o.partnerId, rating: { stars, ts: now, orderId } } });
  dispatch({ type: 'review/add', payload: {
    id: nid('rv'), orderId, partnerId: o.partnerId, partnerName: o.partnerName,
    byKey: s.key, byName: s.name, stars, text: String(text || '').slice(0, 400), ts: now } });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { rated: stars, ratedAt: now } } });
  // SETTLED -> RATED -> CLOSED, and PARTIAL -> CLOSED. All three existed in
  // the machine with no caller.
  if (canTransition(o.stage, 'RATED')) { advance(orderId, 'RATED', {}); advance(orderId, 'CLOSED', {}); }
  else advance(orderId, 'CLOSED', {});
  audit.record('order.rated', { id: orderId, stars }, s.key);
  toast('Thanks — that decides who gets recommended next.');
  return stars;
}

/** Declining to rate still has to close the order, or it sits open forever. */
export function skipRating(orderId) {
  const o = getState().orders.find(x => x.id === orderId); if (!o) return;
  // SETTLED has no edge to CLOSED; Skip has to walk through RATED like a rating does
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { rated: -1, ratedAt: Date.now() } } });
  if (canTransition(o.stage, 'RATED')) advance(orderId, 'RATED', {});
  advance(orderId, 'CLOSED', {});
}

/* ── the promise on the WORK_DONE screen ──────────────────────
   "Auto-releases if the customer does not respond" was printed to the pro
   and implemented nowhere: releaseAt was written and never read, so a
   customer who simply never tapped Confirm left the pro unpaid forever. This
   runs at boot and whenever an order screen renders. HOLD-tier orders are
   deliberately excluded — those need a human. */
export async function sweepAutoRelease(now = Date.now()) {
  const due = getState().orders.filter(o => o.kind === 'service' && o.stage === 'WORK_DONE'
    && o.releaseAt && o.releaseAt <= now && o.escrowTier !== 'HOLD' && o.escrowTier !== 'FREEZE');
  for (const o of due) await confirmAndRelease(o.id, 1);
  return due.length;
}

/* ── shop owner: self-listing ──────────────────────────────── */
export function addProductFromStarter(shopId, sc, priceOverride, stock) {
  const p = {
    id: nid('pr'), shopId, catId: sc.catId, refId: sc.refId,
    name: sc.name, aisle: sc.aisle, unit: sc.unit,
    price: priceOverride ?? sc.price, mrp: sc.mrp,
    stockQty: stock ?? 10, lowStockAt: 5, trackStock: !sc.variableWeight,
    variableWeight: sc.variableWeight, coldChain: sc.coldChain, perishable: sc.perishable,
    rxRequired: sc.rxRequired, bookingOnly: sc.bookingOnly,
    subPolicyDefault: sc.subPolicyDefault, active: true, soldCount: 0, createdAt: Date.now(),
  };
  dispatch({ type: 'product/add', payload: p });
  audit.record('listing.added', { id: p.id, shopId, name: p.name }, me() && me().key);
  return p;
}
export function addCustomProduct(shopId, catId, fields) {
  const p = { id: nid('pr'), shopId, catId, refId: null, active: true, soldCount: 0,
              lowStockAt: 5, trackStock: true, createdAt: Date.now(), ...fields };
  dispatch({ type: 'product/add', payload: p });
  return p;
}
/** MRP lock: selling above MRP is illegal under Legal Metrology. Refuse it. */
export function setProductPrice(productId, pricePaise) {
  if (!Number.isFinite(pricePaise) || pricePaise <= 0) { toast('Price must be above zero', 'danger'); return { ok: false }; }
  const p = getState().products.find(x => x.id === productId);
  if (!p) return { ok: false };
  if (p.mrp && pricePaise > p.mrp)
    return { ok: false, reason: `You cannot sell above MRP (${M.fmt(p.mrp)}) — it is illegal under Legal Metrology.` };
  dispatch({ type: 'product/patch', payload: { id: productId, patch: { price: pricePaise } } });
  return { ok: true };
}

/* ── shared ────────────────────────────────────────────────── */
function bumpAgg(patch) { dispatch({ type: 'agg/bump', payload: patch }); }
export function sendChat(orderId, text) {
  const s = me(); if (!s || !text.trim()) return;
  /* The scan and the masker must agree: a number the scan misses is stored in
     the clear, however good the masker is. Both use PHONE_RE now. */
  const flagged = maskContact(text) !== text || /\bcash\b|\bgpay\b|\bphonepe\b/i.test(text);
  const msg = { id: nid('m'), name: s.name, role: s.role, text: flagged ? maskContact(text) : text,
                ts: Date.now(), flagged };
  dispatch({ type: 'chat/add', payload: { orderId, msg } });
  if (flagged) { audit.record('fraud.offplatform', { orderId, by: s.key }); toast('Phone numbers and payment IDs are hidden — keep payments in SAAHAA so both sides stay protected.', 'warn'); }
  return msg;
}
/* What the screens promise is masked, masked.

   The e-mail rule runs FIRST: the UPI rule would otherwise eat the domain and
   leave the name readable.

   The number rule used to be `\b\d{10}\b`, which nobody types. "98765 43210",
   "98765-43210" and "+91 98765 43210" all sailed through unmasked, unflagged
   and unaudited — the screens said contact details were hidden while the
   commonest way of writing one was not. Ten digits with anything or nothing
   between them now count as a number, and the +91 in front goes with it. */
const PHONE_RE = /(?:\+?91[\s-]*)?(?:\d[\s-]*){10}/g;
const isPhone = s => (s.match(/\d/g) || []).length >= 10;
export const maskContact = t => t
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '•••@•••')
  .replace(PHONE_RE, m => (isPhone(m) ? '••••••••••' : m))
  .replace(/@(ok|ybl|paytm|upi|axl)\w*/gi, '@•••');

export { trustScore, rankShops, quoteService, compareWithApps, M as money };
