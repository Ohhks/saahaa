# SAAHAA — first-time setup

Do this **once**. About 45 minutes. Don't do it tired, and don't skip steps.

Everything here is free. No credit card is asked at any point.

---

## Part A — GitHub repository (once)

Your remote is already configured as `https://github.com/Ohhks/saahaa.git`, but
**that repository does not exist yet** — a push will fail with "Repository not
found" until you create it.

1. Go to **github.com** and sign in as `Ohhks`.
2. Top-right **+** → **New repository**.
3. Repository name: `saahaa` (exactly).
4. Select **Public**.
   > This is deliberate. Public repos get **unlimited free Actions minutes**;
   > private ones get 2,000/month. Your built app is public anyway, and no
   > secret lives in this repo.
5. Do **not** tick "Add a README", ".gitignore" or "license" — you already have files.
6. **Create repository**.
7. Back in PowerShell, in `C:\Users\siidhu\saahaa`:

```bash
git push -u origin main --tags
```

Sign in when the browser window pops up. Refresh GitHub — your files are there.

## Part B — turn on Pages

8. Repo → **Settings** (top bar).
9. Left sidebar → **Pages**.
10. Under **Build and deployment → Source**, choose **GitHub Actions**.
    > NOT "Deploy from a branch". This is the step people get wrong. Actions
    > deploy is what lets CI block a broken build, and it is what makes
    > rollback a button.
11. No save button — it applies immediately.

## Part C — Supabase project

12. **supabase.com** → **Start your project** → sign in with GitHub.
13. **New project**. Name: `saahaa-prod`.
14. Database password → **Generate a password**, then **paste it into your
    password manager immediately**. You are not shown it again and it cannot be
    recovered.
15. Region: **South Asia (Mumbai)** — closest to Hyderabad.
16. Plan: **Free**. Create. Wait ~2 minutes.

### Run the migrations, in order

17. Left sidebar → **SQL Editor** → **New query**.
18. Open `supabase/migrations/0001_schema.sql` from your repo, copy all of it,
    paste, **Run**.
19. Same with `0002_money_rls.sql`, then `0003_automation.sql`. **Order matters.**
20. Set the OTP pepper — **this is the single most important line in the whole
    setup**. Without it, a leaked code hash is brute-forced in milliseconds,
    because a 6-digit code is only a million possibilities:

```sql
alter database postgres set app.otp_pepper = 'PASTE_32_RANDOM_CHARACTERS_HERE';
```

Generate the value with `python -c "import secrets;print(secrets.token_urlsafe(32))"`
and store it in your password manager. Then, in SQL Editor, run
`select pg_reload_conf();` and confirm with `show app.otp_pepper;`.

21. Enable the cron extension: **Database → Extensions** → search `pg_cron` →
    enable. Then re-run the `select cron.schedule(...)` block at the bottom of
    `0003_automation.sql`.

### Get your keys

22. **Project Settings** (gear) → **API**. Three things:
    - **Project URL** — `https://xxxx.supabase.co`
    - **`anon` `public`** key — starts `eyJ…`. **Safe to ship in the app.**
      It authorises nothing on its own; Row Level Security decides everything.
    - **`service_role` `secret`** key — also starts `eyJ…`. **This is a master
      key that bypasses all security.** Put it in your password manager and
      **nowhere else** — not in the code, not in a chat, not in a screenshot.
      Nothing in this project needs it.

## Part D — connect the app

23. Open `src/core/config.js` and fill in `BAKED`:

```js
const BAKED = {
  url:     'https://xxxx.supabase.co',
  anonKey: 'eyJ...your anon key...',
};
```

24. Commit and push:

```bash
git add src/core/config.js && git commit -m "chore: connect Supabase" && git push
```

> You can also skip this and test first by opening the live site with
> `?sb=https://xxxx.supabase.co&key=eyJ...` once — it stores locally.

## Part E — Actions secrets (for the keepalive only)

25. Repo → **Settings** → **Secrets and variables** → **Actions**.
26. **New repository secret** → name `SUPABASE_URL` → paste the project URL → Add.
27. **New repository secret** → name `SUPABASE_ANON_KEY` → paste the anon key → Add.
28. **Do NOT add the service_role key.** Nothing uses it. A secret that exists
    is a secret that can leak.

## Part F — verify

29. Repo → **Actions**. Watch **CI** and **Deploy to Pages** run. Both green.
30. Settings → Pages shows your live URL: `https://ohhks.github.io/saahaa/`.
    **Bookmark it.**
31. Open it in a **private window**. Add `?selftest=1` — all tests must pass.
32. Actions → **Supabase Keepalive** → **Run workflow**. It must go green.
    If it fails, step 18 or 26/27 went wrong. Fix it now — this is the job that
    stops your project pausing and your escrow silently freezing.

33. Bookmark three URLs in a folder called **SAAHAA OPS**:
    - `github.com/Ohhks/saahaa/actions` — deploys and rollback
    - your Supabase **SQL Editor** — database rollback
    - `ohhks.github.io/saahaa/` — the live site

**Done. You never repeat Parts A–E.**

---

## Rollback — read this before you need it

### Bad frontend deploy — about 40 seconds
1. **Actions** tab
2. **Deploy to Pages** in the left sidebar
3. Open the last **green** run from *before* the bad one
4. Top right → **Re-run all jobs**

That's it. No git. Check the result in a **private window** — your own browser
cache will otherwise show you the broken version and send you round the loop again.

**If the site is broken and you cannot think:** Settings → Pages → Source →
**None**. The site goes offline in ~30 seconds. A dead site beats a site taking
bad orders. Turn it back on when calm.

### Bad database migration — about 3 minutes
There is no re-run button, which is exactly why applying migrations is manual.

- **Additive changes** (`add column`) reverse trivially with `drop column`,
  as long as nothing has written to it yet.
- **Destructive changes are not reversible on the free tier.** There is no
  point-in-time recovery. So the standing rule is: **never drop. Rename to
  `_deprecated_<name>` and delete it a month later.**
- Before any migration that touches existing data, run this first — it takes
  two seconds and turns an unrecoverable event into a ten-second fix:

```sql
create table backup_orders_20260901 as select * from orders;
```

---

## What stays manual, forever

| Never automated | Why |
|---|---|
| Applying a migration to production | Free tier has no point-in-time recovery |
| A partner's first in-home job approval | One bad actor in a home ends the business |
| Any safety, harassment or injury report | Needs a human in minutes, possibly the police |
| Permanent bans | Irreversible action against someone's livelihood |
| Fee and commission changes | Silently breaks every open order at once |

Everything else is either fully automatic or waits for you in one screen.
See [AUTOMATION.md](AUTOMATION.md).
