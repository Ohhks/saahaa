# SAAHAA — what the security actually is, and what it isn't

Read this before real money moves through SAAHAA. It is deliberately blunt.

## What v6 does

- Admin password stored as **PBKDF2-SHA256, 250,000 iterations, 16-byte random
  salt**. Never plaintext, never a bare SHA-256, never `if (pw === '...')`.
- Exponential backoff after 3 failed attempts; **30-minute lockout** after 5.
- Admin session in `sessionStorage` (dies with the tab), **15-minute idle
  timeout**, 8-hour absolute cap.
- Every privileged action written to an **append-only audit log** (who, what,
  when, before/after, amount, reason).
- Ledger entries are **hash-chained**; Admin → Finance verifies the chain and
  shows escrow vs ledger replay side by side.
- Chat is scanned for phone numbers and UPI handles; they are masked and the
  attempt is logged. This protects both sides — off-platform payment is where
  the customer loses recourse and the worker loses the dispute trail.
- Strict CSP; every user-supplied string passes through `esc()` before it
  reaches HTML.
- **No photo, no auto-release** — the single highest-value anti-fraud rule here.

## What it is NOT — the honest list

**There is no client-side authorization. There is only client-side UI hiding.**

| What it looks like | What it actually is |
|---|---|
| The admin password hash ships in the bundle | Extractable, brute-forceable offline. PBKDF2 slows that; it does not stop it. |
| The auth check is a JavaScript `if` | Anyone with DevTools sets `isLoggedIn = true`. |
| Balances, escrow and the ledger live in localStorage | **Fully user-editable.** Any user can grant themselves ₹1,00,000 in ten seconds. |
| Rate limit and lockout counters live in localStorage | Erased by one `localStorage.clear()`. |
| Release timers use `Date.now()` | A device clock rolled back can trigger early auto-release. |
| OTPs are generated and checked in the browser | Present in JS memory. Real OTPs must be server-generated, SMS-delivered from a DLT-registered sender, and validated server-side. |
| The hash chain is verified by the same client that writes it | An attacker recomputes the whole chain in about a minute. Tamper-evidence needs a signature the client cannot forge. |
| Names, mobiles and areas sit in localStorage | Under the DPDP Act 2023 there is no consent record, no erasure path and no breach-notification route here. |

## Before rupee one — server-side, non-negotiable

Auth (httpOnly, SameSite session cookie) · authorization on every endpoint ·
OTP issuance and validation · the escrow state machine · all ledger writes ·
payout instructions · KYC storage · rate limiting · the audit log ·
PSP webhook handling.

## India-specific, when you go live

- You will be collecting money on behalf of third parties. That means an
  **escrow/nodal account** and a PA-PG-licensed partner (Razorpay Route,
  Cashfree Easy Split, PhonePe). RBI's Payment Aggregator rules forbid holding
  customer funds in an ordinary current account.
- **GST registration is mandatory for an e-commerce operator regardless of
  turnover** (CGST §24(ix)). Collect **TCS at 1%** on net taxable supplies
  (§52) and file GSTR-8. **TDS §194-O** at 1% applies to partner payouts above
  the threshold.
- GST on your commission is **18% of the commission**, not 2% of the deal.
  v6 fixed this: the bill now reads `Service ₹1,000 + Platform fee ₹84.75 +
  GST@18% ₹15.25 = ₹1,100.00`. Same customer total, invoice-correct.
- Payouts need beneficiary verification (penny-drop) before the first transfer.
- Aadhaar: store **only** the masked last four plus a hash. Storing a full
  Aadhaar number client-side is a legal landmine (Aadhaar Act §29).
- Food shops must display FSSAI; pharmacies must hold a drug licence before any
  Rx SKU can be listed; meat shops must declare halal/jhatka. v6 models all
  three as shop fields and surfaces them on the shop card.

## The demo credential

`admin` / `saahaa123` is **seeded on purpose** so you are never locked out of
your own prototype. The console shows a standing amber banner about it, and
Admin → System & audit → Change admin password replaces it with a PBKDF2
credential of your own. Do that before anyone else touches the app.

## The cheapest real improvement available today

Export a signed daily snapshot (`{seq, headHash, ts}`) to a file you keep
outside the browser, and verify the current chain head against it at boot.
An attacker can rewrite localStorage; they cannot rewrite the copy on your
Drive. That is the shortest path from "integrity theatre" to something
genuinely useful — and it needs no backend.
