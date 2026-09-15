#!/usr/bin/env bash
# SAAHAA · tools/deploy.sh — the whole free-tier deployment, in one command.
#
# WHY A SCRIPT AND NOT A CHECKLIST. docs/DEPLOY.md was seven manual steps across
# two dashboards, and a manual step that is done once is a step that is done
# differently the second time. Everything here is idempotent: the schema applies
# twice, `wrangler deploy` replaces, secrets overwrite. Run it as often as you
# like — that is what makes it safe to run when something is already broken.
#
# EVERY SERVICE IT TOUCHES IS ON A FREE PLAN, and nothing here can move you off
# one: no paid Cloudflare bindings, no Supabase add-ons, no npm dependency that
# needs a build minute it does not have. docs/FREE-TIER.md is the accounting.
#
# CREDENTIALS COME FROM .env.deploy, WHICH IS GITIGNORED AND STAYS ON YOUR
# MACHINE. The service-role key and the hook secret never reach the repo, never
# reach the browser, and never reach a log line here — they are piped, not
# echoed. Copy .env.deploy.example and fill it in.
#
#   bash tools/deploy.sh            # database, worker, pages, then verify
#   bash tools/deploy.sh --db       # just the schema
#   bash tools/deploy.sh --worker   # just the Worker + its secrets
#   bash tools/deploy.sh --pages    # just the site
#   bash tools/deploy.sh --check    # verify what is live, change nothing
#   bash tools/deploy.sh --creds    # check the credentials only, change nothing
#   bash tools/deploy.sh --auto     # no secrets anywhere: sign both CLIs in
#                                   # with `npx wrangler login` and
#                                   # `npx supabase login`, then run this
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENVF="$ROOT/.env.deploy"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
die()  { red "  x $*"; exit 1; }

# THE OPTION IS CHECKED BEFORE THE CREDENTIALS ARE. A typo in the flag used to
# be reported as "no .env.deploy", which sends you to fix the one thing that was
# not wrong.
MODE="${1:-all}"
case "$MODE" in
  --db|--worker|--pages|--check|--creds|--auto|all|"") ;;
  *) die "unknown option: $MODE  (--db | --worker | --pages | --check | --creds | --auto)" ;;
esac

# --auto reads everything from the signed-in CLIs, so it needs no file at all.
if [ ! -f "$ENVF" ]; then
  [ "$MODE" = "--auto" ] || die "no .env.deploy — copy .env.deploy.example and fill it in"
  ENVF=/dev/null
fi
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

need() { [ -n "${!1:-}" ] || die "$1 is not set in .env.deploy"; }

# CLOUDFLARE IS AUTHORISED TWO WAYS AND ONLY ONE OF THEM IS A VARIABLE. An
# OAuth grant from `wrangler login` lives in wrangler's own config, so demanding
# CLOUDFLARE_API_TOKEN stopped a deploy that was already signed in.
need_cloudflare() {
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && return 0
  npx --yes wrangler whoami 2>&1 | grep -qi 'not authenticated'     && die "Cloudflare: set CLOUDFLARE_API_TOKEN in .env.deploy, or run npx wrangler login"
  return 0
}

WORKER_NAME="$(sed -n 's/^name *= *"\(.*\)"/\1/p' worker/wrangler.toml)"
PAGES_PROJECT="${PAGES_PROJECT:-saahaa}"

# ── the no-secrets path ───────────────────────────────────────
# WHY THIS EXISTS. Everything else here wants six values pasted into a file,
# and the two that matter are a master key and a database password. Both CLIs
# can authorise themselves in a browser instead — the owner clicks Allow, the
# credential is stored by the tool that minted it, and nothing secret is ever
# typed, pasted, or written down. The project's own keys are then READ from
# Supabase rather than copied by hand, which also removes the one mistake
# `--creds` exists to catch: they cannot be swapped if nobody transcribes them.
#
#   npx wrangler login          (once, in a browser)
#   npx supabase login          (once, in a browser)
#   bash tools/deploy.sh --auto
auto() {
  step "signed-in CLIs"
  # `wrangler whoami` EXITS 0 WHILE SIGNED OUT — it reports the fact on stdout
  # and calls that a successful report. Checking its status therefore said
  # "Cloudflare is signed in" over "You are not authenticated", so read what it
  # actually said.
  local who
  who=$(npx --yes wrangler whoami 2>&1)
  if printf '%s' "$who" | grep -qi 'not authenticated'; then
    die "Cloudflare is not signed in — run: npx wrangler login"
  fi
  # The email, not the first thing matching "Account Name" — that matched the
  # header of the accounts TABLE and printed a row of box-drawing characters.
  grn "  ok  Cloudflare is signed in as $(printf '%s' "$who" | grep -oiE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | head -1)"

  local projects ref
  # TWO WAYS IN, AND NEITHER IS A PASSWORD. `supabase login` stores a browser
  # grant; SUPABASE_ACCESS_TOKEN is a personal access token that the CLI reads
  # straight from the environment — and .env.deploy is sourced with `set -a`,
  # so putting it there is enough. Both are revocable from the dashboard, which
  # an account password is not.
  projects=$(npx --yes supabase@latest projects list --output json 2>/dev/null) || {
    red "  x   Supabase is not signed in. Either:"
    echo "        npx supabase login                       (browser, click Allow)"
    echo "      or put a personal access token in $ENVF:"
    echo "        SUPABASE_ACCESS_TOKEN=sbp_...            (supabase.com/dashboard/account/tokens)"
    die "no Supabase credential"
  }

  # Pick the project by name, and refuse to guess when it is ambiguous: this
  # writes secrets and applies a schema, so choosing the wrong project is not
  # a thing to be clever about.
  ref=$(printf '%s' "$projects" | python -c "
import json,sys
try: rows = json.load(sys.stdin)
except Exception: rows = []
want = [r for r in rows if 'saahaa' in str(r.get('name','')).lower()]
pool = want or rows
if len(pool) == 1: print(pool[0]['id'])
elif not pool: print('NONE')
else: print('MANY:' + ','.join(f\"{r.get('name')}={r['id']}\" for r in pool))
")
  case "$ref" in
    NONE) die "no Supabase project on that account — create one (Free, Mumbai) and re-run" ;;
    MANY:*) red "  more than one project, and none obviously SAAHAA:"
            printf '        %s
' "${ref#MANY:}"
            die "set SUPABASE_PROJECT_REF in $ENVF and re-run" ;;
  esac
  [ -n "${SUPABASE_PROJECT_REF:-}" ] && ref="$SUPABASE_PROJECT_REF"
  grn "  ok  Supabase project $ref"

  local keys anon svc
  keys=$(npx --yes supabase@latest projects api-keys --project-ref "$ref" --reveal --output json 2>/dev/null)     || die "could not read the project's API keys"
  anon=$(printf '%s' "$keys" | python -c "
import json,sys
rows=json.load(sys.stdin)
print(next((r['api_key'] for r in rows if r.get('name')=='anon'), ''))")
  svc=$(printf '%s' "$keys" | python -c "
import json,sys
rows=json.load(sys.stdin)
print(next((r['api_key'] for r in rows if r.get('name')=='service_role'), ''))")
  [ -n "$anon" ] && [ -n "$svc" ] || die "the project did not return both an anon and a service_role key"

  export SUPABASE_URL="https://$ref.supabase.co"
  export SUPABASE_ANON_KEY="$anon"
  export SUPABASE_SERVICE_KEY="$svc"
  grn "  ok  read the anon and service keys from Supabase — nothing was transcribed"

  check_creds

  # The schema needs the database password, which is the one thing no API will
  # hand over. If it was not supplied, say exactly what to do instead rather
  # than failing the whole deploy over a step that takes fifteen seconds by
  # hand — the rest of the deployment does not depend on it having run yet.
  if [ -n "${SUPABASE_DB_URL:-}" ]; then
    deploy_db
  else
    echo "  ·   no SUPABASE_DB_URL — open the Supabase SQL editor, paste"
    echo "      supabase/schema.sql and press Run. It is idempotent."
  fi

  # The anon key is public and belongs in the build; bake it so the shipped
  # bundle knows its own project.
  python tools/setup-supabase.py --url "$SUPABASE_URL" --anon "$SUPABASE_ANON_KEY"     || die "could not bake the anon key into the build"

  # The owner console reads the platform roster through the Worker, and the
  # Worker asks Postgres whether the password it was given is the owner's.
  # That hash has to be planted once. Optional on purpose: without it the
  # roster refuses everybody, which is the safe way to be unconfigured.
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    if npx --yes supabase@latest db query --linked --project-ref "$ref" "select set_owner_password('$(printf %s "$ADMIN_PASSWORD" | sed "s/'/''/g")');" >/dev/null 2>&1; then
      grn "  ok  the owner console can read the roster"
    else
      red "  x   could not set the owner password — the roster will refuse the console"
    fi
  else
    echo "  .   no ADMIN_PASSWORD in .env.deploy — the console roster will answer"
    echo "      \"admins only\" until you add your console password there and re-run"
  fi

  deploy_worker
  deploy_pages
  check
}

# ── are the credentials the ones they are labelled as? ────────
# CHECKED BEFORE ANYTHING IS CHANGED, because the realistic mistakes here are
# silent ones: the anon and service keys are the same shape and swapping them
# publishes a master key, and a Cloudflare token minted with the wrong template
# fails only at the upload, after the schema is already applied. A deploy that
# stops with everything untouched is recoverable; a half-finished one is a
# puzzle.
jwt_role() {   # jwt_role <key> — the role claim, or empty if unreadable
  printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'     | { read -r P; L=$(( ${#P} % 4 )); [ $L -ne 0 ] && P="$P$(printf '=%.0s' $(seq $((4-L)))) "; printf '%s' "$P"; }     | base64 -d 2>/dev/null | grep -oE '"role" *: *"[a-z_]+"' | grep -oE '[a-z_]+"$' | tr -d '"'
}

check_creds() {
  step "credentials"
  local bad=0

  # A CHECK THAT PASSES ON AN EMPTY FILE IS NOT A CHECK. Every test below is
  # guarded on the value being present, so with nothing filled in they all
  # skipped and it printed "every credential is what it says it is" over a
  # blank .env.deploy. Say what is missing first.
  # WHAT IS REQUIRED DEPENDS ON HOW WE GOT HERE. --auto signs in through the
  # CLIs themselves: Cloudflare is an OAuth grant, not an API token, and the
  # database password is optional because the schema can be pasted into the SQL
  # editor. Demanding the file's full set in that mode failed a deploy that had
  # everything it actually needed.
  local required="CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY SUPABASE_DB_URL"
  [ "$MODE" = "--auto" ] && required="SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY"

  local missing=""
  for v in $required; do
    [ -n "${!v:-}" ] || missing="$missing $v"
  done
  if [ -n "$missing" ]; then
    red "  x   not filled in yet:"
    for v in $missing; do echo "        $v"; done
    die "fill these in $ENVF — see the PASTE ME lines"
  fi

  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    local v
    v=$(curl -s --max-time 20 https://api.cloudflare.com/client/v4/user/tokens/verify           -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
    if printf '%s' "$v" | grep -q '"success":true'; then
      grn "  ok  the Cloudflare token is valid and active"
    else
      red "  x   Cloudflare rejected the token: $(printf '%s' "$v" | grep -oE '"message":"[^"]*"' | head -1)"
      bad=1
    fi
    if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
      local a
      a=$(curl -s --max-time 20 "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"             -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
      printf '%s' "$a" | grep -q '"success":true'         && grn "  ok  the token can see account $CLOUDFLARE_ACCOUNT_ID"         || { red "  x   the token cannot see that account — check it has Memberships·Read"; bad=1; }
    fi
  fi

  # THE ONE THAT WOULD BE CATASTROPHIC IS THE KEYS THE WRONG WAY ROUND. The
  # anon key is baked into the browser build; the service key bypasses every
  # RLS policy in the schema. They are both "eyJ..." and both about the same
  # length, and the only thing that tells them apart is a claim inside.
  if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
    case "$(jwt_role "$SUPABASE_ANON_KEY")" in
      anon) grn "  ok  SUPABASE_ANON_KEY really carries role anon" ;;
      service_role) red "  x   SUPABASE_ANON_KEY IS THE SERVICE KEY — it would be baked into the browser. Swap them."; bad=1 ;;
      *) echo "  ·   could not read a role claim from SUPABASE_ANON_KEY" ;;
    esac
  fi
  if [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
    case "$(jwt_role "$SUPABASE_SERVICE_KEY")" in
      service_role) grn "  ok  SUPABASE_SERVICE_KEY really carries role service_role" ;;
      anon) red "  x   SUPABASE_SERVICE_KEY is the ANON key — the Worker could not clear a payment. Swap them."; bad=1 ;;
      *) echo "  ·   could not read a role claim from SUPABASE_SERVICE_KEY" ;;
    esac
  fi

  # EACH KEY IS CHECKED AGAINST AN ENDPOINT THAT ACCEPTS IT. /rest/v1/ is the
  # PostgREST root and it answers "Only the `service_role` API key can be used
  # for this endpoint" — so testing the anon key there reported a perfectly good
  # key as a 401 and stopped the deploy. GoTrue's /auth/v1/settings is the anon
  # key's endpoint; the REST root is the service key's.
  if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
    local code
    code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}'              "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_ANON_KEY")
    [ "$code" = "200" ] && grn "  ok  the project answers to the anon key"       || { red "  x   $SUPABASE_URL/auth/v1/settings returned HTTP $code"; bad=1; }
  fi
  if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
    local code
    code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$SUPABASE_URL/rest/v1/"              -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
    [ "$code" = "200" ] && grn "  ok  the project answers to the service key"       || { red "  x   $SUPABASE_URL/rest/v1/ returned HTTP $code for the service key"; bad=1; }
  fi

  [ "$bad" = 0 ] || die "fix the credentials above — nothing has been changed"
  grn "  every credential is what it says it is"
}

# ── the database ──────────────────────────────────────────────
# Applied with psql out of a throwaway container, for the same reason
# schema-test.sh uses one: the schema must be executed by a real Postgres
# client, and requiring a local psql install is a step that fails on a laptop.
deploy_db() {
  step "database · supabase/schema.sql"
  need SUPABASE_DB_URL
  docker version >/dev/null 2>&1 || die "docker is not running — it carries psql for this step"

  local run="docker run --rm -i postgres:16-alpine psql"
  # Quiet the "already exists, skipping" chorus a second run produces. Errors
  # still stop the run — ON_ERROR_STOP is what decides that, not the log level.
  local quiet="set client_min_messages to warning;"
  # ON_ERROR_STOP is what makes this a deploy rather than a suggestion.
  if ! { echo "$quiet"; cat supabase/schema.sql; } | $run "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q; then
    die "schema.sql did not apply — nothing after this point is safe, so stopping"
  fi
  grn "  ok  schema applied"

  # It claims to be idempotent and the local gate proves that against a blank
  # database. Proving it against YOUR database is a different question, and the
  # answer matters more: this is the run that would break live data.
  if ! { echo "$quiet"; cat supabase/schema.sql; } | $run "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q; then
    die "schema.sql is not idempotent against this database"
  fi
  grn "  ok  and applies twice — safe to re-run"

  local beat
  beat=$($run "$SUPABASE_DB_URL" -tAc "select beat();" 2>/dev/null | tr -d '\r')
  [ -n "$beat" ] || die "select beat() returned nothing — the schema is not live"
  grn "  ok  select beat() → $beat"
}

# ── the Worker ────────────────────────────────────────────────
deploy_worker() {
  step "worker · $WORKER_NAME"
  need_cloudflare; need SUPABASE_URL; need SUPABASE_SERVICE_KEY
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && export CLOUDFLARE_API_TOKEN
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

  # A HOOK SECRET THAT IS EMPTY IS A WEBHOOK THAT ANYONE CAN FIRE. If one was
  # not supplied we mint it here and write it back, so the value is stable
  # across runs — a secret that changes every deploy silently breaks the
  # Supabase webhook that was configured against the old one.
  if [ -z "${HOOK_SECRET:-}" ]; then
    HOOK_SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    printf '\nHOOK_SECRET=%s\n' "$HOOK_SECRET" >> "$ENVF"
    grn "  ok  minted a HOOK_SECRET and saved it to .env.deploy"
  fi

  # Piped, never argv: a secret on a command line is a secret in the process
  # table and in your shell history.
  # -c HERE TOO, AND THIS ONE WAS NOT COSMETIC. Without it the stray root
  # wrangler.jsonc won the config lookup from inside worker/, and all four
  # secrets — the service-role key among them — were written to the SITE
  # Worker instead of the API one. Nothing was exposed (that Worker is
  # assets-only and secrets are never served to a client), but saahaa-api came
  # up with an empty environment and threw 1101 on its very first request.
  put() { printf '%s' "$2" | (cd worker && npx --yes wrangler secret put "$1" -c wrangler.toml >/dev/null 2>&1) \
            && echo "  ok  secret $1" || die "could not set secret $1"; }
  put SUPABASE_URL          "$SUPABASE_URL"
  put SUPABASE_SERVICE_KEY  "$SUPABASE_SERVICE_KEY"
  put HOOK_SECRET           "$HOOK_SECRET"
  put ADMIN_CODES           "${ADMIN_CODES:-}"

  # THE OWNER'S ROSTER PASSWORD IS NOT A WORKER SECRET. It was, briefly, as a
  # PBKDF2 salt+hash the Worker compared against — until the free plan's 10ms
  # of CPU turned every comparison into a 1101. It is a bcrypt hash in the
  # database now (set_owner_password), so nothing in the Worker can compute,
  # compare or leak it. Seeded below, from .env.deploy, only if given.
  [ -n "${NOTIFY_URL:-}" ] && put NOTIFY_URL "$NOTIFY_URL"

  # -c EXPLICITLY. A stray wrangler.jsonc at the repo root — left by a
  # hand-deploy, and carrying assets.directory "." — was picked up from inside
  # worker/ and tried to upload the whole repository, .git pack files included,
  # as the API Worker's static assets. Naming the config removes the guess.
  (cd worker && npx --yes wrangler deploy -c wrangler.toml) || die "wrangler deploy failed"
  grn "  ok  worker deployed"
}

# ── the site ──────────────────────────────────────────────────
deploy_pages() {
  step "pages · $PAGES_PROJECT"
  need_cloudflare
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && export CLOUDFLARE_API_TOKEN
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

  # THE GATES RUN BEFORE THE UPLOAD, NOT AFTER. A bundle that fails preflight
  # must never reach a phone; deploy.yml already enforces that in CI and this
  # is the same rule for a deploy from a laptop.
  python tools/build.py --site >/dev/null || die "build failed"
  bash tools/preflight.sh > /tmp/saahaa-preflight.log 2>&1 \
    || { tail -30 /tmp/saahaa-preflight.log; die "preflight failed — not publishing"; }
  grn "  ok  preflight passed"

  # NOT `wrangler pages deploy`. Cloudflare Pages is now part of Workers, and a
  # Pages project cannot be created under a name a Worker already holds — which
  # this account does, so that command fails outright. The site ships as a
  # Workers static-assets deployment; wrangler.site.toml carries the two
  # settings that matter, and says why.
  npx --yes wrangler deploy -c wrangler.site.toml || die "site deploy failed"
  grn "  ok  site deployed"
}

# ── verify what is actually live ──────────────────────────────
check() {
  step "verify"
  local w="${WORKER_URL:-}" p="${PAGES_URL:-https://$PAGES_PROJECT.pages.dev}" fail=0

  if [ -n "$w" ]; then
    local body code
    body=$(curl -s --max-time 20 -w '\n%{http_code}' "$w/api/health")
    code=$(printf '%s' "$body" | tail -1)
    if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"ok":true'; then
      grn "  ok  $w/api/health → the Worker can reach Postgres"
    else
      red "  x   $w/api/health → HTTP $code"; fail=1
    fi
  else
    echo "  ·   WORKER_URL not set — skipping the Worker check"
  fi

  # -L, BECAUSE /admin.html LEGITIMATELY 307s TO /admin: Cloudflare's default
  # html_handling drops the extension. Without following that redirect this
  # reported the owner console as broken on every single run.
  for path in / /admin.html /version.json; do
    local code
    code=$(curl -sL -o /dev/null --max-time 25 -w '%{http_code}' "$p$path")
    [ "$code" = "200" ] && grn "  ok  $p$path → 200" || { red "  x   $p$path → $code"; fail=1; }
  done

  # THE LIVE SITE, IN A REAL BROWSER — the same question the bundle answers
  # before it ships. A deployment that returns 200 with a blank screen is
  # still a deployment that returns 200.
  local sm=0
  python tools/smoke-dist.py "$p/" || sm=$?
  [ "$sm" = 1 ] && { red "  x   the live site does not render"; fail=1; }
  [ "$sm" = 0 ] && grn "  ok  the live site boots and paints in a real browser"
  [ "$fail" = 0 ] || die "something live is not answering"
  grn "  everything answered"
}

case "$MODE" in
  --db)     deploy_db ;;
  --worker) deploy_worker ;;
  --pages)  deploy_pages ;;
  --check)  check ;;
  --creds)  check_creds ;;
  --auto)   auto ;;
  all|"")   check_creds; deploy_db; deploy_worker; deploy_pages; check ;;
esac
