#!/usr/bin/env bash
# SAAHAA · tools/schema-test.sh — run supabase/schema.sql against a real Postgres.
#
# Until this existed, schema.sql had never been executed. It was written,
# reviewed, committed and documented on the strength of reading it. The UTR
# unique index, the append-only trigger and every RLS policy were assertions
# about a database, made without one.
#
# Needs docker. Skips (exit 0) without it, so preflight still runs on a machine
# that has none — a gate nobody can run is a gate nobody keeps.
set -u
NAME=saahaa-pgtest
IMG=postgres:16-alpine

if ! docker version >/dev/null 2>&1; then
  echo "  schema: SKIPPED — docker is not running (start Docker Desktop to prove the schema)"
  exit 0
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# A GATE MUST FAIL FOR THE THING IT IS ABOUT, AND NOTHING ELSE. This exited 1
# when the container would not start, so a Docker Hub rate-limit on a CI runner
# read as "supabase/schema.sql does not do what it says" and took the deploy
# down with it. Not being able to ASK the question is not the same as getting
# the wrong answer: infrastructure trouble skips, loudly; a schema that
# misbehaves still fails hard, below.
if ! docker run -d --name "$NAME" -e POSTGRES_PASSWORD=saahaa -e POSTGRES_DB=saahaa "$IMG" >/dev/null 2>&1; then
  echo "  schema: SKIPPED — could not start $IMG (image pull or daemon), not a schema fault"
  exit 0
fi

ready=0
for i in $(seq 1 90); do
  if docker exec "$NAME" pg_isready -U postgres -d saahaa >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "  schema: SKIPPED — Postgres never became ready in 90s, not a schema fault"
  exit 0
fi

# quiet the "already exists, skipping" chorus; errors still stop the run
psql() { { echo "set client_min_messages to warning;"; cat; } | docker exec -i "$NAME" psql -U postgres -d saahaa -v ON_ERROR_STOP=1 -q "$@"; }

echo "  schema: applying supabase/schema.sql to a real Postgres"
psql < supabase/test-auth-stub.sql >/dev/null || { echo "  x auth stub failed"; exit 1; }
psql < supabase/schema.sql > /dev/null || { echo "  x schema.sql does not apply"; exit 1; }

# The header says "Run once. Idempotent." That is a claim, so check it.
psql < supabase/schema.sql > /dev/null || { echo "  x schema.sql is NOT idempotent — a second run failed"; exit 1; }
echo "  ok  schema.sql applies, and applies twice"

OUT=$(psql < supabase/schema.test.sql 2>&1)
echo "$OUT" | grep -E "^(NOTICE|psql|ERROR)" | sed -e 's/^NOTICE:  /  /' -e 's/^/  /' | sed 's/^    /  /'
if echo "$OUT" | grep -q "FAILED:"; then
  echo "  x schema behaviour test failed"; exit 1
fi
if echo "$OUT" | grep -qE "^(ERROR|psql:)"; then
  echo "  x schema test errored"; exit 1
fi
echo "  schema: every claim in schema.sql now holds against a real database"
