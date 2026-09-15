# Free tier — what this costs, and what would end that

SAAHAA runs on free plans end to end. That is not a temporary state to be
outgrown quietly: every limit below is a **design constraint that shaped the
code**, and the places where the code gives something up to stay inside one are
named here. If a change would push a number past its ceiling, that change is
the decision — not the bill that arrives afterwards.

**Running total: ₹0/month.** The only money this product needs is a domain,
and it works without one on `*.pages.dev`.

Limits move. Everything here was checked on **15 September 2026**; treat a
number older than a quarter as a claim to re-check, not a fact.

---

## The four services

### Cloudflare Pages — the site

| | |
|---|---|
| Requests | unlimited |
| Bandwidth | unlimited |
| Builds | 500/month, 1 concurrent |
| Files | 20,000 per deployment, 25 MB each |

**What we use.** One deployment is `index.html`, `admin.html`, the vendored
Archivo faces and Leaflet — a few dozen files. Builds run only on a push to
`main` that passes CI, so 500/month is roughly 16 deploys a day; nothing near
it.

**What keeps us inside it.** `tools/build.py --site` inlines all 82 modules
into one file. That is why the file count is dozens rather than hundreds, and
it is also why there is no bundler in this project — there is nothing for one
to do.

### Cloudflare Workers — the money rail

| | |
|---|---|
| Requests | **100,000/day** |
| CPU | 10 ms per invocation |
| Scripts | 100 |

**What we use.** Four endpoints, called once per payment event, plus
`/api/health` twice a week from the keep-alive cron. A hundred thousand
requests a day is roughly 33,000 orders a day at three calls each. If SAAHAA
ever approaches that, the Workers bill is the least interesting thing that has
happened.

**What keeps us inside it.** The browser is the working copy and the Worker is
only the authority on money. Nothing polls it. There is no request-per-render,
no subscription, no heartbeat from a phone — the entire client can be offline
and the product still works, which is the same property that makes the request
count small.

**The one that could bite.** CPU is 10 ms, and `/api/clear` does an HMAC plus
four Postgres round trips. The round trips are wall-clock, not CPU, so they do
not count — but a future endpoint that hashes a large body would. Keep the
Worker at four responsibilities, as `worker/index.js` says at the top.

### Supabase — the database

| | |
|---|---|
| Database | **500 MB** |
| File storage | 1 GB |
| Egress | 5 GB/month |
| Monthly active users | 50,000 |
| Projects | 2 free |
| **Inactivity** | **a project pauses after 7 days with no query** |

**What we use.** Six tables, all of them narrow. Money is `bigint` paise, not
`numeric`. Every `text` column carries a `CHECK` on its length. There are no
blobs: a photo is content-addressed and lives in git
([docs/STORAGE.md](STORAGE.md)), so the 1 GB file limit is not on the path of
anything.

**What 500 MB actually buys.** A payment row is on the order of 200 bytes and a
ledger leg about 250. Half a gigabyte is therefore millions of orders — the
database will not be what runs out first.

**The one that could bite — and the fix that is already shipped.** *A free
project sleeps after seven days without a query, and a sleeping database means
a customer cannot claim a payment on Monday morning.*
`.github/workflows/keepalive.yml` calls `beat()` on Monday and Thursday and
**fails loudly** if it cannot. A keep-alive that quietly stops working is worse
than none, because you find out when a customer does.

### GitHub — code, CI, and the photo store

| | |
|---|---|
| Actions on a public repo | unlimited |
| Actions on a private repo | 2,000 minutes/month |
| Repository | 1 GB recommended, 100 MB per file |

**What we use.** CI is about four minutes a run. On a public repo that is free
without a ceiling; on a private one, 2,000 minutes is roughly 500 runs a month.

---

## What is deliberately given up to stay free

These are not missing features. Each is a thing that was considered, costed,
and declined — write them down so they are not "discovered" later as gaps.

- **No SMS.** An OTP costs money per message and scales with signups. Identity
  is one permanent code per person (`C20262001`), which is free, works offline,
  and can be read down a phone line. The README says there is no SMS rail and
  never will be; this is why.
- **No payment gateway, yet.** A PSP licence is months and a company. The live
  rail is manual UPI: the customer pays one UPI ID and types the UTR, and a
  human reads the bank statement. `src/core/gateway.js` is the one file that
  changes the day a gateway is affordable.
- **No CDN for anything.** The CSP is `script-src 'self'`. Archivo and Leaflet
  are vendored into the repo. This costs a larger first load and buys: no third
  party can break the app, and a tradesperson's phone does not depend on
  somebody else's uptime.
- **No npm and no bundler.** Vanilla ES modules, inlined by a 500-line Python
  script. Nothing to audit, nothing to update, no build minutes spent
  installing.
- **No object storage.** Photos are content-addressed; a catalogue product
  resolves to one shared image across every shop that stocks it, so 7,960
  listings collapse to 199 images.

## What would actually end the free tier

In the order it would happen, not in the order it is worried about:

1. **A custom domain.** ~₹900/year for a `.in`. Cloudflare charges nothing to
   host it; the registrar charges for the name. This is the only cost between
   here and a real launch.
2. **Supabase egress past 5 GB/month.** Only reachable if the browser starts
   reading lists from Postgres instead of holding them. It does not today.
3. **A PSP.** When manual UPI stops being honest at volume — which is a good
   problem and a deliberate one.

## Checking it yourself

```bash
bash tools/deploy.sh --check
```

Verifies the Worker can reach Postgres and that both pages answer, and changes
nothing. Run it after any deploy, and on the Monday after the keep-alive is
supposed to have fired.
