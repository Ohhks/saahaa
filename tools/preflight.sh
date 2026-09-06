#!/usr/bin/env bash
# SAAHAA pre-flight. Runs after build, before anything is published.
# If this exits non-zero, nothing reaches GitHub Pages.
set -euo pipefail
fail() { echo "::error::PREFLIGHT FAIL — $1"; exit 1; }
ok()   { echo "  ok   $1"; }

echo "=== SAAHAA PRE-FLIGHT ==="

[ -f dist/saahaa.html ] || fail "dist/saahaa.html was not produced"
SIZE=$(wc -c < dist/saahaa.html)
[ "$SIZE" -ge 10240 ]   || fail "bundle is only ${SIZE} bytes — the build truncated"
[ "$SIZE" -le 5242880 ] || fail "bundle is ${SIZE} bytes (>5MB) — move images to Supabase Storage"
ok "bundle present, ${SIZE} bytes"

head -c 512 dist/saahaa.html | grep -qi '<!doctype html' || fail "bundle is not an HTML document"
grep -qi 'SAAHAA' dist/saahaa.html || fail "bundle is missing the app marker"
ok "bundle is really the app"

grep -qE '<script[^>]+src="(\./|src/)' dist/saahaa.html && fail "local JS was not inlined" || true
grep -qE '<link[^>]+href="(\./|src/)[^"]*\.css"' dist/saahaa.html && fail "local CSS was not inlined" || true
ok "everything inlined"

# THE ONE THAT MATTERS: never ship a key that bypasses Row Level Security.
if grep -nEi 'service_role|sbp_[A-Za-z0-9]{20,}|postgres(ql)?://[^ "]*:[^ "]*@|BEGIN [A-Z ]*PRIVATE KEY' dist/saahaa.html; then
  fail "FORBIDDEN SECRET PATTERN IN THE BUNDLE"
fi
ok "no forbidden secrets"

# Decode any shipped JWT and read its role claim. This catches the realistic
# mistake: pasting the wrong eyJ... key from the dashboard, where the anon and
# service_role keys look identical at a glance.
for JWT in $(grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}' dist/saahaa.html | sort -u); do
  P=$(echo "$JWT" | cut -d. -f2); PAD=$(( (4 - ${#P} % 4) % 4 ))
  for _ in $(seq $PAD); do P="${P}="; done
  D=$(echo "$P" | tr '_-' '/+' | base64 -d 2>/dev/null || echo '')
  echo "$D" | grep -q '"role" *: *"service_role"' && fail "SHIPPED KEY IS service_role — CATASTROPHIC"
  echo "  jwt role: $(echo "$D" | grep -oE '"role" *: *"[a-z_]+"' || echo unreadable)"
done
ok "only a public anon key is shipped, if any"

grep -nE 'TODO_BEFORE_LAUNCH|FIXME_CRITICAL|localhost:8772|127\.0\.0\.1' dist/saahaa.html \
  && fail "bundle contains local dev references" || true
ok "no dev leftovers"

[ -f dist/404.html ]  || fail "dist/404.html missing — deep links would 404 on refresh"
[ -f dist/.nojekyll ] || fail "dist/.nojekyll missing — Jekyll would eat underscore paths"
cmp -s dist/saahaa.html dist/404.html || fail "404.html must be identical to the app"
ok "SPA deep links will survive a hard refresh"

# THE ONE A BROWSER HAS TO SEE: the built bundle boots and paints as an app, not as text.
python tools/smoke-dist.py; SM=$?
[ $SM -eq 1 ] && fail "the built bundle does not render as an app (tools/smoke-dist.py)"
[ $SM -eq 2 ] && echo "  warn: no browser here - CI proves the bundle renders"
[ $SM -eq 0 ] && ok "the built bundle boots and paints in a real browser"
python tools/check-version.py    || fail "version / CHANGELOG mismatch"
python tools/lint-migrations.py  || fail "migration lint failed"
node   tools/test-node.mjs       || fail "domain tests failed at the gate"

echo "=== PRE-FLIGHT PASSED — safe to publish ==="
