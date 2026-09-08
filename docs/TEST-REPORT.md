# SAAHAA — release test report, v8.0.0 "Modernist" (2026-09-08)

A whole-surface redesign is the one release where every screen changes at
once, so this run is longer than the last: the **entire matrix was walked
twice**, the second time on a store cleared to nothing, because a redesign
breaks things that only show up on a second pass — stale ids, lost focus,
sheets that outlive the screen that opened them. Both passes were driven
through the real `data-act` controls; `getState()` and `core/audit.js` were
read only to CONFIRM an assertion, never to set up a step a control could do.

Every screen was measured at **375 / 840 / 1440 in both light and dark**.
Test accounts created during the run carry throwaway passwords that are not
recorded here; the owner's password was never typed.

**Where the data comes from.** Production boots with an **empty** store —
nothing seeded but the owner's credential — and section A is run exactly that
way. Everything from section B on starts from `?demo=1` on a cleared browser,
the local switch that loads the example roster (customer `9000000001`, pros
`91000000xx`, shop owners `92000000xx`, password `123` — confirmed in
`domain/seed.js`) and switches the market simulation on for that page load
only. Admin screens were opened the way `ui/deckscenes.js` opens them for the
deck capture — by writing the session `core/adminauth.js` itself writes —
because the owner's password is not in the repository. Where a step-up sheet
asks for that password the run verifies the sheet, the refusal of a wrong
password and its audit entry, and marks the rest **owner-only**.

Legend: ✅ pass · 🔧 found and fixed in this release (UI layer, file:line) ·
⚠ lead item / known limit · 🔒 owner-only (step-up gated)

---

## A. Empty production boot, and three real sign-ups

| Check | Result |
|---|---|
| `?demo=1` on a cleared browser: roster present — 128 users, 111 pros, 12 shops, 272 products *(read)* | ✅ |
| Same device, next boot WITHOUT `?demo`: 0 users / pros / shops / products / orders / ledger; home says "New here — be first" | ✅ |
| Audit carries `data.demoPurged` by actor `system` with the counts (users 128, partners 111, shops 12, products 272, total 523, `kept: admin, settings`) | ✅ |
| Owner credential intact after the purge (`admin.hash`, `setupDone`); dials kept | ✅ |
| No "demo" / "example" / "sample" copy on home, shops, orders, auth, earn, nearby | ✅ |
| Sign up a real **customer** on the empty state (name + mobile + password + area chip) → signed in, `loc {lat,lng,label}` stored, toast "Welcome, …" | ✅ |
| Sign up a real **partner** (trade + typical price) → lands on the ladder at step 1 of 7, tier 0 | ✅ |
| Sign up a real **shop owner** (shop name + what you sell) → lands on `#/shopadmin`, "Your shop is live — add products" | ✅ |
| All three survive a reload; session restored; the purge does **not** fire again on real accounts (still one `data.demoPurged` entry) | ✅ |
| Empty-state routes at 375 (home, nearby, shops, orders, earn, account, auth, all five legal pages): no overflow, no radius, no emoji, no icon-only button without a label | ✅ |
| Pass 2, fresh store: same three sign-ups (`9700000001/2/3`), same result, no purge fired | ✅ |
| `?demo=1` on a store that already holds real accounts does not seed over them (`seeded` is set) — by design, `app.js:561`; a cleared browser is needed | ⚠ documented |

## B. The customer (`?demo=1`)

| Check | Result |
|---|---|
| Search: typing in the hero field narrows live; the input is replaced on every re-render yet **focus and caret survive** (`ui/dom.js` `mount()` — "fan", "plumb", "atta", "rice", "clean" all keep `selectionStart`) | ✅ |
| "electrician" matches nothing while "electric" matches Electrical — the matcher is substring, not stemmed | ⚠ observation, engine-side |
| Category → booking sheet (mockup 11): sub-service chips, best-match card, the bill **read from the dials** — deal ₹503 + "SAAHAA charge · 8% on top, incl. GST" ₹40 = ₹543 (503 × 1.08) | ✅ |
| Paid **from the wallet**: laundry ₹201 → ₹217.08, strip "₹217 from wallet", `paidFromWallet` 21708, `collected` 0 *(read)* | ✅ |
| **Wallet + sandbox split**: electrical ₹503 → ₹543.24 against a ₹282.92 balance → "₹283 from wallet · ₹260 via Sandbox UPI"; ledger `PAYMENT_IN 26032 WORLD:funding → CUSTOMER` `via: upi-sim`, then `ESCROW_IN 54324` | ✅ |
| Order tracking (mockup 9): number, counterparty line, stepped timeline with times, the bill, and the **map toggle** — `#orderMap`, 2 markers, tiles, "MAP" ⇄ "HIDE MAP" | ✅ |
| **Chat** — inline composer and the new `#/chat/<orderId>` screen (mockup 6): message sent, appears in the thread, thread scrolls to the bottom, field clears | ✅ |
| **Masked contact details stay masked**: "Call me on 9876543210 …" stored and rendered as "•••••••••", `flagged: true`, `audit fraud.offplatform` | ✅ |
| The composer lost focus after every send — one message per keyboard-open | 🔧 `views/orders.js:43` — a `delegate('click','[data-act="chat.send"]')` that puts the caret back; verified on both composers in pass 2 |
| The masked-message note said "Contact details hidden" while the engine masks only 10-digit numbers and UPI handles (`domain/flow.js:708`) | 🔧 `views/orders.js:323` and `:405` — "Phone numbers and payment ids hidden" |
| WORK_DONE → customer confirms → `SETTLED`; ledger `ESCROW_RELEASE 20100 → PARTNER`, `HOLDBACK 2010`, `FEE 1363 → PLATFORM:fee`, `GST 245 → PLATFORM:gst` | ✅ |
| Rating panel (mockup 12) appears inline on settle; 5 ★ → `CLOSED`, review written, partner rating updated | ✅ |
| The door code stayed on screen after the pro had already used it (through IN_PROGRESS, WORK_DONE, SETTLED) | 🔧 `views/orders.js:277` — hidden once `otpVerified` |
| **Ask-rates** (mockups 4, 5, 10): compose → "Asking 4 workers near you", live elapsed bar, sealed quotes, waves at 3-minute intervals | ✅ |
| Window closes at 12 min → quotes revealed with "Best pick" and a reason per quote → Accept ₹497 → order `ASSIGNED` (deal ₹460 + fee ₹31 + GST ₹6) | ✅ |
| **Receipt** sheet after accepting: "You asked 3 workers · You pay ₹497 · You saved ₹46 · Fayaz Ahmed is booked" | ✅ |
| The waiting screen typed "usually done by 4:00" — a hard-coded marker against a window `domain/bidding.js:218` owns | 🔧 `views/ask.js:197` — derived from `req.closesAt - req.openedAt` |
| **Cart → retail order**: substitution policy per line, three delivery modes, bill with "SAAHAA's charge of ₹17 (3% of the basket) comes out of the shop's side" — placed, auto-accepted under the sim market | ✅ |
| Shop chain picking → packed → out → delivered; customer confirms → **`R_CLOSED`**, "Settled — ₹543 to Sri Lakshmi Kirana" | ✅ |
| Retail legs: `SHOP_PAYOUT 54258`, `FEE 1472`, `GST 265`, `RIDER 1400 → RIDER:pool`, `DISPATCH 500 → PLATFORM:fee` | ✅ |
| Wallet: top-up chips and typed amounts; ₹5 refused "Minimum top-up is ₹10"; ₹2,000 take-out refused "You can take out up to ₹200"; ₹150 out → "₹150 sent to your UPI"; Recent lists every leg | ✅ |
| **Refund lands in the wallet**: cancel before the pro sets out (rule "more than 2 hours before the slot — full refund") → `REFUND 49704 ESCROW → CUSTOMER`, balance ₹500 → ₹997 | ✅ |
| A ₹5 take-out (under the ₹10 minimum) is refused with the *balance* message, not the minimum one | ⚠ lead item — `domain/flow.js:72` |
| **`#/nearby`** (mockup 7): 41 pins on `#nearbyMap`, tiles, legend; filters Shops → 12, Pros → 111; search "lakshmi" → 4; "zzzznone" → "Nothing here matches"; list of 123; `aria-pressed` tracks each chip | ✅ |
| `#/nearby` **empty-store** state on the production boot: map, chips and the "New here" list with no rows and no errors | ✅ |

## C. The working side (`?demo=1`)

| Check | Result |
|---|---|
| **Ladder 1–7** on a brand-new partner: code sent → wrong code "That code is not right" → right code; ID (last 4 kept); selfie; trade quiz 5/5; rules quiz 6/6; UPI — "notavalidupi" refused "A UPI id looks like name@bank", `name@okhdfcbank` accepted; agree → **tier 2**, "You are live" (mockup 22) | ✅ |
| **Leads** (mockup 14): open request appears with fair price and the 12-minute clock | ✅ |
| **Quote builder** (mockup 15): "Your price ₹470 · **You keep 100% — nothing comes out of it** · SAAHAA's 8%, paid by the customer ₹38 · **The customer pays ₹508**" | ✅ |
| Both move with the slider — 450 → keep ₹450 / fee ₹36 / customer ₹486 / chance "strong"; 560 → ₹560 / ₹45 / ₹605 / "weak"; 600 → ₹600 / ₹48 / ₹648. The Send button re-labels with the figure | ✅ |
| Bid sent → "Your price of 470 is in", appears under "Your sealed rates · Waiting" | ✅ |
| **Job chain**: ASSIGNED → EN_ROUTE (job map with both pins) → ARRIVED → wrong code refused → right code "Verified — work started" → *finish absent before the photo, present after* → WORK_DONE | ✅ |
| **Stake locked at check-in**: `order.stake {need: 10000, funded: 0, onCredit: 10000, lockedAt}` *(read)*, and the panel says so | ✅ |
| **Stake returned at settlement**: `{… returned: true, returnedAt}`; Earnings shows LOCKED ₹0 | ✅ |
| **Earnings** (mockup 16): "September · you kept ₹520 from ₹520 quoted", Released ₹520 / In escrow ₹0 / Sent ₹0, wallet Available ₹468, Pending ₹52 (7-day holdback) — every figure agrees with the ledger; stake copy reads `W.MIN_STAKE`, `W.STAKE_PCT`, `W.MAX_STAKE` | ✅ |
| **Peer verification** — Standing panel: ladder 7/7, jobs, rating, upheld disputes, vouches, reference; the reference form with the consent box | ✅ |
| Reference: saved → "Send your reference their code" → on-screen sandbox code → wrong code "That code is not right" + `audit verify.refCodeWrong` → right code "Reference confirmed." | ✅ |
| Vouches: the customer whose job settled vouches ("Thank you — your vouch counts.", `audit verify.vouch`), then the button is gone and the page says "You have already vouched for this pro."; **singular "1 vouch"** | ✅ |
| A tier-2 same-trade pro is refused — "Only a Background-Checked pro in the same trade can vouch as a pro."; a tier-3 same-trade pro vouches → 2 / 2 | ✅ |
| Kill switch off → Standing says "Automatic promotion is paused by SAAHAA right now.", pill "switched off" | ✅ |
| **Automatic tier 3 with no admin click**: switch on + dials pushed → the sweep promotes; `audit verify.auto` by actor **`auto`** with evidence `ladder 7/7 · jobs 1/1 · rating 5/4.3 · disputes 0/0 · vouches 2/2 · reference 1/1`; Approvals lists "Promoted by the network · 1" | ✅ |
| The working side wears the ink strip: `.apphdr.on-plum` computed `rgb(32,30,29)` ground, `rgb(243,242,242)` text | ✅ |

## D. The shop (`?demo=1`)

| Check | Result |
|---|---|
| **Today** (mockup 17): Sales today, "Fees today (3%) · capped ₹25" (both from `getPricing()`), Orders needing you with the 60-second note, Wants attention with restock rows, "Add without typing" | ✅ |
| **Listings** (mockup 18): Products / Inventory / Pricing sub-tabs; "Pick from the ready list" → **Add** an item → "Fortune Chakki Atta 10kg listed", products 271 → 272, the picker drops it from the list | ✅ |
| Order chain from the shop: R_ACCEPTED → picking → weighed & packed → out for delivery → delivered; the "Not in stock" path re-prices the line and marks it "similar" | ✅ |
| **Money & fees** (mockup 19): Orders ₹579, SAAHAA fee −₹17 (3%, capped ₹25), Rider fees −₹14, Yours ₹543, "what an aggregator would have taken ₹145 at 25%", shop wallet ₹543, history "Order settled · +₹543" | ✅ |
| Nine shop views (Today, Items, Orders, Money, Analytics, Shop profile, Customers, Inventory, Pricing) at all three widths, both themes | ✅ |

## E. Admin (session written as `deckscenes.js` does; no password used)

| Check | Result |
|---|---|
| Console opens; header reads "v8.0.0 'Modernist' · schema v9 · 20260908a"; eight sections, no bootstrap or demo copy | ✅ |
| **Charges**: service % 8 → 10, Push → "Pushed — every new quote uses these", worked example recomputes ("₹1,000 job: the customer pays ₹1,100 … markup 10%") | ✅ |
| A **new** booking is priced at the new rate (₹428 → ₹471) while the **already-booked** order keeps its own (`deal 52000`, `platformFee 3525`, `customerPays 56160` — 8%) *(read)* | ✅ |
| Reset to defaults → 8%; a second push at 12% and reset in pass 2 behaved identically | ✅ |
| **Flow**: 60 rows, role filter (Customers → 5), tap unrolls the whole journey (audit entries + order history) — vertical at 375, no overflow | ✅ |
| **Treasury**: "Books reconcile"; aggregate escrow = ledger replay, **Difference ₹0**; "Money in must equal liabilities + ours + GST + goodwill + withdrawn + remitted. It does." | ✅ |
| **"Our part, per order" matches the orders**: Guardian ₹562 / fee ₹35 / GST ₹6 / ours ₹35 = `platformFee 3525`; Sri Lakshmi ₹471 / ₹11 / ₹2 / dispatch ₹5 / ours ₹16 = `FEE 1148 + DISPATCH 500`; Imran ₹217 / ₹14 / ₹2 = `1363` *(read)* | ✅ |
| Withdraw ₹1,000 refused "Only ₹65 is ours to withdraw"; ₹0.50 refused "Minimum ₹1"; ₹65 → "Withdrew ₹65 to the company bank", `audit treasury.withdraw {amt:6500}` | ✅ |
| Remit ₹50 refused "Only ₹11 of GST is held"; ₹10.87 → "Remitted ₹11 of GST", `audit treasury.remitGst {amt:1087}`; books still reconcile | ✅ |
| **Automation**: the switch off → Push → pill "switched off", toast "Pushed — automation is off, tiers 3 and 4 wait for you", `audit automation.push` | ✅ |
| Dial validation: `certDays` 400 → "certDays: must be between 0 and 365", nothing pushed | ✅ |
| Dials pushed with the switch on → promotion happens on the sweep with no approve click (section C); Reset to defaults restores 3 jobs / 4.3 / 2 vouches / reference / 14 days | ✅ |
| **Payments rail** card: "sandbox" pill, Sandbox ⇄ Razorpay mode, key-id and Edge-Functions URL fields, "Save on this device" / "Back to sandbox", and the fails-closed note | ✅ |
| **Fresh start**: counts + the demo-residue line; wrong word → "Type FRESH in the box to confirm", no sheet; "FRESH" → step-up "Confirm it is you … Re-type the owner password"; wrong password → "That password is not right", field cleared, `audit admin.login.fail {stepUp:true}`, **nothing wiped** (129 users before and after) | ✅ then 🔒 |
| System & audit: health 10/10, self-test card ("Run 173 tests"), 14 feature flags, registry counts, snapshot/export, change password | ✅ |
| All eight sections at 375 / 840 / 1440, light and dark | ✅ |

## F. Design conformance — the 22 mockup screens

Ground `rgb(243, 242, 242)` in light on **every** route (measured, not eyeballed);
`rgb(32, 30, 29)` in dark. `font-family` resolves to **Archivo** everywhere.
`border-radius: 0` on every button, card, input, tag, chip and tile on every
screen in the sweep — the only non-zero radii in the document belong to
Leaflet's own controls inside `.leaflet-container`.

| # | Mockup screen | Route / view | Result |
|---|---|---|---|
| 1 | Home | `#/home` | ✅ accent hero, 2px rules, category tiles, "Or say it in one tap" |
| 2 | Search & filters | `#/home` search + `#/shops` | ✅ live results grouped "Services & shops" / "On shop shelves" |
| 3 | Service detail | `#/pro/<id>` | ✅ photo block, tags, four-cell stat row, rate card, sticky book bar |
| 4 | Home — the ask | `#/home` hero | ✅ "Together, we elevate life" eyebrow, "Send to the circle →" |
| 5 | Quotes arriving | `views/ask.js` waiting | ✅ named avatars, elapsed bar with the marker, sealed rows |
| 6 | **Chat with the pro** | `#/chat/<orderId>` | ✅ new screen: header + Order button, JOB CONFIRMED card, day rules, ink bubbles, accent send, honest footer |
| 7 | **Neighbourhood** | `#/nearby` | ✅ new screen: map, search, filter chips, legend, list, empty state |
| 8 | Shop storefront | `#/shop/<id>` | ✅ header, in-stock strip, category scroller, product grid with ADD |
| 9 | Order tracking | `#/order/<id>` | ✅ number + counterparty, map card, stepped timeline, bill |
| 10 | Request a job | `views/ask.js` compose | ✅ |
| 11 | Booking & payment | booking sheet | ✅ bill, "How you pay", the comparison block, confirm |
| 12 | Ratings & reviews | rate panel | ✅ 5 star buttons at 44px, Skip |
| 13 | Profile / settings | `#/account` | ✅ stat row, wallet, settings rows, shortlist |
| 14 | Leads | `#/partner` | ✅ ink header, three KPIs, sub-tabs, request cards |
| 15 | Quote builder | `ask.bidSheet` | ✅ fair-price band, slider, chance meter, the three money lines |
| 16 | Earnings | partner earnings | ✅ month bars, payable, recent jobs table, "where the money is" |
| 17 | Today | `#/shopadmin` | ✅ |
| 18 | Listings | shopadmin catalog | ✅ |
| 19 | Money & fees | shopadmin money | ✅ |
| 20 | Which side are you on | `#/auth` role picker + `#/earn` | ✅ full-bleed role rows, the three-figure comparison |
| 21 | Shop setup | `views/onboard.js` | ✅ |
| 22 | You're live | onboard success | ✅ public-page card, "you paid to get here ₹0" |

Admin, the legal pages and the shell are not drawn in the mockup; they carry
the same system (paper ground, Archivo, zero radius, 2px rules) and were
measured with the same sweep.

**No hard-coded fee percentage anywhere.** Every `%` in a rendered string was
traced to its source: `liveMarkup()` / `getPricing()` (`ask.js:36`,
`auth.js:141,211`, `earn.js:140`, `partner.js:252`, `orders.js:231,343`,
`home.js:1040`, `legal.js:37`, `admin.js:1167`), `GST_RATE`
(`admin.js:1142`), `AGG_COMMISSION` (the "25% aggregator" comparison), or the
order's own `platformFee / deal`. The three literal "8%" / "3%" in the tree
are in **comments** (`partner.js:14-15`, `pro.js:17`), not output. "100%" is
an invariant of the economics, not a rate. The mockup's "3%, taken from the
pro's side" appears nowhere: the product's 8%-on-top, worker-keeps-100% is
what every screen states.

**Touch targets.** The redesign shipped a family of controls under 44px. All
were raised without moving anything else on the page (the extra height is
padding):

| Control | Was | Fix |
|---|---|---|
| `.more` — "Browse all →", "Map view →", "All 24 categories →", "Create an account", "All shops →" | 12px | 🔧 `tokens.css:206` |
| `.loc` — the home header's area button | 33px | 🔧 `tokens.css:257` |
| `.btn--sm` — every small button in the product | 36px | 🔧 `tokens.css:280` |
| `.btn-icon` | 36×36 | 🔧 `tokens.css:282` |
| the search fields' `<input>` inside a 44/52px shell | 25px | 🔧 `tokens.css:262`, `:266` (`align-self:stretch`) |
| desktop topbar: location, search, avatar | 27 / 36 / 32px | 🔧 `tokens.css:172`, `:174`, `:178` |
| `.nb-chip` — the neighbourhood filters | 36px | 🔧 `home.js:860` |
| the home header avatar | 36×36 | 🔧 `home.js:528` |
| the best-match card's pro-name link | 21px | 🔧 `home.js:1051` |
| `.m-add` / `.m-qty` — every ADD and quantity control on a storefront | 36px | 🔧 `shops.js:102`, `:104`, `:105` |
| the cart's substitution-policy chips | 32px | 🔧 `shops.js:347` |
| shop console Open/Close and the sub-tabs | 36px | 🔧 `partner.js:60`, `:83` |
| "Add" in the ready-list picker | 40px | 🔧 `partner.js:777` |
| `.ad-rowbtn` — admin table row buttons | 32px | 🔧 `admin.js:116` |

After the fixes **no interactive control anywhere in the app measures under
44px** at 375, 840 or 1440, in either theme.

## G. Cross-cutting

| Check | Result |
|---|---|
| **A closed sheet swallowed clicks.** `.sheet` without `.on` keeps `pointer-events:auto`; at ≥768px it is centred with `opacity:0`, so once any sheet had been opened a **510 × 759 invisible block** sat over the middle of the page and `document.elementFromPoint` returned the sheet, not the content. It was also still in the tab order at every width | 🔧 `tokens.css:401-406` — `visibility:hidden; pointer-events:none` with a delayed `visibility` transition so the slide-out still plays. Verified: after closing, `elementFromPoint` at the sheet's centre returns the page beneath |
| **A dismissed toast did the same**, as a 79px strip immediately above the tab bar — over the primary action on most screens | 🔧 `tokens.css:419-422` |
| The pro's own screens spoke in the customer's voice: the order header showed the pro their own name, the bill said "**You pay** ₹217" and "held until **you** confirm", the job map's accent badge said "You · Madhapur" over the *customer's* pin, the chat header and placeholder named the pro to the pro, and the customer's savings line was shown to the worker | 🔧 `views/orders.js:94-95, 243-247, 286, 303, 312, 364, 390` — every one of these is now read from who is holding the phone |
| No console error other than the known `version.json` 404 from `core/update.js` on a static server (9 polls in the last window; every other request 200). No uncaught exception in either pass | ✅ |
| **No horizontal overflow.** `document.scrollWidth === clientWidth` on every screen and every tab, in both themes: **375 → 375 / 375**, **840 → 825 / 825**, **1440 → 1425 / 1425**. Nothing extends past the viewport except the deliberate horizontal scrollers (`.chiprow`, `.ad-tabs`, `.subtabs`, `.tablewrap`), which clip and scroll inside their own box | ✅ |
| No emoji in rendered text on any screen (★ ✓ ✕ ↑ ▾ are text glyphs from `ui/icons.js` and the type; "©" is Leaflet's attribution) | ✅ |
| aria-labels on every icon-only button on every screen in the sweep — the scan found none missing | ✅ |
| The home header collapses to the search bar: `.hdr--compact` applies, the search shell goes 52 → **44px**, and `.inner` / `.hdr__fold` take `max-height:0; opacity:0; pointer-events:none`. The scroll listener is bound in `home.js:271` | ✅ see note |
| Login gate: signed out, Orders says "Sign in to see orders". Lockout: four "Wrong password", the fifth "Wrong password — locked for 30s", the sixth and seventh "Too many attempts — try again in 30s / 29s" | ✅ |
| Light ground `rgb(243,242,242)` / dark ground `rgb(32,30,29)`, toggled both ways at all three widths on every route | ✅ |
| Plurals: "1 vouch" / "2 vouches", and the "(s)" / "(es)" placeholders in the admin console replaced with real plurals | 🔧 `admin.js:382,383,384,719,777,803,891,894,895,1287,1425,1463`, `orders.js:488` |

**Note on the header collapse.** The preview pane this run used renders the
whole document with no scrollport — `window.scrollY` stays 0 under both
`scrollTo` and a real wheel event — so the collapse could not be *driven* by
scrolling. It was verified by applying the state class and confirming from
the CSSOM that every `.hdr--home.hdr--compact` rule matches and applies, and
by measuring the one non-transitioned property (the search shell, 52 → 44px)
change immediately. The transitioned properties (`max-height`, `opacity`)
advance only when the pane produces a frame, which is the same reason
`requestAnimationFrame` is paused there.

## Gates

Run before the first pass, after every fix, and last:

```
node tools/test-node.mjs      PASS 173  FAIL 0  BROWSER-ONLY 0
node tools/guard-ui.mjs       guard: engine frozen · contract kept · PASS 173  FAIL 0
                                ✓ no violations
python tools/build.py --site  built dist/saahaa.html — 65 modules, 907 KB, 0 lint problem(s)
bash tools/preflight.sh       bundle present · is really the app · everything inlined ·
                              no forbidden secrets · only a public anon key · no dev leftovers ·
                              SPA deep links survive a hard refresh · smoke-dist OK (977 KB DOM,
                              59 controls) · version 8.0.0 OK · 4 migrations, 0 problems
                              === PRE-FLIGHT PASSED — safe to publish ===
```

Every `data-act`, element id and export survived the redesign: the guard
compares the whole UI contract against the snapshot at `../saahaa02` and
reports no violations, so nothing the product *does* moved while every screen
was repainted.

## Lead items (forbidden files — not touched here)

1. **`src/domain/flow.js:72`** — a take-out below the ₹10 minimum is refused
   with the *balance* message. `takeOut(₹5)` on a ₹500 wallet says "You can
   take out up to ₹500", which is true and unhelpful; `account.js` promises
   "Minimum ₹10 either way".

   ```js
   if (amt < 1000 || amt > w.balance) { toast(`You can take out up to ${M.fmt(w.balance)}`, 'warn'); return null; }
   ```

   suggested:

   ```js
   if (amt < 1000) { toast('Minimum take-out is ₹10', 'warn'); return null; }
   if (amt > w.balance) { toast(`You can take out up to ${M.fmt(w.balance)}`, 'warn'); return null; }
   ```

2. **`src/ui/views/pro.js:167` + `src/app.js:257`** — the pro page's primary
   button promises a named pro and opens the category's *best match* instead.
   Verified identical in the v7.1 snapshot (`../saahaa02/src/ui/views/pro.js:165`),
   so this is not redesign drift; it is left alone because changing it changes
   what a booking control does, which this release forbids.

   ```html
   <button class="btn btn-primary btn--lg" data-act="cat.open" data-id="${p.cat}">Book ${esc(first)} · ${esc(cat.name)}</button>
   ```

   `app.js:257` routes `cat.open` to `home.openCategory(d.id)` with no partner,
   so the sheet re-runs `flow.findMatch()`. `book.confirm` already carries
   `data-pid` (`app.js:260`), so either the button becomes
   `book.confirm` + `data-pid` (books that pro directly, as the "Choose your
   pro" list already does) or `openCategory` gains a partner argument. Both
   are money-flow decisions and belong to the lead.

3. **`src/domain/flow.js:708`** — `maskContact` covers 10-digit numbers and
   UPI handles; an e-mail address passes through unmasked. The screens now say
   exactly what is masked, so this is a scope question, not a lie.

4. **`src/domain/autoverify.js`** — carried over from v7.0.0: the tier-3
   "Average rating" line averages every rating the pro holds, while the label
   says "over those jobs". Only visible on the demo roster, where seeded
   ratings exist.

## Known limits (not defects — production items)

- **Three rails complete inside the app instead of against an outside
  system**, and every screen says so: the phone code and the reference's
  4-digit code are shown on screen rather than texted (needs a DLT-registered
  SMS sender); `core/gateway.js` runs in `MODE = 'sim'` — every collect and
  payout is labelled *Sandbox UPI — no real money moves yet* and every ledger
  leg carries `via: 'upi-sim'`; a UPI id is format-checked and saved rather
  than penny-dropped.
- Withdraw fees and Remit GST above ₹5,000, and Fresh start, are step-up
  protected; this run stops at the sheet and verified the refusal path only.
- The 14-day Certified tenure cannot be waited out in a run.
- The ask-rates window is 12 minutes (`domain/bidding.js:218`); both passes
  waited it out rather than shortening it.
- The `?demo=1` market simulation answers ask-rates and accepts retail orders
  so the flows can be walked locally. It runs only under `?demo=1`
  (`SIM_MARKET`) and never on a real device.
- Maps use OpenStreetMap tiles and Nominatim, a free shared geocoder used
  politely. At real volume this needs a self-hosted Nominatim or a paid
  geocoder — a capacity item.
- The preview pane used for this run paints the whole document with no
  scrollport and pauses `requestAnimationFrame` unless a frame is requested,
  so scroll-driven behaviour (the collapsing header) and sheet-open animations
  were verified by state and by the CSSOM rather than by scrolling. Every
  other step went through a real click on a real `data-act` control.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
