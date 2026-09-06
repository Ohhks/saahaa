# SAAHAA — continuous delivery, no maintenance window

The model: **trunk-based, every push verified, every tag deployed, every user
picks the new build up without being interrupted.** Nothing in this system is
ever "down for maintenance", because nothing is ever taken down.

## 1. The pipeline (already in `.github/workflows/`)

| Trigger | Workflow | What it proves |
|---|---|---|
| every push / PR to `main` | `ci.yml` | every module parses · 111 domain tests · bundle builds · pre-flight gate · migration lint |
| push to `main` | `deploy.yml` | builds `dist/` and publishes it to GitHub Pages **via Actions** — so a rollback is re-running an older deploy, a button, not a git revert under pressure |
| a `v*` tag | `release.yml` | the release with its CHANGELOG section attached |
| weekly | `keepalive.yml` | keeps the free Supabase project from pausing |

Locally, before any tag: `bash tools/preflight.sh` (the same gate) and
`node tools/guard-ui.mjs` (proves UI work did not touch the engine).

## 2. Why a deploy never needs downtime

1. **Immutable builds.** `tools/build.py` inlines the whole app into one file
   stamped with `BUILD_ID`; the shell's cache-busters and the service worker's
   cache name carry the same stamp, so an old shell can never be paired with
   new modules (the classic half-updated-cache failure).
2. **Forward-only, idempotent data migrations** (`core/migrate.js`,
   `core/migrations.js`). They run at boot, take a snapshot first, verify, and
   roll back automatically on failure. The test suite asserts idempotence, so
   running the same migration twice is a no-op — which is exactly what a
   user who reloads mid-deploy does.
3. **Feature flags as kill switches** (`core/flags.js`, Admin → System &
   audit). Ship dark, switch on, switch off in one tap if it misbehaves —
   no redeploy, no window.
4. **The update watch** (`core/update.js`). The build writes
   `dist/version.json`; the running page polls it every five minutes and on
   returning to the foreground. A different build shows a *"SAAHAA x.y is
   ready — tap to update"* toast that stays until tapped. It never forces a
   reload: a pro half-way through an OTP entry keeps their screen. Because
   state lives in localStorage and migrations are idempotent, the reload is
   safe at any moment.
5. **Rollback = redeploy an older tag.** Data is never migrated *down*;
   the older build simply ignores fields it does not know, and the guard
   prevents an engine change from shipping unnoticed.

## 3. The daily loop for one operator

```
edit → node tools/test-node.mjs → bash tools/preflight.sh
     → git commit → git push            (CI verifies; deploy publishes)
     → users see the toast within minutes, or on their next open
```

A change that needs a data shape change: add a migration (`from: N, to: N+1`),
bump `SCHEMA_VERSION`, write the idempotence fixture, ship. Never edit a
released migration.

A change that is risky: put it behind a flag defaulting **off**, ship, turn
it on for yourself first (Admin → System), then leave it on.

## 4. What "production" adds on top of this

- Supabase migrations (`supabase/migrations/0001…0003`) are the same idea
  server-side: append-only, numbered, applied in order. `pg_cron` runs the
  automations the browser runs today (auto-release, holdback release,
  substitution timeout).
- The Cloudflare Worker receives payment webhooks (`docs/PRODUCTION.md` §4);
  it is versioned and deployed the same way — push, verify, publish.
- Secrets never enter the repo: the pre-flight refuses any bundle that
  contains one (`tools/preflight.sh`, "no forbidden secrets").
