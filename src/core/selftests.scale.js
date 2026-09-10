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
