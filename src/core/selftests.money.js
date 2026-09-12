/* SAAHAA · core/selftests.money.js — the suites for the v6.1 money and market
   modules. Split from selftests.js because these two are the parts where a
   silent bug costs someone real rupees, and they deserve to be findable. */

import { describe, it, expect } from './selftest.js';
import * as L from '../domain/ledger.js';
import * as BID from '../domain/bidding.js';
import { quoteService, releaseService, GST_RATE } from '../domain/pricing.js';
import * as M from '../core/money.js';
import { ratingOf, ratingLabel } from '../domain/trust.js';
import { CANCEL_RULES, cancelSplit } from '../domain/pricing.js';
import * as W from '../domain/wallet.js';
import { canTransition } from '../domain/orders.js';
import '../domain/state.js';

/* ── LEDGER ────────────────────────────────────────────────── */
describe('ledger · nothing is created and nothing vanishes', () => {
  it('an unbalanced entry is refused outright', () => {
    expect(() => L.entry('BAD', [{ account: 'PLATFORM:fee', delta: 100 }])).toThrow('unbalanced');
  });
  it('a transfer always balances', () => {
    const e = L.transfer('T', L.acct.world(), L.acct.customer('k'), 5000);
    expect(e.legs.reduce((n, l) => n + l.delta, 0)).toBe(0);
  });
  it('an unknown account type is refused', () => {
    expect(() => L.entry('X', [{ account: 'MARS:x', delta: 1 },
                               { account: 'PLATFORM:fee', delta: -1 }])).toThrow('unknown account');
  });
  it('a full booking-to-settlement story leaves the book at exactly zero', () => {
    const q = quoteService(100000);
    const es = [
      L.post.topUp('cust', q.customerPays),
      L.post.lock('cust', 'ord1', q.customerPays),
      L.post.release({ orderId: 'ord1', partnerId: 'p1', payout: q.deal,
                       fee: q.platformFee, gst: q.gst, refundTo: 'cust', refund: 0,
                       holdback: L.holdbackFor(q.deal, 0) }),
    ];
    const inv = L.checkInvariants(es);
    expect(inv.ok).toBeTrue();
    expect(L.balanceOf(es, 'ESCROW:ord1')).toBe(0);
    expect(L.balanceOf(es, 'PLATFORM:fee')).toBe(q.platformFee);
    expect(L.balanceOf(es, 'PLATFORM:gst')).toBe(q.gst);
  });
  it('the pro keeps their full quote, minus only the temporary holdback', () => {
    const q = quoteService(100000);
    const hb = L.holdbackFor(q.deal, 0);
    const es = [L.post.topUp('c', q.customerPays), L.post.lock('c', 'o', q.customerPays),
      L.post.release({ orderId: 'o', partnerId: 'p', payout: q.deal, fee: q.platformFee,
                       gst: q.gst, refundTo: 'c', holdback: hb })];
    expect(L.balanceOf(es, 'PARTNER:p') + L.balanceOf(es, 'HOLDBACK:p')).toBe(q.deal);
  });
  it('the holdback is capped, so it never becomes a real cost of joining', () => {
    expect(L.holdbackFor(100000, 0)).toBe(10000);
    expect(L.holdbackFor(100000, L.HOLDBACK_CAP)).toBe(0);
  });
  it('a partial release still balances and refunds the difference', () => {
    const r = releaseService(100000, 0.6);
    const es = [L.post.topUp('c', 110000), L.post.lock('c', 'o', 110000),
      L.post.release({ orderId: 'o', partnerId: 'p', payout: r.workerPayout,
                       fee: r.platformFee, gst: r.gst, refundTo: 'c', refund: r.refund })];
    expect(L.checkInvariants(es).ok).toBeTrue();
  });
  it('a cancellation splits escrow without losing a paisa', () => {
    const es = [L.post.topUp('c', 110000), L.post.lock('c', 'o', 110000),
      L.post.cancel({ orderId: 'o', customerKey: 'c', refund: 99000,
                      partnerId: 'p', compensation: 5000, fee: 6000 })];
    expect(L.checkInvariants(es).ok).toBeTrue();
    expect(L.balanceOf(es, 'ESCROW:o')).toBe(0);
  });
  it('a tampered book is detected rather than silently trusted', () => {
    const es = [L.post.topUp('c', 1000)];
    es[0].legs[0].delta = -999;                  // someone edited the ledger
    const inv = L.checkInvariants(es);
    expect(inv.ok).toBeFalse();
    expect(inv.fatal).toBeTrue();
  });
  it('v6.0 single-move entries still replay, so old books are not orphaned', () => {
    const legacy = [
      { kind: 'TOPUP',     partyA: 'WORLD:funding', partyB: 'CUSTOMER:c', amountPaise: 5000 },
      { kind: 'ESCROW_IN', partyA: 'CUSTOMER:c',    partyB: 'ESCROW:o',   amountPaise: 5000 },
    ];
    expect(L.balanceOf(legacy, 'ESCROW:o')).toBe(5000);
    expect(L.checkInvariants(legacy).ok).toBeTrue();
  });
});

/* ── BIDDING ───────────────────────────────────────────────── */
describe('bidding · the band makes "reasonably" mechanical', () => {
  const band = () => BID.priceBand('plumbing');

  it('the band is ordered, and the floor never drops below the travel minimum', () => {
    for (const c of ['plumbing', 'laundry', 'electrical', 'cleaning', 'appliance']) {
      const b = BID.priceBand(c);
      expect(b.floor <= b.target).toBeTrue();
      expect(b.target <= b.ceiling).toBeTrue();
      expect(b.floor >= BID.ABS_MIN).toBeTrue();
    }
  });
  it('a bid outside the band is refused', () => {
    const b = band();
    expect(BID.validateBid(b.floor - 100, b).ok).toBeFalse();
    expect(BID.validateBid(b.ceiling + 100, b).ok).toBeFalse();
    expect(BID.validateBid(b.target, b).ok).toBeTrue();
  });
  it('THE ANTI-RACE LEVER: the price score peaks at fair value, not at the floor', () => {
    const b = band();
    expect(BID.priceScore(b.target, b)).toBe(1);
    expect(BID.priceScore(b.floor, b) < 1).toBeTrue();
    expect(BID.priceScore(b.ceiling, b) < 1).toBeTrue();
  });
  it('undercutting to the floor does not win on its own', () => {
    const b = band();
    const far  = { id: 'p1', name: 'Far', area: 'Uppal', cat: 'plumbing', tier: 1,
                   completed: 0, ratings: [], lastActiveTs: Date.now() };
    const near = { id: 'p2', name: 'Near', area: 'Madhapur', cat: 'plumbing', tier: 3,
                   completed: 120, lastActiveTs: Date.now(),
                   ratings: Array(20).fill({ stars: 5, ts: Date.now() }) };
    const cheap = BID.scoreBid({ amount: b.floor,  afterSeconds: 800 }, far,  b, { area: 'Madhapur' });
    const fair  = BID.scoreBid({ amount: b.target, afterSeconds: 60  }, near, b, { area: 'Madhapur' });
    expect(fair.score > cheap.score).toBeTrue();
  });
  it('the scoring weights sum to exactly 100', () => {
    expect(Object.values(BID.WEIGHTS).reduce((a, x) => a + x, 0)).toBe(100);
  });
  it('bidding is banned wherever an auction would harm someone', () => {
    expect(BID.biddingAllowed('health').allowed).toBeFalse();                 // licence-gated
    expect(BID.biddingAllowed('help').allowed).toBeFalse();                   // care work
    expect(BID.biddingAllowed('plumbing', { urgent: true }).allowed).toBeFalse();
    expect(BID.biddingAllowed('plumbing', { poolSize: 2 }).allowed).toBeFalse();
    expect(BID.biddingAllowed('plumbing', { poolSize: 12 }).allowed).toBeTrue();
  });
  it('an honest bidder cannot be haggled with', () => {
    const b = band();
    expect(BID.counterOffer({ amount: b.target }, b).available).toBeFalse();
    expect(BID.counterOffer({ amount: b.floor }, b).available).toBeFalse();
    expect(BID.counterOffer({ amount: b.ceiling }, b).available).toBeTrue();
  });
  it('a counter-offer can never push a bid below the floor', () => {
    const b = band();
    expect(BID.counterOffer({ amount: b.ceiling }, b).amount >= b.floor).toBeTrue();
  });
  it('only one counter per request, ever — no haggling loop', () => {
    const b = band();
    expect(BID.counterOffer({ amount: b.ceiling }, b, { counterUsed: true }).available).toBeFalse();
  });
  it('a scripted sniper gains nothing under twenty seconds', () => {
    expect(BID.quicknessScore(1)).toBe(BID.quicknessScore(20));
  });
  it('a new pro is shielded rather than buried by the rating score', () => {
    expect(BID.ratingScore({ completed: 0, ratings: [] }) >= 0.6).toBeTrue();
  });
  it('five friends rating 5.0 lose to forty real jobs at 4.6', () => {
    const friends = BID.ratingScore({ completed: 5, ratings: Array(5).fill({ stars: 5, ts: Date.now() }) });
    const real    = BID.ratingScore({ completed: 40, ratings: Array(40).fill({ stars: 4.6, ts: Date.now() }) });
    expect(real > friends).toBeTrue();
  });
  it('the losing bidder is told what actually beat them', () => {
    const b = band();
    const p = { id: 'x', name: 'X', area: 'Uppal', tier: 1, completed: 0, ratings: [], lastActiveTs: Date.now() };
    const w = { id: 'y', name: 'Y', area: 'Madhapur', tier: 4, completed: 200, lastActiveTs: Date.now(),
                ratings: Array(20).fill({ stars: 5, ts: Date.now() }) };
    const mine = BID.scoreBid({ amount: b.floor,  afterSeconds: 600 }, p, b, { area: 'Madhapur' });
    const win  = BID.scoreBid({ amount: b.target, afterSeconds: 30  }, w, b, { area: 'Madhapur' });
    expect(BID.loserFeedback(mine, win).message).toContain('cheaper');
  });
  it('quote-based categories get no percentage band at all', () => {
    expect(BID.priceBand('moving').quoteOnly).toBeTrue();
    expect(BID.priceBand('events').quoteOnly).toBeTrue();
  });
  it('the auction clock closes early once the bid cap is reached', () => {
    const now = Date.now();
    const req = { openedAt: now - 1000, closesAt: now + 600000, slotType: 'now',
                  bids: Array(BID.MAX_BIDS).fill({}) };
    expect(BID.auctionState(req, now).phase).toBe('awaiting_choice');
  });
});

/* ── the auction, as a mechanism ────────────────────────────── */
describe('auction mechanism', () => {
  const band = () => BID.priceBand('appliance');

  it('a counter can never land BELOW the fair price', () => {
    // A flat -7% off a bid just above target used to cross under it, which is
    // the haggle button defeating the anti-undercutting rule it sits inside.
    const b = band();
    const justAbove = b.target + 100;
    const c = BID.counterOffer({ amount: justAbove }, b, {});
    if (c.available) expect(c.amount >= b.target).toBeTrue();
  });
  it('a pro who already bid at or below fair cannot be haggled with at all', () => {
    const b = band();
    expect(BID.counterOffer({ amount: b.target }, b, {}).available).toBeFalse();
    expect(BID.counterOffer({ amount: b.floor }, b, {}).available).toBeFalse();
  });
  it('only one counter per request, ever', () => {
    const b = band();
    expect(BID.counterOffer({ amount: b.ceiling }, b, { counterUsed: true }).available).toBeFalse();
  });
  it('undercutting to the floor costs score and wins nothing', () => {
    const b = band();
    expect(BID.priceScore(b.target, b) > BID.priceScore(b.floor, b)).toBeTrue();
    expect(BID.priceScore(b.target, b) > BID.priceScore(b.ceiling, b)).toBeTrue();
  });
  it('a thin market never goes to auction', () => {
    expect(BID.biddingAllowed('appliance', { poolSize: 2 }).reason).toBe('thinSupply');
  });
  it('emergencies and care work are never auctioned', () => {
    expect(BID.biddingAllowed('appliance', { urgent: true }).reason).toBe('emergency');
    expect(BID.biddingAllowed('health', {}).allowed).toBeFalse();
  });
  it('a retail category has no band, so a Rs.1 bid cannot validate', () => {
    expect(BID.priceBand('kirana')).toBe(null);
    expect(BID.validateBid(100, BID.priceBand('kirana')).ok).toBeFalse();
  });
  it('the scoring weights sum to exactly 100', () => {
    expect(Object.values(BID.WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

/* ── the professional gate ──────────────────────────────────── */
import * as Q from '../domain/quiz.js';
describe('verification gate', () => {
  it('every service category has a five-question trade bank', () => {
    ['plumbing','electrical','appliance','cleaning','repair','pest','salon','tutor','pet','moving','laundry',
     'vehicle','help','wellness','health','events'].forEach(c => expect(Q.tradeBank(c).length).toBe(5));
  });
  it('every question has four options and one correct index inside them', () => {
    const all = Object.values(Q.TRADE).flat().concat(Q.CONDUCT, Q.GENERIC);
    all.forEach(q => { expect(q.o.length).toBe(4); expect(q.a >= 0 && q.a < 4).toBeTrue(); });
  });
  it('shuffling keeps the answer attached to its option', () => {
    const bank = Q.shuffled(Q.CONDUCT, 3);
    bank.forEach((item, i) => expect(item.o[item.a]).toBe(Q.CONDUCT[i].o[Q.CONDUCT[i].a]));
  });
  it('the same attempt always shows the same order', () => {
    expect(JSON.stringify(Q.shuffled(Q.CONDUCT, 5))).toBe(JSON.stringify(Q.shuffled(Q.CONDUCT, 5)));
  });
  it('pass marks are 4 of 5 and 5 of 6', () => {
    expect(Q.PASS.trade).toBe(4); expect(Q.PASS.conduct).toBe(5);
    const bank = Q.shuffled(Q.tradeBank('plumbing'), 1);
    const perfect = bank.map(b => b.a);
    expect(Q.score(bank, perfect).right).toBe(5);
    const four = perfect.slice(); four[0] = (four[0] + 1) % 4;
    expect(Q.score(bank, four).right).toBe(4);
  });
  it('an unknown category still gets a bank, so no trade is ever ungated', () => {
    expect(Q.tradeBank('nonsense').length).toBe(5);
  });
});

/* ── the worker wallet and the commitment stake ─────────────── */
import * as WL from '../domain/wallet.js';
import { post as LP } from '../domain/ledger.js';
describe('worker wallet · the stake locks at start and returns in full', () => {
  it('stake is at least the minimum, 5% of the deal, capped', () => {
    expect(WL.stakeFor(50000)).toBe(WL.MIN_STAKE);          // Rs.500 job -> Rs.100 minimum
    expect(WL.stakeFor(400000)).toBe(20000);                // Rs.4,000 job -> 5% = Rs.200
    expect(WL.stakeFor(5000000)).toBe(WL.MAX_STAKE);        // Rs.50,000 job -> capped Rs.500
  });
  it('a stake is funded from the wallet first, the rest on credit', () => {
    expect(WL.fundStake(10000, 25000)).toEqual({ need: 10000, funded: 10000, onCredit: 0 });
    expect(WL.fundStake(10000, 4000)).toEqual({ need: 10000, funded: 4000, onCredit: 6000 });
    expect(WL.fundStake(10000, 0)).toEqual({ need: 10000, funded: 0, onCredit: 10000 });
  });
  it('lock then return leaves the wallet exactly where it started; the ledger balances', () => {
    const P = 'p1';
    const legs = [
      { kind: 'TOPUP',          amountPaise: 30000, partyA: 'WORLD:funding', partyB: 'PARTNER:' + P, ts: 1 },
      { kind: 'STAKE_LOCK',     amountPaise: 10000, partyA: 'PARTNER:' + P,  partyB: 'STAKE:' + P,   ts: 2 },
    ];
    let w = WL.walletOf(legs, P);
    expect(w.available).toBe(20000); expect(w.locked).toBe(10000);
    legs.push({ kind: 'STAKE_RELEASE', amountPaise: 10000, partyA: 'STAKE:' + P, partyB: 'PARTNER:' + P, ts: 3 });
    legs.push({ kind: 'ESCROW_RELEASE', amountPaise: 60000, partyA: 'ESCROW:o1', partyB: 'PARTNER:' + P, ts: 4 });
    w = WL.walletOf(legs, P);
    expect(w.available).toBe(90000); expect(w.locked).toBe(0); expect(w.released).toBe(60000);
  });
  it('a forfeit moves the funded stake to the customer, never to the platform', () => {
    const P = 'p2';
    const legs = [
      { kind: 'TOPUP',         amountPaise: 10000, partyA: 'WORLD:funding', partyB: 'PARTNER:' + P, ts: 1 },
      { kind: 'STAKE_LOCK',    amountPaise: 10000, partyA: 'PARTNER:' + P,  partyB: 'STAKE:' + P,   ts: 2 },
      { kind: 'STAKE_FORFEIT', amountPaise: 10000, partyA: 'STAKE:' + P,    partyB: 'CUSTOMER:c1',  ts: 3 },
    ];
    const w = WL.walletOf(legs, P);
    expect(w.available).toBe(0); expect(w.locked).toBe(0);
  });
  it('a holdback is due only after seven days and only once', () => {
    const now = Date.now(); const P = 'p3';
    const legs = [
      { id: 'h1', kind: 'HOLDBACK', amountPaise: 5000, partyA: 'PARTNER:' + P, partyB: 'HOLDBACK:' + P, ts: now - 8 * 86400000 },
      { id: 'h2', kind: 'HOLDBACK', amountPaise: 5000, partyA: 'PARTNER:' + P, partyB: 'HOLDBACK:' + P, ts: now - 2 * 86400000 },
    ];
    expect(WL.holdbackDue(legs, now).map(e => e.id)).toEqual(['h1']);
    legs.push({ id: 'r1', kind: 'HOLDBACK_RELEASE', amountPaise: 5000, partyA: 'HOLDBACK:' + P, partyB: 'PARTNER:' + P, ts: now, meta: { of: 'h1' } });
    expect(WL.holdbackDue(legs, now)).toHaveLength(0);
  });
});

/* ── the owner's dials ──────────────────────────────────────── */
import * as S from '../domain/settings.js';
describe('settings · the owner dials', () => {
  it('defaults are the launch economics', () => {
    const P = S.DEFAULT_PRICING;
    expect(P.serviceMarkupPct).toBe(8); expect(P.retailTakePct).toBe(3); expect(P.deliveryBands.length).toBe(4);
  });
  it('validation refuses nonsense and keeps the certified rate under the standard one', () => {
    expect(S.validatePricing({ serviceMarkupPct: 45 }).ok).toBeFalse();
    expect(S.validatePricing({ serviceMarkupPct: 'x' }).ok).toBeFalse();
    expect(S.validatePricing({ serviceMarkupPct: 8, loyaltyMarkupPct: 9 }).ok).toBeFalse();
    expect(S.validatePricing({ serviceMarkupPct: 10, retailTakeCapPaise: 3000 }).ok).toBeTrue();
  });
  it('a pushed service rate changes the next quote, with GST still 18% of the fee', () => {
    const before = quoteService(100000);
    const r = S.pushPricing({ serviceMarkupPct: 10 }, 'test');
    expect(r.ok).toBeTrue();
    const after = quoteService(100000);
    expect(after.customerPays).toBe(110000);
    expect(after.workerPayout).toBe(100000);
    expect(Math.abs(after.gst - Math.round(after.platformFee * GST_RATE)) <= 1).toBeTrue();
    S.pushPricing({ serviceMarkupPct: 8 }, 'test');
    expect(quoteService(100000).customerPays).toBe(before.customerPays);
  });
  it('delivery bands are sorted and always end at 999 km', () => {
    const r = S.validatePricing({ deliveryBands: [{ maxKm: 6, fee: 3900 }, { maxKm: 2, fee: 1900 }] });
    expect(r.ok).toBeTrue();
    expect(r.clean.deliveryBands[0].maxKm).toBe(2);
    expect(r.clean.deliveryBands[r.clean.deliveryBands.length - 1].maxKm).toBe(999);
  });
});

/* ── retail settlement · every rupee the customer paid leaves escrow ─────
   The dispatch cut posted at settlement is the RESIDUAL of the customer's
   payment after the shop, the fee and the rider. On a free-delivery rider
   order the customer's delivery line is ₹0 while the rider is still paid out
   of the shop's share — the old "deliveryFee − riderPayout" formula posted a
   ₹0 cut there and stranded the carved ₹5 in escrow (ledger replay ≠ 0). */
import { quoteRetail } from '../domain/pricing.js';
describe('retail settlement · the dispatch cut is the residual, so escrow empties exactly', () => {
  const lines = [{ unitPrice: 30000, qty: 2 }];              // ₹600 basket
  const residual = q => q.customerPays - q.shopPayout - q.platformFee - q.riderPayout;
  const cases = {
    'rider, delivery charged':          { mode: 'rider',  km: 2 },
    'rider, free delivery over ₹499':   { mode: 'rider',  km: 2, freeDeliveryAbove: 49900 },
    'shop delivers itself':             { mode: 'self',   km: 2 },
    'customer picks up':                { mode: 'pickup', km: 2 },
  };
  for (const [name, opts] of Object.entries(cases)) {
    it(name, () => {
      const q = quoteRetail(lines, { catId: 'kirana', ...opts });
      expect(q.reconciles).toBeTrue();
      expect(residual(q)).toBe(q.dispatchCut);
      expect(residual(q)).toSatisfy(n => n >= 0, 'never negative');
      expect(q.shopPayout + q.platformFee + q.riderPayout + residual(q)).toBe(q.customerPays);
    });
  }
  it('free delivery really is free to the customer and the rider is still paid', () => {
    const q = quoteRetail(lines, { catId: 'kirana', mode: 'rider', km: 2, freeDeliveryAbove: 49900 });
    expect(q.deliveryFee).toBe(0);
    expect(q.freeDelivery).toBeTrue();
    expect(q.riderPayout).toSatisfy(n => n > 0, 'rider paid');
    expect(residual(q)).toSatisfy(n => n > 0, 'the cut is carved even when the customer pays nothing for delivery');
  });
});

/* ── a rating nobody gave ──────────────────────────────────────
   The same unrated plumber read 4.5 ★ in the "open now" list, 4.2 ★ on his bid
   card and unrated on his own profile, because three screens each invented a
   different fallback. A customer comparing two bids was comparing one real
   average against one made-up number, on the most trust-loaded card in the
   product — and the bid card carried a comment promising it never did that. */
describe('ratings · an unrated pro is never given a score', () => {
  const unrated = { id: 'p1', completed: 0, ratings: [] };
  const newish  = { id: 'p2', completed: 4, ratings: [] };
  const rated   = { id: 'p3', completed: 9, ratings: [{ stars: 5 }, { stars: 4 }] };

  it('no ratings means no average — not 4.5, not 4.2, not zero-dressed-as-a-score', () => {
    expect(ratingOf(unrated).avg).toBe(null);
    expect(ratingOf(newish).avg).toBe(null);
    expect(ratingOf(null).avg).toBe(null);
    expect(ratingOf(unrated).count).toBe(0);
  });

  it('a real average is the real average, and carries how many gave it', () => {
    expect(ratingOf(rated).avg).toBe(4.5);
    expect(ratingOf(rated).count).toBe(2);
    expect(ratingLabel(rated)).toBe('4.5 ★ · 2');
  });

  it('the label prints what we actually know instead of a star figure', () => {
    expect(ratingLabel(unrated)).toBe('New');
    expect(ratingLabel(newish)).toBe('New · 4 jobs');
    expect(ratingLabel({ completed: 1, ratings: [] })).toBe('New · 1 job');
  });

  it('no label anywhere contains a star for somebody nobody rated', () => {
    for (const p of [unrated, newish, { completed: 300, ratings: [] }]) {
      expect(ratingLabel(p).includes('★')).toBe(false);
    }
  });
});

/* ── cancelling early must not cost what not turning up costs ──
   The pro's sheet promised "you keep your stake, and this is recorded as a
   cancellation, not a no-show", and the engine forfeited the stake to the
   customer on WORKER_CANCEL exactly as it did on WORKER_NO_SHOW. A pro who did
   the honest thing the agreement asks of him lost the same money as one who
   simply did not turn up — so there was no reason left to cancel, which is the
   entire behaviour the feature exists to buy. Meanwhile the Rs.100 the public
   refunds page has charged him in writing since 8.0 was collected by nothing. */
describe('cancellation · the honest route has to be the cheaper one', () => {
  const DEAL = 52000;

  it('the two rules are not the same act', () => {
    const cancel = CANCEL_RULES.WORKER_CANCEL, noshow = CANCEL_RULES.WORKER_NO_SHOW;
    expect(cancel.refundPct).toBe(1.00);
    expect(noshow.refundPct).toBe(1.00);
    /* she is made whole either way — the difference is what it costs HIM */
    expect(cancel.workerFee | 0).toSatisfy(v => v > 0, 'an early cancel carries a real fee');
  });

  it('the published fee is a real number the app can charge', () => {
    const s = cancelSplit(DEAL, 'WORKER_CANCEL');
    expect(s.workerFee).toBe(CANCEL_RULES.WORKER_CANCEL.workerFee);
    expect(s.workerFee).toBe(4000);               // Rs.40, as printed on the refunds page
  });

  it('a cancelled job still refunds her every paisa she paid', () => {
    const q = quoteService(DEAL);
    const s = cancelSplit(DEAL, 'WORKER_CANCEL');
    expect(s.refund).toBe(q.customerPays);
    expect(s.worker).toBe(0);
  });

  it('the fee is smaller than the SMALLEST stake, at every job size there is', () => {
    /* the whole point: telling her now must cost him less than walking away.
       Measuring that against one deal was not enough — the fee was Rs.100 and
       equalled the stake on the ordinary Rs.520 job while passing at Rs.5,000.
       `stakeFor` never returns below MIN_STAKE, so clearing that clears all. */
    expect(CANCEL_RULES.WORKER_CANCEL.workerFee).toSatisfy(v => v < W.MIN_STAKE,
      `Rs.${CANCEL_RULES.WORKER_CANCEL.workerFee / 100} fee vs the Rs.${W.MIN_STAKE / 100} floor stake`);
    for (const deal of [20000, 52000, 150000, 500000, 2000000]) {
      expect(CANCEL_RULES.WORKER_CANCEL.workerFee).toSatisfy(v => v < W.stakeFor(deal),
        `cancelling must beat no-showing on a Rs.${deal / 100} job`);
    }
  });

  it('he can actually reach the control from every stage he might need it', () => {
    for (const stage of ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) {
      expect(canTransition(stage, 'CANCELLED')).toBe(true);
    }
  });
});

/* ── the shapes the fifth audit found ─────────────────────────
   Each of these is a claim the product made in writing and could not keep.
   They are pinned as arithmetic and as state-machine edges, which is all that
   can be pinned without a store — the journeys themselves are driven in the
   browser. What matters is that a later edit cannot quietly close the door
   again, because closing it fails here. */
describe('cancellation · SAAHAA cannot keep money it never receives', () => {
  it('every rule splits the whole customer price into three named parts', () => {
    for (const rule of Object.keys(CANCEL_RULES)) {
      for (const deal of [20000, 52000, 150000]) {
        const q = quoteService(deal);
        const s = cancelSplit(deal, rule);
        expect(s.refund + s.worker + s.platform).toBe(q.customerPays,
          `${rule} at ${deal}: ${s.refund}+${s.worker}+${s.platform} != ${q.customerPays}`);
      }
    }
  });
  it('the rules that keep a share actually have one to post', () => {
    /* the bug: `platform` was computed, printed on the cancel sheet, and never
       posted, so it stayed in the escrow of a CANCELLED order for ever */
    expect(cancelSplit(52000, 'EN_ROUTE').platform).toSatisfy(v => v > 0, 'EN_ROUTE keeps a share');
    expect(cancelSplit(52000, 'LATE_2H').platform).toSatisfy(v => v > 0, 'LATE_2H keeps a share');
    expect(cancelSplit(52000, 'BEFORE_ACCEPT').platform).toBe(0, 'and an early cancel keeps nothing');
  });
});

describe('on-site pricing · the promise on the booking sheet has edges to run on', () => {
  it('a pro who has arrived can put a price up for approval', () => {
    expect(canTransition('ARRIVED', 'AWAITING_APPROVAL')).toBe(true);
  });
  it('she can agree, and it goes back to the doorstep — not straight to work', () => {
    /* approving a price is not starting the job: the code is still typed */
    expect(canTransition('AWAITING_APPROVAL', 'ARRIVED')).toBe(true);
  });
  it('she can refuse, and the job ends there', () => {
    expect(canTransition('AWAITING_APPROVAL', 'CANCELLED')).toBe(true);
  });
  it('a refusal is a rule that costs her nothing and holds nothing against him', () => {
    const r = CANCEL_RULES.AFTER_ACCEPT_2H;
    expect(r.refundPct).toBe(1);
    expect(r.workerFee | 0).toBe(0);
  });
});

describe('returns · a shop that says no is not overruled by a clock', () => {
  it('a contested return can reach a person', () => {
    expect(canTransition('R_RETURN', 'DISPUTED')).toBe(true);
  });
  it('and a disputed retail order can still be closed by the owner', () => {
    expect(canTransition('DISPUTED', 'R_REFUNDED')).toBe(true);
    expect(canTransition('DISPUTED', 'R_CANCELLED')).toBe(true);
  });
});

/* ── the bills have to add up on screen ────────────────────────
   A real order printed "₹685 + ₹46 + ₹8" under a total reading "You pay ₹740",
   and the wallet passbook — labelled "hash-chained: verified, never edited" —
   summed to minus one rupee against a printed balance of zero. Every paise
   underneath was exact; only the display was wrong, which is the worst version:
   a correct ledger failing its own published audit claim in front of somebody
   who checks the arithmetic in her head.

   Rounding is not distributive. These pin the only fix that works. */
describe('money · what is printed must sum to what is printed', () => {
  it('the parts add up to the total, on a bill that genuinely drifts', () => {
    /* ₹685.50 + ₹10.50 + ₹10.50 = ₹706.50. Rounded independently that is
       686 + 11 + 11 = ₹708 under a total printing ₹707 — the shape the audit
       found on a live order. */
    const parts = [68550, 1050, 1050];
    const total = 70650;
    const naive = parts.reduce((n, p) => n + Math.round(p / 100), 0);
    expect(naive).toBe(708, 'rounding each part independently really does drift');
    expect(Math.round(total / 100)).toBe(707, 'and the total rounds the other way');
    const out = M.roundParts(parts, total);
    expect(out.reduce((a, b) => a + b, 0)).toBe(70700, 'the parts now sum to the printed total');
  });

  it('it holds over a spread of awkward totals', () => {
    let seed = 20260911;
    const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 300; i++) {
      const n = 2 + rnd(4);
      const parts = Array.from({ length: n }, () => 1 + rnd(90000));
      const total = parts.reduce((a, b) => a + b, 0);
      const out = M.roundParts(parts, total);
      expect(out.reduce((a, b) => a + b, 0)).toBe(Math.round(total / 100) * 100,
        `parts ${parts} did not sum to the rounded total ${total}`);
      for (const p of out) expect(p % 100).toBe(0, 'every part is a whole rupee');
    }
  });

  it('a rupee of drift lands where it shows least — never on the smallest line', () => {
    /* moving ₹1 onto a ₹10.50 GST line is a 10% error on screen; onto ₹685.50
       it is invisible and still true to the paise underneath */
    const out = M.roundParts([68550, 1050, 1050], 70650);
    expect(out[0]).toBe(68500, 'the correction went to the largest line');
    expect(out[1]).toBe(1100, 'the small lines are left alone');
    expect(out[2]).toBe(1100, 'both of them');
  });

  it('nothing is ever pushed below zero to make a total work', () => {
    const out = M.roundParts([40, 60, 100000], 100100);
    for (const p of out) expect(p >= 0).toBe(true, 'a negative line is not a rounding');
  });

  it('and it degrades honestly on the shapes a caller can pass', () => {
    expect(M.roundParts([], 0).length).toBe(0);
    expect(M.roundParts([12345]).reduce((a, b) => a + b, 0)).toBe(12300);
    expect(M.fmtParts([68550, 1050, 1050], 70650).join(' ')).toBe('₹685 ₹11 ₹11');
  });
});

/* ── WHAT SHE TYPES INTO HER BANK APP ──────────────────────────
   The manual UPI rail asks her to transfer an exact amount. It asked for
   ₹434.59 while the bill beside it read ₹435 — two totals for one order, and
   since nobody types 59 paise, every manual order would reconcile 41 paise
   over, for as long as the rail runs. The payable is now a whole rupee,
   rounded UP, with the rounding falling on SAAHAA's side. */
describe('payable · she never types paise', () => {
  it('a service total is always a whole rupee, over the whole price range', () => {
    for (let d = 1; d <= 500000; d += 997) {              // ₹0.01 to ₹5,000, odd step
      const q = quoteService(d);
      expect(q.customerPays % 100).toBe(0);
    }
  });

  it('the rounding is never taken from the pro', () => {
    for (const d of [40200, 30000, 1, 99, 12345, 87654]) {
      const q = quoteService(d);
      expect(q.workerPayout).toBe(d);                      // he keeps his quote, always
      expect(q.roundUp).toSatisfy(v => v >= 0 && v < 100, 'at most 99 paise, never negative');
      expect(q.customerPays).toBe(q.customerPaysExact + q.roundUp);
    }
  });

  it('the split still adds up to the number she sends', () => {
    for (let d = 100; d <= 200000; d += 733) {
      const q = quoteService(d);
      expect(q.workerPayout + q.platformFee + q.gst).toBe(q.customerPays);
    }
  });

  it('and the figure she is shown carries no paise either', async () => {
    /* The rounding fixed the number; three screens still PRINTED it as
       "₹435.00" — her transfer box, the pro's confirm panel, and the admin's
       clearing queue — beside a bill reading "₹435". The same figure written
       two ways on the screens that have to agree. */
    const pay = await import('../domain/payments.js');
    for (const total of [43500, 56200, 100, 250000]) {
      const ins = pay.instruction({ id: 'ord_x', customerPays: total });
      expect(ins.amountText.includes('.')).toBe(false);
      expect(ins.amount).toBe(total);
    }
    /* and if one ever does carry paise, she must still be told exactly */
    expect(pay.instruction({ id: 'ord_x', customerPays: 43459 }).amountText).toBe('₹434.59');
  });

  it('rounds UP, never down — she is never asked for less than the parts', () => {
    const q = quoteService(40200);                          // ₹402 + 8% = ₹434.16
    expect(q.customerPaysExact).toBe(43416);
    expect(q.customerPays).toBe(43500);                     // ₹435, not ₹434
    expect(q.customerPays).toSatisfy(v => v >= q.customerPaysExact, 'never below the true cost');
  });
});
