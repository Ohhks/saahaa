# SAAHAA — release test report, v8.2.0 "A shop with a face" (2026-09-09)

Three things changed since the v8.1.0 report: **the home scroll lurch is fixed
properly** (the header is ordinary flow content now and a fixed `.pinbar`
carries the search field), **pictures exist** (shops, products, pro portraits,
pro work galleries, job evidence — stored outside the state blob by
`core/photos.js`, shrunk by `ui/photo.js`), and **anyone can open a shop** in
one of the eight retail categories, on the number they already use. Everything
else had to still work exactly as the v8.1.0 report recorded it, so the **whole
matrix was walked twice** again: once on the `?demo=1` roster, once on a store
cleared to nothing. Every step was driven through the real `data-act` controls;
`getState()`, `core/audit.js`, `domain/trust.js` and `domain/verification.js`
were read only to CONFIRM an assertion or to know a correct quiz answer.

A file input cannot be driven by script, so the picture work was driven the way
a finger drives it: a synthetic JPEG is built in a canvas, and a
`MutationObserver` hands it to the `<input type=file>` that `ui/photo.js`
creates, through a `DataTransfer`. Every picture in this report therefore went
through the **real** `chooseFile → decode → canvas → toDataURL → photos.put`
path, not around it. `shrinkAndStore()` was also exercised directly.

Every screen was measured at **375 / 840 / 1440 in both light and dark**.
Test accounts created during the run carry throwaway passwords that are not
recorded here; the owner's password was never typed.

**Where the data comes from.** Production boots with an **empty** store, and
pass 2 is run exactly that way. Pass 1 starts from `?demo=1` on a cleared
browser (customer `9000000001`, pros `91xxxxxxxx`, shop owners `92xxxxxxxx`,
password `123`). Admin screens were opened the way `ui/deckscenes.js` opens
them — by writing the session `core/adminauth.js` itself writes — because the
owner's password is not in the repository. Where a step-up sheet asks for that
password the run verifies the sheet, the refusal of a wrong password and its
audit entry, and marks the rest **owner-only**.

Legend: ✅ pass · 🔧 found and fixed in this release (UI layer, file:line) ·
⛔ found and BLOCKED (the fix is in a file the guardian may not touch) ·
⚠ lead item / known limit · 🔒 owner-only (step-up gated)

---

## ⛔ Read this first — one button destroys every picture on the device

**Admin → System & audit → "Run 198 tests" deletes every photograph the device
holds**, and writes a false wipe record into the owner's audit log. Reproduced
from a clean state: store one picture, press the button, the picture is gone
(`usage()` 1 → 0, `has(id)` false), while the tests report 198 passed. It is
not a display problem — the bytes and the index are removed, and the shop,
product, partner and order records are left pointing at ids that no longer
resolve.

Two independent causes, both in files the guardian may not edit:

```js
// src/core/selftests.photos.js:16 — runs against the REAL localStorage
const clear = () => { P.gc([]); };
```

`clear()` is called at the top of nine tests. `photos.gc([])` means "keep
nothing", so every shop front, product picture, portrait, work photo and piece
of job evidence on that phone is removed.

```js
// src/core/selftests.auto.js:35 — a fixture, but the side effects are real
const out = F.purgeIfDemoResidue(st, false);
```

`domain/fresh.js:61-67` records `data.demoPurged` to the device's audit log and
calls `photos.gc([])` before returning. The fixture's fresh state is discarded,
so the roster survives — but the audit log gains a wipe that never happened
(seen twice in this run, `{users:1, partners:1, shops:1, products:1, total:4}`)
and the picture store is emptied a second time.

The shape of a fix is the lead's call. The suite needs to run against a photo
store that is not the device's — either a test-scoped key prefix in
`core/photos.js`, or a stash-and-restore of `SAAHAA_PHOTOS` and every
`SAAHAA_PHOTO_*` key around the suite — and the purge test needs a
`purgeIfDemoResidue` that can be asked not to audit or to sweep.

**The graceful half is genuinely good, and this run proved it by accident.**
With the pictures gone, no screen showed a broken image at any width: every
box fell back to its drawn placeholder, `#/pro/<id>` dropped the WORK section
rather than leaving an empty frame, and no layout moved. That is exactly what
`photo.url()` returning `''` is supposed to buy.

## A. The home scroll lurch

`docs/design/scroll-probe.html`, in headless Chrome against the dev server
(`--window-size=900,900 --virtual-time-budget=40000 --dump-dom`), run before
the guardian's fixes and again after — identical both times:

```
RESULT {"documentHeightsSeen":[3625],
        "documentHeightConstant":true,
        "contentMovedInDocumentPx":0,
        "pinFlipsOnTheWayDown":1,
        "wobbleFlips":0,
        "pinHiddenAtTop":true,
        "headerPosition":"relative",
        "pinPosition":"fixed"}
```

**documentHeightConstant true · contentMovedInDocumentPx 0 ·
pinFlipsOnTheWayDown 1 · wobbleFlips 0 · pinHiddenAtTop true** — exactly what
the header comment asks for.

By hand at 375, on the demo roster (first column) and on the empty production
boot (second):

| Check | Result |
|---|---|
| Steady scroll 0 → 1500 in 50px steps: document height **one value throughout** (3785 / 3168), and the twelve probe elements move **0px** in document space | ✅ / ✅ |
| **One** pin flip on the way down, at y≈450 — the header measures 423px and the bar appears once it has gone | ✅ / ✅ |
| Trackpad wobble at depth (900 → 880 → 900 → 885 → 905 → 890 → 900 → 882 → 901): **0 flips** | ✅ / ✅ |
| One flip back on a deliberate way up, and the bar is **gone at the top** | ✅ / ✅ |
| The header is `position:relative` (ordinary flow content) and `.pinbar` is `position:fixed`. The bar's only transition is `transform .18s, opacity .16s, visibility` — nothing that can move layout | ✅ |
| **The pinned bar's input really searches.** Typing "plumb" into `#qPin` at y=900 narrows live and paints "Results for “plumb”"; the hero field `#q` stays in step | ✅ / ✅ |
| **It keeps focus and caret while typing** — the input is replaced on every re-render, yet `document.activeElement` is the live `#qPin` and `selectionStart` is 1,2,3,4,5 at each keystroke | ✅ / ✅ |
| The hero field behaves the same: "fan" → 20/5/1 rows, "atta" → 3 shop-shelf rows, "plumb" → 1, focus never lost | ✅ |

## B. Pictures

Budget: **`MAX_ONE` 92,160 bytes (90KB) · `MAX_TOTAL` 3,145,728 bytes (3MB)**.

| Check | Result |
|---|---|
| `shrinkAndStore()` exercised directly with synthetic `File`s: 4000×3000 (290KB) → **40KB**, 1600×1200 (157KB) → **67KB**, 320×240 (19KB) → **15KB**, 6000×1000 (233KB) → **22KB** — every one under the 90KB ceiling and a valid `data:image/jpeg;base64,…` | ✅ |
| A `text/plain` file → "That file is not a picture". An **SVG** declared `image/svg+xml` decodes and is re-encoded as JPEG, so what is stored is `data:image/jpeg;base64,…` — the script it carried cannot survive a canvas | ✅ |
| A picture **just over** the one-file ceiling is refused: "That picture is 90KB — the limit is 90KB" | ✅ ⚠ *(rounding makes both numbers read 90KB — `core/photos.js:64`, cosmetic, owner's file)* |
| **A shop front**, added through `data-act="photo.shop"` on the signup screen, on onboarding's "you're live" and in the console's Shop profile tab. Stored 64–75KB, drawn at a fixed **72×72** (console) and **375×150** (storefront hero) | ✅ / ✅ |
| **A product**, through `photo.product` from the catalog row and from the "just added" strip. Thumb fixed at **52×52**; the catalog row measures **158px with a picture and 158px without** | ✅ / ✅ |
| **A pro portrait**, through `photo.pro` on My page. Container 150px before and after; the button re-labels "Add your photo" → "Change photo" | ✅ / ✅ |
| **A pro work gallery**: eight added through `photo.work`, every tile a fixed **150×112**, the images **148×110** inside them | ✅ / ✅ |
| **The cap holds** (`flow.MAX_WORK_PHOTOS` = 8): at eight the Add tile disappears and the caption reads "Your page holds 8 photos. Remove one to add another." | ✅ / ✅ |
| **Removal frees the bytes**: `photo.workdrop` → 13 pictures / 844,791 B → 12 / 773,128 B, the id no longer resolves, the Add tile returns, tiles still 150×112. The remove control is **44×44** with `aria-label="Remove photo 1"` | ✅ / ✅ |
| **Job evidence**, through `photo.evidence` with `data-label` Before / After. Tiles **110×112**; "Mark work finished" is **absent before the photograph and present after** it; the customer sees the same pictures on their own order | ✅ / ✅ |
| **Replacing frees the old one**: re-photographing a shop front went 67,379 B → 75,159 B with the **count staying at 1**, and the replaced id stopped resolving | ✅ |
| **Taking one back off frees it**: `photo.drop` (kind product) 174,857 B / 3 → 120,818 B / 2; the row height did not change | ✅ |
| **The budget refuses politely and destroys nothing.** Filled to **3,095,533 of 3,145,728 bytes (98%, 49KB free)**, then a real photograph through `photo.work`: toast **"Pictures are full on this device — remove one before adding another"**, every existing picture still resolves, no record changed | ✅ / ✅ |
| The console says the same thing in its own words: "PICTURES ON THIS PHONE · 37 pictures · 2.9 MB of 3.0 MB used · Nearly full — about 0 more will fit. Replace a picture instead of adding one" | ✅ |
| **Orphans are reclaimed at boot, live pictures are not.** 39 stored → **14** after a reload, and all 14 still referenced by the state resolve. On the demo store: 37 → 5, nothing live lost | ✅ / ✅ |
| **A wipe takes the pictures with it.** `?demo=1` seeded 128 users / 111 pros / 12 shops / 275 products and one shop photograph; the next plain boot left **0 / 0 / 0 / 0 and 0 pictures**, `admin.hash` and `settings` intact, `data.demoPurged` recorded by `system` with `{users:128, partners:111, shops:12, products:275, total:526}` | ✅ |
| **No `<img src>` anywhere comes from anything but `photo.url()`.** Every route, both themes, all three widths: the only non-`data:image/` sources in the whole app are the OpenStreetMap tiles Leaflet fetches. `performance.getEntriesByType('resource')` shows exactly two origins for the entire session: the dev server and `tile.openstreetmap.org` | ✅ |
| **No broken image anywhere**, with pictures present and (after the self-test wiped them) with every id dangling | ✅ |
| **The picture box was sized in CSS but the picture was not.** `.m-img` is `width:100%;height:100%;object-fit:cover` inside a `display:grid;place-items:center` box — and a *centred* grid item is sized by its content, so the percentage had nothing definite to resolve against. A 1:1 product shot rendered **153px tall inside a 78px box** and a shop front **235px inside 150px**; `overflow:hidden` kept the row honest, so nothing moved, but `object-fit:cover` never ran and every photograph was cropped **from the top**, shop fronts losing their bottom 85px | 🔧 `views/shops.js:83` — `.m-img` gains `place-self:stretch;min-width:0;min-height:0`. Measured after: front 375×148 in a 375×150 box, product 153×76 in 155×78, card heights unchanged (226/226/193/193) |
| **The home list had no faces at all.** `proRow`, `shopRow` and `nearRow` drew the category glyph for everybody, so on `#/home` "Open now" and on `#/nearby` — where a customer actually scrolls — the release was invisible | 🔧 `views/home.js:397` — one `faceThumb()` used by all three: `photo.url()` or the drawn glyph, inside the same fixed `.m-thumb`. Verified: rows carrying a photograph and rows without both measure **85px**, thumbs 52×52 (44×44 on `#/nearby`), image 50×50 |
| **The verification ladder's step 3 said "Customers see this face at the door" and stored nothing.** `verification.submitSelfie(p)` marks the step done with `{captured:true}`; the pro went live with a letter where the face should be, and had to discover My page to fix it | 🔧 `views/onboard.js:417` — `takeSelfie()` asks for the picture and writes it through the same `flow.setPartnerPhoto()` that `photo.pro` uses, then marks the step done. **The step still completes** if the camera is cancelled or the device is full ("No photo yet — the step is done; add one later from My page") — verified on two fresh pros, one feeding a file (portrait stored, step 3 → 4) and one cancelling (no portrait, step 3 → 4) |

## C. Opening a shop

Walked on the **empty production boot** (first column) and again as an existing
customer on a number that already held an account (second).

| Check | Result |
|---|---|
| **`data-act="shop.start"` was registered in `app.js:346` and rendered by nothing.** No control anywhere in `src/ui/**` carried it; the two "which side are you on" rows on `#/earn` both carried `earn.start`, which sets the role to **partner** — so "I run a shop" landed a shopkeeper on the trade form | 🔧 `views/earn.js:118` (the shop row now carries `shop.start`, and the "both open the same sign-up" hedge below it is rewritten), `views/home.js:680` ("Open a shop →" beside "List my shop or service"), `views/account.js:312` (Settings row "Open a shop · A second account, on this number"). All three measured ≥44px; the home one opened the shop journey directly |
| The **category picker** is real: eight cards — kirana, veg, meat, dairy, pharmacy, water, stationery, petshop — each with its own icon and accent, `aria-pressed` following the choice, the hidden `#suCat` carrying the answer | ✅ / ✅ |
| Choosing one says what it costs, from the category's own dials: "Grocery & Kirana · 10 aisles ready · SAAHAA takes 3% of an order, never more than ₹25", and the cost strip above changes to "3%, capped ₹25" | ✅ |
| **The shop photograph is taken before the shop exists** and lands on it: 44px box → preview, "Photo added", and the created shop carries `photo: ph_…` with 67KB behind it | ✅ / ✅ |
| **"You're live"**: "Padma Fresh Veg is open in Madhapur", the category and place tags, the shop front with "Change the photo", **YOUR SHOP ID S20262001**, "To open, and to stay open ₹0 / Per order 3% of the basket, never more than ₹25 / Yearly plan None" | ✅ / ✅ |
| **Three items listed with pictures and prices** — one typed by hand through "Add your own item — name, price, picture" (name, price ₹299, stock, MRP; refused a price above the MRP) and two from the ready list — then photographed. Row height 158 before and after every picture | ✅ / ✅ |
| **They are on the customer storefront**: the shop hero at 375×148, three product pictures at 153×76, prices and discounts ("₹299 / ₹330 / 9% off") | ✅ / ✅ |
| **And in the cart**: three lines at 42×42 with the substitution policy per line, the delivery modes, and the bill | ✅ / ✅ |
| A **customer** opened a shop on the number they already use: signed in as `C20262002`, the signup screen said "Signed in as Ravi Buyer · C20262002 — your customer account. Opening a shop adds a **second account on the same number**…", and it became **S20262002**, both accounts live | ✅ |
| A **second shop** on a number that already holds one is refused, naming it: "This number already has a shop account (**S20262001**) — sign in instead"; user count unchanged | ✅ |
| A new shop's first orders are charged **0%** ("SAAHAA's charge of ₹0 (0% of the basket) comes out of the shop's side") — that is `pricing.quoteRetail`'s `firstOrders` promotion, not a missing number; an established shop on the same screen shows ₹25 capped | ✅ *(engine, verified)* |

## D. Regression — the customer (`?demo=1`)

| Check | Result |
|---|---|
| Sign-in by number `9000000001` → `C20262001`; wallet ₹0 → ₹1,000 on a chip | ✅ |
| Wallet refusals: ₹5 in → "Minimum top-up is ₹10"; ₹2,000 out → "You can take out up to ₹1,000"; **₹5 out → "The smallest take-out is ₹10"** (v8.0.0's lead item, still fixed); ₹150 out → "₹150 sent to your UPI" | ✅ |
| Category → booking sheet: sub-service chips, best-match card, the bill from the dials — ₹503 + "SAAHAA charge · 8% on top, incl. GST" ₹40 = ₹543 | ✅ |
| Paid **from the wallet**: `paidFromWallet 54324`, `collected 0`, strip "₹543 from wallet" | ✅ |
| Order tracking: number, counterparty, stepped timeline with times, the bill, and the **map toggle** — `#orderMap`, 2 markers, tiles, "MAP" ⇄ "HIDE MAP", `aria-pressed` follows | ✅ |
| **Chat** — inline composer and `#/chat/<orderId>`: sent, in the thread, field cleared, **caret still in the field** | ✅ |
| **Masked contact details stay masked**: "Call me on 9876543210 or pay ramesh@okaxis" → "Call me on •••••••••• or pay ramesh@•••", note "Phone numbers and payment ids hidden" | ✅ |
| The door code (`8501`) is shown to the customer before check-in and **gone** once `otpVerified`; it is never shown to the pro | ✅ |
| WORK_DONE → confirm → `SETTLED`; ledger `ESCROW_IN 54324 CUSTOMER→ESCROW`, `ESCROW_RELEASE 50300 → PARTNER:p_electrical_6`, `HOLDBACK 5030`, `FEE 3410 → PLATFORM:fee`, `GST 614 → PLATFORM:gst`; `stake.returned true` | ✅ |
| Rating panel inline on settle; five 44×44 star buttons with `aria-label` "1 star"…"5 stars"; 5★ → `CLOSED`, the pro's ratings 20 → 21 | ✅ |
| **Ask-rates end to end**, twice, both waited out in real time: compose → "Asking 4 workers near you" → the wave at 3 min widened it to **8** → the elapsed bar with its marker ("11:02 elapsed · usually done by 4:00", derived from the window) → sealed quotes → window closed → "Best pick" with a reason per quote ("fair price, best rating, 9 min away", "₹24 cheaper, but rated lower and 22 min away") → Accept → order `ASSIGNED` | ✅ |
| **Receipt** sheet: "You asked 4 workers · You pay ₹764 · You saved ₹31 · CoolCare Ravi is booked" — and the order it created bills **exactly ₹764** | ✅ |
| **Cart → retail order**: substitution policy per line, three delivery modes (the bill re-computes — rider ₹1,841 to the shop because free delivery makes the shop absorb the ₹19 ride, self/pickup ₹1,860), "SAAHAA's charge of ₹25 (3% of the basket) comes out of the shop's side" — placed, auto-accepted under the sim market | ✅ |
| The **"Not in stock" → "Ask me"** path: the shop marks a line unavailable → "Asked the customer. No reply in 90 seconds means that item is refunded" → the customer picks "Similar brand is fine" → the line is tagged "similar" and the order keeps going | ✅ |
| Shop chain picking → weighed & packed → out for delivery → delivered; customer confirms → **`R_CLOSED`**, "Settled — ₹1,841 to Sri Lakshmi Kirana" | ✅ |
| Retail legs: `SHOP_PAYOUT 184100`, `FEE 2119`, `GST 381`, `RIDER 1400 → RIDER:pool`, `DISPATCH 500 → PLATFORM:fee` | ✅ |
| **Refund lands in the wallet**: cancel before the pro sets out ("More than 2 hours before the slot — full refund") → `REFUND 74983 ESCROW → CUSTOMER`, balance ₹0 → ₹750 | ✅ |
| **`#/nearby`**: 41 pins on `#nearbyMap`, tiles, legend; Shops → 12, Pros → 112, Open toggles `aria-pressed` without changing a roster where everybody is open; "lakshmi" → 5; "zzzznone" → the empty state ("Try a shorter word, or search the box above for a place to move the map") | ✅ |
| `#/nearby` **empty-store** state on the production boot: map, chips and the "New here" list with no rows and no errors | ✅ |
| **The ask screen quoted the general 8% for every worker, then charged the tier-4 loyalty rate.** `markupFor()` (`domain/trust.js:114`) gives an Elite pro 6%, and `domain/flow.js:94` prices the real order with it — so an Elite pro's card read "incl. SAAHAA 8% · ₹810" and the very next screen billed **₹750**. Every figure on the ask screen belongs to one named worker's bid, and they were all quoted at the wrong rate: the held price, each reply, each Accept button, the receipt, and the pro's own quote builder | 🔧 `views/ask.js:45-49` — `partnerOf/mkOf/payP/gapP/pctP` price each figure at that worker's own markup. After: the booking sheet, the ask screen, the receipt and the order **all say ₹795 / ₹764** for the same money; a tier-2 pro's quote builder says "SAAHAA's 8% … The customer pays ₹788" and a tier-4 pro's says "SAAHAA's 6% … ₹774", both matching what the order charges |
| The home card for a running ask printed `r.held.amount` — the worker's **deal** — so it said "your ₹750 stays held" while the ask screen it links to said ₹795 about the same money | 🔧 `views/home.js:360` — `heldPays()` quotes it at the held partner's markup, the way every other customer-facing surface does. Now "your ₹795 stays held" on both |

## E. Regression — the working side (`?demo=1`)

| Check | Result |
|---|---|
| **Ladder 1–7** on a brand-new pro (`P20262112`): code sent → wrong code "That code is not right" → right code "Number confirmed"; PAN `ABCDE1234F` → "ID saved — only the last 4 digits kept" (a second pro re-using the same PAN → "This ID is already registered to another partner"); the photo step; trade quiz **5/5**; rules quiz **6/6**; UPI — "notavalidupi" refused "A UPI id looks like name@bank", `suresh@okhdfcbank` accepted; agree → **tier 2**, online, "You are live" with the public page, "You paid to get here ₹0", "You keep of every quote 100%" | ✅ |
| **Leads**: the open request appears with the fair price and the clock — "AC & Appliance Repair · Madhapur · 3 pros asked · fair price ₹730 · 4 min" | ✅ |
| **Quote builder**: "Your price ₹730 · **You keep 100% — nothing comes out of it** · SAAHAA's 8%, paid by the customer ₹58 · **The customer pays ₹788**" | ✅ |
| Both figures move with the slider — 650 → keep ₹680 / fee ₹54 / customer ₹734 / chance "fair"; 800 → ₹800 / ₹64 / ₹864 / "fair"; 900 → ₹900 / ₹72 / ₹972 / "weak". The Send button re-labels with the figure | ✅ |
| Bid sent → "Your price of 730 is in. You will know shortly.", appears under "Your sealed rates · Waiting", and shows on the customer's reveal at **₹788** — the tier-2 rate | ✅ |
| **Job chain**: ASSIGNED → EN_ROUTE → ARRIVED (job map, both pins, "YOU · MADHAPUR") → wrong code "Wrong code" → right code "Verified — work started" → *finish absent before the photograph, present after* → WORK_DONE "Done — instant on confirm" | ✅ |
| **Stake locked at check-in**: `{need:10000, funded:0, onCredit:10000, lockedAt}`, and the panel says so ("₹100 LOCKED from your wallet for this job") | ✅ |
| **Stake returned at settlement**: `{… returned:true, returnedAt}`; Earnings shows LOCKED ₹0 | ✅ |
| **Earnings**: "September · you kept ₹503 from ₹503 quoted"; Released ₹503 / In escrow ₹0 / Sent ₹0; wallet Available ₹453, Pending ₹50 (7-day holdback), Released ₹503 lifetime; "Kept equals quoted on every line"; the stake copy reads the dials (₹100 / 5% / ₹500) | ✅ |
| The pro's screens are in the pro's voice throughout: "**The customer pays** ₹543", "held until **the customer** confirms", "**You keep** the whole ₹503", no customer-savings line | ✅ |
| **Standing**: "3 / 6 green" — ladder 7/7, jobs 1/3, rating 5.0/4.3, disputes 0/0, vouches 0/2, reference "no code yet" — every line from the dials | ✅ |
| Reference: request saved → "Send your reference their code" → on-screen sandbox code → wrong code "That code is not right" → right code "Reference confirmed." → **"4 / 6 green"** | ✅ |
| Vouches: the customer whose job settled vouches ("Thank you — your vouch counts."), the button disappears, "You have already vouched for this pro.", **singular "1 vouch"** | ✅ |
| A tier-2 same-trade pro is refused — "Only a Background-Checked pro in the same trade can vouch as a pro."; a tier-3 same-trade pro (Vikram Volts, `P20262107`) vouches → **"2 vouches"** | ✅ |
| A pro's public page falls back cleanly when the pictures are gone: the letter avatar, and the WORK section absent rather than an empty frame | ✅ |
| Automatic promotion could not be driven to completion in this run: the new pro needs three settled jobs and the seeded tier-3 pros already hold their tier. The path itself is exercised by `core/selftests.auto.js` and the Automation dials below | ⚠ known limit |

## F. Regression — the shop (`?demo=1`)

| Check | Result |
|---|---|
| **Today**: "SALES TODAY ₹1,885 · 1 order", "FEES TODAY (3%) ₹25 · capped ₹25 an order" (both from `getPricing()`), "ORDERS NEEDING YOU 1 open", "WANTS ATTENTION 3" with restock rows, "ADD WITHOUT TYPING" | ✅ |
| **Listings**: Products / Inventory / Pricing sub-tabs; "Pick from the ready list" → **Add**; the own-item form (name, price, stock, unit, MRP, shelf) with an MRP guard and the picture step on the same screen | ✅ |
| Order chain from the shop: R_ACCEPTED → picking → the "Not in stock" branch → weighed & packed → out for delivery → delivered | ✅ |
| **Money & fees**: Orders / "SAAHAA fee · 3%, capped ₹25" / Rider fees / Listing fee / Yearly plan / Yours, "what an aggregator would have taken … at 25%", "SAAHAA takes 3% because a kirana's own margin on staples is only 3–6%", shop wallet, settled-orders history | ✅ |
| Ten shop screens (Today, Analytics, Shop profile, Products, Inventory, Pricing, Orders, Customers, Money, Payouts) at 375 and 1440, both themes — no overflow, no emoji, no unlabelled icon button | ✅ |
| Shop profile carries the shop front as a **72×72** `photo.shop` target; the row goes 109 → 96px when a picture arrives, because the "Add your shop photo" button is replaced by the shorter "Tap the photo to take a new one." — the picture box itself never changes | ✅ *(copy, not the picture)* |

## G. Regression — admin

Session written the way `deckscenes.js` writes it; no password used.

| Check | Result |
|---|---|
| Console opens; header reads "**v8.2.0 'A shop with a face' · schema v10 · 20260909b**"; eight sections | ✅ |
| **Charges**: service % 8 → 10, Push → "Pushed — every new quote uses these", the worked example recomputes ("₹1,000 job: the customer pays ₹1,100 — pro keeps ₹1,000, our fee ₹85, GST ₹15 (markup 10%)") | ✅ |
| A **new** booking is priced at the new rate (₹543 → **₹553**, "SAAHAA charge · 10% on top") while the **already-booked** order keeps its own (`deal 50300`, `platformFee 3410`, `customerPays 54324` — 8%). Reset → 8% | ✅ |
| The dials show the **tier-4 loyalty markup as its own number** — "Certified (tier-4) markup % · now 6% · launch default 6%" — which is what section D's ask-screen defect was measured against | ✅ |
| **Flow**: 60 rows, role filter, code/mobile/name search — `P20262112` → 1 row, `c2026 2001` (lowercase, spaced) → 1 row, a mobile → 1 row; tap unrolls the whole journey ("SURESH NAIK · P20262112 — THE WHOLE JOURNEY", 10 events with `verify.step` details), vertical at 375, no overflow. The v8.1.0 plural fix holds ("10 events, newest first") | ✅ |
| **Treasury**: "Books reconcile" / "Balanced"; aggregate escrow ₹750 = ledger replay ₹750, **Difference ₹0**; Platform revenue ₹55, GST collected ₹10, ledger blocks 16 | ✅ |
| Withdraw ₹1,000 refused "Only ₹60 is ours to withdraw"; ₹0.50 refused "Minimum ₹1"; ₹60.29 → "Withdrew ₹60 to the company bank" | ✅ |
| Remit ₹50 refused "Only ₹10 of GST is held"; ₹9.95 → "Remitted ₹10 of GST"; books still reconcile, "GST REMITTED SO FAR ₹10" | ✅ |
| **Automation**: `certDays` 400 → "certDays: must be between 0 and 365", nothing pushed; the switch off → Push → "Pushed — automation is off, tiers 3 and 4 wait for you"; back on → "Pushed — the network promotes by itself"; Reset → 3 jobs / 4.3 / 2 vouches / reference / 14 days | ✅ |
| **Payments rail** card: "sandbox" pill, Sandbox ⇄ Razorpay mode, key-id and Edge-Functions URL fields, "Save on this device" / "Back to sandbox", and the fails-closed note | ✅ |
| **System & audit**: health **10/10** (including `schema v10 vs app v10`, `24 categories`), 14 feature flags, "Take snapshot" → "Snapshot saved", Export JSON, change password | ✅ |
| Self-test card → **198 passed · 0 failed** in 135ms — and it **destroys every picture on the device** and forges an audit entry while doing it | ⛔ see the top of this report |
| **Fresh start**: wrong word → "Type FRESH in the box to confirm", no sheet, 132 users unchanged; "FRESH" → step-up "Confirm it is you … Re-type the owner password"; wrong password → "That password is not right", field cleared, `admin.login.fail admin {stepUp:true}` on the audit log, **nothing wiped** (132 users and 4 pictures before and after) | ✅ then 🔒 |
| That Fresh start clears pictures could not be driven to completion without the owner's password. `domain/fresh.js:77` calls `photos.gc([])` after the wipe, and the **same call on the demo-purge path was verified end to end** (section B) | 🔒 / ✅ *(sibling path)* |
| All eight sections at 375 / 840 / 1440, light and dark | ✅ |

## H. Regression — identity (`?demo=1` and the empty boot)

| Check | Result |
|---|---|
| Sign in **by code**: `P20262074` → `#/partner` · lowercase `c20262001` → `#/home` · spaced `C 2026 2001` ✓ · trailing space `s20262011 ` → `#/shopadmin` | ✅ |
| An unknown code → "No account with that ID"; a non-code, non-number → "That is not a 10-digit number or a SAAHAA ID"; a wrong password on a good code → "Wrong password" | ✅ |
| A **customer** account opened on a live pro's number (`9333000077`): the new-ID sheet said "This number **also holds** a pro account (**P20262112**) — separate account, separate password, separate wallet and history. They never mix." — v8.1.0's `siblingLine()` fix holds | ✅ |
| Sign in **by number** with two accounts opens the chooser: "This number has 2 accounts on it", rows `Customer · Suresh Naik / C20262006` and `Pro · Suresh Naik / P20262112`, each `data-act="auth.pick"` with its own key | ✅ |
| **The passwords are genuinely separate**: typing the customer's password and picking the *pro* row is refused "Wrong password" and nothing is signed in; picking the customer row lands on `#/home` as `C20262006` | ✅ |
| **The gate still holds and a code cannot dodge it**: five wrong passwords against `P20262112` → four "Wrong password", the fifth "Wrong password — locked for 30s". The **number** is then refused "Too many attempts — try again in 29s", and so is the **other code on that number** (`C20262006`, 28s) | ✅ |
| **My SAAHAA** shows the block: "YOUR CUSTOMER ID / C20262006 / Copy", the sign-in line, and "**You also have a Pro account (P20262112) on this number.** Separate wallet, separate history, separate password…" with **Switch account** | ✅ |
| Copy: the clipboard is refused by the preview pane (the document is never focused), and the **fallback fires exactly as designed** — the code is selected and the toast reads "Select and copy — your browser blocked the clipboard" | ✅ fallback path |
| **Pro console header**: "SAAHAA · PRO / Riyaz Shaikh / PRO ID / P20262074". **Shop console header**: "SAAHAA · SHOP / Sri Lakshmi Kirana / SHOP ID / S20262011" | ✅ |
| Codes carry through admin: Flow rows, the unrolled journey heading, and `user.login` audit detail `{key, code, role}` | ✅ |
| **Nothing lost.** On `?demo=1`: 128 users, **0 without a code** (C×5, P×111, S×12) | ✅ |
| On the empty production boot the counter starts fresh: the first shop is `S20262001`, the first customer `C20262001`, the first pro `P20262001`, per role | ✅ |

## I. Cross-cutting

| Check | Result |
|---|---|
| **No horizontal overflow anywhere.** `document.scrollWidth === clientWidth` on every route, every console tab and every admin section, in both themes, at **375 / 840 / 1440** — maximum measured difference **0px** at all three. Nothing extends past the viewport except the deliberate horizontal scrollers, which clip and scroll inside their own box | ✅ |
| **Console.** No error other than the known `version.json` 404 from `core/update.js` on a static server and the OpenStreetMap tile 404s this offline pane produces. An in-page collector on `console.error`, `error` and `unhandledrejection` recorded **zero** entries across both passes; `performance.getEntriesByType('resource')` shows exactly two origins for the whole session — the dev server and `tile.openstreetmap.org` | ✅ |
| **No emoji in rendered text** on any screen, at any width, in either theme (`\p{Extended_Pictographic}` walk of every text node): the only hit is Leaflet's own "©" in the map attribution | ✅ |
| **aria-labels on every icon-only button** on every screen in both passes — the scan (visible buttons with no text, no `aria-label`, no `title`) found none | ✅ |
| The inline chat composer's Send was **37 × 44** — `.btn--primary` sets no minimum width, and 14px of padding either side of a 9px glyph is 37px (the `#/chat` composer's own `.ch-send` already set 52px) | 🔧 `views/orders.js:347` — `min-width:44px` |
| Account's "All 4 →" measured **42 × 44** — `.more` stated its height and not its width | 🔧 `tokens.css:214` — `min-width:44px` on `.more`. Every other `.more` is already wider, so it moves nothing else |
| The About page's inline link `github.com/Ohhks/saahaa` measured **165 × 15** — the v8.1.0 rule covers `p.micro > a.micro` only | 🔧 `views/legal.js:323` — `.lg-sec p > a{padding-block:15px}`. Block padding on an *inline* box grows the hit area to **45px** without touching the line box, so the type and the paragraph are unmoved; section heights unchanged (420/422/159/137) |
| After those three fixes the only controls still measuring under 44px anywhere are: the search `<input>`s inside their own 44px shells (42px = 44 minus the 1px borders — `#q`, `#shopq`, `#catq`, `#adFlowQ`), the five inline footer legal links (45px tall, word-width — the WCAG inline-link exception), two checkboxes whose `<label>` is the real target (`#atAuto`, `#atReference` inside `label.ad-check`), and Leaflet's own zoom and attribution controls | ✅ with the documented exceptions |
| **A closed sheet still does not swallow clicks**: after opening and closing one, the 375 × 715 `.sheet` computes `visibility:hidden; pointer-events:none` and `elementFromPoint` at the viewport centre returns the page beneath | ✅ |
| Light ground `rgb(243,242,242)` / dark ground `rgb(32,30,29)` measured on every route at all three widths; `font-family` resolves to **Archivo** everywhere | ✅ |
| **No hard-coded fee percentage anywhere.** A runtime scan of every rendered `N%` across twelve routes returns only: `3%` `6%` `8%` (the dials), `100%` (the invariant), `25%` and `20–30%` (statements about *other* companies), `0%/30%/60%/90%` on Refunds (from `CANCEL_RULES` via `pctOf()`), `5%` (the stake, `STAKE_PCT`), and `4/7/9/11%` on a storefront (per-product discount against MRP — data, not a fee). The literals left in the tree are comments (`partner.js:14-15`, `pro.js:17`, `earn.js:16`, `admin.js:1186`, `ask.js:41-42`), the shop's own fill-rate badge threshold (`partner.js:1025` — "stay above 85%"), and the admin's **"Partial 60%"** dispute split (`admin.js:741,799`, `data-pct="0.6"` — the label and the value are the same literal, so it cannot lie) | ✅ |

## Gates

Run before the first pass, after every fix, and last:

```
node tools/test-node.mjs      PASS 198  FAIL 0  BROWSER-ONLY 0  468ms
node tools/guard-ui.mjs       guard: engine frozen · contract kept · PASS 198  FAIL 0
                                ✓ no violations
python tools/build.py --site  built dist/saahaa.html — 70 modules, 1009 KB, 0 lint problem(s)
bash tools/preflight.sh       bundle present (1,070,862 bytes) · is really the app · everything inlined ·
                              no forbidden secrets · only a public anon key · no dev leftovers ·
                              SPA deep links survive a hard refresh · smoke-dist OK (1083 KB DOM,
                              60 controls) · version 8.2.0 OK · 4 migrations, 0 problems
                              === PRE-FLIGHT PASSED — safe to publish ===
```

Every `data-act`, element id and export survived the picture work, the shop
journey and the guardian's eleven fixes: the guard compares the whole UI
contract against the snapshot at `../saahaa02` and reports no violations. The
three new controls all carry `shop.start`, an action `app.js:346` already
routed; no new action, id or export was introduced.

## Lead items (forbidden files — not touched here)

1. **`src/core/selftests.photos.js:16` and `src/core/selftests.auto.js:35`** —
   the console's "Run tests" button deletes every picture on the device and
   forges a `data.demoPurged` audit entry. Reproduced from a clean state; see
   the top of this report for both snippets and the shape of a fix. **This is
   the item to land first**: it silently destroys user data on a button the
   owner is invited to press.

2. **`src/core/photos.js:64`** — the one-picture refusal rounds both numbers to
   the same value: a 92,170-byte picture is refused with "That picture is 90KB
   — the limit is 90KB". One decimal, or `Math.ceil` on the first and
   `Math.floor` on the second, makes it read true.

   ```js
   return { ok: false, reason: `That picture is ${Math.round(bytes / 1024)}KB — the limit is ${Math.round(MAX_ONE / 1024)}KB` };
   ```

3. **`src/domain/flow.js` / `src/core/photos.js`** — the boot sweep reclaims
   orphaned *bytes* but never clears a dangling *reference*. After the pictures
   were destroyed (item 1) the records still carried 13 photo ids that resolve
   to nothing. Harmless on screen — `photo.url()` returns `''` and the drawn
   placeholder takes over, verified on every route — but `referenced(state)`
   over-reports and a record keeps a name for something that is gone. Worth a
   pass that nulls a `photo` whose bytes have vanished.

4. **`src/domain/verification.js:161`** — `submitSelfie(p)` takes no picture
   and stores none (`markDone(p, 'selfie', { captured: true })`). The UI now
   photographs the pro and writes it with `flow.setPartnerPhoto()`
   (`views/onboard.js:417`), so the screen no longer promises what the engine
   does not do — but the *verification record* still says a face was captured
   without holding one. If a portrait is ever meant to be evidence rather than
   decoration, the id belongs on the verification record.

5. **`src/ui/views/pro.js:167` + `src/app.js:257`** — carried over from v8.0.0
   and still true. The pro page's primary button promises a named pro and opens
   the category's *best match* instead.

   ```html
   <button class="btn btn-primary btn--lg" data-act="cat.open" data-id="${p.cat}">Book ${esc(first)} · ${esc(cat.name)}</button>
   ```

   `app.js:257` routes `cat.open` to `home.openCategory(d.id)` with no partner,
   so the sheet re-runs `flow.findMatch()`. `book.confirm` already carries
   `data-pid` (`app.js:260`), so either the button becomes `book.confirm` +
   `data-pid` or `openCategory` gains a partner argument. Both are money-flow
   decisions and belong to the lead.

6. **`src/domain/flow.js:708`** — `maskContact` covers 10-digit numbers and UPI
   handles; an e-mail address passes through unmasked. The screens say exactly
   what is masked, so this is a scope question, not a lie.

7. **`src/domain/autoverify.js`** — carried over from v7.0.0: the tier-3
   "Average rating" line averages every rating the pro holds, while the label
   says "over those jobs". Only visible on the demo roster.

8. **`src/domain/fresh.js`** — the demo purge is all-or-nothing on a store that
   was ever seeded, so an account signed up by hand during a `?demo=1` session
   is wiped by the next plain boot along with the roster — and now its
   pictures with it. Correct for a demo device; worth a line in the console's
   "demo residue" copy.

*(v8.1.0's lead items 1–4 are carried forward as 5–8 above; nothing on that
list was fixed in this release.)*

## Known limits (not defects — production items)

- **Three rails complete inside the app instead of against an outside
  system**, and every screen says so: the phone code and the reference's
  4-digit code are shown on screen rather than texted (needs a DLT-registered
  SMS sender); `core/gateway.js` runs in `MODE = 'sim'` — every collect and
  payout is labelled *Sandbox UPI — no real money moves yet* and every ledger
  leg carries `via: 'upi-sim'`; a UPI id is format-checked and saved rather
  than penny-dropped.
- **Pictures live in `localStorage` on one device.** 3MB total, 90KB each,
  shared with the state, the audit log and the backups. They do not follow a
  person to another phone and they do not survive clearing site data. That is
  the right trade for an offline-first single-device build and the wrong one
  the day two devices share an account.
- Withdraw fees and Remit GST above ₹5,000, and Fresh start, are step-up
  protected; this run stops at the sheet and verified the refusal path only.
- The 14-day Certified tenure cannot be waited out in a run, and automatic
  tier-3 promotion needs three settled jobs on one new pro.
- The ask-rates window is 12 minutes (`domain/bidding.js:218`); both asks in
  this run were waited out rather than shortened (one wave at 3 min widening
  4 → 8 workers, close at 12:00).
- `askOffer()` hides the "Send to the circle" row when the locked match is
  already at or below what an ask would produce, so the entry row is not on
  every category on every store. That is the engine's judgement, not a missing
  control.
- The `?demo=1` market simulation answers ask-rates and accepts retail orders
  so the flows can be walked locally. It runs only under `?demo=1`
  (`SIM_MARKET`) and never on a real device.
- The Clipboard API refuses to write while the preview pane is unfocused, so
  the ID **Copy** button was verified on its fallback path (select + explain).
- Maps use OpenStreetMap tiles and Nominatim, a free shared geocoder used
  politely; the tiles 404 in this offline pane. At real volume this needs a
  self-hosted Nominatim or a paid geocoder — a capacity item.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
