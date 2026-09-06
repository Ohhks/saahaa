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

Production starts empty. `?demo=1` loads the example roster and switches the
simulated market on for that page load only; nothing about it is ever
shipped to a real device without that query string.
