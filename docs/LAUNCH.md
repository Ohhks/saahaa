# SAAHAA — go-live checklist

You are one person. This list is ordered so that nothing needs you twice.

## Today — get it on the internet (30 minutes)

1. ✅ Repository https://github.com/Ohhks/saahaa exists (public) with every commit and tag pushed.
2. ✅ Pages via Actions is on: **https://ohhks.github.io/saahaa/**. A rollback is re-running an older deploy.
3. ✅ `main` requires the CI check (107 tests, preflight, migration lint).
4. **Change the admin password on the live site** the first time you open
   `/#/admin` (System & audit → change password). The demo password is
   `saahaa123` and the console tells you so until you change it.
5. Open the live URL on your phone and on a laptop; run through
   `docs/TEST-REPORT.md` §1–2 by hand once. It takes ten minutes.

## This week — real money and real people

6. **Supabase project** (free tier): run `supabase/migrations/0001…0003` in
   order; paste the anon key into `src/core/config.js`; `docs/SETUP.md`.
   Money mutations are SECURITY DEFINER RPCs; RLS is deny-by-default.
7. **Payment gateway**: `docs/PRODUCTION.md` §2 — start with UPI-only
   collection (0% MDR) via Razorpay or Cashfree; webhooks land in the
   Cloudflare Worker (§4). Do not accept cards until UPI works end to end.
8. **SMS OTP** for partner verification step 1 (any DLT-registered sender);
   until then the code is shown on screen and the app says so.
9. **First ten pros** — walk them through the seven steps in person. The
   ladder needs nothing from you until a background check lands in Approvals.
10. **First three shops** — the ready-list picker fills a catalogue in
    minutes; set minimum order and delivery mode in Shop profile.

## Every day — four minutes

- Admin → Approvals: background checks (call the reference first), Certified
  awards.
- Admin → Bookings & escrow: anything on HOLD older than a day; a stalled shop
  order → refund in full.
- Admin → Finance: Mark paid after each UPI batch; Verify chain — difference
  must read ₹0.
- If anything looks wrong: System & audit → flags — every feature is a kill
  switch — then Snapshot before touching data.

## Release discipline (already automated)

- `bash tools/preflight.sh` must pass before any tag; `node tools/guard-ui.mjs`
  proves the engine is untouched by UI work.
- Every release is a git tag with a CHANGELOG entry; an untagged release
  cannot be rolled back and therefore is not a release.
- Screenshots for the deck regenerate with `python tools/shots.py` — they are
  the product, not mock-ups.
