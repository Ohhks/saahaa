# SAAHAA — release test report, v6.7.0 (2026-09-06)

Scripted end-to-end runs against the **real UI** (every step a `data-act`
control, not a domain call) on a **fresh seed**, phone viewport 375×812, with
console errors captured. Where a domain API was used to set state up faster it
is marked *(setup)*; the assertion itself always went through the screen.

Legend: ✅ pass · 🔧 found and fixed in this release · ⚠ known limit

## 1. Guest

| Check | Result |
|---|---|
| Splash on first visit; dismiss like a guest | ✅ |
| Home hero, four groups rendered from the registry | ✅ |
| Search "milk" finds shops/products; clear resets | ✅ |
| Category sheet opens with Best Match; booking as guest redirects to sign-in | ✅ |
| Deep link to a verified pro's page shows Book; unknown pro → smart empty state | ✅ |
| Guest area choice stored as JSON (read back on reload) | ✅ |
| No horizontal overflow on home / shops / earn / auth | ✅ |

## 2. Account

| Check | Result |
|---|---|
| Sign-up rejects a bad mobile; rejects a duplicate account | ✅ |
| Wrong password refused; correct login lands on Home with greeting | ✅ |
| Session survives reload | ✅ |
| Theme toggles | ✅ |
| Area change persists across reload | 🔧 was in-memory only |

## 3. Customer

| Check | Result |
|---|---|
| Sub-service chip selects and threads into the order | ✅ |
| Booking price = deal × 1.08; worker keeps the deal | ✅ |
| Order screen: status hero, timeline, code capsule | ✅ |
| Cancel before work → CANCELLED, refund on order and on the ledger | ✅ |
| Orders list shows it; browser Back returns to the order | ✅ |
| Cart: minimum order (₹149) enforced | ✅ |
| Cart: delivery/pickup control, substitution policy per line | ✅ |
| Ask rates: row offered where worth it; waiting screen with held price; cancel charges nothing | ✅ |
| Ask rates: replies → choose → accept → order + receipt | ✅ |
| My SAAHAA hub | ✅ |

## 4. Partner

| Check | Result |
|---|---|
| Sign-up lands on ladder step 1 | ✅ |
| Wrong OTP refused; right OTP advances | ✅ |
| Aadhaar format checked; only last 4 kept; the number appears nowhere in state | ✅ |
| Same Aadhaar on a second account refused | ✅ |
| Trade quiz: three failures lock for 24 h; pass advances | ✅ |
| Conduct quiz: wrong answers show the rule and never lock | ✅ |
| Bad UPI refused; valid UPI + agree → tier 2, online, page live | ✅ |
| New pro bookable within the ₹1,500 provisional cap | ✅ |
| Job chain: en route → arrived → OTP → photo (finish disabled before it) → WORK_DONE, HOLD tier | ✅ |
| Customer dispute at WORK_DONE → DISPUTED + record | ✅ |
| Open ask visible; rate sent; lost to another pro → coaching sheet | ✅ |
| Pro page edit (3 fields) saved and shown; share button present | ✅ |
| Background check request → pending | ✅ |
| Earnings shown by settlement, not stage (no ₹0 after rating) | ✅ |

## 5. Shop owner

| Check | Result |
|---|---|
| Nine tabs; ready-list picker adds an item | ✅ |
| Negative price refused; valid price edit persists; stock 0 hides + warns; refill | ✅ |
| Close shop → customers cannot add to cart | ✅ |
| Pickup-only → rider order refused, pickup accepted | 🔧 key mismatch |
| Order chain accept → pack → out → delivered → settle → R_CLOSED | ✅ |
| **Not in stock per line**: refund policy refunds at settlement; ask-me → customer decides; similar → substituted | 🔧 new |
| **Pickup**: ready at counter → customer collects (code) → delivered | 🔧 new |
| **Return**: customer requests → shop accepts → refunded in full → closed | 🔧 new |
| Escrow for every retail order empties exactly (in = out = customer paid) | ✅ |

## 6. Admin

| Check | Result |
|---|---|
| Wrong password refused; login; eight sections | ✅ |
| Background request first in the queue with evidence → tier 3 | ✅ |
| Certified candidate → tier 4 | ✅ |
| Suspend / unsuspend | ✅ |
| Dispute with three outcomes; partial → PARTIAL, refund + payout legs | ✅ |
| Resolved dispute leaves the open list | 🔧 status not flipped |
| Payout queue → Mark paid clears the row | ✅ |
| Ledger replay: difference ₹0 | ✅ |
| Moderation renders; hide review | ✅ |
| Kill switch (RETAIL off/on) | ✅ |
| Snapshot; change demo password; in-app suite 102/102 | ✅ |

## 7. Cross-cutting

| Check | Result |
|---|---|
| v6 state blob → v7: depth added, every account kept, no rollback | ✅ |
| Auto-release sweep releases a due WORK_DONE order at boot | ✅ |
| Light theme paints an explicit ground; dark parity | ✅ |
| Icon-only buttons carry aria-labels | ✅ |
| Shell at 375 / 840 / 1440: bottom bar / rail / side-nav, no overflow (see deck) | ✅ |
| Engine guard: protocol + automations byte-identical except deliberate, tested changes | ✅ |

## Known limits (not defects — production items)

- OTP by SMS, ID name-match / liveness, UPI penny-drop and police verification
  are simulated; the ladder is real, the external checks are wired for
  production (see `docs/PRODUCTION.md`).
- The 90-second substitution timer runs while the app is open; in production
  it is a `pg_cron` job (`supabase/migrations/0003_automation.sql`).
- Simulated supply answers ask-rates so the flow can be seen end to end; the
  held pro can also appear as a simulated bidder — cosmetic, removed when real
  pros bid.
- Telugu / Hindi copy is written (design spec) but not yet wired through an
  i18n layer.
