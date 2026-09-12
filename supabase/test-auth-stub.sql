-- SAAHAA · supabase/test-auth-stub.sql — ONLY for the docker test database.
-- Supabase supplies auth.users and auth.uid(); a plain Postgres does not, and
-- schema.sql references both. This stands in for exactly those two things so
-- the rest of the file can be executed for real. It is never run against a
-- Supabase project — the real ones are already there.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- Supabase reads the signed JWT. The test impersonates with a GUC instead, so a
-- test can say "now I am this person" without minting tokens.
create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$ language sql stable;
