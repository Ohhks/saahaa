/* SAAHAA · razorpay-webhook — where Razorpay tells us what really happened.

   WHAT IT DOES
     POST <raw JSON body>  with  X-Razorpay-Signature, X-Razorpay-Event-Id
       1. HMAC-SHA256 over the RAW bytes with RAZORPAY_WEBHOOK_SECRET,
          constant-time compare. Wrong → 400, nothing stored.
       2. INSERT the event into gateway_events keyed by the event id,
          ON CONFLICT DO NOTHING. No row back = a retry we already have → 200.
       3. Mirror what matters:
            payment.captured     → upsert gateway_payments (status captured)
            payment.failed       → gateway_payments status failed (unless captured)
            refund.processed     → gateway_payments status refunded
            transfer.processed   → event row only (Route mirror comes with
            settlement.processed → event row only  the release-queue work)
            payout.*             → gateway_payouts status (RazorpayX path)
       4. 200.

   WHY 200 EVEN WHEN A MIRROR WRITE FAILS
     Razorpay retries a non-2xx for ~24 hours with the same event id. The
     event row already holds the full payload, so a failed mirror write is
     replayable from the table; a 500 here would only spend retries. The one
     non-2xx after a good signature is when the EVENT ROW ITSELF could not be
     stored — then a 200 would lose the event for ever, and a retry is
     exactly what we want.

   WHAT IT MUST NEVER DO
     · accept an unsigned or mis-signed body — not even to "just log it"
     · parse-then-restringify before checking the HMAC
     · reject on a timestamp window (retries reuse the id; the id is the
       replay defence — docs/PRODUCTION.md §4)
     · post a ledger leg from the browser's story; this handler is the
       server's own record, written with the service-role key that the
       browser never holds (see _shared/db.ts)
     · log the webhook secret, the payload's contact/email, or a card field

   Deploy with --no-verify-jwt: Razorpay sends no Supabase JWT. The webhook
   secret is the credential. This function has no CORS on purpose: nothing
   in a browser should ever call it. */

import { fail, json } from '../_shared/json.ts';
import { hmacHex, timingSafeEqual } from '../_shared/razorpay.ts';
import { insertIgnore, patch, upsert } from '../_shared/db.ts';

const SIG_RE = /^[0-9a-f]{64}$/i;

interface Entity { id?: string; [k: string]: unknown }
interface Event {
  event?: string;
  created_at?: number;
  payload?: Record<string, { entity?: Entity } | undefined>;
}

const entity = (evt: Event, name: string): Entity => (evt.payload?.[name]?.entity ?? {}) as Entity;
const s = (v: unknown, max = 64): string => typeof v === 'string' ? v.slice(0, max) : '';
const n = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
const noteOf = (e: Entity, k: string): string => {
  const notes = e.notes;
  return notes && typeof notes === 'object' && !Array.isArray(notes) ? s((notes as Record<string, unknown>)[k]) : '';
};

async function mirror(kind: string, evt: Event): Promise<void> {
  const now = new Date().toISOString();
  switch (kind) {
    case 'payment.captured': {
      const p = entity(evt, 'payment');
      if (!p.id) return;
      await upsert('gateway_payments', {
        payment_id: p.id, order_id: s(p.order_id), amount: n(p.amount), currency: s(p.currency) || 'INR',
        status: 'captured', method: s(p.method, 32), key: noteOf(p, 'key'), purpose: noteOf(p, 'purpose'),
        error_code: null, error_reason: null,
        captured_at: p.created_at ? new Date(n(p.created_at) * 1000).toISOString() : now, updated_at: now,
      }, 'payment_id');
      return;
    }
    case 'payment.failed': {
      const p = entity(evt, 'payment');
      if (!p.id) return;
      // Razorpay does not promise event order: a late 'failed' must not undo a 'captured'.
      await insertIgnore('gateway_payments', {
        payment_id: p.id, order_id: s(p.order_id), amount: n(p.amount), currency: s(p.currency) || 'INR',
        status: 'failed', method: s(p.method, 32), key: noteOf(p, 'key'), purpose: noteOf(p, 'purpose'),
        error_code: s(p.error_code, 64) || null, error_reason: s(p.error_reason, 128) || null, updated_at: now,
      }, 'payment_id');
      await patch('gateway_payments', `payment_id=eq.${encodeURIComponent(p.id)}&status=neq.captured`,
        { status: 'failed', error_code: s(p.error_code, 64) || null, error_reason: s(p.error_reason, 128) || null, updated_at: now });
      return;
    }
    case 'refund.processed': {
      const r = entity(evt, 'refund');
      const p = entity(evt, 'payment');
      const pid = s(r.payment_id) || s(p.id);
      if (!pid) return;
      const partial = n(p.amount) > 0 && n(r.amount) < n(p.amount);
      await patch('gateway_payments', `payment_id=eq.${encodeURIComponent(pid)}`,
        { status: partial ? 'partially_refunded' : 'refunded', last_refund_id: s(r.id) || null, updated_at: now });
      return;
    }
    case 'payout.processed':
    case 'payout.failed':
    case 'payout.reversed':
    case 'payout.queued':
    case 'payout.pending': {
      const p = entity(evt, 'payout');
      if (!p.id) return;
      await patch('gateway_payouts', `ref=eq.${encodeURIComponent(p.id)}`,
        { status: s(p.status, 32) || kind.split('.')[1], updated_at: now });
      return;
    }
    case 'transfer.processed':
    case 'settlement.processed':
    default:
      return; // the event row is the record; nothing else to mirror yet
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return fail('POST only', 405);
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) {
    console.error('razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not set');
    return fail('webhook not configured', 500);
  }

  const raw = await req.text();                       // RAW bytes — never re-serialised before the check
  const sig = (req.headers.get('x-razorpay-signature') ?? '').trim().toLowerCase();
  if (!SIG_RE.test(sig)) return fail('missing signature', 400);
  const expected = await hmacHex(secret, raw);
  if (!timingSafeEqual(expected, sig)) {
    console.warn('razorpay-webhook: bad signature');
    return fail('bad signature', 400);
  }

  let evt: Event;
  try { evt = JSON.parse(raw); } catch { return fail('invalid JSON', 400); }
  const kind = s(evt.event, 64) || 'unknown';
  const eventId = s(req.headers.get('x-razorpay-event-id'), 80) ||
    `${kind}:${s(Object.values(evt.payload ?? {})[0]?.entity?.id)}:${n(evt.created_at)}`;

  let fresh: boolean;
  try {
    fresh = await insertIgnore('gateway_events', { id: eventId, kind, payload: evt, received_at: new Date().toISOString() });
  } catch (e) {
    console.error('razorpay-webhook: could not store event', kind, (e as Error).message);
    return fail('event not stored, retry', 500);
  }
  if (!fresh) return json({ ok: true, replay: true, id: eventId });

  try {
    await mirror(kind, evt);
    await patch('gateway_events', `id=eq.${encodeURIComponent(eventId)}`, { processed_at: new Date().toISOString() });
  } catch (e) {
    // Stored, signed, replayable from the table. Do not make Razorpay retry.
    console.error('razorpay-webhook: mirror failed', kind, eventId, (e as Error).message);
  }
  return json({ ok: true, kind, id: eventId });
});
