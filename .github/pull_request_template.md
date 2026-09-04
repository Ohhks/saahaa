## What changed

<!-- One or two sentences. What does a user see that they did not before? -->

## Checklist

- [ ] `node tools/test-node.mjs` — 0 failures
- [ ] `python tools/build.py --site` then `bash tools/preflight.sh` — passes
- [ ] If the state shape changed: `SCHEMA_VERSION` bumped **and** a migration added
- [ ] If a feature was added: it is behind a flag in `core/flags.js`, defaulting to `false`
- [ ] `CHANGELOG.md` updated
- [ ] Smoke-tested by hand: book a service → walk every stage → confirm release → reconciliation still balanced

## Rollback

<!-- Which tag do we go back to if this is wrong? -->
