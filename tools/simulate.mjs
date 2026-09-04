#!/usr/bin/env node
/* SAAHAA · tools/simulate.mjs — run N orders through the REAL pricing engine.

   This does not estimate. It calls the same quoteService / quoteRetail /
   releaseService / cancelSplit that the app calls, so if the economics change
   in pricing.js this output changes with them. Every rupee is reconciled: the
   script asserts that what the customer paid equals what everyone received,
   across all N orders, and fails loudly if it does not.

     node tools/simulate.mjs            5000 orders
     node tools/simulate.mjs 20000      a different count
     node tools/simulate.mjs 5000 --csv machine-readable
*/

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = p => import(pathToFileURL(resolve(ROOT, p)).href);

/* the domain modules read localStorage at import time */
class Mem { #m=new Map(); getItem(k){const v=this.#m.get(String(k));return v===undefined?null:v;}
  setItem(k,v){this.#m.set(String(k),String(v));} removeItem(k){this.#m.delete(String(k));}
  clear(){this.#m.clear();} key(i){return [...this.#m.keys()][i]??null;} get length(){return this.#m.size;} }
globalThis.localStorage = new Mem();
globalThis.sessionStorage = new Mem();

await load('src/domain/catalog.services.js');
await load('src/domain/catalog.retail.js');
const M   = await load('src/core/money.js');
const P   = await load('src/domain/pricing.js');
const REG = await load('src/core/registry.js');
const BID = await load('src/domain/bidding.js');
const L   = await load('src/domain/ledger.js');

const N = Number(process.argv[2]) || 5000;
const CSV = process.argv.includes('--csv');

/* ── deterministic RNG, so the same N always gives the same answer ── */
let seed = 20260902;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);

const cats = REG.all('category');
const services = cats.filter(c => c.kind === 'service');
const retails  = cats.filter(c => c.kind === 'retail');

/* ── the mix. Hyperlocal reality: lots of small frequent retail baskets and
      cheap services, a thin tail of big-ticket jobs. ────────────────── */
const SERVICE_SHARE = 0.55;          // 55% services, 45% shop orders
const OUTCOME = {                    // what actually happens to an order
  settled:        0.880,             // completed and released in full
  partial:        0.025,             // partial release after a dispute
  cancelledFree:  0.055,             // cancelled before a pro accepted
  cancelledLate:  0.020,             // cancelled within 2h of the slot
  noShow:         0.020,             // pro never arrived — full refund + credit
};
const TIER4_SHARE = 0.12;            // certified pros pay 6%, not 10%
const FIRST30_SHARE = 0.06;          // a shop's first 30 orders are fee-free
const BID_ELIGIBLE_SHARE = 0.35;     // share of service jobs that go to auction

const acc = {
  orders: 0, service: 0, retail: 0,
  customerPaid: 0, workerEarned: 0, shopEarned: 0, riderEarned: 0,
  platformFee: 0, gstCollected: 0, refunded: 0, goodwill: 0, holdback: 0,
  customerSaved: 0, workerUpside: 0,
  bidJobs: 0, bidSavings: 0,
  byOutcome: {}, byCat: {},
};
const bump = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

function outcomeFor() {
  const r = rnd(); let c = 0;
  for (const [k, p] of Object.entries(OUTCOME)) { c += p; if (r <= c) return k; }
  return 'settled';
}

/* ── SERVICE ORDER ─────────────────────────────────────────── */
function serviceOrder() {
  const cat = pick(services);
  const tier4 = rnd() < TIER4_SHARE;
  const markup = tier4 ? P.LOYALTY_MARKUP : P.SERVICE_MARKUP;

  // the pro's quote: scattered around the category's fair price
  let deal = Math.round(cat.base * between(0.88, 1.24));

  // AUCTION: when several pros are free, the winning bid lands near the
  // target because the price score PEAKS there — it does not collapse to the
  // floor. The customer's saving is real but bounded, which is the point.
  const band = BID.priceBand(cat.id);
  const canBid = band && !band.quoteOnly && BID.biddingAllowed(cat.id, { poolSize: 12 }).allowed;
  let viaBid = false;
  if (canBid && rnd() < BID_ELIGIBLE_SHARE) {
    viaBid = true;
    const before = deal;
    // winning bids cluster just under the fair price
    deal = Math.round(Math.max(band.floor, Math.min(band.ceiling, band.target * between(0.94, 1.02))));
    acc.bidJobs++;
    acc.bidSavings += Math.max(0, before - deal);
  }

  const q = P.quoteService(deal, { markup });
  const cmp = P.compareWithApps(deal);
  const outcome = outcomeFor();
  bump(acc.byOutcome, outcome);
  bump(acc.byCat, cat.name);

  if (outcome === 'settled' || outcome === 'partial') {
    const pctReleased = outcome === 'partial' ? 0.6 : 1;
    const r = P.releaseService(deal, pctReleased, { markup });
    const hb = L.holdbackFor(r.workerPayout, 0);
    acc.customerPaid += q.customerPays;
    acc.workerEarned += r.workerPayout;
    acc.holdback     += hb;
    acc.platformFee  += r.platformFee;
    acc.gstCollected += r.gst;
    acc.refunded     += r.refund;
    if (outcome === 'settled') {
      acc.customerSaved += cmp.saved;
      acc.workerUpside  += cmp.workerUpside;
    }
    if (!r.reconciles) throw new Error('service release does not reconcile');
  } else {
    const rule = outcome === 'cancelledFree' ? 'BEFORE_ACCEPT'
               : outcome === 'cancelledLate' ? 'LATE_2H' : 'WORKER_NO_SHOW';
    const s = P.cancelSplit(deal, rule, { markup });
    acc.customerPaid += q.customerPays;
    acc.refunded     += s.refund;
    acc.workerEarned += s.worker;
    acc.platformFee  += s.platform;
    acc.goodwill     += s.credit;
    if (!s.reconciles) throw new Error('cancel split does not reconcile');
  }
  return viaBid;
}

/* ── RETAIL ORDER ──────────────────────────────────────────── */
function retailOrder() {
  const cat = pick(retails);
  const lines = [];
  const n = 2 + Math.floor(rnd() * 7);            // 2-8 lines per basket
  for (let i = 0; i < n; i++) {
    lines.push({ qty: 1 + Math.floor(rnd() * 3), unitPrice: Math.round(between(1500, 35000)) });
  }
  const km = between(0.6, 5.5);
  const mode = rnd() < 0.72 ? 'rider' : rnd() < 0.6 ? 'self' : 'pickup';
  const first = rnd() < FIRST30_SHARE;
  const q = P.quoteRetail(lines, {
    catId: cat.id, km, mode, firstOrders: first,
    freeDeliveryAbove: 49900,                      // shops advertise free over Rs.499
  });
  if (!q.reconciles) throw new Error('retail quote does not reconcile');

  const outcome = rnd() < 0.94 ? 'settled' : 'cancelledFree';
  bump(acc.byOutcome, outcome === 'settled' ? 'settled' : 'cancelledFree');
  bump(acc.byCat, cat.name);

  if (outcome === 'settled') {
    acc.customerPaid += q.customerPays;
    acc.shopEarned   += q.shopPayout;
    acc.riderEarned  += q.riderPayout;
    acc.platformFee  += q.platformFeeExGst + q.dispatchCut;
    acc.gstCollected += q.platformFeeGst;
    // a delivery app takes 20-30% of the basket; the shop keeps that difference
    acc.workerUpside += M.pct(q.itemsTotal, 25) - q.platformFee;
  } else {
    acc.customerPaid += q.customerPays;
    acc.refunded     += q.customerPays;
  }
}

/* ── run ───────────────────────────────────────────────────── */
for (let i = 0; i < N; i++) {
  if (rnd() < SERVICE_SHARE) { serviceOrder(); acc.service++; }
  else { retailOrder(); acc.retail++; }
  acc.orders++;
}

/* ── the invariant: nothing was created and nothing vanished ── */
// the holdback is a SLICE OF workerEarned, not an extra payment — counting it
// again here was double-counting and made the book look short by exactly it
const paidOut = acc.workerEarned + acc.shopEarned + acc.riderEarned
              + acc.platformFee + acc.gstCollected + acc.refunded;
const drift = acc.customerPaid - paidOut;

const r = p => '₹' + Math.round(p / 100).toLocaleString('en-IN');
const pc = (a, b) => b ? ((a / b) * 100).toFixed(2) + '%' : '—';

if (CSV) {
  console.log('metric,paise,rupees');
  for (const [k, v] of Object.entries(acc)) if (typeof v === 'number') console.log(`${k},${v},${(v/100).toFixed(2)}`);
  process.exit(0);
}

const row = (a, b, c = '') => console.log('  ' + a.padEnd(38) + String(b).padStart(16) + '   ' + c);
const rule = () => console.log('  ' + '─'.repeat(72));

console.log(`\n  SAAHAA — ${N.toLocaleString('en-IN')} ORDERS, SIMULATED THROUGH THE REAL PRICING ENGINE`);
console.log(`  ${acc.service.toLocaleString('en-IN')} service jobs · ${acc.retail.toLocaleString('en-IN')} shop orders · ${acc.bidJobs.toLocaleString('en-IN')} went to auction\n`);

rule(); console.log('  MONEY IN'); rule();
row('Customers paid, in total', r(acc.customerPaid));
row('Average order value', r(Math.round(acc.customerPaid / acc.orders)));

console.log('');
rule(); console.log('  WHERE IT WENT'); rule();
row('Pros earned', r(acc.workerEarned), pc(acc.workerEarned, acc.customerPaid) + ' of the money in');
row('  · of which held back 7 days', r(acc.holdback), 'released after a clean week');
row('Shops earned', r(acc.shopEarned), pc(acc.shopEarned, acc.customerPaid));
row('Riders earned', r(acc.riderEarned), pc(acc.riderEarned, acc.customerPaid));
row('Refunded to customers', r(acc.refunded), pc(acc.refunded, acc.customerPaid));
row('GST collected (owed, not revenue)', r(acc.gstCollected), 'remitted to government');
row('SAAHAA revenue, net of GST', r(acc.platformFee), pc(acc.platformFee, acc.customerPaid));
rule();
row('Reconciles to zero?', drift === 0 ? 'YES — exact' : `NO — off by ${r(drift)}`);

console.log('');
rule(); console.log('  WHAT THE COMPANY ACTUALLY KEEPS'); rule();
const upiOnly = acc.platformFee;
const cardMix = Math.round(acc.customerPaid * 0.25 * 0.0236);   // 25% cards at 2% + 18% GST
const netUpi  = upiOnly - acc.goodwill;
const netCard = upiOnly - acc.goodwill - cardMix;
row('Gross platform revenue', r(acc.platformFee));
row('Less goodwill credits paid out', '-' + r(acc.goodwill));
row('Net, if every payment is UPI (0% MDR)', r(netUpi), 'the reason to default to UPI');
row('Net, at a 25% card mix', r(netCard), `card fees cost ${r(cardMix)}`);
row('Revenue per order', r(Math.round(acc.platformFee / acc.orders)));

console.log('');
rule(); console.log('  WHAT EVERYONE ELSE GAINED vs A COMMISSION APP'); rule();
row('Customers saved', r(acc.customerSaved), 'vs a 25% app paying the pro the same');
row('Pros + shops earned MORE', r(acc.workerUpside), 'they would have lost this to commission');
row('  · saved by auctions specifically', r(acc.bidSavings), `across ${acc.bidJobs.toLocaleString('en-IN')} bid jobs`);
row('Average saving per settled order', r(Math.round(acc.customerSaved / (acc.byOutcome.settled || 1))));

console.log('');
rule(); console.log('  WHAT HAPPENED TO THE ORDERS'); rule();
for (const [k, v] of Object.entries(acc.byOutcome).sort((a, b) => b[1] - a[1])) {
  row(k, v.toLocaleString('en-IN'), pc(v, acc.orders));
}

console.log('');
rule(); console.log('  BUSIEST CATEGORIES'); rule();
Object.entries(acc.byCat).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, v]) => row(k, v.toLocaleString('en-IN'), pc(v, acc.orders)));

console.log('');
if (drift !== 0) { console.error(`  FAIL — the book is off by ${r(drift)}\n`); process.exit(1); }
console.log('  Every rupee accounted for.\n');
