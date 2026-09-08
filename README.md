# SAAHAA

## The real-world problem this solves

A plumber in Kukatpally has no digital existence — he cannot build or maintain
a website, and the apps that would list him take 25% of his price. A kirana
owner cannot list her products without a developer, and quick-commerce apps
take more than her whole margin. Customers pay padded prices to strangers
with no way to verify them. **SAAHAA gives local professionals and shops a
professional digital presence they never build or maintain, lets them keep
100% of their quote (the platform's 8% is laid on top and paid by the
customer), verifies every pro mechanically — and promotes them on the
network's own evidence, not the owner's phone calls — holds the money until
the work is confirmed, and runs itself for a single owner.** Everyone pays
SAAHAA and SAAHAA pays everyone: every rupee enters and leaves through one
door, everyone has a wallet, and the company's own position is read from the
books. Full write-up: [docs/PROBLEM.md](docs/PROBLEM.md).

## Run it

```bash
python tools/serve.py 8772
```

(`tools/serve.py` sends `Cache-Control: no-cache`; a plain `http.server` lets the
browser keep stale modules after an update.)

| | |
|---|---|
| App | <http://localhost:8772> |
| Self-tests | <http://localhost:8772/?selftest=1> |
| Admin | <http://localhost:8772/#/admin> |
| Neighbourhood (map) | <http://localhost:8772/#/nearby> |
| Example roster (local only) | <http://localhost:8772/?demo=1> |
| Single-file build | `python tools/build.py` → `dist/saahaa.html` |

**A new install starts empty.** No customers, no pros, no shops, no products —
the first accounts on a device are the ones somebody signs up. `?demo=1` loads
an example roster and turns the market simulation on **for that page load
only**, for local walkthroughs and for the deck capture
(`python tools/shots.py`, which opens `?shot=<scene>&demo=1`). Nothing about
it reaches a real device without that query string — and a device that was
once opened with it drops the example roster at its next normal boot
(`src/domain/fresh.js`, audited as `data.demoPurged`). The owner can also
wipe a device on purpose: **Admin → System & audit → Fresh start** — type
FRESH, re-enter the password; a snapshot is taken first, the credential and
the dials are kept, and the counts are audited.

## Accounts and IDs

Every account carries an ID: **`C20262001`** for a customer, **`P20262001`** for
a pro, **`S20262001`** for a shop owner — what the account is for, the year it
was opened, then a sequence. It is a name, not a password: it identifies, the
password authenticates.

**One person may hold more than one account on the same number.** A pro who also
buys groceries has a `C…` and a `P…`, each with its own password, wallet and
history. What they cannot have is two accounts of the same kind. Sign-in takes
either a mobile number or an ID; a number holding two accounts asks which one.

Accounts that existed before IDs keep their internal key — every order, partner
row and ledger leg still points where it did — and were assigned an ID by
migration, oldest first. See `src/domain/identity.js`.

## Signing in as the owner

The admin username is **`siidhartha12`**. The password is the owner's own and
is not written down in this repository or in any document — what ships in
`src/core/config.js` (`ADMIN_BOOTSTRAP`) is a PBKDF2-SHA256 hash over a random
salt, 250,000 rounds, which is what a login is checked against.

To change it, either:

- **Admin → System & audit → Change admin password** — writes a new hash into
  the device's state and takes effect immediately; or
- rotate the shipped bootstrap for every fresh device:

  ```bash
  node tools/admin-cred.mjs '<new password>'
  ```

  and paste the printed `{salt, hash, iterations}` block into
  `ADMIN_BOOTSTRAP` in `src/core/config.js`, bumping its `version`.

Login is rate-limited (backoff after 3 attempts, lockout after 5), the session
lives in `sessionStorage` with a 15-minute idle and 8-hour absolute cap, money
movements above ₹5,000 need step-up re-auth, and every attempt is written to
the audit log. See [docs/SECURITY.md](docs/SECURITY.md) for the honest scope of
what client-side auth can and cannot do.

## What is in here

- **The Modernist design.** Archivo (vendored — no CDN), a light paper ground
  with ink text, one red accent spent only on primary actions and live state,
  zero corner radius, and 1–2px rules doing the organising instead of shadows.
  The working side — pro, shop, admin — carries the same system on a dark ink
  strip. 44px touch targets throughout, because the people using it are often
  outdoors on a cheap phone. The drawing it was built from is kept in
  `docs/design/mockup-2026-09-08/`; the rules are in
  `docs/design/DESIGN-SPEC.md`; the system itself is `src/ui/tokens.css`.
- **Maps are real.** OpenStreetMap tiles for the map, Nominatim for geocoding
  and reverse geocoding, and Leaflet **vendored under `/vendor/leaflet`** — no
  CDN, because the CSP allows scripts from `self` only and a tradesperson's
  phone should not depend on a third party's uptime. Enrolment works anywhere
  in the world: a partner or shop sets a place by search, by pin, or from the
  device's own location.
- **Charges are dials, not constants.** Admin → Charges sets the service
  percentage laid on top of a worker's quote, the platform's retail
  percentage, and the delivery bands by distance. **Push** makes them
  effective on every quote made from then on; orders already booked keep the
  fees they were booked with, so a change can never re-price money sitting in
  escrow. Defaults and limits live in `src/domain/settings.js`.
- **The Flow tracker** follows an order through its state machine — who has
  it, which stage, what money is held against it, and what the system is
  waiting for — so a stalled order is visible rather than inferred.
- **Money is integer paise**, double-entry, hash-chained, and reconciles to
  zero; `src/core/money.js` is the only module allowed to do currency
  arithmetic and the build lints for float maths outside it.

## What runs itself

- **Approvals.** Tier 2 was always the seven-step ladder. Since 7.0, tier 3
  *Background Checked* is granted by the system when the evidence holds — 3
  real jobs settled cleanly, rating ≥ 4.3, no upheld dispute, 2 vouches from
  customers who had a job settle or from same-trade Background-Checked pros
  (one per person, ever), and the named reference confirmed by a 4-digit
  code — and tier 4 *Certified* follows after 14 clean days at tier 3. Every
  promotion is audited as actor `auto` with its evidence. The owner keeps a
  kill switch and the dials (Admin → Approvals → Automation) and can still
  approve or suspend by hand. Rules in full: [docs/AUTOMATION.md](docs/AUTOMATION.md).
- **Wallets, for everyone.** Customers, workers and shops each have a wallet
  on the ledger. A booking is funded from the customer's wallet first and only
  the shortfall is collected; refunds land in the wallet; top-up and take-out
  are one tap.
- **One door for money.** `src/core/gateway.js` is the only module that
  touches a payment rail: `collect()` in, `payout()` out. Today it runs in
  `MODE = 'sim'` — a **sandbox UPI** that moves no real money and says so on
  every screen and on every ledger leg (`via: 'upi-sim'`). Wiring Razorpay
  means replacing that one file ([docs/PRODUCTION.md](docs/PRODUCTION.md) §3).
- **The treasury.** Admin → Finance shows the company's position replayed
  from the ledger, never computed: fees earned, GST held, every liability
  (escrow, wallets, stakes, holdbacks, rider pool), money in, withdrawn,
  remitted, and whether it reconciles. Two owner actions — Withdraw fees and
  Remit GST — ask for the password again and are audited.
- **A clean slate.** Production boots empty, demo residue purges itself, and
  Fresh start is one audited, snapshot-first action away.

## Documentation

| | |
|---|---|
| The problem, and the answer | [docs/PROBLEM.md](docs/PROBLEM.md) |
| How this is built | [docs/WORKFLOW.md](docs/WORKFLOW.md) |
| Architecture and safe-update rules | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| First-time setup | [docs/SETUP.md](docs/SETUP.md) |
| Go-live checklist | [docs/LAUNCH.md](docs/LAUNCH.md) |
| Step-by-step to production | [docs/PRODUCTION-PROCESS.md](docs/PRODUCTION-PROCESS.md) |
| What runs itself | [docs/AUTOMATION.md](docs/AUTOMATION.md) |
| When something breaks | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| Release test report | [docs/TEST-REPORT.md](docs/TEST-REPORT.md) |
| Security scope | [docs/SECURITY.md](docs/SECURITY.md) |
| Deploys and rollback | [docs/DEVOPS.md](docs/DEVOPS.md) |
