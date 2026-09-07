/* SAAHAA · razorpay-verify — the second half of collect().

   WHAT IT DOES
     POST {orderId, paymentId, signature}   (what Checkout handed the page)
       → recomputes HMAC-SHA256(orderId + '|' + paymentId, RAZORPAY_KEY_SECRET)
         with Web Crypto and compares in constant time
       → then asks Razorpay for the payment itself and insists it belongs to
         this order and is 'captured' or 'authorized'
       → 200 {ok:true|false, status, amount}
     gateway.js treats ok:false as "Payment could not be verified" and posts
     no ledger leg. A signature only the secret can produce is the proof;
     the lookup is the second opinion (it can turn a yes into a no, never a
     no into a yes). Set VERIFY_CONFIRM=0 to skip the lookup.

   WHAT IT MUST NEVER DO
     · trust the browser's word: the signature is checked here, with the
       secret, or not at all
     · compare with === (timing leak) or accept a signature of the wrong
       length
     · leak the secret, even indirectly (the expected signature is never
       returned)
     · be the ONLY record of a payment: razorpay-webhook stores
       payment.captured whether or not the tab survived.

   Deploy with --no-verify-jwt (the app sends no Authorization header; the
   signature is the credential). */

import { corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { fail, json, readJson, str } from '../_shared/json.ts';
import { hmacHex, keySecret, RazorpayError, rzp, timingSafeEqual } from '../_shared/razorpay.ts';

const ORDER_RE = /^order_[A-Za-z0-9]{8,32}$/;
const PAY_RE = /^pay_[A-Za-z0-9]{8,32}$/;
const SIG_RE = /^[0-9a-f]{64}$/i;

interface Payment { id: string; order_id?: string; amount: number; currency?: string; status: string }

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const h = corsHeaders(req);
  if (req.method !== 'POST') return fail('POST only', 405, h);
  if (!originAllowed(req)) return fail('origin not allowed', 403, h);

  let body: Record<string, unknown>;
  try { body = await readJson(req); } catch { return fail('invalid JSON body', 400, h); }
  const orderId = str(body.orderId, 40);
  const paymentId = str(body.paymentId, 40);
  const signature = str(body.signature, 64).toLowerCase();
  if (!ORDER_RE.test(orderId) || !PAY_RE.test(paymentId)) return fail('orderId / paymentId malformed', 400, h);
  if (!SIG_RE.test(signature)) return fail('signature malformed', 400, h);

  let expected: string;
  try { expected = await hmacHex(keySecret(), `${orderId}|${paymentId}`); } catch (e) {
    console.error('razorpay-verify:', (e as Error).message);
    return fail('Payments are misconfigured on the server', 500, h);
  }
  if (!timingSafeEqual(expected, signature)) {
    console.warn('razorpay-verify: signature mismatch for', orderId);
    return json({ ok: false, status: 'signature_mismatch', amount: 0, error: 'Payment signature did not verify' }, 200, h);
  }

  if (Deno.env.get('VERIFY_CONFIRM') === '0') {
    return json({ ok: true, status: 'signature_ok', amount: null, confirmed: false }, 200, h);
  }
  try {
    const p = await rzp<Payment>(`/payments/${paymentId}`);
    if (p.order_id && p.order_id !== orderId) {
      return json({ ok: false, status: 'order_mismatch', amount: p.amount, error: 'Payment belongs to a different order' }, 200, h);
    }
    if (p.status !== 'captured' && p.status !== 'authorized') {
      return json({ ok: false, status: p.status, amount: p.amount, error: `Payment is ${p.status}` }, 200, h);
    }
    return json({ ok: true, status: p.status, amount: p.amount, currency: p.currency ?? 'INR', confirmed: true }, 200, h);
  } catch (e) {
    // The signature already proved the payment is genuine; a lookup that
    // fails for network reasons must not turn a paid customer away.
    console.warn('razorpay-verify: lookup failed', e instanceof RazorpayError ? `${e.status} ${e.code}` : (e as Error).message);
    return json({ ok: true, status: 'signature_ok', amount: null, confirmed: false }, 200, h);
  }
});
