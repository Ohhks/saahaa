/* SAAHAA · domain/flow.js — the use-cases. Views call these; they never
   dispatch raw actions themselves, so every money movement and every state
   transition goes through one auditable place. */

import { ctx, getState, dispatch, me, myArea, saveSession } from '../core/ctx.js';
import { nid, otp as makeOtp } from '../core/id.js';
import { appendBlock } from '../core/crypto.js';
import * as audit from '../core/audit.js';
import * as M from '../core/money.js';
import { find } from '../core/registry.js';
import { subSize } from './catalog.services.js';
import { applyTransition, canTransition } from './orders.js';
import { acct, holdbackFor, balanceOf, checkInvariants } from './ledger.js';
import * as gateway from '../core/gateway.js';
import * as W from './wallet.js';
import * as photos from '../core/photos.js';
import { quoteService, quoteRetail, compareWithApps, releaseService, cancelSplit } from './pricing.js';
import { lockedMatch, rankShops, kmBetween, etaMins } from './match.js';
import { escrowTier, markupFor, trustScore } from './trust.js';
import { toast } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import * as flags from '../core/flags.js';

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
/* A SHOP'S MONEY HAD NOWHERE TO GO. Signup collected a name, a category, a
   place and a photograph — and no UPI id, unlike the pro's step 6. Settled
   orders credited SHOP:<id> and sat there: no withdraw control anywhere, and
   the owner's "Mark paid" only set a flag and posted nothing, so the balance
   stayed put for ever and there was no account to send it to. A marketplace
   holding a kirana's takings with no way out is not a marketplace. */
export function shopWallet(shopId) {
  /* I INVENTED A LEDGER SHAPE THAT DOES NOT EXIST. This walked `e.legs`, and
     entries have no `legs` array — they are {partyA, partyB, amountPaise}. So
     it returned 0 for every shop, for ever: the withdraw button shipped
     permanently disabled over a real balance, and the "fix" was a control that
     could not work. `balanceOf` is the one function that already knows how to
     read this ledger; there was never a reason to write a second one. */
  return { balance: Math.max(0, balanceOf(getState().ledger || [], acct.shop(shopId))) };
}

export async function shopWithdraw(shopId, paise) {
  if (!assertBookOk('withdraw')) return null;
  const shop = getState().shops.find(x => x.id === shopId);
  if (!shop) return null;
  const amt = M.int(paise), w = shopWallet(shopId);
  if (amt > w.balance) { toast(`You can withdraw up to ${M.fmt(w.balance)}`, 'warn'); return null; }
  if (amt < MIN_WITHDRAW) { toast(`The smallest withdrawal is ${M.fmt(MIN_WITHDRAW)}`, 'warn'); return null; }
  if (!shop.upi) { toast('Add the UPI id this shop is paid into first', 'warn'); return null; }
  const r = await gateway.payout({ paise: amt, purpose: 'shop-payout', key: shopId, upi: shop.upi });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.shop(shopId), acct.world(), { via: r.via, ref: r.ref });
  audit.record('shop.withdraw', { shopId, amt }, me() && me().key);
  toast(`${M.fmt(amt)} sent to ${shop.upi}`);
  ctx.render();
  return amt;
}

export function setShopUpi(shopId, upi) {
  const v = String(upi || '').trim();
  if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(v)) { toast('That does not look like a UPI id (name@bank)', 'warn'); return false; }
  dispatch({ type: 'shop/patch', payload: { id: shopId, patch: { upi: v } } });
  audit.record('shop.upiSet', { shopId }, me() && me().key);
  toast('Saved. This is where your money goes.');
  return true;
}

export function setCustomerUpi(upi) {
  const s = me(); if (!s) return false;
  const v = String(upi || '').trim();
  if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(v)) { toast('That does not look like a UPI id (name@bank)', 'warn'); return false; }
  dispatch({ type: 'user/patch', payload: { key: s.key, patch: { upi: v } } });
  saveSession({ ...s, upi: v });
  audit.record('cwallet.upiSet', {}, s.key);
  toast('Saved. This is where refunds and take-outs go.');
  return true;
}

export async function customerWithdraw(paise) {
  if (!assertBookOk('withdraw')) return null;
  const s = me(); if (!s) return null;
  const amt = M.int(paise), w = customerWallet(s.key);
  if (amt < 1000) { toast('The smallest take-out is ₹10', 'warn'); return null; }
  if (amt > w.balance) { toast(`You can take out up to ${M.fmt(w.balance)}`, 'warn'); return null; }
  /* THE APP NEVER ASKED HER FOR A UPI ID — no screen anywhere sets one — and
     this sent the money anyway, to '', toasting "sent to your UPI". In sandbox
     that is a lie; on a live rail it is a payout into nowhere. */
  const dest = s.upi || (getState().users.find(u => u.key === s.key) || {}).upi || '';
  if (!dest) { toast('Add the UPI id you want to be paid into first', 'warn'); return null; }
  const r = await gateway.payout({ paise: amt, purpose: 'refund-out', key: s.key, upi: dest });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.customer(s.key), acct.world(), { via: r.via, ref: r.ref });
  audit.record('cwallet.withdraw', { amt }, s.key);
  toast(`${M.fmt(amt)} sent to ${dest}`);
  return amt;
}

/* ── SERVICE: the 3-tap booking ────────────────────────────── */
export function findMatch(catId, opts = {}) {
  const st = getState();
  const cat = find('category', catId);
  const deal = opts.deal || (cat && cat.base) || 50000;
  /* Refusing a self-booking at the confirm step is the backstop. Not offering
     it in the first place is the fix: a pro browsing his own trade should never
     see himself presented as his own best match. */
  const s0 = me();
  const pool = s0 ? st.partners.filter(p => p.userKey !== s0.key && !sameMobile(p, s0)) : st.partners;
  return lockedMatch(pool, { catId, area: opts.area || myArea(), dealPaise: deal });
}

export function previewBooking(catId, partner, sub) {
  const cat = find('category', catId);
  /* The sub-service is what the job actually is, so it has to reach the price.
     A tap washer and a pipeline replacement quoted the same figure before this. */
  const size = subSize(catId, sub);
  const base = partner ? partner.ask : (cat && cat.base) || 50000;
  const deal = Math.round(base * size.x);
  const q = quoteService(deal, { markup: markupFor(partner || {}) });
  const cmp = compareWithApps(deal);
  return { cat, partner, sub, deal, quote: q, compare: cmp, size };
}

/* One person, two accounts: identity.js lets a number hold a C… and a P…, so
   "is this me?" is a question about the human, not the row. */
const digitsOf = v => String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
function sameMobile(partner, session) {
  const users = getState().users || [];
  const pu = users.find(u => u.key === partner.userKey) || {};
  const a = digitsOf(pu.mobile || partner.mobile), b = digitsOf(session.mobile);
  return !!a && a === b;
}

export async function bookService({ catId, partner, sub, deal, slot }) {
  const s = me();
  if (!s) throw new Error('Please sign in first');
  /* NOBODY MAY BOOK THEMSELVES. Without this a pro appears as his own "best
     match", books the job, types his OWN code at the door — the code check is
     the customer's code, which on a self-booking is his — attaches a photo of
     anything, and the sweep releases it. Cost: 8% of a price he sets himself.
     Every job counts towards Background Checked and SAAHAA Certified, so the
     whole automatic trust ladder was farmable, and the one thing the door code
     is supposed to prove — that he was standing in front of somebody — proved
     nothing at all. One number can hold both a C… and a P… account, so this
     compares the person, not the account. */
  if (partner && (partner.userKey === s.key || sameMobile(partner, s))) {
    toast('You cannot book yourself. Pick another professional.', 'warn');
    throw new Error('self-booking refused');
  }
  const cat = find('category', catId);
  const size = subSize(catId, sub);
  const price = deal ?? Math.round(partner.ask * size.x);
  const q = quoteService(price, { markup: markupFor(partner) });
  const km = kmBetween(s.area, partner.area);
  const now = Date.now();

  const order = {
    id: nid('ord'), kind: 'service', catId, sub: sub || null,
    customerKey: s.key, customerName: s.name, customerArea: s.area, customerLoc: s.loc || null,
    /* AN AREA IS NOT AN ADDRESS. Until 8.6.0 the order carried only "Madhapur"
       and a pin at the customer's sign-up coordinates, so a tradesperson was
       sent to a neighbourhood centroid with no flat number, no landmark and no
       way to ring. Both audits independently called this the thing that stops
       the product working in the real world. */
    customerAddress: String(s.address || '').slice(0, 240),
    customerLandmark: String(s.landmark || '').slice(0, 120),
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
    /* a job nobody can honestly quote unseen is booked as a visit at this
       estimate; the pro confirms on arrival and she approves before work starts */
    pricedOnSite: !!size.survey,
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

  /* "PRO ACCEPTED" USED TO BE A 900ms TIMER. Nobody had accepted anything — the
     customer was told a named tradesperson had taken her job while he was
     possibly asleep, with no timeout, no re-offer and no way to report it. A
     fabricated status is worse than an honest wait, because she stops looking
     for alternatives.

     Under ?demo=1 the simulation stays, because a demo with nobody on the other
     end shows nothing. In production the order sits at MATCHING until a real
     pro taps Accept, and if none does within the window it becomes NO_MATCH and
     she is paid back in full. */
  if (flags.isOn('SIM_MARKET')) setTimeout(() => advance(order.id, 'ASSIGNED', {}), 900);
  return order;
}

/* How long a booking waits for a real pro before the customer gets her money
   back. Long enough for a phone in a pocket, short enough that nobody's evening
   is spent waiting on a screen that says "finding". */
export const ACCEPT_WINDOW_MS = 10 * 60 * 1000;
/* How long a shop has to answer a return before the customer is simply paid
   back. Long enough to be fair to a busy counter, short enough that nobody is
   left chasing money for a delivery that already went wrong. */
export const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;

/* THE ESCALATION THAT NEVER RAN. `match.js` builds a ladder of alternates with
   a per-pro window and nothing in the product ever read it, so an unaccepted
   booking waited for ever. This is the floor under that: whatever else happens,
   a job nobody took is refunded rather than left open. */
export async function sweepUnaccepted(now = Date.now()) {
  const waited = o => (now - (o.stageTs || o.createdAt || now)) > ACCEPT_WINDOW_MS;
  const stale = getState().orders.filter(o => o.stage === 'MATCHING' && waited(o));
  for (const o of stale) {
    advance(o.id, 'NO_MATCH', { noMatchAt: now });
    await cancelOrder(o.id, 'BEFORE_ACCEPT');          // nobody accepted: she is made whole
    audit.record('booking.noMatch', { id: o.id, waitedMs: now - (o.stageTs || 0) }, 'system');
  }
  /* A SHOP THAT NEVER PICKS UP THE ORDER. The retail side had no timeout at
     all, so her money sat held with no shop working and no way out. */
  const shopStale = getState().orders.filter(o => o.stage === 'R_PLACED' && waited(o));
  for (const o of shopStale) {
    await refundRetail(o.id, 'The shop did not pick this up in time');
    audit.record('order.shopNoResponse', { id: o.id, waitedMs: now - (o.stageTs || 0) }, 'system');
  }
  /* AND A RETURN THE SHOP NEVER ANSWERS. Requesting one used to be strictly
     worse than doing nothing: the money froze and no actor in the system could
     release it. A return the shop ignores now refunds itself, because the
     person who has already been let down should not also have to chase. */
  /* ESCALATING A RETURN USED TO CANCEL HER OWN RESCUE. Asking SAAHAA to step in
     moved the order to DISPUTED, which this filter no longer matched — so the
     24-hour auto-refund stopped applying and the owner's own remedy could not
     reach it either. The one action a worried person takes must not be the one
     that strands them. */
  const returns = getState().orders.filter(o =>
    (o.stage === 'R_RETURN' || (o.stage === 'DISPUTED' && o.kind === 'retail'))
    && (now - (o.stageTs || o.createdAt || now)) > RETURN_WINDOW_MS);
  for (const o of returns) {
    await refundRetail(o.id, 'The shop did not answer the return in time');
    audit.record('order.returnUnanswered', { id: o.id }, 'system');
  }
  return stale.length + shopStale.length + returns.length;
}

/* ── THE BOOK GUARDS ITSELF ────────────────────────────────────
   `checkInvariants` is the best-written function in this repo and until 8.9.0
   NOTHING CALLED IT. It knows the book must balance, that no entry may be
   lopsided, and that no spendable account may go negative — and it sat there
   while two separate bugs drove escrow negative and let a shop withdraw more
   money than the customer ever paid. A safety net nobody attached is not a
   safety net; it is a comment.

   It is attached now, at the only moment that matters: before money leaves the
   system. A payout over a broken book is refused and the failure is said out
   loud, because quietly continuing is how the first one went unnoticed for
   four audits. */
let bookFrozen = null;
export const bookStatus = () => bookFrozen;

export function assertBookOk(where) {
  const r = checkInvariants(getState().ledger || []);
  const fatal = (r.checks || []).filter(c => c.fatal && !c.ok);
  if (!fatal.length) { bookFrozen = null; return true; }
  bookFrozen = { where, at: Date.now(), problems: fatal.map(c => c.detail) };
  audit.record('ledger.frozen', { where, problems: bookFrozen.problems }, 'system');
  toast('Payouts are paused — the books do not balance. The owner has been told.', 'danger');
  return false;
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
    toast(fails >= 3 ? t('door.tooMany') : t('door.wrong'), 'danger');
    /* THIS USED TO MOVE THE ORDER TO DISPUTED AND OPEN NO DISPUTE. The stage
       said "under review", the owner's queue read "No open disputes", and the
       customer's money and the pro's payout sat frozen with no record, no
       actor and nobody watching. Three mistyped characters on a doorstep
       stranded a job permanently. It raises a real dispute now, so it lands in
       the queue like everything else. */
    if (fails >= 3 && !(getState().disputes || []).some(d => d.orderId === orderId && d.status === 'OPEN')) {
      raiseDispute(orderId, 'Code would not verify at the door',
        'The code was entered incorrectly three times. Neither side has been charged or paid.',
        { silent: true });
    }
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
/* THE ONE PLACE THE WITHDRAWAL FLOOR IS WRITTEN DOWN.
   partner.js used to hard-code 100000 paise (Rs.1,000) in three places and grey
   the button out below it, while this function has always allowed Rs.10. A pro
   quoting Rs.520 — the ordinary case for this product — therefore finished a
   job, watched the screen call the money "yours to withdraw", and could not
   have it until a second job landed. A floor that only exists in the UI is a
   floor nobody agreed to. */
export const MIN_WITHDRAW = 1000;

export async function walletWithdraw(partnerId, paise) {
  if (!assertBookOk('withdraw')) return null;
  const amt = M.int(paise);
  const w = W.walletOf(getState().ledger, partnerId, getState().partners.find(x => x.id === partnerId) || {});
  if (amt > w.available) { toast(`You can withdraw up to ${M.fmt(w.available)}`, 'warn'); return null; }
  if (amt < MIN_WITHDRAW) { toast(`The smallest withdrawal is ${M.fmt(MIN_WITHDRAW)}`, 'warn'); return null; }
  const pUpi = ((getState().partners.find(x => x.id === partnerId) || {}).verification || {}).upi || '';
  /* The shop path refused without a destination and this one did not, so the
     screen said "sent to your UPI" while the VPA was an empty string. On a live
     rail that is a payout into nowhere. */
  if (!pUpi) { toast('Add the UPI id you want to be paid into first', 'warn'); return null; }
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
  /* WHAT HE WAS ACTUALLY PAID, RECORDED ON THE ORDER. Nothing stored it, so
     every screen went on rendering `o.deal` and told a pro paid ₹360 of a ₹600
     job that he had "received the full ₹600". */
  const open0 = (getState().disputes || []).find(d => d.orderId === orderId && !d.resolvedAt);
  const moved = advance(orderId, endStage, {
    releasedPct: pct, workerPayout: r.workerPayout, refund: r.refund,
    platformFee: r.platformFee, gst: r.gst, settledAt: Date.now(),
    releasedPaise: r.workerPayout,
    ...(open0 ? { disputeOutcome: pct >= 1 ? 'release' : pct <= 0 ? 'refund' : 'partial',
                  disputeNote: open0.note || '' } : {}),
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
  /* THE SHEET PROMISED "it is recorded against them, so it cannot happen
     quietly twice" AND NOTHING WAS RECORDED. A genuine no-show has no stake to
     forfeit either — the stake locks when the door code is entered, which by
     definition never happened — so the consequence to the pro was exactly zero
     and the customer's ₹100 credit was free money for anyone who asked. */
  if (ruleId === 'WORKER_NO_SHOW' || ruleId === 'WORKER_CANCEL') {
    const pid = o.partnerId;
    const p0 = getState().partners.find(x => x.id === pid);
    if (p0) {
      const field = ruleId === 'WORKER_NO_SHOW' ? 'noShows' : 'workerCancels';
      dispatch({ type: 'partner/patch', payload: { id: pid, patch: { [field]: ((p0[field] | 0) + 1) } } });
      audit.record('partner.' + field, { partner: pid, orderId: o.id }, 'system');
    }
  }
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

/* THE PRO CAN CANCEL. Term 4 of the agreement he signs is "I will cancel early
   if I cannot come, never just not show up", and the conduct quiz marks
   "Cancel in the app as early as possible" as the right answer — while the app
   gave him no such control at any stage. His only options were to no-show
   (stake forfeit and a trust penalty) or to talk the customer into cancelling
   for him. CANCEL_RULES.WORKER_CANCEL has been in the engine all along with
   nothing calling it: the customer is made whole in full. */
export async function workerCancel(orderId, reason) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (['SETTLED', 'RATED', 'CLOSED', 'CANCELLED', 'REFUNDED'].includes(o.stage)) {
    toast('This job is already finished', 'warn'); return null;
  }
  const out = await cancelOrder(orderId, 'WORKER_CANCEL');   // cancelOrder takes the rule id only
  audit.record('order.workerCancel', { orderId, reason: reason || '' }, me() && me().key);
  return out;
}

/* ── DISPUTE: 3 taps to raise ──────────────────────────────── */
export const DISPUTE_REASONS = ['Not done', 'Partly done', 'Damage', 'Late / No-show',
                                'Overcharged', 'Rude or unsafe', 'Wrong person came'];
/* A PRO GOT THE CUSTOMER'S LIST. His "Report an issue" offered him Not done,
   Damage, Overcharged, Rude or unsafe — seven accusations against himself, any
   of which froze his own payment. These are the things that actually go wrong
   on his side of a doorstep. */
export const PARTNER_DISPUTE_REASONS = [
  'Nobody was at home', 'They would not give me their code', 'The job is bigger than quoted',
  'I cannot safely do this work', 'Wrong address', 'They asked me to work off the app',
];
/* A KIRANA IS NOT STANDING AT A DOORSTEP. Lumping 'shop' in with 'partner'
   offered a shopkeeper packing an order "Nobody was at home" and "They would
   not give me their code" — the same class of bug as giving the pro the
   customer's list, one role over. */
export const SHOP_DISPUTE_REASONS = [
  'The item is out of stock and there is no substitute', 'The address is not reachable for delivery',
  'The customer refused the delivery', 'The order came in after we closed',
  'The basket is too large for us to fulfil', 'They asked us to deal off the app',
];
export const reasonsFor = role => role === 'shop' ? SHOP_DISPUTE_REASONS
  : role === 'partner' ? PARTNER_DISPUTE_REASONS : DISPUTE_REASONS;
/* Let them try the code again. Only for a job stuck by a mistyped code — never
   for a real complaint, which is somebody's money and not a typo. The fail
   count resets so the pro is not one keystroke from the same dead end. */
/* The retail handover check. Same forgiving comparison as the service door —
   a person is reading digits out on a doorstep either way. */
export function checkRetailCode(orderId, entered) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return false;
  if (!sameCode(entered, o.otp)) { toast(t('door.wrong'), 'danger'); return false; }
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpVerified: true } } });
  audit.record('retail.codeVerified', { id: orderId }, me() && me().key);
  return true;
}

export function retryDoorCode(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'DISPUTED' || o.disputeReason !== 'Code would not verify at the door') return null;
  const open = (getState().disputes || []).find(d => d.orderId === orderId && d.status === 'OPEN');
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id, patch: { status: 'RESOLVED', outcome: 'retry' } } });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpFails: 0, disputed: false, disputeReason: null } } });
  advance(orderId, 'ARRIVED', {});
  audit.record('order.codeRetry', { orderId }, me() && me().key);
  toast('Try the code again — ask them to read it out slowly.');
  return true;
}

export function raiseDispute(orderId, reason, note, opts = {}) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const d = { id: nid('dsp'), orderId, reason, note: note || '', by: me() && me().key,
              openedAt: Date.now(), status: 'OPEN', amount: o.customerPays };
  dispatch({ type: 'dispute/open', payload: d });
  if (canTransition(o.stage, 'DISPUTED')) advance(orderId, 'DISPUTED', { disputed: true, disputeReason: reason });
  audit.record('dispute.opened', { id: d.id, orderId, reason }, me() && me().key);
  if (!opts.silent) toast('Reported. Your money is frozen until this is settled.');
  return d;
}

/* A NEW SHOP PAYS NOTHING AT ALL ON ITS FIRST THIRTY ORDERS — not the
   percentage and not the minimum. It was the single best thing on offer to a
   kirana and the product never mentioned it anywhere a shop owner would look;
   the console even showed "Fees today (3%)" to a shop paying 0%. Exported so a
   screen can count down rather than reprint the number. */
export const FREE_FIRST_ORDERS = 30;
export const freeOrdersLeft = shop => Math.max(0, FREE_FIRST_ORDERS - ((shop && shop.ordersCompleted) || 0));

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
  const first = (shop.ordersCompleted || 0) < FREE_FIRST_ORDERS;
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
    /* AN AREA IS NOT AN ADDRESS. Until 8.6.0 the order carried only "Madhapur"
       and a pin at the customer's sign-up coordinates, so a tradesperson was
       sent to a neighbourhood centroid with no flat number, no landmark and no
       way to ring. Both audits independently called this the thing that stops
       the product working in the real world. */
    customerAddress: String(s.address || '').slice(0, 240),
    customerLandmark: String(s.landmark || '').slice(0, 120),
    lines: cart.lines.map(l => ({ ...l, pickedQty: null, status: 'pending' })),
    itemsTotal: q.itemsTotal, deliveryFee: q.deliveryFee, customerPays: q.customerPays,
    platformFee: q.platformFee, gst: q.platformFeeGst, shopPayout: q.shopPayout,
    riderPayout: q.riderPayout, mode, km: q.km, eta: q.shop.prepMins + etaMins(q.km),
    provisional: cart.lines.some(l => l.variableWeight),
    stage: 'R_PLACED', stageTs: now, createdAt: now,
    history: [{ stage: 'R_CART', at: now }, { stage: 'R_PLACED', at: now }],
    otp: String(s.code || '') || makeOtp(), evidence: [],   // the shopper's own code — see bookService
    agreedTotal: q.customerPays,   // what SHE agreed; never moves, so a reweigh has a fixed anchor and can be corrected freely
    /* whether the shop paid for the ride out of its own margin (free-delivery
       threshold) or she did — the statement was deducting the customer's
       delivery from the shop because nothing recorded which it was */
    shopAbsorbedDelivery: !!q.shopAbsorbs,
  };
  dispatch({ type: 'order/add', payload: order });
  // the customer's payment arrives from the world first; only then is it locked
  const paid = await fund(s.key, q.customerPays, 'retail', { orderId: order.id });
  dispatch({ type: 'order/patch', payload: { id: order.id, patch: { paidFromWallet: paid.fromWallet, collected: paid.collected } } });
  await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id, { shopId: q.shop.id });
  bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  clearCart();
  audit.record('retail.placed', { id: order.id, shopId: q.shop.id, total: q.customerPays }, s.key);
  /* THE SAME BUG AS THE SERVICE SIDE, AND I MISSED IT. This auto-accepted a
     grocery order 1.1s after it was placed — "Sri Lakshmi Kirana accepted"
     with nobody in the shop having touched a phone — and unlike the service
     path it had no timeout either, so an order nobody picked sat at R_ACCEPTED
     with her money held for ever. Gated on the demo flag like its twin. */
  if (flags.isOn('SIM_MARKET')) setTimeout(() => advance(order.id, 'R_ACCEPTED', {}), 1100);
  return order;
}

/* ── the retail processes the machine declared but nothing drove ──────
   R_SUB_PENDING, R_PICKUP_READY, R_RETURN and R_REFUNDED all existed in the
   state registry with no use-case behind them: a shop could not say "this
   item is out", a pickup order still went out with a rider, and a customer
   could never return anything. The cart's promise — "the shop follows your
   choice; no reply means we refund that item" — is honoured here. */

/** Shop: an item is not available. The line's own policy decides. */
/* "WEIGH AND PACK" HAD NOTHING TO WEIGH WITH. `pickedQty` was written once as
   null, read once by quoteRetail, and never set by any screen — so loose rice,
   meat and vegetables were always charged at the estimate the customer saw,
   under a line telling her it was "(est.) until weighed". Either the shop
   absorbed the difference or she was overcharged; nobody could tell which.

   Setting it re-quotes the order off the real weight. It can only be set while
   the shop is picking, and it cannot silently increase what she agreed to pay:
   anything above the estimate needs her approval, exactly like extra work on a
   service job. */
export async function setPickedQty(orderId, lineId, qty) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_PICKING') return null;
  const n = Math.max(0, Number(qty) || 0);
  const lines = (o.lines || []).map(l => l.lineId === lineId ? { ...l, pickedQty: n } : l);
  const shop = getState().shops.find(x => x.id === o.shopId) || {};
  const first = (shop.ordersCompleted || 0) < FREE_FIRST_ORDERS;
  const q = quoteRetail(lines, { catId: shop.catId, km: o.km, mode: o.mode, firstOrders: first });

  /* TWO BUGS LIVED HERE AND THE SECOND ONE WAS MINE.

     The first: the weight was stored and settlement paid out against the
     reduced figure, so the difference stayed in escrow for ever while the
     screen told the shop it had gone back to her automatically.

     The second, which I introduced fixing the first: I compared each entry
     against the CURRENT total, so every keystroke could only lower it. Typing
     0.5 instead of 5.0 was unrecoverable — 1.0 afterwards changed nothing, and
     the shop silently ate the difference on a slipped decimal.

     Both go away by moving the money to one place. `agreedTotal` is what she
     agreed and never changes; the shop may re-weigh as often as it likes,
     upward or downward, and nothing is posted until settlement. A marketplace
     may reduce a price on its own and may not raise one, so the charge is
     capped at what she agreed — a heavier weight is shown to the shop and
     never taken from her. */
  const agreed = (o.agreedTotal != null ? o.agreedTotal : o.customerPays) | 0;
  const capped = Math.min(q.customerPays, agreed);
  const under = capped < agreed;
  /* CAPPING ONLY HER SIDE MINTED MONEY. The charge was clamped to what she
     agreed and `shopPayout` was left at the heavier figure, so a shop typing
     6.0 kg against a 2 kg order drove escrow NEGATIVE and could then withdraw
     more than the customer ever paid. Everything downstream of the cap has to
     be recomputed from the capped total, not from the raw quote. */
  /* AND SCALING EVERYTHING BY THE CAP WAS THE THIRD GENERATION OF THIS BUG.
     A delivery fee is a flat distance band — it has nothing to do with how much
     the rice weighed — but it was scaled down with the rest, so a shop typing
     40 kg on a 3 kg order pushed the rider from ₹14.00 to ₹1.15 and took the
     difference. Escrow still balanced, so no invariant caught it: the shop had
     simply been handed a lever on somebody else's money.

     What the cap may touch is what the WEIGHT determines — the basket, and the
     commission taken from it. The ride and the dispatch cut are fixed by
     distance and stay exactly where the quote put them, and the shop's payout
     is whatever is left after them. Over-weighing can now only ever cost the
     shop, which is the correct direction for a mistake it alone controls. */
  const flatRider = q.riderPayout | 0;
  const flatDispatch = Math.max(0, q.customerPays - q.itemsTotal - flatRider) | 0;
  const room = Math.max(0, capped - flatRider - flatDispatch);
  const scale = q.itemsTotal > 0 ? Math.min(1, room / q.itemsTotal) : 1;
  const cut = v => Math.round((v | 0) * scale);

  dispatch({ type: 'order/patch', payload: { id: orderId, patch: {
    lines,
    agreedTotal: agreed,                        // pinned the first time, then never moved
    weighedTotal: q.customerPays,
    overEstimate: Math.max(0, q.customerPays - agreed),
    reweighed: under,
    /* only the capped figure is ever charged, and the refund itself is posted
       once, at settlement, so correcting a typo costs nobody anything */
    customerPays: capped,
    /* the weighed truth, kept as it is — a statement that reports a basket
       nobody ever ordered is its own kind of lie */
    weighedItemsTotal: q.itemsTotal,
    itemsTotal: cut(q.itemsTotal),
    platformFee: cut(q.platformFee),
    gst: cut(q.platformFeeGst),
    shopPayout: Math.max(0, capped - flatRider - flatDispatch - cut(q.platformFee)),
    riderPayout: flatRider,          // a distance band, never scaled by weight
    overWeighAbsorbed: Math.max(0, q.customerPays - capped),
  } } });
  ctx.render();
  return q;
}

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
  /* REFUNDED A STALE FIGURE. A reweighed order holds `agreedTotal` in escrow
     while `customerPays` has come down, so refunding the latter left the
     difference stranded in a closed order — under a screen promising "your
     money comes back in full". Refund what is actually held. */
  const heldBack = Math.max(0, balanceOf(getState().ledger, acct.escrow(o.id)));
  if (heldBack) await ledger('REFUND', heldBack, acct.escrow(o.id), acct.customer(o.customerKey), { reason: 'return' });
  const a = getState().agg;
  bumpAgg({ refunds: a.refunds + o.customerPays, escrow: Math.max(0, a.escrow - (o.customerPays | 0)) });
  /* NOTHING IN THE PRODUCT EVER INCREMENTED THIS. The free-first-30 was read in
     three places and written in none, so every real shop stayed on order zero
     for ever: SAAHAA collected no retail commission at all, the 3%-capped-₹25
     branch was unreachable on any real install, and every "30 free orders left"
     countdown was frozen at 30.

     It survived four audits because each mode only ever exercised the branch
     the other one got wrong — ?demo=1 seeds shops at 60–560 orders, so the demo
     only ever showed the paid branch and a real install only ever showed the
     free one. */
  {
    const sh = getState().shops.find(x => x.id === o.shopId);
    if (sh) dispatch({ type: 'shop/patch', payload: { id: sh.id, patch: {
      ordersCompleted: ((sh.ordersCompleted | 0) + 1) } } });
  }
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

  /* SETTLEMENT DISTRIBUTES WHAT IS HELD, AND NOTHING ELSE.
     Three separate bugs all had the same shape: a figure on the order was
     trusted over the escrow balance. An over-weigh left `shopPayout` above the
     capped charge; a line refund bigger than the shop's share was posted in
     full while the payout merely clamped at zero; and a reweighed order
     refunded `o.customerPays` while escrow still held `agreedTotal`. Two of
     those drove escrow NEGATIVE — the system paid out more than it ever
     collected — and the third stranded money in a closed order for ever.

     So the order is now: give the customer back what is hers, then read what
     is actually left, then hand out the rest in priority order, and let the
     dispatch cut absorb the residual so the account lands at exactly zero. */
  const held0 = balanceOf(getState().ledger, acct.escrow(o.id));

  /* 1 · hers first — the reweigh difference and any line she did not receive */
  const reweighBack = Math.max(0, held0 - (o.customerPays | 0));
  const refundNow = Math.min(Math.max(0, lineRefund), Math.max(0, held0 - reweighBack));
  const backToHer = reweighBack + refundNow;
  if (backToHer) {
    await ledger('REFUND', backToHer, acct.escrow(o.id), acct.customer(o.customerKey),
      { reason: reweighBack && refundNow ? 'weighed lighter, and items not supplied'
        : reweighBack ? 'weighed lighter than ordered' : 'items not supplied' });
    dispatch({ type: 'order/patch', payload: { id: orderId, patch: {
      reweighRefund: reweighBack || undefined, refund: refundNow || undefined } } });
  }

  /* 2 · what is genuinely left to share out */
  let left = Math.max(0, held0 - backToHer);
  const take = want => { const n = Math.max(0, Math.min(want | 0, left)); left -= n; return n; };
  const shopPayout = take(o.shopPayout - refundNow);
  const feePart = take(feeExGst);
  const gstPart = take(o.gst);
  const riderPart = take(o.riderPayout);
  const dispatchCut = left;                       // the residual, so escrow ends at 0

  if (shopPayout)  await ledger('SHOP_PAYOUT', shopPayout, acct.escrow(o.id), acct.shop(o.shopId), {});
  if (refundNow)   dispatch({ type: 'order/patch', payload: { id: orderId, patch: { shopPayout } } });
  if (feePart)     await ledger('FEE', feePart, acct.escrow(o.id), acct.fee(), {});
  if (gstPart)     await ledger('GST', gstPart, acct.escrow(o.id), acct.gst(), {});
  if (riderPart)   await ledger('RIDER', riderPart, acct.escrow(o.id), acct.rider(), {});
  if (dispatchCut) await ledger('DISPATCH', dispatchCut, acct.escrow(o.id), acct.fee(), {});

  const a = getState().agg;
  /* the aggregates report what MOVED, not what the order once said it would */
  bumpAgg({ retailOrders: a.retailOrders + 1, gmv: a.gmv + o.itemsTotal - refundNow,
            revenue: a.revenue + feePart + dispatchCut, gst: a.gst + gstPart,
            refunds: a.refunds + backToHer,
            escrow: Math.max(0, a.escrow - held0) });
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
  /* the same stale-figure bug as acceptReturn: refund what escrow holds */
  const heldOut = Math.max(0, balanceOf(getState().ledger, acct.escrow(o.id)));
  if (heldOut) await ledger('REFUND', heldOut, acct.escrow(o.id), acct.customer(o.customerKey), { reason });
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
