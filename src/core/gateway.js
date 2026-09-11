/* SAAHAA · core/gateway.js — the ONE door money uses to enter or leave.

   Every rupee a customer pays comes in through collect(); every rupee that
   goes out to a worker's, a shop's or a customer's UPI leaves through
   payout(). Nothing else in the product talks to a payment rail, so the rail
   can change here and nowhere else.

   TWO MODES (core/config.js PAYMENTS.mode):
     'sim'       no real money moves. A collect() succeeds at once and is
                 labelled so on every screen and every ledger leg
                 (`via: 'upi-sim'`). Honest sandbox, not a fake success.
     'razorpay'  the real rail. collect() asks the server (a Supabase Edge
                 Function holding the SECRET key) for a Razorpay Order, opens
                 Razorpay Checkout in the page through an opener the UI layer
                 registers (core/* never touches the DOM), then asks the
                 server to verify the payment signature before it returns a
                 receipt. payout() asks the server to move money out
                 (Route transfer / Payouts) and returns the server's receipt.

   The public key id may sit in the page; the secret never does — it lives in
   the function's secrets. A misconfigured 'razorpay' mode fails CLOSED: it
   returns {ok:false}, it never silently falls back to the sandbox.

   DOM-free, unit-testable under plain Node. Network only in 'razorpay' mode. */

import { nid } from './id.js';
import { paymentsConfig } from './config.js';
import { accessToken } from '../net/supabase.js';

/* THREE RAILS, NOT TWO. `sim` is the honest sandbox; `razorpay` is the PSP we
   have not earned yet; `upi-manual` is what actually runs until volume pays for
   a licence — she transfers to one UPI id herself and two humans confirm it.
   The manual rail collects NOTHING here: there is no API to call, so `collect`
   must not pretend to succeed. domain/payments.js records the claim and
   flow.fundClearedOrder posts the legs once an admin has read the statement. */
export const mode = () => {
  const m = paymentsConfig().mode;
  return m === 'razorpay' ? 'razorpay' : m === 'upi-manual' ? 'upi-manual' : 'sim';
};
export const isSandbox = () => mode() === 'sim';
export const isManual = () => mode() === 'upi-manual';
export const VIA = 'upi-sim';                                    // the sandbox leg label (kept for tests and old legs)
export const via = () => isSandbox() ? 'upi-sim' : isManual() ? 'upi-manual' : 'razorpay';
export const label = () => isManual() ? 'UPI — you pay SAAHAA directly'
  : isSandbox()
  ? 'Sandbox UPI — no real money moves yet'
  : 'UPI · cards · net banking via Razorpay';

/* ── the opener: the UI registers how Checkout is shown ─────── */
let opener = null;
/** ui/checkout.js calls this once at boot: (order, cfg) => Promise<{ok, paymentId, signature, reason}> */
export function useOpener(fn) { opener = typeof fn === 'function' ? fn : null; }

async function postJson(url, body) {
  const token = (() => { try { return accessToken(); } catch (e) { return null; } })();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.reason || ('server ' + r.status));
  return j;
}

/** Money IN. Returns a receipt; the caller posts the ledger legs. */
export async function collect({ paise, purpose = 'payment', key = '' } = {}) {
  const amt = Math.round(Number(paise) || 0);
  if (amt <= 0) return { ok: false, reason: 'nothing to collect', paise: 0 };
  if (isSandbox()) return { ok: true, ref: nid('pay'), via: 'upi-sim', paise: amt, purpose, key, at: Date.now() };

  const cfg = paymentsConfig();
  if (!cfg.functionsUrl || !cfg.keyId) return { ok: false, reason: 'Payments are not configured (key id / functions URL)', paise: amt };
  if (!opener) return { ok: false, reason: 'No checkout opener registered', paise: amt };
  try {
    const order = await postJson(cfg.functionsUrl + '/razorpay-order', { amount: amt, purpose, key });
    const res = await opener({ orderId: order.orderId, amount: order.amount || amt, keyId: order.keyId || cfg.keyId, purpose }, cfg);
    if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'Payment was not completed', paise: amt };
    const v = await postJson(cfg.functionsUrl + '/razorpay-verify',
      { orderId: order.orderId, paymentId: res.paymentId, signature: res.signature });
    if (!v.ok) return { ok: false, reason: 'Payment could not be verified', paise: amt };
    return { ok: true, ref: res.paymentId, orderId: order.orderId, via: 'razorpay', paise: amt, purpose, key, at: Date.now() };
  } catch (e) {
    return { ok: false, reason: e.message || 'gateway error', paise: amt };
  }
}

/** Money OUT to a UPI id. Returns a receipt; the caller posts the ledger legs. */
export async function payout({ paise, purpose = 'payout', key = '', upi = '' } = {}) {
  const amt = Math.round(Number(paise) || 0);
  if (amt <= 0) return { ok: false, reason: 'nothing to pay', paise: 0 };
  if (isSandbox()) return { ok: true, ref: nid('pout'), via: 'upi-sim', paise: amt, purpose, key, upi: String(upi || ''), at: Date.now() };

  const cfg = paymentsConfig();
  if (!cfg.functionsUrl) return { ok: false, reason: 'Payments are not configured (functions URL)', paise: amt };
  try {
    const r = await postJson(cfg.functionsUrl + '/razorpay-payout', { amount: amt, purpose, key, upi: String(upi || ''), idem: nid('pout') });   // idem: a retried payout can never pay twice
    return { ok: true, ref: r.ref || r.payoutId || nid('pout'), via: 'razorpay', paise: amt, purpose, key, upi: String(upi || ''), at: Date.now() };
  } catch (e) {
    return { ok: false, reason: e.message || 'gateway error', paise: amt };
  }
}
