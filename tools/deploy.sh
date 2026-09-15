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
  --db|--worker|--pages|--check|--creds|all|"") ;;
  *) die "unknown option: $MODE  (--db | --worker | --pages | --check | --creds)" ;;
esac

[ -f "$ENVF" ] || die "no .env.deploy — copy .env.deploy.example and fill it in"
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

need() { [ -n "${!1:-}" ] || die "$1 is not set in .env.deploy"; }

WORKER_NAME="$(sed -n 's/^name *= *"\(.*\)"/\1/p' worker/wrangler.toml)"
PAGES_PROJECT="${PAGES_PROJECT:-saahaa}"

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
  local missing=""
  for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL            SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY SUPABASE_DB_URL; do
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

  if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
    local code
    code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}'              "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_ANON_KEY")
    [ "$code" = "200" ] && grn "  ok  $SUPABASE_URL answers with that anon key"       || { red "  x   $SUPABASE_URL/rest/v1/ returned HTTP $code"; bad=1; }
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
  need CLOUDFLARE_API_TOKEN; need SUPABASE_URL; need SUPABASE_SERVICE_KEY
  export CLOUDFLARE_API_TOKEN
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
  put() { printf '%s' "$2" | (cd worker && npx --yes wrangler secret put "$1" >/dev/null 2>&1) \
            && echo "  ok  secret $1" || die "could not set secret $1"; }
  put SUPABASE_URL          "$SUPABASE_URL"
  put SUPABASE_SERVICE_KEY  "$SUPABASE_SERVICE_KEY"
  put HOOK_SECRET           "$HOOK_SECRET"
  put ADMIN_CODES           "${ADMIN_CODES:-}"
  [ -n "${NOTIFY_URL:-}" ] && put NOTIFY_URL "$NOTIFY_URL"

  (cd worker && npx --yes wrangler deploy) || die "wrangler deploy failed"
  grn "  ok  worker deployed"
}

# ── the site ──────────────────────────────────────────────────
deploy_pages() {
  step "pages · $PAGES_PROJECT"
  need CLOUDFLARE_API_TOKEN
  export CLOUDFLARE_API_TOKEN
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

  # THE GATES RUN BEFORE THE UPLOAD, NOT AFTER. A bundle that fails preflight
  # must never reach a phone; deploy.yml already enforces that in CI and this
  # is the same rule for a deploy from a laptop.
  python tools/build.py --site >/dev/null || die "build failed"
  bash tools/preflight.sh > /tmp/saahaa-preflight.log 2>&1 \
    || { tail -30 /tmp/saahaa-preflight.log; die "preflight failed — not publishing"; }
  grn "  ok  preflight passed"

  npx --yes wrangler pages deploy dist \
      --project-name "$PAGES_PROJECT" --branch main --commit-dirty=true \
    || die "pages deploy failed"
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

  for path in / /admin.html; do
    local code
    code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$p$path")
    [ "$code" = "200" ] && grn "  ok  $p$path → 200" || { red "  x   $p$path → $code"; fail=1; }
  done
  [ "$fail" = 0 ] || die "something live is not answering"
  grn "  everything answered"
}

case "$MODE" in
  --db)     deploy_db ;;
  --worker) deploy_worker ;;
  --pages)  deploy_pages ;;
  --check)  check ;;
  --creds)  check_creds ;;
  all|"")   check_creds; deploy_db; deploy_worker; deploy_pages; check ;;
esac
