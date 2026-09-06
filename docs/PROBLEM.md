# The real-world problem SAAHAA solves

## The problem, as people actually live it

**A plumber in Kukatpally has no digital existence.** He has a phone number
and a reputation that lives in the heads of forty households. When one of
them moves away, he loses that customer forever. When a new family arrives
two streets over, they cannot find him — they open an app and pay a stranger.
He cannot make a website: it needs coding, a designer, hosting, and someone
to keep it updated. The "solutions" sold to him — a Google Business listing
he never learns to manage, a WhatsApp Business number, a ₹15,000 website
that is stale in a month — all put the maintenance burden back on the one
person with no time and no skill for it.

**The commission apps that do give him customers take 20–30% of his price.**
On a ₹1,000 job he keeps ₹750. So he pads the quote, the customer overpays,
and the app pockets the difference from both sides. The customer, meanwhile,
has no way to know whether the stranger at the door is verified, whether the
price will change after the work, or whether the money they hand over goes
to the person who did the work.

**The kirana owner has the same problem with a different face.** She cannot
list her products online without a developer. The quick-commerce apps that
will list her take 25% of a basket where her own gross margin is 3–6% — so
listing is a loss on every order. Her only online presence is a WhatsApp
group she manages by hand.

The pattern is one problem with three faces: **local professionals and shops
have no way to be found, trusted and paid digitally without either building
and maintaining technology themselves or surrendering a quarter of their
income to someone who does.** (The product-research signal this was built
against: *"Why can't shop owners create websites without coding knowledge?"
— severity 9, whitespace 7, frequency 8.5, itch score 92.4.*)

## What SAAHAA does about it — "locally, professionally"

1. **A professional digital presence they never build or maintain.**
   Signing up as a partner and passing verification produces a public page —
   badge, rating, jobs done, price, what they do, reviews, a Book button —
   generated from their work and kept current by the platform. They edit
   three fields. The page is theirs to share on WhatsApp; it is also how
   strangers two streets away find them. *(the storefront, `#/pro/<id>`)*

2. **They keep 100% of their quote.** SAAHAA's charge — 8% — is laid on top
   of the fair price and paid by the customer. On a ₹1,000 job the worker
   receives ₹1,000; the customer pays ₹1,080; the platform earns ₹67.80 and
   remits ₹12.20 GST. Against a 25% app the worker earns ₹250 more per
   ₹1,000 and the customer still pays less than the padded price. Over
   a 5,000-order model run through the shipping pricing engine: customers
   saved ₹11.2 lakh, pros and shops earned ₹16.9 lakh more.
   *(`domain/pricing.js`, `tools/simulate.mjs`)*

3. **Shops list their own products in minutes** from a ready list, pay 3–5%
   capped — never more than their margin — and nothing on their first 30
   orders. Substitutions, pickup and returns are handled by the platform, not
   by a WhatsApp thread. *(the merchant command center)*

4. **Trust is mechanical, not promised.** Every pro passes a seven-step,
   ten-minute self-verification (phone, ID kept as a hash + last 4, selfie,
   a trade quiz that only a real tradesperson passes, the rules, UPI,
   agreement); the customer gets a 4-digit code that proves the right person
   arrived; the price is locked before booking; the money is held until the
   customer confirms the work; a photo is required before payout; the worker
   stakes a minimum of their own money the moment work starts and gets all of
   it back on finishing. Every rupee is a leg on a hash-chained ledger that
   reconciles to zero. *(verification, escrow, the wallet, the ledger)*

5. **When more than one pro is free, the customer can ask rates** — sealed,
   scored on trust and distance as much as price, with the held price
   guaranteed so asking costs nothing. It saves money without a race to the
   bottom. *(the P2P auction)*

6. **It runs itself for a single owner.** Verification, matching, escrow,
   release, holdbacks, substitution timeouts and auctions are automated; the
   owner's whole job is two decisions a day (a background check, a Certified
   badge) and four minutes in the admin. Updates ship continuously with no
   maintenance window.

## Who it is for, and where it starts

Hyderabad first — one pincode, ten pros, three shops, fifty households — then
the next pincode. The unit is a neighbourhood, because that is the unit at
which trust already exists and simply has no digital form.
