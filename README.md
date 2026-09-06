# SAAHAA

## The real-world problem this solves

A plumber in Kukatpally has no digital existence — he cannot build or maintain
a website, and the apps that would list him take 25% of his price. A kirana
owner cannot list her products without a developer, and quick-commerce apps
take more than her whole margin. Customers pay padded prices to strangers
with no way to verify them. **SAAHAA gives local professionals and shops a
professional digital presence they never build or maintain, lets them keep
100% of their quote (the platform's 8% is laid on top and paid by the
customer), verifies every pro mechanically, holds the money until the work is
confirmed, and runs itself for a single owner.** Full write-up:
[docs/PROBLEM.md](docs/PROBLEM.md).

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
| Example roster (local only) | <http://localhost:8772/?demo=1> |
| Single-file build | `python tools/build.py` → `dist/saahaa.html` |

**A new install starts empty.** No customers, no pros, no shops, no products —
the first accounts on a device are the ones somebody signs up. `?demo=1` loads
an example roster and turns the market simulation on **for that page load
only**, for local walkthroughs and for the deck capture
(`python tools/shots.py`, which opens `?shot=<scene>&demo=1`). Nothing about
it reaches a real device without that query string.

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
