# SAAHAA — first-time setup

Do this **once**. About 45 minutes. Don't do it tired, and don't skip steps.

Everything here is free. No credit card is asked at any point.

---

## Part A — GitHub repository (once)

Your remote is already configured as `https://github.com/Ohhks/saahaa.git`, but
**that repository does not exist yet** — a push will fail with "Repository not
found" until you create it.

1. Go to **github.com** and sign in as `Ohhks`.
2. Top-right **+** → **New repository**.
3. Repository name: `saahaa` (exactly).
4. Select **Public**.
   > This is deliberate. Public repos get **unlimited free Actions minutes**;
   > private ones get 2,000/month. Your built app is public anyway, and no
   > secret lives in this repo.
5. Do **not** tick "Add a README", ".gitignore" or "license" — you already have files.
6. **Create repository**.
7. Back in PowerShell, in `C:\Users\siidhu\saahaa`:

```bash
git push -u origin main --tags
```

Sign in when the browser window pops up. Refresh GitHub — your files are there.

## Part B — turn on Pages

8. Repo → **Settings** (top bar).
9. Left sidebar → **Pages**.
10. Under **Build and deployment → Source**, choose **GitHub Actions**.
    > NOT "Deploy from a branch". This is the step people get wrong. Actions
    > deploy is what lets CI block a broken build, and it is what makes
    > rollback a button.
11. No save button — it applies immediately.

## Part C — Supabase project

12. **supabase.com** → **Start your project** → sign in with GitHub.
13. **New project**. Name: `saahaa-prod`.
14. Database password → **Generate a password**, then **paste it into your
    password manager immediately**. You are not shown it again and it cannot be
    recovered.
15. Region: **South Asia (Mumbai)** — closest to Hyderabad.
16. Plan: **Free**. Create. Wait ~2 minutes.

### Run the migrations, in order

17. Left sidebar → **SQL Editor** → **New query**.
18. Open `supabase/migrations/0001_schema.sql` from your repo, copy all of it,
    paste, **Run**.
19. Same with `0002_money_rls.sql`, then `0003_automation.sql`, then
    `0004_gateway.sql`. **Order matters.**
20. Set the OTP pepper — **this is the single most important line in the whole
    setup**. Without it, a leaked code hash is brute-forced in milliseconds,
    because a 6-digit code is only a million possibilities:

```sql
alter database postgres set app.otp_pepper = 'PASTE_32_RANDOM_CHARACTERS_HERE';
```

Generate the value with `python -c "import secrets;print(secrets.token_urlsafe(32))"`
and store it in your password manager. Then, in SQL Editor, run
`select pg_reload_conf();` and confirm with `show app.otp_pepper;`.

21. Enable the cron extension: **Database → Extensions** → search `pg_cron` →
    enable. Then re-run the `select cron.schedule(...)` block at the bottom of
    `0003_automation.sql`.

### Get your keys

22. **Project Settings** (gear) → **API**. Three things:
    - **Project URL** — `https://xxxx.supabase.co`
    - **`anon` `public`** key — starts `eyJ…`. **Safe to ship in the app.**
      It authorises nothing on its own; Row Level Security decides everything.
    - **`service_role` `secret`** key — also starts `eyJ…`. **This is a master
      key that bypasses all security.** Put it in your password manager and
      **nowhere else** — not in the code, not in a chat, not in a screenshot.
      Nothing in this project needs it.

## Part D — connect the app

23. Open `src/core/config.js` and fill in `BAKED`:

```js
const BAKED = {
  url:     'https://xxxx.supabase.co',
  anonKey: 'eyJ...your anon key...',
};
```

24. Commit and push:

```bash
git add src/core/config.js && git commit -m "chore: connect Supabase" && git push
```

> You can also skip this and test first by opening the live site with
> `?sb=https://xxxx.supabase.co&key=eyJ...` once — it stores locally.

### Your admin credential

The admin username is **`siidhartha12`**. There is no shipped password and no
default to change: what `src/core/config.js` carries in `ADMIN_BOOTSTRAP` is a
**PBKDF2-SHA256 hash** (250,000 rounds over a random salt), and a login is
checked by re-deriving and comparing. The password itself exists only in your
password manager.

To set or rotate it:

```bash
node tools/admin-cred.mjs '<new password>'
```

Paste the printed `{salt, hash, iterations}` block into `ADMIN_BOOTSTRAP`,
bump its `version`, commit and push. That is what a **fresh** device starts
with. A device already signed in keeps whatever password was set on it from
Admin → System & audit → change password, which is the faster way to change it
on a single machine.

Put the password in your password manager the moment you choose it. It cannot
be recovered from the hash, and there is no reset link — losing it means
minting a new bootstrap and pushing again.

> **Never** commit the password itself, in `config.js` or anywhere else. Only
> the hash ships.

## Part E — Actions secrets (for the keepalive only)

25. Repo → **Settings** → **Secrets and variables** → **Actions**.
26. **New repository secret** → name `SUPABASE_URL` → paste the project URL → Add.
27. **New repository secret** → name `SUPABASE_ANON_KEY` → paste the anon key → Add.
28. **Do NOT add the service_role key.** Nothing uses it. A secret that exists
    is a secret that can leak.

## Part F — verify

29. Repo → **Actions**. Watch **CI** and **Deploy to Pages** run. Both green.
30. Settings → Pages shows your live URL: `https://ohhks.github.io/saahaa/`.
    **Bookmark it.**
31. Open it in a **private window**. Add `?selftest=1` — all tests must pass.
32. Actions → **Supabase Keepalive** → **Run workflow**. It must go green.
    If it fails, step 18 or 26/27 went wrong. Fix it now — this is the job that
    stops your project pausing and your escrow silently freezing.

33. Bookmark three URLs in a folder called **SAAHAA OPS**:
    - `github.com/Ohhks/saahaa/actions` — deploys and rollback
    - your Supabase **SQL Editor** — database rollback
    - `ohhks.github.io/saahaa/` — the live site

**Done. You never repeat Parts A–E.**

## Part G — Payments (later, the day the Razorpay account exists)

Nothing above depends on this. Until it is done the app runs in `sim` mode:
every screen that moves money says *Sandbox UPI — no real money moves yet*,
and that is honest, not broken. Test mode costs nothing and needs no
activated account.

34. Razorpay → Settings → API Keys → **Generate Test Key**. Key id
    (`rzp_test_…`) and secret → password manager. The secret is shown once.
35. On your machine: `npm i -g supabase`, `supabase login`,
    `supabase link --project-ref <ref>` (`<ref>` = the `xxxx` in your
    project URL).
36. Set the secrets — **never in the repo, never in `config.js`**:

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_XXXX RAZORPAY_KEY_SECRET=XXXX RAZORPAY_WEBHOOK_SECRET=XXXX ALLOWED_ORIGINS=https://ohhks.github.io,http://localhost:8772
```

    Make `RAZORPAY_WEBHOOK_SECRET` up: 32+ random characters, same generator
    as the OTP pepper. You paste the same string into Razorpay in step 38.
37. Deploy the four functions, each with `--no-verify-jwt`:

```bash
supabase functions deploy razorpay-order   --no-verify-jwt
supabase functions deploy razorpay-verify  --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy razorpay-payout  --no-verify-jwt
```

38. Razorpay → Webhooks → Add: URL
    `https://<ref>.functions.supabase.co/razorpay-webhook`, the secret from
    step 36, events `payment.captured`, `payment.failed`, `refund.processed`,
    `transfer.processed`, `settlement.processed`.
39. Open the live site **once** with
    `?payments=razorpay&rzkey=rzp_test_XXXX&fnurl=https://<ref>.functions.supabase.co`.
    Top up ₹10 with card `4111 1111 1111 1111`. The wallet moves, and
    `select * from gateway_payments;` in the SQL Editor shows one
    `captured` row. Full walkthrough, the Route/Payouts choice and rollback:
    `supabase/README.md`.
40. Back to the sandbox at any time: `?payments=sim`.

The service-role key is **still** not needed anywhere: Supabase injects it
into the functions itself. Step 28 stands.

---

## What you will see on the first open

**Nothing, and that is correct.** A new install has no customers, no pros, no
shops and no products — production seeds only the owner's credential. The
first real account on a device is the first one somebody signs up.

If you want a populated screen to click through locally, open the app with
**`?demo=1`**. That loads an example roster of customers, pros, shops and
products and turns the market simulation on **for that one page load**. It is
also what the deck capture uses (`python tools/shots.py` opens
`?shot=<scene>&demo=1`). There is no build, flag or setting that turns it on
for a real device.

## Two things that need no setup at all

**Maps.** No key, no account, no dashboard. Tiles come from OpenStreetMap,
geocoding and reverse geocoding from Nominatim (OpenStreetMap's free
geocoder), and Leaflet is **vendored** under `/vendor/leaflet` rather than
pulled from a CDN — the CSP allows scripts from `self` only, and a
tradesperson's phone should not depend on a third party's uptime. Because the
geocoder is worldwide, a partner or shop can enrol anywhere: search an
address, drop a pin, or use the device's own location.

**Charges.** The service percentage, the platform's retail percentage and the
delivery bands by distance are dials in **Admin → Charges**, not constants in
the source. **Push** applies them to every quote made from then on; orders
already booked keep the fees they were booked with, so a change can never
re-price money sitting in escrow. Defaults and their permitted ranges are in
`src/domain/settings.js`; every push is audited.

---

## Rollback — read this before you need it

### Bad frontend deploy — about 40 seconds
1. **Actions** tab
2. **Deploy to Pages** in the left sidebar
3. Open the last **green** run from *before* the bad one
4. Top right → **Re-run all jobs**

That's it. No git. Check the result in a **private window** — your own browser
cache will otherwise show you the broken version and send you round the loop again.

**If the site is broken and you cannot think:** Settings → Pages → Source →
**None**. The site goes offline in ~30 seconds. A dead site beats a site taking
bad orders. Turn it back on when calm.

### Bad database migration — about 3 minutes
There is no re-run button, which is exactly why applying migrations is manual.

- **Additive changes** (`add column`) reverse trivially with `drop column`,
  as long as nothing has written to it yet.
- **Destructive changes are not reversible on the free tier.** There is no
  point-in-time recovery. So the standing rule is: **never drop. Rename to
  `_deprecated_<name>` and delete it a month later.**
- Before any migration that touches existing data, run this first — it takes
  two seconds and turns an unrecoverable event into a ten-second fix:

```sql
create table backup_orders_20260901 as select * from orders;
```

---

## What stays manual, forever

| Never automated | Why |
|---|---|
| Applying a migration to production | Free tier has no point-in-time recovery |
| A partner's first in-home job approval | One bad actor in a home ends the business |
| Any safety, harassment or injury report | Needs a human in minutes, possibly the police |
| Permanent bans | Irreversible action against someone's livelihood |
| Fee and delivery-band changes (Admin → Charges → Push) | Nothing already booked reprices, but every quote made afterwards does. It is a pricing decision, and it is yours |

Everything else is either fully automatic or waits for you in one screen.
See [AUTOMATION.md](AUTOMATION.md).
