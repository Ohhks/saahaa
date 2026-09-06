# What runs itself, and what waits for you

One person runs this business, alongside a job hunt and an SSC CGL exam. So the
scarcest resource in the whole system is **your attention**, and the automation
boundary is drawn to protect it.

Target: **15 minutes a day.** If the queue routinely exceeds 20 items, the
thresholds are wrong — not you.

Legend: **AUTO** = happens with no human · **ALERT** = happens, then tells you ·
**YOU DECIDE** = system prepares it, you tap · **YOU ONLY** = you do the work.

---

## Onboarding

| Task | Verdict | Trigger / escalation |
|---|---|---|
| Customer signup | AUTO | 5 accounts from one device in 24h → flag |
| Partner registration + documents | AUTO | Unapproved partners simply receive no jobs |
| Duplicate document detection | AUTO | Same document hash on two partners → you decide |
| **A partner's first in-home job** | **YOU ONLY** | Never automated. Letting an unvetted stranger into someone's home is the single largest liability in this business, and no free signal predicts it. |
| Extra categories for an existing partner | ALERT | Trust ≥70, 5+ jobs, zero disputes. Electrical / childcare / elder care → you decide regardless of score |
| Tier promotion 1→2 | AUTO | The seven-step ladder. Nothing reaches you. |
| **Tier 3 · Background Checked** | **AUTO** | Peer-to-peer verification (rules below): real jobs, rating, no upheld dispute, vouches, the reference's code. Kill switch and dials at Admin → Approvals → Automation |
| **Tier 4 · Certified** | **AUTO** | 25 jobs, rating ≥ 4.6, 0 upheld, 14 days at tier 3, no open dispute. You can still award or suspend by hand |
| Tier demotion | ALERT | 2 no-shows in 7 days, or dispute rate >15% |

## Listings

| Task | Verdict | Trigger / escalation |
|---|---|---|
| A new shop's **first 5 SKUs** | YOU DECIDE | One screen, 60 seconds. You moderate the *seller*, once. |
| Every SKU after that | AUTO | Price >3× or <0.3× the category median → held |
| Price above MRP | **BLOCKED** | Rejected by a database constraint. It is illegal under Legal Metrology, and letting shops do it quietly is how price trust dies. |
| Stock-out hiding | AUTO | Auto-hides at zero |
| Dormant listing cleanup | AUTO | No update in 45 days, seller warned first |

## Matching and bidding

| Task | Verdict | Trigger / escalation |
|---|---|---|
| Instant locked-match | AUTO | No pro in radius → widen, then "we'll call you" + alert |
| Auction invites, in waves of 4 every 3 min | AUTO | Max 12 invited |
| Bid band enforcement (floor / ceiling) | AUTO | Enforced in SQL, not the browser |
| Bid scoring and ranking | AUTO | — |
| Auction close, bid expiry | AUTO | `pg_cron`, every minute |
| Zero bids after 12 minutes | AUTO | Falls back to fixed-price instant, and logs a **supply gap** |
| Counter-offer | AUTO | Only available against a bid *above* fair price. One per request, ever. |

## Money

| Task | Verdict | Trigger / escalation |
|---|---|---|
| Escrow lock at booking | AUTO | — |
| **Escrow auto-release** | AUTO | Target **85% zero-touch**: evidence on file, code verified, no dispute, timer elapsed |
| Held for review | YOU DECIDE | >₹10,000, or trust <55, or fewer than 3 jobs, **or no photo** |
| Refund ≤ ₹500 | AUTO | Cumulative caps then escalate |
| Refund > ₹500 | YOU DECIDE | — |
| Holdback maturity (7 clean days) | AUTO | — |
| Nightly reconciliation | AUTO | **Any drift → payouts freeze and you get a critical alert.** Never auto-repaired: an auto-repair is indistinguishable from an attacker covering their tracks. |
| Customer wallet top-up / take-out | AUTO | Through `core/gateway.js`, the one door money uses. In `MODE 'sim'` it is a sandbox UPI, labelled so on the screen and on the ledger leg |
| Refund → the customer's wallet | AUTO | A refund lands in `CUSTOMER:<key>`, spendable on the next order or taken out to UPI |
| **Withdraw fees / Remit GST** | **YOU ONLY** | Admin → Finance → Treasury. Never more than earned / held; the password again; audited (`treasury.withdraw`, `treasury.remitGst`) |
| **Fee / delivery-band changes** | **YOU ONLY** | Admin → **Charges** → set the service %, the retail %, the delivery bands → **Push**. Effective on every quote made afterwards; orders already booked keep the fees they were booked with, so nothing in escrow reprices. Audited with who and when. |

## Disputes and safety

| Task | Verdict | Trigger / escalation |
|---|---|---|
| Dispute intake + escrow freeze | AUTO | Immediate |
| **No arrival code was ever entered** | AUTO | Full refund. The pro was never provably there. |
| **Both codes verified + photos on file** | AUTO | Released. The customer typed the completion code themselves. |
| Small claim, first in 30 days | AUTO | Refunded as goodwill — cheaper than two minutes of your time |
| Quality, damage, partial work | YOU DECIDE | The judgement calls, and they always will be |
| **Safety / harassment / theft / injury** | **YOU ONLY** | Separate table, separate SLA, critical alert that overrides do-not-disturb, partner auto-suspended pending review |
| Permanent ban | **YOU ONLY** | — |
| Trust score recomputation | AUTO | Nightly |

## Engineering

| Task | Verdict | Trigger / escalation |
|---|---|---|
| Tests on every push | AUTO | A failure blocks the deploy |
| Deploy to Pages | AUTO | Only after CI is green, then smoke-tested |
| Supabase keepalive | AUTO | Every 3 days. **If this stops, the project pauses, cron stops, and escrow silently never releases.** |
| **Applying a migration** | **YOU ONLY** | Free tier has no point-in-time recovery. No automation may ever touch production data. |
| Rollback | YOU ONLY | Actions → Deploy to Pages → re-run the last green run |

---

## Peer-to-peer verification

Until 6.9 the two decisions that reached you every day were a background
check to confirm (a phone call to the reference) and a Certified badge to
award. Since 7.0 both are earned by the network itself (`domain/autoverify.js`)
and you keep the kill switch. The idea is that the people who can actually
know whether a pro is safe to send into a home — the customers who have had
them there, the pros in the same trade who have worked beside them, the
reference they named — are the ones who say so, on the record.

### Tier 3 · Background Checked — granted when ALL of these hold

| Line | Rule | Dial |
|---|---|---|
| Ladder | The seven-step ladder is complete (tier 2) | — |
| Jobs | At least **3** real jobs settled cleanly: the customer's code was entered, a photo is on file, no upheld dispute. This is `countedJobs`, the same number the provisional cap uses | `bgJobs` (1–50) |
| Rating | Average rating **≥ 4.3** over those jobs | `bgRating` (3–5) |
| Disputes | **0** upheld disputes, ever | — |
| Vouches | At least **2** vouches. Who may vouch: a customer who has had a job with this pro **settle**, or a **Background-Checked pro in the same trade**. One vouch per person, ever; nobody vouches for themselves; a suspended pro cannot vouch | `bgVouches` (0–10) |
| Reference | The reference the pro named at the background step has confirmed by a **4-digit code** | `bgReference` (on / off) |

A pro who is suspended, or not at tier 2, is never promoted whatever the
lines say.

### Tier 4 · SAAHAA Certified — granted when ALL of these hold

| Line | Rule | Dial |
|---|---|---|
| Jobs | 25 completed | — (`CERTIFIED_RULE`) |
| Rating | ≥ 4.6 | — |
| Disputes | 0 upheld | — |
| Tenure | Tier 3 held for **14** days (`tier3At`) | `certDays` (0–365) |
| Open | No dispute open right now | — |

### The dials and the kill switch

Admin → Approvals → **Automation**. `autoApprove` is the kill switch: off, and
tiers 3 and 4 wait for you again exactly as they did in 6.9 — nothing else
changes, and the pipeline still shows who would have qualified. The
thresholds have validated ranges (`domain/settings.js` → `validateAutomation`)
and a **Push**, like the Charges dials; a push that fails validation changes
nothing. Defaults apply until you push once.

You can still approve by hand, and you can still suspend. **Suspension always
wins**: a suspended pro is skipped by the sweep and cannot vouch.

### When it runs

The sweep (`sweepAutoApprovals`) runs at boot and after every state change,
so a promotion lands the moment the last line turns green — a rating comes
in, a vouch is given, the reference confirms, the 14th day passes on the next
open of the app.

### What is written down

| Event | Audit action | Actor |
|---|---|---|
| A promotion | `verify.auto` with `{partner, tier, evidence}` — every line as `have/need` | `auto` |
| A vouch | `verify.vouch` with `{partner, role}` | the voucher |
| Reference code generated | `verify.refCodeSent` | the pro |
| Reference confirmed / wrong code | `verify.refConfirmed` / `verify.refCodeWrong` | the pro |
| Dials pushed | the push, with who and when (`pushedAt`, `pushedBy`) | you |

### The honest limit

The reference's 4-digit code is generated by the app and **shown on the
pro's own screen**, for the pro to pass to the reference, who reads it back.
Until a DLT-registered SMS sender is wired (`docs/LAUNCH.md`, *Rails still to
wire*) this is the same sandbox the phone step uses: the step is real and
recorded, but nothing is texted, and a pro who wants to lie to it can. The
other five lines do not have that hole — jobs, ratings, disputes and vouches
are things other people did on the record. If that bothers you before the
SMS rail exists, turn `bgReference` off and raise `bgVouches` instead.

## Your day

**Daily — 15 minutes, one sitting, one screen.** Open the TODAY queue. If it is
empty, the app says so and shows you nothing else.

1. Header strip: orders, escrow held, disputes open, quota. All green → stop reading. *(1 min)*
2. Approvals → Automation: the pipeline shows who is close to tier 3 or 4
   and which line they are waiting on. Nothing to tap unless something looks
   wrong — then suspend, or flip the kill switch *(1 min)*
3. Finance → Treasury: fees earned, GST held, liabilities, and *Reconciles*
   — it must say yes. Withdraw or remit when you choose to, not daily *(1 min)*
4. Held escrows — expect 3–6, each showing why it was held. The **Flow
   tracker** is the screen to open when one of them does not make sense: it
   shows an order's stage, who holds it, the money against it, and what the
   system is waiting for, so a stalled order is read rather than guessed at
   *(4 min)*
5. Escalated disputes — expect 1–2, with a suggested resolution pre-filled *(4 min)*
6. Flagged content, bulk-approved *(1 min)*

No dashboards. No analytics. One time slot — 9pm works: after study hours,
before partners plan tomorrow.

**Weekly — 45 minutes, Sunday.** The supply-gap report is the highest-value ten
minutes in the entire ritual: it tells you exactly which two people to recruit
this week. Then partner cohort (warn the bottom five, thank the top five),
finance reconciliation, read every resolved dispute looking for *patterns* —
then change a threshold, not an outcome. Ship one small fix.

**Monthly — 2 hours.** Kill-criteria review. Cohort retention (the only number
that predicts survival). Call three partners and three customers — voices, not
a survey. Pricing review. **A restore drill: load last night's export into a
scratch project.** An untested backup is decoration.

---

## The first 30 days: turn automation OFF

With zero users most automation has nothing to work on, and manual is genuinely
better at small scale. And you really will start at zero: a new install seeds
nothing but your own credential, so every pro, shop and customer on it is one
you put there. (`?demo=1` fills a local browser with an example roster if you
want to rehearse a screen — it is a testing switch and never reaches a real
device.)

**Pick one pincode. Launch 3 service categories and 2 retail, not 24.** A
marketplace with one plumber in every category is a marketplace with nothing.

- **Days 1–7: supply only.** Do not touch customer acquisition — a customer who
  books and gets nobody is lost permanently. Walk to hardware, electrical and
  kirana shops and ask "who do you send people to?" Register all 10 partners
  **on your own phone**, 30–45 minutes each. That is the price of supply.
- **Days 8–14: seeded demand.** Be customer #1. Book real jobs for your own
  home and neighbours, pay real money, ride along on three of them. Lead with
  the escrow line in RWA groups — *"money held until you say the job is done"* —
  not with "download my app".
- **Days 15–30: referrals, asked in person.** A name from a neighbour converts
  far better than any code. Target: 50 customers, 30% ordering twice, zero
  safety incidents.

**Switch these off until you have volume:** auto escrow release (look at every
settlement until ~15/day — it is how you learn where the rules are wrong), auto
dispute resolution (your first 20 disputes are the curriculum), algorithmic
matching (you know all 10 partners personally and will match better), **bidding**
(it needs 6+ competing pros or it produces empty auctions that look broken),
trust scores (computed on 1–3 jobs they are noise and will suspend your only
electrician), and every alert above critical.

**Keep on from day one:** the ledger, escrow holding, the state machines, the
OTP, backups, and the tests. The plumbing, not the intelligence.

**Peer-to-peer verification can stay on.** With fewer than three settled jobs
and two vouches behind any pro it promotes nobody, so at small scale it does
nothing; the day it does promote someone, the evidence is on the audit log
under actor `auto`. If you would rather see the first few yourself, switch
`autoApprove` off and turn it on when the pipeline is longer than your
patience.

---

## When to stop

Write these three numbers and today's date on one page. Check on **day 45, 60
and 90 — not earlier**. Founders who evaluate continuously always find a reason
to continue; the date is the discipline.

1. **Demand — day 60.** Under 100 completed orders in the launch pincode, or
   repeat rate under 25% → people tried it as a favour and did not come back.
   That is a product problem and more marketing will not fix it.
2. **Supply — day 45.** Fewer than 8 partners with 3+ jobs each, or partner
   30-day retention under 50% → not enough volume per partner. Narrow to one
   category and 1 km.
3. **You — day 90.** Daily ritual over 45 minutes, or skipped more than 5 days
   in any 14, or **any safety incident**. Ops load that grows with order volume
   is a structural failure, not a discipline failure. A safety incident is a
   hard stop and a full reassessment regardless of every other number.

**SSC CGL Tier I is August–September 2026.** Plan a deliberate 45-day
maintenance mode — onboarding paused, catalogue frozen, daily ritual reduced to
escrow and disputes only. Build the "pause new bookings" switch
(`kill_switch_new_orders` in `app_config`) *before* you need it, not during.
