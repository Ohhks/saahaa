-- ============================================================
-- SAAHAA · 0003_automation.sql — the jobs that run the business while
-- the owner is asleep, at an exam, or in an interview.
--
-- pg_cron runs INSIDE Postgres: no HTTP hop, no Edge Function quota, and it
-- can call the same SECURITY DEFINER functions inside one transaction.
-- Every job uses a DETERMINISTIC idempotency key, so a double-fire or a
-- catch-up run after the project un-pauses can never double-release money.
--
-- FREE-TIER TRAP: a free project pauses after ~7 days of no API traffic, and
-- a paused project's pg_cron does not run — escrow would silently never
-- release. The GitHub Actions keepalive is therefore a LIVENESS REQUIREMENT,
-- not a nicety. See .github/workflows/keepalive.yml.
-- ============================================================

create extension if not exists pg_cron;

-- ---------- 1. close auctions whose window has run out --------------
create or replace function app.job_close_auctions() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare n int;
begin
  with closed as (
    update service_requests
       set status='awaiting_choice',
           hold_until = now() + make_interval(secs => app.cfg('bid_hold_seconds'))
     where status='bidding' and closes_at <= now() and bid_count > 0
     returning id)
  select count(*) into n from closed;

  -- zero bids: fall back to a fixed-price instant match rather than dead-ending
  update service_requests set status='fallback_instant'
   where status='bidding' and closes_at <= now() and bid_count = 0;
  return n;
end $$;

-- ---------- 2. expire unchosen bids ---------------------------------
create or replace function app.job_expire_bids() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare n int;
begin
  with e as (
    update bids set status='expired'
     where status in ('submitted','shortlisted','countered') and expires_at <= now()
     returning id)
  select count(*) into n from e;

  update service_requests set status='expired'
   where status='awaiting_choice' and hold_until <= now();
  return n;
end $$;

-- ---------- 3. auto-release escrow ----------------------------------
-- The single most important automation in the system: it is what lets 85% of
-- jobs settle with zero human involvement. Guarded by evidence, by the
-- dispute check, and by a deterministic key.
create or replace function app.job_auto_release() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select o.id from orders o
     where o.status='delivered'
       and o.auto_release_at is not null and o.auto_release_at <= now()
       and array_length(o.evidence,1) >= 1              -- no photo, no auto-release
       and not exists (select 1 from disputes d
                        where d.order_id=o.id and d.status in ('open','evidence'))
       and not exists (select 1 from safety_incidents s
                        where s.order_id=o.id and s.resolved_at is null)
     limit 200
  loop
    begin
      perform public.release_escrow(r.id, 1.0, 'auto_release_timeout',
        'cron:release:'||r.id::text);
      n := n + 1;
    exception when others then
      insert into audit_log(action,entity,entity_id,detail,severity)
        values ('cron.release.failed','orders',r.id::text,
                jsonb_build_object('err',sqlerrm),'urgent');
    end;
  end loop;
  return n;
end $$;

-- ---------- 4. no-show detection ------------------------------------
create or replace function app.job_no_show() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select o.id, o.partner_id from orders o
     where o.status='escrow_held' and o.started_at is null
       and coalesce(o.scheduled_for, o.accepted_at) + interval '45 minutes' < now()
       and coalesce(o.scheduled_for, o.accepted_at) + interval '24 hours' < now()
     limit 100
  loop
    begin
      -- the pro never arrived and no check-in code was ever entered:
      -- full refund, no human needed, and the pro takes the reliability hit
      perform public.refund_escrow(r.id, null, 0, 'partner_no_show', 'cron:noshow:'||r.id::text);
      update partners set no_shows = no_shows + 1 where id = r.partner_id;
      n := n + 1;
    exception when others then
      insert into audit_log(action,entity,entity_id,detail,severity)
        values ('cron.noshow.failed','orders',r.id::text,jsonb_build_object('err',sqlerrm),'urgent');
    end;
  end loop;
  return n;
end $$;

-- ---------- 5. mature the holdback ----------------------------------
create or replace function app.job_release_holdback() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; n int := 0; t uuid; days bigint;
begin
  days := app.cfg('holdback_days');
  for r in
    select o.id as order_id, o.holdback_paise, p.user_id
      from orders o join partners p on p.id = o.partner_id
     where o.status='settled' and o.holdback_paise > 0
       and o.settled_at < now() - make_interval(days => days)
       and not exists (select 1 from disputes d where d.order_id=o.id and d.status in ('open','evidence'))
       and not exists (select 1 from ledger_txns x
                        where x.idempotency_key = 'cron:holdback:'||o.id::text)
     limit 200
  loop
    t := app.post_txn('holdback', r.order_id, 'cron:holdback:'||r.order_id::text,
          'holdback matured',
          jsonb_build_array(
            jsonb_build_object('acct',app.acct('holdback', r.user_id),'dir','credit','amt',r.holdback_paise),
            jsonb_build_object('acct',app.acct('partner_payable', r.user_id),'dir','debit','amt',r.holdback_paise)));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- 6. disputes that resolve themselves ---------------------
-- Panel target: 60% of disputes close with zero human involvement. These are
-- the branches that are objectively determinable from timestamps and evidence.
-- "He did a bad job" is a judgement call and always routes to the owner.
create or replace function app.job_auto_disputes() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare d record; n int := 0; o orders;
begin
  for d in select * from disputes where status='open' limit 100 loop
    select * into o from orders where id = d.order_id;

    -- (a) no check-in code was ever entered: the pro was never provably there
    if not o.otp_verified then
      perform public.refund_escrow(o.id, null, 0, 'auto:no_checkin', 'cron:disp:'||d.id::text);
      update disputes set status='resolved_customer', auto_resolved=true, resolved_at=now(),
             resolution_note='No arrival code was ever entered — full refund, automatically.'
       where id=d.id;
      n := n + 1;

    -- (b) both codes verified AND evidence present: the customer confirmed
    --     the work with their own hands; the claim does not survive that
    elsif o.otp_verified and array_length(o.evidence,1) >= 1
          and o.status in ('verified','settled') then
      update disputes set status='resolved_partner', auto_resolved=true, resolved_at=now(),
             resolution_note='Arrival code verified and completion photos on file.'
       where id=d.id;
      n := n + 1;

    -- (c) small claim from a customer who rarely claims: cheaper than the
    --     owner's two minutes. Capped to once per customer per 30 days.
    elsif o.total_paise <= 20000
          and (select count(*) from disputes x join orders y on y.id=x.order_id
                where y.customer_id=o.customer_id and x.created_at > now()-interval '30 days') <= 1 then
      perform public.refund_escrow(o.id, null, 0, 'auto:goodwill', 'cron:disp:'||d.id::text);
      update disputes set status='resolved_customer', auto_resolved=true, resolved_at=now(),
             resolution_note='Small claim, first in 30 days — refunded as goodwill.'
       where id=d.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- 7. nightly reconciliation -------------------------------
create or replace function app.job_reconcile() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare res jsonb;
begin
  res := public.reconcile();
  -- If the book does not balance, FREEZE payouts. Never auto-repair: an
  -- auto-repair is indistinguishable from an attacker covering their tracks.
  if not (res->>'ok')::boolean then
    update app_config set value='true'::jsonb where key='kill_switch_new_orders';
    insert into audit_log(action,entity,detail,severity)
      values ('ledger.FROZEN','ledger',res,'critical');
  end if;
  return res;
end $$;

-- ---------- 8. trust score + housekeeping ---------------------------
create or replace function app.job_rollup() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update partners p set
    rating_avg = coalesce((select avg(rating)::numeric(3,2) from reviews r
                            where r.partner_id=p.id and not r.is_hidden), 0),
    rating_count = (select count(*) from reviews r where r.partner_id=p.id and not r.is_hidden);

  update profiles pr set trust_score = greatest(0, least(100, round(
      30 * least(1, greatest(0, (coalesce(p.rating_avg,3.8) - 1) / 4))
    + 20 * (case when p.jobs_completed + p.cancels_count + p.no_shows = 0 then 0.5
                 else p.jobs_completed::numeric
                      / (p.jobs_completed + p.cancels_count + p.no_shows * 2) end)
    + 15 * (array['0','0.25','0.55','0.85','1','1']::numeric[])[least(5, pr.tier) + 1]
    + 12 * greatest(0, 1 - least(1, p.disputes_lost * 0.25))
    + 10 * least(1, ln(1 + p.jobs_completed) / ln(101))
    +  8 * (case when p.starts_count < 5 then 0.6
                 else p.on_time_count::numeric / nullif(p.starts_count,0) end)
    +  5 * (case when p.last_active_at > now() - interval '14 days' then 1
                 when p.last_active_at > now() - interval '45 days' then 0.7
                 when p.last_active_at > now() - interval '90 days' then 0.4 else 0.1 end)
  )::int))
  from partners p where p.user_id = pr.id;
end $$;

create or replace function app.job_gc() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from otp_codes  where (status <> 'active') and issued_at < now() - interval '7 days';
  delete from rpc_calls  where created_at < now() - interval '30 days';
  delete from audit_log  where created_at < now() - interval '180 days' and severity = 'info';
  insert into keepalive default values;
  delete from keepalive where id < (select max(id) - 50 from keepalive);
end $$;

-- ---------- schedule -------------------------------------------------
select cron.schedule('saahaa_close_auctions',  '* * * * *',     $$ select app.job_close_auctions() $$);
select cron.schedule('saahaa_expire_bids',     '*/2 * * * *',   $$ select app.job_expire_bids() $$);
select cron.schedule('saahaa_auto_release',    '*/10 * * * *',  $$ select app.job_auto_release() $$);
select cron.schedule('saahaa_no_show',         '*/10 * * * *',  $$ select app.job_no_show() $$);
select cron.schedule('saahaa_auto_disputes',   '*/15 * * * *',  $$ select app.job_auto_disputes() $$);
select cron.schedule('saahaa_holdback',        '20 3 * * *',    $$ select app.job_release_holdback() $$);
select cron.schedule('saahaa_reconcile',       '30 2 * * *',    $$ select app.job_reconcile() $$);
select cron.schedule('saahaa_rollup',          '45 2 * * *',    $$ select app.job_rollup() $$);
select cron.schedule('saahaa_gc',              '0 4 * * 0',     $$ select app.job_gc() $$);

-- ---------- the owner's TODAY queue ---------------------------------
-- One query for everything blocked on a human, newest money first. This view
-- exists because an admin console with eight sections is a REPORTING tool;
-- the owner needs an OPERATING tool that answers "is anything waiting on me?"
-- in one screen, or the daily ritual gets skipped inside three weeks.
create or replace view public.today_queue as
  select 'safety'   as kind, s.id, s.created_at, 'critical'::severity as severity,
         0::bigint as amount_paise,
         'Safety report: '||s.kind as title, s.order_id
    from safety_incidents s where s.resolved_at is null
  union all
  select 'dispute', d.id, d.created_at,
         case when d.sla_due_at < now() then 'urgent' else 'warn' end::severity,
         o.total_paise, 'Dispute: '||d.reason_code, d.order_id
    from disputes d join orders o on o.id=d.order_id
   where d.status in ('open','evidence') and not d.auto_resolved
  union all
  select 'escrow_hold', o.id, o.updated_at, 'warn'::severity, o.total_paise,
         'Held for review: '||o.code, o.id
    from orders o
   where o.status='delivered'
     and (array_length(o.evidence,1) is null or o.total_paise > 1000000)
  union all
  select 'partner_approval', p.id, p.created_at, 'info'::severity, 0::bigint,
         'First-job approval: '||p.legal_name, null::uuid
    from partners p where p.kyc='pending'
  union all
  select 'ledger', a.id::text::uuid, a.created_at, 'critical'::severity, 0::bigint,
         'Ledger integrity failure', null::uuid
    from audit_log a
   where a.action='ledger.FROZEN' and a.created_at > now() - interval '48 hours';

grant select on public.today_queue to authenticated;
