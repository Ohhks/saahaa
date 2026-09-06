# SAAHAA — from here to production, step by step

*Why any of this matters: [docs/PROBLEM.md](PROBLEM.md) — the real-world problem SAAHAA solves.*

One person, in order. Each step says what it produces and what it unblocks.
Steps 1–7 are today. Steps 8–15 are the first two weeks. Phase D is forever.

## Phase A — the site is live (today, ~1 hour)

1. ✅ **Repository created and pushed** — https://github.com/Ohhks/saahaa (public), every commit and tag. *Unblocks: CI, Pages, releases.*
2. ✅ **Pages via Actions is on.** `deploy.yml` publishes `dist/` to **https://ohhks.github.io/saahaa/** on every push to `main`.
3. ✅ **`main` is protected** — the CI check "Lint, build, test" must pass. *Nothing broken can land.*
4. **First open on the live URL.** Sign in to the admin as `siidhartha12`
   with your own password (the repository holds only its PBKDF2 hash, in
   `ADMIN_BOOTSTRAP` in `src/core/config.js`). Change it from Admin → System
   & audit → change password, or rotate the shipped bootstrap with
   `node tools/admin-cred.mjs '<new password>'` and paste the printed block
   in. Run the in-app self-test (169). Verify chain → ₹0. *The site will be
   empty — that is correct; production seeds nothing.*
5. **Fresh start.** Admin → System & audit → **Fresh start**: type FRESH,
   enter your password again. A snapshot is taken first and can be restored
   from the same screen; every account, order and ledger entry goes; your
   credential and dials stay; the counts are audited (`data.freshStart`). A
   device that was ever opened with `?demo=1` drops the example roster by
   itself at the next normal boot (`data.demoPurged`), but do this once
   anyway on the device you will run from, so the first entry on the books
   is a real one. *Produces: a ledger whose first leg is real money.*
6. **Set your charges.** Admin → Charges: the service percentage laid on top
   of a worker's quote, the platform's retail percentage, the delivery bands
   by distance. **Push** makes them live for every quote made afterwards;
   orders already booked keep the fees they were booked with, so a change can
   never re-price money already in escrow. *Produces: your economics, not the
   defaults.*
7. **Hand-check on your phone and a laptop**: sign up as a customer, open a
   category, book, cancel; sign up as a partner, run the seven steps; open
   the admin and follow the order in the Flow tracker. Ten minutes. *Produces:
   confidence the deploy is the app you tested.* For a screen with something
   already on it, open `?demo=1` locally — it loads an example roster for that
   page load only and is never what a real device gets.

## Phase B — real data, real money (week 1)

8. **Supabase project** (free): apply `supabase/migrations/0001_schema.sql`,
   `0002_money_rls.sql`, `0003_automation.sql` in order; paste the anon key
   into `src/core/config.js`; follow `docs/SETUP.md`. *Produces: accounts and
   orders that survive a phone change; RLS deny-by-default; money mutations
   only through SECURITY DEFINER RPCs.*
9. **Payment collection, UPI only** (`docs/PRODUCTION.md` §2–§3): Razorpay,
   collect-to-escrow, 0% MDR. In the code it is one file:
   `src/core/gateway.js` — `collect()` becomes a Razorpay Order + Checkout,
   posted on the `payment.captured` webhook → Cloudflare Worker (§4) → the
   RPCs. Until then the gateway runs as a sandbox UPI and says so on every
   screen that moves money. Do not enable cards until a full UPI cycle (book
   → release → payout) has run with your own ₹100. *Produces: real escrow.*
10. **Payouts by rail**: `payout()` in the same file becomes a Route transfer
    (a worker's or shop's share, held until the customer confirms) or a
    Payout (a wallet take-out), after penny-drop verification of each UPI id.
    *Produces: pros, shops and customers are paid by rail, not by hand.*
11. **SMS OTP** for step 1 of verification, the arrival code and the
    reference's 4-digit code (any DLT-registered sender). Until that sender
    is live each code is generated and shown on the partner's own screen; the
    ladder and the reference step are real, but nothing is texted.
    *Produces: the last two steps that still complete inside the app run
    against an outside system.*
12. **Tax**: GST registration for the platform fee (18% of the fee is
    remitted, already computed per order); TDS u/s 194-O on partner payouts
    (`docs/PRODUCTION.md` §3). The treasury already holds the GST
    (`PLATFORM:gst`) separately from the fee; Remit GST becomes the monthly
    GSTR-3B payment, posted with its challan number. *Produces: nothing that
    can make you loss-making later.*

## Phase C — supply, then demand (week 2)

13. **Ten pros, in person.** Two per category across plumbing, electrical,
    AC, cleaning, repair. Walk each through the seven steps on their own
    phone; it takes ten minutes and needs nothing from you at all: Background
    Checked and Certified are earned from real jobs, ratings, vouches and the
    reference's code, and audited as actor `auto` (`docs/AUTOMATION.md`). Give each their page link. Their working area
    is set on a real map — searched, pinned, or taken from the device — so
    enrolment is not bounded by a hard-coded area list, or by Hyderabad, or
    by India. *Produces: the ask-rates auction has enough supply (≥ 8) in the
    launch categories.*
14. **Three shops.** The ready-list picker fills a catalogue in minutes; set
    minimum order and delivery mode. First 30 orders are fee-free. *Produces:
    a reason for a customer to open the app twice a week, not twice a year.*
15. **First fifty customers**: one pincode, the pros' own WhatsApp lists,
    the storefront links. Do not advertise beyond one area until the
    thin-auction rate (< 2 replies) is under 20% there.

## Phase D — the operating rhythm (forever)

- **Four minutes a day** in Admin: Approvals → Automation (the pipeline;
  nothing to tap unless you want to suspend or flip the kill switch),
  Bookings & escrow (anything on HOLD older than a day; a stalled shop order →
  refund in full), Finance (Verify chain must read ₹0; Treasury must say it
  reconciles — fees earned, GST held, liabilities; Withdraw fees and Remit GST
  when you choose, behind your password, audited).
- **Every change**: `node tools/test-node.mjs` → `bash tools/preflight.sh` →
  push. CI verifies, Pages deploys, users get the *"update is ready"* toast.
  No maintenance window, ever (`docs/DEVOPS.md`).
- **Every risky change** behind a flag, off by default, on for you first.
- **Every release** a tag with a CHANGELOG section. An untagged release
  cannot be rolled back and is therefore not a release.
- **When something is wrong**: System & audit → flags (kill switch) →
  Snapshot → then look. Never edit data first.

## What is already done (so you do not redo it)

Engine, money (integer paise, double-entry, hash-chained, reconciles to
zero), the P2P auction, the verification ladder and peer-to-peer verification
for tiers 3 and 4, the worker wallet and commitment stake, the customer
wallet, the one gateway door (`src/core/gateway.js`, sandbox UPI until
Razorpay), the treasury read from the ledger, retail with substitutions /
pickup / returns, the admin command center, the Charges and Automation dials,
the Flow tracker, Fresh start and the demo purge, the input-hardening and
session-policy layer (`src/core/security.js`), real maps (OpenStreetMap tiles
+ Nominatim geocoding, Leaflet vendored under `/vendor/leaflet` — no CDN), the
design system, the deck, CI/CD workflows, migrations (schema v9), the engine
guard, and 169 tests — all in this repository, all tagged.

## What production does **not** ship

A new install has no accounts, no pros, no shops and no products. Nothing is
seeded except the owner's credential. `?demo=1` loads an example roster and
turns the market simulation on **for that one page load** — it is a local
switch for walkthroughs and for the deck capture (`?shot=<scene>&demo=1`), and
there is no path by which it reaches a device that did not ask for it. If a
device was opened with it once, the next boot without it drops the roster and
writes `data.demoPurged` to the audit log; Fresh start (step 5) does the same
on demand, snapshot first.

What production also does not ship is a payment rail. `src/core/gateway.js`
runs as a sandbox UPI until step 9: no real money moves, and every screen and
ledger leg that would have moved it says so.
