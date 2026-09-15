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

# `pg_isready` IS NOT A READY SIGNAL FOR THIS IMAGE, AND THAT COST THREE CI
# RUNS. The official postgres image runs initdb against a TEMPORARY server, then
# shuts it down and starts the real one. pg_isready answers yes to that
# temporary server, so the very next psql could land in the restart and come
# back "the database system is starting up" or with the connection dropped —
# which this script then reported as "supabase/schema.sql does not do what it
# says". The schema was never the problem. It is intermittent by nature: it
# depends on how fast the box is, which is why the same commit passed CI and
# failed deploy an hour apart.
#
# A real query is the only honest test of "can I use this database", and it has
# to succeed TWICE with a gap, because one success can still be the temporary
# server moments before it goes away.
ready=0; streak=0
for i in $(seq 1 90); do
  if docker exec "$NAME" psql -U postgres -d saahaa -tAc 'select 1' >/dev/null 2>&1; then
    streak=$((streak + 1))
    if [ "$streak" -ge 2 ]; then ready=1; break; fi
  else
    streak=0
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "  schema: SKIPPED — Postgres never became usable in 90s, not a schema fault"
  exit 0
fi

# quiet the "already exists, skipping" chorus; errors still stop the run
psql() { { echo "set client_min_messages to warning;"; cat; } | docker exec -i "$NAME" psql -U postgres -d saahaa -v ON_ERROR_STOP=1 -q "$@"; }

# A GATE THAT FAILS WITHOUT SAYING WHY COSTS A WHOLE ROUND. This printed one
# line — "x schema.sql does not apply" — and threw away the only thing that
# could say what Postgres actually objected to. On a CI runner, whose logs are
# not readable without signing in, that left an annotation naming the file and
# nothing else; the failure was reproduced by guesswork instead of read. Every
# path below now surfaces the database's own words, as a ::error:: annotation
# so it survives on a runner where the log does not.
say_fail() {   # say_fail <headline> <output>
  echo "  x $1"
  echo "$2" | grep -E "^(ERROR|FAILED|psql|DETAIL|HINT|CONTEXT|LINE)" | head -20 | sed 's/^/      /'
  echo "::error::schema-test: $1 — $(echo "$2" | grep -E '^(ERROR|FAILED)' | head -1 | cut -c1-300)"
}

echo "  schema: applying supabase/schema.sql to a real Postgres"
OUT=$(psql < supabase/test-auth-stub.sql 2>&1) || { say_fail "the auth stub failed" "$OUT"; exit 1; }
OUT=$(psql < supabase/schema.sql 2>&1)         || { say_fail "schema.sql does not apply" "$OUT"; exit 1; }

# The header says "Run once. Idempotent." That is a claim, so check it.
OUT=$(psql < supabase/schema.sql 2>&1) || { say_fail "schema.sql is NOT idempotent — a second run failed" "$OUT"; exit 1; }
echo "  ok  schema.sql applies, and applies twice"

OUT=$(psql < supabase/schema.test.sql 2>&1)
echo "$OUT" | grep -E "^(NOTICE|psql|ERROR)" | sed -e 's/^NOTICE:  /  /' -e 's/^/  /' | sed 's/^    /  /'
if echo "$OUT" | grep -q "FAILED:"; then
  say_fail "the database does not behave the way schema.sql claims" "$OUT"; exit 1
fi
if echo "$OUT" | grep -qE "^(ERROR|psql:)"; then
  say_fail "the behaviour test errored before it could finish" "$OUT"; exit 1
fi
echo "  schema: every claim in schema.sql now holds against a real database"
