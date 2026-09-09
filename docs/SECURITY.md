# SAAHAA — the security model, stated honestly

Read this before real money moves through SAAHAA. It is deliberately blunt,
because the most dangerous thing a security document can do is flatter the
system it describes.

---

## 0. The one sentence that governs everything

**SAAHAA today is a client-only app. A client-only app can guarantee integrity
against accident, and it can guarantee nothing at all against its own
operator.**

Everything in `src/` runs inside the user's browser. The code is readable, the
storage is editable, and the checks are `if` statements the user owns. So:

- Client-side rules are **correctness, cost and hygiene** boundaries. They stop
  junk data, they make guessing slow, they refuse a bad password at the moment
  it is chosen.
- Client-side rules are **never** an authorization boundary. There is no arrangement
  of JavaScript that makes a browser trustworthy to the server behind it.

The real boundary already exists, in `supabase/migrations/`. It is not
theoretical — it is 40 RLS policies and a wall of `SECURITY DEFINER` functions.
It is simply **not yet the thing the app runs against by default**
(`backendMode()` is `auto`, and with no Supabase URL configured the app runs
purely local). Turning that on is the single change that moves SAAHAA from
"honest prototype" to "can hold a rupee".

---

## 1. What is enforced client-side, and what that is worth

| Rule | Where | What it is genuinely worth |
|---|---|---|
| Admin password → PBKDF2-SHA256, 250,000 rounds, 16-byte random salt | `core/adminauth.js` | The password is never in the repo. Extracting it from the shipped hash costs an offline brute-force per candidate. **Real** value against a shoulder-surfer or a curious contributor; **no** value against someone who edits `isLoggedIn`. |
| Admin backoff after 3 fails, 30-min lockout after 5 | `core/adminauth.js` | Slows an over-the-shoulder guesser on a real device. Erased by `localStorage.clear()`. |
| User login gate: 5 free fails, then 30 s doubling to a 15-minute ceiling, **per mobile** | `core/security.js` | Makes credential stuffing on a shared or stolen phone slow and visible. The 15-minute **cap is deliberate**: an unbounded lockout is a denial-of-service an attacker can point at a victim's own account. Erased by `localStorage.clear()`. |
| Password quality: ≥ 8 chars, not all digits, not one of the 50 most-guessed, not the user's own mobile, not one repeated character | `core/security.js` → `passwordProblem()` | The only place refusing a weak password helps is the moment it is chosen. That is exactly where this runs. |
| One mobile → one spelling; one account **per role** | `core/security.js` → `normaliseMobile()`, `domain/identity.js`, `views/auth.js` `doSignup()` | `+91 98765 43210`, `098765-43210` and `9876543210` collapse to one number. Since 8.1 that number may carry **three** accounts — `C…` customer, `P…` professional, `S…` shop — each with its own password, wallet and history; `doSignup()` refuses a second of the same kind. The login gate counts fails against the **number**, so a `C…`/`P…` code cannot be used to dodge it. The account code is a name, not a credential: printed whole, never masked. |
| Free text is stripped of control, zero-width and bidi-override characters and length-capped | `core/security.js` → `safeText()` | A shop cannot register a name containing `U+202E` that renders as a different name. This is a **storage** rule; it deliberately does **not** escape markup. |
| Only `http:`/`https:` ever becomes a link | `core/security.js` → `isSafeUrl()` | Blocks `javascript:`, `data:`, `blob:`, `vbscript:`, `file:` — including the `java\tscript:` form the HTML parser un-mangles for you. |
| **Every** user string escaped at render | `ui/dom.js` → `esc()` | The XSS boundary. It is only as good as its coverage — see §3. |
| User session expires after 30 days | `core/security.js` → `USER_SESSION_MS`, applied in `core/ctx.js` | A signed-in session used to be immortal. It now carries `issuedAt`; `restoreSession()` refuses and clears anything older. A session stored **before** this release has no `issuedAt` and is treated as untrustworthy, so everyone signs in once after upgrading. That is the correct trade. |
| Admin session in `sessionStorage`, 15-min idle, 8-hour absolute cap, step-up re-auth above ₹5,000 | `core/adminauth.js` | Dies with the tab. Good hygiene on a shared laptop. |
| Every privileged action in an append-only audit log | `core/audit.js` | Makes admin actions reconstructible. Also editable by the operator — it is a **record**, not evidence. |
| Ledger entries hash-chained (SHA-256, `prev → hash`) | `core/crypto.js`, verified in Admin → Finance | Detects **accidental** corruption and a naive edit instantly. An attacker recomputes the whole chain in about a minute, because the chain is verified by the same client that writes it. See §7. |
| Chat scanned for phone numbers and UPI handles | `domain/flow.js` → `sendChat()`, `maskContact()` | Deters a careless share and writes a `fraud.offplatform` audit entry. **Evadable by spacing the digits** — see §3, open finding 3. Do not sell it as protection. |
| **No photo, no auto-release** | `domain/flow.js` | The single highest-value anti-fraud rule in the product. |
| **Pictures live outside the state blob**, one storage key each; a record holds an id, never bytes | `core/photos.js` | Writing one picture writes one key, so a shop front never rides along with every keystroke's state flush. It also means a wipe or a `gc()` can reclaim them precisely. |
| **Picture budget: 3MB per device, 90KB per picture — refuse, never evict** | `core/photos.js` → `MAX_TOTAL`, `MAX_ONE`, `put()` | localStorage is ~5MB for the whole origin, shared with the state, the audit log and the backups. Over budget the app says so; it never deletes somebody else's published picture to make room. |
| **Only a real raster data URL is ever handed to an `<img>`** | `core/photos.js` → `isPhotoUrl()` | The store is user-editable. A value that is not `data:image/(jpeg|png|webp);base64,…` is treated as missing, so a hostile store cannot turn a picture slot into a `javascript:` or SVG sink. |
| **EXIF is destroyed, not stripped** | `ui/photo.js` → `encode()` | Every picture is redrawn into a canvas and re-encoded as JPEG. What is stored is a new file: no camera model, no timestamp, and — the one that matters — **no GPS tag**. The Privacy page states this; it is a property of the pipeline, not a promise. |
| **The verification photograph is not the public portrait** | `domain/flow.js` → `setPartnerSelfie()` / `setPartnerPhoto()`; rendered only in `views/onboard.js` | `partner.selfie` is captured by the ladder and drawn on exactly one screen — the pro's own. `partner.photo` is a separate field, published deliberately. Grep confirms no public view reads `selfie`. This is what makes the Privacy page's "never their verification photograph" true; **if the two fields are ever merged again, that sentence becomes a lie.** |
| **Test runs cannot eat a real device's pictures** | `core/photos.js` → `useShelf()` | The in-app suite runs against real storage. A suite calling `gc()` used to delete every real picture on the device. The shelf is now swappable and the tests keep their own. |
| **Fresh start**: the owner types FRESH, re-enters the password (step-up), a snapshot is taken first, the wipe is audited with counts | `domain/fresh.js`, Admin → System & audit | A wipe cannot be a slip of the finger or a quiet one. The credential and the dials survive it, so the device is still the owner's afterwards. Same caveat as everything else here: the operator's own DevTools can clear storage without any of it. |
| **Treasury actions** — Withdraw fees (`PLATFORM:fee → WORLD:bank`) and Remit GST (`PLATFORM:gst → WORLD:tax`): step-up re-auth, never more than earned / held, audited (`treasury.withdraw`, `treasury.remitGst`) | `domain/treasury.js`, Admin → Finance | The two actions that move the company's own money need the password again, and the ledger refuses an amount the books do not support. Every figure on the treasury screen is a replay of the ledger, so it cannot disagree with the books it is read from. |
| **Vouches: one per person, per pro, ever.** Only a customer who has had a job with that pro settle, or a Background-Checked pro in the same trade; never yourself; never while suspended | `domain/autoverify.js` → `canVouch()` | Stops one account from vouching a friend up to tier 3 alone. What it does **not** stop is a ring of accounts — see §7. |
| **Auto-promotion** to tier 3 / 4 is audited as actor `auto` with every line of evidence (`have/need`); the owner's kill switch (`autoApprove`) and dials are validated and pushed like the Charges | `domain/autoverify.js`, `domain/settings.js` | A promotion is reconstructible, and switching the whole thing off is one toggle. |

---

## 2. The Content Security Policy

Set in `index.html` as a `<meta http-equiv>`:

```
default-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self';
script-src 'self' https://checkout.razorpay.com;
img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.razorpay.com;
media-src blob:;
connect-src 'self' https://nominatim.openstreetmap.org https://api.razorpay.com
            https://lumberjack.razorpay.com https://*.functions.supabase.co https://*.supabase.co;
worker-src 'self'; manifest-src 'self';
frame-src https://api.razorpay.com https://checkout.razorpay.com;
object-src 'none'; base-uri 'none'; form-action 'none';
upgrade-insecure-requests
```

**No `'unsafe-inline'` and no `'unsafe-eval'` in `script-src` is the
load-bearing line.** Leaflet is vendored under `/vendor/leaflet` precisely so it
can stay closed — no CDN, and a tradesperson's phone does not depend on a third
party's uptime. There is no `eval` and no `new Function` anywhere in `src/`.

Five consequences worth knowing:

1. **Inline `onclick=` handlers do not run.** Any markup that relies on one is
   dead code that fails silently.
2. **`style-src` still needs `'unsafe-inline'`**, because every view uses
   `style=""` attributes. This is the policy's honest weak point: CSS-injection
   based data exfiltration is not blocked by it, and `esc()` is an HTML-context
   escape that does not make a CSS context safe. Treat any user string that
   reaches a `style` attribute as unprotected.
3. **`frame-ancestors` and HSTS are ignored inside a `<meta>` tag.** They are
   real headers or they are nothing — see §5.
4. **`script-src` is no longer only `'self'`.** `checkout.razorpay.com` is
   allowed so `ui/checkout.js` can load Razorpay Checkout, and
   `lumberjack.razorpay.com` is allowed in `connect-src` because that script
   posts its own usage telemetry there. **That is the one third-party script
   the product will ever run**, it runs only on the payment screen, and in
   `MODE 'sim'` it is never fetched at all. The Privacy page states exactly
   this; do not widen the allowance without changing that page in the same
   commit.
5. **`style-src` still names `https://fonts.googleapis.com` while `font-src` is
   `'self'`.** Archivo is vendored under `/vendor/fonts` and no Google Fonts
   stylesheet is linked, so no font server sees a visit — the Privacy page says
   so and it is true. The stale `style-src` entry is a leftover: harmless, but
   it should be dropped so the policy cannot be read as permission.

`<meta name="referrer" content="strict-origin-when-cross-origin">` is set so no
path, query string or order id leaks to OpenStreetMap in a `Referer`.

### What actually leaves the device

With no Supabase configured (`core/config.js` `BAKED` is empty, so `hasSupabase()`
is false on a stock build) the app makes exactly three kinds of outbound request,
and every one of them is to OpenStreetMap:

| Call | What is sent | Where |
|---|---|---|
| Tile load | the tile's z/x/y — i.e. **which piece of the map is on screen**, and when | `ui/map.js` `mapInto()` |
| `geocode(q)` | **the text the person typed**, verbatim, URL-encoded | `ui/map.js` |
| `reverse(lat,lng)` | **the device's own position to six decimal places** (~10 cm), taken from `locate()` | `ui/map.js` |

The third is the sharp one and is easy to under-describe. `locate()` calls
`navigator.geolocation.getCurrentPosition({enableHighAccuracy:true})` and
`reverse()` posts those coordinates to a third party to get a place name back.
That is a precise real-time position, not an area, and it happens on a single
tap labelled "use my location". The Privacy page says so in those terms, and
names the two alternatives that send nothing (type the place; tap an area).

`<meta name="referrer" content="strict-origin-when-cross-origin">` keeps the
path, the query string and any order id out of the `Referer` on all three.
Nominatim is called at most once per user action and never per keystroke, with a
1.1 s floor between calls (`polite()`), as its usage policy asks.

Everything else — accounts, orders, the ledger, chat, pictures — stays in this
browser until a Supabase URL and anon key are configured. Say that on screen
wherever it matters; the legal pages carry a `#legalLocalBanner` that appears
whenever `hasSupabase()` is false, on the same principle as the sandbox banner.

---

## 3. XSS findings — the five that were open, and what is open now

The escaping discipline in the views is good: names, chat, review text, product
names, addresses, dispute reasons, audit details and geocoder labels are all
routed through `esc()`, and the shared helpers `header()`, `pill()`, `avatar()`,
`emptyBlock()`, `smartChip()`, `secHead()` and `money()` escape their own
arguments.

### Closed since the 7 September audit — verified in the code, not assumed

1. **`ui/map.js` `bindPopup`** now escapes at the sink: `m.bindPopup(esc(o.label))`.
   That closes the stored-XSS path through Nominatim labels — text any
   OpenStreetMap contributor can edit — for every caller at once, including the
   `area` persisted at sign-up.
2. **`pinIcon()`** whitelists the colour against the `PINS` palette (with a
   legacy map) and escapes the glyph before either reaches the `divIcon` HTML.
3. **`app.js` boot-error message** is escaped inline (`app.js:702`), on a path
   where `esc()` may not have loaded.
4. **The boot-recovery button** no longer uses an inline `onclick=`; there is no
   `onclick` attribute anywhere in `src/`.
5. **`--tile-accent`** is gone from `views/home.js`, so no user-reachable value
   is interpolated into a CSS custom property there.

### Open

1. **Double-escaping in the admin map (cosmetic, not a vulnerability).**
   `views/admin.js:425, 427, 429` build pin labels with `esc()` and hand them to
   `map.js` `pin()`, which now escapes them again at the sink. A shop called
   `Ram & Co` renders in the popup as `Ram &amp;amp; Co`. The fix prescribed
   when `bindPopup` was hardened — drop the caller's pre-escaping — was never
   applied. Remove the `esc()` calls in those three lines; the sink covers them.
2. **`views/admin.js:386 `legendDot(c, label)`** interpolates `c` raw into a
   `style` attribute. Every caller passes a module constant (`PIN_ORDER`,
   `PIN_PARTNER`, `PIN_SHOP`), so it is hygiene rather than a live bug — the
   same class as the `--tile-accent` finding that was just closed. Whitelist it
   (`/^#[0-9a-f]{3,8}$/i`) so it cannot regress.
3. **The off-platform chat scan is trivially evaded.** `domain/flow.js:768,777`
   flags and masks on `\d{10}`, an e-mail pattern, and the UPI handle
   suffixes. `98765 43210`, `98765-43210` and `nine eight seven…` match none of
   them, so the message is neither masked, flagged, nor audited as
   `fraud.offplatform`. `core/security.js` already has `normaliseMobile()`,
   which collapses exactly those spellings — the flag test should normalise the
   message the same way before matching. **Until it does, do not describe the
   scan as protection**: it deters a careless share, it does not stop a
   determined one. The legal pages state the rule ("never share a phone number
   or UPI id in chat") rather than promising the mask works, which is the
   correct posture.

### Helpers whose slots are raw markup by contract

Anything passed into these must already be escaped by the caller. Treat this as
the list to check on every new call site:

| Helper | Raw slots |
|---|---|
| `ui/dom.js` · `sheet(title, bodyHtml)` | `bodyHtml` (title is escaped) |
| `views/admin.js` · `capsule(k, v, d, tone)` | `v` |
| `views/admin.js` · `cmd({title, sub, right, facts, actions})` | all five |
| `views/partner.js` · `capsule(k, v, d, tone)` | all three |
| `views/account.js` · `card(title, eyebrow, body, opts)` | `body`, `opts.right` |
| `views/partner.js` · `line(k, v)` (in `shopSetup`) | both |
| `views/legal.js` · `sec(title, body)`, `p(html)`, `ul(items)` | `body`, `html`, each item |

### Clean

No `eval`, no `new Function`, no `document.write`, no `javascript:` href, no
`onclick=`, no `target="_blank"` anywhere in `src/`. Every `innerHTML` write
outside `ui/dom.js` is either a static string or already `esc()`-wrapped. Every
interpolated HTML **attribute** in the views carries a number, a generated id,
or a fixed enum — none carry raw user text.

---

## 4. What Supabase enforces — the boundary that is actually real

`supabase/migrations/0002_money_rls.sql` is the file that matters. Its own
opening comment states the rule correctly:

> The anon key ships inside a public bundle, so anything `authenticated` may
> INSERT or UPDATE is effectively a public API.

Accordingly:

- **25 tables have RLS enabled**; `ledger_entries`, `ledger_txns`,
  `escrow_holds`, `account_balances` and `otp_codes` additionally carry
  `FORCE ROW LEVEL SECURITY`, so not even the table owner bypasses it.
- **Every money table has INSERT/UPDATE/DELETE revoked with no write policy at
  all.** The browser literally cannot write a ledger row.
- The only mutators are **`SECURITY DEFINER` functions** with
  `set search_path=public,pg_temp` (so a hostile schema on the caller's path
  cannot hijack them). Each one re-checks the caller (`auth.uid()`), the role
  (`app.is_admin()`, `app.my_partner_id()`, `app.is_order_party()`), the order
  state machine, and the arithmetic — **in SQL, where the browser cannot reach**.
- Ledger balance is a **database trigger**: `app.assert_txn_balanced()` raises
  at commit if a transaction's legs do not sum to zero. Not a convention — a
  constraint.
- Writes are **idempotent by key** (`rpc_calls(idempotency_key, fn_name,
  caller_id)`), so a retried tap cannot double-pay.
- The door code is checked server-side, with a rate limit per user and
  a "this code is not yours to see" guard (`42501`) on read.
- Automation (`0003_automation.sql`) calls the **same** `SECURITY DEFINER`
  functions inside one transaction — cron gets no privileged side door.

**The gap:** none of this protects the app while `backendMode()` resolves to
local. Local mode is a demo. Say so out loud on any screen where it is running.

---

## 5. Secrets — what ships and what must never

**Ships, by design:**
- the Supabase project **URL**;
- the Supabase **anon key**. It is public by construction, authorises nothing on
  its own, and RLS decides what it can see.

**Must never appear in this repo, in any commit, message, screenshot or doc:**
- the **`service_role` key** — it bypasses *all* RLS; it is a master key;
- the database password;
- any personal access token;
- the admin password in plaintext.

They live in GitHub Actions secrets and the Supabase dashboard, nowhere else.
`core/config.js` says this at the top of the file so nobody has to find this
document first. **If one ever lands in a commit, rotate it immediately** —
git history is public and deleting the commit does not unpublish the key.

`core/selftests.security.js` asserts that `ADMIN_BOOTSTRAP` carries no
plaintext-secret field and no JWT-shaped string, so a paste accident fails CI
rather than shipping.

---

## 6. The owner's credential

The admin username is **`siidhartha12`**. There is no shipped password and no
default anyone could look up: `ADMIN_BOOTSTRAP` in `src/core/config.js` carries
a **PBKDF2-SHA256 hash** (250,000 rounds over a 16-byte random salt) plus a
`version`. Login re-derives and compares; the password itself lives only in the
owner's password manager.

- **Change it on one device:** Admin → System & audit → change admin password.
  Immediate; that device then ignores later bootstraps.
- **Change what a fresh device starts with:**
  `node tools/admin-cred.mjs '<new password>'`, paste the printed
  `{salt, hash, iterations}` into `ADMIN_BOOTSTRAP`, bump `version`, push.

The self-tests verify the shipped hash is 64 hex characters over a 32-hex salt,
that `iterations >= 250000`, that `bootstrapCredential().isDemo` is false, and
— the one that actually matters — that **deriving the retired demo password
`saahaa123` does not reproduce the shipped hash**. If someone ever pastes a demo
credential back in, CI goes red.

---

## 7. What is NOT true, however it looks

| What it looks like | What it actually is |
|---|---|
| The admin password hash ships in the bundle | Extractable, brute-forceable offline. PBKDF2 raises the cost per guess; it does not stop the attack. |
| The auth check is a JavaScript `if` | Anyone with DevTools sets `isLoggedIn = true`. |
| Balances, escrow and the ledger live in localStorage | **Fully user-editable.** Any user can grant themselves ₹1,00,000 in ten seconds. |
| Rate-limit and lockout counters live in localStorage | Erased by one `localStorage.clear()`. |
| Release timers use `Date.now()` | A device clock rolled back can trigger an early auto-release. |
| OTPs are generated and checked in the browser (local mode) | Present in JS memory. Real OTPs must be server-generated, SMS-delivered from a DLT-registered sender, validated server-side — which is exactly what the Supabase path already does. |
| The hash chain is verified by the same client that writes it | An attacker recomputes the whole chain in about a minute. Tamper-evidence needs a signature the client cannot forge. |
| Names, mobiles and areas sit in localStorage | Under the DPDP Act 2023 there is no consent record, no erasure path and no breach-notification route in local mode. |
| Names, mobiles, **exact coordinates** and pictures sit in localStorage | Sign-up stores `loc: {lat, lng}` to six decimal places for every user, partner and shop. It is the same store any user with DevTools can read and edit. |
| The Privacy page's "you can ask for your account to be removed" | Honest, but manual. **Nothing in the product deletes one person's account.** `domain/state.js:50` has a `user/remove` reducer that nothing dispatches; `views/admin.js` can suspend a *partner* only. The only real erasure is the owner's Fresh start (the whole device) and a viewer clearing their own browser storage. The Privacy page now says exactly that instead of implying a button exists. |
| The owner's access is fully audited | `core/audit.js` records **actions**, not reads. Browsing the admin console — every account, order, chat and ledger row on the device — leaves no entry. The Privacy page says "looking is not logged; only doing is". |
| A pro or shop sees a customer's details "only while the job is open" | It was never true. `views/partner.js:224, 309, 1067, 1078, 1130` keep the customer's name and area on the pro's settled-jobs list, the shop's payout lists and a derived repeat-customer roster, indefinitely. The behaviour is defensible — it is an invoice book — so the page was corrected to describe it rather than the code changed to hide it. |
| Photos are "kept on the person's own device" forever | They are kept until something reclaims them: `flow.sweepPhotos()` → `photos.gc(referenced(state))` drops anything unreferenced, and `fresh.js` calls `photos.gc([])` on both a demo purge and a Fresh start. A picture whose row is deleted does not linger. |
| The CSP protects the app | It removes whole classes of attack, and it cannot protect a user from their own DevTools. It is defence in depth, not a boundary. |
| Vouches, ratings and settled jobs are evidence | In local mode they are rows in localStorage; a user can write themselves three settled jobs and two vouches in DevTools. In Supabase mode the same rules must be `SECURITY DEFINER` RPCs (settled-job check, one-vouch uniqueness, same-trade tier check) or they are decoration. A ring of real accounts can also vouch each other up; the owner's suspend and kill switch are the answer, not the code. |
| The door code proves the pro was there | It proves somebody who knows the customer's SAAHAA code typed it. **This is a real trade-off made in 8.4.0 and it should not be discovered later.** The code is permanent, so a pro who has worked for that customer once knows it for good and could, in principle, type it without standing at her gate again. The four random digits it replaced did not have that property. It was accepted because the alternative was an SMS rail the product will never have, and because the code has never been the thing that releases money: the photo evidence and the customer's own confirm still gate every payout, three wrong entries flag the job, and the stake is forfeit on an upheld dispute. If this ever needs closing, the answer is a per-job code the CUSTOMER can regenerate on her own screen — not a texted one. |
| The reference "confirmed by code" | The code is the pro's own SAAHAA code, which they pass to their reference; nothing is sent, by design. It proves the pro typed a code they already knew, not that a reference read it to them — the same limit the four random digits had. `bgReference` can be turned off and `bgVouches` raised instead. |
| The gateway is a payment rail | `core/gateway.js` in `MODE 'sim'` moves no money at all. A `collect()` is a receipt the app wrote to itself; it is labelled sandbox everywhere precisely so nobody mistakes it for a payment. |
| The treasury's *Reconciles* line proves the money is there | It proves the ledger sums to the identity it was built to sum to. Against a bank balance it proves nothing until the settlement webhook posts the legs (`docs/PRODUCTION.md` §3). |

---

## 8. What to configure outside the code

### Cloudflare Pages (or whatever serves the origin) — a `_headers` file

Four of these **cannot** be set from `index.html` and must be real response
headers:

```
/*
  Content-Security-Policy: frame-ancestors 'none'
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(self), microphone=(), payment=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
```

Notes: `frame-ancestors` in a header supersedes `X-Frame-Options`, but send
both — old browsers only understand the latter. `geolocation=(self)` and
`camera=(self)` must stay allowed: "use my location" and the finished-work photo
depend on them. Do **not** add `Cross-Origin-Embedder-Policy` without testing —
it will break the OpenStreetMap tiles.

Also enable, in the dashboard: Always Use HTTPS, Automatic HTTPS Rewrites, and
Bot Fight Mode. Serve `index.html` with a short `Cache-Control` and the hashed
assets with a long one, so a security fix is not stuck behind a stale cache.

### GitHub

- Branch protection on `main`: required CI, no force-push, no direct push.
- **Secret scanning + push protection ON.** This is the cheapest real control
  available and it catches the `service_role` paste before it exists.
- Dependabot on — even with zero runtime dependencies, the Actions are pinned code.
- Actions: `permissions: contents: read` by default; never
  `pull_request_target` on an untrusted fork.
- Supabase keys in Actions secrets, never in the workflow file.

### Supabase

- `service_role` key never leaves the dashboard.
- Confirm every new table gets `enable row level security` **in the same
  migration that creates it** — `tools/lint-migrations.py` exists for this.
- Point-in-time recovery on before the first real rupee.
- Auth: rate limits on, email/OTP templates reviewed, JWT expiry short.

---

## 9. Test data is not shipped data

Production boots with an empty store: no accounts but the owner's credential, no
pros, no shops, no products. The example roster exists only behind `?demo=1`
(and `?shot=`, the deck capture), which also switches the market simulation on
for that one page load. Nothing seeds a real device, so there is no shipped
account with a known password to find.

Since 7.0 the guard runs the other way too: `domain/fresh.js` inspects the
store at every boot, and a state carrying demo-origin records (the
`origin: 'demo'` mark, or the example mobile ranges `90/91/92 000000xx`) on a
boot **without** `?demo=1` is replaced by a fresh one — credential and dials
kept, audited as `data.demoPurged` with counts. The owner's own wipe, Fresh
start, is the same operation on demand, behind FRESH + step-up, snapshot
first, audited as `data.freshStart`.

---

## 10. India-specific, before you go live

- You will be collecting money on behalf of third parties. That means an
  **escrow/nodal account** and a PA-PG-licensed partner (Razorpay Route,
  Cashfree Easy Split, PhonePe). RBI's Payment Aggregator rules forbid holding
  customer funds in an ordinary current account.
- **GST registration is mandatory for an e-commerce operator regardless of
  turnover** (CGST §24(ix)). Collect **TCS at 1%** on net taxable supplies
  (§52) and file GSTR-8. **TDS §194-O** at 1% applies to partner payouts above
  the threshold.
- GST on your commission is **18% of the commission**, not 2% of the deal.
  The bill reads `Service ₹1,000 + Platform fee ₹84.75 + GST@18% ₹15.25 =
  ₹1,100.00`. Same customer total, invoice-correct.
- Payouts need beneficiary verification (penny-drop) before the first transfer.
- Aadhaar: store **only** the masked last four plus a hash. A full Aadhaar
  number stored client-side is a legal landmine (Aadhaar Act §29).
- Food shops must display FSSAI; pharmacies must hold a drug licence before any
  Rx SKU is listed; meat shops must declare halal/jhatka. All three are modelled
  as shop fields and surfaced on the shop card.
- DPDP Act 2023: you need a consent record, an erasure path and a breach-
  notification route. None of the three can exist in local mode.

---

## 11. Checklist before real money

Nothing on this list is optional, and the order is the order.

**Architecture**
- [ ] `backendMode()` forced to `cloud` in production; local mode is labelled a demo on screen.
- [ ] Supabase Auth replaces the client `sha256(password)` user login entirely.
- [ ] Every write path goes through a `SECURITY DEFINER` RPC. No table takes a direct write from the browser.
- [ ] `service_role` key confirmed absent from the repo *and* from git history.

**The open code findings in §3** (the five from the 7 September audit are closed)
- [ ] `admin.js:425, 427, 429` pre-escaping removed — the `map.js` sink now escapes, so these double-escape.
- [ ] `admin.js:386` `legendDot()` colour whitelisted as a CSS context.
- [ ] `flow.js` chat flag normalises the message (`normaliseMobile()`) before matching, so `98765 43210` is caught.

**Privacy, and the sentences that depend on the code**
- [ ] `partner.selfie` and `partner.photo` stay separate fields. Merging them makes the Privacy page false.
- [ ] An erasure path exists for one account, not just the whole device — DPDP, and the Contact page's 30-day promise.
- [ ] Any new host in the CSP is reflected on the Privacy page in the same commit.

**Headers and platform**
- [ ] `_headers` deployed with `frame-ancestors`, HSTS, `nosniff`, `Permissions-Policy`.
- [ ] GitHub secret scanning + push protection on; branch protection on `main`.
- [ ] Supabase PITR on.

**Money**
- [ ] Nodal/escrow account live with a PA-PG-licensed partner.
- [ ] GST registration, TCS §52 and TDS §194-O wired into payouts.
- [ ] Penny-drop beneficiary verification before the first transfer.
- [ ] `core/gateway.js` switched off `MODE 'sim'`; ledger legs for money in and out posted from webhooks, never from the browser.
- [ ] The vouch rules (settled job, same-trade tier, one per person) and the auto-promotion sweep re-implemented as `SECURITY DEFINER` RPCs.
- [ ] The ledger hash chain anchored outside the browser (see below).

**Process**
- [ ] `node tools/test-node.mjs` green in CI, including the security suite.
- [ ] A written incident path: who is called, what is rotated, who tells users.
- [ ] DPDP: consent record, erasure path, breach notification.

---

## 12. The cheapest real improvement available today

Export a signed daily snapshot (`{seq, headHash, ts}`) to a file kept outside
the browser, and verify the current chain head against it at boot. An attacker
can rewrite localStorage; they cannot rewrite the copy on your Drive. That is
the shortest path from "integrity theatre" to something genuinely useful — and
it needs no backend at all.

---

## 13. Reporting a vulnerability

Open a private security advisory on the GitHub repository, or mail the owner
directly. Do not open a public issue. There is no bounty; there is a fast reply
and public credit if you want it.
