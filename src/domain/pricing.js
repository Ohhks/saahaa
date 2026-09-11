/* SAAHAA · domain/pricing.js — THE money engine. Pure functions over
   core/money.js primitives. Nothing else in the app multiplies a rupee.

   ── SERVICES ────────────────────────────────────────────────────────────
   Deal price D (what the worker quotes). Customer pays D x 1.08.
   The worker keeps 100% of D — that is the whole product.

   GST CORRECTION (panel V4, confidence 5, adopted):
   the old model labelled the split "8% profit + 2% GST". That is wrong.
   GST on a marketplace commission is 18% OF THE COMMISSION, not 2% of D.
   Same customer total, correct labels:
       Service      D            = 1000.00
       Platform fee D*0.08/1.18  =   67.80   <- SAAHAA revenue
       GST @18%     fee*0.18     =   15.25   <- remitted, never revenue
       Customer pays             = 1100.00
   Invoice-correct, survives an audit, and customers trust a line-itemed bill.

   ── RETAIL ──────────────────────────────────────────────────────────────
   Products CANNOT carry the 8% service rate: kirana gross margin on staples
   is 3-6%, so 8% would exceed the entire margin on the items people order
   most (panel V2, confidence 5). Commission comes out of the SHOP's margin
   (3% staples / 5% high-margin, capped per order); the customer pays a
   separate, visible delivery fee — never baked into item prices. */

import * as M from '../core/money.js';
import { getPricing } from './settings.js';
import { find } from '../core/registry.js';

/* ── constants ─────────────────────────────────────────────── */
/* THE COMPANY EARNS ABOVE THE FAIR PRICE, NEVER OUT OF THE WORK. The worker's
   quote D is paid to the worker in full; SAAHAA's charge is 8% laid on top of
   it and paid by the customer. 8% is the whole of the platform's take on a
   service — GST on that fee is remitted, not kept. */
export const SERVICE_MARKUP = 0.08;   // launch default; the LIVE value is getPricing().serviceMarkupPct / 100
export const liveMarkup = () => getPricing().serviceMarkupPct / 100;
export const liveLoyaltyMarkup = () => getPricing().loyaltyMarkupPct / 100;
export const GST_RATE       = 0.18;   // GST on the platform fee
export const LOYALTY_MARKUP = 0.06;   // Tier-4 certified partners: 8% -> 6%
export const RETAIL_FEE_FLOOR = 500;  // Rs.5 minimum per retail order

/* delivery fee bands, in paise, by distance km */
export const DELIVERY_BANDS = [
  { maxKm: 2,   fee: 1900 },
  { maxKm: 4,   fee: 2900 },
  { maxKm: 6,   fee: 3900 },
  { maxKm: 999, fee: 4900 },
];
export const RIDER_DISPATCH_CUT = 500; // Rs.5 of the delivery fee is SAAHAA's

/* ── SERVICE quote ─────────────────────────────────────────── */
/**
 * @param {number} dealPaise  worker's quote, integer paise
 * @param {object} opts       {markup} override (Tier-4 loyalty rebate)
 * @returns full breakdown; every field is integer paise and they RECONCILE:
 *          workerPayout + platformFee + gst === customerPays
 */
export function quoteService(dealPaise, opts = {}) {
  const D = Math.max(0, dealPaise | 0);
  const markup = opts.markup ?? liveMarkup();
  const uplift = M.pct(D, markup * 100);              // the whole +8%
  const platformFee = Math.round(uplift / (1 + GST_RATE));
  const gst = uplift - platformFee;                   // remainder: never drops a paisa
  return {
    deal: D,
    workerPayout: D,
    uplift,
    platformFee,
    gst,
    gstRatePct: GST_RATE * 100,
    customerPays: D + uplift,
    markupPct: markup * 100,
  };
}

/** Partial release: the platform fee is ALWAYS pro-rata to the work released.
    Keeping the full fee on a half-done job reads as profiteering off a
    failure and is the fastest way to lose a customer permanently. */
export function releaseService(dealPaise, pct, opts = {}) {
  const q = quoteService(dealPaise, opts);
  const p = Math.max(0, Math.min(1, pct));
  const workerPayout = M.mul(q.deal, p);
  const uplift = M.mul(q.uplift, p);
  const platformFee = Math.round(uplift / (1 + GST_RATE));
  const gst = uplift - platformFee;
  const refund = q.customerPays - workerPayout - uplift;
  return { ...q, releasedPct: p, workerPayout, uplift, platformFee, gst, refund,
           reconciles: workerPayout + uplift + refund === q.customerPays };
}

/* ── COMPARISON: what a commission app would charge ────────────
   Honest, stated assumption: a 25%-commission aggregator plus a Rs.99
   convenience fee, for a pro whose TAKE-HOME IS THE SAME as ours.
     aggregator deal  = T / 0.75      (they must gross up to pay the pro T)
     customer pays    = that + Rs.99
   Never present this without the assumption label. */
export const AGG_COMMISSION = 0.25;
export const AGG_CONV_FEE   = 9900;

/* AND IT RE-QUOTED THE JOB AT A RATE THE BILL BESIDE IT WAS NOT USING. The
   booking sheet prices with the PARTNER's markup -- 6% for a tier-4 pro -- and
   this priced with the default 8%, so the two figures printed inches apart
   described different bills. "You pay ₹836" sat under "a typical app would
   charge ₹1,151 · YOU SAVE ₹299", and 1,151 − 299 = 852. It reconciled only
   for pros on the standard rate, which is why it survived: the comparison is
   right for most of the roster and silently wrong for the best of it.
   The caller passes the markup it is actually charging. */
export function compareWithApps(dealPaise, opts) {
  const q = quoteService(dealPaise, opts);
  const aggDeal = Math.round(q.workerPayout / (1 - AGG_COMMISSION));
  const typicalApp = aggDeal + AGG_CONV_FEE;
  const saved = typicalApp - q.customerPays;
  const aggWorkerOnSameCustomerSpend = M.mul(q.customerPays - AGG_CONV_FEE, 1 - AGG_COMMISSION);
  return {
    youPay: q.customerPays,
    typicalApp,
    saved: Math.max(0, saved),
    savedPct: typicalApp > 0 ? Math.round((saved / typicalApp) * 100) : 0,
    workerGets: q.workerPayout,
    workerWouldGet: aggWorkerOnSameCustomerSpend,
    workerUpside: q.workerPayout - aggWorkerOnSameCustomerSpend,
    assumption: '25% commission + ₹99 fee, pro paid the same take-home',
  };
}

/* ── RETAIL quote ──────────────────────────────────────────── */
export function deliveryFee(km, mode) {
  if (mode === 'pickup') return 0;
  const bands = getPricing().deliveryBands;
  const band = bands.find(b => km <= b.maxKm) || bands[bands.length - 1];
  return band.fee;
}

/**
 * @param {Array} lines  [{ qty, unitPrice, pickedQty? }]
 * @param {object} opts  { catId, km, mode:'self'|'rider'|'pickup', firstOrders:boolean }
 */
export function quoteRetail(lines, opts = {}) {
  const cat = find('category', opts.catId) || {};
  const P = getPricing();
  const takePct = opts.firstOrders ? 0 : (cat.takePct ?? P.retailTakePct);
  const cap = cat.takeCapPaise ?? P.retailTakeCapPaise;

  const itemsTotal = lines.reduce((sum, l) => {
    const qty = l.pickedQty != null ? l.pickedQty : l.qty;
    return sum + M.mul(l.unitPrice, qty);
  }, 0);

  let platformFee = M.pct(itemsTotal, takePct);
  platformFee = Math.min(platformFee, cap);
  if (itemsTotal > 0) platformFee = Math.max(platformFee, opts.firstOrders ? 0 : P.retailFeeFloorPaise);
  // the floor must never exceed the basket, or the shop is paid a negative
  // amount — which would trip the ledger's fatal non-negative invariant
  platformFee = Math.min(platformFee, itemsTotal);

  const mode = opts.mode || 'rider';

  /* "Free delivery over Rs.499" means free TO THE CUSTOMER — the rider still
     has to be paid. Charging the customer nothing and paying the rider nothing
     is not a discount, it is unpaid labour. So the two numbers are separate:
       customerDelivery — what appears on the bill
       riderCost        — what the ride actually costs, always paid
     and when delivery is free, the SHOP absorbs the rider cost out of its own
     margin, which is exactly what "free delivery" costs a real shop. */
  const freeAbove = opts.freeDeliveryAbove || 0;
  const bandFee = deliveryFee(opts.km ?? 2, mode);
  /* `alreadyFree` — FREE DELIVERY IS A PROMISE MADE AT CHECKOUT, NOT A RUNNING
     CONDITION. A basket that qualified when she agreed stays qualified when the
     shop weighs it, even if the real weight lands a few grams under the line.
     Without this an 8 kg order at Rs.503.92 (free, over Rs.499) weighed at
     7.7 kg fell to Rs.485.02, lost the promise, and the Rs.19 delivery ate her
     whole Rs.18.90 refund — she weighed LESS and was refunded NOTHING, and the
     order still read `shopAbsorbedDelivery: true` while charging her for it.
     A re-quote may lower her bill and may never quietly withdraw a promise. */
  const isFree = mode !== 'pickup'
    && (opts.alreadyFree === true || (freeAbove > 0 && itemsTotal >= freeAbove));
  const customerDelivery = isFree ? 0 : bandFee;
  const riderCost = mode === 'rider' ? bandFee : 0;

  const riderPayout = Math.max(0, riderCost - getPricing().riderDispatchCutPaise);
  const dispatchCut = Math.min(riderCost, getPricing().riderDispatchCutPaise);
  const shopDeliveryShare = mode === 'self' ? customerDelivery : 0;
  const shopAbsorbs = isFree ? riderCost : 0;
  const delivery = customerDelivery;

  // GST on OUR commission (the shop's own product GST is the shop's business)
  const feeExGst = Math.round(platformFee / (1 + GST_RATE));
  const feeGst = platformFee - feeExGst;

  return {
    itemsTotal,
    deliveryFee: delivery,
    customerPays: itemsTotal + delivery,
    platformFee,
    platformFeeExGst: feeExGst,
    platformFeeGst: feeGst,
    takePct,
    riderPayout,
    dispatchCut,
    shopPayout: itemsTotal - platformFee + shopDeliveryShare - shopAbsorbs,
    shopAbsorbs,
    riderCost,
    freeDelivery: isFree,
    platformRevenue: feeExGst + dispatchCut,
    mode,
    reconciles:
      (itemsTotal - platformFee + shopDeliveryShare - shopAbsorbs)   // shop
      + platformFee + riderPayout + dispatchCut                       // us + rider
      === itemsTotal + customerDelivery,                              // customer
  };
}

/* ── CANCELLATION TABLE (panel V4) ──────────────────────────
   Returns paise splits of the customer's original charge. */
export const CANCEL_RULES = {
  BEFORE_ACCEPT:   { refundPct: 1.00, workerPct: 0.00, label: 'Before a pro accepted — full refund' },
  AFTER_ACCEPT_2H: { refundPct: 1.00, workerPct: 0.00, label: 'More than 2h before the slot — full refund' },
  LATE_2H:         { refundPct: 0.90, workerPct: 0.05, label: 'Within 2h of the slot' },
  EN_ROUTE:        { refundPct: 0.60, workerPct: 0.30, label: 'Pro already on the way' },
  WORKER_NO_SHOW:  { refundPct: 1.00, workerPct: 0.00, label: 'Pro did not arrive — full refund + ₹100 credit', credit: 10000 },
  /* Rs.40, and the figure matters. It was Rs.100 — exactly `wallet.js MIN_STAKE`
     — so on the ordinary Rs.520 job, cancelling early cost a pro the same cash
     as simply not turning up, and the feature that exists to make honesty the
     cheaper move made it a wash. It has to sit under the SMALLEST stake the
     product can lock, because that is the one every small job carries. Nothing
     has ever collected this fee, so no pro has an expectation to break. */
  WORKER_CANCEL:   { refundPct: 1.00, workerPct: 0.00, label: 'Pro cancelled — full refund', workerFee: 4000 },
};

export function cancelSplit(dealPaise, ruleId, opts = {}) {
  const rule = CANCEL_RULES[ruleId] || CANCEL_RULES.BEFORE_ACCEPT;
  // must use the SAME markup the booking was escrowed at. A Tier-4 job is
  // escrowed at 6%; refunding it at 8% overdraws escrow by the difference.
  const q = quoteService(dealPaise, opts);
  const refund = M.mul(q.customerPays, rule.refundPct);
  const worker = M.mul(q.deal, rule.workerPct);
  const platform = q.customerPays - refund - worker;
  return { rule: ruleId, label: rule.label, refund, worker, platform,
           credit: rule.credit || 0, workerFee: rule.workerFee || 0,
           reconciles: refund + worker + platform === q.customerPays };
}

export { M as money };
