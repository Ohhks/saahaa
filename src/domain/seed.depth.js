/* SAAHAA · domain/seed.depth.js — market depth.

   The original seed had exactly ONE pro per category. That is not a thin
   market, it is not a market at all: `biddingAllowed` needs 6 pros before it
   will open an auction and the UI needs 8 before it will offer one, so the
   entire ask-and-bid feature was unreachable — correct code that could never
   run. Depth is not decoration here; it is the precondition for the product's
   central mechanism.

   DETERMINISTIC ON PURPOSE. A seeded LCG, not Math.random, so the roster is
   byte-identical on every device and every reload. Ids are derived from
   (category, index), which is what makes the v6→v7 top-up migration idempotent
   — running it twice cannot produce duplicate pros. */

import { toPaise } from '../core/money.js';

const AREAS = ['Madhapur', 'Gachibowli', 'Kondapur', 'Jubilee Hills', 'Banjara Hills',
               'Ameerpet', 'Kukatpally', 'Miyapur', 'Begumpet', 'Secunderabad',
               'LB Nagar', 'Uppal'];

const FIRST = ['Ramesh', 'Sattar', 'Prakash', 'Venu', 'Imran', 'Naveen', 'Srinivas',
               'Fayaz', 'Kiran', 'Mahesh', 'Anwar', 'Rajesh', 'Sudhakar', 'Yousuf',
               'Bhaskar', 'Nagaraju', 'Salim', 'Praveen', 'Gopal', 'Riyaz',
               'Lakshmi', 'Padma', 'Shabana', 'Swapna', 'Jyothi', 'Nasreen'];
const LAST = ['K.', 'Reddy', 'Rao', 'Goud', 'Sharma', 'Ahmed', 'Naidu', 'Yadav',
              'Kumar', 'Shaikh', 'Babu', 'Verma'];

/* base ask in rupees per category — the pool spreads around this */
const ASK = {
  plumbing: 520, electrical: 480, appliance: 750, cleaning: 400, repair: 600,
  pest: 1100, moving: 2500, tutor: 500, pet: 600, salon: 900, laundry: 180,
};
/* 9 extra each, on top of the one hand-written pro, clears both gates */
const PER_CAT = 9;

/* Lehmer / MINSTD. Same sequence everywhere, forever. */
function lcg(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Build the depth roster.
 * @param {number} now   timestamp to anchor history against
 * @param {string} pass  the shared demo password hash (all seeds use sha256('123'))
 */
export function depthRoster(now, pass) {
  const users = [], partners = [];
  Object.keys(ASK).forEach((cat, ci) => {
    const rnd = lcg(1000 + ci * 97);
    for (let i = 0; i < PER_CAT; i++) {
      const id = `p_${cat}_${i + 2}`;                 // stable => migration is idempotent
      const name = `${FIRST[(ci * 7 + i * 3) % FIRST.length]} ${LAST[(ci * 5 + i) % LAST.length]}`;
      const mobile = `91${String(10000000 + ci * 100 + i).slice(-8)}`;
      const key = `${name}|${mobile}`.toLowerCase();
      const area = AREAS[(ci * 4 + i * 5) % AREAS.length];

      /* Asks spread 0.82x–1.18x. A pool where everyone quotes the same number
         makes the auction pointless; a pool that spans 3x makes the fair-price
         band meaningless. Neither teaches the customer anything. */
      const ask = Math.round(ASK[cat] * (0.82 + rnd() * 0.36));
      const completed = 8 + Math.floor(rnd() * 190);
      const avg = 3.9 + rnd() * 1.0;
      // Tier tracks jobs done, so the ladder reads as earned rather than assigned.
      const tier = completed > 150 ? 4 : completed > 70 ? 3 : completed > 25 ? 2 : 1;

      users.push({ key, id, name, mobile, role: 'partner', pass, area, tier,
                   partnerId: id, createdAt: now });
      partners.push({
        id, userKey: key, name, cat, ask: toPaise(ask), area, tier,
        online: true, completed, starts: completed,
        onTimeStarts: Math.round(completed * (0.80 + rnd() * 0.18)),
        workerCancels: Math.round(completed * 0.02),
        noShows: rnd() < 0.25 ? 1 : 0,
        disputesUpheld: 0, disputesPartial: completed > 120 ? 1 : 0,
        ratings: Array.from({ length: Math.min(20, completed) }, (_, r) => ({
          stars: Math.max(3, Math.min(5, Math.round(avg + (rnd() - 0.5)))),
          ts: now - r * 86400000 * 4,
        })),
        lastActiveTs: now - rnd() * 86400000 * 2,
      });
    }
  });
  return { users, partners };
}

export { PER_CAT, ASK as DEPTH_CATS };
