-- ============================================================
-- SAAHAA · 0004_gateway.sql — the rail's mirror.
--
-- Razorpay is the TRUTH about money in flight; these tables are the
-- server's own copy of what it said, written ONLY by the Edge Functions in
-- supabase/functions/ with the service-role key. There is no write policy
-- and INSERT/UPDATE/DELETE are revoked from anon and authenticated, so the
-- browser — which ships the anon key to the world — cannot invent a
-- payment. The owner can read them from the console; nobody else can.
--
-- Money is BIGINT PAISE, as everywhere else. Nothing here is a ledger leg:
-- the ledger is posted by the lead's release work from these rows, never
-- from a checkout callback.
-- ============================================================

-- every webhook delivery, once. The primary key is Razorpay's event id
-- (X-Razorpay-Event-Id), stable across all retries — INSERT … ON CONFLICT
-- DO NOTHING is the replay defence (docs/PRODUCTION.md §4).
create table gateway_events (
  id           text primary key,
  kind         text not null,            -- payment.captured, refund.processed, transfer.processed, …
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz                -- null = stored but the mirror write failed; replay from payload
);
create index gateway_events_kind_idx on gateway_events(kind, received_at desc);
create index gateway_events_unprocessed_idx on gateway_events(received_at) where processed_at is null;

-- one row per Razorpay payment, upserted from payment.* / refund.* events
create table gateway_payments (
  payment_id     text primary key,        -- pay_…
  order_id       text,                    -- order_…  (razorpay-order made it)
  amount         bigint not null check (amount >= 0),
  currency       text not null default 'INR',
  status         text not null check (status in ('created','authorized','captured','failed','refunded','partially_refunded')),
  method         text,                    -- upi / card / netbanking / wallet
  key            text not null default '',   -- the app's customer / partner key, from order notes
  purpose        text not null default '',   -- topup, stake-topup, service, retail, …
  error_code     text,
  error_reason   text,
  last_refund_id text,
  captured_at    timestamptz,
  updated_at     timestamptz not null default now()
);
create index gateway_payments_key_idx   on gateway_payments(key, updated_at desc);
create index gateway_payments_order_idx on gateway_payments(order_id);

-- one row per payout attempt that reached Razorpay (Route transfer or
-- RazorpayX payout); status follows from payout.* webhooks
create table gateway_payouts (
  ref        text primary key,            -- trf_… (route) or pout_… (payoutx)
  mode       text not null check (mode in ('route','payoutx')),
  idem       text not null unique,        -- the idempotency key the caller sent (or the function minted)
  amount     bigint not null check (amount > 0),
  purpose    text not null default '',
  key        text not null default '',
  upi        text not null default '',
  status     text not null default 'created',
  actor_id   uuid,                        -- the admin whose session sent it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gateway_payouts_key_idx on gateway_payouts(key, created_at desc);

-- ---------- RLS: read by the owner, written by nobody in the browser ------
alter table gateway_events   enable row level security;
alter table gateway_payments enable row level security;
alter table gateway_payouts  enable row level security;

create policy gw_events_admin   on gateway_events   for select to authenticated using (app.is_admin());
create policy gw_payments_admin on gateway_payments for select to authenticated using (app.is_admin());
create policy gw_payouts_admin  on gateway_payouts  for select to authenticated using (app.is_admin());

revoke insert, update, delete on gateway_events, gateway_payments, gateway_payouts from anon, authenticated;
