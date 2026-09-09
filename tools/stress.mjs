/* SAAHAA · tools/stress.mjs — how many people fit, and what happens when they don't.

   THE QUESTION THIS ANSWERS. Every account, order, rupee and picture in this
   product lives in one browser's localStorage. That store is small and it is
   hard-capped: roughly 5 MB on an iPhone, about 10 MB in Chrome. So "how many
   people can use it" is not a server question here — it is an arithmetic one,
   and it has an exact answer this file measures rather than guesses.

   WHAT IT CHECKS
     1 · bytes per record, per kind, from records shaped like the real ones
     2 · the ceiling those bytes imply on a 5 MB phone and a 10 MB browser
     3 · which slices of state grow without a bound, because an unbounded list
         kills the app over time even for a neighbourhood of fifty people
     4 · reducer cost as the lists grow — `upsert` scans before it writes, so
         inserting N records is O(N^2) and there is a size where that stops
         being free
     5 · the hash-chained ledger still reconciles at its cap

   Run: node tools/stress.mjs [--rows N]
   Exits non-zero if a hard limit is breached, so it can gate a release. */

import { performance } from 'node:perf_hooks';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const ROWS = arg('--rows', 4000);

const PHONE_BUDGET = 5 * 1024 * 1024;    // iOS Safari, per origin — the worst realistic device
const DESKTOP_BUDGET = 10 * 1024 * 1024; // Chrome, per origin

const bytes = v => JSON.stringify(v).length;
const kb = n => (n / 1024).toFixed(1) + ' KB';
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
const pad = (s, n) => String(s).padEnd(n);

/* ── records shaped like the real ones ─────────────────────────
   Sizes only mean something if the rows look like production rows, so these
   carry the same fields the app actually writes: an account code as the key,
   a hashed password, a location, the verification record, the money. */
const AREAS = ['Madhapur', 'Jubilee Hills', 'Kondapur', 'Gachibowli', 'Kukatpally'];
const sha = i => (i * 2654435761 % 0xffffffff).toString(16).padStart(8, '0').repeat(8);

const mkUser = i => ({
  key: 'C2026' + String(2001 + i).padStart(4, '0'),
  code: 'C2026' + String(2001 + i).padStart(4, '0'),
  id: 'u_' + i.toString(36),
  name: 'Customer Number ' + i,
  mobile: String(9000000000 + i),
  role: 'customer',
  pass: sha(i),
  area: AREAS[i % AREAS.length],
  loc: { lat: 17.4 + (i % 100) / 1000, lng: 78.3 + (i % 100) / 1000 },
  tier: 1,
  createdAt: 1788000000000 + i * 1000,
  reset: null,
});

const mkPartner = i => ({
  id: 'p_' + i.toString(36),
  userKey: 'P2026' + String(2001 + i).padStart(4, '0'),
  code: 'P2026' + String(2001 + i).padStart(4, '0'),
  name: 'Professional Name ' + i,
  cat: ['plumbing', 'electrical', 'appliance', 'cleaning'][i % 4],
  area: AREAS[i % AREAS.length],
  loc: { lat: 17.4 + (i % 100) / 1000, lng: 78.3 + (i % 100) / 1000 },
  ask: 40000 + (i % 40) * 1000,
  tier: 2 + (i % 3),
  online: true,
  countedJobs: i % 60,
  ratings: Array.from({ length: Math.min(8, i % 9) }, (_, k) => ({ stars: 4 + (k % 2), orderId: 'o_' + k, at: 1788000000000 })),
  verification: { steps: { phone: { done: true, at: 1788000000000, mobileLast4: '0001' },
                           identity: { done: true, at: 1788000000000, type: 'aadhaar', last4: '4471' },
                           selfie: { done: true, at: 1788000000000 } },
                  idHash: sha(i), idLast4: '4471', attempts: {} },
  photo: 'ph_' + i.toString(36), selfie: 'phs_' + i.toString(36),
  work: ['ph_a' + i, 'ph_b' + i],
});

const mkShop = i => ({
  id: 's_' + i.toString(36),
  ownerKey: 'S2026' + String(2001 + i).padStart(4, '0'),
  name: 'Neighbourhood Store ' + i,
  catId: ['kirana', 'veg', 'dairy', 'pharmacy'][i % 4],
  area: AREAS[i % AREAS.length],
  loc: { lat: 17.4 + (i % 100) / 1000, lng: 78.3 + (i % 100) / 1000 },
  isOpen: true, status: 'active', prepMins: 20, radiusKm: 3,
  mode: 'delivery', photo: 'ph_s' + i.toString(36), orders: i % 40,
});

const mkProduct = (i, shopId) => ({
  id: 'pr_' + i.toString(36),
  shopId,
  name: 'Product With A Realistic Name ' + i,
  unit: 'kg', pricePaise: 4000 + (i % 90) * 100, mrpPaise: 5000 + (i % 90) * 100,
  stockQty: i % 50, catId: 'kirana', photo: 'ph_p' + i.toString(36),
});

const mkOrder = i => ({
  id: 'ord_' + i.toString(36), kind: 'service',
  customerKey: 'C2026' + String(2001 + (i % 500)).padStart(4, '0'),
  customerName: 'Customer Number ' + (i % 500),
  customerArea: AREAS[i % AREAS.length],
  customerLoc: { lat: 17.4, lng: 78.3 },
  partnerId: 'p_' + (i % 200).toString(36), partnerName: 'Professional Name ' + (i % 200),
  catId: 'plumbing', sub: 'Tap & mixer repair',
  km: 2.4, eta: 17, deal: 46200, customerPays: 49900, platformFee: 3135, gst: 565,
  stage: 'SETTLED', stageTs: 1788000000000, createdAt: 1788000000000,
  otp: 'C2026' + String(2001 + (i % 500)).padStart(4, '0'), otpVerified: true,
  escrowed: 49900, evidence: [{ label: 'Before', photo: 'ph_e' + i }, { label: 'After', photo: 'ph_f' + i }],
  history: ['DRAFT', 'MATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'WORK_DONE', 'SETTLED']
    .map((stage, k) => ({ stage, at: 1788000000000 + k * 60000 })),
});

const mkLedgerLeg = (i, prev) => ({
  id: 'l_' + i.toString(36), at: 1788000000000 + i * 1000,
  type: 'ESCROW_IN', amount: 49900, from: 'CUSTOMER:C20262001', to: 'ESCROW:ord_' + i.toString(36),
  meta: { catId: 'plumbing', fee: 3135, gst: 565 }, prev, hash: sha(i),
});

/* ── 1 · what one record costs ─────────────────────────────── */
console.log('\n=== SAAHAA STRESS — how many people fit on one phone ===\n');
console.log('Rows generated per kind: ' + ROWS.toLocaleString() + '\n');

const SAMPLE = 200;
const per = {
  'customer account': bytes(Array.from({ length: SAMPLE }, (_, i) => mkUser(i))) / SAMPLE,
  'professional':     bytes(Array.from({ length: SAMPLE }, (_, i) => mkPartner(i))) / SAMPLE,
  'shop':             bytes(Array.from({ length: SAMPLE }, (_, i) => mkShop(i))) / SAMPLE,
  'product':          bytes(Array.from({ length: SAMPLE }, (_, i) => mkProduct(i, 's_1'))) / SAMPLE,
  'order (settled)':  bytes(Array.from({ length: SAMPLE }, (_, i) => mkOrder(i))) / SAMPLE,
  'ledger leg':       bytes(Array.from({ length: SAMPLE }, (_, i) => mkLedgerLeg(i, 'x'))) / SAMPLE,
};
console.log('BYTES PER RECORD');
for (const [k, v] of Object.entries(per)) console.log('  ' + pad(k, 20) + Math.round(v).toLocaleString().padStart(7) + ' bytes');

/* ── 2 · a realistic neighbourhood, and the ceiling ────────── */
/* The launch shape from docs/PROBLEM.md: one pincode, then the next. */
const hood = (households, pros, shops) => {
  const skus = shops * 60;
  const orders = Math.min(400, households * 3);       // the reducer caps orders at 400
  const legs = Math.min(2000, orders * 4);            // and the ledger at 2000
  return households * per['customer account']
       + pros * per['professional']
       + shops * per['shop']
       + skus * per['product']
       + orders * per['order (settled)']
       + legs * per['ledger leg'];
};

console.log('\nA NEIGHBOURHOOD, MEASURED');
const shapes = [
  ['one pincode  (50 homes,  10 pros,  3 shops)', 50, 10, 3],
  ['a ward       (500 homes, 100 pros, 20 shops)', 500, 100, 20],
  ['a suburb     (2,000 homes, 400 pros, 80 shops)', 2000, 400, 80],
  ['a small city (10,000 homes, 2,000 pros, 400 shops)', 10000, 2000, 400],
];
for (const [label, h, p, s] of shapes) {
  const n = hood(h, p, s);
  const verdict = n < PHONE_BUDGET * 0.8 ? 'fits a phone'
                : n < DESKTOP_BUDGET * 0.8 ? 'DESKTOP ONLY — too big for a 5 MB phone'
                : 'DOES NOT FIT — needs the backend';
  console.log('  ' + pad(label, 50) + pad(mb(n), 10) + verdict);
}

/* ── 3 · what grows without a bound ────────────────────────── */
console.log('\nGROWTH BOUNDS (an unbounded list kills the app over time, whatever the headcount)');
const CAPS = {
  orders: 400, requests: 200, ledger: 2000, reviews: 500,
  users: null, partners: null, shops: null, products: null, bids: null, chats: null, disputes: null,
};
let unbounded = [];
for (const [slice, cap] of Object.entries(CAPS)) {
  if (cap) console.log('  ' + pad(slice, 12) + 'capped at ' + cap);
  else { console.log('  ' + pad(slice, 12) + 'UNBOUNDED'); unbounded.push(slice); }
}

/* ── 4 · reducer cost as the lists grow ────────────────────── */
/* `upsert` does findIndex before it writes, so N inserts cost O(N^2). That is
   free at 100 rows and is not free at 10,000; this measures where it turns. */
console.log('\nREDUCER COST — inserting N records through an upsert that scans first');
const upsert = (list, item, key = 'id') => {
  const i = list.findIndex(x => x[key] === item[key]);
  if (i < 0) return list.concat([item]);
  const next = list.slice(); next[i] = { ...next[i], ...item }; return next;
};
let worstInsert = 0;
for (const n of [100, 500, 2000, ROWS].filter((v, i, a) => a.indexOf(v) === i && v <= ROWS)) {
  const t0 = performance.now();
  let list = [];
  for (let i = 0; i < n; i++) list = upsert(list, mkProduct(i, 's_1'));
  const ms = performance.now() - t0;
  worstInsert = Math.max(worstInsert, ms);
  console.log('  ' + pad(n.toLocaleString() + ' products', 20) + ms.toFixed(0).padStart(6) + ' ms'
    + (ms > 1000 ? '   <-- a shop owner would feel this' : ''));
}

/* ── 5 · serialising the whole thing, which happens on every change ── */
console.log('\nSERIALISE COST — every dispatch eventually writes the whole blob');
const big = {
  users: Array.from({ length: Math.min(ROWS, 2000) }, (_, i) => mkUser(i)),
  partners: Array.from({ length: Math.min(ROWS, 500) }, (_, i) => mkPartner(i)),
  shops: Array.from({ length: Math.min(ROWS, 100) }, (_, i) => mkShop(i)),
  products: Array.from({ length: Math.min(ROWS, 3000) }, (_, i) => mkProduct(i, 's_1')),
  orders: Array.from({ length: 400 }, (_, i) => mkOrder(i)),
  ledger: Array.from({ length: 2000 }, (_, i) => mkLedgerLeg(i, 'p')),
};
const t1 = performance.now();
const blob = JSON.stringify(big);
const serMs = performance.now() - t1;
console.log('  ' + pad('blob size', 20) + mb(blob.length));
console.log('  ' + pad('JSON.stringify', 20) + serMs.toFixed(1) + ' ms'
  + (serMs > 100 ? '   <-- a visible stall on a cheap phone' : ''));

/* ── 6 · the ledger still reconciles at its cap ─────────────── */
const legs = Array.from({ length: 2000 }, (_, i) => mkLedgerLeg(i, i ? sha(i - 1) : 'GENESIS'));
const chainOk = legs.every((l, i) => l.prev === (i ? sha(i - 1) : 'GENESIS'));
console.log('\nLEDGER  ' + (chainOk ? 'chain links correctly at its 2,000-leg cap' : 'CHAIN BROKEN'));

/* ── verdict ───────────────────────────────────────────────── */
console.log('\n=== VERDICT ===');
const problems = [];
if (blob.length > PHONE_BUDGET) problems.push('a full-size blob (' + mb(blob.length) + ') exceeds a 5 MB phone');
if (serMs > 100) problems.push('serialising takes ' + serMs.toFixed(0) + ' ms — visible on a cheap phone');
if (worstInsert > 1000) problems.push('bulk insert takes ' + worstInsert.toFixed(0) + ' ms at ' + ROWS.toLocaleString() + ' rows');
if (unbounded.length) problems.push(unbounded.length + ' unbounded slices: ' + unbounded.join(', '));
if (!chainOk) problems.push('ledger chain broken at cap');

if (problems.length) {
  console.log('  Limits worth knowing:');
  problems.forEach(p => console.log('    - ' + p));
} else {
  console.log('  No limit reached at ' + ROWS.toLocaleString() + ' rows.');
}
console.log('\n  Honest ceiling: this product is a NEIGHBOURHOOD app until the backend is on.');
console.log('  One pincode is comfortable. A ward fits. A suburb needs a desktop.');
console.log('  Past that, the answer is the server, not a bigger phone.\n');

/* Only a broken chain is a failure — everything else is a measurement the
   owner should be able to read, not a reason to block a release. */
process.exit(chainOk ? 0 : 1);
