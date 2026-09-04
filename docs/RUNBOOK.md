# SAAHAA runbook

What to do when something is wrong. Written to be read while panicking.

**Bookmark these three, in a folder called SAAHAA OPS:**

| | |
|---|---|
| Deploys and rollback | `github.com/Ohhks/saahaa/actions` |
| Database rollback | your Supabase project → **SQL Editor** |
| The live site | `ohhks.github.io/saahaa/` |

---

## 1. The site is broken after a deploy

**40 seconds. No git required.**

1. **Actions** tab
2. **Deploy to Pages** in the left sidebar
3. Open the last run with a **green tick**, from *before* the bad one
4. Top right → **Re-run all jobs**

Then check the result **in a private/incognito window**. Your own browser cache
will otherwise keep showing you the broken version, and you will roll back three
more times chasing a cached page.

**Still broken, and you cannot think straight:**
Settings → Pages → Source → **None**. The site goes offline in ~30 seconds.
A dead site beats a site taking bad orders. Turn it back on when calm.

**To go back to a specific released version:**
Actions → Deploy to Pages → **Run workflow** → pick the tag (`v6.1.0`) → Run.

---

## 2. A migration broke the database

There is no re-run button here. That is exactly why migrations are applied by
hand — the free tier has **no point-in-time recovery**.

**Before you ever run a migration that touches existing data:**

```sql
create table backup_orders_20260902 as select * from orders;
```

Two seconds, and it turns an unrecoverable event into a ten-second fix.

**To undo:**
- Added a column → `alter table X drop column Y;` (safe if nothing wrote to it)
- Renamed something → rename it back
- **Dropped something → the data is gone.** This is why the standing rule is
  *never drop; rename to `_deprecated_<name>` and delete it a month later.*

**To restore from your backup table:**
```sql
insert into orders select * from backup_orders_20260902
  on conflict (id) do nothing;
```

---

## 3. Supabase paused, or the site cannot reach the database

**Symptom:** the app loads but shows no shops, or every action fails.

A free project pauses after ~7 days of no traffic, **and its cron jobs stop
with it** — which means escrow silently stops auto-releasing.

1. Open the Supabase dashboard. If it says paused, click **Restore**. Takes ~2 minutes.
2. Actions → **Supabase Keepalive** → check whether it has been failing.
   If it has, that is the root cause: fix the secrets (Settings → Secrets →
   Actions → `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
3. Once restored, run this to catch up anything the cron missed:

```sql
select app.job_close_auctions(), app.job_expire_bids(),
       app.job_auto_release(), app.job_no_show();
```

Every job uses a deterministic idempotency key, so running them late — or twice
— cannot double-release money.

---

## 4. The ledger does not balance

**This is the most serious alert in the system.** It means money has been
created or destroyed somewhere.

The nightly reconciliation freezes new bookings automatically and writes a
`ledger.FROZEN` row to the audit log. **Do not un-freeze it to "get trading
again".**

1. See the damage:
```sql
select public.reconcile();
```
2. Find where it diverged:
```sql
select la.kind, la.owner_id, ab.balance_paise,
       (select coalesce(sum(signed_paise),0) from ledger_entries e
         where e.account_id = ab.account_id) as replayed
  from account_balances ab join ledger_accounts la on la.id = ab.account_id
 where ab.balance_paise <> (select coalesce(sum(signed_paise),0)
                              from ledger_entries e where e.account_id = ab.account_id);
```
3. **Never edit `ledger_entries`.** It is append-only and the triggers will
   refuse you. Correct a mistake with a *reversing* entry, so the history still
   tells the truth.
4. Only after the cause is understood:
```sql
update app_config set value='false'::jsonb where key='kill_switch_new_orders';
```

**Never auto-repair a ledger.** An auto-repair is indistinguishable from an
attacker covering their tracks.

---

## 5. A safety report comes in

Harassment, theft, injury, threat. This is not a dispute and does not go in the
dispute queue.

1. **Suspend the partner immediately** — before investigating:
```sql
update partners set kyc='suspended' where id = '<partner-id>';
update profiles set is_banned = true, banned_reason = 'safety report under review'
 where id = (select user_id from partners where id = '<partner-id>');
```
2. **Freeze that order's money:**
```sql
update escrow_holds set status='frozen' where order_id = '<order-id>';
```
3. **Call the customer.** Not a message. A call.
4. Write down what happened, with times, in `safety_incidents.action_taken`.
   Set `legal_hold = true` so nothing about that order is ever auto-purged.
5. If there is any suggestion of a crime, tell the customer plainly that they
   can go to the police and that you will provide the booking record.

Do not offer a refund as the first response. It reads as buying silence.

---

## 6. Stop everything

The single switch that stops new money entering while letting in-flight orders
finish and settle:

```sql
update app_config set value='true'::jsonb where key='kill_switch_new_orders';
```

Use it for: a ledger failure, a safety incident you are still handling, a
security worry, or **your exam weeks**. In-flight orders still complete; no new
ones start.

To resume, set it back to `'false'`.

---

## 7. Someone reports a bug you cannot reproduce

1. Ask which page, and get a screenshot showing the version in the footer.
2. Open the site with `?selftest=1` — if any of the 87 tests fail, start there.
3. Admin → System & audit → **Health**. A red row names the problem.
4. Check the audit log for their action around that time.
5. If their local data is corrupt, the fix is Admin → System → **Restore
   backup**, or as a last resort ask them to clear site data — which loses
   their local session but never their orders, because those live in Postgres.

---

## 8. Before you touch anything

```bash
node tools/test-node.mjs      # 87 tests, ~1 second
python tools/build.py --site  # rebuild + relint + restamp cache-busters
bash tools/preflight.sh       # the gate CI runs
```

If all three pass, the change is safe to push. If any fail, CI would have
blocked it anyway — that is the point.
