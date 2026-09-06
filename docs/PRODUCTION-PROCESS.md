# SAAHAA — from here to production, step by step

*Why any of this matters: [docs/PROBLEM.md](PROBLEM.md) — the real-world problem SAAHAA solves.*

One person, in order. Each step says what it produces and what it unblocks.
Steps 1–6 are today. Steps 7–14 are the first two weeks. Phase D is forever.

## Phase A — the site is live (today, ~1 hour)

1. ✅ **Repository created and pushed** — https://github.com/Ohhks/saahaa (public), every commit and tag. *Unblocks: CI, Pages, releases.*
2. ✅ **Pages via Actions is on.** `deploy.yml` publishes `dist/` to **https://ohhks.github.io/saahaa/** on every push to `main`.
3. ✅ **`main` is protected** — the CI check "Lint, build, test" must pass. *Nothing broken can land.*
4. **First open on the live URL.** Sign in to the admin as `siidhartha12`
   with your own password (the repository holds only its PBKDF2 hash, in
   `ADMIN_BOOTSTRAP` in `src/core/config.js`). Change it from Admin → System
   & audit → change password, or rotate the shipped bootstrap with
   `node tools/admin-cred.mjs '<new password>'` and paste the printed block
   in. Run the in-app self-test (111). Verify chain → ₹0. *The site will be
   empty — that is correct; production seeds nothing.*
5. **Set your charges.** Admin → Charges: the service percentage laid on top
   of a worker's quote, the platform's retail percentage, the delivery bands
   by distance. **Push** makes them live for every quote made afterwards;
   orders already booked keep the fees they were booked with, so a change can
   never re-price money already in escrow. *Produces: your economics, not the
   defaults.*
6. **Hand-check on your phone and a laptop**: sign up as a customer, open a
   category, book, cancel; sign up as a partner, run the seven steps; open
   the admin and follow the order in the Flow tracker. Ten minutes. *Produces:
   confidence the deploy is the app you tested.* For a screen with something
   already on it, open `?demo=1` locally — it loads an example roster for that
   page load only and is never what a real device gets.

## Phase B — real data, real money (week 1)

7. **Supabase project** (free): apply `supabase/migrations/0001_schema.sql`,
   `0002_money_rls.sql`, `0003_automation.sql` in order; paste the anon key
   into `src/core/config.js`; follow `docs/SETUP.md`. *Produces: accounts and
   orders that survive a phone change; RLS deny-by-default; money mutations
   only through SECURITY DEFINER RPCs.*
8. **Payment collection, UPI only** (`docs/PRODUCTION.md` §2): Razorpay or
   Cashfree, collect-to-escrow, 0% MDR. Webhooks → Cloudflare Worker (§4)
   → the RPCs. Do not enable cards until a full UPI cycle (book → release →
   payout) has run with your own ₹100. *Produces: real escrow.*
9. **Partner payouts**: the Finance → Mark paid step becomes a UPI batch
   (penny-drop verification of each UPI id first). *Produces: pros are paid
   by rail, not by hand.*
10. **SMS OTP** for step 1 of verification and the arrival code (any
    DLT-registered sender). Until that sender is live the code is generated
    and shown on the partner's own screen; the ladder itself is real, but
    nothing is texted. *Produces: the last step of the ladder runs against an
    outside system.*
11. **Tax**: GST registration for the platform fee (18% of the fee is
    remitted, already computed per order); TDS u/s 194-O on partner payouts
    (`docs/PRODUCTION.md` §3). *Produces: nothing that can make you
    loss-making later.*

## Phase C — supply, then demand (week 2)

12. **Ten pros, in person.** Two per category across plumbing, electrical,
    AC, cleaning, repair. Walk each through the seven steps on their own
    phone; it takes ten minutes and needs nothing from you until a background
    check lands in Approvals. Give each their page link. Their working area
    is set on a real map — searched, pinned, or taken from the device — so
    enrolment is not bounded by a hard-coded area list, or by Hyderabad, or
    by India. *Produces: the ask-rates auction has enough supply (≥ 8) in the
    launch categories.*
13. **Three shops.** The ready-list picker fills a catalogue in minutes; set
    minimum order and delivery mode. First 30 orders are fee-free. *Produces:
    a reason for a customer to open the app twice a week, not twice a year.*
14. **First fifty customers**: one pincode, the pros' own WhatsApp lists,
    the storefront links. Do not advertise beyond one area until the
    thin-auction rate (< 2 replies) is under 20% there.

## Phase D — the operating rhythm (forever)

- **Four minutes a day** in Admin: Approvals (call the reference first),
  Bookings & escrow (anything on HOLD older than a day; a stalled shop order →
  refund in full), Finance (Mark paid after each batch; Verify chain must read
  ₹0).
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
zero), the P2P auction, the verification ladder, the worker wallet and
commitment stake, retail with substitutions / pickup / returns, the admin
command center, the Charges dials, the Flow tracker, the input-hardening and
session-policy layer (`src/core/security.js`), real maps (OpenStreetMap tiles
+ Nominatim geocoding, Leaflet vendored under `/vendor/leaflet` — no CDN), the
design system, the deck, CI/CD workflows, migrations, the engine guard, and
111 tests — all in this repository, all tagged.

## What production does **not** ship

A new install has no accounts, no pros, no shops and no products. Nothing is
seeded except the owner's credential. `?demo=1` loads an example roster and
turns the market simulation on **for that one page load** — it is a local
switch for walkthroughs and for the deck capture (`?shot=<scene>&demo=1`), and
there is no path by which it reaches a device that did not ask for it.
