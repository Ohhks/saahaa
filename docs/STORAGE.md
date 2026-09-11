# Storage — staying inside the free tier on purpose

The free Supabase tier gives **500 MB of Postgres, 1 GB of files, 5 GB of
egress**. Those three numbers are not equally tight, and the design follows from
which one runs out first.

## Do the arithmetic before choosing

A completed order writes roughly:

| row | bytes |
|---|---|
| `orders` | ~200 |
| `payments` (one claim) | ~200 |
| `ledger` (≈5 legs: escrow in, release, fee, gst, holdback) | ~1,250 |
| **total per order** | **≈1.7 KB** |

With indexes, call it **3 KB an order**. 500 MB therefore holds on the order of
**150,000 completed orders** — years of a neighbourhood marketplace.

Now the same sum for files. One job photograph off a phone is 200 KB–2 MB. At
even 200 KB, **1 GB is 5,000 photos** — about 5,000 jobs, which SAAHAA would
reach long before it troubles the database.

**So files are the binding constraint, by roughly thirty to one.** Postgres is
not the thing to protect; the file bucket is.

## The rule

> **Postgres stores facts. Git stores bytes. Nothing stores a blob twice.**

- **Money, orders, claims, the ledger → Supabase.** Small, relational, needs
  transactions and row-level security. Never a base64 blob in a column: it
  inflates the one budget that also has to serve queries.
- **Photographs, proof-of-work, shopfronts → a git repo, served by CDN.**
  Images are immutable, content-addressed by nature, and already version
  controlled. GitHub serves them free; jsDelivr fronts them with a real CDN.
- **Supabase Storage stays empty** until something genuinely needs signed,
  private, revocable URLs — a dispute photograph that must not be public, say.
  That is what the 1 GB is being saved for.

## How the two are interlinked

The database never holds the image. It holds where the image is and what it is:

```sql
-- on the order, or on an evidence row
photo_path  text,   -- 'proof/2026/09/ord_01n4f/after.webp'
photo_sha   text,   -- git blob sha: the bytes are what they were
photo_bytes int
```

The browser builds the URL from the path:

```
https://cdn.jsdelivr.net/gh/Ohhks/saahaa-proof@main/<photo_path>
```

Two consequences worth having:

- **Egress is free.** Images are the overwhelming majority of bytes a
  marketplace serves, and none of them come out of the 5 GB Supabase allowance.
  The JSON that does is a few KB an order.
- **The proof is tamper-evident.** `photo_sha` is a git object id. If the file
  is ever replaced, the sha stops matching and the ledger's claim that this
  photograph released the money is checkable, not merely asserted.

## Keep the bytes small at the door

Compress on the device before upload, not after:

- resize the long edge to **1280 px** — enough to see a fixed tap, not a poster
- encode **WebP at q70** → typically **40–80 KB**
- strip EXIF, which removes the customer's GPS coordinates as a side effect,
  and that is a privacy win, not only a storage one

At 60 KB a photo, 1 GB of git is **~16,000 photographs**, and the practical
limit becomes GitHub's ~1 GB soft repo recommendation rather than anything
Supabase charges for. Split by year (`saahaa-proof-2027`) long before that bites.

## Watch the right number

`heartbeat` aside, the query worth running monthly is:

```sql
select pg_size_pretty(pg_total_relation_size('ledger'))  as ledger,
       pg_size_pretty(pg_total_relation_size('orders'))  as orders,
       pg_size_pretty(pg_database_size(current_database())) as total;
```

The ledger is append-only and will always be the largest table. That is correct
and it is the one table that must never be trimmed to save space — if it ever
approaches the limit, archive whole closed years to git as compressed JSONL and
keep the hash chain's head, rather than deleting legs.

## The sleep problem

A free project **pauses after seven days without a query**, and a paused
database means a customer cannot claim a payment on Monday morning.
`.github/workflows/keepalive.yml` calls `rpc/beat` twice a week — one row, one
column — and **fails the workflow if it does not get a 200**, because a
keep-alive that quietly stops working is worse than none: you find out when a
customer does.
