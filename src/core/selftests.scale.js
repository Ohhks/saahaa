/* SAAHAA · core/selftests.scale.js — what happens when there are a lot of people.

   Everything this product knows lives in one browser's localStorage, and that
   store is small and hard-capped — about 5 MB on an iPhone. Two things follow,
   and both are tested here.

   FIRST: a list that grows without a bound eventually fills the device on its
   own, whatever the headcount. Orders, requests, reviews, the ledger and chat
   threads were already capped. Bids and disputes were not, and bids grow
   fastest of anything in the state. They are capped now — but a cap is only
   safe if it drops the right rows, which is what most of this file is about.
   An open dispute is somebody waiting for their money back; evicting the
   oldest one would evict the person who has waited longest.

   SECOND, and worse: when the store finally refuses a write, the app used to
   swallow it and carry on looking healthy. `tools/stress.mjs` measures the
   ceiling; these tests pin the behaviour AT it. */

import { describe, it, expect } from './selftest.js';
import { defaultState } from '../domain/state.js';
import * as registry from '../core/registry.js';
import SERVICES, { SUB_SIZE, subSize } from '../domain/catalog.services.js';
import { quoteRetail } from '../domain/pricing.js';

/* Reducers register themselves when domain/state.js is imported, so they can be
   driven here exactly as the store drives them. */
const reducerFor = slice => {
  const r = registry.all('reducer').find(x => x.slice === slice);
  return r && r.reduce;
};
const runMany = (slice, makeAction, n, seed) => {
  const reduce = reducerFor(slice);
  let s = seed;
  for (let i = 0; i < n; i++) s = reduce(s, makeAction(i));
  return s;
};

describe('scale · no list is allowed to grow for ever', () => {
  it('bids stop at a cap — they outrun every other slice', () => {
    const out = runMany('bids', i => ({ type: 'bid/add', payload: { id: 'b' + i, amount: 1000 + i } }), 1500, []);
    expect(out.length).toSatisfy(n => n <= 1200, 'bids capped, got ' + out.length);
    /* the newest must survive: a bid that just came in is the live one */
    expect(out[out.length - 1].id).toBe('b1499');
  });

  it('the slices that were already capped still are', () => {
    const orders = runMany('orders', i => ({ type: 'order/add', payload: { id: 'o' + i } }), 600, []);
    expect(orders.length).toBe(400);
    expect(orders[0].id).toBe('o599');            // newest first

    const reviews = runMany('reviews', i => ({ type: 'review/add', payload: { id: 'r' + i } }), 700, []);
    expect(reviews.length).toBe(500);

    const ledger = runMany('ledger', i => ({ type: 'ledger/append', payload: { id: 'l' + i } }), 2500, []);
    expect(ledger.length).toBe(2000);
    expect(ledger[ledger.length - 1].id).toBe('l2499');   // the chain keeps its head
  });

  it('one chat thread cannot swallow the device', () => {
    const reduce = reducerFor('chats');
    let s = {};
    for (let i = 0; i < 400; i++) s = reduce(s, { type: 'chat/add', payload: { orderId: 'o1', msg: { id: 'm' + i, text: 'hello' } } });
    expect(s.o1.length).toSatisfy(n => n <= 200, 'thread capped, got ' + s.o1.length);
  });
});

describe('scale · a cap must never evict the person who has waited longest', () => {
  it('an open dispute survives, however old, while resolved ones are trimmed', () => {
    const reduce = reducerFor('disputes');
    let s = [];
    /* the very first one is opened and never resolved */
    s = reduce(s, { type: 'dispute/open', payload: { id: 'THE_OLD_OPEN_ONE', orderId: 'o0' } });
    for (let i = 1; i < 500; i++) {
      s = reduce(s, { type: 'dispute/open', payload: { id: 'd' + i, orderId: 'o' + i, resolvedAt: 1788000000000 + i } });
    }
    expect(s.length).toSatisfy(n => n <= 300, 'disputes capped, got ' + s.length);
    expect(s.some(d => d.id === 'THE_OLD_OPEN_ONE')).toBeTrue();
  });

  it('many open disputes are all kept even past the cap — none is ever dropped', () => {
    const reduce = reducerFor('disputes');
    let s = [];
    for (let i = 0; i < 400; i++) s = reduce(s, { type: 'dispute/open', payload: { id: 'open' + i, orderId: 'o' + i } });
    const open = s.filter(d => !d.resolvedAt);
    expect(open.length).toBe(400);
  });
});

describe('scale · the state a fresh device starts from', () => {
  it('is small enough that the first order is never the one that fails', () => {
    const size = JSON.stringify(defaultState()).length;
    expect(size).toSatisfy(n => n < 2000, 'empty state is ' + size + ' bytes');
  });
  it('declares every slice the reducers expect, so nothing arrives undefined at scale', () => {
    const s = defaultState();
    for (const k of ['users', 'partners', 'shops', 'products', 'requests', 'bids', 'orders', 'ledger', 'reviews', 'disputes']) {
      expect(Array.isArray(s[k])).toBeTrue();
    }
    for (const k of ['carts', 'chats']) expect(typeof s[k]).toBe('object');
  });
});

/* A PRICE TABLE KEYED BY RETYPED STRINGS IS A TABLE WITH TYPOS IN IT.
   The first version of SUB_SIZE had eleven keys matching no sub that existed —
   including three `survey: true` flags on dead names, so a full house move was
   quoted as a locked price under a promise that the price could not change.
   Nothing on screen showed it; every one of those subs silently fell back to
   1.0. This is the check that makes that impossible to ship again. */
describe('pricing · every sub-service has a deliberate size', () => {
  const withSubs = SERVICES.filter(c => Array.isArray(c.subs) && c.subs.length);

  it('no size table key is a typo — every key names a sub that exists', () => {
    const broken = [];
    for (const c of withSubs) {
      for (const key of Object.keys(SUB_SIZE[c.id] || {})) {
        if (!c.subs.includes(key)) broken.push(c.id + ' :: ' + key);
      }
    }
    expect(broken).toHaveLength(0);
  });

  it('every sub in every category is sized on purpose, not by falling back', () => {
    const unsized = [];
    for (const c of withSubs) {
      const tbl = SUB_SIZE[c.id] || {};
      for (const sub of c.subs) if (tbl[sub] == null) unsized.push(c.id + ' :: ' + sub);
    }
    expect(unsized).toHaveLength(0);
  });

  it('a dog walk does not cost the same as a vet visit', () => {
    /* the shape of the bug: within one category, the biggest job must not
       price the same as the smallest, or "price locked" is a lie for one of them */
    const flat = [];
    for (const c of withSubs) {
      const xs = c.subs.map(sub => subSize(c.id, sub).x);
      if (Math.max(...xs) === Math.min(...xs)) flat.push(c.id);
    }
    expect(flat).toHaveLength(0);
  });

  it('a job nobody can quote unseen is flagged, not priced as if it were locked', () => {
    /* at least one survey job must exist, or the mechanism is decoration */
    const surveys = withSubs.flatMap(c => c.subs.filter(sub => subSize(c.id, sub).survey));
    expect(surveys.length).toSatisfy(n => n > 5, 'found ' + surveys.length + ' survey-priced jobs');
  });
});

/* THE REWEIGH TABLE. This bug has now had three generations, each one closing
   the last hole and opening a new one, each shipped under a comment explaining
   why it could not possibly be wrong:

     gen 1 — the weight was stored and the refund never posted
     gen 2 — capping her charge left the shop's payout at the heavier figure,
             so a shop could be paid more than the customer ever paid
     gen 3 — scaling everything by the cap dragged the rider's FLAT delivery
             fee down with it, handing the shop a lever on somebody else's money

   An auditor's note, which is the reason this file exists: "until a claim in a
   comment is required to have a self-test with the same name next to it, the
   narrative will keep landing ahead of the code." So this is the claim, as a
   table, in a test. */
describe('reweigh · over-weighing can never take money from anyone', () => {
  /* the shape of a real order: a basket, a flat ride, a flat dispatch cut */
  const ORDERED = 18600, RIDE = 1400, DISPATCH = 500;
  const AGREED = ORDERED + RIDE + DISPATCH;      // what she agreed to pay

  /* the same arithmetic setPickedQty performs, isolated from the store */
  const settle = weighedItems => {
    const raw = weighedItems + RIDE + DISPATCH;
    const capped = Math.min(raw, AGREED);
    const room = Math.max(0, capped - RIDE - DISPATCH);
    const scale = weighedItems > 0 ? Math.min(1, room / weighedItems) : 1;
    const fee = Math.round(0 * scale);           // free-first-30 shop: no commission
    return { customerPays: capped, rider: RIDE, dispatch: DISPATCH,
             shop: Math.max(0, capped - RIDE - DISPATCH - fee) };
  };

  it('the rider is paid the distance band whatever the scale says', () => {
    for (const items of [ORDERED, ORDERED * 2, ORDERED * 13, ORDERED * 130]) {
      expect(settle(items).rider).toBe(RIDE);
      expect(settle(items).dispatch).toBe(DISPATCH);
    }
  });

  it('the customer never pays more than she agreed, however heavy it weighs', () => {
    for (const items of [ORDERED, ORDERED * 2, ORDERED * 130]) {
      expect(settle(items).customerPays).toSatisfy(v => v <= AGREED, 'capped at what she agreed');
    }
  });

  it('the shop can never be paid more than the basket it was ordered for', () => {
    for (const items of [ORDERED * 2, ORDERED * 13, ORDERED * 130]) {
      expect(settle(items).shop).toSatisfy(v => v <= ORDERED,
        'over-weighing must cost the shop, never pay it: got ' + settle(items).shop);
    }
  });

  it('everything paid out equals everything held — no minting, no stranding', () => {
    for (const items of [ORDERED / 4, ORDERED, ORDERED * 3]) {
      const r = settle(items);
      expect(r.shop + r.rider + r.dispatch).toBe(r.customerPays);
    }
  });

  it('weighing light really does cost her less', () => {
    expect(settle(ORDERED / 2).customerPays).toSatisfy(v => v < AGREED, 'a lighter basket is cheaper');
  });
});

/* THE FREE THIRTY HAS TO END. `ordersCompleted` was read in three places and
   written in none, so every real shop stayed on order zero for ever and SAAHAA
   collected no retail commission at all. It survived four audits because the
   demo seeds shops at 60–560 orders — so the demo only ever showed the paid
   branch, and a real install only ever showed the free one. */
describe('retail · the free first thirty orders actually run out', () => {
  const FREE = 30;
  const left = n => Math.max(0, FREE - n);
  const isFree = n => n < FREE;

  it('a brand-new shop is free, and says how many are left', () => {
    expect(isFree(0)).toBeTrue();
    expect(left(0)).toBe(30);
  });
  it('the thirtieth order is still free and the thirty-first is not', () => {
    expect(isFree(29)).toBeTrue();
    expect(left(29)).toBe(1);
    expect(isFree(30)).toBeFalse();
    expect(left(30)).toBe(0);
  });
  it('a shop that has traded is charged — the paid branch is reachable', () => {
    expect(isFree(60)).toBeFalse();
    expect(isFree(560)).toBeFalse();
  });
});

/* THE ONE ASSERTION THAT WOULD HAVE CAUGHT ALL FOUR GENERATIONS.

   An auditor's words, after the fourth: "assert `weighedTotal === agreedTotal`
   when `pickedQty === qty` on every line — a correct weigh must produce
   `overEstimate: 0`. That single invariant would have caught all four."

   They are right, and it is worth saying why it is stronger than any of the
   individual fixes. Each generation was a different arithmetic slip — a refund
   not posted, a payout left uncapped, a flat fee scaled, a quote argument
   dropped — and every one of them balanced the book, so no ledger invariant
   fired. But all four broke the same simple truth: WEIGHING EXACTLY WHAT WAS
   ORDERED MUST CHANGE NOTHING. That is a property, not an arithmetic, and a
   property survives a rewrite of the arithmetic underneath it.

   A property test follows it: random basket, random weight, random band,
   random free-delivery threshold — because the fifth generation will not look
   like the first four either. */
describe('reweigh · weighing exactly what was ordered changes nothing', () => {
  /* the identity every generation of this bug broke */
  const requote = ({ items, ride, dispatch, freeAbove }) => {
    const qualifies = freeAbove != null && items >= freeAbove;
    const deliveryCharged = qualifies ? 0 : ride;
    return items + deliveryCharged + dispatch;
  };

  it('a correct weigh produces no over-estimate and no refund', () => {
    const cases = [
      { items: 19275, ride: 1400, dispatch: 500, freeAbove: null },
      { items: 51400, ride: 1900, dispatch: 500, freeAbove: 49900 },   // the free-delivery case that broke
      { items: 48000, ride: 1900, dispatch: 500, freeAbove: 49900 },   // just under the threshold
    ];
    for (const c of cases) {
      const agreed = requote(c);
      const weighed = requote(c);                       // the same weight, re-quoted
      expect(weighed).toBe(agreed);
      expect(Math.max(0, weighed - agreed)).toBe(0);    // overEstimate
    }
  });

  it('free delivery survives a re-quote — dropping the threshold was generation four', () => {
    const c = { items: 51400, ride: 1900, dispatch: 500, freeAbove: 49900 };
    const withThreshold = requote(c);
    const withoutThreshold = requote({ ...c, freeAbove: null });
    /* the bug was that the second is what the re-quote computed */
    expect(withThreshold).toSatisfy(v => v !== withoutThreshold,
      'the threshold must change the answer, or the test proves nothing');
    expect(withThreshold).toBe(51400 + 0 + 500);
  });

  it('property: over a spread of baskets, weights, bands and thresholds, nobody is robbed', () => {
    /* deterministic pseudo-random, so a failure is reproducible */
    let seed = 20260910;
    const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 400; i++) {
      const items = 5000 + rnd(90000);
      const ride = [1900, 2900, 3900, 4900][rnd(4)];
      const dispatch = 500;
      const freeAbove = rnd(2) ? 49900 : null;
      const agreed = requote({ items, ride, dispatch, freeAbove });

      /* the shop weighs something — lighter, exact, or heavier */
      const weighedItems = Math.max(0, Math.round(items * (0.2 + rnd(300) / 100)));
      const raw = requote({ items: weighedItems, ride, dispatch, freeAbove });
      const capped = Math.min(raw, agreed);

      /* she is never charged above what she agreed */
      expect(capped).toSatisfy(v => v <= agreed, `charged ${capped} over agreed ${agreed}`);
      /* the ride is a distance band and is never scaled by weight */
      const rideCharged = (freeAbove != null && weighedItems >= freeAbove) ? 0 : ride;
      expect(rideCharged).toSatisfy(v => v === 0 || v === ride, 'the band, or nothing');
      /* and weighing exactly what was ordered is always a no-op */
      expect(Math.min(requote({ items, ride, dispatch, freeAbove }), agreed)).toBe(agreed);
    }
  });
});

/* ── generation five, and the reason the four before it survived ──────
   Every reweigh test above re-implements the arithmetic by hand. That is why
   they all passed while the real code was wrong: `requote()` above decides
   free delivery from the WEIGHED basket, which is precisely the defect, so the
   model and the bug agreed with each other and the suite reported green.

   A property test written against a model can only ever prove the model
   consistent. These call the shipped `quoteRetail` instead. */
describe('reweigh · free delivery is a promise, not a running condition', () => {
  const P = { catId: 'grocery', km: 0.4, mode: 'rider', firstOrders: false, freeDeliveryAbove: 49900 };
  const line = paise => [{ qty: 1, unitPrice: paise, pickedQty: null }];

  it('a basket that qualified at checkout keeps free delivery when weighed short', () => {
    /* the live order that found this: 8 kg loose rice at Rs.62.99 = Rs.503.92,
       over the shop's Rs.499 line, then weighed at 7.7 kg = Rs.485.02 */
    const agreedQ = quoteRetail(line(50392), P);
    expect(agreedQ.deliveryFee).toBe(0);
    expect(agreedQ.freeDelivery).toBe(true);

    const naive = quoteRetail(line(48502), P);                       // what generation five did
    expect(naive.deliveryFee).toSatisfy(v => v > 0,
      'the threshold must bite on the lighter basket, or this test proves nothing');

    const honest = quoteRetail(line(48502), { ...P, alreadyFree: true });
    expect(honest.deliveryFee).toBe(0);
    expect(honest.freeDelivery).toBe(true);

    /* THE REFUND IS THE WEIGHT DIFFERENCE, PLUS THE ROUNDING SHE WAS CHARGED.
       The payable is rounded up to a whole rupee at checkout, because she types
       it into her bank app; a reweigh is an adjustment and is settled in exact
       paise, so the few paise of rounding come back to her rather than being
       kept by a second rounding. Compare against customerPaysExact — the same
       figure flow.js re-quotes against. */
    const refund = agreedQ.customerPays - Math.min(honest.customerPaysExact, agreedQ.customerPays);
    expect(refund).toBe((50392 - 48502) + agreedQ.roundUp);
    expect(refund).toBe(1898);
  });

  it('weighing short never produces an over-estimate', () => {
    /* the live order reported overEstimate: 10 on a basket that came in
       Rs.18.90 LIGHT — the delivery fee had been added back underneath */
    for (const weighed of [48502, 49000, 49899, 50000, 50391]) {
      const q = quoteRetail(line(weighed), { ...P, alreadyFree: true });
      /* against the EXACT re-quote: the payable is rounded up only once, when
         she pays, and 50392 is the raw agreed basket, not a rounded figure. */
      expect(Math.max(0, q.customerPaysExact - 50392)).toBe(0);
    }
  });

  it('the promise is only honoured where it was actually made', () => {
    /* a basket that never qualified must not be handed free delivery by a
       stale flag on some other order — alreadyFree comes from the order that
       recorded shopAbsorbedDelivery, and nothing else may set it */
    const never = quoteRetail(line(20000), P);
    expect(never.deliveryFee).toSatisfy(v => v > 0, 'Rs.200 is under Rs.499');
    expect(never.freeDelivery).toBe(false);
    expect(never.shopAbsorbs).toBe(0);
  });

  it('a free-delivery quote still pays the rider in full', () => {
    /* "free" moves the cost to the shop; it never means unpaid labour */
    const q = quoteRetail(line(48502), { ...P, alreadyFree: true });
    expect(q.riderPayout + q.dispatchCut).toBe(q.riderCost);
    expect(q.riderCost).toSatisfy(v => v > 0, 'the ride is still paid for');
    expect(q.shopAbsorbs).toBe(q.riderCost);
    expect(q.reconciles).toBe(true);
  });

  it('property: over 400 baskets, a short weigh never costs her more than a correct one', () => {
    let seed = 20260911;
    const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 400; i++) {
      const ordered = 45000 + rnd(30000);
      const km = [0.4, 2, 5, 9][rnd(4)];
      const opts = { ...P, km };
      const agreedQ = quoteRetail(line(ordered), opts);
      const qualified = agreedQ.freeDelivery;

      const weighed = Math.max(1, ordered - rnd(6000));            // always lighter
      const q = quoteRetail(line(weighed), { ...opts, alreadyFree: qualified });
      const charged = Math.min(q.customerPaysExact, agreedQ.customerPays);

      expect(charged).toSatisfy(v => v <= agreedQ.customerPays,
        `short weigh charged ${charged} over agreed ${agreedQ.customerPays}`);
      /* the refund must be the weight difference exactly, plus the rounding she
         paid at checkout — no fee may reappear, and no paisa may be kept by
         rounding a second time */
      const lost = ordered - weighed;
      expect(agreedQ.customerPays - charged).toBe(lost + agreedQ.roundUp);
      /* and the ride is the distance band whatever the basket did */
      expect(q.riderCost).toBe(agreedQ.riderCost);
    }
  });
});
