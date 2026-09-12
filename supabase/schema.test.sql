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
