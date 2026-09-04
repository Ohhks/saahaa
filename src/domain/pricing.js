/* SAAHAA · domain/pricing.js — THE money engine. Pure functions over
   core/money.js primitives. Nothing else in the app multiplies a rupee.

   ── SERVICES ────────────────────────────────────────────────────────────
   Deal price D (what the worker quotes). Customer pays D x 1.10.
   The worker keeps 100% of D — that is the whole product.

   GST CORRECTION (panel V4, confidence 5, adopted):
   the old model labelled the split "8% profit + 2% GST". That is wrong.
   GST on a marketplace commission is 18% OF THE COMMISSION, not 2% of D.
   Same customer total, correct labels:
       Service      D            = 1000.00
       Platform fee D*0.10/1.18  =   84.75   <- SAAHAA revenue
       GST @18%     fee*0.18     =   15.25   <- remitted, never revenue
       Customer pays             = 1100.00
   Invoice-correct, survives an audit, and customers trust a line-itemed bill.

   ── RETAIL ──────────────────────────────────────────────────────────────
   Products CANNOT carry the 10% service rate: kirana gross margin on staples
   is 3-6%, so 10% would exceed the entire margin on the items people order
   most (panel V2, confidence 5). Commission comes out of the SHOP's margin
   (3% staples / 5% high-margin, capped per order); the customer pays a
   separate, visible delivery fee — never baked into item prices. */

import * as M from '../core/money.js';
import { find } from '../core/registry.js';

/* ── constants ─────────────────────────────────────────────── */
export const SERVICE_MARKUP = 0.10;   // customer pays D x 1.10
export const GST_RATE       = 0.18;   // GST on the platform fee
export const LOYALTY_MARKUP = 0.06;   // Tier-4 certified partners: 10% -> 6%
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
  const markup = opts.markup ?? SERVICE_MARKUP;
  const uplift = M.pct(D, markup * 100);              // the whole +10%
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

export function compareWithApps(dealPaise) {
  const q = quoteService(dealPaise);
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
  const band = DELIVERY_BANDS.find(b => km <= b.maxKm) || DELIVERY_BANDS[DELIVERY_BANDS.length - 1];
  return band.fee;
}

/**
 * @param {Array} lines  [{ qty, unitPrice, pickedQty? }]
 * @param {object} opts  { catId, km, mode:'self'|'rider'|'pickup', firstOrders:boolean }
 */
export function quoteRetail(lines, opts = {}) {
  const cat = find('category', opts.catId) || {};
  const takePct = opts.firstOrders ? 0 : (cat.takePct ?? 3);
  const cap = cat.takeCapPaise ?? 2500;

  const itemsTotal = lines.reduce((sum, l) => {
    const qty = l.pickedQty != null ? l.pickedQty : l.qty;
    return sum + M.mul(l.unitPrice, qty);
  }, 0);

  let platformFee = M.pct(itemsTotal, takePct);
  platformFee = Math.min(platformFee, cap);
  if (itemsTotal > 0) platformFee = Math.max(platformFee, opts.firstOrders ? 0 : RETAIL_FEE_FLOOR);
  // the floor must never exceed the basket, or the shop is paid a negative
  // amount — which would trip the ledger's fatal non-negative invariant
  platformFee = Math.min(platformFee, itemsTotal);

  const mode = opts.mode || 'rider';
  // shops advertise "free delivery over Rs.X" on their card; it was never
  // applied, so customers were charged on baskets we promised were free
  const freeAbove = opts.freeDeliveryAbove || 0;
  const delivery = (freeAbove > 0 && itemsTotal >= freeAbove) ? 0 : deliveryFee(opts.km ?? 2, mode);
  const riderPayout = mode === 'rider' ? Math.max(0, delivery - RIDER_DISPATCH_CUT) : 0;
  const dispatchCut = mode === 'rider' ? Math.min(delivery, RIDER_DISPATCH_CUT) : 0;
  const shopDeliveryShare = mode === 'self' ? delivery : 0;

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
    shopPayout: itemsTotal - platformFee + shopDeliveryShare,
    platformRevenue: feeExGst + dispatchCut,
    mode,
    reconciles: (itemsTotal - platformFee + shopDeliveryShare) + platformFee + riderPayout + dispatchCut
                === itemsTotal + delivery,
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
  WORKER_CANCEL:   { refundPct: 1.00, workerPct: 0.00, label: 'Pro cancelled — full refund', workerFee: 10000 },
};

export function cancelSplit(dealPaise, ruleId, opts = {}) {
  const rule = CANCEL_RULES[ruleId] || CANCEL_RULES.BEFORE_ACCEPT;
  // must use the SAME markup the booking was escrowed at. A Tier-4 job is
  // escrowed at 6%; refunding it at 10% overdraws escrow by the difference.
  const q = quoteService(dealPaise, opts);
  const refund = M.mul(q.customerPays, rule.refundPct);
  const worker = M.mul(q.deal, rule.workerPct);
  const platform = q.customerPays - refund - worker;
  return { rule: ruleId, label: rule.label, refund, worker, platform,
           credit: rule.credit || 0, workerFee: rule.workerFee || 0,
           reconciles: refund + worker + platform === q.customerPays };
}

export { M as money };
