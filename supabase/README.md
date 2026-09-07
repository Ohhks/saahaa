# supabase/ — the database and the rail

```
supabase/
  migrations/      0001 schema · 0002 money RLS · 0003 automation · 0004 gateway mirror
  seed/            example data for a local stack (never production)
  functions/       the payment rail — four Deno Edge Functions + shared helpers
    _shared/       cors.ts · json.ts · razorpay.ts (Basic auth + HMAC) · db.ts (service-role PostgREST)
    razorpay-order/    POST {amount, purpose, key}            → {ok, orderId, amount, currency, keyId}
    razorpay-verify/   POST {orderId, paymentId, signature}   → {ok, status, amount}
    razorpay-webhook/  POST <raw body> + X-Razorpay-Signature → 200 (400 on a bad signature)
    razorpay-payout/   POST {amount, purpose, key, upi}       → {ok, ref, mode:'route'|'payoutx'}
```

Migrations are applied by hand in the SQL Editor, in order (`docs/SETUP.md`
Part C). This file is about the functions.

## Why the rail lives here, and what the browser never sees

`src/core/gateway.js` is the one door money uses. In `razorpay` mode it
`fetch`es these four URLs and nothing else. The browser holds only the
**public** key id (`rzp_test_…` / `rzp_live_…`), which Razorpay Checkout needs
in the page anyway. Three things must never reach it, and they do not:

| Secret | Why it stays on the server |
|---|---|
| `RAZORPAY_KEY_SECRET` | Creates orders, refunds and transfers on your account. With it, a page could move your money. `razorpay-order` uses it as the Basic-auth password; `razorpay-verify` uses it as the HMAC key. It is never in a response. |
| `RAZORPAY_WEBHOOK_SECRET` | Signs every webhook. Anyone holding it could forge a `payment.captured`. Only `razorpay-webhook` reads it. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses Row Level Security — it is the database's master key.** The `gateway_*` tables (migration 0004) have no write policy at all and INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated`, so the only thing that can write "a payment was captured" is code running here, holding this key. Supabase injects it into the function environment; you never set it, paste it or commit it. The anon key that ships in the bundle cannot invent a payment. |

The functions are deployed with `--no-verify-jwt` because the app calls
`razorpay-order` / `razorpay-verify` with no session header and Razorpay
calls the webhook with none at all. Each function does its own
authentication instead: the checkout **signature** (verify), the webhook
**signature** (webhook), and a **signed-in owner session** (payout — see
"Route or Payouts" below). `razorpay-order` needs none: an Order is an
invoice to pay us, not a movement of money.

## Deploy

Once, on your machine (`npm i -g supabase`, or `npx supabase …`):

```bash
supabase login
supabase link --project-ref <ref>            # <ref> is the xxxx in https://xxxx.supabase.co
```

Then, every time a function changes:

```bash
supabase functions deploy razorpay-order   --no-verify-jwt
supabase functions deploy razorpay-verify  --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy razorpay-payout  --no-verify-jwt
```

`--no-verify-jwt` is required on all four (see above). The functions are
then live at `https://<ref>.functions.supabase.co/<name>` (the older
`https://<ref>.supabase.co/functions/v1/<name>` form works too).

## Secrets

```bash
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_XXXX \
  RAZORPAY_KEY_SECRET=XXXX \
  RAZORPAY_WEBHOOK_SECRET=XXXX \
  ALLOWED_ORIGINS=https://ohhks.github.io,http://localhost:8772
```

| Name | Required | Used by | What it is |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | yes | order, verify, payout | the public key id; the same value goes into the app switch (`rzkey=`) |
| `RAZORPAY_KEY_SECRET` | yes | order, verify, payout | the key secret from Razorpay → Settings → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | yes | webhook | the secret **you type** when creating the webhook in the Razorpay dashboard; any random 32+ characters |
| `ALLOWED_ORIGINS` | no | order, verify, payout | comma-separated origins allowed by CORS; defaults to the two above. Drop `localhost` when you go live |
| `RAZORPAY_ACCOUNT_MAP` | no | payout | JSON `{"<app key>":"acc_XXXX"}` — a key listed here is paid by **Route** to that linked account |
| `RAZORPAYX_ACCOUNT_NUMBER` | no | payout | your RazorpayX current-account number; unset = the RazorpayX path is off |
| `VERIFY_CONFIRM` | no | verify | `0` skips the read-back of the payment after the signature check; leave unset |
| `SUPABASE_URL` `SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` | injected | webhook, payout | set by Supabase for every function; **never set these by hand** |

`supabase secrets list` shows names and digests, never values. Test-mode
and live-mode keys are different strings: set the live ones the day you go
live, and create a *second* webhook with its own secret for live mode.

## The webhook, in the Razorpay dashboard

Razorpay → **Account & Settings → Webhooks → Add new webhook**:

- **Webhook URL:** `https://<ref>.functions.supabase.co/razorpay-webhook`
- **Secret:** the value you set as `RAZORPAY_WEBHOOK_SECRET` (make it up; 32+ random characters)
- **Alert email:** yours
- **Active events — tick these:**
  - `payment.captured` — the one that matters: money arrived in Razorpay's escrow
  - `payment.failed`
  - `refund.processed`
  - `transfer.processed` (Route)
  - `settlement.processed` — your commission reached your bank, T+2
  - `payout.processed`, `payout.failed`, `payout.reversed` (only if you use RazorpayX)

Test-mode webhooks fire from test-mode payments. Every delivery lands in
`gateway_events` exactly once (event id = primary key); the dashboard's
*Webhooks → Logs* page shows the 200s and lets you re-deliver one by hand.

## Switching the app to the rail

Nothing in `src/` changes to *try* the rail. Open the app **once** with:

```
https://ohhks.github.io/saahaa/?payments=razorpay&rzkey=rzp_test_XXXX&fnurl=https://<ref>.functions.supabase.co
```

`core/config.js` stores that on the device (`SAAHAA_PAYMENTS` in
localStorage). From then on `gateway.mode()` is `razorpay`, the *Sandbox
UPI* label disappears, and every `collect()` opens Razorpay Checkout.
For local work the same switch applies on `http://localhost:8772/…`.

To make it the default for **every** device, the lead bakes it into
`src/core/config.js`:

```js
export const PAYMENTS = {
  mode: 'razorpay',
  keyId: 'rzp_live_XXXX',
  functionsUrl: 'https://<ref>.functions.supabase.co',
  …
};
```

That file is the lead's (`docs/WORKFLOW.md`, *What is never delegated*).
The key id is public and safe to commit; the secret is not in that file and
never will be.

## The test-card walkthrough (test mode, ₹0 real)

1. Open the app with the switch above, using `rzp_test_…`.
2. Sign in as a customer → **Wallet → Top up ₹10**.
3. Razorpay Checkout opens. Pick **Card**, number `4111 1111 1111 1111`,
   any future expiry, any CVV, any name. On the test OTP page choose
   **Success**.
4. The wallet shows ₹10 more, and the ledger leg carries `via: 'razorpay'`
   and `ref: 'pay_…'` (Admin → Finance).
5. In the SQL Editor: `select * from gateway_payments;` — one row,
   `status = 'captured'`, `purpose = 'topup'`, your customer key. And
   `select id, kind, processed_at from gateway_events;` — one
   `payment.captured` with `processed_at` set.
6. Repeat, and this time pick **Failure** on the OTP page: the app says the
   payment was not completed, no leg is posted, and `gateway_events` gains
   a `payment.failed`.
7. Close the Checkout window instead of paying: *Payment window closed*, no
   leg, nothing on the server.
8. **UPI in test mode:** choose UPI, enter `success@razorpay` (or
   `failure@razorpay`) as the VPA.
9. Take-out (**Wallet → Take out**) answers *Could not send that right now*
   until a payout path is configured — see the next section. That is the
   fail-closed behaviour, not a bug.

Test cards and VPAs are on Razorpay's docs page *Test Card Details*; the
numbers above have been stable for years but check there if one is refused.

## Route or Payouts — the two ways money leaves, and why the order matters

`razorpay-payout` has two paths and picks the first that applies:

**1. Route** (`mode: 'route'`) — when `RAZORPAY_ACCOUNT_MAP` maps the app
key to a **linked account** (`acc_…`). The function calls
`POST /v1/transfers` and Razorpay moves the amount from your balance to
that account **inside its own escrow**. You never took custody of the
worker's share; you issued an instruction. Zero per-transfer fee. This is
the path `docs/PRODUCTION.md` §1–§2 argues for, because it is the one that
keeps SAAHAA out of the RBI Payment Aggregator definition — *receives,
pools, transfers on after a time period*. Route is what pays a worker.

**2. RazorpayX Payouts** (`mode: 'payoutx'`) — when
`RAZORPAYX_ACCOUNT_NUMBER` is set and the request carries a UPI id. The
function creates a contact, a VPA fund account and a payout
(`POST /v1/contacts` → `/v1/fund_accounts` → `/v1/payouts`, with an
idempotency key). The money comes from a balance **you prefunded** — which
is exactly the pooled-money picture the PA rules describe. Fine for your
own money: a goodwill refund, a customer's wallet take-out that you have
already received into your account. Not a mechanism for paying a hundred
workers their share of a hundred customers' money.

**3. Neither** — `{ok:false, error:'payouts not enabled for this key'}`.
The app shows *Could not send that right now* and posts nothing. This is
where a fresh deployment sits, on purpose.

Whichever path runs, the function first insists on an **owner session**:
`Authorization: Bearer <Supabase user JWT>` whose profile has
`role = 'admin'` and is not banned. A POST with an amount and a UPI id is a
withdrawal from your merchant balance; the browser cannot be allowed to do
that on its own word. `gateway.js` does not send that header yet — until
the lead adds it, every payout fails closed with 401 (see the lead's notes
in the build report).

## Rolling back

- **The app, one device:** open it with `?payments=sim`. The rail is off
  for that device at once; every screen says *Sandbox UPI* again.
- **The app, every device:** the lead sets `PAYMENTS.mode` back to `'sim'`
  and pushes; the deployed bundle carries the change.
- **The server:** `supabase functions delete razorpay-payout` (or any of
  the four) takes it off the internet in seconds. Deleting the webhook
  function makes Razorpay log failures and retry for a day; that is fine,
  the event ids replay cleanly when it is back.
- **A leaked secret:** rotate it at the source (Razorpay → API Keys →
  Regenerate; Webhooks → edit → new secret) and `supabase secrets set` the
  new value. The functions pick it up on the next request.

## Running the functions locally

With the Supabase CLI and Docker: `supabase start`, then
`supabase functions serve --no-verify-jwt --env-file ./supabase/.env.local`
(put the secrets in that file). **`.gitignore` has no rule for it today** —
add `supabase/.env*` there before creating the file, and never commit it.
Then point the app at `http://localhost:54321/functions/v1`.

Without Docker, plain Deno runs any one of them:
`RAZORPAY_KEY_ID=rzp_test_XXXX RAZORPAY_KEY_SECRET=… deno run -A supabase/functions/razorpay-order/index.ts`
listens on `http://localhost:8000`. `deno check supabase/functions/*/index.ts`
and `deno lint supabase/functions` are the two gates a change to these
files must pass. Deno is available without installing anything system-wide
via `npm i deno` in a scratch folder.

## The tables (migration 0004)

| Table | One row per | Written by |
|---|---|---|
| `gateway_events` | webhook delivery (id = Razorpay event id) | `razorpay-webhook` — insert-ignore, then `processed_at` |
| `gateway_payments` | Razorpay payment (`pay_…`) | `razorpay-webhook` on `payment.captured` / `payment.failed` / `refund.processed` |
| `gateway_payouts` | payout attempt (`trf_…` or `pout_…`) | `razorpay-payout`; status updated by `razorpay-webhook` on `payout.*` |

All three: readable by the owner (`app.is_admin()`), writable by nobody in
the browser. They are the server's **mirror** of what Razorpay said; the
ledger legs the product shows are still posted by the app from
`gateway.js`'s receipt, and moving that posting to the webhook is the lead's
release-queue work (`docs/PRODUCTION.md` §3).
