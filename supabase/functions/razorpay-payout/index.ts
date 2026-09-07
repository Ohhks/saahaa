/* SAAHAA · razorpay-payout — money OUT, to a worker's or a customer's UPI.

   WHAT IT DOES
     POST {amount, purpose, key, upi, idem?}   with  Authorization: Bearer <Supabase user JWT>
       → the caller must be a signed-in profile with role 'admin' (the
         browser cannot move a rupee on its own — 0002_money_rls.sql)
       → ROUTE path   if RAZORPAY_ACCOUNT_MAP (JSON {"<key>":"acc_…"}) maps
                      `key` to a Razorpay Route linked account:
                      POST /v1/transfers → {ok:true, ref:'trf_…', mode:'route'}
       → PAYOUTX path else, if RAZORPAYX_ACCOUNT_NUMBER is set and `upi` is
                      given: contact → fund account (VPA) → payout, with an
                      idempotency key → {ok:true, ref:'pout_…', mode:'payoutx'}
       → otherwise    {ok:false, error:'payouts not enabled for this key'}
     Every attempt that reaches Razorpay is recorded in gateway_payouts;
     razorpay-webhook updates its status from payout.* events.

   WHY TWO PATHS (supabase/README.md, "Route or Payouts")
     Route moves money INSIDE Razorpay's escrow to an account Razorpay has
     KYC'd. SAAHAA never holds it — the RBI Payment Aggregator question does
     not arise. RazorpayX Payouts pays from a balance WE prefunded, i.e.
     pooled money in our name; fine for our own refunds and goodwill, not a
     way to pay a hundred workers their share. Route first, always.

   WHAT IT MUST NEVER DO
     · run without a verified admin session — a POST with a UPI id and an
       amount is a withdrawal from the merchant balance
     · echo the secret key, the RazorpayX account number or the account map
     · pay out on the browser's word that a payment landed (that is the
       webhook's job); this function trusts the admin, not the tab
     · retry a payout without the same idempotency key

   Deploy with --no-verify-jwt and let THIS code check the JWT: the gateway
   check would also reject the OPTIONS preflight and the anon-key case with
   an opaque 401, and it never checks the role. */

import { corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { fail, isPaise, json, KEY_RE, MAX_PAISE, MIN_PAISE, PURPOSE_RE, readJson, str, UPI_RE } from '../_shared/json.ts';
import { notes, RazorpayError, rzp } from '../_shared/razorpay.ts';
import { select, upsert } from '../_shared/db.ts';

const IDEM_RE = /^[A-Za-z0-9_-]{6,64}$/;

interface Transfer { id: string; status?: string; amount?: number }
interface Contact { id: string }
interface FundAccount { id: string }
interface Payout { id: string; status?: string }

/** {key → acc_…} from the RAZORPAY_ACCOUNT_MAP secret; {} when unset or unparseable. */
function accountMap(): Record<string, string> {
  const raw = Deno.env.get('RAZORPAY_ACCOUNT_MAP');
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {};
  } catch {
    console.error('razorpay-payout: RAZORPAY_ACCOUNT_MAP is not valid JSON');
    return {};
  }
}

/** The signed-in admin behind the Bearer token, or a Response saying why not. */
async function requireAdmin(req: Request, h: Record<string, string>): Promise<{ id: string } | Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail('Sign in as the owner to send a payout', 401, h);
  const url = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) return fail('Payments are misconfigured on the server', 500, h);
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) return fail('Session expired — sign in again', 401, h);
  const user = await r.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return fail('Session expired — sign in again', 401, h);
  const rows = await select<{ role: string; is_banned: boolean }>('profiles', `id=eq.${encodeURIComponent(user.id)}&select=role,is_banned`);
  if (rows[0]?.role !== 'admin' || rows[0]?.is_banned) return fail('Only the owner can send a payout', 403, h);
  return { id: user.id };
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
  const purpose = str(body.purpose, 32) || 'payout';
  const key = str(body.key, 64);
  const upi = str(body.upi, 100);
  const idem = str(body.idem, 64) || crypto.randomUUID();
  if (!isPaise(amount, MIN_PAISE, MAX_PAISE)) return fail(`amount must be a whole number of paise between ${MIN_PAISE} and ${MAX_PAISE}`, 400, h);
  if (!PURPOSE_RE.test(purpose)) return fail('purpose must be a short slug', 400, h);
  if (!key || !KEY_RE.test(key)) return fail('key is required', 400, h);
  if (upi && !UPI_RE.test(upi)) return fail('That does not look like a UPI id', 400, h);
  if (!IDEM_RE.test(idem)) return fail('idem malformed', 400, h);

  let actor: { id: string };
  try {
    const a = await requireAdmin(req, h);
    if (a instanceof Response) return a;
    actor = a;
  } catch (e) {
    console.error('razorpay-payout: auth check failed', (e as Error).message);
    return fail('Could not check your session', 500, h);
  }

  const linked = accountMap()[key];
  const xAccount = Deno.env.get('RAZORPAYX_ACCOUNT_NUMBER') ?? '';
  const now = new Date().toISOString();

  try {
    if (linked && /^acc_[A-Za-z0-9]{8,32}$/.test(linked)) {
      // ── ROUTE: a direct transfer from our Razorpay balance to a linked account ──
      const t = await rzp<Transfer>('/transfers', {
        method: 'POST',
        body: { account: linked, amount, currency: 'INR', notes: notes({ purpose, key, idem }) },
      });
      await upsert('gateway_payouts', {
        ref: t.id, mode: 'route', idem, amount, purpose, key, upi: '', status: t.status ?? 'created',
        actor_id: actor.id, created_at: now, updated_at: now,
      }, 'ref').catch((e) => console.error('razorpay-payout: record failed', t.id, (e as Error).message));
      return json({ ok: true, ref: t.id, mode: 'route', status: t.status ?? 'created' }, 200, h);
    }

    if (xAccount) {
      // ── RAZORPAYX: contact → VPA fund account → payout, idempotent on `idem` ──
      if (!upi) return fail('A UPI id is needed for this payout', 400, h);
      const contact = await rzp<Contact>('/contacts', {
        method: 'POST',
        body: {
          name: `SAAHAA ${key}`.replace(/[^A-Za-z0-9 ._-]/g, ' ').slice(0, 50),
          type: purpose === 'refund-out' ? 'customer' : 'vendor',
          reference_id: key.slice(0, 40),
          notes: notes({ key }),
        },
      });
      const fund = await rzp<FundAccount>('/fund_accounts', {
        method: 'POST',
        body: { contact_id: contact.id, account_type: 'vpa', vpa: { address: upi } },
      });
      const p = await rzp<Payout>('/payouts', {
        method: 'POST',
        headers: { 'X-Payout-Idempotency': idem },
        body: {
          account_number: xAccount, fund_account_id: fund.id, amount, currency: 'INR', mode: 'UPI',
          purpose: purpose === 'refund-out' ? 'refund' : 'payout',
          queue_if_low_balance: true, reference_id: idem,
          narration: `SAAHAA ${purpose}`.slice(0, 30), notes: notes({ purpose, key }),
        },
      });
      await upsert('gateway_payouts', {
        ref: p.id, mode: 'payoutx', idem, amount, purpose, key, upi, status: p.status ?? 'queued',
        actor_id: actor.id, created_at: now, updated_at: now,
      }, 'ref').catch((e) => console.error('razorpay-payout: record failed', p.id, (e as Error).message));
      return json({ ok: true, ref: p.id, mode: 'payoutx', status: p.status ?? 'queued' }, 200, h);
    }

    return json({ ok: false, error: 'payouts not enabled for this key' }, 200, h);
  } catch (e) {
    if (e instanceof RazorpayError) {
      console.error('razorpay-payout: razorpay', e.status, e.code);
      return fail(e.status === 401 ? 'Payments are misconfigured on the server' : `Razorpay: ${e.message}`, 502, h);
    }
    console.error('razorpay-payout:', (e as Error).message);
    return fail('Could not send the payout', 500, h);
  }
});
