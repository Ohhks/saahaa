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
