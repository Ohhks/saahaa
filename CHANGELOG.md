# Changelog

All notable changes to SAAHAA. Format follows [Keep a Changelog].
Versions are semver; every release is git-tagged, because an untagged release
cannot be rolled back and therefore isn't a release.

---

## [8.2.0] — 2026-09-09 — "A shop with a face"

### Added
- **Pictures.** The product had none: a listing was a spreadsheet row. Shops
  have a front photograph, products have their own, pros have a portrait and a
  gallery of their work, and the photograph a job has always required before
  payout is now an actual photograph instead of a label.
- **Anyone can open a shop**, in one of the eight categories the product
  already has — name it, photograph it, and land in a console ready to list.
  Because an account is now per role, a customer or a pro can open one on the
  number they already use, without giving up the account they have.

### How pictures are kept, and why that way
- **Not in the state blob.** `SAAHAA_V6_STATE` is rewritten on every change
  and is already a quarter of a megabyte; images inside it would stringify
  megabytes on the main thread at every keystroke — the same class of stall the
  home screen had. Each picture is its own key, so writing one writes one
  (`core/photos.js`).
- **Shrunk before they are stored, never after.** A phone photograph is
  several megabytes; `ui/photo.js` draws it into a canvas, re-encodes it, and
  leans on quality and then on size until it fits — what is stored is a few
  tens of KB.
- **A hard budget, and an honest refusal.** localStorage is about 5MB for the
  whole origin, shared with the state, the audit log and the backups. Pictures
  may have 3MB and one picture 90KB. Over budget the app says so; it never
  quietly deletes somebody else's shop front to make room.
- **Only a real raster image ever reaches an `<img>`.** The store is
  user-editable, so what comes out is validated on the way out: SVG is refused
  (it can carry script), and a tampered entry reads back as no picture rather
  than as a payload.
- Pictures nothing points at are reclaimed at boot, and a wipe takes them with
  it rather than leaving the budget spent.

## [8.1.0] — 2026-09-09 — "Two doors, one person"

### Added
- **Every account has an ID a person can say out loud.** `C20262001` for a
  customer, `P20262001` for a pro, `S20262001` for a shop owner — the letter
  says what the account is for, then the year it was opened, then a sequence
  from 2001, counted per role. It is not a secret: it identifies, the password
  authenticates (`src/domain/identity.js`).
- **One person, one number, two accounts.** A plumber who also buys groceries
  no longer has to choose. The rule moved from *one account per number* to
  *one account per number per role*: a customer account and a pro account can
  sit on the same mobile, each with its own password, wallet and history, and
  they never mix because they were never the same account. Trying to open a
  second account of the SAME kind is refused, naming the one that exists.
- **Sign in with either.** The field takes a mobile number or an ID. A number
  carrying two accounts opens a chooser rather than guessing; a code goes
  straight in. The rate limiter still counts against the NUMBER behind
  whatever was typed, so an ID cannot be used to dodge it.

### Fixed
- **The home screen stuttered while scrolling.** The collapsing header used a
  12px hysteresis — inside the noise of a single trackpad flick — so ordinary
  scrolling flipped it open and shut repeatedly, and each flip animated
  `max-height`, `padding` and `margin` on a *sticky* header, re-laying-out the
  whole page for 260ms at a time. It now takes a deliberate 72px gesture, the
  collapse waits until the folding part is a screen behind you, and nothing
  about it animates layout: one reflow per gesture instead of sixteen. The
  rules were also declared twice, in `tokens.css` and in the view, with
  different durations; there is now one set. Proved in a real engine by
  `docs/design/scroll-probe.html` — one flip on a steady scroll, zero on
  wobble.
- Every phone screenshot in the deck had been cropped for months: Chrome floors
  its window width at ~504 CSS px, so captures asking for 390 were silently
  cut — the five-tab bar came out with four. `tools/shots.py` shoots at the
  floor.

### Changed
- Schema v10: accounts that predate codes are assigned one, oldest first, per
  role. Internal keys are NOT rewritten — every order, partner row and ledger
  leg still points where it did. Accounts opened from now on use their code as
  their key, which is what stops two accounts on one number from colliding
  (the old key was name+mobile, identical for both).

## [8.0.0] — 2026-09-08 — "Modernist"

A whole-surface redesign. Every screen was rebuilt to the Modernist mockup —
and nothing the product *does* changed. The contract check
(`tools/guard-ui.mjs`) is what made that safe: every `data-act`, element id and
export had to survive the repaint, so the behaviour could not drift while the
paint changed.

### Added
- **The Modernist design system** (`src/ui/tokens.css`, rebuilt): Archivo,
  vendored — no CDN; a light paper ground (`#f3f2f2`) with ink text
  (`#201e1d`); one red accent (`#ec3013`) spent only on primary actions and
  live state; **zero corner radius anywhere**; 1–2px rules doing the
  organising instead of shadows; 44px minimum on every interactive control.
  The file carries two layers — the mockup's own component classes
  (`.btn-primary` `.tag-accent` `.apphdr` `.tabbar`/`.tab` `.sec` `.thumb`
  `.seg` `.table` `.field`/`.input`) and every legacy class the views still
  used, restyled to the system — so no screen could look foreign mid-rebuild.
  Dark theme is the same system inverted and stayed correct throughout.
- **`#/nearby` — the neighbourhood.** The mockup's map-first browse: the shops
  and pros around you as pins over OpenStreetMap, a search that geocodes and
  re-centres, Shops / Pros / Open filters that move the pins and the list
  together, and an honest empty state on a store with nothing in it yet.
- **`#/chat/<order>` — the thread with the pro.** The conversation an order
  already carried, given a screen: grouped by day, the job's own money in a
  confirmed-job card, and the contact-masking `domain/flow.js` performs made
  visible and explained rather than silently applied.
- **The quote builder states the money truth**, and it moves with the slider:
  what the pro keeps (100%), what SAAHAA adds on top, and what the customer
  therefore pays — every figure read live from the dials.

### Changed
- All twelve views rebuilt in the system; `views/earn.js`, the one view never
  converted in the first pass, rewritten from its old vocabulary.
- Leaflet is skinned to the system (`ui/map.js`) — until now its popups and
  controls rendered in Helvetica with rounded corners, the only un-designed
  surface in the product. The colour whitelist and escaping are untouched.
- The admin console stopped hand-rolling a second dark treatment and uses the
  system's ink strip; its money blocks are real tables; the GST figure it
  printed is now read from `GST_RATE`.
- Toast, sticky toast, sheet and splash defects fixed (an "update ready"
  notice used to sit under the tab bar).

### Kept, deliberately
- **The economics.** The mockup's sample copy shows a 3% fee taken from the
  pro's side. The shipped model — decided in v6.6.0 and built through v7.1 —
  is **8% laid on top of the worker's quote, paid by the customer, worker
  keeps 100%**, with the ledger, treasury, GST split and legal pages resting
  on it. The look came from the mockup; the money did not. No view hard-codes
  a percentage: every figure is read from `domain/settings.js`, so the owner's
  dials remain the only place a rate can move.

## [7.1.0] — 2026-09-07 — "Ready for the rail"

The release that makes the day the Razorpay account exists a one-line switch.
Nothing about money changes in the sandbox; everything a live rail needs is
now in place, fails closed when half-configured, and is written down.

### Added
- **`core/gateway.js` has two modes.** `sim` (the honest sandbox, unchanged)
  and `razorpay`: collect() asks a server-side Edge Function for a Razorpay
  Order, opens Razorpay Checkout through an opener the UI registers
  (`ui/checkout.js` — core never touches the DOM), and has the server verify
  the payment signature before a receipt is returned. payout() asks the server
  to move money out (Route transfer or RazorpayX) and carries an idempotency
  key so a retry can never pay twice. A half-configured live mode refuses to
  collect — it never falls back to the sandbox.
- **Four Supabase Edge Functions** under `supabase/functions/`:
  `razorpay-order`, `razorpay-verify`, `razorpay-webhook` (HMAC over the raw
  body, idempotent event store, `gateway_events` / `gateway_payments` /
  `gateway_payouts` in migration 0004) and `razorpay-payout` (admin session
  required; Route when a linked account is mapped, RazorpayX otherwise). The
  secret key and the webhook secret live only in the functions' secrets.
  Type-checked and lint-clean under Deno; 42 behavioural checks against a
  mock backend. `supabase/README.md` is the deploy, secrets and rollback guide.
- **The rail switch in the product.** `PAYMENTS` in `core/config.js` (baked),
  a per-device override (`?payments=razorpay&rzkey=…&fnurl=…`, or Admin →
  System & audit → Payments rail, audited), and `?payments=sim` to roll back.
  The CSP now admits exactly Razorpay's checkout script, its frames and its
  API, plus the Supabase functions origin.
- **Legal pages** at `#/legal/terms · privacy · refunds · contact · about`,
  linked from Home, Sign in and My SAAHAA. Written for what the product
  actually does: charges and delivery bands read live from the dials, the
  refund table is generated from `CANCEL_RULES`, the stake and holdback from
  their constants, the company details from `CONTACT` in `core/config.js`
  (empty fields render "not yet set" — nothing is invented), and a banner
  says so while payments are in sandbox. These are what a gateway's activation
  review asks to see.

### Changed
- Payouts carry the saved UPI id (a customer's refund-out, a worker's
  earnings), so the live rail has a destination.
- `docs/PRODUCTION.md` §4–§7, `docs/SETUP.md`, `docs/LAUNCH.md`, `docs/DEVOPS.md`:
  the Cloudflare Worker plan is replaced by the Edge Functions that now exist.
- 173 node tests: the rail switch, fail-closed behaviour, config precedence.

## [7.0.0] — 2026-09-07 — "Self-running"

The release that takes the owner out of the daily loop. A device starts clean
and stays clean; the two approvals that used to reach the owner every day are
now earned by the network itself; every rupee enters and leaves through one
door, into wallets the books can name, and the company's own position is read
straight from the ledger. The owner keeps a kill switch, the dials and the
right to suspend, and gets two new buttons — both step-up protected.

### Added
- **Peer-to-peer verification** (`domain/autoverify.js`). Tier 3 *Background
  Checked* is granted by the system when all of these hold: the seven-step
  ladder is complete; at least 3 real jobs (the customer's code + a photo)
  settled cleanly; average rating ≥ 4.3 over them; zero upheld disputes; at
  least 2 vouches — from a customer who has had a job with this pro settle, or
  a Background-Checked pro in the same trade; one vouch per person, ever — and
  the reference the pro named has confirmed by a 4-digit code. Tier 4 *SAAHAA
  Certified* follows when the numbers hold (25 jobs, rating ≥ 4.6, 0 upheld),
  tier 3 has been held for 14 days and no dispute is open. Every promotion is
  audited as `verify.auto` by actor `auto`, with the evidence it was granted
  on. The sweep runs at boot and after every state change; a suspended pro is
  never touched.
- **Admin → Approvals → Automation.** The kill switch (`autoApprove`) and the
  dials (`bgJobs`, `bgRating`, `bgVouches`, `bgReference`, `certDays`) with
  validated ranges and a Push, beside a pipeline of every tier-2 and tier-3
  pro: who is close, and which line they are waiting on. Approving and
  suspending by hand still work; suspension always wins.
- **Vouch** on a pro's page, and **Standing** in the work cockpit: the tier-3
  checklist line by line (have / need), the reference code step, and the
  Certified countdown.
- **The customer's wallet** (`CUSTOMER:<key>`, My SAAHAA → Wallet). A booking
  is funded from the wallet first and only the shortfall is collected; a
  refund lands in the wallet; top-up (minimum ₹10) and take-out to UPI.
  Workers and shops had wallets already; now everyone does.
- **`core/gateway.js` — the one door.** `collect()` for money in, `payout()`
  for money out; nothing else in the product touches a payment rail.
  `MODE = 'sim'` is a sandbox UPI: it says *Sandbox UPI — no real money moves
  yet* on every screen that uses it and stamps `via: 'upi-sim'` on every
  ledger leg it produces. Razorpay replaces this one file
  (`docs/PRODUCTION.md` §3) and nothing else changes.
- **Treasury** (`domain/treasury.js`, Admin → Finance). The company's
  position replayed from the hash-chained ledger, never computed: fees
  earned, GST held, the liabilities (escrow, customer / worker / shop wallets,
  stakes, holdbacks, the rider pool), money in, withdrawn, remitted — and
  whether it reconciles, which it does by construction and the screen says
  so. Two owner actions: **Withdraw fees** (`PLATFORM:fee → WORLD:bank`, never
  more than earned) and **Remit GST** (`PLATFORM:gst → WORLD:tax`, never more
  than held). Both step-up protected and audited (`treasury.withdraw`,
  `treasury.remitGst`).
- **Fresh start** (`domain/fresh.js`, Admin → System & audit). The owner
  types FRESH and re-enters the password; every account, order and ledger
  entry goes. A snapshot is taken first and is restorable from the same
  screen; the credential and the dials are kept; the wipe is audited as
  `data.freshStart` with the counts it removed.
- **Demo never leaks.** A device that was walked with `?demo=1` drops the
  example roster at its next normal boot — recognised by the `origin: 'demo'`
  mark and by the example mobile ranges — keeping the credential and the
  dials, and audited as `data.demoPurged` with counts.
- `core/selftests.auto.js`: the clean slate, the treasury identity, the
  gateway door, the automation dials, the v9 migration. **169 tests.**

### Changed
- **Schema v9.** `settings.automation` beside `settings.pricing`; a pro
  carries `vouches[]` and `tier3At`.
- Money a customer pays is posted `WORLD → CUSTOMER:<key>` (`PAYMENT_IN`)
  before it moves into the order's escrow, so a refund has a place to land
  and the treasury can name every liability it holds.
- The owner's daily routine loses the two approvals and gains one look at
  the treasury. `docs/AUTOMATION.md` carries the rules, `docs/LAUNCH.md` and
  `docs/PRODUCTION-PROCESS.md` the fresh-start step and the treasury check,
  `docs/SECURITY.md` the step-up and one-vouch rules, `docs/PRODUCTION.md`
  how the gateway and the treasury map onto Razorpay and the GST portal.
- Built by agents under `docs/WORKFLOW.md`: lead foundations → admin builder,
  customer/partner builder and docs in parallel → guardian → lead ships. The
  7.0.0 roster is appended there.

### Fixed
- A pro who was already Background Checked before this release had no date
  for it, so the 14-day Certified clock would have restarted on upgrade. The
  v8 → v9 migration back-fills `tier3At` from `verifiedAt`.

---

## [6.9.1] — 2026-09-07 — "Seen by a browser"

### Fixed
- **The live site rendered its own JavaScript as page text.** The single-file
  bundle is one inline `<script>`; a security test carried the literal string
  `</script>`, the HTML parser ended the script there, and everything after it
  was painted as text — floating `${…}` chips over every screen. Every static
  gate passed. `tools/build.py` now escapes `</script` and `<!--` inside the
  inlined code, and the test no longer spells the close tag.
- **`tools/smoke-dist.py`** opens the built bundle in a real headless browser
  and fails the pre-flight if the app does not boot and paint (raw template
  code on the page, no controls, a cut script). CI runs it on every push; a
  laptop without Chrome gets a warning, not a pass.

## [6.9.0] — 2026-09-06 — "Nothing borrowed"

The release that stops SAAHAA describing itself as a preview of something.
Production now starts empty, the owner's credential is a real one, the maps
are real maps, and the charges are the owner's to set. What used to be a
seeded convenience is a testing switch you have to ask for.

### Added
- **Mobile + password login.** Sign-in is a mobile number and a password, on
  one screen, for customers, partners and shop owners alike.
- **`core/security.js` — input hardening and session policy.** A correctness
  boundary (junk, control characters and hostile URLs never reach the store),
  a cost boundary (the login gate: 5 free attempts, then 30s doubling to a
  15-minute ceiling, per number and persisted), and a hygiene boundary (weak
  passwords refused at the point of choice). DOM-free and network-free, so it
  is unit-testable under plain Node. Its header states the honest scope: none
  of it is a boundary against the operator's own DevTools — that is Supabase
  RLS, and every rule here must exist there too.
- **Admin → Charges.** The service percentage laid on top of a worker's
  quote, the platform's retail percentage and cap, the delivery bands by
  distance and the rider dispatch cut are now dials with validated ranges
  (`domain/settings.js`), not constants in the source. **Push** makes them
  effective on every quote made afterwards; orders already booked keep the
  fees they were booked with, so a change can never re-price money sitting in
  escrow. Every push is audited with who and when.
- **The Flow tracker.** An order's stage, who holds it, the money against it
  and what the system is waiting for, on one screen — so a stalled order is
  read rather than guessed at.
- **Real maps, anywhere in the world.** OpenStreetMap tiles, Nominatim for
  geocoding and reverse geocoding, and Leaflet **vendored under
  `/vendor/leaflet`** — no CDN, because the CSP allows scripts from `self`
  only and a tradesperson's phone should not depend on a third party's
  uptime. Views never touch `L`: `ui/map.js` is the single seam
  (`mapInto` / `pin` / `line` / `fit` / `geocode` / `reverse` / `locate` /
  `km`). Enrolment is no longer bounded by a hard-coded area list — a pro or
  shop sets their place by search, by pin, or from the device. Existing area
  names still resolve, so nothing seeded as "Madhapur" breaks.
- **A collapsing header** across the app: full at rest, condensed on scroll,
  so a small phone spends its pixels on content.

### Changed
- **Production starts empty.** `buildSeed({ empty: true })` is what a real
  device boots: the owner's credential and nothing else. No example
  customers, pros, shops or products, and therefore no shipped account with a
  known password.
- **`?demo=1` is the only way to the example roster**, and it also switches
  the market simulation (`SIM_MARKET`) on for that one page load. It is a
  local testing switch and the deck capture's data source; there is no build,
  flag or setting that turns it on for a real device.
- **The deck capture is explicit about it**: `tools/shots.py` now opens
  `?shot=<scene>&demo=1`, and `ui/deckscenes.js` opens its admin scenes by
  writing the session `adminauth` itself would write — no password is used or
  held anywhere in that file.
- **Documentation** (`README`, `docs/LAUNCH.md`, `docs/PRODUCTION-PROCESS.md`,
  `docs/TEST-REPORT.md`, `docs/RUNBOOK.md`, `docs/SETUP.md`,
  `docs/AUTOMATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`) now
  describes the shipped product: the credential model, the empty start, the
  charges dials, the Flow tracker, the maps. The three steps that still
  complete inside the app rather than against an outside system — the phone
  code, UPI penny-drop, wallet top-up — are named once, plainly, in the
  owner-facing docs (`docs/LAUNCH.md` § *Three rails still to wire*) and
  nowhere on a customer screen.

### Removed
- **The seeded `admin` / `saahaa123` credential, and every instruction that
  told anyone to use it.** The admin username is **`siidhartha12`**; the
  password is the owner's own and appears nowhere in this repository.
  `ADMIN_BOOTSTRAP` in `src/core/config.js` carries only a PBKDF2-SHA256 hash
  (250,000 rounds over a random salt) and a `version`. Rotate it with
  `node tools/admin-cred.mjs '<new password>'` → paste the printed block into
  `ADMIN_BOOTSTRAP`, or change it on a device from Admin → System & audit.
  A device that has rotated its own password keeps it.
- The "Demo accounts" hint on the sign-in screen, the prototype banner in the
  admin console, and the hedging asides on customer screens — including
  *"(in production this arrives by SMS)"* under the partner's phone code,
  which now simply says to type the code in.

---

## [6.8.0] — 2026-09-06 — "Skin in the game"

### Added — the worker wallet and the commitment stake
- **When work starts, a minimum of the worker's own money locks; when the
  customer confirms the work, every rupee of it comes back — with the whole
  of the quote. SAAHAA receives the whole of its 8%.** `domain/wallet.js`:
  stake = max(₹100, 5% of the deal) capped at ₹500, locked at the customer's
  code (`lockStake`), returned at settlement (`returnStake`). Nothing is
  taken from anyone else's money; every move is a ledger leg
  (`STAKE_LOCK` / `STAKE_RELEASE` / `STAKE_FORFEIT`).
- **Four wallet states, never blended**: available (yours to withdraw),
  locked (committed to a job), pending (the ledger's 7-day holdback — now
  posted for real and released by a sweep), released (lifetime). Top-up and
  withdraw (UPI is the production rail for both). The order screen shows the
  lock on the job.
- **Cold start**: an empty wallet funds the stake on credit against the job's
  own payout, so a first job is never blocked; if the pro walks out, the
  credit part becomes a debt recovered once from the next payout.
- **Walking out**: a started job cannot simply be cancelled (the machine
  forbids it); the customer reports it, and an upheld dispute forfeits the
  stake **to the customer**, never to the platform.
- 5 new tests (107).

### Added — continuous delivery without a maintenance window
- `core/update.js` polls `version.json` (written by the build) and offers a
  *"SAAHAA x.y is ready — tap to update"* toast that stays until tapped; it
  never forces a reload. The service-worker cache is now stamped with the
  build id by the build itself. `docs/DEVOPS.md` explains the model;
  `docs/PRODUCTION-PROCESS.md` is the start-to-finish order for one operator.

---

## [6.7.0] — 2026-09-06 — "Production candidate"

A professional test pass over every role, every flow, every process — scripted
against the real UI on a fresh seed — plus the processes that were declared and
never driven. See `docs/TEST-REPORT.md` for the matrix and `docs/LAUNCH.md`
for the go-live checklist.

### Added — the retail processes the machine declared but nothing drove
- **"Not in stock" per line** at packing: the line's own policy decides —
  *similar* marks a substitute, *refund* refunds the item out of the shop's
  share at settlement, *ask me* moves the order to R_SUB_PENDING and the
  customer chooses (similar / refund); **no reply in 90 seconds refunds the
  item automatically** (`sweepSubstitutions`), as the cart always promised.
- **Pickup orders** end at the counter: packed → *Ready for pickup* →
  customer shows the code → *I have collected it* → delivered. They no longer
  go out with a rider.
- **Returns**: at delivered, *Something was wrong — return this order* →
  R_RETURN → the shop (or SAAHAA) accepts → refunded in full → closed, with
  the REFUND leg on the ledger.
- Settlement refunds unavailable items to the customer out of the shop's
  payout; fee, GST and rider are untouched, so escrow for every order still
  empties to the paisa.

### Fixed — found by the test pass
- Changing your area updated the screen but was never saved; it reverted on
  reload.
- A dispute closed by money moving kept `status: OPEN` and lingered in the
  admin's Disputes list.
- "Pickup only" shops did not refuse rider orders: the console writes
  `pickup_only`, the check read `pickup`.

### Verified (fresh seed, real controls, zero console errors)
Guest, customer, partner, shop owner and admin matrices — sign-up validation,
wrong-OTP / duplicate-ID / three-strike quiz lock / conduct retry, booking at
the 8% price, cancel with refund, dispute, ask-rates award and lost-bid
coaching, provisional cap, HOLD tier for a new pro, pro page edit, background
request → tier 3, certified → tier 4, suspend, partial resolution, mark paid,
ledger replay ₹0, kill switch, snapshot, password change, in-app suite 102/102,
v6 → v7 migration, guest deep links, light theme ground, auto-release sweep,
icon-only buttons labelled, no horizontal overflow.

---

## [6.6.0] — 2026-09-06 — "Eight on top"

### Changed — the company earns above the fair price, never out of the work
- **Platform charge is 8%, laid on top of the worker's quote and paid by the
  customer.** The worker is paid the whole of what they quoted; SAAHAA's take
  on a service is 8% of it, added above. GST (18% of that fee) is remitted,
  not kept. Golden vector: a ₹1,000 job → customer pays ₹1,080, worker keeps
  ₹1,000, SAAHAA ₹67.80 net of ₹12.20 GST. Tier-4 loyalty stays at 6%.
- Retail is unchanged (3–5% capped, first 30 orders free): a shop's products
  carry an MRP that cannot legally be exceeded, so "on top" is not available
  there — and kirana margin is 3–6%, which 8% would consume entirely.
- 5,000-order simulation at 8%: customers pay ₹83.5 lakh; pros ₹35.3 lakh
  (42.3%), shops ₹35.2 lakh; SAAHAA ₹2.99 lakh net of GST (3.58%, ₹60/order);
  customers save ₹11.2 lakh and pros + shops earn ₹16.9 lakh more than under a
  25% app. Reconciles to zero.
- `payGap` in ask-rates and the fee copy in Earn and sign-up derive from
  `SERVICE_MARKUP` instead of repeating the number.

### Changed — text, icons and symbols drawn, not borrowed
- **Every emoji in the interface is gone.** Forty-one drawn glyphs join the
  category set in `ui/icons.js` — bell, theme, basket, siren, pin, refresh,
  shield, lock, coin, camera, ID card, share, trash, calendar, plus, warning,
  star, scale, phone, trend, box, cold chain, prescription, flask, sign in /
  out, chevron, back, person, check, cross, wallet, chat, and the four group
  heads. Same hand, same stroke, identical on every phone. What remains are
  typographic marks (✓ ✗ ★ ✕ ▾) that render everywhere.
- Headers no longer prefix the category emoji; role chips, Earn's who-cards,
  the trust bar, the quick chips, the shop console's inventory blocks and
  the side/top bars all carry drawn glyphs.
- **Text roles**: uppercase letter-spaced type is for labels and metadata
  only. Sentences that had been set in `.meta` (admin notes, account empty
  states, the Home search sub-line, review text) are sentence case again.
  The huge price's tight tracking no longer leaks into the small line under
  it ("₹34lessthanheld").

---

## [6.5.1] — 2026-09-06 — desktop composition

Photographing every screen at 1440px showed where the desktop was still a
stretched phone layout. UI-only; engine byte-identical (guard green).

- **The bottom sheet becomes a centred 720px dialog on desktop** — a phone
  gesture has no place on a 27-inch screen, and a 1440px-wide sheet read as a
  broken page.
- **Command cards without an action are a stack, not a row.** At ≥1024 a
  `.cmd` laid out as a row so its action could sit at the right, and any
  capsules inside collapsed into a single stacked column beside nothing —
  the order hero, the account hero and every shop card. Content grows,
  actions hug; the row layout is earned only by a card that carries one.
- Cockpit metric strips wrap instead of scrolling off the edge; `--nav-h` is
  zero above 768px so sticky bars and toasts no longer reserve room for a bar
  that is not there.
- Home's hero was hidden with its header on desktop; only the duplicated top
  row is hidden now. Pillars wrap in the side column.
- The onboarding ladder stays a vertical track on every width (the horizontal
  desktop timeline mangled it) and sits in a 760px reading column; the sign-in
  form is a 560px column; the pro page's portrait card no longer inherits the
  Home hero's two-column grid.
- Deck: a "One design, every screen" section with seven desktop captures;
  `tools/shots.py --desktop` photographs any scene at 1440×900.

---

## [6.5.0] — 2026-09-05 — "Open Circle — Living Glass"

A UI-only release. **Keep the engine, rebuild the experience.** Every file under
`src/domain`, `src/core`, `src/net`, `supabase`, `.github` and `tools` is
byte-identical to 6.4.0 — enforced by `tools/guard-ui.mjs` against the frozen
snapshot at `../saahaa02`, together with the rule that no `data-act`,
`data-role`, element id or export may disappear from a view.

### The visual language
- Deep plum grounds, champagne-gold accents, ivory content surfaces; glass only
  where it improves hierarchy, always opaque-first with translucency as a
  progressive upgrade. Every new pairing carries a measured contrast ratio.
- A fourth material — deep plum (#1B0B3A→#3F1780) — lets gold be real gold:
  `#F4D68E` measures 12.24 on `#221041`. Moving the splash ground to it took
  the wordmark's darkest stop from 1.61 to 4.84; the bottom third of the
  letterforms was genuinely vanishing before.
- Component system: glass cards, command cards (one primary action), metric
  capsules, status pills, smart chips, segmented controls, timelines, the
  cinematic booking step bar, the Best Match card, floating cart action,
  avatar stacks, money-flow visualisation with four distinct money states,
  expandable cards, smart empty states, staggered rise motion — all honouring
  `prefers-reduced-motion` and `prefers-contrast`.

### One connected ecosystem
- **Shell**: persistent side navigation + top bar on desktop, icon rail on
  tablet, an expressive glass bottom bar on mobile — the same `NAV` array,
  the CSS decides. Admin and auth render bare.
- **Home** is a command surface: "Everything your neighbourhood needs", a large
  contextual search that is the front door (services, sub-services, shops,
  products, your own orders, recent searches), discovery rendered live from
  the registry by group with a per-group accent.
- **Booking**: NEED → SERVICE → DETAILS → MATCH → PRICE → CONFIRM as a step
  bar inside one sheet; one dominant Best Match card that says *why* (nearest,
  most trusted, fair price); alternatives exposed; ask-rates row unchanged.
- **Tracker**: the current stage is the hero; a live timeline from the machine's
  own stages; the next action right under it.
- **Shops**: compact information-rich cards, responsive product grid, delivery
  / pickup as a segmented control, a cart that floats in only when it has lines.
- **My SAAHAA** replaces the settings list: bookings, needs-you, saved,
  wallet legs from the ledger, chats, reviews, settings.
- **Partner work cockpit**: shift control first, new requests, today's jobs,
  earnings split into released · held · sent to UPI (never blended), your
  rates with lost-bid coaching, standing, ladder, your page.
- **Merchant command center**: orders, products with inline price/stock,
  pricing, sales, customers, payouts, setup, analytics — all from existing
  data; the ready-list picker surfaced, not hidden.
- **Admin command center**: the same eight sections as a segmented control;
  twelve metrics as capsules; Money Flow CUSTOMER → ESCROW → PARTNER / SHOP
  fanning to fee, GST, rider, holdback, goodwill, refunds — read-only from the
  ledger; the "system computes / you do by hand" note kept on every section.

### Fixed while redesigning
- `bid.result` (lost-bid coaching) was rendered with no handler; registered.
- `--ok` was used by the chance meter and saving highlights but never defined;
  the fills painted transparent. Aliased to `--success`.
- Admin/auth pages sat beside an empty ghost column on desktop (`grid-column:2`
  with no first column). Home's own header duplicated the desktop top bar.
- Shop console header rendered `&amp;`.

### Presentation
- `?shot=<scene>` (`src/ui/deckscenes.js`) seeds real state through the real
  domain functions; `tools/shots.py` photographs it with headless Chrome;
  `tools/deck.py` builds `docs/presentation.html` — 32 screenshots of the
  product itself, customer / partner / admin.

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
