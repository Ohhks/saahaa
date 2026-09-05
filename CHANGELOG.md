# Changelog

All notable changes to SAAHAA. Format follows [Keep a Changelog].
Versions are semver; every release is git-tagged, because an untagged release
cannot be rolled back and therefore isn't a release.

---

## [6.4.0] — 2026-09-05 — "Locally, Professionally"

The partner side now closes the loop. Two audit agents and a five-specialist
design panel shaped this release; a new partner who starts at 9am is taking
jobs by 9:20 with the owner touching nothing.

### Added — the professional gate (`domain/verification.js`, `domain/quiz.js`)
- **Seven self-serve steps, all machine-checked, in a fixed chronology:** phone
  code → ID → selfie → five trade questions → six rules → UPI → agree. All
  seven ⇒ **tier 2, online, bookable**. The owner is not in the loop.
- **We keep a hash and the last four digits of an ID document, never the
  number.** The same document on two accounts is refused — the most reliable
  fraud signal there is.
- **The trade quiz is the competence filter, not the certificate.** Five
  questions any real tradesperson in Hyderabad knows and no impostor does,
  4 of 5 to pass, three tries then a day's wait. Banks for all 16 service
  categories plus a generic fallback so no trade is ever ungated.
- **The conduct quiz teaches; it cannot reject.** A wrong answer shows the rule
  and the pro tries again. OTP at the door, never cash outside, photo before
  payout, cancel early, what "you keep 100%" means, how disputes are decided.
- **Provisional cap.** A newly verified pro is bounded to ₹1,500 a job until
  three real jobs (OTP check-in AND a work photo — `countedJobs`, not
  `completed`) have settled cleanly. The money cap does the risk work, not a
  category lock-out that makes real plumbers walk away.
- **Tier 3 and 4 are the owner's only two decisions:** a background check
  (reference + consent, approve after the call) and the Certified badge
  (25 jobs · rating ≥ 4.6 · no upheld disputes — earned by numbers, confirmed
  by a human). `approveTier` refuses to lift anyone past self-verification.
- The admin Approvals screen is now that queue and nothing else. It used to
  list every partner at tier ≤ 2 forever.

### Added — the chronology (`ui/views/onboard.js`)
- One screen per step, one action per screen. Progress as a seven-dot track.
- **The aha comes before the ask:** a draft of the pro's own page appears after
  the phone step, before the ID and quiz steps where funnels lose half their
  people.
- Signup signs the partner in and lands them on step 1. "Account created — now
  sign in" was a second form between a new pro and their first step.
- The "You are verified" screen: badge, live page, the ₹1,500 rule stated
  honestly, and the next rung.

### Added — the storefront (`ui/views/pro.js`, `#/pro/<id>`)
- Every verified pro gets a public page: badge, rating, jobs done, price from,
  what they do, reviews, "Book". Generated from their work, maintained by
  SAAHAA, shareable on WhatsApp. They edit three fields. That is "locally,
  professionally": a professional presence they never build or maintain.
- The locked-match hero card and the partner console both link to it.

### Fixed — from the audit
- A partner who signed up was created at tier 1, online and bookable with no
  check of any kind — and simultaneously invisible to 15 of 16 categories.
  Both halves are gone.
- The auction bypassed `minTier` and the tier cap entirely; `placeBid` and
  `openRequestsForPartner` now go through the same gate as everything else.
- **Auto-release was a promise printed on the WORK_DONE screen and implemented
  nowhere**: `releaseAt` was written and never read. `sweepAutoRelease` runs
  at boot.
- A request parked in `awaiting_choice` never expired and blocked every future
  ask for that customer. The abandonment rule now holds: the held price is
  booked and the request closes.
- Rating a job made the pro's lifetime earnings snap to ₹0 — the console
  filtered on stage instead of on settlement.
- `rate.skip` targeted an edge that does not exist; the star panel never left.
- A guest's chosen area was written raw where the reader JSON-parses it, so
  every guest was Madhapur.
- `selfNav` stayed armed when the hash did not change, swallowing the next
  Back.
- Minimum order and "pickup only" were printed on every shop card and enforced
  nowhere. A price of ₹0 or less passed the upper-bound-only check.
- Star ratings on the ask-rates hero card were a rescaled score component,
  not the pro's actual average.
- The post-auction coaching loop ("your price was not the problem") was built
  and shown to nobody. The partner console now lists their rates; a lost one
  opens the reason.
- `null` bid on accept; "You asked 1 workers."; "Nothing was charged" twice;
  review author blank in moderation; disputes marked resolved before the money
  moved.

---

## [6.3.0] — 2026-09-05 — "Ask Rates"

The bidding mechanism has existed since 6.1 and nothing outside the test suite
imported it. This release makes it a product, and clears the defects two audit
agents found across the rest of the app.

### Added — the P2P auction, end to end
- **`domain/auction.js`** — post a request, sealed bids in waves, close,
  accept, one counter-offer, or take the price you already had.
- **The held price is the whole conversion mechanism.** The locked match stays
  reserved for the entire window, so asking cannot cost the customer anything.
  It is not education, it is downside elimination — and a customer who
  believes they cannot lose will try anything once.
- **`ui/views/ask.js`** — the customer never sees the word "bid". A bid is a
  *rate*, a bidder a *worker*, the locked match the *held price*. "Auction",
  "P2P" and "cheapest" appear nowhere on screen: the score peaks at fair
  value, so promising cheapest would be the product lying about its own
  mechanism.
- The waiting screen seeds reply one with the held price at 8s so it is never
  empty; elapsed counts **up**, because a 12:00 countdown reads as a wall.
  Both escapes are one tap and neither asks "are you sure".
- The choosing screen sorts by score and never by price. The cheapest reply is
  always shown and always bookable, with one honest line naming what it costs
  in rating and distance — hiding it is the fastest way to lose trust in a
  market where people compare notes.
- The receipt shows the rupees **they** saved. Zero is never rendered as zero:
  "your held price was already the best rate" instead.
- Worker screen: slider pre-filled at the fair price with a live chance meter,
  normalised across the band so dragging to the floor actually reads *weak*.
  Workers don't read scoring functions; they watch a bar shrink.
- 8 new self-tests pin the mechanism (96 total).

### Fixed — market depth (why none of it could run)
- The seed had **one pro per category**. `biddingAllowed` needs 6 and the UI
  gate needs 8, so ask-and-bid was unreachable on every install — correct code
  that could never execute. `seed.depth.js` adds 9 deterministic pros per
  category; migration **v6 → v7** tops up existing installs. Ids derive from
  (category, index), which is what makes the top-up idempotent.

### Fixed — money and mechanism
- **A counter could land below the fair price.** A flat −7% off a bid just
  above target crossed under it: the haggle button defeating the
  anti-undercutting rule it sits inside. Clamped to target.
- **Customer-facing prices were the worker's raw rate while the charge was the
  all-in total**, so every saving figure was overstated. Workers bid the deal;
  customers see what they pay, everywhere.
- **The self-bid guard compared the session to the customer instead of the
  bidder**, so every bid on your own request tripped it and no rate landed.
- **A stuck shop order had no admin remedy and its escrow was frozen
  permanently** — the escrow queue was service-only and the dispute path called
  `confirmAndRelease`, which bails on retail *after* the dispute was already
  marked resolved. `flow.refundRetail` plus a "Shop orders in flight" block.
- **A full refund landed in PARTIAL** ("partly released") and posted a ₹0
  ledger block. `REFUNDED` existed the whole time with no caller.
- **Releasing escrow left the linked dispute OPEN**, and its Resolve buttons
  then all failed on an illegal transition.
- **Mark paid changed nothing** — a bare toast with no order id, so the same
  payout stayed in the queue forever. The queue now keys on "released and not
  paid out" rather than on stage, which also stopped rated jobs vanishing
  from it unpaid.
- **Closed shops still took orders.** The Close switch flipped a badge and
  nothing else; `addToCart` and checkout now both refuse.
- **Price and stock wrote on every keystroke**, so typing "150" published ₹1,
  then ₹15, then ₹150 — and a rejected value stayed on screen. Committed on
  change, with a re-render.

### Fixed — dead ends in the state machines
- **Service orders could never be rated.** Nothing targeted `RATED`, so
  `partner/rate` and `review/add` were never dispatched, trust scores were
  frozen at their seed values and admin's review moderation was permanently
  empty. `SETTLED → RATED → CLOSED` now has a UI.
- **Retail orders never reached `R_CLOSED`**, which is why two views hard-coded
  `R_SETTLED` into their "hide it" lists instead of using `isTerminal`.
- **`MATCHING → ASSIGNED` and `R_PLACED → R_ACCEPTED` existed only inside
  `setTimeout`.** A reload inside that window stranded the order with no legal
  move but cancel. Both now have an Accept button.
- **"Report an issue" appeared at stages with no `DISPUTED` exit**, creating a
  dispute record and promising frozen money while the order kept flowing.
  Shown only where it can act, and only to someone with standing in the order.
- "Mark work finished" is disabled until a photo is attached, rather than
  failing on tap.
- The Promote button is hidden at tier 4 instead of being a silent no-op.

### Fixed — UI correctness
- **A sheet could outlive its screen**: `hashchange` re-rendered without
  closing it, and `closeSheet` could not cancel a pending open. `go()`'s own
  hash echo is now ignored, which is what kept the ask-rates receipt alive.
- **`book.sub` dropped the chosen sub-service** — `openCategory` took one
  argument, so the sheet re-rendered byte-identical and the tap did nothing
  visible. Threaded through to the order.
- Double-escaped headers rendered `&amp;` in three views.
- "See all" pointed at `#shopsSec`, which does not exist when the RETAIL flag
  is off; it now targets a category anchor that always exists.

---

## [6.2.0] — 2026-09-02 — "Bright Circle"

Six agents audited the app in parallel and found 40 issues. Everything that
could cost money or break a screen is fixed here.

### Changed — a bright purple theme, with contrast as the constraint
- **`#7C3AED` is the new primary.** It is the brightest, most saturated violet
  that still carries white body text at AA. The measurements decided it:
  white on violet-500 `#8B5CF6` is **4.23 — fail**; violet-550 `#8551F2` is
  4.71; violet-600 `#7C3AED` is **5.70**. Every pair in `tokens.css` has a
  measured ratio beside it.
- **The old gold fails on bright purple.** `#EBC97C` gives only 3.58 as text.
  Gold now splits by role: fills and the emblem keep the metallic ramp; gold
  *text* on violet uses the light stops (`#FBE8B8` = 4.70); `gold-600/700`
  (1.61) may never sit on violet at all.
- **Bright violet is chrome, never field** — capped at roughly 20% of any
  screen, over violet-*tinted* neutral grounds (`#F8F5FE`), never a flat
  `#8B5CF6` against pure white. That area-times-saturation rule is what keeps
  a vivid colour from reading cheap.
- `opacity:.4` disabled states replaced with explicit tokens; on a violet fill
  they produced an unreadable ~2.2:1 lavender.

### Changed — icons are drawn now, because emoji break on our users' phones
Not a style preference. `👩‍🍳` is a ZWJ sequence that **fragments into two
glyphs on Android 8 and 9**, and `🪳 🪷 🧺` render as **empty tofu boxes** on
those same devices — which is a large share of a ₹8–15k phone base. All 24
categories and the whole nav are now flat SVGs in `src/ui/icons.js`.
Collisions the audit found and this resolves: broom/soap, ant/dog,
lettuce/milk, haircut/massage (both person-shapes, indistinguishable at 22px),
bolt/droplet, and the cart glyph serving as both the Shops tab and every cart
button.

### Changed — search and tiles say what they actually do
- `Search: plumber, AC repair, tomatoes, milk`, with a helper line —
  replacing a rotating hint a slow reader cannot finish reading.
- Tiles show **supply proof** ("12 nearby", "New here — be first") instead of
  "from ₹X", which was a floor almost nobody pays and contradicted our own
  promise that the pro sets the price.

### Added — the Work tab finally goes somewhere
It had no route: a guest was thrown to the sign-in screen (which hides the nav,
so the tab appeared to vanish) and a customer was silently redirected to
Account. It is now **Earn**, a real screen, and it is where "ask everyone to
join as a partner" lives — leading with the worked example that a pro keeps
₹1,000 of a ₹1,000 job against about ₹750 on a commission app.

### Fixed — critical
- **Double-tapping "Confirm & release" paid the pro twice.** `advance()`
  returns null on an illegal transition and every caller ignored it, posting to
  the ledger regardless. Now guarded in release, cancel and retail settle.
- **Tier-4 orders released 4% more than was ever escrowed** — booking used the
  6% loyalty markup, release hardcoded 10%. Same bug in `cancelSplit`.
- **The cart's delivery-mode chips were display-dead.** Tapping "I'll pick up"
  moved no highlight and left the total showing a fee that would not be
  charged. Displayed price and charged price must be the same number.
- **A ₹1 bid validated on groceries.** Retail categories have no base price, so
  every band value was `NaN` — and because every `NaN` comparison is false,
  the floor, ceiling and minimum-value guards *all* passed.
- **A rating with no `stars` made the trust score `NaN`, and `band(NaN)` fell
  through every branch and returned Elite** — a gold badge and top ranking from
  one malformed record.
- **Money past ₹2.14 crore went negative** — `x | 0` truncates to int32, and
  `agg.gmv` is cumulative.
- **Sessions were never persisted**, so every refresh silently signed the user
  out — the other half of "the Work tab doesn't work".
- Retail orders in the admin escrow queue were settled through the *service*
  path, posting a ₹0 release to `PARTNER:undefined` and staying re-settleable.
- `earn.render()` returned `null` for partners, rendering the literal word
  "null" as the page — string concatenation, so it never threw.

### Fixed — also
Ledger hash-chain forked on concurrent writes (head read before an `await`);
ledger account names mismatched (`PLATFORM:FEE` vs `PLATFORM:fee`) so the GST
invariant read a permanently empty account; retail settle stranded ₹5 per rider
order and booked GST as revenue; **a lost dispute raised the pro's trust
score**; the promised ₹100 no-show credit was computed and thrown away;
migrated orders turned `agg.escrow` into `NaN` permanently; an unrecognised v5
stage was silently `CLOSED` with escrow still held; a stored schema of v1–v4
bricked the app into permanent safe mode; "free delivery over ₹499" was
advertised and never applied; the ₹5 retail fee floor could exceed a tiny
basket and pay the shop a negative amount; clearing a price field published the
item at ₹0; three wrong OTPs "flagged" nothing, so a 4-digit code was
brute-forceable; `back()` left the hash stale; re-tapping a tab piled up junk
history; a guest's chosen area was written and never read.

### Added — DevOps
- **`tools/serve.py`** — a dev server with caching off. The cache-buster only
  stamps the *entry* module, so every imported module was served stale: editing
  a view and reloading showed the old screen running under new code. Production
  is immune (one inlined file), so the fix belongs in the dev server.
- `docs/RUNBOOK.md` — referenced by the workflows but never written. Rollback
  in 40 seconds, ledger-imbalance response, safety-report response, kill switch.
- Dependabot for Action versions, CODEOWNERS on the four files where a mistake
  costs money, PR template matching the safe-update rules, issue template.

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
