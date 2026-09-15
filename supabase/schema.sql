-- SAAHAA · supabase/schema.sql — the server side of the manual UPI rail.
--
-- BUDGET IS A DESIGN CONSTRAINT HERE, NOT AN AFTERTHOUGHT. The free tier gives
-- 500 MB of Postgres and 1 GB of files, so:
--   · no blobs in Postgres, ever. Photos go to git (see docs/STORAGE.md).
--   · money is bigint paise, never numeric/float — smaller and exact.
--   · the ledger is append-only and never UPDATEd, so it stays compact and
--     stays honest at the same time.
--   · text columns are CHECK-constrained to the shortest thing that is true.
--
-- WHAT LIVES HERE vs WHAT LIVES IN THE BROWSER. The browser keeps working
-- exactly as it does today; this is the authority for the things a device must
-- not be trusted with: who paid, how much, and whether anybody has checked.
--
-- Run once in the Supabase SQL editor. Idempotent.

create extension if not exists pgcrypto;

-- ── people ───────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  code        text unique not null check (code ~ '^[CPS][0-9]{8}$'),
  role        text not null check (role in ('customer','partner','shop','admin')),
  name        text not null check (length(name) between 1 and 80),
  mobile      text check (mobile ~ '^[6-9][0-9]{9}$'),
  area        text check (length(area) <= 40),
  created_at  timestamptz not null default now()
);

-- ── accounts are the SERVER's to name ────────────────────────
-- WHY THIS MOVED. domain/identity.js picked the next code by looking at the
-- accounts ON THAT DEVICE: `nextCode(role, getState().users)`. With one device
-- that is correct and cheap. With two it is neither — both phones look at an
-- empty list and both mint C20262001, and the first one to reach a shared
-- database wins while the second person loses the name they were shown. A
-- sequence that must be unique across devices cannot be computed on one.
--
-- So the counter lives here, and `alloc_code` is the only thing allowed to
-- move it. The INSERT ... ON CONFLICT DO UPDATE ... RETURNING takes a row lock
-- for the duration, so two signups landing in the same millisecond are handed
-- 2001 and 2002 rather than 2001 twice. That is the whole reason it is a
-- function and not a SELECT max()+1.
create table if not exists code_counters (
  prefix    char(1) not null check (prefix in ('C','P','S')),
  year      int     not null,
  next_seq  int     not null default 2001,
  primary key (prefix, year)
);

create or replace function alloc_code(p_role text) returns text as $$
declare
  p char(1);
  y int := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
  s int;
begin
  p := case p_role when 'partner' then 'P' when 'shop' then 'S' else 'C' end;
  insert into code_counters (prefix, year, next_seq) values (p, y, 2001)
    on conflict (prefix, year) do update set next_seq = code_counters.next_seq + 1
    returning next_seq into s;
  return p || y::text || lpad(s::text, 4, '0');
end $$ language plpgsql security definer;

-- ── the credential, and who may hold an account ──────────────
-- profiles.id pointed at auth.users, which forced every account through
-- Supabase Auth — a sign-up flow this product does not have and does not want
-- (there is no SMS rail, and GoTrue wants an email or a phone). The Worker
-- holds the service key and is the only writer here, so the row can own its
-- own id. Dropped by lookup rather than by name because the name is generated.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'profiles'::regclass and contype = 'f'
     and pg_get_constraintdef(oid) like '%auth.users%';
  if c is not null then execute format('alter table profiles drop constraint %I', c); end if;
end $$;
alter table profiles alter column id set default gen_random_uuid();

-- THE PASSWORD NEVER TRAVELS BACK. The salt and the hash are stored so the
-- Worker can re-derive and compare; nothing selects them into a response, and
-- the browser is never handed a salt to grind on. 250,000 rounds of
-- PBKDF2-SHA256, the same figure core/security.js uses, so an account made on
-- one device verifies identically on the next.
alter table profiles add column if not exists pass_hash text;
alter table profiles add column if not exists pass_salt text;
alter table profiles add column if not exists pass_iter int not null default 250000;

-- ONE ACCOUNT PER NUMBER PER ROLE, and this is where that is decided now.
-- auth.js checked it against the accounts on the device, which is the same
-- mistake the code sequence made: a number free on this phone may be taken on
-- another. Partial, because a shop row may legitimately carry no mobile.
create unique index if not exists profiles_role_mobile
  on profiles (role, mobile) where mobile is not null;

-- ── the credential lives HERE, and is checked HERE ───────────
-- IT WAS BRIEFLY THE WORKER'S JOB, AND THE FREE TIER SAID NO. The Worker
-- derived PBKDF2-SHA256 at 250,000 rounds to match core/security.js. That is
-- perhaps 100ms of pure CPU, and a Cloudflare Worker on the free plan gets
-- **10ms**: every signup and every sign-in died as exception 1101 — a 500 with
-- no message, on the one path a new customer has to walk. docs/FREE-TIER.md
-- names CPU as the limit most likely to bite, and this is it biting.
--
-- Postgres is the right place anyway. crypt() costs the Worker nothing because
-- the Worker is waiting on I/O rather than computing, bcrypt carries its own
-- salt and cost factor inside the 60-character hash, and the password never
-- exists anywhere but in flight and in this function's arguments.
--
-- pass_salt / pass_iter are left over from the PBKDF2 attempt and are no longer
-- written. They stay because dropping a column is a destructive migration run
-- against live data to tidy something that costs nothing.

-- Opening an account is ONE statement, so the name and the row are allocated
-- together. Two devices racing produce 2001 and 2002; a duplicate number is
-- refused by the partial unique index, not by a SELECT that both can pass.
create or replace function create_account(
  p_role text, p_name text, p_mobile text, p_area text, p_password text
) returns json as $$
declare r profiles; t uuid;
begin
  insert into profiles (code, role, name, mobile, area, pass_hash)
  values (alloc_code(p_role), p_role, p_name,
          nullif(p_mobile, ''), nullif(p_area, ''),
          crypt(p_password, gen_salt('bf', 10)))
  returning * into r;
  -- The device leaves with a token, because the password is not kept and
  -- publishing a listing later cannot ask for it again.
  insert into sessions (code) values (r.code) returning token into t;
  -- NAMED FIELDS, NEVER `select *`. Returning the row would return pass_hash
  -- with it, straight through PostgREST and into a browser.
  return json_build_object('account', json_build_object(
           'code', r.code, 'role', r.role, 'name', r.name,
           'mobile', r.mobile, 'area', r.area, 'createdAt', r.created_at),
         'token', t);
end $$ language plpgsql security definer;

-- Every account the password opens — a number may hold a customer AND a pro,
-- and checking only the first row would tell one of them their password is
-- wrong. The comparison is crypt(given, stored): bcrypt reads its own salt and
-- cost out of the stored hash, so there is nothing to look up first and
-- nothing to hand out.
create or replace function verify_account(p_ident text, p_password text) returns json as $$
declare rec record; t uuid; arr json[] := '{}';
begin
  for rec in
    select * from profiles
     where (code = upper(p_ident) or mobile = p_ident)
       and pass_hash is not null
       and pass_hash = crypt(p_password, pass_hash)
  loop
    insert into sessions (code) values (rec.code) returning token into t;
    arr := array_append(arr, json_build_object(
      'code', rec.code, 'role', rec.role, 'name', rec.name,
      'mobile', rec.mobile, 'area', rec.area,
      'createdAt', rec.created_at, 'token', t));
  end loop;
  return array_to_json(arr);
end $$ language plpgsql security definer;

-- ── a session, so a device can prove it owns an account ──────
-- Publishing a listing cannot ask for the password again — the app has it for
-- one moment during sign-in and deliberately never keeps it. A token minted at
-- that moment is what the device holds afterwards.
create table if not exists sessions (
  token      uuid primary key default gen_random_uuid(),
  code       text not null references profiles(code) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sessions_code_idx on sessions (code);
alter table sessions enable row level security;

-- ── the directory every customer actually reads ──────────────
-- WHY THIS EXISTS, AND WHAT IT COST TO LEARN. Making accounts global was not
-- enough: `profiles` held the plumber, but every screen that LISTS a plumber
-- reads the partner row — `st.partners` — and that was still in the
-- localStorage of the phone he signed up on. So he existed, and no customer
-- could see him. A marketplace whose sellers are invisible to its buyers is
-- not a marketplace.
--
-- The payload is jsonb rather than thirty columns, and that is a deliberate
-- trade. A listing is a rich, changing shape the client already models; making
-- the database own that shape means every new field is a migration, and a
-- mapping layer that silently drops what it has not been taught. What the
-- database DOES own is the part that has to be true regardless: who may write
-- a row (the session), what kind it is, and whether it is visible.
--
-- ONLY WHAT A CUSTOMER MAY SEE GOES IN. The client whitelists the fields it
-- publishes; a mobile number, a credential and the verification internals are
-- not among them.
create table if not exists listings (
  code       text primary key references profiles(code) on delete cascade,
  kind       text not null check (kind in ('partner','shop')),
  area       text check (length(area) <= 40),
  active     boolean not null default true,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists listings_kind_idx on listings (kind, active);
alter table listings enable row level security;

-- A device may only ever write its OWN listing, and only of its own kind: the
-- code comes from the session, never from the request, so a shop cannot
-- publish itself as a pro and nobody can publish as somebody else.
create or replace function publish_listing(
  p_token uuid, p_kind text, p_area text, p_payload jsonb
) returns boolean as $$
declare c text; r text;
begin
  select s.code into c from sessions s where s.token = p_token;
  if c is null then return false; end if;
  select p.role into r from profiles p where p.code = c;
  if r is distinct from p_kind then return false; end if;

  insert into listings (code, kind, area, payload)
  values (c, p_kind, nullif(p_area, ''), p_payload)
  on conflict (code) do update
    set kind = excluded.kind, area = excluded.area,
        payload = excluded.payload, updated_at = now();
  return true;
end $$ language plpgsql security definer;

-- What a fresh device asks for on its first paint.
create or replace function public_listings() returns json as $$
  select coalesce(json_agg(json_build_object(
           'code', code, 'kind', kind, 'area', area, 'payload', payload)
         order by updated_at desc), '[]'::json)
    from listings where active;
$$ language sql security definer;

-- ── the owner's own credential, for the console roster ───────
-- The console asks the Worker for every account on the platform, and the Worker
-- must not hand that list to whoever asks. The owner's password is the proof —
-- the same one they already type — and it is verified the same way, here.
-- RLS is on and there is no policy, so only the service role reaches this table
-- at all; the hash is never selected by anything but the function below.
create table if not exists platform_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table platform_secrets enable row level security;

create or replace function set_owner_password(p_password text) returns void as $$
  insert into platform_secrets (key, value)
  values ('owner_password', crypt(p_password, gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$ language sql security definer;

-- Absent credential = no. A missing row must never read as "anyone may look",
-- which is what `=` against NULL would quietly do inside a looser query.
create or replace function verify_owner(p_password text) returns boolean as $$
  select exists (
    select 1 from platform_secrets
     where key = 'owner_password' and value = crypt(p_password, value));
$$ language sql security definer;

-- ── shops ────────────────────────────────────────────────────
-- orders.shop_id was a dangling text column: the server carried retail orders
-- but had no idea who owned the shop on them, so the RLS below could not let a
-- shopkeeper see her own orders. Half the product was invisible to its own
-- owner. The owner is held as a profile code, not a uuid, because the code is
-- the identity this product actually uses.
create table if not exists shops (
  id            text primary key check (length(id) <= 32),
  owner_code    text not null check (owner_code ~ '^S[0-9]{8}$'),
  name          text not null check (length(name) between 1 and 80),
  area          text check (length(area) <= 40),
  delivery_mode text not null default 'rider'
                check (delivery_mode in ('rider','pickup_only','both')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists shops_owner_idx on shops (owner_code);

-- ── orders: the minimum the server must know to settle one ───
create table if not exists orders (
  id            text primary key check (length(id) <= 32),
  kind          text not null check (kind in ('service','retail')),
  customer_code text not null,
  partner_code  text,
  shop_id       text references shops(id),
  customer_pays bigint not null check (customer_pays > 0),   -- paise
  deal          bigint check (deal >= 0),
  stage         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists orders_customer_idx on orders (customer_code, created_at desc);
create index if not exists orders_partner_idx  on orders (partner_code, created_at desc);

-- ── the rail itself ──────────────────────────────────────────
-- A row is a CLAIM until an admin has read the statement. The unique index on
-- utr is the single most important line in this file: it is what stops one
-- transfer being claimed against two orders.
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      text not null references orders(id) on delete cascade,
  utr           text not null check (utr ~ '^[0-9]{12}$'),
  reference     text not null check (reference ~ '^SA[A-Z0-9]{1,8}$'),
  payee_upi     text not null default 'saahaa@ptyes',
  expected      bigint not null check (expected > 0),        -- paise
  seen          bigint check (seen >= 0),                    -- what the statement showed
  short_by      bigint not null default 0 check (short_by >= 0),
  -- domain/payments.js carries five states; only four can be rows. AWAITING_UTR
  -- is the screen BEFORE a claim exists: there is no UTR yet, and utr is not
  -- null here on purpose. A row in this table always means somebody has typed a
  -- number they are willing to be held to.
  state         text not null default 'CLAIMED'
                check (state in ('CLAIMED','PRO_CHECKED','CLEARED','REJECTED')),
  claimed_by    text,
  claimed_at    timestamptz not null default now(),
  pro_checked_by text,
  pro_checked_at timestamptz,
  cleared_by    text,
  cleared_at    timestamptz,
  reject_reason text check (length(reject_reason) <= 200)
);
-- one live claim per UTR. A rejected one is released so an honest typo can be
-- corrected, which is why this is partial rather than a plain unique column.
create unique index if not exists payments_utr_live
  on payments (utr) where state <> 'REJECTED';
create index if not exists payments_queue_idx on payments (state, claimed_at);

-- ── the ledger: append-only, hash-chained, never updated ─────
create table if not exists ledger (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  kind       text not null,
  paise      bigint not null check (paise > 0),
  from_acct  text not null,
  to_acct    text not null,
  order_id   text,
  meta       jsonb not null default '{}'::jsonb,
  prev_hash  text not null,
  hash       text not null unique
);
create index if not exists ledger_order_idx on ledger (order_id);
create index if not exists ledger_acct_idx  on ledger (from_acct, to_acct);

-- AN APPEND-ONLY TABLE THAT ONLY PROMISES TO BE APPEND-ONLY IS A COMMENT.
create or replace function ledger_is_immutable() returns trigger as $$
begin
  raise exception 'the ledger is append-only: % is not allowed', tg_op;
end $$ language plpgsql;
drop trigger if exists ledger_no_update on ledger;
create trigger ledger_no_update before update or delete on ledger
  for each row execute function ledger_is_immutable();

-- ── payouts: what a pro is owed, and when it left ────────────
create table if not exists payouts (
  id           uuid primary key default gen_random_uuid(),
  partner_code text not null,
  paise        bigint not null check (paise > 0),
  upi          text not null,
  state        text not null default 'DUE' check (state in ('DUE','SENT','FAILED')),
  utr          text check (utr ~ '^[0-9]{12}$'),   -- OUR transfer's reference
  due_on       date not null default (now() at time zone 'Asia/Kolkata')::date,
  sent_at      timestamptz,
  note         text check (length(note) <= 200)
);
create index if not exists payouts_due_idx on payouts (state, due_on);

-- ── row level security ───────────────────────────────────────
-- Default deny. A customer sees their own rows; a partner sees the orders and
-- claims attached to their jobs; only the service role clears money.
alter table profiles enable row level security;
alter table orders   enable row level security;
alter table payments enable row level security;
alter table ledger   enable row level security;
alter table payouts  enable row level security;
alter table shops    enable row level security;

create or replace function my_code() returns text as $$
  select code from profiles where id = auth.uid()
$$ language sql stable security definer;

-- A shopkeeper is identified by the code on her profile, so ownership is one
-- lookup. Marked stable + security definer so the policies below can call it
-- without every row re-reading a table the caller cannot itself see.
create or replace function owns_shop(sid text) returns boolean as $$
  select exists (select 1 from shops s where s.id = sid and s.owner_code = my_code())
$$ language sql stable security definer;

-- Shops are a public listing — a customer has to be able to browse them — but a
-- closed shop is only visible to the person who closed it.
drop policy if exists shops_visible on shops;
create policy shops_visible on shops
  for select using (active or owner_code = my_code());

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles
  for select using (id = auth.uid());

drop policy if exists orders_mine on orders;
create policy orders_mine on orders
  for select using (customer_code = my_code() or partner_code = my_code()
                    or owns_shop(shop_id));

drop policy if exists payments_mine on payments;
create policy payments_mine on payments
  for select using (exists (
    select 1 from orders o where o.id = payments.order_id
      and (o.customer_code = my_code() or o.partner_code = my_code()
           or owns_shop(o.shop_id))));

-- A CUSTOMER MAY CLAIM, AND MAY NEVER CLEAR. Insert is allowed on her own
-- order; every state transition after that belongs to the Worker, which holds
-- the service role key. This is why the key never ships to a browser.
drop policy if exists payments_claim on payments;
create policy payments_claim on payments
  for insert with check (
    state = 'CLAIMED'
    and exists (select 1 from orders o where o.id = order_id and o.customer_code = my_code()));

drop policy if exists ledger_mine on ledger;
create policy ledger_mine on ledger
  for select using (exists (
    select 1 from orders o where o.id = ledger.order_id
      and (o.customer_code = my_code() or o.partner_code = my_code()
           or owns_shop(o.shop_id))));

drop policy if exists payouts_mine on payouts;
create policy payouts_mine on payouts
  for select using (partner_code = my_code());

-- ── the keep-alive target ────────────────────────────────────
-- A free project sleeps after a week of no queries. The CI cron reads this and
-- nothing else: one row, one column, no egress worth counting.
create table if not exists heartbeat (
  id      int primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
insert into heartbeat (id) values (1) on conflict (id) do nothing;

create or replace function beat() returns timestamptz as $$
  update heartbeat set beat_at = now() where id = 1 returning beat_at;
$$ language sql security definer;
