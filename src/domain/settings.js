/* SAAHAA · domain/settings.js — the owner's dials.

   Three charges, three dials, one Push. The admin sets them; every quote
   made after the push uses them; every quote made BEFORE keeps the numbers
   it was made with (orders snapshot their fees at booking, so a change can
   never re-price money already in escrow). Defaults are the launch economics:
   8% on top for services, 3% capped for shops, the delivery bands by
   distance. Nothing here is a secret; it is policy, and it is audited. */

import { getState, dispatch } from '../core/ctx.js';

export const DEFAULT_PRICING = {
  serviceMarkupPct: 8,        // laid on top of the worker's quote, paid by the customer
  loyaltyMarkupPct: 6,        // tier-4 certified pros
  retailTakePct: 3,           // of the basket, out of the shop's price (MRP cannot be exceeded)
  retailTakeCapPaise: 2500,   // never more than Rs.25 an order
  retailFeeFloorPaise: 500,   // never less than Rs.5 (except the shop's first 30 orders: 0)
  deliveryBands: [            // paise by distance
    { maxKm: 2, fee: 1900 }, { maxKm: 4, fee: 2900 }, { maxKm: 6, fee: 3900 }, { maxKm: 999, fee: 4900 },
  ],
  riderDispatchCutPaise: 500, // Rs.5 of each delivery fee is SAAHAA's dispatch cut
  pushedAt: 0, pushedBy: '',
};

const LIMITS = { serviceMarkupPct: [0, 30], loyaltyMarkupPct: [0, 30], retailTakePct: [0, 15],
                 retailTakeCapPaise: [0, 100000], retailFeeFloorPaise: [0, 10000], riderDispatchCutPaise: [0, 10000] };

/** Live pricing: state if pushed, defaults otherwise. Always complete. */
/* With no store (the node test runner, a worker), the dials live in this
   module instead — same behaviour, same validation, nothing persisted. */
let local = null;
export function getPricing() {
  const st = (typeof getState === 'function' && safeState()) || {};
  const s = (st.settings && st.settings.pricing) || local || {};
  return { ...DEFAULT_PRICING, ...s, deliveryBands: Array.isArray(s.deliveryBands) && s.deliveryBands.length ? s.deliveryBands : DEFAULT_PRICING.deliveryBands };
}
function safeState() { try { return getState(); } catch (e) { return null; } }

/** Validate a proposed set of dials. Returns {ok, errors, clean}. */
export function validatePricing(input) {
  const errors = [], clean = {};
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (input[k] == null || input[k] === '') continue;
    const v = Number(input[k]);
    if (!Number.isFinite(v)) { errors.push(`${k}: not a number`); continue; }
    if (v < lo || v > hi) { errors.push(`${k}: must be between ${lo} and ${hi}`); continue; }
    clean[k] = k.endsWith('Paise') ? Math.round(v) : +v.toFixed(2);
  }
  if (Array.isArray(input.deliveryBands)) {
    const bands = input.deliveryBands.map(b => ({ maxKm: Number(b.maxKm), fee: Math.round(Number(b.fee)) }))
      .filter(b => Number.isFinite(b.maxKm) && Number.isFinite(b.fee) && b.fee >= 0 && b.maxKm > 0)
      .sort((a, b) => a.maxKm - b.maxKm);
    if (!bands.length) errors.push('deliveryBands: at least one band');
    else { if (bands[bands.length - 1].maxKm < 999) bands.push({ maxKm: 999, fee: bands[bands.length - 1].fee }); clean.deliveryBands = bands; }
  }
  if (clean.loyaltyMarkupPct != null && clean.serviceMarkupPct != null && clean.loyaltyMarkupPct > clean.serviceMarkupPct)
    errors.push('loyaltyMarkupPct: the certified rate cannot exceed the standard rate');
  return { ok: !errors.length, errors, clean };
}

/** The Push. Takes effect on every quote made from now on. */
export function pushPricing(input, actor = 'admin') {
  const v = validatePricing(input);
  if (!v.ok) return v;
  const next = { ...getPricing(), ...v.clean, pushedAt: Date.now(), pushedBy: actor };
  try { dispatch({ type: 'settings/set', payload: { pricing: next } }); }
  catch (e) { local = next; }
  return { ok: true, errors: [], clean: next };
}
