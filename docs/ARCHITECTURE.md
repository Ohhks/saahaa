# SAAHAA v6 — architecture & the safe-update rules

> The whole point of this rewrite: **you can ship an update every week without
> breaking what already works, and without logging anybody out.**

---

## 1. The shape

```
index.html              shell only — CSP, fonts, one module tag
src/
  app.js                the ONLY file that knows about every other file
  core/                 no business knowledge lives here
    version.js          the one place a release number is written
    id.js               collision-free, device-prefixed ids
    bus.js              pub/sub for side effects (never state truth)
    store.js            immutable tree + dispatch/subscribe/select
    persist.js          the ONLY module that touches localStorage
    migrate.js          versioned migration chain + snapshot + rollback
    migrations.js       append-only migration steps
    registry.js         the Open/Closed seam
    flags.js            feature flags = kill-switch + canary
    crypto.js           sha256 + hash-chained ledger
    audit.js            append-only log of privileged actions
    adminauth.js        PBKDF2 admin login, rate limit, lockout, session
    security.js         input hardening + session policy (DOM-free, network-free)
    config.js           backend selection + ADMIN_BOOTSTRAP (a hash, never a password)
    health.js           boot invariants -> safe mode instead of white screen
    money.js            the ONLY module that does currency arithmetic
    selftest.js         the test harness
    selftests.js        the suite (62 cases) — this is our CI
    ctx.js              app context singleton (breaks import cycles)
  domain/               business rules, zero DOM
    catalog.services.js 16 service categories
    catalog.retail.js    8 retail categories
    starter-catalog.js  ~180 seed SKUs shop owners tap to list
    pricing.js          service + retail money engine
    orders.js           the two state machines, as registry entries
    trust.js            verification ladder, trust score, escrow tiering
    match.js            areas, distance, the locked-match engine
    state.js            state tree + registered reducers
    settings.js         the owner's charge dials: service %, retail %, delivery bands
    flow.js             the use-cases (views call these, never dispatch raw)
    seed.js             empty by default; the example roster only under ?demo=1
  ui/
    tokens.css          the design system
    brand.css           splash + emblem motion
    dom.js              the ONLY module that touches the DOM API
    map.js              the ONLY module that touches Leaflet / OSM / Nominatim
    logo.js             the emblem, as inline SVG
    splash.js           "Welcome to SAAHAA"
    views/              one file per screen
    deckscenes.js       capture scenes, loaded only under ?shot=<scene>
vendor/leaflet/         Leaflet, vendored — the CSP allows scripts from self only
tools/build.py          inlines everything into dist/saahaa.html
```

## 2. SOLID, concretely

| Letter | Where it actually lives here |
|---|---|
| **S**ingle responsibility | The hard-won ones are `persist.js` (storage), `money.js` (arithmetic), `dom.js` (the DOM). Nothing else may touch those three concerns — `tools/build.py` **fails the build** if they do. |
| **O**pen/closed | Three append-only seams: `registry.js` (categories, order stages, reducers), `migrations.js`, and the import list in `app.js`. Adding a category, a stage or a slice of state means **adding a file**, never editing logic. |
| **L**iskov | Every registered category satisfies the same contract, and every order stage does too, so `orders.js` and the tracker treat them interchangeably. A category needing "special handling" must express it as a contract field (`unit`, `minTier`, `recurring`, `takePct`) — never as `if (cat === 'x')`. |
| **I**nterface segregation | `money.js` exposes `add/pct/split/fmt`, not a god "utils". Views receive the slice they render, not the whole tree. |
| **D**ependency inversion | Views depend on `ctx` + `flow`, never on `localStorage` or `BroadcastChannel`. Swapping persistence for Supabase touches **one file**. Likewise `ui/map.js`: views call `mapInto` / `geocode` / `locate` and never touch `L`, so the tile source or the geocoder is one file's problem. |

## 2b. Three things worth knowing before you read the code

**The store starts empty.** `buildSeed({ empty: true })` is what production
boots with — the owner's credential and nothing else. `?demo=1` (and `?shot=`,
for the deck capture) is the only path to the example roster, and it also
turns the `SIM_MARKET` flag on for that page load, which is what answers
ask-rates locally. Nothing about either reaches a device that did not ask.

**The admin password is not in the repository.** `ADMIN_BOOTSTRAP` in
`core/config.js` is `{username, salt, hash, iterations, version}` — a
PBKDF2-SHA256 hash, 250,000 rounds. `core/adminauth.js` re-derives and
compares; `tools/admin-cred.mjs` mints a replacement block. A device that has
rotated its own password (`changedAt > 0`) keeps it; one that has not picks up
a newer bootstrap `version` on the next load.

**Charges are state, not constants.** `domain/settings.js` holds the service
percentage, the retail percentage and cap, the delivery bands and the rider
dispatch cut, with a validated range per dial. `pushPricing()` writes them and
stamps `pushedAt` / `pushedBy`; every quote made afterwards reads them. Orders
snapshot their fees at booking, so a push can never re-price money already in
escrow — that invariant is the reason the dials can be a console control at
all.

## 3. Adding something without breaking anything

Adding a **service category**: append one object to `domain/catalog.services.js`.
Tiles, search, matching, pricing, admin filters and the self-tests all pick it up.

Adding an **order stage**: append one entry to `domain/orders.js` with its `to[]`
list. The tracker, badges, admin queues and the legality guard derive from it.

Adding a **slice of state**: `register('reducer', {id, slice, reduce})` in a new
file. `combineFromRegistry()` finds it; the store is untouched.

Adding a **retail category**: append to `domain/catalog.retail.js` and add its
aisles + SKUs to `domain/starter-catalog.js`. Shops can list it immediately.

## 4. The safe-update checklist

1. Branch. Never commit to `main` directly.
2. Decide the seam. If you're editing `orders.js` or `app.js` to add a feature,
   stop — the registry contract is missing a field. Extend the contract first,
   as its own commit, with tests.
3. Ship behind a flag. Add `FEATURE_X: false` to `core/flags.js`; guard all new
   paths with `isOn('FEATURE_X')`.
4. **If the state shape changes at all** — new field, renamed field, changed
   type — bump `SCHEMA_VERSION` and add a migration. Migrations are append-only
   and are never edited after release. New fields must be additive with a default.
5. Write the tests: one money vector, one transition-legality case, one
   migration-idempotence case, one referential-integrity case.
6. Run the suite: `index.html?selftest=1`, or Admin → System & audit → Run tests.
   **`failed` must be 0.** This is our CI.
7. Migration dry-run on real data: load with your own populated localStorage,
   confirm `rolledBack: false` and health `ok: true`, confirm a backup was written.
8. Smoke path (5 min, fixed script): book a service → walk every stage → confirm
   release → reconciliation still balanced → add to cart → place a retail order →
   list a product as a shop → refresh → state survived.
9. **Rebuild the bundle**: `python tools/build.py`, then open `dist/saahaa.html`.
   This is the step everyone forgets, and it's the one that catches scope bugs.
10. Update `CHANGELOG.md`, bump `VERSION` and `BUILD_ID` in `core/version.js`.
11. Commit, merge, `git tag -a v6.1.0`. **An untagged release cannot be rolled
    back, and therefore isn't a release.**
12. Canary: ship with the flag off, turn it on for yourself for one session,
    default it on in the *next* release, delete the flag one release after that.
    Flags older than two releases are tech debt.
13. Rollback drill: `git checkout <prev tag>` + Admin → System → Restore backup.
    If you can't name the backup key that restores this release, don't ship it.

## 5. Failure modes we actually guard

| Break | Guard in this codebase |
|---|---|
| Half-updated cache — old shell, new modules | `?v=BUILD_ID` on every asset; `BUILD_ID` shown in the admin header |
| Migration runs twice, or two tabs migrate at once | `SAAHAA_MIGRATION_LOCK` with a 10s TTL; every step is idempotent and guarded by `schemaVersion < to`; idempotence is asserted in the suite |
| Silent money drift | Integer paise everywhere; `reconciles` flags on every quote; the build **lints** for float arithmetic outside `money.js`; Admin → Finance shows escrow vs ledger replay side by side |
| Orphan records after a rename | Registry entries are append-only; unknown ids return a **tombstone** that renders a legible "Legacy: x" chip instead of throwing; `health.js` counts orphans; migrations remap ids rather than dropping them |
| One bad view white-screens the app | `render()` wraps each view in try/catch and renders an inline error card with the version; `window.onerror` at boot offers safe mode |
| A re-render eats what you were typing | `mount()` skips byte-identical writes and restores focus, caret and scroll |

## 6. Running it

```bash
python -m http.server 8772 --directory C:\Users\siidhu\saahaa
```

- App: <http://localhost:8772> — **empty**, as production is
- With the example roster: <http://localhost:8772/?demo=1>
- Tests: <http://localhost:8772/?selftest=1>
- Admin: <http://localhost:8772/#/admin> — username `siidhartha12`, the owner's
  own password (see `docs/SETUP.md` → *Your admin credential*)
- Deck capture: `python tools/shots.py`, which opens `?shot=<scene>&demo=1`
- Single-file build: `python tools/build.py` → `dist/saahaa.html` (double-clickable)
