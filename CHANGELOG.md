# Changelog

All notable changes to SAAHAA. Format follows [Keep a Changelog].
Versions are semver; every release is git-tagged, because an untagged release
cannot be rolled back and therefore isn't a release.

---

## [6.1.0] — 2026-09-01 — "Open Circle"

Everything runs on **GitHub + Supabase free tier**, and most of it runs without
you. Design decisions were again taken by a five-agent panel voting on a fixed
ballot (Supabase architecture, escrow & verification protocol, auction
mechanism, zero-cost DevOps, automation boundary).

### Added — the backend, on a free tier
- **Postgres schema** (`supabase/migrations/0001_schema.sql`): 24 tables, money
  as BIGINT paise, and CHECK constraints that make illegal states
  unrepresentable — a pharmacy without a drug licence, a price above MRP, a
  perishable with no manufacture date and a second accepted bid on one request
  are all rejected by the database, not by a hopeful client.
- **Row Level Security + money RPCs** (`0002_money_rls.sql`). The rule the file
  enforces: **the browser cannot move a rupee.** Every money table has writes
  revoked and *no write policy at all*; the only mutators are SECURITY DEFINER
  functions that re-check the caller, the state machine and the arithmetic in
  SQL. Bid privacy is enforced so a rival pro can never read another's price.
- **Double-entry ledger in Postgres**: hash-chained, append-only (UPDATE and
  DELETE raise), balanced by a deferred constraint trigger, with a
  trigger-maintained balance table and a `reconcile()` invariant.
- **pg_cron automation** (`0003_automation.sql`): auctions close, bids expire,
  escrow auto-releases, no-shows refund themselves, holdbacks mature, and
  ~60% of disputes resolve with no human at all. Every job uses a
  **deterministic idempotency key**, so a catch-up run after the free project
  un-pauses can never double-release money.
- **`today_queue` view** — one query for everything blocked on a human. An
  eight-section admin console is a reporting tool; the owner needs an operating
  tool that answers "is anything waiting on me?" in one screen.
- **`safety_incidents`** as a separate table from disputes, with its own SLA.
  An automated "we've refunded you" reply to an assault report is catastrophic,
  so the schema refuses to let them share a queue.

### Added — bidding, done "reasonably"
`src/domain/bidding.js`. Sealed bids with a **published price band**, and four
interlocking rules that make "reasonably" mechanical instead of aspirational:
1. **The floor** (0.85× fair price, min ₹199) stops the cliff — the worst
   SAAHAA outcome still beats a commission app's typical one.
2. **The peaked price score** stops the slide: it is highest *at* the fair
   price, not at the floor, so undercutting costs points and wins nothing.
   A floor alone just becomes the new market price.
3. **The ceiling** caps what a bidding ring can extract.
4. **The counter-offer is blocked against honest bidders** — a pro who bids at
   or below fair price cannot be haggled with at all.
Bidding is **banned outright** in five cases where an auction harms someone:
emergencies, sub-₹300 jobs, licence-gated safety work, care work, and any
category with fewer than 6 verified pros.

### Added — verification
- Virtual OTP with **alternating direction**: check-in is shown by the customer
  and typed by the pro (proving the pro is physically there); check-out is
  shown by the pro and typed by the customer (proving the customer accepted the
  work). Same direction twice means one screenshot covers both gates.
- Codes are stored as a **salted, peppered SHA-256 hash** and never in
  plaintext. Without the pepper a leaked 6-digit hash is brute-forced in
  milliseconds, so `app.otp_pepper` is a required database setting.
- Constant-time comparison, 5 attempts, 3-second and hourly rate limits, and a
  geo gate at verification.
- **Holdback instead of a joining deposit**: 10% of each payout, capped at
  ₹500, released after 7 clean days. A cold-start marketplace cannot demand
  cash up front from supply, but stake should still grow with volume.

### Added — the client seam
- `src/net/supabase.js` — a **zero-dependency Supabase client** (~200 lines).
  The official SDK cannot be used here: the CSP is `script-src 'self'` and
  there is no bundler. PostgREST, GoTrue and Realtime are plain HTTP/WebSocket.
- `src/core/backend.js` — one interface, two adapters. The UI never knows
  whether it is talking to localStorage or Postgres, so the app keeps working
  offline and money operations are hard-blocked rather than optimistically faked.
- `src/domain/ledger.js` — double-entry accounting client-side too, with
  invariants that freeze releases rather than auto-repairing. An auto-repair is
  indistinguishable from an attacker covering their tracks.

### Added — zero-cost CI/CD
- `.github/workflows/`: **ci** (syntax, tests, build, preflight, migration
  lint), **deploy** (Pages, with a post-deploy smoke test), **release**
  (tag → checksummed single-file build), **keepalive** (a free Supabase project
  pauses after ~7 days and its pg_cron stops with it — this is a liveness
  requirement, not a nicety).
- `tools/test-node.mjs` — runs the suites under plain Node with **honest
  stubs**: real WebCrypto, and `document`/`window` as poison pills that throw,
  so a browser-only suite identifies itself mechanically rather than by anyone's
  judgement.
- `tools/preflight.sh` — decodes any shipped JWT and **reads its role claim**,
  catching the realistic mistake of pasting the service_role key, which looks
  identical to the anon key at a glance.
- 25 new tests (87 total, all green).

### Changed
- **Rollback is now a button**: Actions → Deploy to Pages → re-run the last
  green run. Anything needing correctly-typed git under stress gets typed wrong
  on the one day it matters.
- Migrations are committed and CI-linted, but **applying to production stays a
  manual paste**. The free tier has no point-in-time recovery, so no automation
  may ever touch production data.

### Fixed
- Quote-based categories were being given a percentage price band —
  `null ?? DEFAULT` fell through, when `null` was exactly the "quote only"
  signal.
- The price band could invert for cheap categories: a ₹180 ironing job's
  absolute travel minimum exceeded its own fair price, putting the floor above
  the ceiling.
- The registry-seal test assumed the app had booted, so it failed under Node.

---

## [6.0.0] — 2026-09-01 — "One Circle"

A full rewrite around one requirement: **ship updates every week without
breaking what works and without logging anyone out.**

Design decisions were taken by a five-agent panel voting on a fixed ballot
(marketplace flow, local commerce, platform architecture, trust & payments,
UI/UX). Where the vote overturned an existing decision it is called out below.

### Added — architecture (SOLID + DevOps)
- **22 ES modules** replacing one 1,700-line file. `persist.js` is the only
  module that touches localStorage, `money.js` the only one that does currency
  arithmetic, `dom.js` the only one that touches the DOM.
- **Runtime registry** (`core/registry.js`) — the Open/Closed seam. Categories,
  order stages and reducers are registered, never switch-cased. Unknown ids
  return a tombstone instead of throwing.
- **Versioned migration chain** with a pre-migration snapshot, automatic
  rollback on any throw, a multi-tab migration lock, and asserted idempotence.
  v5 data migrates in place — accounts, orders and chats all survive.
- **Feature flags** with defaults, localStorage overrides, `?ff.NAME=1` URL
  overrides and an in-app admin toggle panel. New features ship default-off.
- **In-app self-test suite — 62 cases** (`?selftest=1` or Admin → System).
  Covers money reconciliation, transition legality, migration idempotence,
  referential integrity and catalog validity. This is our CI.
- **Health check** at boot; a fatal result drops to safe mode rather than a
  white screen. Per-view try/catch so one bad screen can't take down the app.
- **`tools/build.py`** — inlines all modules into `dist/saahaa.html` with real
  per-module scoping, and lints for float money arithmetic, direct localStorage
  and direct DOM writes outside their owning module.
- **Audit log** of every privileged action, CSV-exportable.

### Added — brand
- **"Welcome to SAAHAA" splash** built from the supplied SAHA artwork: a gold
  ring of joined figures, the wordmark, the five pillars (CARE · PROTECT ·
  SERVE · BUILD · ELEVATE) and "One circle. One purpose." Full screen once per
  session, a 900 ms flash thereafter.
- **The emblem as inline SVG**, used as the app logo at every size (12 figures
  above 64 px, 8 below). Drop a real `logo.png` in later and `setLogoImage()`
  swaps it everywhere with no other change.
- **Plum + gold design system** replacing the green skeuomorphic theme: full
  token set, light and dark themes, an `.on-plum` chrome scope, AA-checked
  contrast pairs, reduced-motion handling.

### Added — marketplace
- **24 categories**: 16 services (repair, electrical, plumbing, appliance,
  cleaning, pest, vehicle, domestic help, salon, wellness, health, pet, tutor,
  moving, events, laundry) and 8 retail (kirana, veg, meat, dairy, pharmacy,
  water & gas, stationery, pet supplies), each with sub-services, a pricing
  unit and a minimum partner verification tier.
- **3-tap booking** with the Locked-Match card: a named, rated,
  distance-stamped pro who has already accepted, a price that cannot change
  without approval, and one-tap "someone else".
- **Retail with real product listings** — shops list their own SKUs from a
  **~180-item starter catalog** with realistic Hyderabad prices. Tap, overtype
  the price, set stock: about six seconds per item.
- **Shop console**: orders inbox, catalog manager with inline price/stock
  editing, stock screen, earnings waterfall, open/closed master switch.
- **One shop per cart**, per-line substitution policy (similar / ask me /
  refund), provisional "est." totals for anything sold by weight.
- **Two order state machines** — service and retail — with full trackers.
- **Verification ladder** (5 tiers) and a **trust score** whose weights sum to
  exactly 1.00, driving search rank and escrow tiering.
- **Tiered escrow**: instant / 6 h / 24 h / hold / freeze. No photo evidence
  means never auto-release.
- **3-tap dispute** with frozen escrow, and a cancellation fee table.

### Changed
- **GST is now modelled correctly.** The old split labelled the +10% as
  "8% profit + 2% GST". GST on a marketplace commission is **18% of the
  commission**, not 2% of the deal. The customer total is unchanged; the bill
  now reads `Service ₹1,000 + Platform fee ₹84.75 + GST@18% ₹15.25 = ₹1,100`.
- **Retail no longer carries the service take rate.** Kirana gross margin on
  staples is 3–6%, so a 10% cut would exceed the entire margin on the items
  people order most. Products are 3% (staples) or 5% (higher-margin), capped
  at ₹25–50 per order, charged to the shop; delivery is a separate, visible
  line charged to the customer. First 30 orders per shop are free.
- **All money is integer paise.** Floats no longer touch a rupee value.
- Partial release now scales the platform fee pro-rata with the work released.
- The savings comparison always states its assumption on screen.
- Admin login moved **inside the site** — sign in as `admin` on the normal
  login screen, or open `#/admin`.
- `worker` role renamed to `partner`; a unified Partner signup branches to
  worker / shop.

### Fixed
- Seeding ran on every reload because the persistence subscriber was registered
  after seeding.
- Terminal order stages still declared outgoing transitions.
- Bottom sheets survived navigation.
- Shop distance/ETA rendered blank when a shop was opened by deep link.

### Security
- Hardcoded `if (pw === 'saahaa123')` replaced with PBKDF2-SHA256 (250k
  iterations, random salt), rate limiting, lockout and session expiry.
  The demo credential is still seeded so you cannot lock yourself out, with a
  standing banner and a change-password screen. See `docs/SECURITY.md` for a
  blunt account of what client-side auth can and cannot protect.

### Migration
`SAAHAA_V5_STATE` → `SAAHAA_V6_STATE`, schema 5 → 6. Runs automatically on
first load, after writing a rollback snapshot. Old category ids (`plumber`,
`acrepair`, `salonw`, …) are **remapped**, never dropped.

---

## [5.0.0] — 2026-08-31
Humans-decide P2P rewrite: signup→login gate, request/accept instead of
auto-matching, mandatory areas, 12 UC-style categories, OTP + timed work +
before/after evidence, team review queue with locked escrow.

## [4.0.0] — 2026-08-31
Economics changed to +10% "GST & charges"; passwords required; per-deal chat;
worker location and ETA; 10 seeded test accounts.

## [3.1.0] — 2026-08-24
Fully automated P2P bid/ask, customer + worker + admin auth, mobile PWA.
Tagged `saahaa-version01`.

[Keep a Changelog]: https://keepachangelog.com/
