# SAAHAA 8.0 "Modernist" — the build spec

The mockup at `docs/design/mockup-2026-09-08/` is the **look**. The shipped
product (v7.1.0) is the **behaviour**. This release changes the first and keeps
the second, exactly. Every agent builds against this file.

## The one rule

**Nothing about what the product DOES may change.** Every `data-act`, element
id, exported function, route, ledger leg, price, tier rule and automation stays
as it is — `node tools/guard-ui.mjs` fails the build otherwise. If a screen
looks better with a control removed, the control stays and the *styling*
changes.

## Where the mockup and the product disagree — the product wins

The mockup's sample copy says SAAHAA charges **3%, taken from the pro's side**
("SAAHAA fee (3%) · You keep ₹339.50"). The shipped economics, decided by the
owner in v6.6.0 and built through v7.1, are **8% laid on top of the worker's
quote, paid by the customer, worker keeps 100%**, with the ledger, treasury,
GST split and legal pages all resting on it.

**Keep the product's economics. Take the mockup's look.** Never hard-code a
percentage or a rupee figure in a view: read `getPricing()` /
`domain/settings.js`, the way `views/legal.js` already does. A screen that
prints "3%" is a defect.

Sample place names in the mockup (Kondapur, Rao Electricals) are mockup data —
the app's own seed and the live store supply names.

## The system (already in `src/ui/tokens.css` — do not re-derive)

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f3f2f2` | the paper ground (light theme) |
| `--color-surface` | `#eae9e9` | raised blocks |
| `--color-text` | `#201e1d` | ink |
| `--color-accent` | `#ec3013` | the one red — primary actions, live state |
| `--color-divider` | ink at 40% | the 1–2px rules that do the organising |
| neutral ramp | `--color-neutral-100…900` | greys |
| accent ramp | `--color-accent-100…900` | tag grounds, hovers |
| radius | **0 everywhere** | `--r-*` are 0 on purpose |
| font | **Archivo**, vendored in `vendor/fonts/` | headings and body |

Dark theme is the same system inverted (ink ground) and already works — the
mockup shows the light side only. Both must stay correct.

### Component classes (verbatim from the mockup)

`.btn` `.btn-primary` (accent ground, paper text) `.btn-secondary` (divider
border) `.btn-block` · `.tag` `.tag-accent` `.tag-neutral` · `.field > label` +
`.input` (36px min, accent caret) · `.seg` / `.seg-opt` · `.sec` · `.row` ·
`.thumb` (grey placeholder block) · `.apphdr` · `.tabbar` · `.table` · `.cap`

Touch targets 44px. No emoji anywhere — drawn glyphs from `ui/icons.js`.

## The 22 mockup screens → where they live in the app

| # | Mockup screen | App route / view | Owner |
|---|---|---|---|
| 1 | Home | `#/home` `views/home.js` | A |
| 2 | Search & filters | `#/home` search + `#/shops` | A |
| 3 | Service detail | `#/pro/<id>` `views/pro.js` | B |
| 4 | Home — the ask | `#/home` hero + `views/ask.js` | A |
| 5 | Quotes arriving | `views/ask.js` waiting | A |
| 6 | **Chat with the pro** | order chat (`flow.sendChat`) — **no screen yet** | B |
| 7 | **Neighbourhood** | map-first browse — **no route yet** | A |
| 8 | Shop storefront | `#/shop/<id>` `views/shops.js` | A |
| 9 | Order tracking | `#/order/<id>` `views/orders.js` | B |
| 10 | Request a job | `views/ask.js` compose | A |
| 11 | Booking & payment | booking confirm sheet | B |
| 12 | Ratings & reviews | `flow.rateOrder` sheet | B |
| 13 | Profile / settings | `#/account` `views/account.js` | B |
| 14 | Leads | `#/partner` `views/partner.js` | C |
| 15 | Quote builder | `ask.bidSheet` | C |
| 16 | Earnings | partner earnings | C |
| 17 | Today | `#/shopadmin` | C |
| 18 | Listings | shopadmin catalog | C |
| 19 | Money & fees | shopadmin money | C |
| 20 | Which side are you on | `#/auth` role picker + `#/earn` | C |
| 21 | Shop setup | `views/onboard.js` | C |
| 22 | You're live | onboard success | C |

Admin (8 sections), legal pages and the shell are not in the mockup: owner D
applies the same system to them so nothing looks foreign.

## File ownership (no agent touches another's file)

- **A — customer core:** `views/home.js`, `views/shops.js`, `views/ask.js`
- **B — customer money & trust:** `views/orders.js`, `views/pro.js`,
  `views/account.js`, `views/legal.js`
- **C — the working side:** `views/partner.js`, `views/earn.js`,
  `views/onboard.js`, `views/auth.js`
- **D — admin & shell:** `views/admin.js`, `ui/dom.js`, `ui/splash.js`,
  `ui/map.js`, `ui/icons.js`
- **Lead only:** `src/app.js`, `src/core/**`, `src/domain/**`, `index.html`,
  `tokens.css`, `brand.css`, `tools/**`, git.

Needed a change in a lead file? Report `file:line` + the exact snippet.

## Definition of done — 100% workflow

The guardian walks every flow through real `data-act` controls, on the new
design, at 375 / 840 / 1440, light and dark:

1. Empty production boot; sign up customer + partner + shop owner.
2. Customer: search → category → book → pay from wallet → track (map) → chat →
   confirm → rate. Ask-rates: compose → quotes arrive → accept → order.
3. Partner: ladder 1–7 → leads → quote builder → job chain (code + photo) →
   earnings; stake locked and returned.
4. Shop: today → listings → order chain → money & fees.
5. Admin: charges push re-prices; flow; treasury reconciles; automation;
   fresh start.
6. No console errors except the known `version.json` 404. No horizontal
   overflow. No emoji. aria-labels on icon-only buttons.

Gates after every change: `node tools/test-node.mjs` (FAIL 0) →
`node tools/guard-ui.mjs` ("engine frozen · contract kept") →
`python tools/build.py --site` (0 lint) → `bash tools/preflight.sh`.
