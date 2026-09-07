# Going to production: payments, Supabase, Cloudflare, GitHub

Everything here is India-specific and current as of September 2026. Verify
published pricing before you sign anything — Indian gateway rates and RBI rules
move every few months.

---

## 1. The payment problem, stated honestly

A normal Razorpay or Stripe checkout assumes **you are the merchant and the
money is yours**. SAAHAA is not that. A customer pays ₹1,100 for a plumber's
work, and ₹1,000 of it is the plumber's money — you are only holding it until
the OTP fires.

That is a regulated activity.

**RBI's Payment Aggregator framework** defines a PA as anyone who *"receives
payments from customers, pools them, and transfers them on to merchants after a
time period."* That is exactly this app. Becoming an authorised PA needs **₹15
crore net worth at application and ₹25 crore by year three.** You will not clear
that, and operating without authorisation is an offence under the Payment and
Settlement Systems Act, not a technicality.

And practically: the moment ₹1,000 of a worker's money sits in your current
account it is commingled with yours, attachable by your creditors, counted as
*your* turnover by your bank and by GST officers, and a textbook
many-in-many-out AML pattern. Banks freeze accounts for that. Yours would
freeze mid-festival-week, with 200 workers unpaid.

> **The architectural conclusion: SAAHAA must never hold third-party money.**
> Every rupee sits inside an authorised aggregator's escrow, and your only
> power over it is issuing split and release instructions over an API.

Note also: **Stripe India does not offer Connect's marketplace payouts** to
Indian businesses paying Indian recipients. Do not plan around it.

### What the code already does about it

`src/core/gateway.js` is the **one door** money uses. Every rupee a customer
pays enters through `collect()`; every rupee that leaves for a worker's, a
shop's or a customer's UPI leaves through `payout()`. Nothing else in the
product talks to a rail. Today it runs in `MODE = 'sim'`: a `collect()`
succeeds instantly, moves no real money, and is labelled *Sandbox UPI — no
real money moves yet* on every screen and `via: 'upi-sim'` on every ledger
leg. The ledger, the escrow, the wallets and the treasury move exactly as
they will with a real rail, because they never knew which rail it was. Going
to production means changing that one file (§3), not the product.

## 2. Which gateway

| | Razorpay **Route** | Cashfree **Easy Split** | Direct UPI to your own VPA |
|---|---|---|---|
| RBI status | Authorised PA | Authorised PA | **You become the PA. Illegal.** |
| UPI MDR | 0% | 0% | 0% |
| Card MDR | ~2% + 18% GST | ~1.75–1.95% + GST | — |
| Per-transfer fee | **none** | none on split; **Payouts is ~₹2.50–5 each** | — |
| Hold-and-release | **`on_hold: true`, then PATCH to release** | hold/release | — |
| Sole proprietorship | yes | yes | — |
| Onboarding | 2–5 days + 3–10 for Route | similar | — |

**Recommendation: Razorpay PG + Route.**

1. The split happens **inside Razorpay's escrow**. You never take custody. That
   is the whole ballgame.
2. `on_hold: true` maps 1:1 onto your existing OTP release. You create the
   transfer at capture and release it with
   `PATCH /v1/transfers/:id {on_hold:false}` when the OTP RPC succeeds.
   No prefunding, no float, no per-transfer fee.
3. Best-documented sole-proprietor path in India, which matters more than a
   0.2% MDR saving when you are doing this alone.

Revisit Cashfree at roughly ₹10L/month GMV if your card mix is high. Do **not**
build on Cashfree *Payouts* as your release mechanism — prefunding a payout
balance means you are holding pooled money again.

### Start here instead — Phase 0, this month

Before Route is even approved, run SAAHAA as **discovery, not collection**:

- The customer pays the worker **directly** at the door — the worker's own UPI
  QR, or cash. You never touch it, so no PA question arises.
- You charge **only your commission**, billed to the *worker*, through a plain
  Razorpay Payment Link or a prepaid lead wallet. That is ordinary merchant
  revenue in your own account. On a ₹165 commission that costs about ₹3.90 by
  card, **₹0 by UPI**.
- The escrow and OTP stay as the *trust ritual* — the OTP proves completion and
  triggers the commission invoice.

This gives you real revenue, real workers and real transaction history at
near-zero cost and zero regulatory exposure — and a transaction history is
exactly what Razorpay's Route reviewer wants to see.

## 3. The money flow, once it is real

```
Customer taps Pay
  -> Supabase RPC returns the amount        (never computed in the browser)
  -> Cloudflare Worker creates a Razorpay Order  (key_secret lives ONLY here)
  -> Razorpay Checkout opens with key_id
  -> customer authorises; funds land in RAZORPAY'S ESCROW

WEBHOOK payment.captured  -> Worker verifies HMAC -> RPC marks paid
  -> Worker creates a Route transfer with on_hold: true
     Razorpay now earmarks the worker's share INSIDE its own escrow.
     *** This is the escrow. Not your database. ***

Worker arrives -> customer reads the OTP -> verify_otp RPC succeeds
  -> a row lands in release_queue
  -> a Worker cron drains it: PATCH /transfers/:id { on_hold: false }

WEBHOOK transfer.processed -> ledger entries written
WEBHOOK settlement.processed -> your commission reaches your bank T+2
```

### How `gateway.js` maps onto Razorpay

| In the app today (`MODE 'sim'`) | With Razorpay (`MODE 'razorpay'`) |
|---|---|
| `collect({paise, purpose, key})` returns a receipt at once | `POST /orders` on the Worker creates a Razorpay **Order** for `paise`; Checkout opens with `key_id`; the receipt is **not** posted until the `payment.captured` webhook lands (§4). The `PAYMENT_IN` / `TOPUP` leg into `CUSTOMER:<key>` is written by the webhook handler, not the browser |
| `payout({paise, upi, purpose, key})` returns a receipt at once | For a worker's or shop's share of an order: a **Route transfer** created at capture with `on_hold: true`, released with `PATCH /transfers/:id {on_hold:false}` when the customer confirms. For a wallet take-out (a customer's refund balance, a worker's available balance): **Razorpay Payouts** to the penny-drop-verified UPI id. The `WITHDRAW` / `PAYOUT` leg is written on `transfer.processed` / `payout.processed` |
| `label()` says *Sandbox UPI* | *UPI · cards · net banking via Razorpay* |
| `isSandbox()` is `true` and every screen that moves money says so | `false`; the label disappears |

The purpose strings `collect()` and `payout()` already carry — `service`,
`retail`, `topup`, `refund-out`, `payout` — are what the Worker uses to
decide Route versus Payouts. Keep them.

**The treasury's two actions become real, too.** `Withdraw fees`
(`PLATFORM:fee → WORLD:bank`) is the settlement Razorpay makes to your current
account, T+2 after capture: post the `FEE_WITHDRAW` leg from the
`settlement.processed` webhook, with the settlement id in `meta`, rather than
by hand. `Remit GST` (`PLATFORM:gst → WORLD:tax`) is the monthly GSTR-3B
payment on the GST portal; post the `GST_REMIT` leg with the challan (CPIN)
number when it clears. Both stay step-up protected and audited; what changes
is that the number on the treasury screen is then the same number your bank
and the portal show, and the *Reconciles* line is a check against the outside
world, not only against the books.

**On a ₹1,100 booking with a 15% take:**

| | |
|---|---|
| Customer pays | ₹1,100.00 |
| Commission | ₹165.00 |
| GST @18% on the commission | ₹29.70 |
| TDS u/s 194-O @0.1% of gross | ₹1.10 |
| GST TCS u/s 52 @0.5% | ₹5.50 |
| **Transfer to the worker** | **₹898.70** |

### The mistake everyone makes

**Paying out on anything other than a verified, settled, undisputed payment.**

1. Paying out on the **client-side checkout callback**. It is user-controlled
   JavaScript; a `fetch` forges it. Only the `payment.captured` webhook counts.
2. Paying out on `payment.authorized` rather than `payment.captured`.
   Authorised is not captured is not settled.
3. Releasing before the dispute window. Once the worker has the money, a
   successful chargeback is *your* loss. Hold T+1 minimum for new workers.
4. Treating your Postgres `status` column as the funds authority. Postgres is
   the **mirror**. Razorpay's transfer state is the **truth**. Reconcile nightly.

### Tax — the one that can make you loss-making

**Section 9(5) CGST.** For notified services supplied *through* an e-commerce
operator — which explicitly includes **"house-keeping, such as plumbing,
carpentering"** — the **operator pays the entire 18% GST** when the underlying
supplier is unregistered. On a ₹1,100 order that is about ₹167.80 payable out
of a ₹165 commission.

**Get a CA opinion on which of your categories fall under 9(5) before you set
the take rate.** It may force you to onboard only GST-registered workers, or to
price those categories differently. This is the single most expensive thing on
this page to get wrong.

Also: **GST registration is mandatory from rupee one** under §24(x) — there is
no ₹20/40 lakh threshold for an e-commerce operator. TCS is **0.5%** (reduced
from 1% in July 2024), filed monthly on GSTR-8. TDS §194-O is **0.1%** (reduced
from 1% in October 2024), with no deduction for a resident individual under
₹5,00,000 a year who has given you their PAN.

## 4. Webhooks — where they land

GitHub Pages serves static bytes; it cannot receive a webhook. You need exactly
one piece of server-side compute, and it is **Supabase Edge Functions** — the
project that already holds the database, so no second vendor, no second bill,
no domain needed to start. The code is in `supabase/functions/`, four
functions and a `_shared/` folder, deployed with one CLI command each
(`supabase/README.md`).

This is also the real difference between the sandbox and the rail. In `MODE
'sim'` a `collect()` resolves the moment it is called; with Razorpay the app
must treat a checkout as **pending** until `payment.captured` arrives here.
A customer who closes the tab after paying is still on record, because the
webhook does not need the tab.

**The four functions**

| Function | Called by | Does | Answers |
|---|---|---|---|
| `razorpay-order` | the browser, `gateway.collect()` | validates `{amount, purpose, key}` (whole paise, 100 … 1,00,00,000) and creates a Razorpay Order with the secret key | `{ok, orderId, amount, currency:'INR', keyId}` |
| `razorpay-verify` | the browser, after Checkout | recomputes HMAC-SHA256(`orderId|paymentId`, key secret), compares in constant time, then reads the payment back and insists on `captured` / `authorized` for this order | `{ok, status, amount}` |
| `razorpay-webhook` | Razorpay | HMAC over the **raw** body with the webhook secret → `gateway_events` (event id = primary key) → mirrors into `gateway_payments` / `gateway_payouts` | 200; 400 on a bad signature |
| `razorpay-payout` | the browser, `gateway.payout()`, **owner session only** | Route transfer if the key is in `RAZORPAY_ACCOUNT_MAP`, else a RazorpayX payout to the UPI id if `RAZORPAYX_ACCOUNT_NUMBER` is set, else `{ok:false}` | `{ok, ref, mode:'route'|'payoutx'}` |

**The webhook handler, in order** (this is what `razorpay-webhook/index.ts` does):

1. Read the **raw** body. Never parse-then-restringify before checking the HMAC.
2. `HMAC-SHA256(raw, RAZORPAY_WEBHOOK_SECRET)` vs `x-razorpay-signature`,
   compared in constant time. Fail → 400, nothing stored.
3. Idempotency key is `x-razorpay-event-id` — stable across all retries.
4. `INSERT into gateway_events … ON CONFLICT DO NOTHING`. No row returned
   means a replay: 200.
5. Mirror what matters (`payment.captured` → `gateway_payments`, …), stamp
   `processed_at`, return 200. A mirror write that fails still gets a 200:
   the event row already holds the payload and `processed_at is null` marks
   it for replay from the table. The one 5xx after a good signature is when
   the event row itself could not be stored — then a retry is exactly what
   we want.
6. The mirror is a **state machine**, not "insert if absent": a late
   `payment.failed` never overwrites a `captured`, because Razorpay does not
   guarantee event order.

> Do **not** reject events on a timestamp window. Razorpay retries over ~24
> hours reusing the same event id; a 5-minute window would drop legitimate
> retries. **Event-id uniqueness is the replay defence.** (Cashfree is the
> opposite — it signs `timestamp + body`, and there a window *is* correct.)

**Environment — every name the functions read**

| Name | Set with | Read by | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | `supabase secrets set` | order, verify, payout | the **public** id (`rzp_test_…` / `rzp_live_…`); the only one that is also in the browser |
| `RAZORPAY_KEY_SECRET` | `supabase secrets set` | order, verify, payout | Basic-auth password to `api.razorpay.com` and the checkout-signature key. Never in the repo, never in a response |
| `RAZORPAY_WEBHOOK_SECRET` | `supabase secrets set` | webhook | the string you type into the Razorpay webhook form; rotate independently of the key secret |
| `ALLOWED_ORIGINS` | `supabase secrets set` | order, verify, payout | comma-separated CORS origins; defaults to `https://ohhks.github.io,http://localhost:8772` |
| `RAZORPAY_ACCOUNT_MAP` | `supabase secrets set` | payout | JSON `{"<app key>":"acc_…"}` — keys listed here are paid by Route |
| `RAZORPAYX_ACCOUNT_NUMBER` | `supabase secrets set` | payout | RazorpayX current-account number; unset = that path is off |
| `VERIFY_CONFIRM` | `supabase secrets set` | verify | `0` skips the read-back after the signature check; leave unset |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **injected by Supabase** | webhook, payout | never set by hand. The service-role key is why the browser cannot write a `gateway_*` row (§6) |

## 5. Cloudflare — what actually earns its place

| Piece | Free tier | Need it now? | Why |
|---|---|---|---|
| **DNS + custom domain** | unlimited | **Yes, day 1** | Gateway onboarding and brand trust need a domain you own. The webhook does not: Razorpay is happy with `https://<ref>.functions.supabase.co/razorpay-webhook` |
| **Transform Rules** (response headers) | 10 rules | **Yes** | GitHub Pages **cannot set headers at all** — no CSP, no HSTS. This is the only way to add them |
| **Workers** | 100k req/day | **Not now** | The Edge Functions (§4) are the server, and `pg_cron` (migration 0003) is the cron. A Worker earns its place only if you later want `api.saahaa.in` in front of the functions |
| **Turnstile** (captcha) | ~1M/mo | **Yes** | Gates signup and OTP abuse. Verify the token in an Edge Function or a SECURITY DEFINER RPC, never the browser |
| **Cloudflare Pages** | 500 builds/mo | **No — don't switch** | You'd gain PR previews and lose a working pipeline. Revisit if you exceed Pages' limits |
| **R2** (images) | 10GB, zero egress | **Not yet** | Move when Supabase egress overage appears, around 50GB/month of images |
| **Access** on `/admin` | 50 users | Optional | Stops casual discovery. **It is not the control** — real admin security is the `is_admin()` check inside every RPC |

> **The cargo-cult trap, stated plainly:** Cloudflare's WAF **cannot protect
> your API.** The browser talks *directly* to `xxxx.supabase.co`, which never
> passes through Cloudflare. Your actual API defence is Postgres RLS plus rate
> limits inside the SECURITY DEFINER functions. Believing otherwise is the
> single most dangerous misconception in this stack.

## 6. Topology and where each secret lives

```
domain -> CLOUDFLARE (DNS, Transform Rules)         RAZORPAY (escrow, Route, RazorpayX)
   |                                                   ^                 ^
   |  saahaa.in                           key secret   |                 |  webhooks, HMAC
   v                                                   |                 v
GITHUB PAGES                           SUPABASE EDGE FUNCTIONS  supabase/functions/
  the static app                         razorpay-order     razorpay-verify
  ships ONLY:                            razorpay-webhook   razorpay-payout
   - SUPABASE_URL                        hold ONLY (supabase secrets set):
   - SUPABASE_ANON_KEY                    - RAZORPAY_KEY_SECRET
   - RAZORPAY_KEY_ID                      - RAZORPAY_WEBHOOK_SECRET
   (all public by design)                 - SUPABASE_SERVICE_ROLE_KEY (injected)
        |                                        |
        | browser fetch: anon key, RLS           | service role: gateway_* mirror only
        v                                        v
   SUPABASE POSTGRES (auth, RLS, RPCs, pg_cron)  <--+
```

| Secret | Lives in | Must never reach |
|---|---|---|
| `SUPABASE_ANON_KEY` | the public bundle | — public by design. **It is not a security control**: with RLS off it is a full data dump |
| `SUPABASE_SERVICE_ROLE_KEY` | the Edge Functions' environment, **injected by Supabase** | browser, repo, build output, error messages, GitHub secrets. **Bypasses all RLS — treat as a root password.** It is the only thing that can write `gateway_events` / `gateway_payments` / `gateway_payouts`, which is the whole point of those tables |
| `RAZORPAY_KEY_SECRET` | Edge Function secret (`supabase secrets set`) | everywhere else |
| `RAZORPAY_WEBHOOK_SECRET` | Edge Function secret | rotate independently of the key secret |
| `RAZORPAY_ACCOUNT_MAP`, `RAZORPAYX_ACCOUNT_NUMBER` | Edge Function secrets | the browser; a response body |
| `SUPABASE_DB_URL` | GitHub Actions `production` environment | the functions, the browser, the repo |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret, only if a Worker is ever added; scoped to one zone | never a Global API Key |

## 7. Wiring the rail, step by step

Everything below is in test mode and costs nothing. The long form, with the
dashboard clicks, is `supabase/README.md`; this is the order.

1. **Razorpay account** at razorpay.com → Settings → API Keys → *Generate
   Test Key*. You get a key id (`rzp_test_…`) and a secret. The secret is
   shown once — password manager, now.
2. **Supabase CLI** on your machine: `npm i -g supabase`, then
   `supabase login` and `supabase link --project-ref <ref>`.
3. **Migration 0004** — SQL Editor → paste `supabase/migrations/0004_gateway.sql`
   → Run. Confirm with `select count(*) from gateway_events;` (0 rows, no error).
4. **Secrets** — one command, from `supabase/README.md`, *Secrets*:
   `supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=… ALLOWED_ORIGINS=…`.
   Make the webhook secret up (32+ random characters); you will paste the
   same string into Razorpay in step 6.
5. **Deploy** the four functions, each with `--no-verify-jwt`
   (`supabase/README.md`, *Deploy*). `supabase functions list` shows all four.
6. **Webhook** — Razorpay → Webhooks → Add: URL
   `https://<ref>.functions.supabase.co/razorpay-webhook`, the secret from
   step 4, and tick `payment.captured`, `payment.failed`, `refund.processed`,
   `transfer.processed`, `settlement.processed`.
7. **Switch one device**: open the live site with
   `?payments=razorpay&rzkey=rzp_test_…&fnurl=https://<ref>.functions.supabase.co`.
   The *Sandbox UPI* label is gone; `gateway.mode()` reads `razorpay`.
8. **Pay ₹10 with the test card** (`supabase/README.md`, *The test-card
   walkthrough*): wallet + ₹10, ledger leg `via: 'razorpay'`, one row in
   `gateway_payments` with `status = 'captured'`, one `payment.captured` in
   `gateway_events` with `processed_at` set. Then a failed card, then a
   closed window: no leg, no captured row.
9. **Try a take-out.** It must say *Could not send that right now* — the
   payout function fails closed until an owner session header is sent by
   the app and a payout path is configured. That is the correct state to
   go live in for collection only (§2, *Phase 0*).
10. **Every device**: the lead bakes `mode`, `keyId` and `functionsUrl` into
    `PAYMENTS` in `src/core/config.js` and ships a release.
11. **Live mode**, when the Razorpay account is activated: live keys
    (`rzp_live_…`), a **second** webhook with its own secret,
    `ALLOWED_ORIGINS` without `localhost`, and Supabase Pro the same week
    (§10).
12. **Rollback** is a query string: `?payments=sim` on the device;
    `PAYMENTS.mode = 'sim'` in config for everyone;
    `supabase functions delete <name>` to take a function off the internet.

## 8. Custom domain and HTTPS

1. Buy it. **Cloudflare Registrar** sells `.com` at wholesale (~₹950/yr, free
   WHOIS privacy). `.in` must come from BigRock/GoDaddy India (~₹500–900 first
   year). `.in` reads more trustworthy in Hyderabad.
2. Point the registrar's nameservers at Cloudflare.
3. DNS for GitHub Pages — apex needs four A records:
   `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`
   (and the four AAAA `2606:50c0:800{0,1,2,3}::153`), plus
   `CNAME www -> ohhks.github.io`.
4. **Set the proxy to DNS-only (grey cloud) first.** GitHub must reach the
   domain unproxied to complete the ACME challenge, or "Enforce HTTPS" stays
   greyed out forever.
5. Repo → Settings → Pages → Custom domain. Wait for the certificate. Tick
   **Enforce HTTPS**. Commit the `CNAME` file to source, or a later deploy wipes it.
6. *Now* turn the orange cloud on.
7. **SSL/TLS mode must be `Full (strict)`.**

> **The classic failure:** SSL mode `Flexible` means Cloudflare fetches your
> origin over plain HTTP, GitHub Pages redirects HTTP→HTTPS, Cloudflare serves
> the redirect, the browser returns over HTTPS, and round it goes —
> `ERR_TOO_MANY_REDIRECTS`, forever. One setting causes it.

Then: Always Use HTTPS on, minimum TLS 1.2, HSTS **only after a week of stable
HTTPS** (it is not reversible in browsers that cached it), and a redirect rule
canonicalising `www` to the apex.

## 9. GitHub production settings

Assume a **public repo** — most of the good controls are free on public and
paid on private.

- **Secret scanning + push protection: ON.** Highest-value item here. It
  physically blocks you from pushing a `service_role` key.
- **Branch protection on `main`**, tuned for one person: block force pushes,
  require linear history, require a PR with **0 required approvals** (this
  exists only to force CI to run). Do **not** require approvals or CODEOWNERS
  review — you cannot approve your own PR and would lock yourself out. Leave
  "do not allow bypassing" **off**; you will need an emergency bypass one day.
- **Required status checks:** the CI job already covers syntax, tests, build,
  preflight and migration lint. Add one more that is worth more than all of
  them: **fail if any table in `public` has RLS disabled.**
- **`production` environment** holding the DB and Cloudflare secrets, scoped to
  `main` and `v*` tags, with a 5-minute wait timer as a cancel window.
- **Pin third-party actions to a commit SHA**, not a tag. A compromised action
  tag is the realistic supply-chain attack on a repo holding a Cloudflare token.
- Migrations are **manual dispatch only**. Never auto-run on push.

## 10. Before the first real rupee

**Legal** — Udyam + Shop & Establishment registration; a current account; GST
registration (mandatory, no threshold); **a CA opinion on §9(5)**; TAN for TDS;
a written worker agreement stating you are a facilitator, not the provider;
Consumer Protection (E-Commerce) Rules compliance including a named **Grievance
Officer** with a 48-hour acknowledgement and 1-month resolution; a DPDP-Act
privacy policy with consent, erasure and breach notification; refund policy,
pricing page, and a contact page with a physical address — Razorpay's
compliance team checks all four. **Consider an LLP before taking custodial
money**; a proprietorship carries unlimited personal liability.

**Technical** — **Supabase Pro ($25/mo) the same week you take real money.**
The free tier has no restorable backups and pauses after 7 days; you cannot run
a payments ledger on that. Then: an RLS audit returning zero tables with RLS
off; `REVOKE EXECUTE` on every internal SECURITY DEFINER function;
`SET search_path` on all of them; rate limits **inside Postgres** (Cloudflare
cannot do this for you); Turnstile on signup; webhook replay and tamper tests;
**a nightly reconciliation against Razorpay from day one** — a ₹40,000 drift
discovered after three months is unrecoverable; and a restore drill, because an
untested backup is not a backup.

**Operational** — a written refund policy; a published dispute SLA you can
actually meet alone; a **WhatsApp Business number** as the support channel;
a stated worker payout SLA (payout ambiguity is the top reason supply churns);
an incident runbook (`docs/RUNBOOK.md`); and ₹15–25k of your own float for
goodwill refunds in month one.

## 11. What it costs

| | 0/mo | 100/mo | 1,000/mo | 10,000/mo |
|---|---|---|---|---|
| Domain | ₹75 | ₹75 | ₹75 | ₹75 |
| Cloudflare | ₹0 | ₹0 | ₹0 | ₹430 |
| GitHub | ₹0 | ₹0 | ₹0 | ₹0 |
| Supabase | ₹0 | ₹2,150 | ₹2,150 | ₹4,300–6,500 |
| Card MDR | ₹0 | ₹649 | ₹6,490 | ₹64,900 |
| Netbanking MDR | ₹0 | ₹123 | ₹1,232 | ₹12,320 |
| Route transfer fees | ₹0 | **₹0** | **₹0** | **₹0** |
| **Total** | **₹75** | **~₹3,000** | **~₹9,950** | **~₹84,000** |
| Commission earned | ₹0 | ₹16,500 | ₹1,65,000 | ₹16,50,000 |
| Infra as % of commission | — | 18% | **6%** | **5%** |

**Your first real bill is Supabase Pro, and it is triggered by a decision, not
a limit:** the week real money starts moving. Take it then, before you hit any
usage ceiling.

**The one cost that scales is card MDR, and it is entirely mix-driven.** At
10,000 orders/month, shifting card share from 25% to 10% saves about
**₹39,000 a month.** Default the checkout to UPI and list it first. That single
UI decision is worth more than every infrastructure optimisation on this page
combined.

*(Route's ₹0 transfer fee is why it wins: the same volume on Cashfree Payouts
would cost roughly ₹35,400/month at 10,000 transfers.)*

**The cost not on this table, and larger than all of it: a CA.** Budget
₹15–30k/year from month one. GSTR-8, 26Q and the §9(5) question are not a DIY
exercise.
