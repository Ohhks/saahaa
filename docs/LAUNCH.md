# SAAHAA — go-live checklist

You are one person. This list is ordered so that nothing needs you twice.

## Today — get it on the internet (30 minutes)

1. ✅ Repository https://github.com/Ohhks/saahaa exists (public) with every commit and tag pushed.
2. ✅ Pages via Actions is on: **https://ohhks.github.io/saahaa/**. A rollback is re-running an older deploy.
3. ✅ `main` requires the CI check (169 tests, preflight, migration lint).
4. **Sign in as the owner** the first time you open `/#/admin`: username
   `siidhartha12`, your own password. It is not written down anywhere in this
   repository — `ADMIN_BOOTSTRAP` in `src/core/config.js` holds only a
   PBKDF2-SHA256 hash. To change it: Admin → System & audit → change password
   (immediate, this device), or rotate the shipped bootstrap with
   `node tools/admin-cred.mjs '<new password>'` and paste the printed block
   into `ADMIN_BOOTSTRAP`.
5. **Confirm the live site starts empty.** No customers, no pros, no shops —
   that is correct. `?demo=1` loads the example roster locally when you want
   something on screen to click through; it never loads without that query
   string. A device that was once opened with it drops the roster by itself
   at the next normal boot (audited as `data.demoPurged`).
6. **Fresh start, before the first real account.** Admin → System & audit →
   **Fresh start**: type FRESH, enter your password again. A snapshot is
   taken first (restorable from the same screen), every account, order and
   ledger entry goes, your credential and your dials stay, and the wipe is
   audited with the counts it removed. Do it once on the device you will run
   the business from, even if it looks empty, so the first ledger entry on
   record is a real one.
7. **Set your charges before the first booking.** Admin → Charges: the
   service percentage laid on top of a worker's quote, the platform's retail
   percentage, and the delivery bands by distance. **Push** applies them to
   every quote made from then on; anything already booked keeps the fees it
   was booked with.
8. Open the live URL on your phone and on a laptop; run through
   `docs/TEST-REPORT.md` §1–2 by hand once. It takes ten minutes.

## This week — real money and real people

9. **Supabase project** (free tier): run `supabase/migrations/0001…0003` in
   order; paste the anon key into `src/core/config.js`; `docs/SETUP.md`.
   Money mutations are SECURITY DEFINER RPCs; RLS is deny-by-default.
10. **Payment gateway**: `docs/PRODUCTION.md` §2–§3 — start with UPI-only
    collection (0% MDR) via Razorpay; webhooks land in the Supabase Edge Functions (`supabase/functions/`)
    (§4). In the code this is one file, `src/core/gateway.js`: `collect()`
    becomes an Order + Checkout, `payout()` a Route transfer or a Payout.
    Until then it runs as a sandbox UPI and every screen that moves money says
    so. Do not accept cards until UPI works end to end.
11. ~~**SMS OTP**~~ — **struck out, deliberately and for good (8.4.0).**
    There is no SMS rail on this list any more, because the product no longer
    has anything to send. Every code it uses is a permanent SAAHAA code the
    person already has: the customer reads theirs out at the door, the pro
    passes theirs to a reference. A DLT-registered sender costs money, takes
    weeks of paperwork, and would only have delivered numbers that people
    already hold. Do not re-add it. The one exception is the owner-issued
    password reset, which is read out on a phone call and is not sent either.
12. **First ten pros** — walk them through the seven steps in person. The
    ladder needs nothing from you at all: Background Checked and Certified are
    earned from real jobs, ratings, vouches and the reference's code.
    Enrolment is not limited to Hyderabad or to India: a pro sets their place
    by search, by dropping a pin, or from the device's own location, anywhere
    in the world.
13. **First three shops** — the ready-list picker fills a catalogue in
    minutes; set minimum order and delivery mode in Shop profile.

## Rails still to wire

These are the only places where a step completes inside the app instead of
against an outside system. Everything they gate is real; the outside call is
what is missing.

| Step | What happens today | What wires it |
|---|---|---|
| Phone verification | The pro confirms the number they signed up with and is handed their permanent SAAHAA code | **Nothing — this is finished.** No sender is needed |
| The reference's code | The pro's own SAAHAA code, which they pass to their reference themselves | **Nothing — this is finished.** No sender is needed |
| UPI payout id | The id is format-checked and saved | `razorpay-payout` turns it into a RazorpayX fund account on the first payout; penny-drop validation (`/v1/fund_accounts/validations`) before that is the next step (step 10) |
| Money in and out | `src/core/gateway.js` in `MODE 'sim'`: a collect or a payout succeeds at once, moves no real money, and is labelled *Sandbox UPI* on the screen and `upi-sim` on the ledger leg — customer top-ups, booking shortfalls, worker stake top-ups, every take-out | The four Edge Functions in `supabase/functions/`: `razorpay-order` + `razorpay-verify` behind `collect()`, `razorpay-payout` behind `payout()`, `razorpay-webhook` as the server's own record (`gateway_events`, `gateway_payments`, migration 0004). Deploy, set secrets, then switch a device with `?payments=razorpay&rzkey=…&fnurl=…` — `supabase/README.md`, `docs/PRODUCTION.md` §7. Payouts stay fail-closed until a Route account map or RazorpayX is configured |
| Withdraw fees / Remit GST | The treasury posts the leg and audits it; nothing reaches a bank or the GST portal | `razorpay-webhook` already stores every `settlement.processed` in `gateway_events`; posting the `FEE_WITHDRAW` leg from that row is the lead's, and the GSTR-3B challan stays manual (`docs/PRODUCTION.md` §3) |

## Every day — four minutes

- Admin → Approvals: nothing to approve by hand any more — Background
  Checked and Certified are granted by the network's own evidence
  (`docs/AUTOMATION.md`, *Peer-to-peer verification*) and audited as actor
  `auto`. Glance at the Automation pipeline; suspend if something looks
  wrong; the kill switch is on the same screen.
- Admin → Bookings & escrow: anything on HOLD older than a day; a stalled shop
  order → refund in full. When one does not make sense, open it in the **Flow
  tracker** — stage, holder, money held, and what the system is waiting for,
  on one screen.
- Admin → Finance: Verify chain — difference must read ₹0. Then Treasury:
  fees earned, GST held, the liabilities you are holding for other people,
  and *Reconciles* — it must say yes. Withdraw fees and Remit GST when you
  choose to (they ask for your password again and are audited); in sandbox
  mode nothing leaves for a bank, and the screen says so.
- If anything looks wrong: System & audit → flags — every feature is a kill
  switch — then Snapshot before touching data.

## Release discipline (already automated)

- `bash tools/preflight.sh` must pass before any tag; `node tools/guard-ui.mjs`
  proves the engine is untouched by UI work.
- Every release is a git tag with a CHANGELOG entry; an untagged release
  cannot be rolled back and therefore is not a release.
- Screenshots for the deck regenerate with `python tools/shots.py` — it opens
  the running app at `?shot=<scene>&demo=1` and photographs it, so the deck is
  the product, not mock-ups.

## Two things that need no setup

- **Maps.** OpenStreetMap tiles, Nominatim for geocoding and reverse
  geocoding, Leaflet vendored under `/vendor/leaflet`. No CDN, no key, no
  account, nothing to configure — and no map vendor to be cut off by. Because
  the geocoder is worldwide, enrolment works anywhere, not only in Hyderabad.
- **Charges.** Admin → Charges holds the service percentage, the platform's
  retail percentage and the delivery bands. They are policy, set from the
  console and audited — not constants that need a release.
