# SAAHAA — release test report, v7.0.0 "Self-running" (2026-09-07)

Scripted end-to-end runs against the **real UI** (every step a `data-act`
control, not a domain call), phone viewport 375×812 with desktop passes at
840 and 1440, console errors captured. Where a domain API was used to *read*
state for an assertion (an order's paise, a partner's `countedJobs`, the
treasury figures behind the screen) it is marked *(read)*; every action went
through the screen. Test accounts created during the run carry throwaway
passwords that are not recorded here; the owner's password was never typed.

**Where the data comes from.** Production boots with an **empty** store —
nothing is seeded but the owner's credential — and section 1 is run exactly
that way. Everything from section 2 on starts from `?demo=1` on a cleared
browser, the local switch that loads the example roster (customer
`9000000001`, tier-2 pro Imran Naidu `9110001004`, shop owner `9200000001`,
password `123`) and switches the market simulation on for that page load
only. Admin screens were opened the way `ui/deckscenes.js` opens them for the
deck capture — by writing the session `core/adminauth.js` itself writes —
because the owner's password is not in the repository and was not typed
anywhere. Where a step-up sheet asks for that password (Fresh start, money
moves above ₹5,000) the run verifies the sheet, the refusal of a wrong
password and its audit entry, and marks the rest **owner-only**.

Legend: ✅ pass · 🔧 found and fixed in this release (UI layer) · ⚠ known
limit / lead item · 🔒 owner-only (step-up gated)

## 1. Clean slate

| Check | Result |
|---|---|
| `?demo=1` on a cleared browser: roster present — 128 users, 111 pros, 12 shops, 274 products; home shows "10 nearby" per category *(read)* | ✅ |
| Same device, next boot WITHOUT `?demo`: roster gone — 0 users / pros / shops / products / orders / ledger; `demoResidue` 0; home says "New here — be first" *(read)* | ✅ |
| Audit carries `data.demoPurged` by actor `system` with the counts (users 128, partners 111, shops 12, products 274, total 525, `kept: admin, settings`) | ✅ |
| Owner credential intact after the purge (`admin.hash`, `setupDone`); settings kept | ✅ |
| No "demo", "example", "sample", "prototype" copy on home / shops / orders / auth / earn | ✅ |
| Sign up a real customer (name + mobile + password + area chip) on the empty state → signed in, `loc {lat,lng,label}` stored | ✅ |
| Sign up a real partner (trade + typical price) on the empty state → lands on the ladder (tier 0) | ✅ |
| Both survive a reload; session restored; the purge does **not** fire again on real accounts (still one `data.demoPurged` entry) | ✅ |
| `?demo=1` on a store that already holds real accounts does not seed over them (`seeded` is set) — by design, `app.js:561`; a cleared browser is needed for the demo roster | ⚠ documented |

## 2. Money through the company (`?demo=1`)

| Check | Result |
|---|---|
| My SAAHAA → Wallet: balance ₹0, "Sandbox UPI — no real money moves yet", chips + ₹100/200/500/1000, Add money, Take out | ✅ |
| Top-up ₹500 (chip) → ₹500, toast "₹500 added to your wallet"; typed ₹5 refused "Minimum top-up is ₹10"; typed ₹2,000 take-out refused "You can take out up to ₹600"; take-out ₹50 → ₹550, "₹50 sent to your UPI"; Recent lists −₹50 / +₹100 / +₹500 | ✅ |
| Booking cheaper than the balance (laundry ₹201 → ₹217.08): order strip "₹217 from wallet", `paidFromWallet` 21708, `collected` 0, wallet 550 → 332.92 *(read)* | ✅ |
| Booking bigger than the balance (plumbing ₹428 → ₹462.24): strip "₹333 from wallet · ₹129 via Sandbox UPI — no real money moves yet"; ledger `PAYMENT_IN 12932 WORLD:funding → CUSTOMER` with `via: upi-sim`; wallet ₹0 *(read)* | ✅ |
| Cancel that booking before work (rule AFTER_ACCEPT_2H, "full refund") → `REFUND 46224 ESCROW → CUSTOMER`; wallet ₹462.24 | ✅ |
| Job chain as the pro: ASSIGNED → EN_ROUTE → ARRIVED (map `#jobMap`) → code 4 digits "Verified — work started" → finish absent before the photo, present after → WORK_DONE; stake ₹100 on credit | ✅ |
| Customer confirms → SETTLED, rates 5 → CLOSED; ledger `ESCROW_RELEASE 20100 → PARTNER`, `HOLDBACK 2010`, `FEE 1363 → PLATFORM:fee`, `GST 245 → PLATFORM:gst` | ✅ |
| Worker wallet on screen: Released ₹201 (the full quote), Locked ₹0, Pending ₹20 (holdback), Available ₹181 | ✅ |
| Admin → Finance → Treasury: "Books reconcile"; our earnings ₹14 (13.63), GST held ₹2 (2.45), Money in ₹679; liabilities customer ₹462 + worker ₹181 + holdbacks ₹20 = ₹663; "Money in must equal … It does." | ✅ |
| Withdraw ₹100 refused "Only ₹14 is ours to withdraw"; Withdraw ₹13.63 → "Withdrew ₹14 to the company bank", Withdrawn so far ₹14, button disabled at ₹0, audit `treasury.withdraw {amt:1363}` | ✅ |
| Remit ₹50 refused "Only ₹2 of GST is held"; Remit ₹2.45 → "Remitted ₹2 of GST", audit `treasury.remitGst {amt:245}`; books still reconcile | ✅ |
| Withdraw ₹6,000 → step-up sheet "Confirm it is you … Re-type the owner password"; wrong password → "That password is not right", field cleared, audit `admin.login.fail {stepUp:true}`, nothing moved | ✅ then 🔒 |
| Retail order (Aashirvaad Atta ₹281 + rider ₹19 = ₹300.33) paid from the wallet; auto-accepted under the sim market; shop chain picking → packed → out → delivered; customer settles → R_CLOSED, "Settled — ₹273 to Sri Lakshmi Kirana" | ✅ |
| Legs: `SHOP_PAYOUT 27289`, `FEE 715`, `GST 129`, `RIDER 1400 → RIDER:pool`, `DISPATCH 500 → PLATFORM:fee` | ✅ |
| Shop → Money tab: Shop wallet ₹273, sandbox label, history "+₹273" | ✅ |
| Shop wallet history printed the raw ledger kind "SHOP_PAYOUT" | 🔧 `partner.js:502` — `SHOP_LEG.SHOP_PAYOUT = 'Order settled'` |
| Treasury "Our part, per order": service row ₹217 / fee ₹14 / GST ₹2 / dispatch ₹0 / ours ₹14 = the order's `platformFee` 1363; retail row ₹300 / ₹7 / ₹1 / ₹5 / ₹12 = `ourPartOf` 715 + 500 *(read)* | ✅ |
| Finance: Ledger replay vs aggregate — **Difference ₹0** (before and after the dispute below) | ✅ |

## 3. Automatic approvals (`?demo=1`)

| Check | Result |
|---|---|
| Tier-2 pro's cockpit → Standing "Next: Background Checked · 2 / 6 green": ladder 7/7 ✓, jobs 1/3, rating "4.7 / 4.3 after 3 jobs", upheld disputes 0/0 ✓, vouches 0/2, "Name a reference · not yet" with the reference form | ✅ |
| Kill switch: Admin → Approvals → Automation → "Promote by itself" off → Push → pill "SWITCHED OFF", toast "Pushed — automation is off, tiers 3 and 4 wait for you", audit `automation.push`; Standing says "Automatic promotion is paused by SAAHAA right now." | ✅ |
| Reference: Save my reference → "Send your reference their code" → toast + on-screen sandbox code (matches state *(read)*); wrong code "That code is not right" + audit `verify.refCodeWrong`; right code → "Reference confirmed." line green "confirmed · Suresh Contractor" | ✅ |
| Three clean jobs (code + photo, customer confirms, rated 5 / 5 / 4) → jobs 3/3, rating 4.65 ≥ 4.3 *(read)* | ✅ |
| Vouch by the customer whose job settled (pro page → "Vouch for Imran") → "Thank you — your vouch counts.", audit `verify.vouch`; second attempt: button gone, "You have already vouched for this pro." (engine `canVouch` agrees *(read)*) | ✅ |
| Tier-2 same-trade pro sees no button: "Only a Background-Checked pro in the same trade can vouch as a pro."; tier-3 same-trade pro vouches → vouches 2/2 | ✅ |
| All six lines green, `ready: true`, **still tier 2** while the switch is off; pipeline "1 READY", promotions list "· 0" | ✅ |
| Switch on → Push → with no approve click the sweep promotes: tier 3, `tier3At` set, audit `verify.auto` by actor `auto` with evidence `ladder 7/7 · jobs 3/3 · rating 4.65/4.3 · disputes 0/0 · vouches 2/2 · reference 1/1`; "Promoted by the network · 1 — Imran Naidu → Background Checked"; pipeline back to 0 ready | ✅ |
| Badge: cockpit and public page show "✓ BACKGROUND CHECKED" | ✅ |
| Tier-4 Standing for the tier-3 pro: "Next: SAAHAA Certified · 4 / 5 green" — jobs 41/25, rating 4.7/4.6, upheld 0/0, "Days as Background Checked 0 / 14 days", open disputes 0/0 | ✅ |
| Dial validation: certDays 400 → "certDays: must be between 0 and 365", value unchanged | ✅ |
| certDays 0 → Push → the pro is promoted to tier 4 "Imran Naidu → SAAHAA Certified", audited `verify.auto` by `auto` (every other eligible tier-3 pro on the roster promoted on the same sweep, as the dial says) | ✅ |
| Pro page meta said "1 vouches" | 🔧 `pro.js:115` — singular/plural |
| Admin Approvals "Promoted by the network", the flow journey and the audit log (`ol.timeline`) laid out **horizontally** at ≥768 — 20 entries in a row, page 1,902 px wide at 840 | 🔧 `tokens.css:1203` `.timeline--list` + `admin.js:604/843/1343` |

## 4. Admin (session written as `deckscenes.js` does; no password used)

| Check | Result |
|---|---|
| Console opens; eight sections; no bootstrap/demo copy | ✅ |
| **Charges**: service % 8 → 10, Push ("Pushed — every new quote uses these"), worked example "₹1,000 job: the customer pays ₹1,100"; a NEW booking pays 10% (₹428 → ₹471, fee 3627 + GST 653 *(read)*); Reset to defaults → 8% | ✅ |
| **Flow tracker**: 60 rows, role filter (customer → 5), tap unrolls the journey (audit + order history) | ✅ |
| Live map `#adminMap` (Dashboard): 122 pins via Refresh, "Map refreshed" | ✅ |
| Approvals override: Users & partners → Promote → "Press Express → Background Checked" (2 → 3) | ✅ |
| Suspend → "Suspended", `suspended: true`, audit `partner.suspend` | ✅ |
| Disputes: customer raises "Not done" at WORK_DONE → DISPUTED "Reported. Your money is frozen"; admin Partial 60% → "Dispute resolved", order PARTIAL (`workerPayout` 25680, `refund` 18832), open list empties, **refund lands in the customer wallet** (₹0 → ₹188.32) | ✅ |
| Payout queue → Mark paid clears the row (3 → 2), "Marked 1 payout(s) paid — record the UTR in production" | ✅ |
| Kill switch RETAIL on → off ("OFF") → on | ✅ |
| Snapshot → "Snapshot saved", Restore row appears → Restore → "Restored", state intact | ✅ |
| **Fresh start**: card shows the counts and the demo-residue warning; wrong word → "Type FRESH in the box to confirm", no sheet; "fresh" → step-up sheet "This wipes every account, order and ledger entry on this device."; wrong password refused + audit `admin.login.fail {stepUp:true}`; nothing wiped | ✅ then 🔒 |

## 5. Cross-cutting

| Check | Result |
|---|---|
| Console: only the known `version.json` 404 from `core/update.js` on a static server (13 polls, nothing else) | ✅ |
| No horizontal overflow at 375 / 840 / 1440 on: home, shops, shop, cart, orders, service order, retail order, earn, account (wallet), pro page (vouch), auth, onboard, partner cockpit (tier-2 Standing and tier-3 Standing), all nine shop tabs, all eight admin sections (automation, treasury, fresh start) with a flow row unrolled | ✅ after 🔧 |
| Shop cockpit at 375: catalog and pricing 516 px wide — `type=number` inputs kept their intrinsic width in the flex row | 🔧 `partner.js:630/634/655/659` `min-width:0;width:0` |
| Shop cockpit at 375: customers / payouts / analytics 391 px — `.metricrow` edge-bleed margin inside the gutter-less `.workspace` | 🔧 `tokens.css:840` `.workspace .metricrow` |
| Shop cockpit at 375: money tab 416 px — `.moneyflow__node span` restyled the "Yours after settlement" pill into a 278 px nowrap figure | 🔧 `tokens.css:1001` `.moneyflow__node .pill` |
| Light theme paints an explicit ground (rgb 248,245,254); dark parity (rgb 21,10,46); toggle both ways at 375 and 1440 | ✅ |
| Icon-only buttons carry aria-labels on every screen above (scan of every visible button with no text) | ✅ |
| No emoji in rendered UI text on any of those screens (★ / ✓ / ✕ glyphs are text; "©" is Leaflet's attribution) | ✅ |
| Home header collapses on scroll to the search bar alone and restores on scroll up — 494 → 96 → 494 px at 375, 446 → 128 → 446 px at 1440 | ✅ |
| Login gate: signed out, Orders says "Sign in to see orders"; wrong password ×4 "Wrong password"; fifth "Wrong password — locked for 30s"; sixth and seventh "Too many attempts — try again in 29s / 27s" | ✅ |
| `node tools/test-node.mjs` PASS 169 FAIL 0; `node tools/guard-ui.mjs` "engine frozen · contract kept"; `python tools/build.py --site` 0 lint problems — before the run and after every fix | ✅ |

## Lead items (forbidden files — not touched here)

- None blocking. Two observations for the lead, not defects:
  - **`src/domain/autoverify.js:97`** — the tier-3 "Average rating" line
    averages every rating the pro has (`avgRating(p)` over `p.ratings`), while
    the label and `docs/AUTOMATION.md` say "over those jobs". For a real pro
    every rating comes from a real job so the two agree; on the demo roster
    the seed ratings are counted too (4.65 above came from 23 ratings, not 3).
  - **`src/app.js:561`** — `?demo=1` seeds only an unseeded store, so a device
    that already holds real accounts never receives the roster; the report
    above used a cleared browser. Worth one line in `docs/WORKFLOW.md` § Test
    data.

## Known limits (not defects — production items)

- **Three rails complete inside the app instead of against an outside
  system**, and every screen says so: the reference's 4-digit code and the
  phone code are shown on screen rather than texted (needs a DLT-registered
  SMS sender); `core/gateway.js` runs in `MODE = 'sim'` — every collect and
  payout is labelled *Sandbox UPI — no real money moves yet* and every ledger
  leg it produces carries `via: 'upi-sim'` (Razorpay replaces that one file,
  `docs/PRODUCTION.md` §3); a UPI id is format-checked and saved rather than
  penny-dropped.
- Withdraw fees, Remit GST above ₹5,000 and Fresh start are step-up
  protected; this run stops at the sheet (the owner's password is not in the
  repository) and verified the refusal path only.
- The 14-day Certified tenure cannot be waited out in a run; the `certDays`
  dial at 0 proved the promotion path, then everything eligible on the demo
  roster was promoted on the same sweep — expected, and audited per pro.
- The 90-second substitution timer runs while the app is open; in production
  it is a `pg_cron` job (`supabase/migrations/0003_automation.sql`).
- The `?demo=1` market simulation answers ask-rates and accepts retail orders
  so the flows can be walked locally. It runs only under `?demo=1`
  (`SIM_MARKET`) and never on a real device; a device that was walked with it
  drops the roster at its next normal boot (section 1).
- Maps use OpenStreetMap tiles and Nominatim, a free shared geocoder used
  politely (one request per user action, never per keystroke). At real volume
  this needs a self-hosted Nominatim or a paid geocoder — a capacity item.
- The admin live map and the order maps paint on `requestAnimationFrame` /
  a short timer after render; a hidden or headless tab defers them, which is
  why this run used the **Refresh** control to assert pins.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
