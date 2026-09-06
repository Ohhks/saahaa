/* SAAHAA · core/gateway.js — the ONE door money uses to enter or leave.

   Every rupee a customer pays comes in through collect(); every rupee that
   goes out to a worker's, a shop's or a customer's UPI leaves through
   payout(). Nothing else in the product talks to a payment rail, so the day
   Razorpay is wired (docs/PRODUCTION.md §2) this file changes and nothing
   else does.

   MODE 'sim': no real money moves. A collect() succeeds instantly and is
   labelled so on every screen and every ledger leg (`via: 'upi-sim'`). This
   is honest sandbox behaviour, not a fake success — the ledger, escrow,
   wallets and the company treasury all move exactly as they will with a real
   rail, because they never knew which rail it was.

   DOM-free, network-free, unit-testable under plain Node. */

import { nid } from './id.js';

export const MODE = 'sim';                        // 'sim' | 'razorpay' (when keys exist, set from config)
export const VIA  = MODE === 'sim' ? 'upi-sim' : 'razorpay';
export const isSandbox = () => MODE === 'sim';
export const label = () => isSandbox() ? 'Sandbox UPI — no real money moves yet' : 'UPI · cards · net banking via Razorpay';

/** Money IN. Returns a receipt; the caller posts the ledger legs. */
export async function collect({ paise, purpose = 'payment', key = '' } = {}) {
  const amt = Math.round(Number(paise) || 0);
  if (amt <= 0) return { ok: false, reason: 'nothing to collect', paise: 0 };
  return { ok: true, ref: nid('pay'), via: VIA, paise: amt, purpose, key, at: Date.now() };
}

/** Money OUT to a UPI id. Returns a receipt; the caller posts the ledger legs. */
export async function payout({ paise, purpose = 'payout', key = '', upi = '' } = {}) {
  const amt = Math.round(Number(paise) || 0);
  if (amt <= 0) return { ok: false, reason: 'nothing to pay', paise: 0 };
  return { ok: true, ref: nid('pout'), via: VIA, paise: amt, purpose, key, upi: String(upi || ''), at: Date.now() };
}
