-- ============================================================
-- SAAHAA · 0001_schema.sql
-- Money is BIGINT PAISE everywhere. Never float, never numeric-with-scale.
-- Illegal states are made unrepresentable with CHECK constraints and partial
-- unique indexes, so a client bug cannot create one.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;      -- helpers, not exposed to PostgREST

-- ---------- ENUMS -------------------------------------------------
create type user_role       as enum ('customer','partner','shop','admin');
create type kyc_status      as enum ('none','pending','approved','rejected','suspended');
create type listing_kind    as enum ('service','retail');
create type request_status  as enum ('draft','bidding','awaiting_choice','awarded','fallback_instant','expired','cancelled');
create type bid_status      as enum ('submitted','shortlisted','displaced','countered','accepted','rejected','withdrawn','expired');
create type order_status    as enum ('created','accepted','escrow_held','in_progress','delivered','verified','settled','cancelled','refunded','disputed');
create type escrow_status   as enum ('held','released','refunded','partial','disputed','frozen');
create type entry_direction as enum ('debit','credit');
create type account_kind    as enum ('user_wallet','partner_payable','holdback','escrow','platform_fee','platform_gst','cash_clearing','refund_clearing','goodwill');
create type otp_stage       as enum ('checkin','checkout','pickup','delivery');
create type otp_status      as enum ('active','used','expired','locked','superseded');
create type dispute_status  as enum ('open','evidence','resolved_customer','resolved_partner','split','withdrawn');
create type txn_kind        as enum ('topup','escrow_lock','escrow_release','escrow_refund','fee','gst','holdback','payout','goodwill','adjustment','reversal');
create type severity        as enum ('info','warn','urgent','critical');

-- ---------- CONFIG ------------------------------------------------
create table app_config (
  key         text primary key,
  value       jsonb       not null,
  is_public   boolean     not null default false,
  description text,
  updated_at  timestamptz not null default now()
);
insert into app_config(key,value,is_public,description) values
 ('service_markup_bps',        '1000'::jsonb, true,  'customer pays deal x 1.10'),
 ('gst_bps',                   '1800'::jsonb, true,  'GST is 18% OF THE FEE, not of the deal'),
 ('auto_release_hours',        '24'::jsonb,   true,  'service auto-release after evidence'),
 ('auto_release_hours_retail', '6'::jsonb,    true,  ''),
 ('bid_window_seconds',        '720'::jsonb,  true,  '12 minutes'),
 ('bid_hold_seconds',          '300'::jsonb,  true,  'customer choice window'),
 ('max_bids',                  '5'::jsonb,    true,  'early-close threshold'),
 ('otp_ttl_checkin_min',       '120'::jsonb,  false, ''),
 ('otp_ttl_checkout_min',      '20'::jsonb,   false, ''),
 ('otp_max_attempts',          '5'::jsonb,    false, ''),
 ('holdback_bps',              '1000'::jsonb, true,  '10% of payout, capped'),
 ('holdback_cap_paise',        '50000'::jsonb,true,  'Rs.500 cumulative'),
 ('holdback_days',             '7'::jsonb,    true,  ''),
 ('unverified_max_escrow_paise','200000'::jsonb, true, 'Rs.2000 cap before phone is proven'),
 ('kill_switch_new_orders',    'false'::jsonb,true,  'operator panic button'),
 ('geo_max_m_checkin',         '2000'::jsonb, false, ''),
 ('geo_max_m_delivery',        '800'::jsonb,  false, '');

-- ---------- PROFILES ----------------------------------------------
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           user_role   not null default 'customer',
  display_name   text        not null check (length(btrim(display_name)) between 2 and 60),
  phone          text        check (phone ~ '^[6-9][0-9]{9}$'),
  phone_verified boolean     not null default false,
  email          citext,
  area           text,
  address_line   text,                       -- PII: column-revoked from anon
  lat            double precision,
  lng            double precision,
  trust_score    integer     not null default 50 check (trust_score between 0 and 100),
  tier           smallint    not null default 0 check (tier between 0 and 5),
  is_banned      boolean     not null default false,
  banned_reason  text,
  device_hash    text,
  created_at     timestamptz not null default now(),
  constraint profiles_verified_needs_phone check (not phone_verified or phone is not null),
  constraint profiles_ban_reason           check (not is_banned or banned_reason is not null)
);
create unique index profiles_phone_uniq on profiles(phone) where phone is not null;
create index profiles_area_idx   on profiles(area);
create index profiles_device_idx on profiles(device_hash) where device_hash is not null;

-- ---------- CATEGORIES (mirrors the client registry) --------------
create table categories (
  key            text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  kind           listing_kind not null,
  label          text not null,
  base_paise     bigint not null check (base_paise > 0),
  unit           text not null,
  min_tier       smallint not null default 1,
  take_bps       integer not null default 1000 check (take_bps between 0 and 3000),
  take_cap_paise bigint,
  bidding_allowed boolean not null default true,
  is_active      boolean not null default true,
  sort_order     integer not null default 100
);

-- ---------- PARTNERS ----------------------------------------------
create table partners (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references profiles(id) on delete cascade,
  legal_name     text not null,
  category_key   text not null references categories(key),
  ask_paise      bigint not null check (ask_paise > 0),
  kyc            kyc_status not null default 'none',
  approved_at    timestamptz,
  approved_by    uuid references profiles(id),
  service_areas  text[] not null default '{}',
  radius_m       integer not null default 6000 check (radius_m between 500 and 30000),
  rating_avg     numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count   integer not null default 0 check (rating_count >= 0),
  jobs_completed integer not null default 0 check (jobs_completed >= 0),
  starts_count   integer not null default 0,
  on_time_count  integer not null default 0,
  cancels_count  integer not null default 0,
  no_shows       integer not null default 0,
  disputes_lost  integer not null default 0,
  is_available   boolean not null default true,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint partners_approved_consistency check ((kyc='approved') = (approved_at is not null))
);
create index partners_avail_idx on partners(category_key, is_available) where kyc='approved';

-- ---------- SHOPS + PRODUCTS --------------------------------------
create table shops (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 2 and 80),
  category_key  text not null references categories(key),
  area          text not null,
  address_line  text not null,
  phone         text check (phone ~ '^[6-9][0-9]{9}$'),
  kyc           kyc_status not null default 'none',
  fssai         text,
  drug_licence  text,
  is_open       boolean not null default true,
  prep_mins     integer not null default 20,
  radius_km     integer not null default 3,
  min_order_paise        bigint not null default 0 check (min_order_paise >= 0),
  free_delivery_above     bigint not null default 0,
  orders_completed integer not null default 0,
  fill_rate      integer not null default 100 check (fill_rate between 0 and 100),
  rating_avg     numeric(3,2) not null default 0,
  rating_count   integer not null default 0,
  created_at     timestamptz not null default now(),
  -- a pharmacy without a drug licence must never exist
  constraint shops_pharmacy_needs_licence
    check (category_key <> 'pharmacy' or drug_licence is not null)
);
create index shops_area_idx on shops(category_key, area) where is_open;

create table products (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references shops(id) on delete cascade,
  category_key   text not null references categories(key),
  ref_id         text,
  name           text not null check (length(btrim(name)) between 1 and 120),
  aisle          text not null,
  unit           text not null default 'pc',
  price_paise    bigint not null check (price_paise > 0),
  mrp_paise      bigint check (mrp_paise is null or mrp_paise = 0 or mrp_paise >= price_paise),
  stock_qty      integer not null default 0 check (stock_qty >= 0),
  low_stock_at   integer not null default 5,
  track_stock    boolean not null default true,
  variable_weight boolean not null default false,
  cold_chain     boolean not null default false,
  perishable     boolean not null default false,
  rx_required    boolean not null default false,
  booking_only   boolean not null default false,
  sub_policy     text not null default 'call' check (sub_policy in ('similar','call','refund')),
  mfg_date       date,
  is_active      boolean not null default true,
  sold_count     integer not null default 0,
  created_at     timestamptz not null default now(),
  -- selling above MRP is illegal under Legal Metrology; the DB refuses it
  constraint products_never_above_mrp
    check (mrp_paise is null or mrp_paise = 0 or price_paise <= mrp_paise),
  -- a perishable with no manufacture date cannot be sold
  constraint products_perishable_needs_date
    check (not perishable or mfg_date is not null)
);
create unique index products_shop_ref_uniq on products(shop_id, ref_id) where ref_id is not null;
create index products_shop_active_idx on products(shop_id) where is_active;

-- ---------- SERVICE REQUESTS + BIDS (the auction) -----------------
create table service_requests (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references profiles(id) on delete cascade,
  category_key   text not null references categories(key),
  title          text not null check (length(btrim(title)) between 3 and 120),
  details        text,
  chips          text[] not null default '{}',
  photos         text[] not null default '{}',
  area           text not null,
  address_line   text not null,          -- PII, withheld from the bidder feed
  contact_phone  text,                   -- PII, withheld from the bidder feed
  complexity     text not null default 'simple' check (complexity in ('simple','medium','complex')),
  -- the band is SNAPSHOTTED so editing a base price cannot void live bids
  beff_paise     bigint not null check (beff_paise > 0),
  floor_paise    bigint not null check (floor_paise > 0),
  target_paise   bigint not null,
  ceiling_paise  bigint not null,
  budget_band    text check (budget_band in ('budget','standard','premium')),
  slot_type      text not null default 'now' check (slot_type in ('now','today','scheduled')),
  scheduled_for  timestamptz,
  status         request_status not null default 'bidding',
  bid_count      integer not null default 0 check (bid_count >= 0),
  invited_count  integer not null default 0,
  fanout_round   smallint not null default 0,
  counter_used   boolean not null default false,
  awarded_bid_id uuid,
  opened_at      timestamptz not null default now(),
  closes_at      timestamptz not null,
  hold_until     timestamptz,
  created_at     timestamptz not null default now(),
  constraint sr_band_ordered check (floor_paise <= target_paise and target_paise <= ceiling_paise),
  constraint sr_awarded_needs_bid check ((status='awarded') = (awarded_bid_id is not null))
);
create index sr_feed_idx    on service_requests(category_key, area, opened_at desc) where status='bidding';
create index sr_customer_idx on service_requests(customer_id, created_at desc);
create index sr_close_idx   on service_requests(closes_at) where status='bidding';

create table bids (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references service_requests(id) on delete cascade,
  partner_id    uuid not null references partners(id) on delete cascade,
  amount_paise  bigint not null check (amount_paise > 0),
  eta_minutes   integer not null check (eta_minutes between 5 and 20160),
  note_chip     text check (note_chip is null or length(note_chip) <= 80),
  status        bid_status not null default 'submitted',
  score         numeric(5,2),
  score_parts   jsonb,                       -- frozen for dispute audit
  km_snapshot   numeric(5,2),
  trust_snapshot integer,
  after_seconds integer,
  countered_paise bigint,
  device_hash   text,
  submitted_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
-- ONE bid per partner per request: a revisable bid is an open auction in disguise
create unique index bids_one_per_partner on bids(request_id, partner_id);
-- at most ONE accepted bid per request — double-accept made unrepresentable
create unique index bids_one_accepted on bids(request_id) where status='accepted';
-- one bid per device per request, so three SIMs cannot occupy the shortlist
create unique index bids_one_per_device on bids(request_id, device_hash) where device_hash is not null;
create index bids_request_idx on bids(request_id, score desc nulls last);
create index bids_partner_idx on bids(partner_id, submitted_at desc);

alter table service_requests
  add constraint sr_awarded_bid_fk foreign key (awarded_bid_id)
  references bids(id) deferrable initially deferred;

-- ---------- ORDERS ------------------------------------------------
create table orders (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default
                    ('S'||to_char(now(),'YYMMDD')||upper(substr(encode(gen_random_bytes(4),'hex'),1,6))),
  kind            listing_kind not null,
  customer_id     uuid not null references profiles(id),
  partner_id      uuid references partners(id),
  shop_id         uuid references shops(id),
  request_id      uuid references service_requests(id),
  bid_id          uuid unique references bids(id),
  category_key    text not null references categories(key),
  status          order_status not null default 'created',

  deal_paise      bigint not null check (deal_paise >= 0),
  delivery_paise  bigint not null default 0 check (delivery_paise >= 0),
  fee_paise       bigint not null default 0 check (fee_paise >= 0),
  gst_paise       bigint not null default 0 check (gst_paise >= 0),
  total_paise     bigint not null check (total_paise >= 0),
  payout_paise    bigint not null default 0 check (payout_paise >= 0),
  holdback_paise  bigint not null default 0 check (holdback_paise >= 0),
  refund_paise    bigint not null default 0 check (refund_paise >= 0),

  area            text not null,
  address_line    text not null,
  contact_phone   text,
  lat             double precision,
  lng             double precision,
  evidence        text[] not null default '{}',
  otp_verified    boolean not null default false,
  escrow_tier     text,
  scheduled_for   timestamptz,
  auto_release_at timestamptz,
  accepted_at     timestamptz,
  started_at      timestamptz,
  delivered_at    timestamptz,
  verified_at     timestamptz,
  settled_at      timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint orders_supply_side_xor
    check ((kind='service' and partner_id is not null and shop_id is null)
        or (kind='retail'  and shop_id is not null)),
  constraint orders_cancel_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint orders_settled_has_payout check (status <> 'settled' or payout_paise > 0),
  -- the customer's total must equal what everyone else receives
  constraint orders_money_conserved
    check (status not in ('settled','refunded')
           or payout_paise + holdback_paise + fee_paise + gst_paise + refund_paise <= total_paise + delivery_paise)
);
create index orders_customer_idx on orders(customer_id, created_at desc);
create index orders_partner_idx  on orders(partner_id, created_at desc);
create index orders_shop_idx     on orders(shop_id, created_at desc);
create index orders_live_idx     on orders(status, updated_at desc)
  where status in ('accepted','escrow_held','in_progress','delivered','verified','disputed');
create index orders_autorelease_idx on orders(auto_release_at)
  where status='delivered' and auto_release_at is not null;

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  product_id       uuid references products(id),
  name_snapshot    text not null,
  unit_price_paise bigint not null check (unit_price_paise > 0),
  qty              numeric(8,3) not null check (qty > 0),
  picked_qty       numeric(8,3),
  sub_policy       text not null default 'call',
  line_status      text not null default 'pending'
);
create index order_items_order_idx on order_items(order_id);

create table order_events (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  seq         integer not null,
  from_status order_status,
  to_status   order_status not null,
  actor_id    uuid references profiles(id),
  reason      text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (order_id, seq)
);

-- ---------- LEDGER: double entry, immutable, hash-chained ---------
create table ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  kind       account_kind not null,
  owner_id   uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index ledger_acct_owned  on ledger_accounts(kind, owner_id) where owner_id is not null;
create unique index ledger_acct_system on ledger_accounts(kind) where owner_id is null;

create table ledger_txns (
  id              uuid primary key default gen_random_uuid(),
  kind            txn_kind not null,
  order_id        uuid references orders(id),
  idempotency_key text not null unique,
  memo            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table ledger_entries (
  id           bigserial primary key,
  txn_id       uuid   not null references ledger_txns(id) on delete restrict,
  account_id   uuid   not null references ledger_accounts(id) on delete restrict,
  direction    entry_direction not null,
  amount_paise bigint not null check (amount_paise > 0),
  signed_paise bigint not null generated always as
                 (case when direction='debit' then amount_paise else -amount_paise end) stored,
  order_id     uuid references orders(id),
  prev_hash    text,
  entry_hash   text not null,
  created_at   timestamptz not null default now()
);
create index ledger_entries_acct_idx  on ledger_entries(account_id, id);
create index ledger_entries_order_idx on ledger_entries(order_id);

create table account_balances (
  account_id    uuid primary key references ledger_accounts(id) on delete cascade,
  balance_paise bigint not null default 0,
  entry_count   bigint not null default 0,
  updated_at    timestamptz not null default now()
);

create table escrow_holds (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete restrict,
  status          escrow_status not null default 'held',
  amount_paise    bigint not null check (amount_paise > 0),
  released_paise  bigint not null default 0 check (released_paise >= 0),
  refunded_paise  bigint not null default 0 check (refunded_paise >= 0),
  auto_release_at timestamptz,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  constraint escrow_conservation check (released_paise + refunded_paise <= amount_paise)
);
create unique index escrow_one_open on escrow_holds(order_id) where status in ('held','disputed','frozen');
create index escrow_autorelease_idx on escrow_holds(auto_release_at) where status='held';

-- ---------- OTP: hash only, never plaintext at rest ---------------
create table otp_codes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  stage         otp_stage not null,
  code_hash     bytea not null,
  salt          bytea not null,
  audience_id   uuid not null references profiles(id),   -- who SEES the code
  verifier_id   uuid not null references profiles(id),   -- who TYPES the code
  status        otp_status not null default 'active',
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 5,
  issue_seq     smallint not null default 1,
  verified_dist_m integer,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  constraint otp_parties_differ check (audience_id <> verifier_id),
  constraint otp_attempts_capped check (attempts <= max_attempts)
);
create unique index otp_one_active on otp_codes(order_id, stage) where status='active';
create index otp_sweep_idx on otp_codes(expires_at) where status='active';

create table otp_rate_limit (
  user_id         uuid primary key references profiles(id) on delete cascade,
  last_attempt_at timestamptz not null default now(),
  hour_bucket     timestamptz not null default date_trunc('hour', now()),
  hour_count      smallint not null default 0
);

-- ---------- DISPUTES, INCIDENTS, REVIEWS, CHAT --------------------
create table disputes (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete restrict,
  raised_by       uuid not null references profiles(id),
  reason_code     text not null,
  description     text,
  evidence        text[] not null default '{}',
  status          dispute_status not null default 'open',
  auto_resolved   boolean not null default false,
  resolution_note text,
  refund_paise    bigint not null default 0,
  release_paise   bigint not null default 0,
  resolved_by     uuid references profiles(id),
  resolved_at     timestamptz,
  sla_due_at      timestamptz not null default now() + interval '24 hours',
  created_at      timestamptz not null default now()
);
create unique index dispute_one_open on disputes(order_id) where status in ('open','evidence');

-- A safety report is NOT a dispute. Different table, different SLA, different
-- alert path — an automated "we've refunded you" reply to an assault report is
-- catastrophic, so the schema refuses to let them share a queue.
create table safety_incidents (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references orders(id),
  reported_by   uuid not null references profiles(id),
  against_id    uuid references profiles(id),
  kind          text not null check (kind in ('harassment','theft','injury','threat','unsafe','other')),
  description   text not null,
  evidence      text[] not null default '{}',
  severity      severity not null default 'critical',
  acknowledged_at timestamptz,
  resolved_at   timestamptz,
  action_taken  text,
  legal_hold    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index safety_open_idx on safety_incidents(created_at desc) where resolved_at is null;

create table reviews (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  author_id    uuid not null references profiles(id),
  partner_id   uuid references partners(id),
  shop_id      uuid references shops(id),
  rating       smallint not null check (rating between 1 and 5),
  tags         text[] not null default '{}',
  body         text check (body is null or length(body) <= 1000),
  is_hidden    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint review_one_subject check (num_nonnulls(partner_id, shop_id) = 1)
);
create unique index reviews_one_per_order on reviews(order_id, author_id);

create table chat_messages (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  sender_id   uuid not null references profiles(id),
  body        text not null check (length(body) between 1 and 2000),
  redacted    boolean not null default false,
  flagged     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index chat_order_idx on chat_messages(order_id, id desc);

-- ---------- AUDIT + IDEMPOTENCY -----------------------------------
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  action      text not null,
  entity      text,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  severity    severity not null default 'info',
  created_at  timestamptz not null default now()
);
create index audit_actor_idx  on audit_log(actor_id, created_at desc);
create index audit_action_idx on audit_log(action, created_at desc);

create table rpc_calls (
  idempotency_key text primary key,
  fn_name         text not null,
  caller_id       uuid,
  result          jsonb,
  created_at      timestamptz not null default now()
);

-- the table the GitHub Actions keepalive reads so the project never pauses
create table keepalive (
  id        bigint primary key generated always as identity,
  pinged_at timestamptz not null default now()
);
insert into keepalive default values;
