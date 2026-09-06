/* SAAHAA · core/selftests.money.js — the suites for the v6.1 money and market
   modules. Split from selftests.js because these two are the parts where a
   silent bug costs someone real rupees, and they deserve to be findable. */

import { describe, it, expect } from './selftest.js';
import * as L from '../domain/ledger.js';
import * as BID from '../domain/bidding.js';
import { quoteService, releaseService, GST_RATE } from '../domain/pricing.js';

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
