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

-- ── orders: the minimum the server must know to settle one ───
create table if not exists orders (
  id            text primary key check (length(id) <= 32),
  kind          text not null check (kind in ('service','retail')),
  customer_code text not null,
  partner_code  text,
  shop_id       text,
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

create or replace function my_code() returns text as $$
  select code from profiles where id = auth.uid()
$$ language sql stable security definer;

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles
  for select using (id = auth.uid());

drop policy if exists orders_mine on orders;
create policy orders_mine on orders
  for select using (customer_code = my_code() or partner_code = my_code());

drop policy if exists payments_mine on payments;
create policy payments_mine on payments
  for select using (exists (
    select 1 from orders o where o.id = payments.order_id
      and (o.customer_code = my_code() or o.partner_code = my_code())));

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
      and (o.customer_code = my_code() or o.partner_code = my_code())));

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
