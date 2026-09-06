# SAAHAA — ₹0 Launch Plan (full free tier, no card, no money)

Everything below is genuinely free. No credit card is asked at any step.

---

## What you already have (₹0, done)

- **App**: single-file `index.html` + PWA (`manifest.json`, `sw.js`, `icon.svg`) — no server code needed, so the *cheapest possible* hosting (static) works.
- **Version control**: local git repo, commit tagged `saahaa-version01`.
- **Backups**: `C:\Users\siidhu\saahaa-version01\` (folder) and `C:\Users\siidhu\saahaa-version01.zip`.

## Step 1 — GitHub (free, ~10 min) → code safe in the cloud

1. Create account at github.com (free).
2. New repository → name it `saahaa` → **Public** (private also free, but Pages needs public on free tier).
3. On this laptop:
   ```
   cd C:\Users\siidhu\saahaa
   git remote add origin https://github.com/<your-username>/saahaa.git
   git push -u origin main --tags
   ```

## Step 2 — GitHub Pages (free, ~2 min) → live URL for any phone

Repo → **Settings → Pages** → Source: `main` branch, root folder → Save.

Your app goes live at:
`https://<your-username>.github.io/saahaa/`

- 100% free forever, no card, no sleep/pause, HTTPS included.
- HTTPS means the **service worker activates** → "Add to Home Screen" installs SAAHAA as a real app icon on any phone.
- Why Pages and not Vercel? Vercel's free "Hobby" plan forbids commercial use in its terms; GitHub Pages has no such trap for a static site. (Vercel remains a fine option for testing.)

## Step 3 — Supabase (free tier) → real shared accounts & sandbox

The one thing localStorage can't do: visitors who sign up on *their* phone appearing in *your* admin sandbox. Supabase free tier fixes that:

- Free: 500 MB database, 50k monthly active users of auth, unlimited API requests within fair use.
- Catch: free projects **pause after ~1 week of no traffic** — one visit un-pauses; fine at this stage.
- What moves to Supabase: `visitors` table, `deals` table, auth (name + mobile as identity, **no SMS OTP** — SMS costs money everywhere; add WhatsApp/SMS OTP only after revenue).

Ask Claude: "wire SAAHAA to Supabase" once the account exists — the app changes needed are small and stay in one file.

## Step 4 — Sharing without a domain (₹0)

Skip Namecheap (₹800/yr) for now. The `github.io` link is shareable on WhatsApp,
printable as a QR code (free generators), and installable as an app.
Buy `saahaa.in` only when strangers are using it weekly.

## Step 5 — Payments (₹0 until real revenue)

- Razorpay **test mode** is free — full checkout flow with fake money, good for walkthroughs.
- Going live needs KYC (PAN + bank) and ~2% per transaction — but that's *after* money exists.
- Until then: the app's escrow/OTP flow settles in-app until the payment rail is wired; workers/customers settle in cash or UPI directly (UPI is ₹0).

## What to deliberately NOT set up yet (saves money AND time)

| Tool | Verdict |
|---|---|
| Clerk | Skip — Supabase auth covers it |
| Pinecone | Skip — vector DB, irrelevant to SAAHAA |
| Upstash Redis | Skip — no queue/cache need yet |
| Resend | Skip — no emails to send yet |
| PostHog / Sentry | Skip — admin sandbox already reports; add when >100 real users |
| Namecheap domain | Defer — the only item on that list that costs money |

**Running total: ₹0.**

---

## Order of operations (do them in this order)

1. GitHub account → push (Step 1) — *your code is now un-losable*
2. GitHub Pages (Step 2) — *anyone's phone can install SAAHAA today*
3. Show it to 5 real people, watch the sandbox
4. Supabase (Step 3) — *only once people beyond your own devices matter*
5. Domain + Razorpay live — *only once money is actually moving*
