# Changelog

All notable changes to SAAHAA. Format follows [Keep a Changelog].
Versions are semver; every release is git-tagged, because an untagged release
cannot be rolled back and therefore isn't a release.

---

## [8.11.0] — 2026-09-11 — "Escrow reaching zero is not the same as the money being right"

THE LESSON OF THIS RELEASE, learned the hard way and more than once: a book
that balances is not a book that is right. Escrow landing at zero says the money
went SOMEWHERE, not that it went to the right people — and because settlement
distributes whatever is left and then rewrites the order to match, an
understated payout moves money to SAAHAA while every self-consistency check
moves with it. Three separate defects hid behind a balanced book, and the check
that finally caught them was not an invariant at all: it was pinning a number to
the price the product PUBLISHES. ₹5 dispatch is ₹5, not "the remainder".

The other recurring lesson, arrived at five or six times from different
directions: a figure describing the relationship between two others must be
derived from those two AS PRINTED. Savings, refunds, giveaways, "less than
held", "you save" — every one of them was wrong at least once because it was
computed from sources the reader never sees.

8.10.0 shipped the fourth generation of the reweigh bug under a comment
explaining why it could not possibly be wrong. This release began by placing
one real order in a browser instead of reading the source, and found the fifth
inside ten minutes — along with two more fixes from 8.10.0 that had gone into
the wrong function entirely. Nothing here was found by reading. Everything here
was found by running it.

### Fixed — the fifth generation: a short weigh refunded nothing

8.10.0 passed `freeDeliveryAbove` into the reweigh quote, which was correct and
insufficient: passing the threshold makes the re-quote *re-evaluate* it. Order
9 kg of loose rice at ₹549.72 — over the shop's ₹499 line, so delivery is free
and the shop absorbs the ride. The shop weighs 8 kg, ₹488.64, now under the
line. The ₹19 delivery reappeared and ate the whole refund. **She weighed
lighter and got ₹0.00 back**, on an order still reporting
`shopAbsorbedDelivery: true`. Escrow balanced perfectly, so no invariant fired,
and the order recorded `overEstimate: 10` — the system believed she had been
*over*-weighed.

Free delivery is a promise made at checkout, not a running condition.
`quoteRetail` takes `alreadyFree`, `setPickedQty` passes what the order
recorded, and a re-quote may lower her bill and may never quietly withdraw a
promise. Verified live: refund is now the whole ₹61.08 weight difference,
delivery stays ₹0, the rider is still paid ₹14.00, escrow lands at 0.

The tests that missed four generations all re-implemented the arithmetic by
hand, and their model shared the defect — which is why they were green. The new
suite calls the shipped `quoteRetail`.

### Fixed — the completed-order counter was incremented by refunds

8.10.0's headline fix — "nothing in the product ever incremented this" — was
written into `refundRetail`, the RETURN path. So the counter ticked when an
order came *back* and never when one was delivered. A live order settled and
the shop stayed on 78. Every real shop still sat on order zero, still paid no
commission, still had a frozen "30 free orders left" countdown. It also spent a
free order on a sale that was returned.

`tools/lint-dead.mjs` gained a fourth check for exactly this shape: a counter
that gates money must be incremented by the function that closes a *successful*
order, and by no other. Poison-tested.

### Fixed — preflight passed against a bundle nobody had built

Every gate reads `dist/`, and nothing in `tools/preflight.sh` built it. A run
that forgot `python tools/build.py --site` smoke-tested yesterday's bundle and
printed "safe to publish" over uncompiled code. It refuses a bundle older than
the source now.

### Fixed — cancelling early cost a pro exactly what not turning up cost him

The sheet promised, in so many words, "you keep your stake, and this is
recorded as a cancellation, not a no-show" — and the engine forfeited the stake
to the customer on `WORKER_CANCEL` exactly as on `WORKER_NO_SHOW`. A pro who
did the honest thing his agreement asks of him lost the same money as one who
simply vanished, so there was no reason left to cancel: the whole behaviour the
feature exists to buy. Meanwhile the ₹100 the public refunds page has charged
him in writing since 8.0 was collected by nothing at all.

An early cancel now returns the stake and charges a real fee. The fee moved to
**₹40**, because ₹100 was exactly `MIN_STAKE` — on the ordinary ₹520 job,
cancelling and no-showing cost identical cash. A test asserts the fee is below
the smallest stake the product can lock, at every job size.

And he can finally reach the control: `IN_PROGRESS` was the one stage without
it, and the one stage where a pro actually discovers he cannot finish. It was
also missing `CANCELLED` from its transition list, so the button would have
done nothing silently.

### Fixed — the grocery door had no lock on it

`verifyOtp` counts failures, stops at three and raises a real dispute.
`checkRetailCode` said "wrong code" and let the rider try for ever — no count,
no limit, no record — so the same nine characters were protected on one doorstep
and not on the other. Same rule now, with the state-machine edges it needs:
`R_OUT → DISPUTED` and back, and `retryDoorCode` returns a grocery order to
`R_OUT` rather than to a service stage.

### Fixed — a password hash on disk, depending which door you came in

Sign-in stripped `pass`/`passSalt`/`passIter` by hand before saving the session.
Sign-up, written later and forty lines away, passed the whole user record — so
the same account's credential sat in localStorage if the person had just
registered and did not if they had come back. The strip moved into
`core/ctx.js saveSession`, the only place that can guarantee it, and into
`restoreSession`, which put it straight back.

### Fixed — a rating nobody had given

The same unrated plumber read **4.5 ★** in the "open now" list, **4.2 ★** on his
bid card, and unrated on his own profile: three screens, three different
inventions. A customer comparing two bids was comparing one real average
against a number the app made up — and the bid card carried a comment promising
it never did that, one line above the code that did. `ratingLabel` says "New",
or "New · 4 jobs", which is the thing we actually know.

(`ratingScore` in `domain/bidding.js` keeps its 4.2 prior. That one is used to
*rank* and is never shown to anybody, which is the whole distinction.)

### Fixed — a tier-4 pro was quoted at 8% on his own profile

`pro.js` called `quoteService` with no markup, so it fell back to the standard
rate and quoted a certified partner dearer than the customer would be charged;
`partner.js` told him SAAHAA takes 8% when it takes 6% from him. The rebate he
spent four tiers earning was invisible on both pages that exist to show it.

### Added — the rules, in the language he reads

The agreement a partner signs and the conduct quiz he is marked on were
English-only, on an onboarding that tells him two screens earlier, in Telugu,
that it knows he may not read English. Being marked on rules you cannot read is
not being taught them; failing three times locks the trade for 24 hours.

Both are now in Hindi and Telugu. The per-trade banks stay English and say so
honestly — a plumbing question is about plumbing. `conductFor` maps options
positionally and copies the correct index from the English bank, so a
translation cannot move the answer; the suite asserts that, asserts nothing is
blank, and asserts the translations are not the English copied over.

Native-speaker review is still outstanding, and the app still says so.

### Tests

265 → 288, all passing. The new ones are named after the claims they hold up.

### The re-score, and what it found

Both journeys were then scored again against the shipped build: **customer 5.5 → 5.8, partner 6.5 → 7.0**. Neither is a pass. What follows is what those two passes found — including a regression this very release introduced.

### Fixed — she could not confirm a delivered grocery order at all

The shop's "Handed over — waiting on the customer" panel was pasted into the
CUSTOMER's branch of `actionPanel`, above her own `R_DELIVERED` panel. A ladder
of `if (s === 'X') return …` gives the second one no chance to run, so she lost
**Confirm delivery** and **"Something was wrong — return this order"** and was
shown the shop's copy, written in the third person about her. Her money was
released only by a timer she had no button for. A second `R_RETURN` was dead the
same way. Introduced in this release, by me, four hours before it was found.

`tools/lint-dead.mjs` gained a fifth check: a stage handled twice inside one
role's branch. Poison-tested by re-introducing the exact defect.

### Fixed — the money bugs moved out of the engine and into the views

The engine is now trustworthy — every order driven in the browser ended with
escrow at exactly 0 and all five invariants holding. The screens were not.

- **A shop's statement said ₹556 beside its own wallet reading ₹570.**
  `partner.js` filtered on `e.type === 'SHOP_PAYOUT'` and read `e.partyB`,
  `e.amountPaise`. Records carry `kind`. So the filter matched nothing, the
  total was always 0, and the panel fell through to summing an order field —
  under a comment promising a statement that "cannot drift". `domain/ledger.js`
  now exports `creditsByKind`, `debitsByKind` and `legsFor`; nothing outside
  that file walks an entry any more. `wallet.js` used the same wrong shape for
  `released` and `withdrawn`.
- **"You kept ₹428" over a ledger that paid ₹388.** A ₹40 cancellation debt is
  recovered out of the payout, and the `debt` warning line vanishes the moment
  it is collected — so the charge became invisible at exactly the moment it was
  taken. `kept` comes off the ledger now, and the recovery has its own line.
- **The same fee landed in revenue or in goodwill** depending on whether the pro
  happened to have a wallet balance. `PLATFORM:goodwill` should only ever run
  negative. Both paths post to `acct.fee()`.
- **A cancellation collected no GST.** Every other commission path splits
  fee-ex-GST from GST; this posted the whole take to `PLATFORM:fee`. About
  ₹11.48 on a ₹75.27 take was the government's.
- **The dispatch cut was `const dispatch = 0`,** so SAAHAA's ₹5 per rider order
  appeared on no screen and a shop reading "3% of the basket" was paying 3.84%.

### Fixed — things the app said that were not true

- Signup: *"Always free — no markup"* and *"Cost per order ₹0"*, while charging
  8% on services. Now `8% on a pro's price · ₹0 on shop items`.
- `₹20  ~~₹20~~  2% off` — the saving was computed on paise and both figures
  printed rounded, so the badge announced a discount the shelf label
  contradicted. A discount now has to survive being displayed.
- **"FEES PAID ₹15"** on the account screen, for fees the cart had just promised
  came out of the shop's side and not her bill. Service markup is hers; retail
  commission is not. They are counted separately and both are shown.
- A **fully priced bill before she had said what the job was** — "Electrical
  ₹399 … You pay ₹431", then ₹689 once she picked. The rate is shown; a total
  is not a total until it is for something.
- The step counter read "Step 1 of 3" and "Step 3 of 3" **in the same sheet**,
  with no step 2 existing anywhere.

### Fixed — a wallet she could not empty

The balance capsule still rounded ₹18.70 to "₹19", so typing what the screen
showed was still refused; the "take out everything" button only appeared *below*
₹10, the one range where it mattered least; and `inputmode="numeric"` gives an
Android keypad with no decimal point, so the exact figure could not be typed at
all. Exact balances print exact, the escape hatch is always there, and the
keypad has a point.

### Fixed — the tap that was thrown away

A guest tapping ADD was bounced to sign-in, and after signing in the cart was
empty and she was on Home. The tap is remembered and replayed on the shop she
tapped it from.

### Added — Telugu and Hindi where the money is

Measured share of on-screen characters, `?lang=te`:

| Screen | Before | After |
|---|---|---|
| Partner · Earnings | 8% | **93%** |
| Partner · Live jobs | — | **100%** |
| Cart | 6.6% | **51%** |
| Home | 0% | **25%** |
| Order screen | 0% | **23%** |

163 keys across three languages, 158 render sites. The legal pages are
deliberately NOT translated: a half-translated refund policy is worse than an
English one, so they carry a notice in her language saying so.

`tools/lint-i18n.mjs` gained a check for a file that imports `t` and then
rebinds the name — every `t('…')` in that scope throws at render time and the
screen becomes the error page. It found six, one of which had already taken out
the partner console.

### Fixed — accessibility, measured rather than asserted

Raising the two type tokens fixed almost nothing, because most small type is a
hard-coded px inside a rule. Home went from **90 of 223 text elements under
12px** to 1, and from 3.76:1 accent links to **zero contrast failures** across
home, shops, account and orders. White-on-accent was 4.2:1 the other way round;
fills that carry text use a darker token.

### The third scoring pass, and the defects it named

Customer 5.8 → **6.1**, partner 7.0 → **7.2**. Both auditors independently
landed on the same sentence from opposite sides of the product, and two of the
worst findings were defects this release had introduced.

### Fixed — the pro's own quote screen swapped him with the customer

A plumber types 1200 under "You keep 100% of this", and the next screen told
him he had quoted **₹1,296** and that **the customer keeps ₹1,200 of it** — his
number handed to her, SAAHAA's markup presented as his quote. A man deciding
whether to spend an afternoon replacing a pipeline read that he was getting
₹96. The customer's copy of that same screen was correct, which is exactly how
it survived: only the earning side was told the lie.

### Fixed — round money once

Every figure went through `fmt` independently and no total was ever reconciled
against the components beside it. On one live order: `₹685 + ₹46 + ₹8` printed
under **"You pay ₹740"**; "the fee and its GST are ₹55" over two lines summing
₹54; "₹10 from wallet · ₹729 by UPI" under a total of ₹740. Her wallet passbook
— the page this product labels *"hash-chained: it can be verified, never
edited"* — summed to **minus one rupee** against a printed balance of zero.

Every paise underneath was exact. Only the display was wrong, which is the
worst version: a correct ledger failing its own published audit claim, in front
of somebody who checks that arithmetic in her head at a kirana counter.

Rounding is not distributive, so no care at each call site fixes it.
`core/money.js roundParts` derives the components FROM the rounded total and
puts the odd rupee on the largest line, where it is invisible, rather than on
an ₹8 GST line where it is a 12% error. Applied to the service bill, the
payment split on both checkouts, the shop's statement and the shop's live
payout — four places, one rule.

### Fixed — the money screens still disagreed with the ledger

The previous pass fixed the line *under* each headline and left the headline.
One scroll of the shop's console showed **₹442, ₹456 and ₹456** for one sum of
money. Both headlines now come off `legsFor`/`creditsByKind`, and the shop's
column is built so it cannot drift: `yours` is measured from the ledger, `gross`
is what customers actually paid, and every deduction between them is *defined*
as the difference. My first attempt at that column still printed
₹220 − ₹6 + ₹14 − ₹5 over ₹209, because I made "deliveries you made yourself" a
credit line while leaving it inside the total — the same defect, a third time,
introduced while fixing it.

Also: `CANCEL_FEE` counted where a whitelist of one kind had missed it, and
given the GST leg every other fee path has; `dispatchCut` finally persisted onto
the order, so SAAHAA's ₹5 stops being invisible to a shop reading "3%" while
funding 4.1%.

### Fixed — a stake promise with nothing behind it

The door-code screen told a pro that entering the code "locks ₹100 of your own
money" and that "every rupee of it comes back". For a pro with an empty wallet
neither half was true: the stake is funded from the job's own payout — which is
the right design, and is why he never pays to start — and no leg is written.
The screen now says which of the two actually happened, chosen by the same
function `lockStake` will use a moment later.

### Fixed — the doors were still in English

Both audits named this. Sign-in and create-account were **0%** Telugu, and the
kirana's console had 8 `t()` calls across 700 lines while the customer buying
from him got a nearly fully translated cart. The buyer had his language and the
earner did not, inside one product.

| Screen | Before | After |
|---|---|---|
| Sign in | 0% | **51%** |
| Shop console · Today | ~4% | **70%** |
| Shop console · Orders | ~16% | **42%** |
| Shop console · Money | ~6% | **33%** |

236 keys, 237 render sites. The shop's Items tab stays low and should: it is
product names.

### Also

The account screen's "fees paid" line matched no other screen (it added GST
where every other screen prints fee only). The sign-in screen printed three
real customers' door codes as examples — under the one-code design that string
is both a login id and a door secret, and `orders.js` already refuses to print a
specimen for exactly that reason. The pending-cart replay was wired into the
sign-**in** path only; a first-time customer takes the sign-**up** path, which
is the one this feature exists for. The active bottom-nav label measured
1.92:1, the least readable text in the product on the control that says where
you are; it is 5.38:1, and all four customer screens now have zero contrast
failures.

### The fourth pass — customer 6.1, partner 7.2 → **7.4**

The customer score did not move, and the reason was the right one: three passes
had fixed the arithmetic one panel at a time, and each pass left a new panel
behind. The auditor's prescription was to stop fixing panels and make the rule
mechanical.

### Added — a gate for money columns that do not add up

`M.fmt` rounds to whole rupees and rounding is not distributive, so any panel
that formats its lines independently and then formats their total prints
arithmetic that fails. Found across four passes:

    ₹685 + ₹46 + ₹8                     under  "You pay ₹740"
    ₹43+₹159+₹28+₹137+₹99+₹19           under  "Total ₹486"
    "₹10 from wallet · ₹729 by UPI"     under  ₹740
    "Sri Lakshmi receives ₹471"       beside  "items ₹485", "fee ₹15"

`tools/lint-dead.mjs` gained a sixth check: a block printing a total may not
also print bare `M.fmt` lines above it — the components must come from
`roundParts`/`fmtParts`. It found **three more panels immediately** (the booking
sheet's bill, the cancellation split, the cart bill), all now fixed.
Poison-tested by re-breaking the cart.

Also fixed in this pass: the grocery receipt, which summed ₹485 under a total
of ₹486 with "₹18.58 back to you" beside a difference of ₹18 — the one screen
the product invites her to check after a short weigh. The refund is now stated
as the difference between the two figures she can see.

### Fixed — the kirana's till

`shopSide` was wrong by the whole delivery he drove himself (`RIDER` is credited
to the shop while there is no rider pool, and the panel read only `shopPayout`),
it existed at exactly one of six shop stages — vanishing the moment he tapped
"Weighed & packed", after which every panel showed HER bill — and it was 0%
Telugu, on the one screen a Telugu-first shop owner touches on every order. It
now reads the ledger, renders at every stage he stands in front of, and speaks
his language.

### Fixed — a total that rounded away its own measurement

My own `roundParts` on the shop's Sales column printed `₹235 − ₹6 − ₹5 = ₹224`
two inches above a wallet reading ₹223: I had rounded `yours` — the one figure
there that is a *measurement* — to make the lines sum. A screen may round what
it derives; it may never round away what it measured. The deductions absorb the
drift now.

### Fixed — the rest of the fourth pass

- `wallet.js` still whitelisted `DEBT_RECOVERY`, so "nothing comes out of your
  rate" printed on the same screen that had just named a ₹40 cancellation fee.
  It counts every debit to a platform account, which is the lesson `partner.js`
  had already written down one file over.
- The discount badge was still computed on paise while both prices printed
  rounded: "₹99, was ₹105, **5% off**" six rows above "₹99, was ₹105, **6% off**".
  It is computed from what is printed.
- **The dark-theme nav, a regression from pass three.** Hard-coding a neutral to
  clear AA on the light nav left four of five dark labels at 1.39:1 — a failure
  by a factor of three, introduced by the fix for the same defect. All ten
  labels now pass in both themes (dark worst 6.71:1, light worst 5.38:1).
- "FAIR PRICE ₹428" sat in the largest type above "his price ₹385" — the
  category ask, never re-rendered against the job she picked.
- A paid, settled, step-7-of-7 job was filed under "Still open" with no way to
  clear it but to rate somebody.
- While she was being asked to approve a new on-site price, the bill showed the
  superseded one.
- Admin's step-up threshold read a stale `escrowed` field, so a re-priced job
  could slip under ₹5,000 on the old number.

### The fifth pass over the fourth pass's list

Every blocker either audit named, closed.

**The passbook now reconciles to the balance above it.** "BALANCE ₹18.58" sat
six lines over `+₹504 · −₹504 · +₹19`, which sums to ₹19 — under a sentence
promising every line is hash-chained and verifiable. The legs were exact and
each was rounded alone. A passbook that rounds is not a passbook: the legs print
to the paisa and so does the balance. Verified live: `+₹38.95 − ₹258.68 +
₹258.68 = ₹38.95`, matching exactly.

**The stake was locked after the screen had already painted.** `advance()`
rendered, then `lockStake` dispatched into a view that had finished drawing — so
the "₹100 committed" chip was empty on the one render where his money moved, and
appeared only if he navigated away and came back. A person is told their money
moved, or they are not told at all.

**The savings footnote held two incompatible counterfactuals under one
asterisk** — the assumption holds the pro's take-home equal, the sentence after
it silently switched to holding her price equal. A savings claim that needs two
different worlds to work is not a savings claim.

**"Receives the full ₹385" printed on a cancelled job** — a fully refunded
order, on which he received nothing and had just been charged ₹40. The sentence
had been fixed once for partial resolutions and never asked whether the job had
happened at all.

**The awaiting-payout list did not sum to its own heading** (₹209 of rows under
₹223) because each row counted `shopPayout` and dropped the delivery leg the
shop earns for driving the order. The Today tab's fee line omitted the same ₹5
dispatch cut the Sales tab had already been corrected for.

**Three sheets were still 0% Telugu** after four passes: the one that costs a
pro ₹40, the one that decides where his money is sent, and the substitution
consent that decides whether a stranger swaps her cooking oil. 260 keys.

**A kirana that sold one thing by weight.** The persona sells "loose rice, dal
and vegetables by weight"; the starter catalogue gave a whole shop exactly ONE
variable-weight line, so the scale, the short-weigh refund and the reweigh cap —
the most carefully built machinery in the app — could appear on one row of a
thirty-seven item shop. Dal is bought by the kilo from a sack in Hyderabad and
is listed that way.

Also: a paid, settled, step-7-of-7 job filed under "Still open" with no way to
clear it but to rate somebody; admin's ₹5,000 step-up threshold reading a stale
`escrowed` field, so a re-priced job could slip under it on the old number.

### The fifth pass — both scores went DOWN, and both causes were mine

Customer 6.1 → **5.9**, partner 7.4 → **7.2**. Two regressions from the fourth
pass's fixes, and they are the most instructive thing in this release.

**`roundParts` invented ₹9 and made the product call itself a liar.** The cart
called `roundParts([shopPayout, platformFee], itemsTotal)` — but those two do
not sum to the basket: the rider's ₹14 and SAAHAA's ₹5 dispatch sit between
them. So the helper read a ₹19 gap as rounding drift and split it across the
two lines, printing SAAHAA's ₹20.31 fee as **₹29** on a screen where the app
promises "never more than ₹25". A display helper disagreeing with the engine by
₹9 is worse than the misalignment it was written to fix.

`roundParts` now refuses: if the parts do not sum to the total within a rupee
or two of genuine drift, it says so and falls back to the parts' own total.
Wrong alignment is recoverable; a fabricated figure on a money screen is not.

**A missing import crashed the shop's only withdrawal screen.**
`flags.isOn('RIDER_POOL')` was added to `partner.js`, which does not import
`flags`. Every gate passed — a free variable is legal JavaScript until it runs —
and the line only executes once a shop has a live retail order. So the screen it
took down was Payouts: the one screen with the withdraw control, broken on
exactly the days a kirana is trading.

`tools/lint-dead.mjs` gained a seventh check: a name this repo uses as a module
namespace, dot-called in a file that does not import it. The general
free-variable version produced 38 findings, almost all false — the failure this
file warns about twice — so it checks the one shape that actually bit, and
decides "is this a local?" by asking whether the name ever appears as anything
other than the object of a dot-call. Poison-tested: parse and 301 tests pass on
the crashing build; this catches it.

### Fixed — the rest of the fifth pass

- The cart's item rows summed ₹678 under "you pay ₹677", and the same basket
  rendered ₹283 on the shelf and ₹282 on the order she was charged for.
- "₹63 kg · 3 · ₹188" — 63 × 3 is 189. A price with paise in it prints them.
- "You save ₹175" where ₹498 − ₹324 = ₹174.
- The two counterfactuals were separated onto two screens rather than
  reconciled: the booking sheet said the pro is paid the same either way, the
  order screen ten seconds later said he was paid more.
- The Telugu "the whole ₹X is yours" printed `o.deal` — the superseded estimate
  on a repriced job, and a live figure on a cancelled one he was charged ₹40
  over. The English branch had been fixed for both; only the earning side, and
  only in his own language, was still wrong.
- The awaiting-payout rows dropped the delivery leg the heading includes
  (₹314 under ₹328); the Today row understated the same order by the same leg.
- "₹328 settled on ₹324 of orders this month" — `mGross` summed `itemsTotal`
  while `gross` summed `customerPays`, so he was told he was paid more than his
  orders were worth.
- "₹17 from wallet · ₹999 via UPI" under ₹1,017.
- The no-show sheet printed four bare figures under a comment claiming they were
  rounded together. They were not.
- A settled job sat under "Happening now" on Orders — the fix had been applied
  to Account and the other screen kept its own copy of the predicate. There is
  one `isDone` in `domain/orders.js` now, and both screens call it.

### The sixth pass — customer 5.4, partner 7.3

The customer score fell again and the cause was, again, a fix of mine.

**Her finished job disappeared entirely.** Making `SETTLED` count as "done" was
right; splitting the list on `!isDone` for live and `isTerminal` for past was
not. `SETTLED` is done without being terminal, so it belonged to neither — the
header counted two orders over a list of one, and the receipt for the job she
had just paid for, with its proof-of-work photo and unrated stars, was simply
gone. Two predicates meant to partition a list must be one predicate and its
negation, or they leave a hole.

**The `roundParts` guard was load-bearing.** An audit drove one ordinary
shopping session and tripped it FIVE times, on five different screens, while
301 tests and the textual money lint all passed. The screens read correctly
because the fallback rescued them, not because their callers were right. A
safety net holding the floor up is not a safety net.

It now throws under `__SAAHAA_STRICT`, which the test runner and the journeys
set, and all five callers were wrong in an interesting way:

- the cart added the rider and dispatch to the basket even when SHE paid the
  delivery, so ₹19 that belonged to the delivery fee was pushed into the basket;
- `paidWith` fitted what she actually paid into what the order costs AFTER a
  short weigh — two different numbers;
- both bill shapes were computed for every order, so a retail order ran the
  service arithmetic and a service order ran the retail one;
- the no-show sheet folded a goodwill credit into what she paid, when the credit
  is SAAHAA's own money on top.

**And redistributing drift put it on the line she checks.** A ₹677.41 can showed
₹677 on the shelf and ₹676 in the cart, because `roundParts` dumps the
correction on the largest part — which on a grocery column is always the item
she remembers the price of. Fee, GST and payout are parts of one whole and must
be made to sum; seven grocery lines are seven independent facts, and forcing
them to sum is asking one of them to be wrong. Each line now prints its own
honest rounding and the basket shows paise when they disagree.

### Fixed — the shop was told it had never been paid

`shopWithdraw` posted the ledger leg and never wrote `paidOut` — a field only
the ADMIN route sets — while the Payouts tab derives "sent to bank" and
"awaiting" from exactly that field. Seconds after the toast said "₹196 sent to
srilakshmi@ybl", her screen read SENT TO BANK ₹0, AWAITING ₹0, and "No payout
has cleared yet" above a list still showing the ₹196. Permanently: on the shop's
own exit that field could never become true. 8.6.0 gave the shop a withdraw
button and did not give it the write. Verified live: **SENT TO BANK ₹155 · 1 paid**.

### Fixed — the rest of the sixth pass

- The accept row printed three numbers that contradicted each other: "Customer
  pays ₹244 · SAAHAA fee ₹7 already taken off" beside "₹232 to you". She does
  the subtraction, gets ₹237, and the panel one tap away reconciles — so she
  learns the row lies rather than the panel.
- "Riyaz's price ₹403" and "receives the full ₹402", ten words apart, on three
  screens. The prose now prints the same rounded figure as the line.
- A pro who cancelled got no panel at all — no ruling, no mention of the ₹40
  just taken, and the only sentence was written to the CUSTOMER about him in the
  third person. He had to find the Earnings tab to learn what happened to his
  own job.
- The delivery tracker — the screen she refreshes while waiting — printed the
  engine's English. The translations existed and only the header used them.
- The shop's Payouts tab, where her livelihood leaves the app, was 24% Telugu:
  the sheet behind the button had been translated and the button had not.
- The pro's first two job screens, the first thing he sees on every job, were 0%
  and 13%.
- "The customer pays ₹2,052" over "₹1,236 collected" at AWAITING_APPROVAL, with
  nothing saying the rest is taken when she agrees.

### Fixed — a re-weighed order's own arithmetic

The most serious thing in the sixth pass, and it hid behind a correct ledger.

After a short weigh the re-quote scaled `itemsTotal` down by the rider's fee —
right when SHE paid for the ride, wrong when the shop absorbed it under free
delivery, where that ₹14 comes out of the shop's margin and not her basket. So
the shop's own screen read **"Basket ₹1,362" under "Total ₹1,376"**: a basket
nobody ever ordered, which is the exact lie the comment above that line forbids.

And `dispatchCut` was never re-patched, so it kept the figure from placement
while its counterpart had moved. `shopPayout + platformFee + riderPayout +
dispatchCut` came to **₹5 more than was ever collected**.

The ledger stayed right the whole time, because settlement distributes the
residual rather than trusting the order's fields — so no invariant fired, no
test failed, and every screen reading those fields was quietly wrong. A record
whose parts do not sum to its own total is wrong even when the money is right.

The cap exists for one case: she weighed heavier than she agreed. In every other
case the re-quote is already a coherent quote and is now used as it stands.
Scaling a correct quote is how it stopped being one.

`tools/journey.mjs` gained three assertions on the ORDER, not the book: items +
delivery equals what she is charged, the allocation equals the collection, and
the basket shown is the basket weighed. Poison-tested by restoring the old
arithmetic — all three fail, showing ₹455 shown against ₹469 weighed.

### Fixed — "3% of the basket" was true only in the middle

A ₹5 floor and a ₹25 cap mean the printed percentage is wrong at both ends: ₹25
on a ₹1,413 basket is 1.8%, and the ₹5 floor on a ₹111 basket is 4.5%. The
sentence states the rule now — "3% of the basket, at least ₹5 and never more
than ₹25" — on her cart and on the shop's own fee line.

### The seventh pass — customer 5.4 → **6.0**, partner 7.3 → **7.6**

Both up, and for the first time the engine came back clean from both sides: no
`roundParts` guard trip anywhere in a full session, every order allocation and
every wallet chain reconciling to the paisa. What was left was the display layer
disagreeing with itself about the number she is asked to authorise.

### Fixed — one number for one job

A ₹402.40 quote rounds to ₹403 as part of a bill and to ₹402 on its own, and
eight places printed it raw. So she was shown **"Confirm & release ₹402"** four
inches under a bill reading ₹403, the pro read "receives the full ₹403" directly
above "the whole ₹402 is yours", and the settled review card said ₹402 again.
That is the single moment this product exists for — authorising a stranger's
payment — and it disagreed with itself.

`M.fmt(o.deal)` no longer appears in that file. The first attempt at this
replaced them with `billRow[0]`, which is only in scope inside the detail view,
and painted the error page on three other screens; the rounding is a property of
the ORDER, so it is a function that takes one. Verified live: held, button, bill
and prose all read ₹403.

### Fixed — the receipt and the shelf rounded differently

The cart rounds each line honestly; the receipt forced its column to sum and
dumped the drift on the largest line — so a ₹702 can was ₹702 on the shelf,
₹702 in the cart and **₹701 on the order**, with the rupee appearing only after
she had paid. Two regimes for one shelf is the defect either way round. Both
screens now round each line honestly and print the basket to the paisa when the
whole-rupee column cannot be added up.

### Fixed — a bill that claimed money SAAHAA had not collected

At `AWAITING_APPROVAL` the pro read "The customer pays ₹2,052 … receives the
full ₹1,900 — SAAHAA holds it", while escrow held ₹1,017. The clause that
explains the gap existed and never fired: it compared against `customerPays`,
still the estimate, while the bill above printed the proposal. He would have
started a ₹1,900 job on the strength of an escrow holding half of it.

### Also

- The shop's Today tile printed "FEES TODAY ₹30" under "capped ₹25 an order" —
  self-contradicting on its own line, because it merged the ₹5 dispatch into the
  figure and kept the fee-only caption.
- Her cart said "receives ₹1,182 · SAAHAA takes ₹25" on a bill of ₹1,256, with
  ₹49 unnamed — the delivery the shop was covering so she saw "free".
- The pro's entire balance left on one tap while the shop got a confirmation
  sheet. Both now share one sheet, and both can send a part of it.
- `ESCROW[tier].label` is an English constant that was dropped into an
  otherwise-Telugu sentence.

### Added — a gate that moves real money

Every gate this repo had checks shape, pure functions, or a bundle that paints.
None of them drove an order from cart to settled and asked where the rupees
went — which is exactly how one bug shipped five times past all of them, and
why the fifth generation was found by placing a single order in a browser.

`tools/journey.mjs` wires the real store, the real reducers and the real flow
under Node, and runs five journeys: a basket weighed short across a
free-delivery threshold, a job booked-coded-done-settled, a pro cancelling
mid-job, a customer cancelling en route, and a survey job priced on the
doorstep. It asks `checkInvariants` after **every** step — including the
stranded-escrow check that had no caller for four audits — and every journey
must end with that order's escrow at exactly zero. 24 book checks, 76
assertions.

Poison-tested by re-introducing generation five: it reports the refund as
₹40.46 where ₹59.46 was owed, which is the delivery fee creeping back. The
first version of the gate did NOT catch it — ordering 1.1x the threshold and
dropping one unit left the basket still above the line, so the scenario never
bit. That is the same defect the old reweigh unit tests had, reproduced inside
the gate written to catch it. The weights now straddle the line and the
straddle is itself asserted.

### Added — the twenty-four words the whole product is navigated by

Every audit since the third has said the same thing in different words: the tab
bar is in Telugu and the product is in English. This pass went after the single
largest cause of that, which is not a screen at all. The 24 category names --
`Home Repair & Carpentry`, `Grocery & Kirana`, `Meat, Fish & Eggs` -- are the
first thing on Home, the title of every category sheet, the trade printed on
every pro's profile and the label on every row of the orders list. One table,
four screens at once. A customer with a Telugu cart still navigated the entire
product in English, because the names lived in the engine's catalogue as
`cat.name` and every view printed that field directly.

The catalogue keeps English as its source of truth -- it is data, and the engine
compares against it. What a SCREEN prints now goes through `catName(c)`, which
looks up `cat.<id>` and falls back to the English name when a category has no
key yet, so adding a category can never paint a raw key at a customer. 29 render
sites across seven view files were routed through it.

### Fixed — the lint that could not see a family of keys, and the hatch that fixed it

Routing those names through the translator broke `tools/lint-i18n.mjs`: it looks
for each key as a literal string, and `t('cat.' + c.id)` never spells one out.
It called all 24 "translated for nobody" and failed the build on a family
rendered on four screens.

The fix is a mirror of the existing "stem" rule -- that one understands
`t(x + '.suffix')`, a fixed suffix on a varying stem; this one understands a
fixed PREFIX with a varying tail. It also had to read `i18n.js` itself, which
the lint deliberately excludes, because the family's one lookup lives there.

And then the same tie-down the stem rule needed. This file's own header
describes how the stem hatch matched its prefix ANYWHERE in the tree and
therefore certified a dead key as rendered -- "a measurement that tells you what
you hoped is worse than no measurement". A prefix hatch matching on the prefix
alone would pass `cat.zzz` for ever: nothing renders it, no category has that
id, and the lint would call it rendered anyway. The tail must be a real id -- a
whole quoted string somewhere in the tree. Poison-tested: an invented
`cat.zzznosuchcategory` fails the build; removing it passes.

Coverage went from 40 render sites to 310, and `MIN_SITES` was raised from 40 to
300. It is a ratchet, not a target: it exists so this can never quietly slide
back.

### The eighth pass — customer 6.0 -> **5.0**, partner 7.6 -> **5.0**

Both scores fell, and both auditors used the same words: "not close". The
customer could not finish a single transaction; the partner was told his own
quote was "Lost" on a job he was standing in. Neither is fixed here. What is
fixed here is the arithmetic they could both check by hand, and the gate that
was supposed to be checking it for them.

### Fixed — the gate that certified the worst receipt in the app

`lint-dead.mjs` has a check for "a total its own lines do not sum to". It read
the NAMES `Row[`, `billRow` and `retailRow` as proof that a column had been
reconciled. `billRow` had been -- it comes from `roundParts`. `retailRow` had
not: it is `retailParts.map(v => M.fmt(v))`, every line rounded on its own. The
gate written to catch exactly this defect waved the defect through because of
what the variable was called.

So a customer adding up her grocery receipt got

    28 + 279 + 142 + 344 + 42   beside   Total 836.76

An alias is now guarded only if its own definition traces back to
`roundParts`/`fmtParts`, and an alias that does NOT is counted as evidence
rather than as silence -- the receipt printed no bare `M.fmt` at all, so a check
that only counted `M.fmt` saw an empty column above the total. This is the same
mistake as the i18n stem hatch, in the file that exists to stop it.

The fixed gate immediately found a second candidate, `home.js:1343` -- which
turned out to be a FALSE POSITIVE of the new rule, because `bookRow` is assigned
straight from `M.fmtParts(...)` rather than mapped. The resolver understands
both shapes now. Checking that before "fixing" correct code is the only reason
the booking sheet still works.

### Fixed — a receipt that stopped exactly half way

The receipt already noticed when its column could not be added up in whole
rupees. Its response was to move only the TOTAL to paise, which does not make a
column checkable -- it makes the mismatch visible and leaves her wondering who
took the rupee. If the receipt descends to paise, the whole column descends with
it. That is also the regime that agrees with the shelf price and the cart, both
of which already say 28.49.

### Fixed — the same job read ₹540 on one screen and ₹539 on the next

`roundParts` puts rounding drift on the largest line, "where it shows least".
On a job bill the largest line is the worker's own quote -- so SAAHAA's rounding
was taken out of his price. And because the booking sheet splits the bill in two
(`[deal, uplift]`) while the order screen splits it in three
(`[deal, fee, gst]`), the drift landed differently and the same job read **₹540**
on the booking sheet and **₹539** on the order screen, with "You keep the whole
₹540" printed two paragraphs under the ₹539. Both screens were internally
consistent, which is why every gate passed.

A caller may now nominate the line that absorbs the drift. SAAHAA's own fee
absorbs it; the worker's quote never does. `540 + 36 + 7 = 583` on the order
screen, `540 + 43 = 583` on the booking sheet, and the two agree on the one
number the pro was promised. That is not a display preference -- "the pro keeps
the whole of their price" is the product.

### Fixed — a payout sheet whose headline did not follow the amount (mine)

The partial-payout field added earlier in this same pass left the sheet title
formatting the balance once, at render. A pro typed 200, read "Send ₹698 to
ramesh@upi?" directly above "This goes out now and cannot be pulled back",
pressed Send, and ₹200 went. The transfer was right and the sentence he
authorised was wrong, on the one screen in the product that is explicitly
irreversible. A number that can change does not belong in a title rendered once:
it sits on the button that performs the act and tracks every keystroke.

### Fixed — the auction, which no journey had ever touched

Three defects lived in the ask flow at once, and every gate passed the whole
time because every gate was looking at settlement.

**The clock lied by a factor of three.** `WINDOW.now` is twelve minutes; the
screen printed `usually done by ${mmss(total / 3)}` -- the window divided by
three -- as though it were the deadline, on the stated reasoning that "a 12:00
countdown reads as a twelve-minute wall and drives people straight out". Hiding
the wall does not remove it. An auditor waited past 4:00 to 5:06, saw the same
sealed rates, and concluded the auction had hung; it had eight minutes left. The
true story is kinder than the fiction anyway -- the held price is bookable at
any second and only the SEALED rates wait -- so the screen now says when they
open and stops pretending that is a deadline she is trapped behind.

**The platform bid against the worker under his own name.** The held match is a
price SAAHAA computes from a pro's listed rate and prints beside his photograph.
When that pro also answered the ask, he was on the screen twice at two prices,
directly beneath "Price locked before you book" -- and `bookHeld` booked the one
he did not write. SAAHAA offered ₹583 "from Ramesh Yadav" while Ramesh had
quoted ₹560, and that was the only price the customer could accept. His own
quote stands now, she pays the lower of the two, and he keeps one row.

**And then it told him he had lost it.** `bookHeld` dispatched
`bid/rejectOthers` with `keepId: null`, rejecting every bid on the request --
including the bid of the pro who had just won the job. His LEADS tab showed
"Lost", set his win rate to 0%, and answered "tap to see why" with "This job was
not awarded to anyone", while the job sat in his JOBS tab in progress.

**Journey 6** now drives exactly this shape and asserts all three. Poison-tested:
reverting either fix fails it.

### Fixed — a headline that divided one population by another

The pro's Earnings header read

    YOU KEPT ₹752 — from ₹540 quoted · you keep 100%

`kept` is read off the ledger: every credit that reached him, including the
compensation for a job the customer cancelled en route. `quoted` summed `o.deal`
over SETTLED orders, which that cancelled job is not. So it printed 139% beside
the words "you keep 100%"; earlier in the same session it printed 93%.

"You keep 100%" is a claim about the fee model -- SAAHAA's percentage is added
on top and never deducted from his rate. It is true and it does not need a
fraction to say it. The caption now names what actually reached his wallet.

### Fixed — a shop's money had an exit he could not find

An audit ran a kirana to ₹1,065 of settled takings and reported that the money
had no way out and that no UPI id had ever been asked for. The balance, the UPI
field and the Take out button are all real -- and all on the Payouts tab, while
tapping MONEY landed on Sales. When a kirana owner taps MONEY the question is
"where is mine and how do I get it". Payouts leads now.

(The same report said the two sub-tabs render identical content. They do not --
`shopMoney` and `shopPayouts` are different functions with different bodies --
and that claim was not reproducible, so nothing was changed for it.)

### Added — the pro's passbook

THE CUSTOMER GOT A HASH-CHAINED LEDGER AND THE WORKER GOT FOUR TILES. Her wallet
lists every leg to the paisa under "it can be verified, never edited". His screen
asserted the same money in prose: a ₹100 stake, a 10% holdback, a ₹40
cancellation fee and ₹111 SAAHAA kept on a job he was never shown -- four
charges, none itemised anywhere he could look. The audit put it plainly: "every
rupee taken from me is asserted, never itemised", and scored the platform 5/10
on exactly that.

The engine could always do this. `legsFor` was added rounds ago and the DEBT
account earlier in this same version. Nothing was missing except the screen.

His money lives in four pockets and all four are read: the wallet, the holdback
that waits seven days, the stake locked against a live job, and the debt account
a cancellation fee posts to when his wallet is empty. A passbook showing only
the wallet would hide the three that hurt.

### Fixed — and the list of pockets is no longer written in the view

The first version of the passbook hard-coded its four accounts -- the same
whitelist shape that `takenByUs`, twenty lines above it in the same file, had
already been rewritten to avoid. Grow a fifth pocket in the engine and the
screen goes on showing four, silently, and a charge he was never shown becomes a
charge he cannot find.

`domain/ledger.js` owns the list now (`partnerAccounts`), and journey 3 asserts
that no account in the book carrying his id falls outside it.

**The first version of that assertion was inert.** It read only `e.legs`, and the
book has used two shapes; with `DEBT` deliberately deleted from the list it still
passed. It reads both shapes now, and the poison test fails as it should. A gate
that cannot fail is not a gate -- which is the whole lesson of this version, met
one more time, in the check written to enforce it.

### Fixed — ?demo=1 was STILL a one-shot, one fix later

The guard was `if (!store.getState().seeded)`. A plain first visit seeds EMPTY
and sets `seeded: true`, so every device ever opened without the flag was
permanently immune to it -- and `SIM_MARKET` is set inside that same dead block.

This is what wrecked the eighth customer audit. They signed up on the empty
build, opened `?demo=1`, and sat looking at "0 pros · 0 shops". Nobody was ever
on the other side of a single one of their orders, so every order froze at
"step 2 of 7" and they reported the product as unable to complete a transaction.
It could. There was simply nobody home. Three of their fifteen findings trace
back to this one line.

`?demo=1` means "make this device a demo device", and it has to mean that on the
second visit too. The simulator is switched on regardless; a device whose roster
is EMPTY gets the roster. `users` is deliberately untouched -- whoever is signed
in stays signed in, and a populated device is never overwritten by a query
string. Verified in a live browser: 0 pros / 0 shops on the empty build, then
111 partners, 12 shops and 276 products after the flag.

### Fixed — a money column that counted two different sets of orders

Driving the fixed build in a browser, `roundParts` printed its own guard:

    parts sum to 53109 but were given a total of 53767

₹6.58 off, on the shop's money screen, falling back silently in production.

`yours` summed every SHOP_PAYOUT and RIDER credit in the book, all time.
`gross` summed `customerPays` over `done` -- settled orders carrying a payout.
Whenever the ledger held a credit for an order `done` excludes, the deductions
came out negative and `Math.max(0, ...)` swallowed the excess, so the column
quietly stopped summing to its own total.

It is the same defect as the pro's "YOU KEPT ₹752 from ₹540 quoted" header fixed
above: an arithmetic relationship asserted between two populations that are not
the same set. `yours` is still read off the ledger -- it is the one measured
figure there -- but only for the orders this column is about. The "includes ₹x
you delivered yourself" note underneath it was scoped the same way; an all-time
figure there would have reintroduced the mismatch one line below its own fix.

Worth recording how this was found: not by reading, and not by a gate. By
opening the built app and reading the console. The guard added earlier in this
version was the only thing in the product that noticed.

### Fixed — a service booking that went through with no address

The CART blocks this: "Fill in the flat or house and street above". The path
that sends a human being to a door did not. An audit confirmed a booking with
the street field blank -- it charged her, dispatched Riyaz, and showed no
address anywhere on the order; his job card read "No door number was given for
this one." The guard is in `confirmBooking` rather than on the button, because
the "Someone else" list books straight from a row that renders no fields at all.
A grocery bag can be collected. A plumber cannot guess.

### Fixed — the agreement named every duty he takes on and nothing SAAHAA takes

Five terms, all obligations, signed at step 7 -- and only afterwards did the app
mention a 10% holdback, a stake locked against a live job, a cancellation fee,
and that the fee is "added to what you owe if your wallet is empty". The audit
called the debt line flatly incompatible with the "₹0 to join, ever" it had been
recruited on, and named it the reason it would not run a month's income through
the platform.

Every one of these is defensible; none was disclosed before he committed, which
is the only thing that made them indefensible. They are terms six and seven now,
in all three languages, above the button.

The recruiting page already named the stake and the holdback with the rupees --
that half of the audit's claim was wrong, and it was checked before changing
anything. The cancellation fee and the debt were genuinely absent, and are now
named there too, as what they are: the one charge SAAHAA makes.

### Fixed — the customer's account screen, handed the worker's jobs

`myOrders()` is role-aware: for a pro it returns the orders he WORKED, for a
shop the orders it FILLED. Every figure on the account page reads them as things
the reader BOUGHT. So a plumber's own account told him "MY REGULARS: Ramesh
Yadav · 3 orders" -- himself -- and "FEES YOU PAID ₹43", which is the fee his
CUSTOMER paid on his own job, on a platform whose promise to him is that he pays
nothing. A shop was likewise its own best customer.

One person holds one code and may be both. This page is about what they bought,
so it asks for exactly that. Their earnings have their own console, their own
wallet, and now their own passbook.

### Fixed — a pro told the customer's half of the door code

The ID panel explained his own code as "the code you read out at your door, so
the pro can prove they turned up" -- customer copy, under a P2026… heading, to
the man who IS the pro. And onboarding step 1 said "Customers type it at their
door to confirm you turned up", which is backwards: the journey proves the
mechanic (`verifyOtp(o.id, cust.code)`) -- HE enters THEIR code. Step 5's quiz
had it right, so the two screens taught opposite things and an audit came away
unsure which was true. Both say the same thing now, in all three languages.

### Added — the bill, and the consent, in the language they are read in

Both audits said the same thing in different words: **the Telugu is best where
the news is good and worst where money and consent live.** Category names were
translated; the bill was not.

The order bill is the one screen both a customer and a pro open to find out what
they are owed, and it was entirely English under a Telugu tab bar -- "THE BILL",
"SAAHAA platform fee", "GST on that fee", "The customer pays", and the sentence
naming the 8%. All of it now goes through the translator.

And the background-check step asked a Telugu-only tradesman to tick a box
agreeing to a **police verification** -- in English, on a screen whose every
other line the product had already translated for him. Of everything left in
English on the earning side, this was the one that was not merely rude: consent
he cannot read is not consent. The reference fields, the request button and the
in-progress notice went with it.

Coverage 310 -> 324 render sites; `MIN_SITES` raised 300 -> 320.

### Fixed — "SAAHAA rider" was an option with nothing behind it

`RIDER_POOL` is a canary and it is OFF: there is no rider, no rider identity and
no hand-off step. A shop that selected it still drove the order itself, still
earned the delivery leg, and still typed the customer's code at the door. The
setting changed nothing at all, and an audit listed it among the reasons it
would not trust the platform.

Do not offer what the build cannot do. While the pool is off, the rider choices
are shown as coming and cannot be selected, and the caption says plainly that
every delivery is one the shop makes -- and is paid for.

### Added — gate 8: two totals that need not count the same orders

Three times in this one version the same defect shipped: an arithmetic
relationship asserted between two totals that do not describe the same set of
orders. "YOU KEPT ₹752 from ₹540 quoted · you keep 100%". `yours` (all-time
ledger) minus `gross` (settled orders only), ₹6.58 adrift. Each figure was
individually correct, each came from a real source, and the book balanced --
the two simply counted different things and were then subtracted.

A total read off the LEDGER may only be set against a total summed over an
ORDER LIST when it has been restricted to that same list.

**Getting this gate to work took four attempts, and each failure is worth
recording, because every one of them looked like success:**

1. It matched on the ledger CALL, so provenance stopped at `credits` and never
   reached `yours`, the name the arithmetic actually uses. Inert.
2. Provenance was made to travel -- but the shell heredoc that wrote the code
   ate a backslash level, so `new RegExp('\b' + v + '\b')` became a BACKSPACE
   character rather than a word boundary. Still inert. The guard written to
   catch that then used the same backspace byte in its own assertion, so it
   passed while checking nothing.
3. The real cause was **CRLF**. The check split on `'
'`, leaving a `
` on
   every line, and `
` is a LINE TERMINATOR in a JS regex -- so `(.*)$` could
   never match a single line of this repo. The classification loop above it has
   no `$` anchor, which is the only reason half the check appeared to work.
4. Once it finally fired, it fired on the code that FIXES the defect: the guard
   looked for the restriction eight lines from the wrong variable. And it
   flagged the shop's aggregator sentence, matching the English words "you
   kept" against a variable in another function -- the check is file-scoped, and
   a sentence is not arithmetic.

Clean tree: no findings. Poisoned tree: fires on the exact line. Both verified.

Four wrong versions of one check, three of which reported green. That is the
whole argument for poison-testing every gate before believing it -- and this
file now contains four separate comments explaining a check that certified what
it was written to catch.

### The ninth pass — customer 5.0 -> **6.0**, partner 5.0 -> **6.0**

Both sides moved a full point and both still say no. The round-8 fixes were
confirmed by people who did not know they had been made: the blank-address
booking is blocked and focus moves to the field, the demo trap is gone, the
reweigh protection reads "She is not charged the extra", and the customer's
wallet ledger reconciled to the paisa across ELEVEN movements -- a booking, a
settlement, a grocery order, a full return, a withdrawal and a cancellation.

### Fixed — two defects I introduced in the passbook I added last round

**The passbook asserted a total its own lines do not sum to.** The footer said
"In your wallet now: ₹936.00" under a column adding to ₹1,048 -- the difference
being the holdback, which is one of the four pockets those lines deliberately
cover. Every reading was off by exactly the pending balance. That is the defect
this version has built three gates for, committed inside the screen written to
fix a different one. The column says what it adds up to, and then names the
split.

**And the header called gross "reached your wallet".** "YOU KEPT ₹1,248"
directly above "₹1,288 reached your wallet". ₹1,288 came in; ₹1,248 stayed,
after a ₹40 cancellation fee the headline above already accounts for.

### Fixed — "You were not paid for it", beside a payment

A pro whose customer cancelled en route read, on his own job screen: "You were
not paid for it, and ₹363 went back to the customer." His passbook showed
`Compensation +₹168.00` for that very job, and her cancel sheet had already told
her he keeps it.

`split.worker` was posted to the ledger and written nowhere on the ORDER, which
is what that screen reads. Whatever the book pays him, the order now records --
asserted in journey 4, poison-tested.

### Fixed — the savings on the screen where she picks who enters her house

Three quotes, three wrong figures: ₹396 shown as "₹457 less than held" when the
two numbers on screen differ by ₹441, and two pros quoting the IDENTICAL ₹403
credited with ₹434 and ₹450 of saving side by side.

`less` was a difference of DEALS, and `gapP` multiplied it by the RIVAL's
markup -- while the held price beside it had been priced at the HERO's. A tier-4
pro pays 6% and a tier-2 pays 8%, so the gap was overstated by ₹16.

Same rule as the receipt and the shop's column, now applied a fourth time: a
number describing the relationship between two figures on a screen is derived
from THOSE FIGURES, as displayed.

### Fixed — the sheet still moved his price after Confirm

The order screen was taught to let SAAHAA's fee absorb the rounding; the booking
sheet was not. So the same job read ₹403 on the sheet and ₹402 the instant she
confirmed, under the headline "Price locked before you book".

### Fixed — ₹25.87 she was given and never told about

A basket that weighs HEAVIER than ordered is absorbed by the shop, but the item
lines print the weighed quantity -- so her column summed ₹2,530.78 above a total
of ₹2,504.91 with nothing between them. The shop's screen says "She is not
charged the extra"; hers did not. Good news, invisible, on a receipt that then
failed to add up.

### Fixed — the cart stopped half way, exactly as the receipt had

Four rows reading ₹282, ₹517, ₹65 and ₹1,642 summed to ₹2,506 beside a total of
₹2,505. The check was right and the response was half: it moved only the
subtotal to paise. If the column descends, all of it descends.

### Fixed — a pro with ₹936 was shown "BALANCE ₹0"

The account page renders the CUSTOMER wallet, which is the right thing for it to
render. But a pro or shop opening "You", under a header reading YOUR PRO ID, met
a zero balance, "₹0 FEES YOU PAID" and "Where refunds and take-outs go — Not
set", while their earnings sat in another console with a UPI id already saved.
Two audits in a row called this disqualifying. The customer wallet keeps its own
name now, and the earnings say where they are.

### Fixed — the shop's payout screen answered two questions under one heading

**"SENT TO BANK ₹0 · 0 paid"** and "No payout has cleared yet" sat two inches
above a ledger line reading "Sent to your UPI −₹300". Both counted ORDERS
carrying a `paidOut` flag -- but a withdrawal is not an order, and a PARTIAL one
cannot mark a whole order paid at all. What has been sent to a bank is what the
ledger sent to a bank, and the PAID OUT list shows withdrawals.

**"AWAITING PAYOUT" read ₹555 on its tile and ₹855 in its list.** The tile is
the wallet -- what the ledger says is takeable now -- and the rows are the
settled ORDERS that money came from. After a ₹300 withdrawal the two cannot
match, because a withdrawal cannot be subtracted from an order. Neither figure
was wrong; they were answers to different questions printed under one heading.
The rows say what they are, and the money already taken out is named.

Three of my own mistakes went into that fix and are worth recording:

- There are **two `shopLegs`** in this file, four hundred lines apart -- a
  module-level helper yielding `{ e, d }` and a local const yielding
  `{ kind, delta, ts }`. I filtered the wrong shape, which matches nothing and
  reports a confident zero: the bug being fixed.
- I put backticks around a name in an HTML comment **inside a template
  literal** -- the exact trap `lint-parse.mjs` exists for. The bundle stopped
  painting and the parse gate named the file in one line.
- **Gate 8 fired on my own new code**, its first real catch, and it was a false
  positive: `sentOut` is nothing but the sum of `outLegs`, the same rows.
  `OVER_LIST` calls any `X.reduce(` an order-list total and ran first.
  Provenance beats shape now -- a total summed over ledger legs is a ledger
  total, whatever sums it. Clean tree 0, poisoned tree still fires.

### Fixed — a day's takings that counted an order which came back

"SALES TODAY ₹1,371 · 2 orders" on a day the shop took ₹855. One of the two had
been returned in full and refunded from escrow -- the shop was never paid for it
and its own ledger correctly shows nothing -- yet the dashboard headline still
counted it. `R_CANCELLED` was excluded and the RETURN stages were not, which is
the distinction every money screen below it already makes.

### Fixed — the cap on his first jobs, disclosed after he agreed

The ₹1,500 limit on early jobs and the manual review of the first payouts
appeared on the "you are live" screen -- one tap PAST the agreement. It is the
single most consequential fact about a new pro's first week, because it decides
which jobs he may take at all. Both are on the recruiting page now, with the way
out of them: three jobs with no complaint and the cap lifts by itself.

The same block also names what SAAHAA keeps when the CUSTOMER cancels -- the
audit found "the only money SAAHAA ever takes from you" hard to square with the
₹74 kept on a cancelled job, and it was right.

### Added — the ledger, in the language the ledger is read in

Both round-9 reports named the same thing: the pro's passbook and the shop's
book were English tables on Telugu screens. One label read

    Stake release · ష్యూరిటీ

-- half the sentence in each language, inside a single label, because the pocket
had been translated and the kind had not.

These are the words for the money that moved. They lived in a constant
(`SHOP_LEG`, aliased as `LEG_LABEL` four hundred lines later, serving two
consoles under two names) rather than in the translator. There is one family
now, `leg.<KIND>`, keyed off the ledger kind itself and shared by both consoles;
a kind the engine grows without a word here falls back to its readable English
rather than to a blank or a raw SCREAMING_CASE constant.

Coverage 326 -> 328 render sites; `MIN_SITES` raised 320 -> 325.

### Fixed — the i18n lint read a family prefix as a key

`t('leg.' + kind)` makes the ASKED scan capture the literal `"leg."` and report
it as an undefined key. The same shape had been passing for the `cat.` family
only because that accessor lives in `i18n.js`, which the scan deliberately
excludes -- so one identical construction passed in one file and failed in
another. A key ending in a dot is a prefix, not a key.

(And the accessor had to be written as `t('leg.' + k)` on one line: built up
over two statements, the lint cannot see the family at all and calls all twenty
keys dead. That is the second time this exact shape has caught me, after
`catName`.)

### Added — the account screen, which was ~94% English on both earning sides

The screen a person opens to find their money: the wallet, the balance, the two
buttons that move money, every section heading and every legal link. 27 render
sites, three languages.

### Fixed — the coverage number could not see half the app

Adding those 27 sites moved the reported total by ZERO, which is how this was
found.

`BOUND` exists to stop `get(`, `esc(` and `format(` counting as translator
calls, and it does that by refusing any `t(` preceded by a word character or a
DOT -- which also refuses every `i18n.t('…')`. `account.js` and `app.js` hold 53
of those between them. The ratchet has been measuring a subset of the app and
calling it the app, for as long as the ratchet has existed.

Worse, the ASKED scan had the same blind spot: a key only ever requested as
`i18n.t('x')` was never checked against the table at all, so a typo there fell
back to the key name on screen and no gate said a word. Poison-tested: a bogus
`i18n.t('acct.nosuchkey')` now fails the build.

True coverage 328 -> 381 render sites; `MIN_SITES` raised 325 -> 375.

### Fixed — a blanket replace that landed inside a single-quoted string

Routing 27 labels through the translator by text substitution put
`${esc(i18n.t('acct.browseServices'))}` inside a JS string delimited by single
quotes, and the inner quote closed it. The bundle stopped painting; `lint-parse`
named the file and the reason in one line. Global search-and-replace across a
file that mixes template literals with ordinary strings needs the parser gate
behind it, every time.

### Added — the ask-rates screen, on both sides of it

~96% English under a Telugu tab bar, on the screen where she chooses who enters
her house and where her money sits while she decides. The pro's half of it --
his rate, what he keeps, what the customer pays -- was English on the earning
side too. 29 render sites.

The lint caught two keys I had defined and forgotten to wire, which is the check
doing exactly the job it was written for.

Coverage 381 -> 410 render sites; `MIN_SITES` raised 375 -> 405.

### Fixed — I killed the entire multi-quote journey with one missing import

A round-10 audit scored this product **4/10**, down from 6, and the single
largest reason was mine. Translating `ui/views/ask.js` in the previous change
introduced 88 calls to `t(...)` into a file that never imported `t`. Every
render threw `ReferenceError: t is not defined` and painted the error page.

The whole "ask several pros for a price" flow -- the thing this product sells
hardest -- was dead for every user, on every load. Three real quotes sat behind
a link that appears only on Home and goes nowhere, and Orders never lists open
requests, so there was no other way in and no way to cancel it.

**Every gate passed.** The module parses -- a free variable is legal JavaScript.
301 tests pass; they never render a view. Six journeys pass; they drive the
domain, not the DOM. The i18n lint passed and counted all 88 sites as coverage.
The dist smoke test passed because it checks that the HOME shell paints.

This is the second time a whole screen has been dead with every light green:
`flags` in `partner.js` killed the shop's Payouts tab -- the only screen with a
withdraw button -- in exactly the same way. Once is a mistake; twice is a
missing gate.

### Added — two gates, either of which would have caught it

**A file that CALLS the translator must import it.** The sibling check catches
the opposite mistake (a file that imports `t` and then rebinds it); this is the
same defect from the other side. Dead-code check 7 could never see it because
`t` is a bare function rather than a namespace.

Adding the import immediately tripped the shadow check on `const t =
Math.max(...)` inside `mmss` -- harmless only because that function never
translates. Renamed.

**And the smoke test now opens twelve more routes**, not just the one the app
boots on: shops, cart, orders, account, earn, ask, order, pro, shop and the
three legal pages, each asserted to render something interactive and not the
error page. A free variable in a view is invisible until somebody opens that
view, so the gate opens them.

Poison-tested both: removing the import fails the i18n gate with
"THE TRANSLATOR IS CALLED BUT NEVER IMPORTED — views/ask.js 29 call(s)" and
fails the smoke sweep with "#/ask/none — rendered the error page".

### The tenth pass — customer 6.0 -> **4.0**, partner 6.0 -> **5.0**

Both scores fell and both reports lead with the same defect: `t is not defined`
killed the bidding flow on BOTH sides -- the customer's ask screen and the pro's
"Quote — send my rate" button -- and the request then never expired, because
`closeIfDue()` only runs inside the crashing render. A customer's Home carried
"your ₹583 stays held" for money that was never held, with no way in and no way
to cancel. One missing import, mine, cost roughly two points on each side.

### Fixed — "Yours ₹0", and it was my regression

The shop's monthly statement read **"SETTLED TO YOU ₹416"** at the top and
**"Yours ₹0"** at the bottom, with a line reading **"Free delivery you gave −
₹416"** for a delivery the customer had paid ₹19 for.

Round 9 corrected that column to count only the orders the column is about, by
filtering its ledger legs through the ids on the other side. `SHOP_PAYOUT` and
`RIDER` post with an EMPTY meta, so the filter matched nothing, `yours` came out
0, and the residual line -- defined as whatever is left -- swallowed the shop's
entire month.

Nothing in the engine noticed: the money was in the right accounts and escrow
still landed at zero. Only a screen that asks "which orders?" could tell. The
settlement legs name their order now, and journey 1 asserts that every one paid
to a shop does. Poison-tested.

### Fixed — ₹539 and ₹540, at the call site the fix missed

`absorb` was added to `core/money.js` for exactly this defect and applied to the
bill; `dealShown` at `orders.js:46` never got it. So the release line and its
button read "₹539" while the bill on the same screen said he "receives the full
₹540", and the audit pointed at the comment in `money.js` describing the bug it
was still shipping. 540 + 36 + 7 now, everywhere.

### Fixed — "You save ₹299" under a bill of ₹836

`compareWithApps` re-quoted the job at the DEFAULT markup while the sheet beside
it used the PARTNER's -- 6% for a tier-4 pro. "A typical app would charge
₹1,151 · YOU SAVE ₹299" implies ₹852. It reconciled only for pros on the
standard rate, which is why it survived: right for most of the roster, silently
wrong for the best of it.

Journey 7 was written BEFORE the fix and failed on exactly the two tier-4
assertions while passing for a standard pro -- which is how the diagnosis was
confirmed rather than assumed.

### Fixed — the cap the product advertises was computed and never checked

`trust.capOk` has existed, exported, and called from nowhere. A pro is told
twice -- on the recruiting page and again on the go-live screen -- that his
first three jobs are capped at ₹1,500. An audit priced a doorstep job at ₹3,000
and watched it go straight through to "₹3,240 sent for approval".

There are two ceilings and only one was enforced: the on-site multiple bounds
him relative to HER estimate, and this is the separate promise about how much a
stranger may be trusted with at all -- the one the customer is relying on.
A limit that is advertised and not enforced is worse than no limit, because she
believes it.

Verified: a fresh verified pro is capped at ₹1,500 and ₹3,000 is refused; a pro
past three clean jobs is not capped. Journey 5 asserts it.

### Fixed — a confirmation for an irreversible transfer that rounded

A shop asked for ₹150.50, the button said "Send ₹150.50", the engine moved
exactly 15050 paise, and the toast said "**₹151 sent**" -- fifty paise more than
had left. All three withdrawal confirmations state the exact amount now.

The shop's book rounded those same acts to rupees while the pro's passbook shows
paise, so the two partner ledgers disagreed about precision on the same event
under a promise that the book is "read-only, and to the paisa". Four rows
corrected.

### Fixed — a person could open a pharmacy with a name and a photograph

The most serious finding on either round-10 report. Shop signup collected a
name, a mobile, a password, a category and a shopfront photo. Nothing else. No
ID, no licence, no terms, no quiz.

A plumber who fixes a tap answers five trade questions, a six-question conduct
quiz, submits a selfie and an ID, gives a reference, consents to a police check
and signs seven terms. A person selling **MEAT, FISH AND EGGS** -- or the
**Pharmacy & Wellness** category, whose own blurb offers "OTC, devices, and Rx
with prescription" -- answered nothing at all.

And the machinery was already there, unused, in the pattern this version keeps
finding. Every retail category carries `licence: 'fssai' | 'drug' | null`.
`bidding.js` already refuses price competition on licence-gated work, citing it.
The shop console has been rendering `s.drugLicence` for versions. The signup
form wrote both fields as the empty string, always.

Five of the eight retail categories are gated -- kirana, fruit and veg, meat,
dairy under FSSAI; pharmacy under a drug licence -- and all five now require the
number before the storefront opens, with the field appearing only for the trades
that need one.

This does not make SAAHAA a regulator. It records the number the shopkeeper is
legally required to display anyway, refuses to open a licensed storefront
without it, and puts it where a customer and an inspector can both see it.

### Fixed — ₹1,100 of stock went out, came back, and her book said she had never traded

A return is refunded out of ESCROW, before settlement, so no money ever reaches
the shop and double-entry has -- correctly -- nothing to post. The shop's book
was therefore empty, under the words "No entry on the book yet", after a real
order had been packed, delivered and returned.

The accounting is right and the screen was still wrong. Inventing a ledger leg
to fill the gap would have been far worse: it would put money into a book this
product tells shopkeepers can be verified and never edited. So a returned order
is shown as what it is -- an event that moved no money, marked ₹0, visually
distinct from a real movement, never summed into the balance -- and the empty
state no longer claims nothing has happened.

### Fixed — the cancel sheet disagreed with its own button

"Back in your wallet **₹273**" over a button reading "Yes, cancel · **₹272**
back". The breakdown is derived from what she actually paid, so it survives
being added up; the button re-rounded the raw split on its own. She is being
asked to accept that split, so the button quotes the figure the sheet just
showed her. Fourth application of the same rule.

### Fixed — the same key, defined twice, in all three tables

`shop.payouts` and `shop.settledOrders` were each defined TWICE in EN, HI and
TE. In an object literal the last one silently wins, so half those definitions
were dead the moment they were written -- and a translator correcting the copy
at the first site would have watched their change do nothing, with no error
anywhere to explain why.

It caused no visible bug only because the two copies held identical text. That
is luck: the failure mode is a translation present in the file, counted as
rendered by the lint, and never displayed. A ninth check now refuses it.
Poison-tested.

### Added — the bill, in the language the rest of the screen is already in

Both round-10 audits measured the retail bill block at 100% English on an
otherwise Telugu order screen: the item count, `Delivery`, `Free`, `Total`, the
`(est.)` markers, the substitution tags and the refund line. `i18n.js` promises
"the money words" are translated, and this is the bill. Twelve keys, three
languages, and the ratchet raised to 420 render sites.

### The eleventh pass — customer **3.0**, partner **5.0**

The worst customer score of the project, and three of the four blockers were
mine, all introduced in the previous change.

### Fixed — a comment inside a tag killed every cancellation in the app

A note explaining a rounding fix was written between `style="…"` and
`data-act="…"`. The HTML parser ends a tag at the first `>` it meets -- the one
closing the comment -- so it swallowed `data-act`, `data-id` and `data-rule`,
and printed the rest of the button on screen as text. A customer trying to
cancel read raw `data-act="cancel.confirm" data-id="ord_…"` in the sheet,
clicked it, and nothing happened. **No booking in that build could be cancelled
at any stage**, and the failure looked like the app had been hacked.

`lint-dead.mjs` gained check 8 for exactly this shape. Nothing else can see it:
the template literal is a perfectly good string, so the module parses and the
bundle builds, and even rendering the sheet does not throw -- malformed markup
is still markup. Only the parser knows, and only on screen.

### Fixed — `saving is not defined` killed the quote-picking screen

The round-9 fix for the overstated savings was written into the rival card and
then USED in the hero card, where `saving` is not in scope. The moment the
sealed window closed, the screen a customer picks a winner on died. She was
shown three cheaper quotes and given no way to take any of them; every rate a
pro sent sat at "Waiting" for ever.

The calculation now lives once, at module scope, and both cards call it.

### Added — tools/render-views.mjs, because three rounds have gone this way

`flags` never imported. `t` never imported. `saving` declared one function up.
Every existing gate passes all three: a free variable is legal JavaScript, the
domain tests and money journeys never build a view, the bundle boots because
the home route does not touch those lines, and the route sweep's `#/ask/none`
short-circuits before reaching the branch that dies.

The third proves a static check cannot close this -- `saving` WAS declared in
that file. So this gate renders 24 screens in Node with a real seeded world on
them: the ask at every stage, both order sides, the cart, a shop page, the
consoles, all four sign-up doors. A ReferenceError is reported as a DEAD SCREEN
and fails the build. Poison-tested against the real regression.

### Fixed — my licence gate made every food shop impossible to open

Worse than the hole it closed. The FSSAI/drug field lived inside `catStep()`,
which runs on a full render; picking a category PAINTS instead, because a
re-render would wipe the name, mobile and password already typed. So the
requirement fired and the input never appeared -- **five of the eight retail
categories, every food shop and every chemist, could not register**, blocked by
an error naming a box that was not on the form.

The slot is always in the DOM now and `paintCat()` fills it, keeping anything
already typed. The render gate asserts the shop form carries it.

### Fixed — the cap was enforced on the wrong path

`capOk` went into the on-site re-quote and nowhere else, so a pro one clean job
old was still BOOKED at ₹1,760 against the ₹1,500 his recruiting page, his
go-live screen and her booking sheet all promise. It belongs where the job is
accepted.

The first version of the assertion for this searched the seed for a provisional
pro, found none -- every demo pro has hundreds of jobs behind them -- took the
"nothing to assert" branch and passed with the cap switched off. It builds its
own rookie now. A test that cannot fail is not a test.

### Fixed — SAAHAA took ₹148 and both bills said ₹90

On a cancellation SAAHAA's share is `customerPays − refund − worker`, which on a
job abandoned en route came to ₹147.84 -- while both order screens went on
printing the original "platform fee ₹76 · GST ₹14 · together ₹90, the 8% SAAHAA
adds on top", because that is what the order still carried. The pro could find
₹148 in the ledger and nowhere else in his app.

What is taken is now recorded on the order and stated on his cancelled-job
screen, in all three languages, with the reason. Journey 4 asserts the figure
matches what the ledger actually moved.

### Added — a pro can set his own price

The rate capsule on MY PAGE was read-only and no control anywhere in the console
edited it, so a number typed once during signup was permanent -- for a trade
whose material costs move every month. An audit called it disqualifying on its
own, and it sat under a heading telling him he keeps 100% of a figure he could
not set.

The sheet shows what the new rate does to the cheapest and dearest job in his
own trade before he saves it, refuses a rate under ₹50, and says plainly that
jobs already booked keep the price they were booked at.

### Fixed — recruiting quoted a fee SAAHAA does not charge

Every shop-recruiting screen said a flat "3% an order, capped at ₹25". Five of
the eight categories charge **5%**, and three of those cap at **₹50**. The
headline was true for kirana, fruit-and-veg and meat, and understated the fee
for dairy, pharmacy, water, stationery and pet supplies. The cause: on the
chooser no category is picked yet, so the helper fell back to the dials and
printed one end of a range as if it were the whole of it.

Those screens also never mentioned the ₹5 floor, the ₹5 dispatch cut, or the
best term in the offer -- **the first thirty orders cost nothing at all, no
percentage and no minimum**. Overstating the cheapest number while hiding the
most generous one is a strange way to recruit.

It reads the catalogue now and states the real range until a category is
chosen, then that category's own exact figures. Adding a category cannot make
it lie.

### Fixed — "the shop receives ₹478" when the shop received ₹512

There is no rider network yet, so the delivery money goes to whoever actually
drove: the shop. Its own panel has said "You made this delivery + ₹34" for
versions, while the customer's cart stopped at the basket payout -- understating
what the shop takes home by the whole delivery, on the one panel that exists to
show her where her money goes. Both sides describe the same order now.

### Changed — the parse gate runs before the smoke test

A stray backtick inside an HTML comment inside a template literal broke the
bundle, and the first thing preflight said was "the shell did not paint" -- true,
useless, and three gates away from the actual line. `lint-parse` names the file
and the token, so it goes first.

### Fixed — the shop's money panel said overweighing pays

An audit weighed 1.35 kg against 1 kg ordered, gave the extra away free as the
product intends, and watched its own stated receipt go **UP** from ₹512 to ₹513.
The "Free delivery you gave − ₹39" line vanished at the same moment, and the
panel printed "Basket ₹494" while the item list directly beneath it totalled
₹533.02.

The panel derived the giveaways as RESIDUALS -- "free delivery you gave" was
whatever was left after payout and fee. On an over-weighed order `setPickedQty`
scales `itemsTotal` down so the order fits what she is actually charged, so the
residual collapsed to zero and the basket it printed matched neither the weighed
goods nor the order. **A residual is only ever as true as the number it is
subtracted from.**

It starts from the one figure that is never scaled and never estimated -- what
the customer actually pays -- and names the two deductions SAAHAA takes. Those
three always sum, on every path, because settlement is defined that way. What
the shop gave away is still on the panel, as what it is: a note about
generosity, not a deduction from a basket.

### Fixed — the GST was counted once and subtracted never

Writing a journey for the over-weighed path -- which had none, in a product
where the SHORT weigh went through five generations of bugs -- immediately found
a second, older defect underneath the first.

On that path the shop's payout was `capped − rider − dispatch − fee`, leaving
the GST on that fee in nobody's column. The order's own parts summed to
`capped + gst`: every shop screen over-stated the till by the tax, and
settlement had to find money escrow was never given. SAAHAA's charge is the fee
AND the tax on it, and both come off before the shop is paid.

Journey 1b asserts the column adds up and that escrow lands at zero.
Poison-tested: restoring the old line fails the panel assertion by exactly the
GST.

### Fixed — one ₹100 stake printed four lines, two contradicting the other two

        Stake returned                +₹100.00
        Stake returned · stake        −₹100.00
        Stake locked on a job         −₹100.00
        Stake locked on a job · stake +₹100.00

The passbook deliberately reads all four of his pockets, so a movement BETWEEN
two of them -- wallet into stake, wallet into holdback -- is a real double entry
and shows up twice, correctly signed and completely unreadable. An audit put it
near the top of what stops it trusting the app with a week's earnings, and it
was right to: a person checking whether they had been charged twice could not
tell from this.

Money that only moved from one of his pockets to another has not left him, so it
is one line saying exactly that, contributing zero to the column -- which is what
it contributes to his total, because both halves are his. Money that genuinely
arrived or genuinely left prints as before.

`legsFor` now returns each leg's position in the book, so the two halves of one
entry can be recognised as one entry. It is display only; nothing is hashed and
no stored state changes.

Journey 2 asserts that this job really does move money between two of his own
pockets -- so the check cannot pass by finding nothing -- and that such a move
nets to zero. Poison-tested by disabling the holdback posting.

### Added — one bad item can come back without the rest of the shopping

A return was all or nothing. One stale ₹42 packet of turmeric took a ₹501 order
back with it -- including a 5 kg bag of atta that was perfectly good, which the
shop then had to collect, restock and lose the sale on. No kirana in Hyderabad
works that way, and neither side wanted it.

She ticks what is going back. Ticking nothing still returns the whole order,
which is the right answer when the problem is the delivery rather than an item
in it. She is refunded exactly what those items cost her; the shopping she kept
is settled like any other delivered order, so the shop is paid for it.

The refund is posted BEFORE settlement runs, and settlement already distributes
what escrow actually holds rather than what the order claims -- three earlier
bugs were fixed by making it work that way -- so the remainder lands correctly
with the dispatch cut absorbing the residual. Escrow still ends at zero, which
is the only way to know the two halves add up.

`R_RETURN → R_SETTLED` is a legal edge now, because a return that was never
full should not have to pretend it was.

Journey 1c: the basket must have more than the one bad item, and the bad item
must be worth less than the basket, or the journey proves nothing. Poison-tested
by refunding the whole basket instead -- three assertions fail.

### Fixed — the shop was asked to give up money it was not shown

The return panel gave the shop a reason, two buttons and no figure at all, on
the one screen in the order where it decides whether to accept a full refund.
Every other stage shows what reaches the till. It shows the money now.

And "a refusal sends it to SAAHAA with your photos" was never true: a pro's
finished-work photograph protects him, and a kirana has no photo step anywhere
in the product. It says what SAAHAA actually reads -- what was picked, what it
weighed, and the messages between them.

### Fixed — the public page published claims the pro never made

A pro who gave a name, a number, a trade, a price and an area found his page
telling customers he speaks "Telugu, Hindi" -- a hardcoded default printed as
fact, beside an Experience field that correctly says "Not stated" when he has
not said. And "TRADING · since 2026" read as a career when the only thing SAAHAA
knows is when he joined SAAHAA; that tile says "On SAAHAA since" unless he has
actually told us how long he has done the work.

### The twelfth pass — customer 3.0 -> **6.0**, partner **5.0**

Both reports overlap heavily, which is the useful part: two people who could not
see each other's notes found the same screens. The customer auditor also
RETRACTED three of its own findings after checking them, which makes the rest
worth more.

Four of the defects below were mine, three of them introduced by the partial
return added earlier the same day.

### Fixed — the return screen lied for twenty-four hours

"Held, going nowhere else **₹974**" and "SAAHAA refunds you **in full**", after
she sent back one ₹331 jar out of five items. The engine knew exactly which
lines were coming back; the panel was never told. It names the items, the amount
coming back and what she still pays for what she kept.

The shop's side was worse: **"Accept return — refund in full"** with no item
named and no figure, above a panel still reading "You receive ₹454". A
shopkeeper tapped it blind and it cost ₹322. That is a decision a kirana makes
several times a day.

### Fixed — the receipt filed a damaged jar as "weighed lighter"

She reported damage; the permanent record said "Extra weight, not charged to
you" and "**Weighed lighter than ordered**", in English and in Telugu. The money
was right and the reason was false -- and if she had ever disputed it, the record
accused the shop of short-weighing her.

### Fixed — a partial return paid SAAHAA and the rider nothing

Settlement hands out what escrow holds in priority order, and the shop is FIRST
in that queue. The partial return lowered the total without lowering
`shopPayout`, so the shop swallowed the whole remainder: no fee leg, no GST leg,
no rider leg -- while the shop's own screen went on asserting "SAAHAA dispatch
− ₹5" against a book that had never taken it.

**Escrow landed at zero throughout, which is why nothing caught it.** Escrow
reaching zero says the money went somewhere, not that it went to the right
people. A basket with an item taken out of it is a smaller basket, so it is
re-quoted like one. Journey 1c now asserts SAAHAA is still paid; poison-tested.

### Fixed — "₹73 more than she agreed" beside "− ₹91.99"

One screen, two figures for one giveaway. The goods went up ₹92, but the heavier
basket crossed the shop's free-delivery line, so her TOTAL would only have risen
₹73. Both true of different things, and a shopkeeper reads them as one number.
One definition now, quoted in both places: the stock that left his shelf unpaid.

### Fixed — a card showing ₹384 above a button that charged ₹837

The held pro's own card, after he had bid LOWER: it printed his new price while
the button booked the price she was holding before he bid. ₹453 apart, a thumb's
width apart, during the sealed phase the app tells her to wait through. The
button books the price on the card.

And the receipt's "You saved" multiplied the SAVING by the worker's markup -- a
saving is not a price and does not carry a fee -- which is where three different
figures for one job came from (₹418, ₹434, ₹197).

### Fixed — the rate sheet I added rendered the word "undefined"

"At this rate, **undefined** prices at ₹800 and **undefined** at ₹800." I wrote
it assuming `subs` was a list of objects; it is a list of strings, and the
multiplier lives in `subSize`. It reads "Tap & mixer repair prices at ₹560 and
Pipeline replacement at ₹1,760" now.

### Fixed — a shop went live, took an order, and was never asked where to send the money

A pro gives a UPI id at step 6 of seven. A shop was asked nowhere at all, and
found out from the Payouts tab -- "nothing can be sent until you do" -- with
money already sitting in it. Asked once, at signup, with the shop's other
details, and a wrong one is refused there rather than when the money is meant to
move. The render gate asserts the field exists.

### Fixed — what a pro signs now says what it will cost him

The two terms that take money from a pro carried no numbers: "a tenth of each
payout waits seven days" and "**a fee** is taken from my wallet". He met ₹100,
₹40 and 10%/7 days for the first time on a door screen, a cancel sheet and an
Earnings tab -- all AFTER handing over his ID, his selfie, two quizzes and his
UPI. An audit called it the single most misleading thing in the funnel.

The figures are read from the engine that charges them, in all three languages,
so a term cannot drift from the rule: change `MIN_STAKE` or the cancellation fee
and the sentence he signs changes with it. Journey 10 asserts every language
names the stake, the fee, the holdback and its window, and that no placeholder
is left unfilled. Poison-tested.

### Fixed — the screen that decides whether a Telugu shopkeeper joins was the least translated

An audit measured the role chooser at **26%** Telugu with every fee term in
English, while the pro's own money screen sits at 85%. That asymmetry is exactly
backwards: the money screen is read by somebody who has already joined.

### Fixed — two shadowed translators the lint could not see

Routing that chooser through `t()` exposed `rows.map(([r, t, s]) => …)` — the
parameter `t`, shadowing the translator for the whole callback, in a file that
imports it. It had never fired because nothing inside translated: a trap left
armed for whoever edited that map next.

The shadow check read `const`/`let`/`var` and `function` parameters. Arrow
functions and destructuring are how most of this codebase is written, so it now
reads those too — and immediately found a second one, `([k, t]) =>` in
`onboard.js`. Both renamed, both poison-tested.

### The thirteenth pass — customer **5.0**, partner **5.5**

### Fixed — the feature sold as the cheaper way charged a third more

A customer booked a plumber directly for a blocked drain at **₹416**, then used
"ask nine pros for their price" ten minutes later, and the **same man** bid
**₹551** for the **same job** — labelled "Best pick · ₹28 less than held". She
would have paid a third more for using the feature that exists to save her
money. The audit called it the single biggest loss of trust in the app.

Two causes. `startAsk` never passed the sub-service, so the request went out as
a bare category; and `priceBand` never used one, so it priced against
`cat.base`. Every sub-service carries a multiplier — a tap repair is 0.7 of the
category base, a pipeline replacement 2.2 — and every direct booking has always
used it. The auction now uses the same one, or the two screens are pricing
different jobs. Journey 11 asserts it.

### Fixed — a pro was dispatched to a neighbourhood name

The booking sheet refuses an order without a door. The ask-and-accept path
called straight through to `bookService`, so a job won at auction carried
`customerAddress: ""` and no screen showed one. The guard belongs where the
order is made, not on each screen that makes one — any future path gets it for
free. It immediately failed three journeys that had been booking without an
address, which is the gate working.

### Added — the shop has a book of its own

The pro's passbook is the best screen in the product. The shop — the party
carrying inventory risk, weight risk and return risk — had a two-line list of
ARRIVALS with no deductions in it: an audit watched ₹188 become ₹104.40 and
could find nothing that said where ₹83.60 went.

Those deductions never touch the shop's own ledger account: SAAHAA's fee, the
dispatch cut and a refund all come out of ESCROW before the shop is paid. So the
book reads the ORDER, where the split is recorded, and states it the way a
shopkeeper checks a day — what she paid, what came back, what was taken, what
reached the till — with the last line being the arrival that IS on the ledger,
so book and screen agree.

### Fixed — a refund paid out more than the customer ever paid

`returnedValue` refunded the WEIGHED quantity. A shop that weighs 2.2 kg against
2 kg ordered gives the extra away, and she is charged for the 2 kg she agreed
to — so refunding the weighed value handed her ₹83.60 for onions she had paid
₹76 for. **The shop paid for its own gift twice: once in stock, once in cash.**

### Fixed — and the bill folded that gift into the refund

"Returned — refunded to you − ₹104.00" where ₹83.60 went back and ₹20.40 was
free weight, three lines above a sentence correctly saying "₹84 back to the
customer". One number doing two jobs on the screen a shopkeeper checks to see
what a return cost. Two lines now.

### Fixed — I had the GST backwards, and wrote an assertion that agreed with me

`platformFee` is **GST-inclusive**; `platformFeeGst` is the tax INSIDE it, not a
second charge on top. An earlier pass in this release subtracted both on the
over-weighed path, which underpaid the shop by the tax and let the residual hand
it to SAAHAA — and the assertion written alongside double-counted the same way,
so the two errors cancelled and the journey went green. The partial-return path
then inherited the same mistake.

SAAHAA's take is one number, on every path and every screen.

Worse, the obvious checks could not see it: settlement lets the dispatch cut
absorb the remainder so escrow lands at zero, and it rewrites the order's own
`dispatchCut` to match — so understating the shop's payout moves money to SAAHAA
while every self-consistency check moves with it. **The dispatch cut is a
published price, not a remainder**, and pinning it to the ₹5 the product
advertises is the only line that cannot be dragged. Poison-tested: it is now the
assertion that fails.

Every GST leg also names its order now; the retail one never did, which is why
the fee check read ₹21.19 where ₹25.00 had been taken.

### Fixed — "releases by itself in 1h 60m"

On the screen where her ₹510 is at stake. The minutes were rounded independently
of the hours. It also said "look at the pictures" over a panel reading NOTED, NO
PHOTOGRAPH.

### Not fixed — "0 ORDERS" beside "See all 3"

Reported twice, and it is a reading artifact rather than a defect: both figures
come from one variable and cannot disagree. The DOM reads
`{orders.length} ORDERS {regulars.length} REGULARS`, so a reader flattening the
text and anchoring on the word ORDERS picks up the regulars count. One audit
retracted it after checking; the next reported it again. Patching that would be
fixing the instrument, not the product.

### Fixed — a new pro did not exist as far as a customer was concerned

`lockedMatch` returned the hero plus five alternates and threw the rest away, so
six of eleven plumbers were reachable and the other five had no count, no "and 5
more", and no way through. A pro 0.4 km away, ID verified, could only be booked
by pasting his own profile link.

For somebody who has just joined -- no ratings, no jobs to rank on -- that is the
difference between having a livelihood on this platform and not having one, and
nothing in onboarding hints at it. The engine hands over everybody who can do
the job; the screen draws the closest few, says how many more there are, and
opens the rest on one tap. Journey 12 asserts it, and requires the trade to have
more pros than one screenful or it proves nothing.

### Fixed — the SAAHAA ID was not on the public page

Onboarding step 1 says the ID "is printed on your public page so a customer
knows they have the right person", and the You screen repeats it. It appeared
nowhere on that page. A pro went looking for it as the customer -- exactly the
check the sentence invites -- and could not find it. It is the one
anti-impersonation promise the app makes about him.

### Fixed — the two screens where she commits money were the two least translated

Every audit since the third has said the same thing in different words:
navigation is translated and money is not. This release finally went at the two
screens that decide it.

**The booking bill**, measured at ~10% Telugu: the bill heading, the fee line,
the total, the escrow paragraph, the refund terms and the button itself were all
English under a Telugu heading. Fifteen keys.

**The shop catalogue**, measured at ~2%: every aisle, every stock line, the word
ADD and the delivery promise were English on a page whose product names are the
only thing she could read. Eight keys.

**And the four safety promises on Home** -- the sentences that answer "why should
I trust this with my money", on the first screen a Telugu-first woman ever sees.

493 render sites now, and the ratchet raised from 420 to 490.

### Fixed — "You pay ₹324 · a typical app ₹498 · you save ₹175"

498 − 324 = 174. The pair was rounded together against the typical price, and
then the screen printed `customerPays` on its own for "You pay" — so the saving
reconciled against a number the reader never sees. Same rule this version keeps
arriving at: a figure describing the relationship between two others is derived
from those two AS PRINTED.

### Also — the duplicate-key gate caught its author

Adding the bill keys re-defined `bill.youPay`, which already existed in all
three tables. The check added earlier this release failed the build on it. The
original wording is kept, since other screens were already reading it.

### The twelfth to fourteenth passes — customer 3.0 -> 5.5 -> **5.5**, partner 5.0 -> 5.5 -> **6.0**

Both sides now say the same thing: *"The engine underneath is better than most
production fintech I have seen. But I don't read the ledger; I read the screens,
and the screens are where my money goes wrong. Fix the presentation layer and
this is a 9."* Every defect below is a display-layer defect over a ledger that
balanced to the paisa on every run.

### Fixed — the app offered ₹155, then refused ₹155, saying the limit was ₹155

A pro held ₹154.55. The tile said "AVAILABLE ₹155", the chip said "All of it —
₹155", the button said "Send ₹155.00", and pressing it was refused with "You can
withdraw up to ₹155". Nothing on any screen revealed the ₹154.55 that would
work. `fmt` rounds half-up for display; validation uses exact paise. Both audits
hit it independently and neither could get their money out.

`M.fmtMax` prints a ceiling the reader may type back in: whole rupees when it is
whole, paise when there are paise, never rounded up -- because a rounded-up
maximum is a number the validator will reject. Applied to every withdrawable
figure on both sides, including the refusal message itself.

### Fixed — a passbook total that did not decompose into its own parts

"These lines add up to ₹236.00 — ₹234.00 of it is in your wallet now and ₹42.00
is still held back." 234 + 42 = 276. The column covers FOUR pockets and the
sentence named two, so it stopped adding up the moment a stake locked or a debt
was carried -- on the screen whose entire claim is "to the paisa". It names every
pocket that is not empty, and journey 3 asserts the column equals them.

### Fixed — ₹40 that was both taken and still owed

`walletOf` read the mutable `partner.walletDebt` while the passbook beside it
read the DEBT ledger account. A pro saw the cancellation fee subtracted in his
column AND flagged as "recovered from your next payout" above it, then took a
payout with nothing deducted. Taken, or still coming? Two screens, one fact, and
neither checkable against the other.

The book is the answer; the field remains only as the fast read for code with no
ledger to hand. Poison-tested by removing the debt leg: three assertions fire.

### Fixed — a bid could be higher than the bidder's own shelf price

The worst thing either audit found this round, and it was structural. The price
band is built from the CATEGORY base, so for a job whose category base is ₹520
the band floor sat at **₹430** -- while a pro asking ₹428 sells that same job for
**₹385** on his own booking sheet. He could not bid his own price if he wanted
to. So a customer who used "ask several pros" paid **₹74 more** than tapping
Confirm twelve minutes earlier, under a sheet reading "You saved ₹89".

A marketplace may help a worker charge less. It must never quietly help him
charge more than he publicly advertises for the same work. His own listed price
is now the ceiling on his own bid, and the band's floor cannot push him past it.

### Fixed — the rest of the presentation layer

* **A return committed blind.** The sheet let her tick items and tap a reason
  with no total anywhere, at any point; the shop's accept button said "refund in
  full" on a partial return with no item named. Both now state the figure, and
  the "tick nothing and it all goes back" hint stops contradicting the screen the
  moment she ticks something.
* **A refund paid out the WEIGHED quantity.** A shop that weighs 2.2 kg against
  2 kg ordered gives the extra away; refunding the weighed value handed her
  ₹83.60 for onions she paid ₹76 for, so the shop paid for its own gift twice --
  once in stock, once in cash.
* **"SALES TODAY ₹0 · 0 orders" on a day the shop took ₹426.** Accepting a
  partial return stamps `refundedAt`, which excluded the whole order from the
  headline. A sale that comes back in full is not a sale; one that comes back in
  part is still a sale for the part that stayed.
* **The rate preview showed the old rate while he typed the new one** -- and
  before that, rendered the literal word `undefined` twice, because `subs` is a
  list of strings and it was written as though they were objects.
* **"You save ₹227" beside "you pay ₹226 less"** on one screen: the box derived
  its figure from the two rounded numbers on screen and the footnote printed the
  raw one.

### Added — the app in the language it is built for

Every audit from the third onward said the same thing, and the last four said it
in the same words: the labels are Telugu and every sentence that explains money
is English. A Telugu-only customer met Telugu column headings over an English
explanation of what she was about to pay.

**The 118 job names.** The largest single block, named in every round -- "all
eight job names", on the booking sheet, the bill, the order row, the pro's lead
card and the recent-jobs table at once. They are keyed by a STABLE ID rather
than by their English text, which fixes a latent defect found on the way: the
order record stores `sub` as the English string, so renaming a job would have
orphaned every past order that used it -- and that is also why they could not be
translated before, because the name WAS the key. The catalogue keeps English as
the source of truth, the screen prints the reader's language, and the value
stored on the order stays the stable English name.

Transcribing them, I wrote down 117 of 118. Checking coverage against the
catalogue rather than trusting the count found `Wiring fault trace`.

**And the sentences.** The order screen's escrow promise, the door-code line,
`Cancel this booking`, the section captions, the wallet's own "read-only, and to
the paisa" claim, every Settings row, every ledger row label on the customer's
passbook, and the shop's aggregator-comparison block -- the one an audit called
"the sentence that matters most", at 31% translated.

545 -> **672 keys**, 512 -> **516 render sites**, ratchet raised to 510.

### Fixed — a gate that passed because it was broken

The money-column check flagged the new aggregator block, and chasing it properly
took three stages, only the first of which was my code:

1. The object key `kept:` collided with a `const kept` in a DIFFERENT function.
   The check is file-scoped by design, so the fix is renaming the key, not
   loosening the rule.
2. Then it matched `max` inside `Math.max(`. That is a real weakness: a name
   after a dot is a property, not a variable.
3. **And the fix for that landed broken.** The escaping was mangled in transit,
   so the file got `'\w'` and `'\b'` -- which JavaScript reads as `w` and a
   BACKSPACE character. The check then exited 0 not because the tree was clean
   but because its regex could no longer match anything.

The third is the dangerous kind and it is why exit codes are not evidence: it
was caught by reading the raw bytes, then verified on four cases and a fresh
poison test. The first poison attempt ALSO passed wrongly -- it used `yours`,
which is legitimately restricted to the order ids, so skipping it is correct
behaviour. Proving the check works needed a genuinely unscoped total.

### The fifteenth pass — customer 5.5 -> **6.0**, partner 6.0 -> **5.5**

The bid cap landed: asking several pros is now equal to or cheaper than booking
the same pro directly, on every row. The customer auditor retracted SEVEN of its
own findings after re-testing, which is the most careful report of the project.

And the partner auditor found the worst defect in it.

### Fixed — a pro watched a customer accept his quote, and no job existed

The held pro's card is built as a literal object, and it carried no bid id. So
the rule added two passes ago -- accept the price printed on THIS card, not the
one she was holding before he bid -- could never fire: the button kept the
held-booking action under his lower number, and once the sealed window shut that
action refused outright, "This request is closed. Nothing was charged."

No order. No award. Nothing in either app saying so. He had lost the work and
could not find out why.

Journey 6 books while the window is still OPEN, which is exactly why it passed
throughout. Journey 8 is the same acceptance one minute later, and fails loudly
without the fix.

### Fixed — a quote he sent was visible nowhere in his own app

`openRequestsForPartner` drops a request the moment he bids on it -- correctly,
it lists work he has NOT answered -- and nothing picked it up afterwards. Leads
0, Jobs 0, no "awaiting reply" on any screen. He could not tell whether he had
bid at all, which is also why the defect above was invisible to him. A quote is
a commitment; it stays on screen until it resolves.

### Fixed — the app would not let a pro ask his own price

The band is built from the CATEGORY base, so on a job whose category prices at
₹520 the ceiling sat at ₹450 -- while a plumber listing ₹900 sells that same job
for ₹630 on the page customers already see. He was capped ₹180 BELOW his own
storefront by the screen that had just told him his rate is his. The band
guides; it does not overrule what he publicly advertises.

### Fixed — ₹5 the bill computed and never printed

`shopDispatch` comes out of the same `roundParts` call as the other two figures
precisely so the three sum to what she pays. It appeared exactly once in the
file: its own destructuring. "You pay ₹46 · receives ₹36 · SAAHAA's charge ₹5"
left ₹5 unaccounted on the panel whose entire purpose is to say where her money
goes.

### Fixed — ₹40 shown as taken AND as still owed

The pockets under the passbook were joined with dots and the debt printed
through `Math.abs`, so the line read "₹243.00 in your wallet · ₹63.00 still held
back · ₹40.00 you owe" under a total of ₹266 -- and 243 + 63 is 306, while
243 + 63 + 40 is 346. An audit worked it by hand, could not close it either way,
and called it the thing that would stop him trusting the screen. The arithmetic
was right all along and was simply never shown. Signs, not dots.

Underneath it, the recovery was reading the mutable `walletDebt` field while the
wallet had been corrected to read the DEBT account -- so when the two disagreed
the recovery the screen promised twice simply never ran. Journey 9 walks it: he
cancels a started job with an empty wallet, earns again, and the payout must
clear it.

### Fixed — a live grocery order with no way out

`R_PLACED` and `R_ACCEPTED` have always listed `R_CANCELLED` among their next
stages. Only the screen never offered it, and FOUR separate audits reported
being trapped with a basket they had already paid for. It stops at `R_PICKING`
and says why: once he is weighing her order the goods are off his shelf, and the
way back from there is a return.

### Fixed — claims that were not true

* **"Most trusted" was a threshold, not a comparison.** Any bid over 0.7 on
  trust got the caption, so the app recommended a pro who was dearer, further and
  slower on the claim he was the most trusted of two pros both showing Trust 92.
* **"Your ₹680 stays held"** was shown to a signed-out visitor with no account
  and no money in the app.
* **Six numbers for one pool of plumbers** inside three taps -- the area, the
  pool, the first wave, the replies -- every one true, all labelled "pros". The
  button names the scale, the screen names the wave, the lead card counts quotes.
* **"Cost per order ₹0"** stayed true and stopped being the whole truth: no
  commission is taken from his quote, and a ₹100 stake, a tenth of each payout
  for seven days and a ₹40 walk-out fee all bite on day one.
* **A cancelled job still said "You pay ₹875"** beside "₹525 went back", and
  still boasted "You saved ₹197" on work that never happened.

### The sixteenth pass — customer 6.0 -> **5.5**, partner 5.5 -> **6.0**

The customer score fell on a regression of mine, and the partner auditor found
an ordering defect that had been there the whole time.

### Fixed — "cheapest here" on the dearest of three quotes

Fixing "most trusted" from a threshold to a comparison, I gave the price line
the same treatment. But `parts.price` is `priceScore(amount, band)`, which
rewards sitting near the band's fair TARGET and penalises a suspiciously low
bid -- so the best price SCORE is not the lowest price. The hero card read
"cheapest here" at ₹392 while the same screen tagged another pro "lowest price"
at ₹341.

That is worse than what it replaced: "fair price" was vague, "cheapest here" is
a checkable falsehood on the screen where she spends. Cheapest is a fact about
money and is decided on the money. The lesson I did not draw the first time: I
turned a SCORE into a claim about rupees without checking what the score
measured. Trust and rating happen to be direct measures, which is exactly why
the same edit was right there and wrong here.

### Fixed — the request was torn down before the job was built

`bookHeld` rejected every rival bid and closed the request, and THEN called a
booking that can refuse -- for a missing address, a cap, a self-booking. When it
refused: no order, a dead request, and the winning pro's console still reading
"waiting on the customer" about something that could never be answered again.

The audit found it in `bookHeld`. Checking the neighbouring function showed
`acceptBid` had the identical ordering. Both now book first and tear down only
on success, and journey 10 proves a refused booking leaves the ask answerable --
and that it books the moment she fixes the address.

### Fixed — "still yours, so nothing left your balance", on money that left

True of a stake and of a holdback, both of which come back. It was printed on
the cancellation fee too. An audit called it the only wording on the money
screens that misinforms in the platform's favour.

### Fixed — the same ₹40 taxed two different ways

Fee-plus-GST from a funded wallet; flat, with no GST leg at all, when it became
a debt. Where the rupee landed, and whether the government got its share,
depended on whether he happened to have a balance that day.

### Fixed — claims that were still not true

* **"Wrong person came" about a jar of ghee.** `reasonsFor` keyed on role alone
  and never asked whether the order was a job or a basket, so the only complaint
  route a grocery order has offered seven ways to complain about a tradesman and
  no way to say an item was missing, wrong, spoiled or short-weighed.
* **A complaint that vanished.** `raiseDispute` advances to DISPUTED only where
  the stage machine allows it, and a grocery order at `R_ACCEPTED` does not -- so
  the record lived in `state.disputes` and no screen read it. A vanishing toast
  is not a receipt.
* **"Take out everything — ₹790.64"** on a button that answered "add a UPI id
  first" and went nowhere.
* **"₹0 FEES YOU PAID"** beside ₹70 of itemised fee: it counted only CLOSED
  orders, which is true of settled work and false of her money.
* **"111 pros in Madhapur"** when 12 are there and the rest are in Uppal, LB
  Nagar and Secunderabad. A number attached to a place name is a claim about
  that place.
* **"You receive ₹755"** unchanged through a ₹340 return, on the screen whose
  only question is whether to accept it.
* **The signup cost line was half English** -- I wrote the first clause as a
  literal and bolted a translated second clause onto it -- and named a ₹100
  stake where the rule is ₹100 or 5%, capped ₹500.

### The gate learned two branches, and one hiding place

Fixing the payout panel went wrong four times and a different gate caught each:
the strict `roundParts` guard, a free variable left behind by an aborted script,
the i18n check on two keys never defined, and the money-column check on a SECOND
total added to a column that already had one.

The render gate gained a shop panel with a return pending and an order with a
complaint open -- both branches nothing had ever rendered. **A branch nobody
renders is a branch nobody checks.**

And one of those fixes hid itself: I named a local `openDispute`, which is
already an exported FUNCTION in that module. The const shadowed it, and with the
const removed the name still resolved -- to a truthy function -- so the banner
rendered unconditionally with undefined fields and the poison test reported
success three times. It was only found by refusing to accept a green poison run.

### The seventeenth and eighteenth passes — the screens, not the ledger

Two rounds, twenty-one fixes, and the shape of the complaints has changed. The
ledger has not been questioned in five passes; both auditors now say the same
sentence in different words -- *the engine is better than anything in the
category, and I read the screens, not the engine.* Every defect below is a
screen saying something the engine does not.

### Fixed — two ways to lose everything

**A plain refresh deleted her account, her orders, her ledger and an open
complaint.** The purge is all-or-nothing because an order pointing at an example
partner cannot dangle -- and `app.js` has carried a comment for versions saying
this means a hand-made account "goes with the roster, which is baffling if
nobody says so". Nobody said so. Where a real person has signed up, nothing is
purged.

That fix broke an existing test, and the test was the interesting part: its
fixture carries a hand-made account and it asserted that account gets wiped. The
test encoded the data loss. It now asserts both halves -- a pure-demo device is
still cleaned, a device with a real account is left alone.

**And a completed verification was silently destroyed.** `patchVerification`
rebuilt the whole record from the partner object HANDED IN, and a view holds the
partner it captured when it rendered. A handler firing against that stale copy
wrote an old record back over the new one: trade, conduct, payout and agreement
gone, account stuck on "verification pending", his UPI with it, and recovery
meaning a re-sit of a quiz that locks for 24 hours after three wrong answers.

A write built on current state can lose only the field it is setting; one built
on a stale snapshot loses everything saved since.

### Fixed — "cheapest here", three times, for three different reasons

First it compared a SCORE (`priceScore` rewards sitting near the fair target and
penalises a suspiciously low bid). Then it compared the DEAL. Both are wrong:
what she sees is the deal plus THAT pro's markup, and a tier-4 at 6% can have a
higher deal and a lower price. The card called a ₹820 quote "cheapest here" on a
screen that tagged a ₹683 one "lowest price".

The rule is now written into the code: **a claim about a number on the screen is
decided on the number on the screen.** Not the score behind it, not the deal
behind that.

### Fixed — one tap filed a complaint she never meant to file

The sheet shifted, she hit a neighbouring chip, and "It never arrived" was filed
instantly against an order that had arrived -- freezing ₹658.29 on both sides
with no way back. Every other irreversible act in this app states what it will
do and waits. And the banner then told the SHOP that the shop had reported it:
`by` was on the dispute all along, the sentence just never read it.

### Fixed — the rest

* **A control that invited ₹3,600 and refused ₹1,501 after Send**, while he
  stood in her house having said a number out loud. Two ceilings apply; it
  printed one.
* **"Ramesh receives the full ₹556"** while a tenth waited seven days. True of
  the total, silent about the moment. The toast now says what moved --
  "₹500.76 released — ₹55.64 waits 7 days". My first version of it read a field
  that does not exist, which would have made the fix a silent no-op.
* **A return that dead-ended once a complaint existed**, leaving the shop no
  control at all while the copy said money was held until both sides were heard.
* **The language picker existed on one screen** -- the customer's account page,
  behind a door a Telugu-only plumber cannot read. Seven onboarding steps
  including a police-verification consent, two consoles, no way to switch.
* **A settled receipt ₹220 off its own total**, because lines printed the
  WEIGHED quantity while the refund gave back the BILLED one. Billed values make
  the column close by construction.
* **Three figures for one order's takings** in one shop console; **"FEES TODAY
  ₹0"** on a day the ₹5 dispatch cut was taken; **"extra weight given free"**
  printing ₹352 and ₹142 on one screen.
* **The cart total rounding against its own column** on the screen where she
  authorises payment.

### The gate grew three branches and lost one hiding place

`render-views.mjs` now builds 30 screens, including a shop panel with a return
pending, an order with a complaint open, and the sign-up doors -- all states
nothing had ever rendered. **A branch nobody renders is a branch nobody checks.**

One of those fixes hid itself: a local named `openDispute` shadowed the exported
FUNCTION of that name, so removing the declaration still resolved -- to a truthy
function -- and the poison test reported success three times. It was found only
by refusing to accept a green poison run.

### Tests and gates

301 tests. Seven gates: build freshness, parse, i18n + translator-shadow, dead
code (seven checks), domain tests, dist smoke, and the money journeys -- now six
journeys, 25 book checks, 89 assertions.

i18n: 342 keys x en/hi/te, 342 rendered, 310 render sites, floor 300.

---

## [8.10.0] — 2026-09-10 — "The third generation of the same bug"

The fourth partner audit scored 8.8/8.9.0 at 6/10 and delivered the most useful
sentence anybody has written about this codebase: *"until a claim in a comment
is required to have a self-test with the same name next to it, the narrative
will keep landing ahead of the code."*

It was right, and it proved it: **8.9.0's reweigh fix closed the mint and opened
a new hole.** Third generation of one bug, each version shipped under a comment
explaining why it could not possibly be wrong.

### Fixed — over-weighing paid the shop out of the rider's fee

Scaling every derived figure by the cap dragged the **flat distance-band
delivery fee** down with it. Type 40 kg on a 3 kg order and the rider fell from
₹14.00 to ₹1.15 while the shop climbed to ₹203.44 — escrow still balanced, so
no invariant caught it. The shop had been handed a lever on somebody else's
money.

The cap may only touch what the weight determines: the basket and the
commission on it. The ride and the dispatch cut are fixed by distance and stay
where the quote put them; the shop is paid whatever is left after them. Over-
weighing can now only cost the shop, which is the right direction for a mistake
it alone controls.

**And the claim is now a test with the same name.** `reweigh · over-weighing can
never take money from anyone` asserts the rider is paid the band at 1×, 2×, 13×
and 130× the ordered weight, that she never pays above what she agreed, that the
shop is never paid more than the basket, and that everything out equals
everything held.

### Fixed — SAAHAA was earning nothing from retail, for ever
`ordersCompleted` was read in three places and **written in none**, so every
real shop stayed on order zero permanently: no commission was ever charged, the
3%-capped-₹25 branch was unreachable on any real install, and every "30 free
orders left" counter was frozen. It survived four audits because each mode only
exercised the branch the other got wrong — the demo seeds shops at 60–560
orders, so the demo only ever showed the paid branch and a real install only
ever showed the free one.

### Fixed — a money screen that disagreed with itself
The shop statement printed **₹193 − ₹0 − ₹9 = ₹193**, directly beneath a comment
of mine saying that gross minus deductions disagreeing with net is the one thing
a money screen must never do. It summed order *fields* and deducted a rider line
the customer had actually paid. It is built from the ledger legs now and
reconciles by construction, and the order records whether the shop genuinely
absorbed the delivery.

### Fixed — a pro was told the opposite of what happened to him
After a 60% resolution his screen lost its panel entirely — no outcome, no
reason — while the bill above still read *"receives the full ₹600"* and his
earnings table showed *"₹600 quoted, ₹360 kept"* under *"Kept equals quoted on
every line."* The app told a tradesperson in writing that the ₹240 he had just
lost could not have happened.

He now gets a terminal panel with the decision, the reason, what was paid and
what it means for his record. The admin console promised "three outcomes, with a
written reason" and stored none — a reason is required now, and both sides see it.

### Added — a gate for code that exists and never runs
`tools/lint-dead.mjs`. This repo's characteristic failure is not bad code, it is
**unexecuted** code under a confident comment: `checkInvariants` uncalled through
four audits, `R_REAUTH` declared and unreachable, `WORKER_NO_SHOW` published for
six versions with no caller, `.rail` styled `display:none` while a view rendered
it. None of them errored, blanked or failed a test — only a person reading the
source ever found them.

It blocks on the two precise checks and reports the orphaned-export tail under a
budget that may shrink and never grow, because failing the build on a long tail
teaches everyone to ignore the whole lint — which is how the last measurement
problem started.

### Fixed — the refunds page published rules the app cannot execute
The table is generated from `CANCEL_RULES` so it can never drift — and it was
printing two slot-based rows for a product with **no scheduling at all**, plus a
₹100 pro charge `cancelOrder` has never posted. A generated table is only honest
if what generates it is reachable.

## [8.9.0] — 2026-09-10 — "A shop could mint money"

The fourth customer audit scored 8.8.0 at 5/10 again and found something worse
than any previous round: **a shop could be paid more than the customer ever
paid.** Not a rounding error — ₹414.63 collected, ₹618.15 paid out, on one
order, withdrawable through the ordinary button.

### Fixed — escrow is the ceiling, and nothing can be minted

Three bugs had the same shape: a figure written on the order was trusted over
the escrow balance.

- **Over-weighing minted money.** `setPickedQty` capped *her* charge at what she
  agreed and left `shopPayout` at the heavier figure, so typing 6 kg against a
  2 kg order drove escrow negative. Everything downstream of the cap is scaled
  with it now.
- **A large line refund overdrew escrow.** When a refunded item exceeded the
  shop's share, the payout clamped to zero while the full refund was still
  posted.
- **A return after a reweigh stranded money**, because it refunded
  `o.customerPays` while escrow still held `agreedTotal` — under a screen
  promising the money comes back in full.

Settlement now does one thing in one order: give the customer back what is
hers, read what is actually left, and hand out the rest in priority with the
dispatch cut absorbing the residual — so the account lands at exactly zero by
construction. Verified on the auditor's own repro: ₹2,653 in, ₹2,653 out,
escrow ₹0, book balances, no negative accounts.

### Fixed — the safety net that was never attached

`checkInvariants` is the best-written function in this repo and **nothing
called it.** It knows the book must balance, that no entry may be lopsided and
that no spendable account may go negative — and it sat there through four
audits while two separate bugs drove escrow negative. A net nobody attached is
a comment.

It runs at boot and before every withdrawal now. A payout over a broken book is
refused, and an undismissable banner says so — because quietly continuing is
how the first one went unnoticed.

### Fixed — escalating a return was a one-way door
Asking SAAHAA to step in moved the order to `DISPUTED`, which had no retail
exits *and* was no longer matched by the 24-hour auto-refund sweep. The one
action a worried person takes was the one that stranded her.

### Fixed — two of my own
The erase-blocked sheet threw `ReferenceError: M is not defined`, so the guard
built for people with money in the app was a dead button. And every sheet in
the product depended on a single `requestAnimationFrame` that never arrives in
a background tab or an embedded webview — built, inserted, invisible, no error.

### Fixed — a build that could ship a blank page
A trailing comment after an import's semicolon defeated the bundler's strip
regex, so the statement survived into the single inlined `<script>` and the app
died with "Cannot use import statement outside a module". The only thing that
noticed was the smoke test. `tools/build.py` now tolerates the comment **and
refuses to write a bundle containing a surviving import at all** — verified by
reintroducing the exact shape and watching the build refuse.

## [8.8.0] — 2026-09-10 — "The audit that scored it lower"

8.7.0 shipped on an inference: every severe finding had been fixed, so the
score must have gone up. Nobody re-scored it. A third pair of audits did, and
the customer experience came back at **5/10 — a drop** — with the partner side
at 6/10. Shipping on "I fixed what they said" instead of on a measurement is
the same mistake as believing a comment instead of running the code.

### Fixed — five ways a customer lost money with no recourse

- **The comparison screen bought instead of comparing.** Every row in "Choose
  your pro" was wired straight to `book.confirm`, so one tap on what reads as
  *select* funded escrow and created a live order — no bill, no fee line, no
  cancellation terms, no address, no confirmation. It re-opens the priced sheet
  for that pro now, which is where all of those live.
- **Requesting a return was strictly worse than doing nothing.** `R_RETURN` had
  one exit, reachable only from the shop's own console, so a shop that never
  answered froze the order value for ever — and the customer's screen had no
  control at all. The admin's escape hatch could not reach it either. She can
  escalate now, the owner can end it, and a return nobody answers refunds
  itself within a day.
- **The reweigh refund was computed, shown to both sides, and never posted.**
  This was 8.7.0's fix, and it was decoration again: the order was patched down
  and settlement paid against the smaller figure, stranding the difference in a
  closed order's escrow. Verified now end to end — escrow clears to ₹0 and the
  ₹77 reaches her wallet.
- **And the fix I shipped for it had introduced a ratchet.** Each entry compared
  against the *current* total, so the weight could only ever fall: typing 0.5
  instead of 5.0 was unrecoverable and the shop silently ate the difference.
  `agreedTotal` is pinned once and never moves, so the weight can be corrected
  freely in either direction and the money moves once, at settlement.
- **"Take out to your UPI" sent money to a UPI id the app never asked for.** No
  screen anywhere let a customer set one. There is one now, and the withdrawal
  refuses without it.
- **Deleting your account silently forfeited your money.** Erasure removed the
  user row with no balance check and no payout, so the wallet stayed in a ledger
  nobody could ever sign in to claim — under a sheet itemising "exactly what
  happens" that never mentioned money. It now refuses while anything is held,
  and says what and how much.

### Fixed — the earning side

- **A pro could never set or change his payout UPI.** Onboarding collects it
  once and is unreachable afterwards; the Withdraw button stayed enabled and
  then refused with "add a UPI id first" on a screen with no way to add one.
  The shop's payout screen has done this correctly the whole time, in the same
  file.
- **The shop was handed the customer's permanent door code** and told to ask for
  it — the same code a plumber must type to prove he is standing at her door,
  hers for life and unrotatable. Every shop she ordered from learned it. The
  shop now types what she reads out, like the pro does, and the retail handover
  actually checks it instead of just marking itself done.
- **Passwords were unsalted, single-round SHA-256.** Two people who chose "123"
  had the same stored string, in a blob the admin console can export — while
  the owner's own credential in this codebase has always used PBKDF2 at 250,000
  rounds with a random salt. Every account is salted now, old ones are upgraded
  transparently on their next sign-in, and the session no longer carries the
  credential at all.

### Fixed — the measurement that let this happen
`tools/lint-i18n.mjs` printed **"53 keys, 53 rendered ✓"** while seven were
rendered nowhere and the app was about 2% translated. Its stem escape hatch
matched a prefix anywhere in the tree, and nothing counted how many places
actually call `t()`. It now counts render sites, enforces a floor, and refuses a
key it cannot statically see — which immediately caught seven more.

Coverage went from 28 render sites to 45: the stage tracker, the wallet card and
the money lines are translated, so the order screen is no longer a Telugu
instruction wrapped in an English bill.

## [8.7.0] — 2026-09-10 — "Two of those fixes were decoration"

8.6.0's fixes went back to the same two agents to be checked rather than
believed. They came back at 6/10 and 6.5/10 — and the most useful thing they
found was that two of the repairs I had just shipped were narrative only: the
comment argued the case was closed and the mechanism was not there.

### Fixed — the fixes that did not work

- **A shop still could not withdraw a rupee.** `shopWallet()` walked a `legs`
  array that this ledger has never had, so it returned ₹0 for every shop for
  ever — the button shipped permanently disabled over a real balance.
  `balanceOf()` already knew how to read the ledger; there was never a reason
  to write a second one. Verified: ₹7,327 → ₹6,327, refused without a UPI id.
- **The weighed weight changed no money.** `setPickedQty` stored a number and
  `settleRetail` settled off the old estimate, under a sentence promising an
  approval step nobody had built. Now a lighter weight really does cost less,
  and a heavier one is never taken silently — the order is capped at what she
  agreed and the shop is told to ask her.
- **A translated string nobody renders is not a translation.** The language
  layer shipped 53 keys and rendered 24. Telugu existed for all seven
  onboarding steps, every money word, the door-code errors, and the note saying
  the trade quiz is only in English — all dead, so a pro switching to Telugu
  got two translated paragraphs marooned in an English sign-up. All 53 render
  now, and `tools/lint-i18n.mjs` fails the build on a dead or undefined key.
  It caught two more the moment it was written.

### Fixed — what the re-audits found that the first pass never reached

- **A pro could book himself**, type his own code at the door, photograph
  anything, and let the sweep release it — farming the automatic ladder to
  Background Checked and Certified at 8% of a price he set. The one thing the
  door code exists to prove, proved nothing. The matcher no longer offers you
  yourself and the booking refuses it, comparing the person rather than the
  account, since one number may hold both.
- **Three mistyped characters killed a booking permanently.** DISPUTED had no
  way back to the doorstep, so a pro whose customer read the code out correctly
  two seconds later still had a dead job. There is a retry now — only for a
  code typo, never for a real complaint.
- **A data-destroying bug of mine.** Booking through "Someone else" read the
  address fields unconditionally, and that path renders none — so it wrote an
  empty string over the address she had already saved, on her account and her
  session. A field that is not on the screen has said nothing.
- **The address labels were invisible**, at a contrast ratio of 1.00: the panel
  inverts its background and the field labels kept their dark ink. The whole
  address fix was funnelled through two boxes nobody could read.
- **My `SUB_SIZE` table had 11 keys matching no sub that exists**, including
  three "priced on site" flags on dead names, so a full house move was still
  quoted as a locked price. Nine categories had no table at all. All 118 subs
  are sized deliberately now, and a test fails on a typo, an unsized sub, or a
  category whose biggest and smallest job cost the same.
- **I fixed the fake acceptance for services and missed retail entirely** — a
  grocery order still accepted itself 1.1s in, with no timeout and no refund,
  so an order nobody picked held her money for ever.
- **The fabrication moved rather than left.** The 900ms timer went from the
  stage machine and the order header still printed a name at MATCHING: a
  tradesman "0.4 km away" before anyone accepted, who then appeared to have
  cancelled. No name until it is true.
- **The no-show button was a ₹100 credit farm** — available the instant a job
  was assigned, with nothing recorded against the pro, so the sheet's promise
  that "it is recorded against them" was false. It needs a real wait now, and
  it increments `noShows`.

### Fixed — the money screens
The customer sees **her own release clock** (the pro's screen had it and hers
did not, while nine screens promised nothing moved without her) · a refunded
order says **"Your money is back"** instead of showing the bill she paid · "Sent
to UPI" reads the ledger instead of the owner's manual tick · a pro cannot
withdraw with no UPI on file · the shop owns its **own** minimum-order and
free-delivery dials rather than absorbing a ₹49 ride it never agreed to · every
shop fee line counts down the free 30 · a shop gets a shopkeeper's dispute
reasons, not a doorstep tradesman's · the pro can cancel at EN_ROUTE, which is
where "I cannot come" actually happens.

### Fixed — `?demo=1` was a one-shot
Opening the app once without it — running `?selftest=1`, which the README lists
one line above — purged the roster and left `seeded: true`, so the demo never
came back and the device read "0 pros · 0 shops" for ever. It also silently
broke `tools/shots.py`.

## [8.6.0] — 2026-09-10 — "The promises it could not keep"

Three agents audited this build independently: one walked every customer
journey, one walked the earning side, one diffed the whole tree against the
archives. They converged, and what they found was not bugs at the edges. The
three things the product said loudest were the three it did not do.

### Fixed — the money released itself

*"SAAHAA holds the money until you confirm the work"* appears on the home
screen, the booking sheet, the order page and the footer of every screen. It
was not true. `ESCROW.INSTANT` had `holdMs: 0`, so a job was already past its
release time the moment the pro marked it finished, and the next time anyone
opened the app it paid out — against **two typed notes and no photograph**,
with the customer's screen still reading NOT YET RELEASED.

- INSTANT now holds for two hours. A tier called instant may mean "with no
  review queue in the way". It cannot mean "without her".
- **A note is not a photograph.** The rule said "no photo → never auto-release"
  and the code counted evidence *entries* — so the "Camera not working?"
  fallback, which writes an entry with `photo: null`, satisfied it. The test
  fixtures asserted the hole rather than the rule; they assert the rule now.
- The pro's side of the same screen said "Auto-releases if the customer does not
  respond" with no time on it — and for a new pro, whose first three jobs are
  reviewed, no truth in it either. It states the real wait.

### Fixed — when the pro never came, the only button took 40% of your money

`CANCEL_RULES.WORKER_NO_SHOW` — full refund plus a ₹100 credit — has been in
the engine since v6 and **published on the refunds page the whole time**, with
nothing in the app able to call it. Meanwhile "Report an issue" was gated on a
transition that `ASSIGNED` and `EN_ROUTE` did not have, so at exactly the two
stages where a no-show happens there was no way to report one. The only control
was Cancel, which at EN_ROUTE hands 40% of the money to a journey nobody made.

Both stages can reach DISPUTED now, and a **"They never arrived"** button routes
to the rule that was always meant for it. Verified end to end: ₹462.24 paid,
₹562.24 back.

### Fixed — nobody could actually turn up

There was **no address anywhere in the product**. An order carried an area name
and a pin at the customer's sign-up coordinates, so a tradesperson was sent to a
neighbourhood centroid with no flat number, no landmark and no way to ring —
while this repo's own deck promised him "a job with the address". Both audits,
independently, called this the thing that stops the product working in the real
world. The booking sheet asks once, remembers it, and the pro's screen now
carries the door he has to knock on.

### Fixed — the pro's dead ends
- **Three mistyped characters stranded a job for ever.** Three wrong door codes
  moved the order to DISPUTED and opened *no dispute record*: the owner's queue
  read "No open disputes" while both sides' money sat frozen with nobody
  watching. It raises a real dispute now.
- **He could not cancel** — though the agreement he signs says he will, and the
  conduct quiz marks it the right answer. `WORKER_CANCEL` existed with no caller.
- **A complaint against him showed the word "under review" and nothing else** —
  not the reason, not that his money was frozen, not for how long, and no way to
  answer. "Report an issue" vanished at the same moment, because DISPUTED cannot
  transition to DISPUTED. He gets the reason, the frozen amounts, the
  consequences and a way to put his side.
- **His "Report an issue" offered him the customer's list** — seven accusations
  against himself, each of which froze his own pay. Each side now gets the
  things that actually go wrong on their side of the doorstep.

### Fixed — money with no way out
- **"Yours to withdraw", beside a disabled button.** The UI invented a ₹1,000
  floor, written as a raw `100000` in three places; the engine has always
  allowed ₹10. A plumber's first ₹520 job was locked behind a second one.
- **A shop had no exit at all**: no UPI collected at signup, no withdraw
  control, and the owner's "Mark paid" set a flag and posted nothing — so a
  kirana's takings sat in the ledger for ever with no account to send them to.
- **The shop's statement was ₹5 an order short of its own total**, because it
  showed the rider's share and not the dispatch cut the shop also absorbs.
- **A new shop pays nothing at all on its first 30 orders** — the best thing on
  offer to a kirana, mentioned nowhere. The console even showed "Fees today
  (3%)" to a shop paying 0%. It counts down now.

### Fixed — smaller untruths
"Every pro ID-checked" (tier 1 is a confirmed number and no ID) · "Money lands
here after every job" at the UPI step (nothing is automatic) · a hardcoded
"8% → 6%" on the pro's ladder that ignored the pricing engine · a 60-second
accept timer that does not exist · "Needs you" hardcoded to the customer, so a
pro with three jobs waiting read zero.

### Fixed — the deck tool had been silently broken since 8.4.0
Removing the fake SMS left `deckscenes.js` calling two deleted functions, and
`app.js` swallowed the error into a `console.error` — so **7 of the 50 slides**
had been capturing blank instead of failing. A broken scene now paints its own
error. All 7 verified through the real capture tool.

### Added — scale
`tools/stress.mjs` measures the ceiling rather than guessing it: one pincode
0.32 MB, a ward 1.13 MB, a suburb 2.38 MB, a small city 9.01 MB — past which
the answer is the server, not a bigger phone. And the crash mode it found
first: `writeDebounced` threw away `write()`'s result, so a full device **failed
to save silently** while the app went on looking healthy. It says so now, at the
top of every screen, in a banner that cannot be dismissed. `bids` and
`disputes` are bounded — the dispute cap keeps every unresolved one, because a
plain cap evicts the person who has waited longest.

### Also
`.sidenav` was built into every render and hidden by `display:none!important`
while a comment claimed nothing rendered it — the same shape as the `.rail`
casualty. Nothing was lost with it; the invisible markup is gone and the comment
is true. And `docs/deck/workflows.html` + `tools/deck-pdf.py`: the customer and
partner workflows, both sides of one job, and every earning and saving
opportunity, as a 13-page PDF whose figures are printed by the pricing engine.

## [8.5.0] — 2026-09-10 — "Nothing was deleted; some of it was buried"

A check that the v8 redesign had not quietly dropped features, and repairs for
what it had. The audit was mechanical, not impressionistic: every action, route,
export and file in the current tree compared against the v7.1.0 archive.

**What the audit found.** No files lost. No routes lost. Two exports gone, both
the fake-SMS removal from 8.4.0, deliberately. The current tree carries 164
actions against v7.1.0's 147. Nothing had been deleted — but three useful
things had been made unreachable, which to the person using it is the same
thing.

### Fixed — three things that were there and could not be found

- **"Most booked near you" is back.** The v8 redesign dropped its markup *and*
  set `.rail{display:none}` in the stylesheet, so the single fastest path to a
  common need left the product and the only way to reach a category became
  scrolling to a grid four screens down. The rail is a real component again —
  one swipeable line — and it is better than the one it replaces: v7.1.0 railed
  the first eight categories in catalog order and called them "most booked",
  which was not true. This counts the orders actually placed nearby, puts
  categories with somebody free first, and falls back to the catalog only on a
  fresh install with nothing to count.
- **The home header shortcut is back.** I deleted it in 8.4.0 for anybody with
  no history, because it was falling back to the same four chips the list below
  already showed. That was the wrong half of a real fix: it took the fastest
  path into the product away from precisely the people who had never used it.
  It now carries what nothing else on the screen does — who is free this minute,
  and how many. A returning customer still gets their own history first.
- **My SAAHAA has an index.** Twelve sections were stacked in one long scroll —
  wallet, regulars, live orders, repeating work, messages, reviews, shortlist,
  settings. Nothing had ever been removed from it, but somebody who does not
  scroll to the bottom never learns those exist, which is indistinguishable
  from their having been taken away. A row at the top now lists only the
  sections that have something in them, says how much, and jumps straight there.

### Fixed — a navigation control that silently did nothing
`behavior:'smooth'` is a request, not a promise: several engines and embedded
webviews ignore it and the page does not move at all. **"All 24 categories →"
had this bug already.** Both it and the new section jump now ask for smooth,
check a beat later whether anything actually happened, and land instantly if it
did not.

### Changed
The category chips that trailed "Or pick what you need" now open the rail
directly beneath it instead — the same categories, two more of them, plus the
link to all 24. Nothing left the screen; it stopped being said twice in two
rows that looked alike.

## [8.4.0] — 2026-09-10 — "One code, and nothing to wait for"

Two things, and the second one deletes a whole rail from the plan.

### Changed — there is only one code now, and it is one you already have

The product used to generate three different codes and show them to people on
screens, all of it pretending to be an SMS that was never sent. All three are
gone. **Every code SAAHAA uses is now a person's own permanent SAAHAA code.**

- **At the door.** A job used to carry four random digits the customer had to
  find at the exact moment somebody was standing at her gate. The pro now asks
  for her own code — `C…`, the one on her screen, the same one every job, known
  to nobody who has not actually met her. Jobs booked before this release keep
  their old number and still work; nothing had to be migrated.
- **Signing up as a pro.** Step one used to generate four digits, print them on
  the screen, and ask the pro to type them back — proving nothing at all. It now
  confirms the number they signed up with and **hands them their code**, saying
  what it is for. That is why nobody has to receive a code later.
- **The reference.** They read back the pro's own code, which the pro gave them.

The reason this matters beyond tidiness: **there is no SMS rail on the launch
plan any more.** Not deferred — removed. A DLT-registered sender is money,
weeks of paperwork and a vendor, and it would only ever have delivered numbers
people already hold. The one code SAAHAA still issues is the owner-read password
reset, which is a phone call, and is not sent either.

That turns into a promise the terms now make plainly: **SAAHAA never sends you a
code.** Not by SMS, not by email, not by any message. Anyone who says a code is
coming from us is not us.

### Fixed — the small things that made it feel complicated

Walked as somebody who had never seen it, on a 375px screen.

- **The same four categories were printed twice on the home screen**, one screen
  apart, doing the same thing — because when you had no history the header fell
  back to the suggestions the list below already showed. The header row now
  appears only when it carries something the list cannot: what you booked before.
- **The splash never said what the app was for.** A wordmark, a motto and five
  abstract pillars. It now says, in one line, that you can book a plumber and
  order from the shops on your street.
- **Two promises the product could not keep.** "Close the app. We'll message
  you." — it messages nobody; what is true, and better, is that nothing is lost
  by leaving. And a button labelled "Checkout" that opened the cart.
- **A badge claiming a verification that never happened.** The first rung said
  "Phone Verified" for a step that verified nothing. It says "Number confirmed".
- **In-house metaphor used as functional labels**: "Send to the circle" now
  names its destination — *Ask 5 plumbing pros for their price*. "Why this
  circle holds" → "Why this is safe". "Or say it in one tap" → "Or pick what you
  need". "Open now", over a list mixing people and shops, → "Free near you right
  now". The motto stays a motto.
- Your code's second job is now stated where you find the code.

### Added
- `core/selftests.doorcode.js`. Writing it found a hole in the code I had just
  written: two empty strings compared equal, so an order carrying no code would
  have been opened by an empty field. Fixed, and pinned.

## [8.3.0] — 2026-09-09 — "What we say we do"

An audit of the product from three angles — is it satisfying, does it serve the
people it is for, and does it keep its word about their data — and the repairs
that came out of it.

### Fixed — privacy
- **A pro's verification selfie was published on their public page.** The
  ladder asked for a photograph to prove who somebody is, and the app then
  showed it to everyone, while the privacy page promised a customer "never"
  sees a pro's selfie. `partner.selfie` is now private and separate from
  `partner.photo`, the face a pro chooses to trade under; publishing one is a
  deliberate, separate tap.
- **A phone number written the way people write it was not masked.** The chat
  rule was `\b\d{10}\b`, so "98765 43210" went through in the clear, unflagged
  and unaudited, while the screen said contact details were hidden. Ten digits
  with anything between them now count, "+91" included — and ordinary
  sentences with numbers in them are still left alone.
- Map pin labels were escaped twice, printing `Ram &amp;amp; Co`; a colour went
  raw into a style attribute; the CSP still permitted a font host the product
  stopped using when Archivo was vendored.
- **Every claim on the legal pages was checked against the code**, and the ones
  that had quietly become false were corrected — chiefly "one number is one
  account" (untrue since 8.1.0), what the owner's audit log actually records
  (doing, not looking), what a pro keeps seeing about a customer after a job
  ends, and how precisely a location leaves the device for a map search.

### Added
- **You can remove your own account** (My SAAHAA), and the app shows what will
  happen before it happens: what is removed, what is emptied but kept because
  someone else's record points at it, and what stays — the ledger, because it
  is hash-chained and a business must keep its books. What remains there is an
  account number with nobody behind it.
- **A way back into a forgotten account.** There was none: a pro who forgot
  their password lost their storefront, wallet and history for good. With no
  SMS rail yet, the reset is what a neighbourhood business does — you ring the
  owner, they check it is you, and read out a one-time code that works once and
  expires in half an hour. Only its hash is stored; issuing and using it are
  both audited.

### Fixed — the journeys
From walking them as each person on a 375px screen: a guest who tapped
"Confirm booking" lost the whole journey and now returns to the same priced
sheet; "Book again" went to the order list instead of re-booking; a category
with nobody free was a dead end; the trade quiz never warned that three wrong
answers cost a day's work; a shop accepted an order showing only what the
customer paid, not what she kept; the pro's stake was explained one screen
after it was taken, and is now stated before the code is typed; a cancel quoted
a rule instead of a number.

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
