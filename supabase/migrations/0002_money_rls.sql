-- ============================================================
-- SAAHAA · 0002_money_rls.sql
--
-- THE RULE THIS FILE ENFORCES: the browser cannot move a rupee.
-- The anon key ships inside a public GitHub Pages bundle, so anything
-- `authenticated` may INSERT or UPDATE is effectively a public API.
-- Therefore every money table has INSERT/UPDATE/DELETE revoked and NO write
-- policy at all; the only mutators are SECURITY DEFINER functions that
-- re-check the caller's role, the state machine and the arithmetic in SQL.
-- ============================================================

-- ---------- helpers ------------------------------------------------
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp as
$$ select coalesce((select role='admin' and not is_banned from profiles where id=auth.uid()), false) $$;

create or replace function app.my_partner_id() returns uuid
language sql stable security definer set search_path=public,pg_temp as
$$ select id from partners where user_id = auth.uid() $$;

create or replace function app.cfg(k text) returns bigint
language sql stable security definer set search_path=public,pg_temp as
$$ select (value #>> '{}')::bigint from app_config where key = k $$;

create or replace function app.is_order_party(o uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from orders ord
    left join partners p on p.id = ord.partner_id
    left join shops    s on s.id = ord.shop_id
    where ord.id = o
      and (ord.customer_id = auth.uid() or p.user_id = auth.uid() or s.owner_id = auth.uid()))
$$;

create or replace function app.acct(p_kind account_kind, p_owner uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a uuid;
begin
  if p_owner is null then
    select id into a from ledger_accounts where kind=p_kind and owner_id is null;
    if a is null then insert into ledger_accounts(kind) values (p_kind) returning id into a; end if;
  else
    select id into a from ledger_accounts where kind=p_kind and owner_id=p_owner;
    if a is null then insert into ledger_accounts(kind,owner_id) values (p_kind,p_owner) returning id into a; end if;
  end if;
  return a;
end $$;

-- ---------- ledger integrity ---------------------------------------
-- Every transaction must balance to exactly zero. Checked at COMMIT, so a
-- multi-leg posting can be built up and still be atomic.
create or replace function app.assert_txn_balanced() returns trigger
language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(signed_paise),0) into s from ledger_entries where txn_id = new.txn_id;
  if s <> 0 then
    raise exception 'ledger txn % unbalanced by % paise', new.txn_id, s using errcode='check_violation';
  end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function app.assert_txn_balanced();

create or replace function app.ledger_chain() returns trigger
language plpgsql as $$
declare p text;
begin
  select entry_hash into p from ledger_entries order by id desc limit 1;
  new.prev_hash  := p;
  new.entry_hash := encode(digest(
      coalesce(p,'GENESIS')||'|'||new.txn_id::text||'|'||new.account_id::text||'|'||
      new.direction::text||'|'||new.amount_paise::text||'|'||coalesce(new.order_id::text,''),
      'sha256'),'hex');
  return new;
end $$;
create trigger ledger_chain_bi before insert on ledger_entries
  for each row execute function app.ledger_chain();

create or replace function app.ledger_immutable() returns trigger
language plpgsql as $$ begin raise exception 'ledger_entries is append-only'; end $$;
create trigger ledger_no_update before update or delete on ledger_entries
  for each row execute function app.ledger_immutable();

create or replace function app.apply_balance() returns trigger
language plpgsql as $$
begin
  insert into account_balances(account_id, balance_paise, entry_count)
  values (new.account_id, new.signed_paise, 1)
  on conflict (account_id) do update
    set balance_paise = account_balances.balance_paise + new.signed_paise,
        entry_count   = account_balances.entry_count + 1,
        updated_at    = now();
  return new;
end $$;
create trigger ledger_balance_ai after insert on ledger_entries
  for each row execute function app.apply_balance();

create or replace function app.post_txn(
  p_kind txn_kind, p_order uuid, p_idem text, p_memo text, p_legs jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t uuid; leg jsonb;
begin
  insert into ledger_txns(kind, order_id, idempotency_key, memo, created_by)
  values (p_kind, p_order, p_idem, p_memo, auth.uid()) returning id into t;
  for leg in select * from jsonb_array_elements(p_legs) loop
    insert into ledger_entries(txn_id, account_id, direction, amount_paise, order_id)
    values (t, (leg->>'acct')::uuid, (leg->>'dir')::entry_direction, (leg->>'amt')::bigint, p_order);
  end loop;
  return t;
end $$;

create or replace function app.begin_idem(p_key text, p_fn text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'idempotency_key required' using errcode='22023'; end if;
  select result into r from rpc_calls where idempotency_key = p_key;
  if found then return coalesce(r,'{"replayed":true}'::jsonb); end if;
  insert into rpc_calls(idempotency_key, fn_name, caller_id) values (p_key, p_fn, auth.uid());
  return null;
exception when unique_violation then
  select result into r from rpc_calls where idempotency_key = p_key;
  return coalesce(r,'{"replayed":true}'::jsonb);
end $$;

create or replace function app.end_idem(p_key text, p_result jsonb)
returns jsonb language sql security definer set search_path=public,pg_temp as
$$ update rpc_calls set result=p_result where idempotency_key=p_key returning result $$;

create or replace function app.log_event(p_order uuid, p_from order_status,
  p_to order_status, p_reason text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare n int;
begin
  select coalesce(max(seq),0)+1 into n from order_events where order_id=p_order;
  insert into order_events(order_id,seq,from_status,to_status,actor_id,reason,meta)
  values (p_order,n,p_from,p_to,auth.uid(),p_reason,p_meta);
end $$;

-- ---------- OTP: peppered hash ------------------------------------
-- The pepper is a database setting, NEVER a column. A 6-digit code is only
-- 10^6 possibilities: a leaked salt+hash without a pepper is brute-forced in
-- milliseconds. Set it once, out of band:
--   ALTER DATABASE postgres SET app.otp_pepper = '<32 random bytes, base64>';
create or replace function app.otp_hash(p_code text, p_salt bytea)
returns bytea language sql immutable security definer set search_path=public,pg_temp as $$
  select digest(convert_to(p_code,'utf8') || p_salt ||
                convert_to(coalesce(current_setting('app.otp_pepper', true),'CHANGE_ME'),'utf8'),
                'sha256')
$$;

-- ============================================================
-- RPCs — the ONLY way money moves or a verified state advances
-- ============================================================

-- 1. PLACE BID -------------------------------------------------------
create or replace function public.place_bid(
  p_request_id uuid, p_amount_paise bigint, p_eta_minutes int,
  p_note text default null, p_device text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; r service_requests; pid uuid; b uuid; secs int;
begin
  v := app.begin_idem(p_idem,'place_bid'); if v is not null then return v; end if;

  pid := app.my_partner_id();
  if pid is null then raise exception 'caller is not a partner' using errcode='42501'; end if;
  perform 1 from partners p join profiles pr on pr.id=p.user_id
    where p.id=pid and p.kyc='approved' and not pr.is_banned;
  if not found then raise exception 'partner not approved' using errcode='42501'; end if;

  select * into r from service_requests where id=p_request_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if r.status <> 'bidding' or r.closes_at <= now() then
    raise exception 'bidding is closed' using errcode='55000'; end if;
  if r.customer_id = auth.uid() then
    raise exception 'you cannot bid on your own request' using errcode='42501'; end if;

  -- THE BAND. Enforced here, in SQL, not in the browser.
  if p_amount_paise < r.floor_paise then
    raise exception 'below the minimum of % paise for this job', r.floor_paise using errcode='22023'; end if;
  if p_amount_paise > r.ceiling_paise then
    raise exception 'above the maximum of % paise for this job', r.ceiling_paise using errcode='22023'; end if;

  secs := greatest(0, extract(epoch from (now() - r.opened_at))::int);
  insert into bids(request_id,partner_id,amount_paise,eta_minutes,note_chip,
                   after_seconds,device_hash,expires_at)
  values (p_request_id,pid,p_amount_paise,p_eta_minutes,p_note,secs,p_device,
          r.closes_at + make_interval(secs => app.cfg('bid_hold_seconds')))
  returning id into b;

  update service_requests
     set bid_count = (select count(*) from bids where request_id=p_request_id
                        and status in ('submitted','shortlisted')),
         status = case when (select count(*) from bids where request_id=p_request_id
                               and status in ('submitted','shortlisted')) >= app.cfg('max_bids')
                       then 'awaiting_choice'::request_status else status end,
         hold_until = case when (select count(*) from bids where request_id=p_request_id
                                   and status in ('submitted','shortlisted')) >= app.cfg('max_bids')
                       then now() + make_interval(secs => app.cfg('bid_hold_seconds')) else hold_until end
   where id = p_request_id;

  return app.end_idem(p_idem, jsonb_build_object('ok',true,'bid_id',b));
exception when unique_violation then
  raise exception 'you have already bid on this job' using errcode='23505';
end $$;

-- 2. ACCEPT BID (creates the order; moves no money yet) --------------
create or replace function public.accept_bid(p_bid_id uuid, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; b bids; r service_requests; o uuid; markup bigint; gst_bps bigint;
        uplift bigint; fee bigint; gst bigint;
begin
  v := app.begin_idem(p_idem,'accept_bid'); if v is not null then return v; end if;

  select * into b from bids where id=p_bid_id for update;
  if not found then raise exception 'bid not found' using errcode='P0002'; end if;
  select * into r from service_requests where id=b.request_id for update;
  if r.customer_id <> auth.uid() then
    raise exception 'only the requester may accept' using errcode='42501'; end if;
  -- the WHERE clause IS the lock; never read-then-write from the client
  if r.status not in ('bidding','awaiting_choice') or r.awarded_bid_id is not null then
    raise exception 'this request is already taken' using errcode='55000'; end if;
  if b.status not in ('submitted','shortlisted','countered') or b.expires_at <= now() then
    raise exception 'that quote has expired' using errcode='55000'; end if;

  markup  := app.cfg('service_markup_bps');
  gst_bps := app.cfg('gst_bps');
  uplift  := (b.amount_paise * markup) / 10000;
  -- GST is 18% OF THE FEE, not of the deal. fee = uplift / 1.18
  fee     := round(uplift::numeric * 10000 / (10000 + gst_bps));
  gst     := uplift - fee;

  update bids set status='rejected' where request_id=r.id and id<>b.id
    and status in ('submitted','shortlisted','countered');
  update bids set status='accepted' where id=b.id;

  insert into orders(kind,customer_id,partner_id,request_id,bid_id,category_key,status,
                     deal_paise,fee_paise,gst_paise,total_paise,
                     area,address_line,contact_phone,scheduled_for,accepted_at)
  values ('service',r.customer_id,b.partner_id,r.id,b.id,r.category_key,'accepted',
          b.amount_paise,fee,gst,b.amount_paise+uplift,
          r.area,r.address_line,r.contact_phone,r.scheduled_for,now())
  returning id into o;

  update service_requests set status='awarded', awarded_bid_id=b.id where id=r.id;
  perform app.log_event(o,'created','accepted','bid accepted',
    jsonb_build_object('bid',b.id,'amount',b.amount_paise));
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'order_id',o,'total_paise',b.amount_paise+uplift));
end $$;

-- 3. LOCK ESCROW -----------------------------------------------------
create or replace function public.lock_escrow(p_order_id uuid, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; o orders; h uuid; t uuid; esc uuid; src uuid; cap bigint; ver boolean;
begin
  v := app.begin_idem(p_idem,'lock_escrow'); if v is not null then return v; end if;

  select * into o from orders where id=p_order_id for update;
  if not found then raise exception 'order not found' using errcode='P0002'; end if;
  if o.customer_id <> auth.uid() and not app.is_admin() then
    raise exception 'only the customer may fund this' using errcode='42501'; end if;
  if o.status <> 'accepted' then
    raise exception 'cannot fund from status %', o.status using errcode='55000'; end if;
  if exists (select 1 from escrow_holds where order_id=o.id and status in ('held','disputed','frozen')) then
    raise exception 'already funded' using errcode='55000'; end if;

  select phone_verified into ver from profiles where id=o.customer_id;
  cap := app.cfg('unverified_max_escrow_paise');
  if not coalesce(ver,false) and o.total_paise > cap then
    raise exception 'unverified accounts are capped at % paise per job', cap using errcode='55000'; end if;

  esc := app.acct('escrow');
  src := app.acct('user_wallet', o.customer_id);
  t := app.post_txn('escrow_lock', o.id, p_idem||':lock', 'escrow lock '||o.code,
        jsonb_build_array(
          jsonb_build_object('acct',esc,'dir','debit', 'amt',o.total_paise),
          jsonb_build_object('acct',src,'dir','credit','amt',o.total_paise)));

  insert into escrow_holds(order_id,amount_paise) values (o.id,o.total_paise) returning id into h;
  update orders set status='escrow_held', updated_at=now() where id=o.id;
  perform app.log_event(o.id,'accepted','escrow_held','funds locked',jsonb_build_object('txn',t));
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'hold_id',h,'locked_paise',o.total_paise));
end $$;

-- 4. ISSUE OTP -------------------------------------------------------
-- Direction ALTERNATES between the two checkpoints. Check-in: the customer
-- shows, the pro types — proving the pro is physically there. Check-out: the
-- pro shows, the customer types — proving the customer accepted the work in
-- the pro's presence. Same-direction twice means one screenshot covers both.
create or replace function public.issue_otp(
  p_order_id uuid, p_stage otp_stage, p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; o orders; aud uuid; ver uuid; supply uuid; code text; salt bytea;
        ttl int; seq smallint; oid uuid;
begin
  v := app.begin_idem(p_idem,'issue_otp'); if v is not null then return v; end if;

  select * into o from orders where id=p_order_id for update;
  if not found then raise exception 'order not found' using errcode='P0002'; end if;

  select coalesce(p.user_id, s.owner_id) into supply from orders x
    left join partners p on p.id=x.partner_id left join shops s on s.id=x.shop_id where x.id=o.id;

  case p_stage
    when 'checkin'  then aud := o.customer_id; ver := supply;
                         ttl := app.cfg('otp_ttl_checkin_min')::int;
    when 'checkout' then aud := supply;        ver := o.customer_id;
                         ttl := app.cfg('otp_ttl_checkout_min')::int;
    when 'delivery' then aud := o.customer_id; ver := supply;
                         ttl := app.cfg('otp_ttl_checkout_min')::int;
    when 'pickup'   then aud := supply;        ver := o.customer_id;
                         ttl := app.cfg('otp_ttl_checkout_min')::int;
  end case;

  -- only the party entitled to SEE the code may ask for it
  if auth.uid() <> aud then raise exception 'this code is not yours to see' using errcode='42501'; end if;

  select coalesce(max(issue_seq),0)+1 into seq from otp_codes where order_id=o.id and stage=p_stage;
  if seq > 3 then raise exception 'too many codes issued for this step' using errcode='55000'; end if;
  if exists (select 1 from otp_codes where order_id=o.id and stage=p_stage
               and issued_at > now() - interval '60 seconds') then
    raise exception 'please wait a moment before asking for a new code' using errcode='55000'; end if;

  update otp_codes set status='superseded' where order_id=o.id and stage=p_stage and status='active';

  code := lpad((abs(('x'||encode(gen_random_bytes(4),'hex'))::bit(32)::int) % 1000000)::text, 6, '0');
  salt := gen_random_bytes(16);
  insert into otp_codes(order_id,stage,code_hash,salt,audience_id,verifier_id,
                        max_attempts,issue_seq,expires_at)
  values (o.id,p_stage,app.otp_hash(code,salt),salt,aud,ver,
          app.cfg('otp_max_attempts')::smallint,seq,now()+make_interval(mins=>ttl))
  returning id into oid;

  -- the plaintext exists here and NOWHERE else, ever
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'otp_id',oid,'code',code,'expires_in_min',ttl));
end $$;

-- 5. VERIFY OTP ------------------------------------------------------
create or replace function public.verify_otp(
  p_order_id uuid, p_stage otp_stage, p_code text,
  p_lat double precision default null, p_lng double precision default null,
  p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; c otp_codes; o orders; rl otp_rate_limit; ns order_status;
        a bytea; bb bytea; diff int := 0; i int; dist int; maxm int;
begin
  v := app.begin_idem(p_idem,'verify_otp'); if v is not null then return v; end if;

  -- rate limit BEFORE any hashing: cheap DoS and code-spray defence
  insert into otp_rate_limit(user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into rl from otp_rate_limit where user_id=auth.uid() for update;
  if rl.last_attempt_at > now() - interval '3 seconds' then
    raise exception 'too fast — wait a moment' using errcode='55000'; end if;
  if rl.hour_bucket = date_trunc('hour',now()) and rl.hour_count >= 12 then
    raise exception 'too many attempts this hour' using errcode='55000'; end if;
  update otp_rate_limit set last_attempt_at=now(), hour_bucket=date_trunc('hour',now()),
    hour_count = case when hour_bucket=date_trunc('hour',now()) then hour_count+1 else 1 end
   where user_id=auth.uid();

  select * into o from orders where id=p_order_id for update;
  select * into c from otp_codes where order_id=p_order_id and stage=p_stage and status='active' for update;
  if not found then return jsonb_build_object('ok',false,'err','no_active_code'); end if;

  -- the single line that stops a pro consuming a code addressed to himself
  if auth.uid() <> c.verifier_id then
    raise exception 'only the other party may enter this code' using errcode='42501'; end if;

  if now() > c.expires_at then
    update otp_codes set status='expired' where id=c.id;
    return jsonb_build_object('ok',false,'err','expired'); end if;
  if c.attempts >= c.max_attempts then
    update otp_codes set status='locked' where id=c.id;
    return jsonb_build_object('ok',false,'err','locked'); end if;

  -- constant-time compare: XOR the digests, never `=` with an early exit
  a := app.otp_hash(p_code, c.salt); bb := c.code_hash;
  if length(a) <> length(bb) then diff := 1;
  else for i in 0 .. length(a)-1 loop diff := diff | (get_byte(a,i) # get_byte(bb,i)); end loop;
  end if;

  if diff <> 0 then
    update otp_codes set attempts=attempts+1 where id=c.id;
    insert into audit_log(actor_id,action,entity,entity_id,detail,severity)
      values (auth.uid(),'otp.fail','orders',p_order_id::text,
              jsonb_build_object('stage',p_stage,'attempt',c.attempts+1),'warn');
    return jsonb_build_object('ok',false,'err','wrong_code','attempts_left',c.max_attempts-c.attempts-1);
  end if;

  -- geo gate: proves physical presence, and is the cheapest such proof we have
  if p_stage in ('checkin','delivery','pickup') and p_lat is not null and o.lat is not null then
    dist := round(6371000 * acos(least(1, greatest(-1,
              cos(radians(o.lat))*cos(radians(p_lat))*cos(radians(p_lng)-radians(o.lng))
              + sin(radians(o.lat))*sin(radians(p_lat))))));
    maxm := case when p_stage='checkin' then app.cfg('geo_max_m_checkin')::int
                 else app.cfg('geo_max_m_delivery')::int end;
    if dist > maxm then
      insert into audit_log(actor_id,action,entity,entity_id,detail,severity)
        values (auth.uid(),'otp.geo_reject','orders',p_order_id::text,
                jsonb_build_object('dist_m',dist),'warn');
      return jsonb_build_object('ok',false,'err','too_far','dist_m',dist);
    end if;
  end if;

  update otp_codes set status='used', consumed_at=now(), verified_dist_m=dist
   where id=c.id and status='active';
  if not found then return jsonb_build_object('ok',false,'err','replay'); end if;

  ns := case p_stage when 'checkin' then 'in_progress'::order_status
                     when 'checkout' then 'verified'::order_status
                     when 'delivery' then 'delivered'::order_status
                     else o.status end;
  if ns <> o.status then
    update orders set status=ns, otp_verified=true,
      started_at   = case when ns='in_progress' then now() else started_at end,
      verified_at  = case when ns='verified'    then now() else verified_at end,
      delivered_at = case when ns='delivered'   then now() else delivered_at end,
      updated_at   = now()
     where id=o.id;
    perform app.log_event(o.id,o.status,ns,'otp verified',jsonb_build_object('stage',p_stage));
  end if;
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'status',ns,'dist_m',dist));
end $$;

-- 6. SUBMIT COMPLETION (evidence gate) -------------------------------
create or replace function public.submit_completion(
  p_order_id uuid, p_evidence text[], p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; o orders; supply uuid; hrs bigint;
begin
  v := app.begin_idem(p_idem,'submit_completion'); if v is not null then return v; end if;
  select * into o from orders where id=p_order_id for update;
  select coalesce(p.user_id,s.owner_id) into supply from orders x
    left join partners p on p.id=x.partner_id left join shops s on s.id=x.shop_id where x.id=o.id;
  if auth.uid() <> supply then raise exception 'only the pro may mark this done' using errcode='42501'; end if;
  if o.status <> 'in_progress' then
    raise exception 'cannot complete from %', o.status using errcode='55000'; end if;
  -- NO PHOTO, NO AUTO-RELEASE. This one rule does more anti-fraud work than
  -- everything else in the system combined.
  if p_evidence is null or array_length(p_evidence,1) is null then
    raise exception 'at least one photo of the finished work is required' using errcode='22023'; end if;

  hrs := app.cfg('auto_release_hours');
  update orders set status='delivered', delivered_at=now(), evidence=p_evidence,
                    auto_release_at = now() + make_interval(hours => hrs), updated_at=now()
   where id=o.id;
  update escrow_holds set auto_release_at = now() + make_interval(hours => hrs)
   where order_id=o.id and status='held';
  perform app.log_event(o.id,'in_progress','delivered','evidence submitted',
                        jsonb_build_object('photos',array_length(p_evidence,1)));
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'auto_release_in_hours',hrs));
end $$;

-- 7. RELEASE ESCROW --------------------------------------------------
create or replace function public.release_escrow(
  p_order_id uuid, p_pct numeric default 1.0, p_reason text default 'customer_confirm',
  p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; o orders; h escrow_holds; t uuid; supply uuid; is_cron boolean;
        payout bigint; hold bigint; held_now bigint; fee bigint; gst bigint;
        refund bigint; uplift bigint; gst_bps bigint;
        esc uuid; pay uuid; hb uuid; feeA uuid; gstA uuid; cust uuid;
begin
  v := app.begin_idem(p_idem,'release_escrow'); if v is not null then return v; end if;
  is_cron := (auth.uid() is null);

  select * into o from orders where id=p_order_id for update;
  select * into h from escrow_holds where order_id=p_order_id and status='held' for update;
  if not found then raise exception 'no held escrow' using errcode='P0002'; end if;
  if not (is_cron or app.is_admin() or o.customer_id = auth.uid()) then
    raise exception 'not authorised to release' using errcode='42501'; end if;
  if o.status not in ('delivered','verified') then
    raise exception 'cannot release from %', o.status using errcode='55000'; end if;
  if exists (select 1 from disputes where order_id=o.id and status in ('open','evidence')) then
    raise exception 'this order is under dispute' using errcode='55000'; end if;
  if p_pct < 0 or p_pct > 1 then raise exception 'bad percentage' using errcode='22023'; end if;

  gst_bps := app.cfg('gst_bps');
  payout  := floor(o.deal_paise * p_pct)::bigint;
  uplift  := floor((o.fee_paise + o.gst_paise) * p_pct)::bigint;   -- fee is ALWAYS pro-rata
  fee     := round(uplift::numeric * 10000 / (10000 + gst_bps));
  gst     := uplift - fee;
  refund  := h.amount_paise - payout - uplift;

  -- the holdback: the pro's implicit stake. They never pay to join, but a
  -- slice of each payout is held briefly, so skin-in-the-game grows exactly
  -- as volume — and therefore fraud capacity — grows.
  select coalesce(balance_paise,0) into held_now from account_balances ab
    join ledger_accounts la on la.id=ab.account_id
    where la.kind='holdback' and la.owner_id=(select user_id from partners where id=o.partner_id);
  hold := least((payout * app.cfg('holdback_bps')) / 10000,
                greatest(0, app.cfg('holdback_cap_paise') - coalesce(held_now,0)));

  select coalesce(p.user_id,s.owner_id) into supply from orders x
    left join partners p on p.id=x.partner_id left join shops s on s.id=x.shop_id where x.id=o.id;

  esc := app.acct('escrow'); pay := app.acct('partner_payable', supply);
  hb  := app.acct('holdback', supply); feeA := app.acct('platform_fee');
  gstA := app.acct('platform_gst'); cust := app.acct('user_wallet', o.customer_id);

  t := app.post_txn('escrow_release', o.id, p_idem||':rel', p_reason,
        (select jsonb_agg(l) from (
          select jsonb_build_object('acct',esc,'dir','credit','amt',h.amount_paise) as l
          union all select jsonb_build_object('acct',pay, 'dir','debit','amt',payout-hold) where payout-hold > 0
          union all select jsonb_build_object('acct',hb,  'dir','debit','amt',hold)        where hold   > 0
          union all select jsonb_build_object('acct',feeA,'dir','debit','amt',fee)         where fee    > 0
          union all select jsonb_build_object('acct',gstA,'dir','debit','amt',gst)         where gst    > 0
          union all select jsonb_build_object('acct',cust,'dir','debit','amt',refund)      where refund > 0
        ) legs));

  update escrow_holds set status = case when refund=0 then 'released' else 'partial' end,
         released_paise=payout+uplift, refunded_paise=refund, closed_at=now() where id=h.id;
  update orders set status='settled', payout_paise=payout, holdback_paise=hold,
         refund_paise=refund, settled_at=now(), auto_release_at=null, updated_at=now()
   where id=o.id;
  update partners set jobs_completed=jobs_completed+1, last_active_at=now() where id=o.partner_id;
  perform app.log_event(o.id,o.status,'settled',p_reason,
    jsonb_build_object('payout',payout,'holdback',hold,'refund',refund,'txn',t));
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'payout_paise',payout,
    'holdback_paise',hold,'refund_paise',refund,'txn_id',t));
end $$;

-- 8. REFUND / CANCEL -------------------------------------------------
create or replace function public.refund_escrow(
  p_order_id uuid, p_refund_paise bigint default null,
  p_compensation_paise bigint default 0, p_reason text default 'cancelled',
  p_idem text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; o orders; h escrow_holds; t uuid; amt bigint; comp bigint; keep bigint;
        supply uuid; esc uuid; cust uuid; pay uuid; feeA uuid; is_cron boolean;
begin
  v := app.begin_idem(p_idem,'refund_escrow'); if v is not null then return v; end if;
  is_cron := (auth.uid() is null);
  select * into o from orders where id=p_order_id for update;
  select * into h from escrow_holds where order_id=p_order_id and status in ('held','disputed','frozen') for update;
  if not found then raise exception 'no open escrow' using errcode='P0002'; end if;
  if not (is_cron or app.is_admin() or o.customer_id=auth.uid()) then
    raise exception 'not authorised' using errcode='42501'; end if;

  amt  := coalesce(p_refund_paise, h.amount_paise);
  comp := coalesce(p_compensation_paise, 0);
  keep := h.amount_paise - amt - comp;
  if amt < 0 or comp < 0 or keep < 0 then
    raise exception 'refund + compensation exceeds the hold' using errcode='22023'; end if;

  select coalesce(p.user_id,s.owner_id) into supply from orders x
    left join partners p on p.id=x.partner_id left join shops s on s.id=x.shop_id where x.id=o.id;
  esc := app.acct('escrow'); cust := app.acct('user_wallet', o.customer_id);
  pay := app.acct('partner_payable', supply); feeA := app.acct('platform_fee');

  t := app.post_txn('escrow_refund', o.id, p_idem||':ref', p_reason,
        (select jsonb_agg(l) from (
          select jsonb_build_object('acct',esc,'dir','credit','amt',h.amount_paise) as l
          union all select jsonb_build_object('acct',cust,'dir','debit','amt',amt)  where amt  > 0
          union all select jsonb_build_object('acct',pay, 'dir','debit','amt',comp) where comp > 0
          union all select jsonb_build_object('acct',feeA,'dir','debit','amt',keep) where keep > 0
        ) legs));

  update escrow_holds set status='refunded', refunded_paise=amt, released_paise=comp+keep,
         closed_at=now() where id=h.id;
  update orders set status = case when amt = h.amount_paise then 'refunded' else 'cancelled' end,
         refund_paise=amt, payout_paise=comp, cancel_reason=p_reason,
         cancelled_at=now(), auto_release_at=null, updated_at=now() where id=o.id;
  perform app.log_event(o.id,o.status,'refunded',p_reason,jsonb_build_object('refund',amt,'comp',comp));
  return app.end_idem(p_idem, jsonb_build_object('ok',true,'refunded_paise',amt,'txn_id',t));
end $$;

-- 9. RECONCILE — the invariant that must never be false --------------
create or replace function public.reconcile() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare total bigint; escrow bigint; drift record; bad int := 0; res jsonb;
begin
  if not (auth.uid() is null or app.is_admin()) then
    raise exception 'admin only' using errcode='42501'; end if;

  select coalesce(sum(signed_paise),0) into total from ledger_entries;
  select coalesce(sum(ab.balance_paise),0) into escrow from account_balances ab
    join ledger_accounts la on la.id=ab.account_id where la.kind='escrow';
  for drift in
    select ab.account_id, ab.balance_paise,
           (select coalesce(sum(signed_paise),0) from ledger_entries e where e.account_id=ab.account_id) as replayed
      from account_balances ab
  loop
    if drift.balance_paise <> drift.replayed then bad := bad + 1; end if;
  end loop;

  res := jsonb_build_object('ok', total = 0 and bad = 0,
           'book_total_paise', total, 'escrow_paise', escrow, 'drifted_accounts', bad,
           'checked_at', now());
  insert into audit_log(action,entity,detail,severity)
    values ('ledger.reconcile','ledger',res, case when total=0 and bad=0 then 'info' else 'critical' end);
  return res;
end $$;

-- ============================================================
-- RLS — deny by default, then open the narrowest possible slice
-- ============================================================
alter table profiles enable row level security;
alter table partners enable row level security;
alter table shops enable row level security;
alter table products enable row level security;
alter table categories enable row level security;
alter table app_config enable row level security;
alter table service_requests enable row level security;
alter table bids enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_events enable row level security;
alter table ledger_accounts enable row level security;
alter table ledger_txns enable row level security;
alter table ledger_entries enable row level security;
alter table account_balances enable row level security;
alter table escrow_holds enable row level security;
alter table otp_codes enable row level security;
alter table otp_rate_limit enable row level security;
alter table disputes enable row level security;
alter table safety_incidents enable row level security;
alter table reviews enable row level security;
alter table chat_messages enable row level security;
alter table audit_log enable row level security;
alter table rpc_calls enable row level security;
alter table keepalive enable row level security;

alter table ledger_entries   force row level security;
alter table ledger_txns      force row level security;
alter table escrow_holds     force row level security;
alter table account_balances force row level security;
alter table otp_codes        force row level security;

-- public reference data
create policy cfg_read on app_config  for select to anon, authenticated using (is_public or app.is_admin());
create policy cat_read on categories  for select to anon, authenticated using (is_active or app.is_admin());
create policy ka_read  on keepalive   for select to anon, authenticated using (true);

-- profiles: yourself, or a counterparty on a live order
create policy prof_self on profiles for select to authenticated
  using (id = auth.uid() or app.is_admin());
create policy prof_party on profiles for select to authenticated using (exists (
  select 1 from orders o left join partners p on p.id=o.partner_id left join shops s on s.id=o.shop_id
  where o.status in ('accepted','escrow_held','in_progress','delivered','verified','disputed')
    and ((o.customer_id=auth.uid() and (p.user_id=profiles.id or s.owner_id=profiles.id))
      or (profiles.id=o.customer_id and (p.user_id=auth.uid() or s.owner_id=auth.uid())))));
create policy prof_insert on profiles for insert to authenticated
  with check (id = auth.uid() and role in ('customer','partner','shop'));
create policy prof_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- WITH CHECK alone cannot stop a column change; this trigger can.
-- Without it a partner updates their own row to kyc='approved'.
create or replace function app.guard_profile() returns trigger
language plpgsql as $$
begin
  if app.is_admin() then return new; end if;
  new.role := old.role; new.trust_score := old.trust_score; new.tier := old.tier;
  new.is_banned := old.is_banned; new.banned_reason := old.banned_reason;
  new.phone_verified := old.phone_verified;
  if new.phone is distinct from old.phone then new.phone_verified := false; end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles for each row execute function app.guard_profile();

create policy part_read on partners for select to anon, authenticated
  using (kyc='approved' or user_id=auth.uid() or app.is_admin());
create policy part_insert on partners for insert to authenticated with check (user_id=auth.uid());
create policy part_update on partners for update to authenticated
  using (user_id=auth.uid()) with check (user_id=auth.uid());
create or replace function app.guard_partner() returns trigger
language plpgsql as $$
begin
  if app.is_admin() then return new; end if;
  new.kyc := old.kyc; new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  new.rating_avg := old.rating_avg; new.rating_count := old.rating_count;
  new.jobs_completed := old.jobs_completed; new.disputes_lost := old.disputes_lost;
  return new;
end $$;
create trigger partners_guard before update on partners for each row execute function app.guard_partner();

create policy shop_read on shops for select to anon, authenticated
  using (kyc='approved' or owner_id=auth.uid() or app.is_admin());
create policy shop_own on shops for all to authenticated
  using (owner_id=auth.uid()) with check (owner_id=auth.uid());

create policy prod_read on products for select to anon, authenticated
  using (is_active and exists (select 1 from shops s where s.id=products.shop_id and s.kyc='approved'));
create policy prod_own on products for all to authenticated
  using (exists (select 1 from shops s where s.id=products.shop_id and s.owner_id=auth.uid()))
  with check (exists (select 1 from shops s where s.id=products.shop_id and s.owner_id=auth.uid()));

-- service requests: the requester sees everything; a bidding partner sees the
-- row but NOT the PII columns (column grants below do that work).
create policy sr_own on service_requests for select to authenticated
  using (customer_id=auth.uid() or app.is_admin());
create policy sr_feed on service_requests for select to authenticated using (
  status='bidding' and closes_at > now() and exists (
    select 1 from partners p where p.user_id=auth.uid() and p.kyc='approved'
      and p.category_key = service_requests.category_key
      and service_requests.area = any(p.service_areas)));
create policy sr_awarded on service_requests for select to authenticated using (
  status='awarded' and exists (select 1 from orders o join partners p on p.id=o.partner_id
    where o.request_id=service_requests.id and p.user_id=auth.uid()
      and o.status not in ('cancelled','refunded')));
create policy sr_insert on service_requests for insert to authenticated
  with check (customer_id=auth.uid()
    and (select (value#>>'{}')::boolean from app_config where key='kill_switch_new_orders') = false);

revoke all on service_requests from anon, authenticated;
grant select (id,category_key,area,title,details,chips,photos,complexity,beff_paise,
              floor_paise,target_paise,ceiling_paise,budget_band,slot_type,scheduled_for,
              status,bid_count,invited_count,opened_at,closes_at,hold_until,customer_id,created_at)
  on service_requests to authenticated;      -- address_line / contact_phone NOT granted
grant insert on service_requests to authenticated;

-- BIDS: the leak that would kill the auction. A bidder sees ONLY their own
-- bid; the requester sees all bids on their own request. Nobody else, ever.
create policy bid_own on bids for select to authenticated
  using (partner_id = app.my_partner_id());
create policy bid_requester on bids for select to authenticated using (exists (
  select 1 from service_requests r where r.id=bids.request_id and r.customer_id=auth.uid()));
create policy bid_admin on bids for select to authenticated using (app.is_admin());
revoke insert, update, delete on bids from anon, authenticated;

create policy ord_party on orders for select to authenticated
  using (app.is_order_party(id) or app.is_admin());
revoke insert, update, delete on orders from anon, authenticated;

create policy oi_party on order_items for select to authenticated
  using (app.is_order_party(order_id) or app.is_admin());
create policy oe_party on order_events for select to authenticated
  using (app.is_order_party(order_id) or app.is_admin());
revoke insert, update, delete on order_items, order_events from anon, authenticated;

-- money: SELECT-only, and only your own slice
create policy acct_own on ledger_accounts for select to authenticated
  using (owner_id=auth.uid() or app.is_admin());
create policy bal_own on account_balances for select to authenticated using (exists (
  select 1 from ledger_accounts a where a.id=account_balances.account_id
    and (a.owner_id=auth.uid() or app.is_admin())));
create policy entry_own on ledger_entries for select to authenticated using (
  app.is_admin()
  or exists (select 1 from ledger_accounts a where a.id=ledger_entries.account_id and a.owner_id=auth.uid())
  or (ledger_entries.order_id is not null and app.is_order_party(ledger_entries.order_id)));
create policy txn_party on ledger_txns for select to authenticated
  using (app.is_admin() or (order_id is not null and app.is_order_party(order_id)));
create policy esc_party on escrow_holds for select to authenticated
  using (app.is_order_party(order_id) or app.is_admin());
revoke insert, update, delete on
  ledger_accounts, ledger_txns, ledger_entries, account_balances, escrow_holds
  from anon, authenticated;

-- OTP: no policies at all. RLS denies by default, so the table is reachable
-- ONLY through issue_otp / verify_otp. A worker can never read the customer's code.
revoke all on otp_codes, otp_rate_limit from anon, authenticated;

create policy disp_party on disputes for select to authenticated
  using (app.is_order_party(order_id) or app.is_admin());
create policy disp_insert on disputes for insert to authenticated
  with check (raised_by=auth.uid() and app.is_order_party(order_id)
              and status='open' and refund_paise=0 and release_paise=0);
create policy disp_admin on disputes for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy inc_own on safety_incidents for select to authenticated
  using (reported_by=auth.uid() or app.is_admin());
create policy inc_insert on safety_incidents for insert to authenticated
  with check (reported_by=auth.uid());

create policy rev_read on reviews for select to anon, authenticated
  using (not is_hidden or author_id=auth.uid() or app.is_admin());
create policy rev_insert on reviews for insert to authenticated with check (
  author_id=auth.uid() and exists (select 1 from orders o where o.id=reviews.order_id
    and o.customer_id=auth.uid() and o.status in ('settled','verified')));

create policy chat_party on chat_messages for select to authenticated
  using (app.is_order_party(order_id) or app.is_admin());
create policy chat_send on chat_messages for insert to authenticated
  with check (sender_id=auth.uid() and app.is_order_party(order_id));

create policy audit_admin on audit_log for select to authenticated using (app.is_admin());
create policy rpc_admin   on rpc_calls for select to authenticated using (app.is_admin());
revoke insert, update, delete on audit_log, rpc_calls from anon, authenticated;

-- ---------- grants --------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.place_bid(uuid,bigint,int,text,text,text),
  public.accept_bid(uuid,text),
  public.lock_escrow(uuid,text),
  public.issue_otp(uuid,otp_stage,text),
  public.verify_otp(uuid,otp_stage,text,double precision,double precision,text),
  public.submit_completion(uuid,text[],text),
  public.release_escrow(uuid,numeric,text,text),
  public.refund_escrow(uuid,bigint,bigint,text,text)
to authenticated;
grant execute on function public.reconcile() to authenticated;
