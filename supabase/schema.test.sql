-- SAAHAA · supabase/schema.test.sql — what the database must actually do.
--
-- Everything here was written, reviewed and shipped without ever being run.
-- "The RLS policies, the UTR unique index and the append-only trigger are
-- unproven" sat in three handovers. This runs them.
--
-- Run via: bash tools/schema-test.sh   (needs docker)

-- ── people, a shop, and two orders ───────────────────────────
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444');

insert into profiles (id, code, role, name) values
  ('11111111-1111-1111-1111-111111111111', 'C20262001', 'customer', 'Asha'),
  ('22222222-2222-2222-2222-222222222222', 'S20262001', 'shop',     'Ravi'),
  ('33333333-3333-3333-3333-333333333333', 'P20262001', 'partner',  'Amit'),
  ('44444444-4444-4444-4444-444444444444', 'C20262002', 'customer', 'Meena');

insert into shops (id, owner_code, name, area)
  values ('shop1', 'S20262001', 'Ravi Kirana', 'Kukatpally');

insert into orders (id, kind, customer_code, shop_id, customer_pays, stage)
  values ('r1', 'retail', 'C20262001', 'shop1', 148464, 'R_PLACED');
insert into orders (id, kind, customer_code, partner_code, customer_pays, stage)
  values ('s1', 'service', 'C20262001', 'P20262001', 56200, 'ACCEPTED');
insert into orders (id, kind, customer_code, customer_pays, stage)
  values ('x1', 'service', 'C20262002', 9900, 'ACCEPTED');

-- ── 1 · one UTR, one live claim ──────────────────────────────
insert into payments (order_id, utr, reference, expected)
  values ('r1', '123456789012', 'SAR1', 148464);

do $$ begin
  begin
    insert into payments (order_id, utr, reference, expected)
      values ('s1', '123456789012', 'SAS1', 56200);
    raise exception 'FAILED: the same UTR was claimed against two orders';
  exception when unique_violation then
    raise notice 'ok  one UTR cannot be claimed twice';
  end;
end $$;

-- a rejected claim releases the number, so an honest typo can be corrected
update payments set state = 'REJECTED' where utr = '123456789012';
insert into payments (order_id, utr, reference, expected)
  values ('s1', '123456789012', 'SAS1', 56200);
do $$ begin
  assert (select count(*) from payments where utr = '123456789012') = 2,
    'FAILED: rejecting a claim did not release its UTR';
  raise notice 'ok  a rejected claim releases its UTR';
end $$;

-- ── 2 · a bad UTR or code cannot be stored at all ────────────
do $$ begin
  begin
    insert into payments (order_id, utr, reference, expected)
      values ('s1', '12345', 'SAS2', 100);
    raise exception 'FAILED: a 5-digit UTR was accepted';
  exception when check_violation then raise notice 'ok  a UTR must be 12 digits'; end;
  begin
    insert into profiles (id, code, role, name)
      values ('11111111-1111-1111-1111-111111111111', 'Z1', 'customer', 'Nobody');
    raise exception 'FAILED: a malformed code was accepted';
  exception when check_violation or unique_violation then
    raise notice 'ok  a code must look like C/P/S + 8 digits'; end;
end $$;

-- ── 3 · the ledger is append-only, and says so in the engine ─
insert into ledger (kind, paise, from_acct, to_acct, order_id, prev_hash, hash)
  values ('ESCROW_IN', 56200, 'CUSTOMER:C20262001', 'ESCROW:s1', 's1', 'GENESIS', 'h1');

do $$ begin
  begin
    update ledger set paise = 1 where hash = 'h1';
    raise exception 'FAILED: a ledger row was updated';
  exception when others then
    if sqlerrm like 'FAILED:%' then raise; end if;
    raise notice 'ok  a ledger row cannot be updated';
  end;
  begin
    delete from ledger where hash = 'h1';
    raise exception 'FAILED: a ledger row was deleted';
  exception when others then
    if sqlerrm like 'FAILED:%' then raise; end if;
    raise notice 'ok  a ledger row cannot be deleted';
  end;
  begin
    insert into ledger (kind, paise, from_acct, to_acct, prev_hash, hash)
      values ('ESCROW_IN', 0, 'a', 'b', 'h1', 'h2');
    raise exception 'FAILED: a zero-paise leg was accepted';
  exception when check_violation then
    raise notice 'ok  a leg worth nothing is not a leg';
  end;
end $$;

-- ── 4 · row level security, as each person ───────────────────
-- A superuser bypasses RLS, so every check below runs as a plain role.
create role app_user nologin;
grant usage on schema public to app_user;
grant select on all tables in schema public to app_user;

begin;
  set local role app_user;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';   -- Asha, customer
  do $$ begin
    assert exists (select 1 from orders where id = 'r1'), 'FAILED: a customer cannot see her own retail order';
    assert exists (select 1 from orders where id = 's1'), 'FAILED: a customer cannot see her own service order';
    assert not exists (select 1 from orders where id = 'x1'),
      'FAILED: a customer can read another customer''s order';
    raise notice 'ok  a customer sees her own orders and nobody else''s';
  end $$;
rollback;

begin;
  set local role app_user;
  set local "test.uid" = '33333333-3333-3333-3333-333333333333';   -- Amit, the pro
  do $$ begin
    assert exists (select 1 from orders where id = 's1'), 'FAILED: a pro cannot see the job he accepted';
    assert not exists (select 1 from orders where id = 'r1'),
      'FAILED: a pro can read a retail order that has nothing to do with him';
    raise notice 'ok  a pro sees his own jobs only';
  end $$;
rollback;

-- THE ONE THIS FILE WAS WRITTEN FOR. orders.shop_id was a dangling text column
-- with no shops table behind it, so this returned zero rows: a shopkeeper could
-- not see her own order, or the payment claimed against it. Half the product.
begin;
  set local role app_user;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';   -- Ravi, the shop
  do $$ begin
    assert exists (select 1 from orders where id = 'r1'),
      'FAILED: a shopkeeper cannot see an order placed at her own shop';
    assert exists (select 1 from payments p join orders o on o.id = p.order_id where o.shop_id = 'shop1'),
      'FAILED: a shopkeeper cannot see the payment claimed against her own order';
    assert not exists (select 1 from orders where id = 'x1'),
      'FAILED: a shopkeeper can read an unrelated order';
    raise notice 'ok  a shopkeeper sees her own shop''s orders and their claims';
  end $$;
rollback;

-- ── 5 · nobody signed in reads anything ──────────────────────
begin;
  set local role app_user;
  set local "test.uid" = '';
  do $$ begin
    assert (select count(*) from orders) = 0,   'FAILED: orders are readable signed out';
    assert (select count(*) from payments) = 0, 'FAILED: payments are readable signed out';
    assert (select count(*) from ledger) = 0,   'FAILED: the ledger is readable signed out';
    assert (select count(*) from payouts) = 0,  'FAILED: payouts are readable signed out';
    raise notice 'ok  signed out is default deny, on every table';
  end $$;
rollback;

-- ── 6 · a customer may claim, and may never clear ────────────
begin;
  set local role app_user;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  do $$ begin
    begin
      update payments set state = 'CLEARED' where order_id = 's1';
      if found then raise exception 'FAILED: a customer cleared her own payment'; end if;
      raise notice 'ok  a customer cannot clear her own payment';
    exception when insufficient_privilege then
      raise notice 'ok  a customer cannot clear her own payment';
    end;
  end $$;
rollback;

-- ── 7 · the keep-alive the weekly cron calls ─────────────────
do $$ begin
  assert (select beat()) is not null, 'FAILED: beat() did not return a timestamp';
  raise notice 'ok  beat() answers, so the free project stays awake';
end $$;

-- ── 8 · the server names the account, and never twice ────────
-- The bug this replaces: nextCode() counted the accounts on ONE DEVICE, so two
-- phones signing up at the same moment both produced C20262001.
do $$
declare a text; b text; c text; y int := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
begin
  a := alloc_code('customer');
  b := alloc_code('customer');
  c := alloc_code('partner');
  assert a <> b, 'FAILED: alloc_code handed out the same customer code twice';
  assert a = 'C' || y || '2001', format('FAILED: first customer code was %s', a);
  assert b = 'C' || y || '2002', format('FAILED: second customer code was %s', b);
  assert c = 'P' || y || '2001', format('FAILED: partner sequence is not its own, got %s', c);
  assert a ~ '^[CPS][0-9]{8}$', 'FAILED: alloc_code does not match the code format profiles enforces';
  raise notice 'ok  the server names accounts, one sequence per role, never twice';
end $$;

-- A thousand of them, because "unique" is a claim about collisions and three
-- calls cannot see one.
do $$
declare seen int; last text;
begin
  -- Collect every code a thousand calls produce and count the DISTINCT ones.
  -- Counting the counter would only prove the counter moved; counting the
  -- codes proves no two callers were handed the same name.
  create temp table alloc_probe (code text) on commit drop;
  insert into alloc_probe select alloc_code('shop') from generate_series(1, 1000);
  select count(distinct code) into seen from alloc_probe;
  assert seen = 1000, format('FAILED: 1000 allocations produced only %s distinct codes', seen);
  select max(code) into last from alloc_probe;
  assert last = 'S' || extract(year from (now() at time zone 'Asia/Kolkata'))::int || '3000',
    format('FAILED: the thousandth shop code was %s', last);
  raise notice 'ok  a thousand allocations produced a thousand different codes';
end $$;

-- ── 9 · an account no longer needs a Supabase Auth user ──────
do $$ begin
  insert into profiles (code, role, name, mobile, pass_hash, pass_salt)
    values ('C20269901', 'customer', 'Server Named', '9888800001', 'deadbeef', 'cafe');
  assert (select count(*) from profiles where code = 'C20269901') = 1,
    'FAILED: a profile could not be created without an auth.users row';
  raise notice 'ok  the Worker owns identity — no auth.users row required';
end $$;

-- ── 10 · one number, one account of a kind, ACROSS devices ───
do $$ begin
  begin
    insert into profiles (code, role, name, mobile, pass_hash, pass_salt)
      values ('C20269902', 'customer', 'Same Number', '9888800001', 'deadbeef', 'cafe');
    raise exception 'FAILED: the same number opened two customer accounts';
  exception when unique_violation then
    raise notice 'ok  one number holds one account per role, enforced by the database';
  end;
  -- the same number MAY hold a different kind of account
  insert into profiles (code, role, name, mobile, pass_hash, pass_salt)
    values ('P20269901', 'partner', 'Same Number', '9888800001', 'deadbeef', 'cafe');
  raise notice 'ok  and the same number may still hold a pro account beside it';
end $$;

-- ── 11 · the credential is never selectable by a signed-out caller ──
begin;
  set local role app_user;
  set local "test.uid" = '';
  do $$ begin
    assert (select count(*) from profiles) = 0, 'FAILED: profiles are readable signed out';
    raise notice 'ok  nobody signed out can read an account, let alone its salt';
  end $$;
rollback;

-- ── 12 · the credential is checked in the database ───────────
-- This moved here because a Cloudflare Worker on the free plan gets 10ms of
-- CPU and PBKDF2 at 250,000 rounds needs roughly ten times that: every signup
-- returned 1101. bcrypt in Postgres costs the Worker nothing.
do $$
declare made json; opened json; acct text;   -- not `code`: it shadows the column
begin
  made := create_account('customer', 'Asha Verified', '9777700001', 'Kukatpally', 'Kukatpally-7731');
  acct := made->>'code';
  assert acct ~ '^C[0-9]{8}$', format('FAILED: create_account named the account %s', acct);
  assert made::text not like '%pass_hash%', 'FAILED: create_account returned the credential';
  assert made::text not like '%Kukatpally-7731%', 'FAILED: create_account echoed the password back';

  -- what is actually stored is a bcrypt hash, not the password
  assert (select p.pass_hash from profiles p where p.code = acct) <> 'Kukatpally-7731',
    'FAILED: the password was stored as itself';
  assert (select p.pass_hash from profiles p where p.code = acct) like '$2%',
    'FAILED: the stored credential is not a bcrypt hash';

  opened := verify_account(acct, 'Kukatpally-7731');
  assert json_array_length(opened) = 1, 'FAILED: the right password did not open the account';
  assert opened::text not like '%pass_hash%', 'FAILED: verify_account returned the credential';
  raise notice 'ok  the database hashes the password and the hash never comes back out';

  assert json_array_length(verify_account(acct, 'wrong-password')) = 0,
    'FAILED: a wrong password opened the account';
  assert json_array_length(verify_account('C20269998', 'Kukatpally-7731')) = 0,
    'FAILED: an account that does not exist opened';
  raise notice 'ok  a wrong password and a missing account both open nothing';

  -- one number, two kinds, and the password picks which
  perform create_account('partner', 'Asha Verified', '9777700001', 'Kukatpally', 'Plumber-8821');
  assert json_array_length(verify_account('9777700001', 'Plumber-8821')) = 1,
    'FAILED: signing in by number did not find the pro account';
  assert verify_account('9777700001', 'Plumber-8821')->0->>'role' = 'partner',
    'FAILED: the wrong one of the two accounts was opened';
  raise notice 'ok  one number, two accounts, and the password decides which opens';
end $$;

-- ── 13 · the owner's roster credential ───────────────────────
do $$ begin
  assert verify_owner('anything') = false,
    'FAILED: the roster was open before an owner password was ever set';
  raise notice 'ok  with no owner password set, nobody is the owner';

  perform set_owner_password('the-owner-password');
  assert verify_owner('the-owner-password') = true, 'FAILED: the owner password does not verify';
  assert verify_owner('not-it') = false, 'FAILED: a wrong owner password verified';
  assert (select value from platform_secrets where key = 'owner_password') like '$2%',
    'FAILED: the owner password is not stored as a bcrypt hash';
  raise notice 'ok  the owner is checked the same way everybody else is';
end $$;
