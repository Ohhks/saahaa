# SAAHAA — release test report, v8.1.0 "Two doors, one person" (2026-09-09)

Two things changed since the v8.0.0 report: **who an account is** (every
account now carries a code — `C20262001`, `P20262001`, `S20262001` — and one
mobile number may hold one account of each kind), and **how the home header
collapses** (a deliberate 72px gesture past a 220px threshold, with nothing
about it animating layout). Everything else had to still work exactly as the
v8.0.0 report recorded it, so the **whole matrix was walked twice** again: once
on the `?demo=1` roster, once on a store cleared to nothing. Every step was
driven through the real `data-act` controls; `getState()`, `core/audit.js`,
`domain/treasury.js` and `domain/quiz.js` were read only to CONFIRM an
assertion or to know a correct quiz answer — never to set up a step a control
could do.

Every screen was measured at **375 / 840 / 1440 in both light and dark**.
Test accounts created during the run carry throwaway passwords that are not
recorded here; the owner's password was never typed.

**Where the data comes from.** Production boots with an **empty** store —
nothing seeded but the owner's credential — and section A is run exactly that
way, twice. Everything from section C on starts from `?demo=1` on a cleared
browser (customer `9000000001`, pros `91xxxxxxxx`, shop owners `92xxxxxxxx`,
password `123`). Admin screens were opened the way `ui/deckscenes.js` opens
them for the deck capture — by writing the session `core/adminauth.js` itself
writes — because the owner's password is not in the repository. Where a
step-up sheet asks for that password the run verifies the sheet, the refusal
of a wrong password and its audit entry, and marks the rest **owner-only**.

Legend: ✅ pass · 🔧 found and fixed in this release (UI layer, file:line) ·
⚠ lead item / known limit · 🔒 owner-only (step-up gated)

---

## A. Account IDs — the new work, tested hardest

Run on the **empty production boot**, then again in pass 2 on a store cleared
to nothing (`9700000001/2`, second column).

| Check | Result |
|---|---|
| Empty store, sign up a **customer** → **`C20262001`**, announced on its own sheet ("This is what your customer account is called"), stored as `code` **and** as `key` | ✅ / ✅ |
| A **pro** on the SAME number → **`P20262001`**; separate row, separate key, separate password, `partner/add` carries `userKey: P20262001` | ✅ / ✅ |
| A **shop owner** on a third number → **`S20262001`**, `shop.ownerKey: S20262001` | ✅ / ✅ |
| A second account of the **same kind** on a number is refused and names the existing code — "This number already has a customer account (**C20262001**) — sign in instead"; same for pro and shop; user count unchanged (3 → 3) | ✅ / ✅ |
| Sign in **by number** with two accounts opens the chooser: "This number has 2 accounts on it", rows `Customer · Meena Rao / C20262001` and `Pro · Meena Rao / P20262001`, each `data-act="auth.pick"` with its own key | ✅ / ✅ |
| Picking each lands in the right place with the right session — customer → `#/home`, session `code C20262001`; pro → `#/partner`, session `code P20262001` | ✅ / ✅ |
| **The passwords are genuinely separate**: typing the pro's password and then picking the *customer* row is refused "Wrong password" and nothing is signed in | ✅ |
| Sign in **by code**: `P20262069` ✓ · lowercase `c20262001` ✓ · spaced `C 2026 2001` ✓ · trailing space `s20262001 ` ✓ — each lands on that account's own screen | ✅ / ✅ |
| A wrong password on a code is refused; an unknown code → "No account with that ID"; a non-code, non-number → "That is not a 10-digit number or a SAAHAA ID" | ✅ |
| **The gate still holds and a code cannot dodge it**: five wrong passwords against `P20262069` → four "Wrong password", the fifth "Wrong password — locked for 30s". The **number** is then refused "Too many attempts — try again in 29s", and so is the **other code on that number** (`C20262001`, 28s) — the counter is kept against the number, not the string typed | ✅ |
| **The two accounts stay separate.** A customer account was opened on a live pro's number (`9110000000` → `C20262006` beside `P20262069`). As the customer: 1 order (electrical `#X6CVFK`), wallet ₹0, held ₹543. As the pro: 1 job (plumbing `#N6AB3Z`), earnings escrow ₹428, and the electrical order appears nowhere on the pro's side | ✅ |
| The ledger joins on the right party: `PAYMENT_IN 54324 WORLD:funding → CUSTOMER:C20262006` and `ESCROW_IN 54324 CUSTOMER:C20262006 → ESCROW:…`, while the pro's job settles from `CUSTOMER:anoosh kumar\|9000000001` | ✅ *(read)* |
| **Nothing lost to the migration.** On `?demo=1`: 128 users, **0 without a code** (C×5, P×111, S×12, no duplicates), and every internal `key` is still `name\|mobile` — `anoosh kumar\|9000000001` carries `C20262001`, `ramesh k.\|9110000000` carries `P20262069`. Their orders, partner rows and ledger legs all still resolve; a pre-existing account signs in by number and by code | ✅ |
| **My SAAHAA** shows the block: "YOUR CUSTOMER ID / C20262001 / Copy", the sign-in line, and — only when a second account exists — "**You also have a Pro account (P20262069) on this number.** Separate wallet, separate history, separate password…" with a **Switch account** button that opens the sign-in tab | ✅ |
| Copy: the clipboard is refused by the preview pane (the document is never focused), and the **fallback fires exactly as designed** — the code is selected and the toast reads "Select and copy — your browser blocked the clipboard" | ✅ fallback path |
| **Pro console header**: "SAAHAA · PRO / Ramesh K. / PRO ID / P20262069". **Shop console header**: "SAAHAA · SHOP / Sri Lakshmi Kirana / SHOP ID / S20262011" | ✅ |
| **Admin** carries the code everywhere: Flow rows ("Amit Verma · Pro · P20262001"), the unrolled journey heading ("AMIT VERMA · P20262001 — the whole journey"), the Pros table's ID column, and `user.login` audit detail `{key, code, role}` | ✅ |
| **Admin Flow search finds a person by code** — `P20262112` → 1 row; `c2026 2001` (lowercase, spaced) → 1 row; a mobile carrying two accounts (`9110000000`) → **2** rows, the pro and the customer | ✅ |
| The new-ID sheet offered a second account the person **already had**: after opening a pro account on a number that already held a customer account it still said "This number *can also hold* a customer account" | 🔧 `views/auth.js:424` — a new `siblingLine()` names what the number already holds: "This number **also holds** a customer account (**C20262001**) — separate account, separate password, separate wallet and history. They never mix." Verified on both orders of sign-up |
| A store carried over from an older build cannot be produced here (schema v10 arrives with this build), so the backfill was exercised through the seeded roster and `core/selftests.identity.js` rather than against a real v9 store | ⚠ known limit |

## B. The home header's collapse

`docs/design/scroll-probe.html`, run in headless Chrome against the dev
server (`--window-size=900,900 --virtual-time-budget=40000 --dump-dom`), before
and after the fixes in this run — identical both times:

```
RESULT {"topTrace":"0:e y=0",
        "diag":{"scrollY":560,"docH":3286,"iframeH":760,
                "hdrPos":"sticky","cls":"hdr hdr--home hdr--compact"},
        "afterDown":{"compact":true,"flips":1},
        "wobbleFlips":0,
        "afterUp":{"compact":false,
                   "upTrace":["900:C","880:C","860:C","840:C","820:e","800:e",
                              "780:e","760:e","740:e","720:e","700:e"]},
        "atTop":{"compact":false}}
```

**flips 1 · wobbleFlips 0 · afterUp.compact false · atTop.compact false** —
exactly what the header comment asks for.

By hand, in the app itself at 375 (the browser pane used for this run *does*
produce a real scrollport, unlike the v8.0.0 pane, so the collapse was driven
by scrolling rather than by state):

| Check | Result |
|---|---|
| A steady scroll 0 → 900 in 60px steps: **one** flip, at y≈360 — 220px threshold plus the 72px gesture. Trace `0:e 60:e … 300:e 360:C … 900:C` | ✅ |
| Trackpad wobble at depth (900 → 880 → 900 → 885 → 905 → 890 → 900 → 882 → 901): **0 flips**, stays `C` throughout | ✅ |
| **Only the search bar remains when compact**: header 423px → **70px**; `.inner` and `.hdr__fold` measure **0** (`display:none`, not an animated `max-height`); `.hero__search` stays 44px | ✅ |
| It restores on a deliberate way up (`900:C 860:C 820:e …`) and is expanded at the top (header back to 423px) | ✅ |
| **Nothing about it animates layout.** The state is one class and one declaration — `tokens.css:259` `.hdr--home.hdr--compact .inner,.hdr--home.hdr--compact .hdr__fold{display:none}` — with no transition on `max-height`, `padding` or `margin` in either the sheet or the view | ✅ |
| The rules are still written in two places — `tokens.css:259-261` and `home.js:700-704` — but they now say the same thing and neither animates, so they cannot disagree at runtime. The view's copy sets `padding-bottom:8px` where the sheet sets `var(--sp-4)` on both sides | ⚠ observation, cosmetic |

## C. Regression — the customer (`?demo=1`)

| Check | Result |
|---|---|
| Search: typing in the hero field narrows live; the input is replaced on every re-render yet **focus and caret survive** — "fan" → `f\|1 fa\|2 fan\|3`, "plumb" → …`plumb\|5`, "atta" → …`atta\|4`, `document.activeElement` the live input at every keystroke | ✅ |
| Category → booking sheet: sub-service chips, best-match card, the bill read from the dials — ₹428 + "SAAHAA charge · 8% on top, incl. GST" ₹34 = ₹462 | ✅ |
| Paid **from the wallet** after a ₹1,000 top-up: `paidFromWallet 46224`, `collected 0`, strip "₹462 from wallet" | ✅ |
| **Wallet + sandbox split** on the ask-rates award: `customerPays 75537` = `paidFromWallet 53776` + `collected 21761` | ✅ |
| Order tracking: number, counterparty line, stepped timeline with times, the bill, and the **map toggle** — `#orderMap`, 2 markers, tiles, "MAP" ⇄ "HIDE MAP", `aria-pressed` follows | ✅ |
| **Chat** — inline composer and `#/chat/<orderId>`: message sent, appears in the thread, field clears, **caret stays in the field** | ✅ |
| **Masked contact details stay masked**: "Call me on 9876543210 or pay ramesh@okaxis" stored as "Call me on •••••••••• or pay ramesh@•••", `flagged: true`, note "Phone numbers and payment ids hidden" | ✅ |
| The door code (`3333`) is shown to the customer before check-in and **gone** once `otpVerified`; it is never shown to the pro | ✅ |
| WORK_DONE → confirm → `SETTLED`; ledger `ESCROW_RELEASE 42800 → PARTNER:p_plumbing_2`, `FEE 2902 → PLATFORM:fee`, `GST 522 → PLATFORM:gst`; `stake.returned true` | ✅ |
| Rating panel inline on settle; five 44px star buttons with `aria-label` "1 star"…"5 stars"; 5★ → `CLOSED`, review written, pro's ratings +1 | ✅ |
| **Ask-rates end to end**: compose → "Asking 4 workers near you" → the wave at 3 min widened it to 8 → elapsed bar with the marker ("11:16 elapsed · usually done by 4:00", derived from the window, not typed) → sealed quotes | ✅ |
| Window closed at 12:13 → quotes revealed with "Best pick" and a reason per quote ("fair price, best rating, 9 min away", "₹21 cheaper, but rated lower and 22 min away") → Accept ₹770 → order `ASSIGNED` | ✅ |
| **Receipt** sheet: "You asked 3 workers · You pay ₹770 · You saved ₹40 · CoolCare Ravi is booked" | ✅ |
| **Cart → retail order**: substitution policy per line, three delivery modes (the bill re-computes — pickup "Free", shop-delivers ₹19 with the shop keeping ₹285), "SAAHAA's charge of ₹8 (3% of the basket) comes out of the shop's side" — placed, auto-accepted under the sim market | ✅ |
| Shop chain picking → weighed & packed → out for delivery → delivered; customer confirms → **`R_CLOSED`**, "Settled — ₹266 to Sri Lakshmi Kirana" | ✅ |
| Retail legs: `SHOP_PAYOUT 26615`, `FEE 697`, `GST 126`, `RIDER 1400 → RIDER:pool`, `DISPATCH 500 → PLATFORM:fee` | ✅ |
| The **"Not in stock"** path on a 3-line order: the line is re-priced and tagged "similar", toast "Marked: send a similar brand", the order keeps going | ✅ |
| Wallet: chips and typed amounts; ₹5 in refused "Minimum top-up is ₹10"; ₹2,000 out refused "You can take out up to ₹500"; ₹150 out → "₹150 sent to your UPI" | ✅ |
| **Lead item 1 of the v8.0.0 report is fixed in the engine.** A ₹5 take-out on a ₹500 wallet now says "**The smallest take-out is ₹10**", not the balance message (`domain/flow.js:72-73` — the two conditions are separate) | ✅ resolved |
| **Refund lands in the wallet**: cancel before the pro sets out ("More than 2 hours before the slot — full refund") → `REFUND 75537 ESCROW → CUSTOMER`, balance ₹350 → ₹1,105 | ✅ |
| **`#/nearby`**: 41 pins on `#nearbyMap`, tiles, legend; Shops → 12, Pros → 111; "lakshmi" → 5; "zzzznone" → the empty state ("Try a shorter word, or search the box above for a place to move the map"); `aria-pressed` tracks each chip | ✅ |
| `#/nearby` **empty-store** state on the production boot: map, chips and the "New here" list with no rows and no errors | ✅ |

## D. Regression — the working side (`?demo=1`)

| Check | Result |
|---|---|
| **Ladder 1–7** on a brand-new pro (`P20262112`): code sent → wrong code "That code is not right" → right code "Number confirmed"; PAN `ABCDE1234F` → "ID saved — only the last 4 digits kept" (`{type:'pan', last4:'234F'}`); selfie; trade quiz **5/5**; rules quiz **6/6**; UPI — "notavalidupi" refused "A UPI id looks like name@bank", `suresh@okhdfcbank` accepted; agree → **tier 2**, online, "You are live" with the public page, "You paid to get here ₹0", "You keep of every quote 100%" | ✅ |
| The new pro is immediately in the customer's "Choose your pro" list ("Suresh Naik · 4.5 · 0.4 km · ID Verified · Their rate ₹480 · ₹518 you pay") | ✅ |
| **Leads**: the open request appears with the fair price and the clock — "Electrical · Madhapur · 3 pros asked · fair price ₹470 · 11 min" | ✅ |
| **Quote builder**: "Your price ₹470 · **You keep 100% — nothing comes out of it** · SAAHAA's 8%, paid by the customer ₹38 · **The customer pays ₹508**" | ✅ |
| Both figures move with the slider — 450 → keep ₹450 / fee ₹36 / customer ₹486 / chance "strong"; 560 → ₹560 / ₹45 / ₹605 / "weak"; 600 → ₹600 / ₹48 / ₹648. The Send button re-labels with the figure | ✅ |
| Bid sent → "Your price of 470 is in. You will know shortly.", appears under "Your sealed rates · Waiting" | ✅ |
| **Job chain**: ASSIGNED → EN_ROUTE (job map, both pins, "YOU · MADHAPUR" on the pro's own) → ARRIVED → wrong code "Wrong code" → `3333` "Verified — work started" → *finish absent before the photo, present after* → WORK_DONE "Done — instant on confirm" | ✅ |
| **Stake locked at check-in**: `{need:10000, funded:0, onCredit:10000, lockedAt}` *(read)*, and the panel says so | ✅ |
| **Stake returned at settlement**: `{… returned:true, returnedAt}`; Earnings shows LOCKED ₹0 | ✅ |
| **Earnings**: "September · you kept ₹428 from ₹428 quoted"; Released ₹428 / In escrow ₹0 / Sent ₹0; wallet Available ₹385, Pending ₹43 (7-day holdback), Released ₹428 lifetime; "Kept equals quoted on every line"; stake copy reads the dials (₹100 / 5% / ₹500) | ✅ |
| The pro's screens are in the pro's voice throughout: "**The customer pays** ₹462", "held until **the customer** confirms", "**You keep** the whole ₹428", no customer-savings line — the v8.0.0 fixes hold | ✅ |
| **Standing**: ladder 7/7, jobs 0/3, rating 0.0/4.3, disputes 0/0, vouches 0/2, reference "not yet", "2 / 6 green" — every line from the dials | ✅ |
| Reference: saved → "Send your reference their code" → on-screen sandbox code → wrong code "That code is not right" + `audit verify.refCodeWrong` → right code "Reference confirmed." (`verify.refConfirmed`) | ✅ |
| Vouches: the customer whose job settled vouches ("Thank you — your vouch counts.", `audit verify.vouch`), the button disappears, "You have already vouched for this pro.", **singular "1 vouch"** | ✅ |
| A tier-2 same-trade pro is refused — "Only a Background-Checked pro in the same trade can vouch as a pro."; a tier-3 same-trade pro (Amit Verma, `P20262001`) vouches → **"2 vouches"** | ✅ |
| Automatic promotion could not be driven to completion in this run: the new pro needs three settled jobs and the seeded tier-3 pros already hold their tier. The path itself is exercised by `core/selftests.auto.js` (green in the 188) and the Automation dials below | ⚠ known limit |
| The working side wears the ink strip; the pro console has no theme toggle of its own (it is a home-header control) — theme was flipped from `#/account` for the dark sweep | ✅ / observation |

## E. Regression — the shop (`?demo=1`)

| Check | Result |
|---|---|
| **Today**: "SALES TODAY ₹274 · 1 order", "FEES TODAY (3%) ₹8 · capped ₹25 an order" (both from `getPricing()`), "ORDERS NEEDING YOU 1 open", "WANTS ATTENTION 5" with restock rows, "ADD WITHOUT TYPING" | ✅ |
| **Listings**: Products / Inventory / Pricing sub-tabs; "Pick from the ready list" → **Add** → "HMT Rice 26kg bag listed", products 278 → 279, the picker drops it (9 → 8 items) | ✅ |
| Order chain from the shop: R_ACCEPTED → picking → weighed & packed → out for delivery → delivered; the "Not in stock" path re-prices the line and marks it "similar" | ✅ |
| **Money & fees**: Orders / "SAAHAA fee · 3%, capped ₹25" / Rider fees / Listing fee / Yearly plan / Yours, "what an aggregator would have taken … at 25%", "SAAHAA takes 3% because a kirana's own margin on staples is only 3–6%", shop wallet, settled-orders history | ✅ |
| Ten shop screens (Today, Analytics, Shop profile, Products, Inventory, Pricing, Orders, Customers, Money, Payouts) at all three widths, both themes | ✅ |

## F. Regression — admin (session written as `deckscenes.js` does; no password used)

| Check | Result |
|---|---|
| Console opens; header reads "**v8.1.0 'Two doors, one person' · schema v10 · 20260909a**"; eight sections, no bootstrap or demo copy | ✅ |
| **Charges**: service % 8 → 10, Push → "Pushed — every new quote uses these", the worked example recomputes ("₹1,000 job: the customer pays ₹1,100 — pro keeps ₹1,000, our fee ₹85, GST ₹15 (markup 10%)") | ✅ |
| A **new** booking is priced at the new rate (₹428 → **₹471**, "SAAHAA charge · 10% on top") while the **already-booked** order keeps its own (`deal 50300`, `platformFee 3410`, `customerPays 54324` — 8%) *(read)*. Reset → 8% | ✅ |
| **Flow**: 60 rows, role filter, code/mobile/name search (above), tap unrolls the whole journey — vertical at 375, no overflow | ✅ |
| The unrolled journey's footer printed a placeholder plural — "2 event(s), newest first." | 🔧 `views/admin.js:961` — `${evs.length === 1 ? 'event' : 'events'}`. A sweep of `src/ui/**` found no other `(s)` / `(es)` placeholder |
| **Treasury**: "Books reconcile" / "Balanced"; aggregate escrow ₹543 = ledger replay ₹543, **Difference ₹0**; Money in ₹2,404 = liabilities ₹2,357 + ours ₹41 + GST ₹6 | ✅ |
| Withdraw ₹1,000 refused "Only ₹41 is ours to withdraw"; ₹0.50 refused "Minimum ₹1"; ₹40.99 → "Withdrew ₹41 to the company bank", `audit treasury.withdraw` | ✅ |
| Remit ₹50 refused "Only ₹6 of GST is held"; ₹6.48 → "Remitted ₹6 of GST", `audit treasury.remitGst`; books still reconcile, "GST REMITTED SO FAR ₹6" | ✅ |
| **Automation**: `certDays` 400 → "certDays: must be between 0 and 365", nothing pushed; the switch off → Push → "Pushed — automation is off, tiers 3 and 4 wait for you", pill "switched off", `audit automation.push`; back on; Reset → 3 jobs / 4.3 / 2 vouches / reference / 14 days | ✅ |
| **Payments rail** card: "sandbox" pill, Sandbox ⇄ Razorpay mode (`payMode` = `sim`/`razorpay`), key-id and Edge-Functions URL fields, "Save on this device" / "Back to sandbox", and the fails-closed note | ✅ |
| **System & audit**: health **10/10** (including `schema v10 vs app v10`), self-test card → **188 passed · 0 failed** in 103ms, 14 feature flags, registry (24 categories / 19 reducers / 35 order stages), "Take snapshot" → "Snapshot saved", Export JSON, change password | ✅ |
| **Fresh start**: wrong word → "Type FRESH in the box to confirm", no sheet; "FRESH" → step-up "Confirm it is you … Re-type the owner password"; wrong password → "That password is not right", field cleared, `audit admin.login.fail`, **nothing wiped** (130 users before and after) | ✅ then 🔒 |
| All eight sections at 375 / 840 / 1440, light and dark | ✅ |

## G. Empty-boot behaviour, re-confirmed

| Check | Result |
|---|---|
| `?demo=1` on a cleared browser: 128 users, 111 pros, 12 shops, 273–278 products | ✅ |
| Next boot **without** `?demo`: 0 users / pros / shops / products; audit `data.demoPurged` by actor `system` with `{users:128, partners:111, shops:12, products:278, total:529, kept:"admin, settings"}`; `admin.hash` and `settings` intact | ✅ |
| The purge takes **everything** on a demo store, including accounts created by hand while that store was loaded — the whole roster is demo residue by definition. Worth knowing before a demo session: sign-ups made under `?demo=1` do not survive the next plain boot | ⚠ documented behaviour |
| Real accounts created on an empty production store survive reloads, and the purge does not fire again on them | ✅ |
| `?demo=1` on a store that already holds accounts does not seed over them (`seeded` is set) — by design; a cleared browser is needed | ⚠ documented |

## H. Cross-cutting

| Check | Result |
|---|---|
| **No horizontal overflow anywhere.** `document.scrollWidth === clientWidth` on every route, every console tab and every admin section, in both themes: **375 → 375 / 375**, **840 → 825 / 825** (840/840 on the full-bleed auth, disputes, escrow and moderation screens), **1440 → 1425 / 1425** (1440/1440 on the same full-bleed ones). Nothing extends past the viewport except the deliberate horizontal scrollers, which clip and scroll inside their own box | ✅ |
| **Console.** No error other than the known `version.json` 404 from `core/update.js` on a static server and the OpenStreetMap tile 404s this offline pane produces. No uncaught exception, no `TypeError`, in either pass (394 console errors inspected — every one a 404) | ✅ |
| **No emoji in rendered text** on any screen, at any width, in either theme (`\p{Extended_Pictographic}` walk of every text node): the only hit is Leaflet's own "©" in the map attribution. The category records carry emoji in `cat.ico`, but nothing in `src/ui/**` renders that field | ✅ |
| **aria-labels on every icon-only button** on every screen in both sweeps — the scan found none missing, and the static scan of `src/ui/views/*.js` shows every `<button>${icon(…)}</button>` carries one | ✅ |
| The home header's two icon buttons measured **38 × 44** — `.btn--ghost` sets `padding-inline` but no minimum width, so every ghost icon button in the shell was under 44px wide at all three widths | 🔧 `tokens.css:283` — `min-width:44px` on `.btn--ghost,.btn-ghost`. Also fixes the back buttons in `ask.js:138` and `shops.js:119`, which set `padding-inline:6px` |
| The auth screen's legal row (`Terms · Privacy · Refunds · Contact · About`) measured 32–42px wide | 🔧 `views/auth.js:86` — `.au__links a` is now a 44 × 44 inline-flex target |
| The page-footer legal row (`home.js:661`, `account.js:358`, `legal.js:295`) measured **11px tall** | 🔧 `tokens.css:199` — `p.micro > a.micro{padding-block:17px}`. Block padding on an *inline* box grows the hit area to **45px** without touching the line box, so the type and the layout are unmoved. Width stays the width of the word — these are links inside a sentence, the WCAG inline-link exception |
| The "Skip to content" link was 123 × 39 | 🔧 `tokens.css:136` — 44px minimum, inline-flex |
| After those four fixes, the only controls still measuring under 44px anywhere are: the search `<input>` inside its own 44px shell (42px = 44 minus the 1px borders; the shell is the target, and this is the state the v8.0.0 fix left it in), and two checkboxes whose `<label>` is the real target — the Automation switch (22px glyph inside a **318 × 60** `label.ad-check`) and the ladder's consent box | ✅ with two documented exceptions |
| **A closed sheet still does not swallow clicks**: after opening and closing one, the 510 × 759 `.sheet` computes `visibility:hidden; pointer-events:none` and `elementFromPoint` at the viewport centre returns the page beneath, not the sheet. A dismissed toast is `pointer-events:none` | ✅ |
| Light ground `rgb(243,242,242)` / dark ground `rgb(32,30,29)` measured on every route at all three widths; `font-family` resolves to **Archivo** everywhere | ✅ |
| Login gate: signed out, Orders says "Sign in to see orders". Lockout as in section A | ✅ |
| **No hard-coded fee percentage anywhere.** Every `%` in a rendered string traces to `liveMarkup()` / `getPricing()` / `GST_RATE` / `AGG_COMMISSION` / `cat.takePct`, or to the order's own `platformFee / deal`. The literals left in the tree are: comments (`partner.js:14-15`, `pro.js:17`, `earn.js:16`, `admin.js:1186`); statements about *other* companies (`legal.js:257,259` — "apps … take 20–30%", "quick-commerce apps take 25%", "her margin is 3–6%"); the shop's own fill-rate badge threshold (`partner.js:817` — "stay above 85%"); and "100%", which is an invariant of the economics, not a rate. The one product number typed in a view is the admin's **"Partial 60%"** dispute split (`admin.js:741,799`, `data-pct="0.6"`) — the label and the value are the same literal, so it cannot lie, and no dial owns it | ✅ |

## Gates

Run before the first pass, after every fix, and last:

```
node tools/test-node.mjs      PASS 188  FAIL 0  BROWSER-ONLY 0
node tools/guard-ui.mjs       guard: engine frozen · contract kept · PASS 188  FAIL 0
                                ✓ no violations
python tools/build.py --site  built dist/saahaa.html — 67 modules, 938 KB, 0 lint problem(s)
bash tools/preflight.sh       bundle present (996,659 bytes) · is really the app · everything inlined ·
                              no forbidden secrets · only a public anon key · no dev leftovers ·
                              SPA deep links survive a hard refresh · smoke-dist OK (1009 KB DOM,
                              59 controls) · version 8.1.0 OK · 4 migrations, 0 problems
                              === PRE-FLIGHT PASSED — safe to publish ===
```

Every `data-act`, element id and export survived the identity work and the
guardian's fixes: the guard compares the whole UI contract against the
snapshot at `../saahaa02` and reports no violations.

## Lead items (forbidden files — not touched here)

1. **`src/ui/views/pro.js:167` + `src/app.js:257`** — carried over from v8.0.0.
   The pro page's primary button promises a named pro and opens the category's
   *best match* instead.

   ```html
   <button class="btn btn-primary btn--lg" data-act="cat.open" data-id="${p.cat}">Book ${esc(first)} · ${esc(cat.name)}</button>
   ```

   `app.js:257` routes `cat.open` to `home.openCategory(d.id)` with no partner,
   so the sheet re-runs `flow.findMatch()`. `book.confirm` already carries
   `data-pid` (`app.js:260`), so either the button becomes `book.confirm` +
   `data-pid` or `openCategory` gains a partner argument. Both are money-flow
   decisions and belong to the lead.

2. **`src/domain/flow.js:708`** — `maskContact` covers 10-digit numbers and
   UPI handles; an e-mail address passes through unmasked. The screens say
   exactly what is masked, so this is a scope question, not a lie.

3. **`src/domain/autoverify.js`** — carried over from v7.0.0: the tier-3
   "Average rating" line averages every rating the pro holds, while the label
   says "over those jobs". Only visible on the demo roster.

4. **`src/domain/fresh.js`** — the demo purge is all-or-nothing on a store that
   was ever seeded, so an account signed up by hand during a `?demo=1` session
   is wiped by the next plain boot along with the roster. Correct for a demo
   device and wrong for nobody today; worth a line in the console's "demo
   residue" copy if the owner ever demos and then registers on the same phone.

*(v8.0.0's lead item 1 — the take-out minimum message in `domain/flow.js:72` —
is fixed in this release and re-verified above.)*

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
- The 14-day Certified tenure cannot be waited out in a run, and automatic
  tier-3 promotion needs three settled jobs on one new pro — exercised by
  `core/selftests.auto.js` rather than by hand this time.
- The ask-rates window is 12 minutes (`domain/bidding.js:218`); both passes
  waited it out rather than shortening it (12:13 to close, one wave at 3 min).
- `askOffer()` hides the "Send to the circle" row when the locked match is
  already at or below what an ask would produce ("Your price is already the
  best rate here"), so the entry row is not on every category on every store.
  That is the engine's judgement, not a missing control.
- The `?demo=1` market simulation answers ask-rates and accepts retail orders
  so the flows can be walked locally. It runs only under `?demo=1`
  (`SIM_MARKET`) and never on a real device.
- The Clipboard API refuses to write while the preview pane is unfocused, so
  the ID **Copy** button was verified on its fallback path (select + explain)
  rather than on the clipboard write itself.
- Maps use OpenStreetMap tiles and Nominatim, a free shared geocoder used
  politely; the tiles 404 in this offline pane. At real volume this needs a
  self-hosted Nominatim or a paid geocoder — a capacity item.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
