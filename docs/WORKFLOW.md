# How SAAHAA is built — the working method

One person owns this product, and most of the engineering is done by an AI
running agents. This is the method that keeps that safe. It is the same every
release.

## The rule that makes everything else possible

**The engine is frozen unless a release deliberately changes it.**
`src/domain`, `src/core`, `src/net`, `supabase`, `.github`, `tools` are
compared byte-for-byte against the snapshot at `../saahaa02` by
`node tools/guard-ui.mjs`, and every view must keep every `data-act`,
`data-role`, element id and export it had. UI work therefore cannot change
what the product does — only how it looks. When a release does change the
engine, the change is made by the lead alone, tested, and the snapshot is
refreshed on purpose.

## The waves

1. **Foundations (lead, alone).** Anything two agents would both need — a
   new state slice, a domain module, a contract module such as `ui/map.js`,
   CSP, registered actions in `app.js`. Lands before any agent starts, with
   tests green.
2. **Build (agents, in parallel, strict file ownership).** Each agent owns
   named files and nothing else; it never edits `app.js`, the engine or
   another agent's file. Contracts are written in the brief: the exact
   exports a view must provide, the exact actions `app.js` already routes to
   them, the ids other agents will look for. Every agent verifies its own
   work in the browser (`?demo=1` for data) and reports its data-act / id /
   export diff.
3. **Guardian (one agent, after the build).** Runs the guard, the tests and
   the end-to-end matrix (`docs/TEST-REPORT.md` style) over the real UI, and
   fixes drift in the UI layer only. Anything it cannot fix comes back to the
   lead with file:line.
4. **Integrate (lead).** Apply the agents' reported snippets for `app.js`,
   reconcile contracts, refresh the engine snapshot if the engine changed,
   run: `node tools/test-node.mjs` → `node tools/guard-ui.mjs` →
   `python tools/build.py --site` → `bash tools/preflight.sh`.
5. **Ship.** CHANGELOG section, version bump, tag, push. CI re-runs the same
   gates; Pages deploys; users get the "update is ready" prompt. Screenshots
   for the deck regenerate with `python tools/shots.py` (they are the real
   product, photographed), and the deck republishes to the same link.

## What is never delegated

- Money and protocol changes (pricing, escrow, ledger, auction, verification).
- Credentials and secrets (`tools/admin-cred.mjs`, `src/core/config.js`).
- `app.js` — the one file that knows every other file.
- Git: commits, tags, pushes, repository settings.

## What every brief contains

Files owned · files forbidden · the read list · the contract (exports,
actions, ids) · the verification the agent must do itself · the exact shape
of the report (diffs, snippets for the lead, what was left undone and why).

## Test data

Production starts empty. `?demo=1` loads the example roster into an UNSEEDED
store only — a browser that already holds real accounts keeps them (clear the
site data first, or use a private window). It loads the example roster and switches the
simulated market on for that page load only; nothing about it is ever
shipped to a real device without that query string.

## The agents, by name — the roster used for 6.9.0 "Nothing borrowed"

Every release uses the same five roles. The brief for each is written fresh;
the role does not change.

| Role | Owns | Never touches | Reports |
|---|---|---|---|
| **Lead** (the AI's own session) | foundations: state slices, domain modules, `ui/map.js`-style contracts, `app.js`, CSP, credentials, git | — | the release itself |
| **Builder(s)** — e.g. *auth + maps + header*, *admin console* | the named view files in the brief | `app.js`, engine, other builders' files | exports added, ids and `data-act`s added, snippets the lead must paste into `app.js`, what was left undone |
| **Security** | `core/security.js`, `core/selftests.security.js`, `docs/SECURITY.md` | views, `app.js` | findings by file:line with the fix, tests written, anything it saw that it could not touch |
| **Cleanup** | copy and docs, removal of demo/example material | engine, credentials | a list of what it removed and what it wants the lead to change in lead-owned files |
| **Guardian** | `src/ui/**` fixes, `docs/TEST-REPORT.md` | `app.js`, engine, `index.html`, tools, git | the matrix: PASS / FIXED (file:line) / BLOCKED (file:line + snippet) |

Rules that held for 6.9.0 and hold for every release after it:

- A builder that needs an engine change does not make it. It reports the
  snippet; the lead lands it, tests it, refreshes `../saahaa02`.
- Two agents never own one file. When a finding lands in another agent's file
  (the security review found two HTML sinks in `ui/map.js` and `app.js`), the
  lead applies it after the build wave.
- The guardian runs last and runs alone, so its browser is looking at the
  integrated product, not at five moving targets.
- The lead runs the four gates in order before every commit:
  `node tools/test-node.mjs` → `node tools/guard-ui.mjs` →
  `python tools/build.py --site` (0 lint problems) → `bash tools/preflight.sh`.
- The deck is re-shot after the guardian, never before, because it photographs
  the real product.

## The roster used for 7.0.0 "Self-running"

The release changed the engine on purpose — a clean slate, peer-to-peer
verification, the gateway door, the customer wallet, the treasury, schema
v9 — so the lead's foundations wave was the largest of the release and landed
first, with `core/selftests.auto.js` green, before any builder started. Three
agents then built in parallel; the guardian ran last and alone.

| Role | Owns | Never touches | Reports |
|---|---|---|---|
| **Lead** (the AI's own session) | `domain/fresh.js`, `domain/autoverify.js`, `domain/treasury.js`, `core/gateway.js`, the wallet and `fund()` in `domain/flow.js`, `settings.automation` in `domain/settings.js`, the v8 → v9 migration, `core/version.js`, `app.js` action registrations and the boot sweep, `core/selftests.auto.js`, credentials, git | — | the release itself |
| **Admin builder** | `ui/views/admin.js`: Approvals → Automation (dials, kill switch, pipeline), Finance → Treasury (position, Withdraw fees, Remit GST behind step-up), System & audit → Fresh start (type FRESH, step-up) | `app.js`, engine, other builders' files | ids and `data-act`s added, snippets for `app.js`, what was left undone |
| **Customer / partner builder** | `ui/views/account.js` (the wallet: balance, top-up, take-out, sandbox label), `ui/views/partner.js` (Standing: the tier-3 checklist, the reference code, the Certified countdown), `ui/views/pro.js` (Vouch) | `app.js`, engine, admin files | the same |
| **Docs** | `CHANGELOG.md`, `README.md`, `docs/AUTOMATION.md`, `docs/PRODUCTION.md`, `docs/LAUNCH.md`, `docs/PRODUCTION-PROCESS.md`, `docs/SECURITY.md`, `docs/WORKFLOW.md`, `docs/deck/manifest.json` | `src/`, `tools/`, `.github/`, `docs/TEST-REPORT.md`, `docs/presentation.html` | files changed, the `tools/check-version.py` result, anything unsure |
| **Guardian** | `src/ui/**` fixes, `docs/TEST-REPORT.md` | `app.js`, engine, `index.html`, tools, git | the matrix: PASS / FIXED (file:line) / BLOCKED (file:line + snippet) |

What was different from 6.9.0: no separate security or cleanup agent. The
security rules of the release (step-up on the two treasury actions and on
Fresh start, one vouch per person, the reference code) were designed into the
engine by the lead and documented by the docs agent; the cleanup that 6.9.0
needed had already been done. The docs agent wrote the deck captions for the
four new scenes (`c15-wallet`, `p14-standing`, `a11-treasury`,
`a12-automation`) before the screenshots existed; the lead captured them after
the guardian, as always.
