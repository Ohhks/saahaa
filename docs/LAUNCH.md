# SAAHAA — go-live checklist

You are one person. This list is ordered so that nothing needs you twice.

## Today — get it on the internet (30 minutes)

1. ✅ Repository https://github.com/Ohhks/saahaa exists (public) with every commit and tag pushed.
2. ✅ Pages via Actions is on: **https://ohhks.github.io/saahaa/**. A rollback is re-running an older deploy.
3. ✅ `main` requires the CI check (111 tests, preflight, migration lint).
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
   string.
6. **Set your charges before the first booking.** Admin → Charges: the
   service percentage laid on top of a worker's quote, the platform's retail
   percentage, and the delivery bands by distance. **Push** applies them to
   every quote made from then on; anything already booked keeps the fees it
   was booked with.
7. Open the live URL on your phone and on a laptop; run through
   `docs/TEST-REPORT.md` §1–2 by hand once. It takes ten minutes.

## This week — real money and real people

8. **Supabase project** (free tier): run `supabase/migrations/0001…0003` in
   order; paste the anon key into `src/core/config.js`; `docs/SETUP.md`.
   Money mutations are SECURITY DEFINER RPCs; RLS is deny-by-default.
9. **Payment gateway**: `docs/PRODUCTION.md` §2 — start with UPI-only
   collection (0% MDR) via Razorpay or Cashfree; webhooks land in the
   Cloudflare Worker (§4). Do not accept cards until UPI works end to end.
10. **SMS OTP** for partner verification step 1 (any DLT-registered sender).
    Until that sender is live the code is generated and shown on the
    partner's own screen — the ladder is real, but nothing is texted. This is
    the shortest of the three rails still to wire (see *Three rails* below).
11. **First ten pros** — walk them through the seven steps in person. The
    ladder needs nothing from you until a background check lands in Approvals.
    Enrolment is not limited to Hyderabad or to India: a pro sets their place
    by search, by dropping a pin, or from the device's own location, anywhere
    in the world.
12. **First three shops** — the ready-list picker fills a catalogue in
    minutes; set minimum order and delivery mode in Shop profile.

## Three rails still to wire

These are the only places where a step completes inside the app instead of
against an outside system. Everything they gate is real; the outside call is
what is missing.

| Step | What happens today | What wires it |
|---|---|---|
| Phone verification | The code is generated and shown on the partner's screen | A DLT-registered SMS sender (step 10) |
| UPI payout id | The id is format-checked and saved | Penny-drop beneficiary verification at the gateway (step 9) |
| Wallet top-up | The stake balance is credited directly; the Add money sheet says UPI is what does this in production | UPI collection at the gateway (step 9) |

## Every day — four minutes

- Admin → Approvals: background checks (call the reference first), Certified
  awards.
- Admin → Bookings & escrow: anything on HOLD older than a day; a stalled shop
  order → refund in full. When one does not make sense, open it in the **Flow
  tracker** — stage, holder, money held, and what the system is waiting for,
  on one screen.
- Admin → Finance: Mark paid after each UPI batch; Verify chain — difference
  must read ₹0.
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
