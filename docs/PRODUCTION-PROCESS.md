# SAAHAA — from here to production, step by step

*Why any of this matters: [docs/PROBLEM.md](PROBLEM.md) — the real-world problem SAAHAA solves.*

One person, in order. Each step says what it produces and what it unblocks.
Steps 1–5 are today. Steps 6–12 are the first two weeks. Step 13 is forever.

## Phase A — the site is live (today, ~1 hour)

1. **Create the repository.** github.com/new → `Ohhks/saahaa`, public, empty.
   Then `git push -u origin main --tags`. *Unblocks: CI, Pages, releases.*
2. **Pages via Actions.** Settings → Pages → Source: GitHub Actions.
   `deploy.yml` publishes `dist/`. *Produces: a public URL.*
3. **Protect `main`.** Settings → Branches → require the CI check.
   *Produces: nothing broken can land.*
4. **First open on the live URL.** Admin → System & audit → change the demo
   password. Run the in-app self-test (107). Verify chain → ₹0.
5. **Hand-check on your phone and a laptop**: sign up as a customer, open a
   category, book, cancel; sign up as a partner, run the seven steps; open
   the admin. Ten minutes. *Produces: confidence the deploy is the app you
   tested.*

## Phase B — real data, real money (week 1)

6. **Supabase project** (free): apply `supabase/migrations/0001_schema.sql`,
   `0002_money_rls.sql`, `0003_automation.sql` in order; paste the anon key
   into `src/core/config.js`; follow `docs/SETUP.md`. *Produces: accounts and
   orders that survive a phone change; RLS deny-by-default; money mutations
   only through SECURITY DEFINER RPCs.*
7. **Payment collection, UPI only** (`docs/PRODUCTION.md` §2): Razorpay or
   Cashfree, collect-to-escrow, 0% MDR. Webhooks → Cloudflare Worker (§4)
   → the RPCs. Do not enable cards until a full UPI cycle (book → release →
   payout) has run with your own ₹100. *Produces: real escrow.*
8. **Partner payouts**: the Finance → Mark paid step becomes a UPI batch
   (penny-drop verification of each UPI id first). *Produces: pros are paid
   by rail, not by hand.*
9. **SMS OTP** for step 1 of verification and the arrival code (any
   DLT-registered sender). Until then the code shows on screen and the app
   says so. *Produces: the ladder is real end to end.*
10. **Tax**: GST registration for the platform fee (18% of the fee is
    remitted, already computed per order); TDS u/s 194-O on partner payouts
    (`docs/PRODUCTION.md` §3). *Produces: nothing that can make you
    loss-making later.*

## Phase C — supply, then demand (week 2)

11. **Ten pros, in person.** Two per category across plumbing, electrical,
    AC, cleaning, repair. Walk each through the seven steps on their own
    phone; it takes ten minutes and needs nothing from you until a background
    check lands in Approvals. Give each their page link. *Produces: the
    ask-rates auction has enough supply (≥ 8) in the launch categories.*
12. **Three shops.** The ready-list picker fills a catalogue in minutes; set
    minimum order and delivery mode. First 30 orders are fee-free. *Produces:
    a reason for a customer to open the app twice a week, not twice a year.*
13. **First fifty customers**: one pincode, the pros' own WhatsApp lists,
    the storefront links. Do not advertise beyond one area until the
    thin-auction rate (< 2 replies) is under 20% there.

## Phase D — the operating rhythm (forever)

- **Four minutes a day** in Admin: Approvals (call the reference first),
  Bookings & escrow (anything on HOLD older than a day; a stalled shop order →
  refund in full), Finance (Mark paid after each batch; Verify chain must read
  ₹0).
- **Every change**: `node tools/test-node.mjs` → `bash tools/preflight.sh` →
  push. CI verifies, Pages deploys, users get the *"update is ready"* toast.
  No maintenance window, ever (`docs/DEVOPS.md`).
- **Every risky change** behind a flag, off by default, on for you first.
- **Every release** a tag with a CHANGELOG section. An untagged release
  cannot be rolled back and is therefore not a release.
- **When something is wrong**: System & audit → flags (kill switch) →
  Snapshot → then look. Never edit data first.

## What is already done (so you do not redo it)

Engine, money (integer paise, double-entry, hash-chained, reconciles to
zero), the P2P auction, the verification ladder, the worker wallet and
commitment stake, retail with substitutions / pickup / returns, the admin
command center, the design system, the deck, CI/CD workflows, migrations,
the engine guard, and 107 tests — all in this repository, all tagged.
