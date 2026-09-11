# Going live — the parts only you can do

Everything in this repo is built and gated. What remains needs your logins.
Work top to bottom; each step is verifiable before the next.

## 1 · Supabase (5 min)

1. New project, region **Mumbai (ap-south-1)** — closest to Hyderabad, lowest
   latency, and it keeps Indian customer data in India.
2. SQL editor → paste **`supabase/schema.sql`** → Run. It is idempotent, so
   running it twice is safe.
3. Settings → API, copy three things:
   - Project URL
   - `anon` key — public, may ship to the browser
   - `service_role` key — **never** in the repo, never in a browser

Verify: SQL editor → `select beat();` returns a timestamp.

## 2 · Cloudflare Worker (10 min)

```bash
cd worker
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put HOOK_SECRET        # openssl rand -hex 32
npx wrangler secret put ADMIN_CODES        # e.g. C20262001
npx wrangler deploy
```

Verify: `curl https://saahaa-api.<you>.workers.dev/api/health` → `{"ok":true,…}`

## 3 · Cloudflare Pages (5 min)

Pages → Connect to Git → `Ohhks/saahaa`.

- Build command: `python tools/build.py --site`
- Output directory: `dist`

Add a custom domain when you have one. Until then the `pages.dev` URL is real
and shareable.

## 4 · GitHub secrets (2 min)

Repo → Settings → Secrets and variables → Actions:

| secret | from |
|---|---|
| `SUPABASE_URL` | step 1 |
| `SUPABASE_ANON_KEY` | step 1 (anon, not service) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Edit Cloudflare Workers* |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard sidebar |

Verify: Actions → **keep supabase awake** → Run workflow → green.

## 5 · Webhooks (5 min)

Supabase → Database → Webhooks → new:

- Table `payments`, events **Insert, Update**
- URL `https://saahaa-api.<you>.workers.dev/api/hooks/db`
- Header `x-saahaa-signature` — the HMAC of the body using `HOOK_SECRET`

The Worker rejects anything unsigned, so a wrong secret shows up immediately as
401s rather than as silence.

Optional: set `NOTIFY_URL` to a Telegram bot or Slack hook and a claimed payment
reaches your phone without anybody polling.

## 6 · Turn the rail on

The app ships with the sandbox rail so the gates stay honest. Switch a device to
the live one with:

```
https://saahaa.pages.dev/?payments=upi-manual
```

It persists per device. To go back: `?payments=sim`.

---

## The daily routine this creates

**Morning, once:** open `/#/admin` → **Payments to clear**. Every row shows the
UTR, the amount and the reference. Search your bank statement for the UTR:

- found, right amount → **Clear**. Escrow is funded; the pro is payable.
- found, less than the bill → Clear with the amount you actually see. The
  shortfall is recorded on the row; chase it.
- not found → **Reject**. The customer can correct an honest typo and re-claim.

**Then:** pay each due pro from the same account, and record your transfer's UTR
against the payout. That closes the loop: every rupee in has a UTR, every rupee
out has a UTR, and the ledger holds both.

## What to watch in the first fortnight

- **Claims with no matching statement line.** One is a typo. Three from the same
  person is a pattern, and the rail has no automated defence against it — that
  is the cost of running manually and the reason to move to a PSP once volume
  justifies the licence.
- **The gap between pro-check and clear.** If it stretches past a morning, the
  pro is carrying your risk, not the other way round.
- **Whether anyone pays the wrong UPI id.** The screen names exactly one and
  says nobody will ever ask for another; if it happens anyway, that sentence
  needs to be louder, not the policy weaker.
