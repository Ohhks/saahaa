/* SAAHAA · razorpay-order — the first half of collect().

   WHAT IT DOES
     POST {amount, purpose, key}         (amount in whole paise)
       → creates a Razorpay Order with the SECRET key, server-side
       → 200 {ok:true, orderId, amount, currency:'INR', keyId}
     The browser then opens Razorpay Checkout with orderId + keyId
     (src/ui/checkout.js) and razorpay-verify checks what comes back.

   WHAT IT MUST NEVER DO
     · echo RAZORPAY_KEY_SECRET anywhere — keyId in the response is the
       PUBLIC id, the one Checkout needs, nothing more
     · accept a non-integer or out-of-range amount (100 … 1_00_00_000 paise)
     · log the request body: `key` identifies a person
     · decide that money has ARRIVED — an Order is an intention to pay.
       Only razorpay-verify (signature) and razorpay-webhook
       (payment.captured) say it did.

   Deploy with --no-verify-jwt: the app calls it with no Authorization
   header (gateway.js postJson), and creating an order is harmless — it is
   an invoice to pay us, not a movement of money. */

import { corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { fail, isPaise, json, KEY_RE, MAX_PAISE, MIN_PAISE, PURPOSE_RE, readJson, str } from '../_shared/json.ts';
import { keyId, notes, RazorpayError, rzp } from '../_shared/razorpay.ts';

interface Order { id: string; amount: number; currency: string; receipt?: string; status?: string }

/** `purpose:key:timestamp`, cut to Razorpay's 40-character receipt limit with the stamp intact. */
function receiptFor(purpose: string, key: string): string {
  const stamp = Date.now().toString(36);
  const head = `${purpose}:${key}`.slice(0, 40 - stamp.length - 1);
  return `${head}:${stamp}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const h = corsHeaders(req);
  if (req.method !== 'POST') return fail('POST only', 405, h);
  if (!originAllowed(req)) return fail('origin not allowed', 403, h);

  let body: Record<string, unknown>;
  try { body = await readJson(req); } catch { return fail('invalid JSON body', 400, h); }

  const amount = body.amount;
  const purpose = str(body.purpose, 32) || 'payment';
  const key = str(body.key, 64);
  if (!isPaise(amount, MIN_PAISE, MAX_PAISE)) {
    return fail(`amount must be a whole number of paise between ${MIN_PAISE} and ${MAX_PAISE}`, 400, h);
  }
  if (!PURPOSE_RE.test(purpose)) return fail('purpose must be a short slug', 400, h);
  if (!KEY_RE.test(key)) return fail('key has characters the rail does not accept', 400, h);

  try {
    const order = await rzp<Order>('/orders', {
      method: 'POST',
      body: { amount, currency: 'INR', receipt: receiptFor(purpose, key), notes: notes({ purpose, key }) },
    });
    return json({ ok: true, orderId: order.id, amount: order.amount, currency: 'INR', keyId: keyId() }, 200, h);
  } catch (e) {
    if (e instanceof RazorpayError) {
      console.error('razorpay-order: razorpay', e.status, e.code);
      return fail(e.status === 401 ? 'Payments are misconfigured on the server' : `Razorpay: ${e.message}`, 502, h);
    }
    console.error('razorpay-order:', (e as Error).message);
    return fail('Could not create the payment order', 500, h);
  }
});
