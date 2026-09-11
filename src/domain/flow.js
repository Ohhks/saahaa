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
import { applyTransition, canTransition, isTerminal } from './orders.js';
import { acct, holdbackFor, balanceOf, checkInvariants } from './ledger.js';
import * as gateway from '../core/gateway.js';
import * as W from './wallet.js';
import * as photos from '../core/photos.js';
import { quoteService, quoteRetail, compareWithApps, releaseService, cancelSplit, GST_RATE } from './pricing.js';
import { lockedMatch, rankShops, kmBetween, etaMins } from './match.js';
import { escrowTier, markupFor, trustScore, capOk, effectiveCap, PROVISIONAL_JOBS } from './trust.js';
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
  if (amt > w.balance) { toast(`You can withdraw up to ${M.fmtMax(w.balance)}`, 'warn'); return null; }
  if (amt < MIN_WITHDRAW) { toast(`The smallest withdrawal is ${M.fmt(MIN_WITHDRAW)}`, 'warn'); return null; }
  if (!shop.upi) { toast('Add the UPI id this shop is paid into first', 'warn'); return null; }
  const r = await gateway.payout({ paise: amt, purpose: 'shop-payout', key: shopId, upi: shop.upi });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.shop(shopId), acct.world(), { via: r.via, ref: r.ref });
  /* AND THE APP THEN TOLD HER NOTHING HAD EVER BEEN PAID. The ledger leg was
     posted and `paidOut` was never written — a field only the ADMIN route sets
     (`admin.markpaid`) — while the Payouts tab derives "sent to bank" and
     "awaiting" from exactly that field. So seconds after the toast said
     "₹196 sent to srilakshmi@ybl", her screen read SENT TO BANK ₹0, AWAITING
     ₹0, and "No payout has cleared yet" above a list still showing the ₹196.
     Permanently: on the shop's own exit that field could never become true.

     8.6.0 gave the shop its own withdraw button and did not give it the write.
     Oldest settled order first, up to what actually left — the same order the
     money itself came from. */
  {
    const at = Date.now();
    let left = amt;
    const owed = getState().orders
      .filter(o => o.shopId === shopId && o.settledAt && !o.paidOut && (o.shopPayout | 0) > 0)
      .sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
    for (const o of owed) {
      const worth = (o.shopPayout | 0) + (flags.isOn('RIDER_POOL') ? 0 : (o.riderPayout | 0));
      if (worth > left) break;
      left -= worth;
      dispatch({ type: 'order/patch', payload: { id: o.id, patch: { paidOut: true, paidOutAt: at } } });
    }
  }
  audit.record('shop.withdraw', { shopId, amt }, me() && me().key);
  /* A CONFIRMATION FOR AN IRREVERSIBLE TRANSFER MAY NOT ROUND. A shop asked
     for ₹150.50, the button said "Send ₹150.50", the engine moved exactly
     15050 paise -- and the toast said "₹151 sent", fifty paise more than had
     left. The pro's book shows paise and the shop's rounded to rupees, so the
     two partner ledgers disagreed about precision on the same act. */
  toast(`${M.fmt2(amt)} sent to ${shop.upi}`);
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
  /* A FLOOR MUST NOT BECOME A TRAP. An item-level refund lands on odd paise, so
     a wallet routinely ends on something like ₹5.22 — below the floor, and
     therefore un-withdrawable — while `eraseBlockers` counted that same ₹5.22
     as money held and refused to delete her account. The refusal sheet then
     told her to take her money out: the app instructing her to do the one thing
     it would not let her do.

     The floor exists to stop dust-sized payout fees, and that reason does not
     apply when she is emptying the wallet. Taking ALL of it is always allowed. */
  /* AND THE MESSAGE ROUNDED THE ANSWER OUT OF EXISTENCE. `M.fmt` drops the
     paise, so a balance of ₹32.86 was shown — and refused — as "₹33": she was
     told she could take out ₹33, typed 33, and was told she could take out ₹33.
     There was no number she could have typed that the screen had given her.
     Every message about an exact balance uses `fmt2`; only round figures, like
     the ₹10 floor itself, may be printed round. */
  if (amt < 1000 && amt !== w.balance) {
    toast(`The smallest take-out is ${M.fmt(1000)} — or take the whole ${M.fmt2(w.balance)}`, 'warn');
    return null;
  }
  if (amt > w.balance) { toast(`You can take out up to ${M.fmt2(w.balance)}`, 'warn'); return null; }
  /* THE APP NEVER ASKED HER FOR A UPI ID — no screen anywhere sets one — and
     this sent the money anyway, to '', toasting "sent to your UPI". In sandbox
     that is a lie; on a live rail it is a payout into nowhere. */
  const dest = s.upi || (getState().users.find(u => u.key === s.key) || {}).upi || '';
  if (!dest) { toast('Add the UPI id you want to be paid into first', 'warn'); return null; }
  const r = await gateway.payout({ paise: amt, purpose: 'refund-out', key: s.key, upi: dest });
  if (!r.ok) { toast('Could not send that right now', 'danger'); return null; }
  await ledger('WITHDRAW', amt, acct.customer(s.key), acct.world(), { via: r.via, ref: r.ref });
  audit.record('cwallet.withdraw', { amt }, s.key);
  toast(`${M.fmt2(amt)} sent to ${dest}`);
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
  /* the same markup the bill above uses, or the comparison describes a
     different bill from the one she is looking at */
  const cmp = compareWithApps(deal, { markup: markupFor(partner || {}) });
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

/** MONEY THE BANK HAS ACTUALLY SEEN. Called once an admin has matched a UTR to
    the statement (domain/payments.js holds the decision; this posts the legs).
    Idempotent on purpose: clearing twice is a thing tired humans do at 7am, and
    it must not fund escrow twice. */
export async function fundClearedOrder(orderId, seenPaise = null) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (!o.awaitingPayment) return null;                 // already funded, or not a manual order
  const amt = seenPaise == null ? (o.customerPays | 0) : (seenPaise | 0);
  if (amt <= 0) return null;
  await ledger('ESCROW_IN', amt, 'CUSTOMER:' + o.customerKey, 'ESCROW:' + o.id,
               { via: 'upi-manual', orderId });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { awaitingPayment: false, collected: amt } } });
  bumpAgg({ escrow: getState().agg.escrow + amt });
  audit.record('payment.escrowFunded', { orderId, paise: amt }, me() ? me().key : 'admin');
  return amt;
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
  /* A MAN WAS SENT TO A NEIGHBOURHOOD NAME. The booking SHEET refuses to place
     an order without a door -- "Fill in the flat or house and street above" --
     and the ask-and-accept path called straight through to here, so a job won
     at auction carried `customerAddress: ""` and no screen showed one. Two ways
     in, one of them guarded.

     The guard belongs where the order is made, not on each screen that makes
     one: any future path gets it for free. */
  if (!String(s.address || '').trim()) {
    toast('Add the flat or house and street first — the pro needs a door to knock on.', 'warn');
    throw new Error('no address');
  }
  const cat = find('category', catId);
  const size = subSize(catId, sub);
  const price = deal ?? Math.round(partner.ask * size.x);
  /* AND I ENFORCED THE CAP ON THE WRONG PATH. `capOk` was wired into the
     on-site re-quote and nowhere else, so a pro one clean job old was still
     booked straight through at ₹1,760 against the ₹1,500 his recruiting page,
     his go-live screen and her booking sheet all promise. The cap is about how
     much a stranger may be trusted with, so it belongs where the job is
     ACCEPTED, not only where it is later repriced. */
  if (partner && !capOk(partner, price)) {
    toast(`${partner.name} is new to SAAHAA and can take jobs up to `
      + `${M.fmt(effectiveCap(partner))} for now. Pick a smaller job, or another pro.`, 'warn');
    throw new Error('provisional cap');
  }
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
    saved: compareWithApps(price, { markup: markupFor(partner) }).saved,
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
  /* ON THE MANUAL RAIL THERE IS NOTHING TO COLLECT YET. She has not paid when
     she taps Confirm -- she is about to, in her own bank's app -- so booking
     records an order AWAITING PAYMENT and funds no escrow. Escrow is posted by
     `fundClearedOrder` when an admin has matched the UTR to the statement.
     Anything else would let a tap create money the bank has never seen. */
  if (gateway.isManual()) {
    dispatch({ type: 'order/patch', payload: { id: order.id, patch: { awaitingPayment: true } } });
  } else {
    // the customer's money is in their SAAHAA wallet first (wallet balance, then the gateway for the rest); only then is it locked
    const paid = await fund(s.key, q.customerPays, 'service', { orderId: order.id });
    dispatch({ type: 'order/patch', payload: { id: order.id, patch: { paidFromWallet: paid.fromWallet, collected: paid.collected } } });
    await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id,
                 { catId, deal: q.deal, fee: q.platformFee, gst: q.gst });
    bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  }
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
  /* AND THAT SAME FILTER WAS A STANDING INVITATION TO ROB THE SHOP. It matches
     ANY disputed retail order — including one the SHOP raised — so a kirana
     that refused a return and escalated was auto-refunded against on the very
     same 24-hour clock. His only three moves at R_RETURN were: accept a full
     refund, do nothing and be refunded anyway, or escalate and be refunded
     anyway. Weighed rice and dal go out of the door and there was no point in
     the flow where he could say no.

     A dispute must STOP the clock, not run it. A contested return waits for a
     person; only an unanswered one refunds itself. */
  const returns = getState().orders.filter(o =>
    (o.stage === 'R_RETURN' || (o.stage === 'DISPUTED' && o.kind === 'retail'))
    && !o.returnContested
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
  /* THE GUARD HAD A CHECK IT NEVER RAN. `escrow.no-stranded` — the one that
     asks whether a FINISHED order is still holding money — only runs when it is
     handed the list of closed orders, and this, its only caller in the product,
     handed it nothing. So it sat there through every audit, unable to fire,
     while a cancellation left the platform's own share behind in escrow on
     every single cancelled job: the books still summed to zero, because the
     money was simply in the wrong account, and nothing was looking.

     The list is cheap to build and this runs before every payout. Not fatal —
     stranded money is wrong, not dangerous, and freezing all payouts over a
     historical residue would be worse than the residue. It is loud instead. */
  const closedOrderIds = (getState().orders || [])
    .filter(o => isTerminal(o.stage)).map(o => o.id);
  const r = checkInvariants(getState().ledger || [], { closedOrderIds });
  const stranded = (r.checks || []).find(c => c.id === 'escrow.no-stranded');
  if (stranded && !stranded.ok) {
    audit.record('ledger.stranded', { where, detail: stranded.detail }, 'system');
    console.warn('[saahaa] stranded escrow —', stranded.detail);
  }
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
  /* A SURVEY JOB MUST BE PRICED BEFORE IT IS STARTED. Otherwise the code — the
     one act that locks the stake and begins the work — would start it at the
     figure the app invented, which is the whole thing the promise on the
     booking sheet exists to prevent. */
  if (o.pricedOnSite && !o.onSiteAgreedAt) {
    toast('Quote the job first — she has to agree the price before you start', 'warn');
    return false;
  }
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
  /* THE STAKE WAS LOCKED AFTER THE SCREEN HAD ALREADY PAINTED. `advance` renders,
     then `lockStake` dispatched into a view that had finished drawing — so the
     "₹100 committed" chip was empty on the one render where his money moved,
     and appeared only if he navigated away and came back. A person is told
     their money moved, or they are not told at all. */
  lockStake(orderId);
  advance(orderId, 'IN_PROGRESS', { otpVerified: true, startedAt: Date.now() });
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
  if (p && o.stake.onCredit) {
    await ledger('STAKE_FORFEIT', o.stake.onCredit, acct.debt(p.id), acct.customer(o.customerKey), { orderId: o.id, reason, onCredit: true });
    dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { walletDebt: (p.walletDebt | 0) + o.stake.onCredit } } });
  }
  dispatch({ type: 'order/patch', payload: { id: o.id, patch: { stake: { ...o.stake, forfeited: true, forfeitedAt: Date.now(), reason } } } });
  audit.record('stake.forfeited', { id: o.id, funded: o.stake.funded, onCredit: o.stake.onCredit, reason }, 'system');
  return o.stake.need;
}
/* The Rs.100 an early cancellation costs the pro. Published on the public
   refunds page since 8.0 and collected by nothing until now — the fee existed
   only as a sentence. Taken from his wallet where there is one, and carried as
   `walletDebt` where there is not, exactly like an unfunded stake: a pro with
   an empty wallet must still be able to cancel rather than no-show, which is
   the whole point, so an empty wallet cannot be allowed to block it. */
async function chargeWorkerFee(o, paise, reason) {
  const fee = Math.max(0, paise | 0);
  if (!fee || !o.partnerId) return 0;
  const p = getState().partners.find(x => x.id === o.partnerId);
  const free = Math.max(0, balanceOf(getState().ledger, acct.partner(o.partnerId)));
  const paid = Math.min(fee, free);
  const owed = fee - paid;
  /* AND IT WENT IN WHOLE, WITH NO GST LEG. Every other commission path in this
     file splits fee-ex-GST from GST; a cancellation penalty is a taxable supply
     too, and about ₹6.10 of the ₹40 is the government's, not ours. */
  if (paid) {
    const ex = Math.round(paid / (1 + GST_RATE));
    const gstPart = paid - ex;
    if (ex) await ledger('CANCEL_FEE', ex, acct.partner(o.partnerId), acct.fee(), { orderId: o.id, reason });
    if (gstPart) await ledger('GST', gstPart, acct.partner(o.partnerId), acct.gst(), { orderId: o.id, reason });
  }
  /* AND THE UNFUNDED HALF WENT NOWHERE NEAR THE LEDGER. When his wallet was
     empty the whole ₹40 lived in `walletDebt` and in no entry at all — so the
     one charge SAAHAA levies against a pro was the one charge his own audit
     trail could not show him. It is posted against a DEBT account now, and the
     field is kept only as the fast read the UI already uses. */
  if (owed && p) {
    /* AND THE SPLIT WAS ONLY APPLIED TO THE FUNDED HALF. The same ₹40, under
       the same rule, was booked fee-plus-GST when he had a balance and flat
       with no GST leg at all when it became a debt -- so where the rupee landed,
       and whether the government got its share of it, depended on whether he
       happened to have money that day. The comment above this block says every
       commission path splits; this path did not. */
    const exOwed = Math.round(owed / (1 + GST_RATE));
    const gstOwed = owed - exOwed;
    if (exOwed) await ledger('CANCEL_FEE', exOwed, acct.debt(p.id), acct.fee(), { orderId: o.id, reason, onCredit: true });
    if (gstOwed) await ledger('GST', gstOwed, acct.debt(p.id), acct.gst(), { orderId: o.id, reason, onCredit: true });
    dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { walletDebt: (p.walletDebt | 0) + owed } } });
  }
  audit.record('partner.cancelFee', { partner: o.partnerId, orderId: o.id, fee, paid, owed }, 'system');
  return fee;
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
  if (amt > w.available) { toast(`You can withdraw up to ${M.fmtMax(w.available)}`, 'warn'); return null; }
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
  toast(`${M.fmt2(amt)} sent to your UPI`);
  return amt;
}
/** The 7-day holdback comes back by itself. Runs at boot and on the order screen. */
export async function sweepHoldbacks(now = Date.now()) {
  const due = W.holdbackDue(getState().ledger, now);
  for (const e of due) await ledger('HOLDBACK_RELEASE', e.amountPaise, e.partyB, e.partyA, { of: e.id });
  return due.length;
}

export async function confirmAndRelease(orderId, pct = 1) {
  /* escrow → anybody is money leaving the system too; the guard was on the
     wallet only, so a frozen book still settled orders. */
  if (!assertBookOk('release')) return null;
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

  if (r.workerPayout) await ledger('ESCROW_RELEASE', r.workerPayout, acct.escrow(o.id), acct.partner(o.partnerId), { pct, orderId: o.id });
  /* THE PROMISE: on a finished job the worker receives the whole locked stake
     back and the whole of their quote; on a fully upheld dispute (nothing
     released) the stake goes to the customer instead. */
  if (pct > 0) await returnStake(getState().orders.find(x => x.id === orderId));
  else await forfeitStake(getState().orders.find(x => x.id === orderId), 'dispute upheld');
  let heldBackNow = 0;
  if (r.workerPayout) {
    const p0 = getState().partners.find(x => x.id === o.partnerId) || {};
    /* a debt from a walked-out job is recovered from the next payout, once.
       READ OFF THE BOOK, not off `walletDebt`: the wallet screen was corrected
       to read the DEBT account and this was left on the mutable field, so the
       two could disagree about whether anything was owed -- and when they did,
       the recovery the screen promised simply never ran. An audit was told
       twice that ₹40 would come out of his next payout, took a payout, and
       watched nothing happen. One source for one fact. */
    const owedNow = Math.max(0, -balanceOf(getState().ledger, acct.debt(o.partnerId)));
    const debt = Math.min(owedNow, r.workerPayout);
    /* INTO `fee`, NOT `goodwill`. The same ₹40 cancellation fee landed in
       revenue when the pro had a wallet balance (`chargeWorkerFee`) and in
       PLATFORM:goodwill when he did not — an account documented as "credits we
       fund ourselves", which should only ever run negative. The book balanced
       either way, so nothing fired: the exact shape this release has now fixed
       three times. Where a rupee lands cannot depend on who happened to owe. */
    if (debt) {
      /* the recovery pays down the DEBT account the charge was posted against,
         so the two always tell the same story */
      await ledger('DEBT_RECOVERY', debt, acct.partner(o.partnerId), acct.debt(o.partnerId), { orderId });
      dispatch({ type: 'partner/patch', payload: { id: o.partnerId, patch: { walletDebt: (p0.walletDebt | 0) - debt } } });
    }
    // the ledger's holdback policy, posted for real: 10% of a payout, capped at Rs.500 cumulative, back after 7 days
    const held = W.walletOf(getState().ledger, o.partnerId, p0).pending;
    const hb = holdbackFor(r.workerPayout - debt, held);
    if (hb) await ledger('HOLDBACK', hb, acct.partner(o.partnerId), acct.holdback(o.partnerId), { orderId });
    heldBackNow = hb | 0;
  }
  if (r.platformFee) await ledger('FEE', r.platformFee, acct.escrow(o.id), acct.fee(), {});
  if (r.gst)         await ledger('GST', r.gst, acct.escrow(o.id), acct.gst(), { orderId: o.id });
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
  /* AND THE TOAST NAMED THE GROSS. "₹556 released to Ramesh" on a release that
     put ₹500.76 in his wallet and held ₹55.64 for seven days -- true of the
     total, false of the moment it describes. It says what actually moved. */
  /* the holdback actually posted a few lines up — not a guess at it: my first
     version read a field that does not exist, which would have made this a
     silent no-op that still looked fixed */
  const heldBack = heldBackNow | 0;
  toast(pct >= 1
    ? (heldBack
        ? `${M.fmt2((r.workerPayout | 0) - heldBack)} released to ${o.partnerName} — ${M.fmt2(heldBack)} waits 7 days`
        : `${M.fmt2(r.workerPayout)} released to ${o.partnerName}`)
    : `Partial — ${M.fmt2(r.refund)} refunded`);
}

export async function cancelOrder(orderId, ruleId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const pc = getState().partners.find(p => p.id === o.partnerId) || {};
  const split = cancelSplit(o.deal, ruleId, { markup: markupFor(pc) });
  /* AND THE ORDER REMEMBERED HER REFUND BUT NOT HIS PAYMENT. `split.worker` is
     posted to the ledger as COMPENSATION a few lines below and was written
     nowhere on the order -- so his own job screen, which reads the order, could
     only say "You were not paid for it" while his passbook showed
     `Compensation +₹168.00` for that very job, and her cancel sheet had already
     told her he keeps it. Whatever the book pays him, the order records. */
  /* AND SAAHAA'S OWN SHARE WAS NEVER WRITTEN DOWN EITHER. On a cancellation
     `platform` is `customerPays − refund − worker`, which on a job abandoned
     en route came to ₹147.84 — while BOTH bills went on printing the original
     "platform fee ₹76 · GST ₹14 · together ₹90, the 8% SAAHAA adds on top",
     because that is what the order still carried. An audit found the ₹148 in
     the ledger, saw ₹90 on both screens, and had no way to learn the real
     figure from anywhere in the pro's app. What is taken is recorded. */
  if (!advance(orderId, 'CANCELLED', { cancelRule: ruleId, refund: split.refund,
      workerKept: split.worker | 0, platformKept: split.platform | 0,
      cancelledAt: Date.now() })) return;
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
  /* CANCELLING COST HIM EXACTLY WHAT NO-SHOWING COST HIM, AND THE SHEET SAID
     IT DID NOT. "Cannot do this job?" promises in so many words: "you keep your
     stake, and this is recorded as a cancellation, not a no-show" — and then
     this line forfeited the stake to the customer and turned any on-credit part
     into `walletDebt`. A pro who did the honest thing the agreement asks of him,
     because the app told him it was free, lost the same money as one who simply
     did not turn up. There was then no reason left to cancel at all, which is
     precisely the behaviour the feature exists to buy.

     So the two are no longer the same act. A no-show forfeits. An early cancel
     returns the stake and charges the Rs.100 already published on the public
     refunds page (`CANCEL_RULES.WORKER_CANCEL.workerFee`, printed by
     ui/views/legal.js) — a figure the world was shown for six versions and
     nothing ever collected. Deterrent enough to matter, cheap enough that
     telling the truth stays the better move. */
  if (ruleId === 'WORKER_NO_SHOW' && o.stake) await forfeitStake(o, ruleId);
  else if (o.stake) await returnStake(o);          // he cancelled early, or she did — not a forfeit
  if (ruleId === 'WORKER_CANCEL' && split.workerFee) await chargeWorkerFee(o, split.workerFee, ruleId);
  if (split.refund) await ledger('REFUND', split.refund, acct.escrow(o.id), acct.customer(o.customerKey), { ruleId });
  /* the two biggest lines in his passbook named no job, so "which job was that
     ₹256.50 for?" had no answer in the app — and a cancelled job never appears
     in Recent Jobs either. A leg about an order says which order. */
  if (split.worker) await ledger('COMPENSATION', split.worker, acct.escrow(o.id), acct.partner(o.partnerId), { ruleId, orderId: o.id });
  /* AND SAAHAA'S OWN SHARE WAS COMPUTED, SHOWN, AND NEVER POSTED. `cancelSplit`
     returns `platform = customerPays - refund - worker`, the cancel sheet tells
     the customer "SAAHAA keeps ₹74" — and nothing moved it, so ₹73.92 stayed in
     the escrow account of a CANCELLED order for ever. The book still totalled
     zero, which is exactly why nobody found it: the money was not lost, it was
     parked where nothing would ever look. Every cancellation quietly inflated
     escrow and drove "what we hold" apart from "what we owe".

     It is taken LAST and clamped to what is actually left, so a rounding paisa
     can never overdraw the account the two payments above just drew down. */
  const leftInEscrow = balanceOf(getState().ledger, acct.escrow(o.id));
  const platformTake = Math.max(0, Math.min(split.platform | 0, leftInEscrow));
  /* AND THE GOVERNMENT'S SHARE OF IT. Every other commission path splits the
     take into fee-ex-GST and GST — `quoteService` does, `settleRetail` does —
     and this posted the whole ₹75.27 to PLATFORM:fee with no GST leg at all.
     About ₹11.48 of that is not ours. GST is money owed, not revenue, which is
     why the invariant `gst.non-negative` exists at all. */
  if (platformTake) {
    const ex = Math.round(platformTake / (1 + GST_RATE));
    const gstPart = platformTake - ex;
    if (ex) await ledger('FEE', ex, acct.escrow(o.id), acct.fee(), { ruleId });
    if (gstPart) await ledger('GST', gstPart, acct.escrow(o.id), acct.gst(), { ruleId, orderId: o.id });
  }
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

/* ── the price only the person standing there can set ──────────
   `pricedOnSite` was written onto every survey-priced order and read by
   NOTHING — it was the only mention of the word in the repo — while
   ui/views/home.js told the customer in bold: "₹X is the estimate; he confirms
   it when they arrive and nothing starts until you approve the number."
   `o.deal` was written once at booking, from a hidden multiplier table the pro
   had never seen, and never patched anywhere. Twenty-one sub-services carry
   `survey: true`: pipeline replacement at 2.2x, house shifting at 3.0x,
   termite treatment at 2.0x — the biggest jobs on the list.

   So the pro arrived at a job escrowed at a number the app invented, and his
   only moves were to work at a loss, take cash (banned, and the conduct quiz
   he passed says so), or cancel and pay the fee. The promise is kept here. */

/* Three times the estimate, and no further without a conversation. */
export const ON_SITE_MAX_MULTIPLE = 3;

/** Pro, standing in front of the work: this is what it actually costs. */
export function proposeOnSitePrice(orderId, dealPaise) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (!o.pricedOnSite) { toast('This job was booked at a fixed price', 'warn'); return null; }
  if (o.stage !== 'ARRIVED') { toast('Quote it once you have arrived and seen the job', 'warn'); return null; }
  const deal = M.int(dealPaise);
  if (deal <= 0) { toast('Put in what the job costs', 'warn'); return null; }
  /* A SURVEY PRICE IS NOT A BLANK CHEQUE. She agreed to an estimate; a quote
     that multiplies it without limit is how a doorstep becomes a hostage
     negotiation. Above the ceiling he has to talk to her, not type at her. */
  const ceiling = Math.round((o.deal | 0) * ON_SITE_MAX_MULTIPLE);
  if (deal > ceiling) {
    toast(`More than ${M.fmt(ceiling)} has to be agreed in chat first — she was quoted ${M.fmt(o.deal)}`, 'warn');
    return null;
  }
  /* AND THE CAP THE PRODUCT ADVERTISES WAS COMPUTED AND NEVER CHECKED.
     `trust.capOk` has existed unused: a pro three jobs into the platform is
     told, on the recruiting page and again on the go-live screen, that his
     first jobs are limited to ₹1,500 -- and an audit priced a doorstep job at
     ₹3,000 and watched it go straight through to "₹3,240 sent for approval".
     The ceiling above limits him relative to HER estimate; this is the separate
     promise about how much a stranger may be trusted with at all, and it is the
     one the customer is relying on. */
  const pro = getState().partners.find(x => x.id === o.partnerId) || {};
  if (!capOk(pro, deal)) {
    toast(`Your first ${PROVISIONAL_JOBS} jobs are capped at ${M.fmt(effectiveCap(pro))}. `
      + 'Finish them with no complaint and the cap lifts by itself.', 'warn');
    return null;
  }
  const q = quoteService(deal, { markup: markupFor(pro) });
  advance(orderId, 'AWAITING_APPROVAL', {
    proposedDeal: deal, proposedPays: q.customerPays, proposedAt: Date.now(),
    estimateDeal: o.estimateDeal != null ? o.estimateDeal : o.deal,
  });
  audit.record('order.onSiteQuote', { id: orderId, from: o.deal, to: deal }, me() && me().key);
  toast(`${M.fmt(q.customerPays)} sent for approval. Nothing starts until she says yes.`);
  return q;
}

/** Customer: yes. The difference is collected or returned, then the door code
    still has to be typed — approving a price is not starting the work. */
export async function approveOnSitePrice(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'AWAITING_APPROVAL' || o.proposedDeal == null) return null;
  if (!assertBookOk('reprice')) return null;
  const held = balanceOf(getState().ledger, acct.escrow(o.id));
  const want = o.proposedPays | 0;
  if (want > held) {
    /* she pays the difference the same way she paid the first time */
    const extra = want - held;
    const paid = await fund(o.customerKey, extra, 'reprice', { orderId: o.id });
    await ledger('ESCROW_IN', extra, acct.customer(o.customerKey), acct.escrow(o.id), { reason: 'priced on site' });
    dispatch({ type: 'order/patch', payload: { id: orderId, patch: {
      paidFromWallet: (o.paidFromWallet | 0) + paid.fromWallet, collected: (o.collected | 0) + paid.collected } } });
    bumpAgg({ escrow: getState().agg.escrow + extra });
  } else if (want < held) {
    const back = held - want;
    await ledger('REFUND', back, acct.escrow(o.id), acct.customer(o.customerKey), { reason: 'priced on site, and it was less' });
    bumpAgg({ escrow: Math.max(0, getState().agg.escrow - back) });
  }
  const q = quoteService(o.proposedDeal, { markup: markupFor(getState().partners.find(x => x.id === o.partnerId) || {}) });
  advance(orderId, 'ARRIVED', {
    deal: o.proposedDeal, customerPays: q.customerPays, workerPayout: q.workerPayout,
    platformFee: q.platformFee, gst: q.gst, uplift: q.uplift,
    proposedDeal: null, proposedPays: null, onSiteAgreedAt: Date.now(),
  });
  audit.record('order.onSiteApproved', { id: orderId, deal: o.proposedDeal }, me() && me().key);
  toast(`Agreed at ${M.fmt(q.customerPays)}. Read out your code and the work starts.`);
  return q;
}

/** Customer: no. She was promised she could walk away at this exact moment and
    pay nothing, so this is a full refund and it costs the pro nothing either —
    he quoted honestly for work she chose not to buy. */
export async function declineOnSitePrice(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'AWAITING_APPROVAL') return null;
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { proposedDeal: null, proposedPays: null } } });
  const out = await cancelOrder(orderId, 'AFTER_ACCEPT_2H');   // full refund, nothing held against him
  audit.record('order.onSiteDeclined', { id: orderId }, me() && me().key);
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
/* AND A BASKET IS NOT A JOB. This keyed on ROLE alone, so a customer reporting
   a problem with groceries was offered "Not done", "Late / No-show", "Rude or
   unsafe" and "Wrong person came" -- seven ways to complain about a tradesman,
   about a jar of ghee -- and no way at all to say the thing that actually went
   wrong: an item missing, the wrong item, something spoiled or short-weighed.
   It is the only complaint route a grocery order has. */
export const RETAIL_DISPUTE_REASONS = [
  'An item is missing', 'Wrong item sent', 'Stale or spoiled',
  'Short weight', 'Damaged or leaking', 'It never arrived', 'Charged too much',
];
export const reasonsFor = (role, kind) => role === 'shop' ? SHOP_DISPUTE_REASONS
  : role === 'partner' ? PARTNER_DISPUTE_REASONS
  : kind === 'retail' ? RETAIL_DISPUTE_REASONS : DISPUTE_REASONS;
/* Let them try the code again. Only for a job stuck by a mistyped code — never
   for a real complaint, which is somebody's money and not a typo. The fail
   count resets so the pro is not one keystroke from the same dead end. */
/* The retail handover check. Same forgiving comparison as the service door —
   a person is reading digits out on a doorstep either way. */
export function checkRetailCode(orderId, entered) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return false;
  /* THE GROCERY DOOR HAD NO LOCK ON IT. `verifyOtp` — the service door, forty
     lines up — counts failures, stops at three and raises a real dispute. This
     one just said "wrong code" and let the rider try again, and again, for
     ever. A nine-character code is not guessable by hand, but a rider standing
     at the door with the phone is not guessing at random: they have the shape,
     they know the prefix is C, and nothing was counting. Worse, the two doors
     behaved differently for no reason a customer could ever discover.

     Same rule, same count, same dispute. A retail order that fails three times
     freezes with her money still in escrow and lands in the owner's queue,
     where `retryDoorCode` can reopen it — rather than a rider hammering a
     field or, having given up, marking delivered with nobody's code at all. */
  if (!sameCode(entered, o.otp)) {
    const fails = (o.otpFails || 0) + 1;
    dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpFails: fails } } });
    audit.record('retail.codeFailed', { id: orderId, fails }, me() && me().key);
    toast(fails >= 3 ? t('door.tooMany') : t('door.wrong'), 'danger');
    if (fails >= 3 && !(getState().disputes || []).some(d => d.orderId === orderId && d.status === 'OPEN')) {
      raiseDispute(orderId, 'Code would not verify at the door',
        'The code was entered incorrectly three times. Nothing has been paid out; her money is still held.',
        { silent: true });
    }
    return false;
  }
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpVerified: true, otpFails: 0 } } });
  audit.record('retail.codeVerified', { id: orderId }, me() && me().key);
  return true;
}

export function retryDoorCode(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'DISPUTED' || o.disputeReason !== 'Code would not verify at the door') return null;
  const open = (getState().disputes || []).find(d => d.orderId === orderId && d.status === 'OPEN');
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id, patch: { status: 'RESOLVED', outcome: 'retry' } } });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpFails: 0, disputed: false, disputeReason: null } } });
  /* back to the doorstep it came from — a grocery order returns to R_OUT, a
     job to ARRIVED. This used to send everything to ARRIVED, which is a service
     stage, so once retail could reach DISPUTED at all the retry would have
     thrown `illegal transition DISPUTED -> ARRIVED` and stranded the order. */
  advance(orderId, o.kind === 'retail' ? 'R_OUT' : 'ARRIVED', {});
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
    /* SAAHAA'S ₹5 A RIDER ORDER, WRITTEN DOWN. `quoteRetail` has always
       returned it and the order never kept it, so the shop's statement summed
       `o.dispatchCut` across orders that had none and printed nothing — a shop
       reading "3% of the basket" was funding 4.10% and no screen said so. */
    dispatchCut: q.dispatchCut | 0,
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
  /* THE FOURTH GENERATION OF THIS BUG, AND IT HID IN AN OMITTED ARGUMENT.
     `cartQuote` passes `freeDeliveryAbove` and this re-quote did not — so a
     basket that qualified for free delivery lost it the moment the shop weighed
     anything, and ₹19 of her refund quietly became a delivery charge she had
     been told was free. The order still said `shopAbsorbedDelivery: true`.
     Escrow balanced perfectly, which is exactly why three audits missed it.

     A re-quote has to be the SAME quote with a new weight. Every argument the
     original was given, this one is given too.

     AND THAT WAS STILL NOT ENOUGH — THE FIFTH GENERATION. Passing the threshold
     re-EVALUATES it against the new basket, so weighing 7.7 kg on an 8 kg order
     dropped Rs.503.92 to Rs.485.02, fell under the shop's Rs.499 line, and put
     the Rs.19 delivery back on a bill that had said "free". Her Rs.18.90 refund
     came out to Rs.0.00 — she weighed LESS and got NOTHING back, and the order
     went on reporting `shopAbsorbedDelivery: true`. Escrow balanced, so no
     invariant fired; only placing a real order and reading the numbers found it.

     Free delivery is a promise made at checkout. `shopAbsorbedDelivery` records
     that the promise was made; `alreadyFree` makes the re-quote honour it. */
  const q = quoteRetail(lines, { catId: shop.catId, km: o.km, mode: o.mode, firstOrders: first,
                                 freeDeliveryAbove: shop.freeDeliveryAbove,
                                 alreadyFree: o.shopAbsorbedDelivery === true });

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
  /* AND THE SCALING RAN EVEN WHEN THERE WAS NOTHING TO PROTECT HER FROM.
     `room` subtracts the rider from what she pays — which is right when she PAID
     for the ride, and wrong when the shop absorbed it under free delivery: there
     the ₹14 comes out of the shop's margin, not out of her basket. So an
     ordinary short weigh scaled `itemsTotal` down by the rider's fee and the
     shop's own screen read "Basket ₹1,362" under "Total ₹1,376" — a basket
     nobody ever ordered, which is the exact lie the comment above forbids.

     Worse, `dispatchCut` was never re-patched, so it kept the figure from
     placement while `flatDispatch` had moved: shopPayout + fee + rider +
     dispatch came to ₹5 MORE than was ever collected. The ledger stayed right
     because settlement distributes the residual, so nothing caught it — the
     order's own arithmetic was simply wrong wherever a screen read it.

     The cap exists for ONE case: she weighed heavier than she agreed. In every
     other case the re-quote is already a coherent quote and is used as it
     stands. Scaling a correct quote is how it stopped being one. */
  const overWeighed = q.customerPays > agreed;
  const flatRider = q.riderPayout | 0;
  const flatDispatch = q.dispatchCut | 0;
  const room = Math.max(0, capped - flatRider - flatDispatch);
  const scale = overWeighed && q.itemsTotal > 0 ? Math.min(1, room / q.itemsTotal) : 1;
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
    deliveryFee: overWeighed ? (o.deliveryFee | 0) : (q.deliveryFee | 0),
    platformFee: cut(q.platformFee),
    gst: cut(q.platformFeeGst),
    /* `platformFee` IS GST-INCLUSIVE — `platformFeeGst` is the tax INSIDE it, not
       a second charge on top (see quoteRetail, and settlement's
       `feeExGst = platformFee − gst`). An earlier pass here subtracted both and
       so underpaid the shop by the tax, with the residual handing it to SAAHAA;
       the assertion written alongside double-counted the same way, so the two
       errors cancelled and the journey went green. SAAHAA's take is one number. */
    shopPayout: overWeighed
      ? Math.max(0, capped - flatRider - flatDispatch - cut(q.platformFee))
      : (q.shopPayout | 0),
    riderPayout: flatRider,          // a distance band, never scaled by weight
    dispatchCut: flatDispatch,       // and it moves with the quote, or it lies
    shopAbsorbedDelivery: !!q.shopAbsorbs,
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
/* A RETURN USED TO BE ALL OR NOTHING. One stale ₹42 packet of turmeric took a
   ₹501 order back with it -- including a 5 kg bag of atta that was perfectly
   good and that the shop then had to take back, restock and lose the sale on.
   Neither side wants that, and no kirana in Hyderabad works that way.

   `lineIds` names what is actually going back. Empty or missing means the whole
   basket, which is what every existing caller passes and what the customer gets
   if the problem is the order rather than an item in it. */
export function requestReturn(orderId, reason, lineIds) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_DELIVERED') return null;
  const ids = Array.isArray(lineIds) ? lineIds.filter(Boolean) : [];
  const all = !ids.length || ids.length === (o.lines || []).length;
  const moved = advance(orderId, 'R_RETURN', { returnReason: reason || 'not as expected', returnAt: Date.now(),
    returnLines: all ? null : ids });
  if (moved) { audit.record('retail.return', { id: orderId, reason }, me() ? me().key : 'system'); toast('Return requested. The shop will confirm.'); }
  return moved;
}
/* The value of the items going back, at the price she was actually charged for
   them -- picked weight where it was weighed, ordered quantity where it was not. */
export function returnedValueOf(o) { return o && (o.returnLines || []).length ? returnedValue(o) : 0; }

function returnedValue(o) {
  const ids = new Set(o.returnLines || []);
  return (o.lines || []).filter(l => ids.has(l.lineId)).reduce((n, l) => {
    /* WHAT SHE PAID FOR IT, WHICH IS NOT WHAT IT WEIGHED. A shop that weighs
       2.2 kg against 2 kg ordered gives the extra away -- she is charged for the
       2 kg she agreed to. Refunding the WEIGHED value then handed her ₹83.60 for
       onions she had paid ₹76 for, so the shop paid for its own gift twice: once
       in stock, once in cash. She is never billed above what she ordered, so a
       refund is never above it either. */
    const billed = l.pickedQty != null ? Math.min(l.pickedQty, l.qty) : l.qty;
    return n + Math.round((l.unitPrice | 0) * billed);
  }, 0);
}

/* Refund what came back, settle the rest. Escrow is the ceiling: a partial
   refund can never exceed what is actually held, so a returned basket cannot
   mint money even if the lines were repriced between delivery and the return. */
async function partialReturn(o) {
  const held = Math.max(0, balanceOf(getState().ledger, acct.escrow(o.id)));
  const want = returnedValue(o);
  const give = Math.min(want, held);
  /* HER MONEY FIRST, THEN WHATEVER IS LEFT. Settlement already distributes what
     escrow actually holds rather than what the order says it should -- three
     separate bugs were fixed by making it work that way -- so refunding before
     it runs is all this needs: the shop is paid for the shopping she kept, and
     the dispatch cut absorbs the residual so the account still lands at zero.
     The order stays on the settlement path; it was never fully refunded. */
  if (give) await ledger('REFUND', give, acct.escrow(o.id), acct.customer(o.customerKey), { reason: 'partial return' });
  const a = getState().agg;
  bumpAgg({ refunds: a.refunds + give, escrow: Math.max(0, a.escrow - give) });
  /* AND LOWERING ONLY THE TOTAL SILENTLY PAID SAAHAA AND THE RIDER NOTHING.
     Settlement hands out what escrow holds in priority order and the shop is
     FIRST in that queue, so an order whose `shopPayout` still described the
     whole basket swallowed the smaller remainder entire: no FEE leg, no GST
     leg, no RIDER leg. An audit found a shop screen asserting "SAAHAA dispatch
     − ₹5" against a book that had never taken it, which is exactly the shape of
     defect this project keeps finding — a summary and the ledger disagreeing.

     A basket with an item taken out of it is a smaller basket, so it is
     re-quoted like one. The delivery is not re-quoted: it was driven either
     way, and whoever drove it is owed for it. */
  const shop = getState().shops.find(x => x.id === o.shopId) || {};
  const kept = (o.lines || []).filter(l => !(o.returnLines || []).includes(l.lineId));
  const q = quoteRetail(kept, { catId: shop.catId, km: o.km, mode: o.mode,
    firstOrders: freeOrdersLeft(shop) > 0, freeDeliveryAbove: shop.freeDeliveryAbove,
    alreadyFree: o.shopAbsorbedDelivery === true });
  const stillPays = Math.max(0, (o.customerPays | 0) - give);
  dispatch({ type: 'order/patch', payload: { id: o.id, patch: {
    customerPays: stillPays,
    itemsTotal: q.itemsTotal,
    platformFee: q.platformFee,
    gst: q.platformFeeGst,
    shopPayout: Math.max(0, stillPays - (q.platformFee | 0)
      - (o.riderPayout | 0) - (o.dispatchCut | 0)),
    returnedValue: give, partialReturn: true, refundedAt: Date.now(),
  } } });
  await settleRetail(o.id);
  audit.record('retail.partialReturn', { id: o.id, amount: give }, me() ? me().key : 'admin');
  toast(`${M.fmt(give)} refunded for what came back. The rest of the order is settled.`);
  return getState().orders.find(x => x.id === o.id) || null;
}

/** Shop: this return is not fair, and here is why. Stops the 24-hour clock and
    hands it to a person — the shop's half of `requestReturn`, which existed
    from the first day the customer could ask. */
export function refuseReturn(orderId, reason) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_RETURN') return null;
  const why = String(reason || '').trim();
  if (why.length < 4) { toast('Say briefly why — the owner reads this', 'warn'); return null; }
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: {
    returnContested: true, returnRefusedReason: why, returnRefusedAt: Date.now() } } });
  raiseDispute(orderId, 'Return refused by the shop', why, { silent: true });
  audit.record('retail.returnRefused', { id: orderId, reason: why }, me() && me().key);
  toast('Sent to SAAHAA. Nothing is refunded until somebody has read both sides.');
  return true;
}

export async function acceptReturn(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o || o.stage !== 'R_RETURN') return null;

  /* A NAMED RETURN IS PAID FOR ITSELF AND NOTHING ELSE. She gets back exactly
     what the returned items cost her; the rest of the basket settles normally,
     so the shop is paid for the food she kept. The delivery is not refunded --
     it was driven either way, and whoever drove it is owed for it. */
  const back = (o.returnLines || []).length ? partialReturn(o) : null;
  if (back) return back;

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
     free one.

     The increment lives in `settleRetail`, NOT here. A returned order is not a
     completed order — counting it here both flattered the shop's record and
     spent one of its thirty free orders on a sale that came back. */
  advance(orderId, 'R_CLOSED', { closedAt: Date.now() });
  audit.record('retail.refunded', { id: o.id, amount: o.customerPays, reason: 'return' }, me() ? me().key : 'admin');
  toast(`${M.fmt(o.customerPays)} refunded for the return`);
  return o;
}

export async function settleRetail(orderId) {
  /* escrow → anybody is money leaving the system too; the guard was on the
     wallet only, so a frozen book still settled orders. */
  if (!assertBookOk('release')) return null;
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

  /* THESE LEGS CARRIED NO ORDER, AND A SCREEN THAT SCOPED BY ORDER READ ZERO.
     The shop's money column was corrected to count only the orders that column
     is about -- filtering its ledger legs through the ids on the other side --
     and these two posted with an empty meta, so the filter matched nothing.
     `yours` came out 0, the residual line absorbed the shop's entire earnings,
     and its monthly statement read "Yours ₹0" beside "Free delivery you gave
     − ₹416" for a delivery the customer had paid for. A leg that belongs to an
     order says which one. */
  if (shopPayout)  await ledger('SHOP_PAYOUT', shopPayout, acct.escrow(o.id), acct.shop(o.shopId), { orderId: o.id });
  if (refundNow)   dispatch({ type: 'order/patch', payload: { id: orderId, patch: { shopPayout } } });
  if (feePart)     await ledger('FEE', feePart, acct.escrow(o.id), acct.fee(), { orderId: o.id });
  if (gstPart)     await ledger('GST', gstPart, acct.escrow(o.id), acct.gst(), { orderId: o.id });
  /* THE RIDER DOES NOT EXIST YET, AND WE WERE PAYING HIM ANYWAY. There is no
     rider role, no rider signup, no rider console and no withdrawal path for
     `RIDER:pool` — `flags.RIDER_POOL` has said so, default-false, for six
     versions. Meanwhile the cart defaulted to "SAAHAA rider", the SHOP drove
     R_OUT and took the code at the door, and this line moved ₹14 into an
     account no human being can ever empty. On a free-delivery order the shop
     absorbed that ₹14 for a delivery it performed itself, and the money left
     the system for good.

     Until the network is switched on, the delivery money goes to whoever
     actually made the delivery. When RIDER_POOL is on, this is a rider's. */
  const deliveredByShop = !flags.isOn('RIDER_POOL');
  if (riderPart)   await ledger('RIDER', riderPart, acct.escrow(o.id),
                     deliveredByShop ? acct.shop(o.shopId) : acct.rider(), { deliveredByShop, orderId: o.id });
  if (dispatchCut) await ledger('DISPATCH', dispatchCut, acct.escrow(o.id), acct.fee(), { orderId: o.id });
  /* the residual is what was actually taken; the quote's figure was an estimate */
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { dispatchCut } } });

  /* AND THE FIX FOR THAT WENT INTO THE WRONG FUNCTION. The counter was added
     to `refundRetail` — the RETURN path — so it ticked when an order came back
     and never when one was delivered. A refunded order is not a completed one,
     and the happy path, which is nearly every order, still left a real shop on
     zero for ever: no commission, no countdown, the free-first-30 unspendable.
     A live order settled here and the shop stayed on 78. */
  {
    const sh = getState().shops.find(x => x.id === o.shopId);
    if (sh) dispatch({ type: 'shop/patch', payload: { id: sh.id, patch: {
      ordersCompleted: ((sh.ordersCompleted | 0) + 1) } } });
  }

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
/* ── after the money has already gone ──────────────────────────
   A GROCERY ORDER BECAME UNCOMPLAINABLE THE MOMENT SHE CONFIRMED IT.
   `settleRetail` closes straight through to R_CLOSED, and R_CLOSED has no
   edges, so "Report an issue" — gated on `canTransition(stage, 'DISPUTED')` —
   simply disappeared. Groceries are confirmed at the door and unpacked in the
   kitchen: the leaking oil pouch, the stale dal, the missing packet are all
   found ten minutes too late, and after that the only controls left on her
   screen were a map and a chat window.

   She can complain for a day after it closes. The stage does NOT move — the
   money has already been distributed and clawing it back out of a shop's
   settled wallet is a different and much worse thing to build. What opens is a
   real dispute in the owner's queue, and the remedy is goodwill: SAAHAA's own
   money, which needs nothing taken from anybody. */
export const COMPLAIN_AFTER_CLOSE_MS = 24 * 3600 * 1000;
export function complaintWindow(o) {
  if (!o || o.kind !== 'retail') return { open: false, msLeft: 0 };
  if (!['R_SETTLED', 'R_CLOSED'].includes(o.stage)) return { open: false, msLeft: 0 };
  const from = o.closedAt || o.settledAt || o.stageTs || 0;
  const msLeft = Math.max(0, from + COMPLAIN_AFTER_CLOSE_MS - Date.now());
  return { open: msLeft > 0, msLeft, hoursLeft: Math.ceil(msLeft / 3600000) };
}

/** The owner's remedy on an order that has already paid out: SAAHAA's own
    money, so nothing is taken back from a shop that has been paid and spent. */
export async function goodwillRefund(orderId, paise, reason) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (!assertBookOk('goodwill')) return null;
  const amt = Math.max(0, Math.min(paise | 0, o.customerPays | 0));
  if (!amt) { toast('Nothing to credit', 'warn'); return null; }
  await ledger('GOODWILL', amt, acct.goodwill(), acct.customer(o.customerKey), { orderId, reason });
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: {
    goodwillPaise: (o.goodwillPaise | 0) + amt, disputeOutcome: 'goodwill', disputeDecidedNote: reason || '' } } });
  const open = (getState().disputes || []).find(d => d.orderId === orderId && d.status === 'OPEN');
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id,
    patch: { status: 'RESOLVED', outcome: 'goodwill', resolvedBy: 'admin', resolvedAt: Date.now() } } });
  const a = getState().agg;
  bumpAgg({ refunds: a.refunds + amt });
  audit.record('retail.goodwill', { id: orderId, amount: amt, reason }, me() ? me().key : 'admin');
  toast(`${M.fmt(amt)} credited to ${o.customerName || 'the customer'}`);
  return amt;
}

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

  /* AND IT CLOSED HER COMPLAINT WITHOUT TELLING HER. Resolving it is right --
     a full refund settles what she complained about -- but it happened in
     silence: status OPEN to RESOLVED, the block gone from the order, no
     message. She had never withdrawn it. An outcome she is not told about is
     indistinguishable from one that was ignored. */
  const open = getState().disputes.find(d => d.orderId === o.id && !d.resolvedAt);
  if (open) dispatch({ type: 'dispute/resolve', payload: { id: open.id,
    patch: { status: 'RESOLVED', outcome: 'refund', closedBy: 'refund' } } });
  audit.record('retail.refunded', { id: o.id, amount: o.customerPays, reason }, me() ? me().key : 'admin');
  toast(open
    ? `${M.fmt2(o.customerPays)} refunded — and that closes the issue you reported`
    : `${M.fmt2(o.customerPays)} refunded to ${o.customerName}`);
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
/* A DELIVERED GROCERY ORDER COULD BE HELD FOR EVER. `R_DELIVERED → R_SETTLED`
   was reachable only from the customer's "Confirm delivery" button, and this
   sweep filters `kind === 'service'`, so a shopper who took the bag and closed
   the app left the kirana's ₹368 held with nothing on his screen to chase and
   no deadline anywhere. The service side has promised and delivered a timed
   auto-release since 7.0; retail had the same promise printed on the same
   screen and no machine behind it. */
export const RETAIL_AUTO_SETTLE_MS = 24 * 3600 * 1000;
export function retailSettleAt(o) {
  if (!o || o.kind !== 'retail' || o.stage !== 'R_DELIVERED') return 0;
  return (o.deliveredAt || o.stageTs || o.createdAt || 0) + RETAIL_AUTO_SETTLE_MS;
}
export async function sweepAutoRelease(now = Date.now()) {
  const due = getState().orders.filter(o => o.kind === 'service' && o.stage === 'WORK_DONE'
    && o.releaseAt && o.releaseAt <= now && o.escrowTier !== 'HOLD' && o.escrowTier !== 'FREEZE');
  for (const o of due) await confirmAndRelease(o.id, 1);

  const retailDue = getState().orders.filter(o => o.kind === 'retail' && o.stage === 'R_DELIVERED'
    && retailSettleAt(o) && retailSettleAt(o) <= now && !o.disputed);
  for (const o of retailDue) {
    await settleRetail(o.id);
    audit.record('retail.autoSettled', { id: o.id }, 'system');
  }
  return due.length + retailDue.length;
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
