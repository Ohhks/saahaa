# SAAHAA — what a session needs to know before touching anything

Read this instead of rediscovering it. Every fact below cost a real round of
auditing to learn, and re-deriving them by grepping is the single largest
avoidable token cost in this repo.

## What it is

A hyperlocal services + retail marketplace for Hyderabad. Vanilla ES modules,
**no npm, no bundler, no framework.** `tools/build.py --site` inlines everything
into a single-file `dist/saahaa.html`. CSP is `script-src 'self'`.

Serve with `python tools/serve.py <port>` — **never** `python -m http.server`.

## The one command

```bash
python tools/build.py --site && bash tools/preflight.sh
```

Fifteen gates. If it says `PRE-FLIGHT PASSED`, it is safe to push. Do not skip it
and do not push around it.

| gate | catches |
|---|---|
| build freshness | smoke-testing yesterday's bundle |
| `lint-parse.mjs` | **ESM syntax errors `node --check` cannot see** |
| `lint-i18n.mjs` | dead keys, undefined keys, translator shadowed or un-imported, duplicate keys, coverage floor |
| `lint-dead.mjs` | orphan exports (budget 28), unreachable stages, comments inside tags |
| `test-node.mjs` | 301 domain tests |
| `render-views.mjs` | **free variables — renders 30 screens with real data** |
| `journey.mjs` | 17 money journeys, 186 assertions |
| `pay-journey.mjs` | the manual UPI rail, 34 assertions |
| `worker-test.mjs` | who may clear money, 32 assertions |
| `img-test.mjs` | picture sharing actually saves what it claims |
| `qr-test.mjs` | **the QR codes are real QR codes** — RS syndromes, format bits against the published table, and that every earner is given one |
| `admin-test.mjs` | the owner console is not reachable from the customer app, and no screen sends a customer there |
| `schema-test.sh` | **runs `supabase/schema.sql` on a real Postgres in docker** — RLS, the UTR index, the append-only trigger. Skips cleanly with no docker |
| `taste.mjs` / `score.mjs` | contrast, tap targets, type ≥12px; 46-check product score |

Both scores are currently **100/100**. They are ratchets — do not lower a
threshold to make a change pass.

## Traps that have cost whole rounds

1. **Backticks inside an HTML comment inside a template literal** break the ESM
   parse. Caught eight times this project. `lint-parse` names it in one line.
2. **A comment inside a `<tag …>`** — the parser ends the tag at the comment's
   own `>`, eats every attribute after it, and prints the rest as text. This
   killed *every* cancel button in one build.
3. **A free variable is legal JavaScript.** It parses, tests pass, the bundle
   builds — and the screen dies the first time somebody opens it. Three whole
   rounds were lost to `flags`, `t`, and `saving`. `render-views.mjs` exists for
   exactly this; always run it.
4. **An unescaped apostrophe** in an i18n string (`'SAAHAA's …'`) breaks the
   module. Escape it.
5. **A claim about a number on the screen is decided on the number on the
   screen** — not the score behind it, not the deal behind that. "Cheapest here"
   was wrong three times for three different versions of this mistake.

## Money rules, non-negotiable

- Integer **paise** everywhere. Never a float.
- Services: SAAHAA adds **8% on top** of the pro's quote (**6%** tier-4). The pro
  keeps 100% of what he quoted. The fee is never taken out of his price.
- Retail: 3% of basket (5% some categories), min ₹5, cap ₹25 (₹50 some), **first
  30 orders free**, plus ₹5 dispatch on a delivered order.
- A **column of figures must sum to the total printed beside it.** If it cannot
  in whole rupees, the whole column goes to paise — not just the total.
- A figure the reader may type back in (a withdrawable maximum) **never rounds
  up**; use `M.fmtMax`.
- The ledger is **double-entry, hash-chained, append-only**. A claim may never
  post a leg — that would be minting money by typing.

## Identity

One permanent code per person: `C20262001` / `P20262001` / `S20262001`. It signs
them in **and** is the door code. **There is no SMS rail and never will be.**

## Payments — the live rail is manual UPI

Customer pays `saahaa@ptyes` → types the 12-digit UTR → **the pro confirms** (job
may start, no money moves) → **an admin clears it against the bank statement**
(escrow funded, `flow.fundClearedOrder`). One UTR, one live claim — enforced by a
partial unique index in Postgres, not a `SELECT`.

## Pictures

`core/imgstore.js`. A catalogue product resolves to **one shared image** for
every shop that stocks it — 7,960 listings collapse to 199 images. Custom photos
are content-addressed. A 96-byte placeholder renders lists with zero image
requests. Never store a blob in Postgres.

## Conventions

- Comments explain **why**, especially why a bug happened. Keep that voice.
- Translations: every user-facing string through `t()`, in **en/hi/te**. Adding a
  key means adding all three.
- Engine files (`src/domain`, `src/core`, `src/net`, `tools`, `.github`) are
  byte-compared against `../saahaa02`. After changing one:
  `cp <file> ../saahaa02/<file>`
- Changelog entries say what broke and why, not what was added.

## The database

`supabase/schema.sql` is executed for real by `tools/schema-test.sh` (docker,
postgres:16-alpine) against `supabase/schema.test.sql`. It proved three things
that had been asserted for three handovers and were false or untested: a
shopkeeper could not see her own orders (there was no `shops` table at all —
`orders.shop_id` was a dangling text column), a payment could be marked CLEARED
with no ledger leg behind it, and the file's own "idempotent" claim had never
been run twice.

`auth.users` / `auth.uid()` come from Supabase; `supabase/test-auth-stub.sql`
stands in for exactly those two so the rest can run on plain Postgres.

## The owner console

It is **not a route in the customer app**. `admin.html` carries
`data-admin-host="1"` on `<html>`; `src/app.js · ADMIN_HOST` reads that, and
without it the `admin` view is not in the route table at all — `#/admin`
resolves to nothing and `go('admin')` lands on home. One bundle, one repo, two
doors; `tools/build.py --site` emits `dist/admin.html` from the same HTML.

**That is not the access control.** Anyone can request `admin.html` and meet the
password. What makes that safe: the credential is a PBKDF2 hash (the plaintext
is nowhere in this repo), and the browser has no authority to move money — the
Worker holds the service-role key. Put Cloudflare Access in front of
`/admin.html` for a real boundary.

Nothing in the customer app may mention it. A ledger banner once told customers
and plumbers to "Open Admin → Finance"; they now read that payouts are on hold,
that their money is safe, and that there is nothing for them to do.

## QR codes

`core/qr.js` — byte mode, level M, versions 1–10, written here because the CSP
forbids a CDN and there is no npm. Every earner's console shows one that opens
their own page; `views/pro.js · profileUrl` builds both the code and the copied
link so they cannot diverge. Saved as SVG: a blurred QR does not scan.

A QR encoder looks finished long before it is correct — the first draft built
its generator polynomial in the wrong order and produced perfect-looking,
uncorrectable symbols. Only the syndrome check in `tools/qr-test.mjs` found it.

## Deploying

`docs/DEPLOY.md` — Supabase (Mumbai) → Worker secrets → Pages → GitHub secrets →
webhook. `docs/WORKFLOWS.html` is the whole product in one page.
