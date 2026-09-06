# SAAHAA — release test report, v6.9.0 "Nothing borrowed" (2026-09-06)

Scripted end-to-end runs against the **real UI** (every step a `data-act`
control, not a domain call), phone viewport 375×812 with desktop passes at
840 and 1440, console errors captured. Where a domain API was used to *read*
state for an assertion (an order's paise, a quiz bank's answer index) it is
marked *(read)*; every action went through the screen.

**Where the data comes from.** Production boots with an **empty** store —
nothing is seeded but the owner's credential — and section 1 is run exactly
that way, on a cleared browser. Everything from section 3 on starts from
`?demo=1`, the local switch that loads the example roster (customer
`9000000001`, pro `9110000000`, shop owner `9200000001`, password `123`) and
switches the market simulation on for that page load only. Admin screens were
opened the way `ui/deckscenes.js` opens them for the deck capture — by
writing the session `core/adminauth.js` itself writes — because the owner's
password is not in the repository and was not typed anywhere.

Legend: ✅ pass · 🔧 found and fixed in this release · ⚠ known limit / lead item

## 1. Empty production boot (no `?demo`)

| Check | Result |
|---|---|
| Console: `seeded 0 shops, 0 products`; no example users, pros, shops or products in state | ✅ |
| Home renders every category as "New here — be first", every shop group "0 open now" | ✅ |
| No "demo", "example", "sample", "prototype" copy anywhere on home / auth / shops / earn / admin | ✅ |
| Sign-in is **mobile + password** only — `lgMobile`, `lgPass`, no name field | ✅ |
| Sign-up asks name + mobile + password + place (search, "use my location", map pin, area chips) | ✅ |
| No horizontal overflow at 375 | ✅ |

## 2. Account and the security gate

| Check | Result |
|---|---|
| Weak password refused with the reason ("Add letters, not only digits.") | ✅ |
| Place by search: Nominatim answers, "Madhapur, Hyderabad" chip; graceful "Search is unavailable right now — drop the pin instead" path exists for a blocked network | ✅ |
| Place by dropped pin: reverse-geocoded to a named place; `loc {lat,lng,label}` and `area` both stored | ✅ |
| Account created and signed in; sign out; sign in again with mobile + password | ✅ |
| Wrong password refused ("Wrong password") | ✅ |
| Fifth failure locks ("Wrong password — locked for 30s"); sixth and seventh are gated ("Too many attempts — try again in 30s"); gate persisted per number | ✅ |
| Session survives reload | ✅ |
| Partner-signup copy read the frozen 8% constant instead of the live Charges value | 🔧 `auth.js` → `liveMarkup()` |

## 3. Customer (`?demo=1`)

| Check | Result |
|---|---|
| Home header collapses on scroll to the search bar alone and restores on scroll up — measured 494 → 96 → 494 px at 375, 446 → 128 → 446 px at 1440 (only the 48 px search bar visible when compact) | ✅ |
| Category sheet: sub-services, best match, price locked, "you pay" | ✅ |
| Booking price = deal × (1 + service %): ₹428 → ₹462 at 8%, ₹471 at 10% after a push | ✅ |
| Order screen: status hero, timeline, code capsule, **Map** toggle (`order.map`, `aria-pressed`) | ✅ |
| Map card renders two pins and a dashed line when both sides have coordinates | ✅ |
| Timeline dots showed the registry's emoji (📸 💰) | 🔧 step numbers |
| Home / search / shops chips showed emoji (🔧 ⚡ 🚿 🧹 🛒 …) | 🔧 SVG icons from `icons.js` |
| Ask-rates "less than held" figures used the frozen 8% | 🔧 `ask.js` → `liveMarkup()` |
| Earn pitch copy used the frozen 8% | 🔧 `earn.js` → `liveMarkup()` |

## 4. Partner (`?demo=1`)

| Check | Result |
|---|---|
| New partner signup lands on ladder step 1; steps 1–7 complete through the screen: code → ID (last 4 kept) → photo → trade quiz 5/5 → conduct quiz 6/6 → UPI → agree → tier 2, online, page live | ✅ |
| Job chain: MATCHING → EN_ROUTE → ARRIVED → OTP ("Verified — work started") → photo → WORK_DONE; finish absent before evidence | ✅ |
| The pro's job panel shows the tracking map (`#jobMap`) at EN_ROUTE and ARRIVED | ✅ |
| Stake ₹100 locked at the code (first job on credit, second job funded from Available); returned at settlement — wallet Locked ₹0, Released ₹428, Pending ₹43 | ✅ |
| Customer dispute at WORK_DONE → DISPUTED, money frozen | ✅ |
| Shop setup line showed the category emoji | 🔧 `partner.js` |

## 5. Shop owner (`?demo=1`)

| Check | Result |
|---|---|
| Nine tabs: orders, catalog, stock, pricing, money, customers, payouts, analytics, setup | ✅ |
| Catalog → ready-list picker adds an item (39 → 40, "Toor Dal 1kg listed") | ✅ |
| Customer cart (rider / self / pickup control) → place → R_PLACED (auto-accepted under the demo market) | ✅ |
| Order chain packing → packed → out → delivered → customer confirms → R_SETTLED → R_CLOSED | ✅ |
| Retail category cards and chips showed emoji | 🔧 `shops.js` |

## 6. Admin (session written as `deckscenes.js` does; no password used)

| Check | Result |
|---|---|
| Console opens; eight sections; no bootstrap/demo copy | ✅ |
| **Charges**: service % 8 → 10, Push ("Pushed — every new quote uses these"), worked example redraws (₹1,000 → ₹1,100) | ✅ |
| A NEW booking after the push pays 10% (₹471); the order booked BEFORE it keeps 8% (₹462, SETTLED, untouched) | ✅ |
| Reset to defaults → 8%; Earn and signup copy follow the live value both ways | ✅ |
| **Flow tracker** (Users & partners): 60 rows, role filter, tap unrolls the journey (audit + order history) | ✅ |
| Flow rows did not say who holds an in-flight order, the money on it, or what it waits for | 🔧 "Held by … · ₹ on this order · waiting for … → next" |
| Live map `#adminMap`: 126 pins (orders in flight, pros online, shops) via Refresh | ✅ |
| Approvals: Certified candidate → tier 4 | ✅ |
| Disputes: Partial 60% → PARTIAL ("Partial — ₹188 refunded"), open list empties | ✅ |
| Payout queue → Mark paid clears the row (2 → 1) | ✅ |
| Kill switch RETAIL on → off → on | ✅ |
| Ledger replay vs aggregate escrow: **Difference ₹5** after a free-delivery rider order | ⚠ lead — see below |

## 7. Cross-cutting

| Check | Result |
|---|---|
| Console: only the known `version.json` 404 from `core/update.js` on a static server | ✅ |
| Stale map handle threw `TypeError … _leaflet_pos` (map.js `invalidate` timer after `destroy`) | 🔧 `map.js` dead-guard |
| No horizontal overflow at 375 / 840 / 1440 | ✅ |
| Light theme paints an explicit ground (rgb 248,245,254); dark parity (rgb 21,10,46); toggle both ways | ✅ |
| Icon-only buttons carry aria-labels on every screen (home, orders, order, shops, cart, earn, account, auth, onboard, partner, all nine shop tabs, all eight admin sections) | ✅ |
| No emoji in rendered UI text on any of those screens (★ rating glyphs are text, not emoji) | ✅ after 🔧 |
| `node tools/test-node.mjs` PASS 149 FAIL 0; `python tools/build.py --site` 0 lint problems | ✅ |
| `node tools/guard-ui.mjs`: contract kept; **engine TOUCHED** — `src/core/config.js` and `src/core/selftests.security.js` differ from the `../saahaa02` snapshot (deliberate release changes; snapshot refresh is the lead's) | ⚠ lead |

## Lead items (forbidden files — not touched here)

- **`src/domain/flow.js:509`** — on a free-delivery rider order `deliveryFee`
  is 0 but the quote still carved the ₹5 dispatch cut out of the ride the shop
  absorbed, so `max(0, deliveryFee − riderPayout)` posts nothing and ₹5 stays in
  `ESCROW:<order>` (Finance shows Difference ₹5). The cut is the residual no
  other leg claims:
  `const dispatchCut = Math.max(0, (o.customerPays | 0) - (o.shopPayout | 0) - (o.platformFee | 0) - (o.riderPayout | 0));`
- **`src/core/version.js:5`** — `CODENAME` still reads "Skin in the game" and
  `RELEASED` 2026-09-01; the admin header prints them.
- **Engine snapshot** — refresh `../saahaa02` for `core/config.js` (persist.js
  instead of localStorage) and `core/selftests.security.js` once shipped.

## Known limits (not defects — production items)

- **Three steps complete inside the app instead of against an outside system**,
  and nothing in the product claims otherwise: the phone code is generated and
  shown on the partner's own screen rather than texted (needs a DLT-registered
  SMS sender); a UPI id is format-checked and saved rather than penny-dropped
  (needs the payment gateway); a wallet top-up credits the stake balance
  directly rather than collecting over UPI. See `docs/PRODUCTION.md` and
  `docs/LAUNCH.md` § *Three rails still to wire*.
- ID name-match / liveness and police verification are owner-run checks that
  land in Approvals; the app records the decision, it does not make it.
- The 90-second substitution timer runs while the app is open; in production
  it is a `pg_cron` job (`supabase/migrations/0003_automation.sql`).
- The `?demo=1` market simulation answers ask-rates and accepts retail orders
  so the flows can be walked locally. It runs only under `?demo=1`
  (`SIM_MARKET`) and never on a real device.
- Maps use OpenStreetMap tiles and Nominatim, a free shared geocoder used
  politely (one request per user action, never per keystroke). At real volume
  this needs a self-hosted Nominatim or a paid geocoder — a capacity item.
- The admin live map and the order maps paint on `requestAnimationFrame` /
  a short timer after render; a hidden or headless tab defers them, which is
  why the deck capture and this run used the **Refresh** control to assert
  pins. On a visible phone they paint on their own.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
