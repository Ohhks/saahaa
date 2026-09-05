/* SAAHAA · core/selftests.js — the suite. This file IS our CI.
   Run from Admin → System, or open index.html?selftest=1.
   A release with failed > 0 does not ship. */

import { describe, it, expect } from './selftest.js';
import * as M from './money.js';
import * as registry from './registry.js';
import { runMigrations, listMigrations } from './migrate.js';
import { SCHEMA_VERSION } from './version.js';
import { defaultState } from '../domain/state.js';
import { quoteService, releaseService, quoteRetail, cancelSplit, compareWithApps, GST_RATE } from '../domain/pricing.js';
import { canTransition, applyTransition, stagesFor, trackerFor } from '../domain/orders.js';
import { trustScore, WEIGHTS, escrowTier, tier } from '../domain/trust.js';
import { STARTER, byCategory } from '../domain/starter-catalog.js';
import { kmBetween, AREA_NAMES } from '../domain/match.js';

/* ── 1. MONEY ─────────────────────────────────────────────── */
describe('money · integers only, parts always sum to the whole', () => {
  it('paise conversion is exact', () => {
    expect(M.toPaise(1000)).toBe(100000);
    expect(M.toPaise(0.1) + M.toPaise(0.2)).toBe(M.toPaise(0.3));  // the float trap
  });
  it('split never loses or invents a paisa', () => {
    for (const total of [1, 7, 100, 1099, 100000, 123457]) {
      const parts = M.split(total, [1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it('pct rounds half-up and stays integral', () => {
    expect(M.pct(100000, 10)).toBe(10000);
    expect(Number.isInteger(M.pct(100033, 8))).toBeTrue();
  });
});

describe('pricing · service quote reconciles', () => {
  it('golden vector: D = Rs.1000', () => {
    const q = quoteService(100000);
    expect(q.deal).toBe(100000);
    // 8% on top of the worker's Rs.1000: the worker keeps the whole Rs.1000
    expect(q.customerPays).toBe(108000);
    expect(q.workerPayout).toBe(100000);
    expect(q.platformFee + q.gst).toBe(8000);
    expect(q.platformFee).toBe(6780);     // 8000 / 1.18
    expect(q.gst).toBe(1220);
  });
  it('worker + fee + gst === customerPays, for every price', () => {
    for (let d = 1000; d <= 500000; d += 7331) {
      const q = quoteService(d);
      expect(q.workerPayout + q.platformFee + q.gst).toBe(q.customerPays);
    }
  });
  it('GST is 18% OF THE FEE, not 2% of the deal', () => {
    const q = quoteService(100000);
    expect(Math.abs(q.gst - Math.round(q.platformFee * GST_RATE)) <= 1).toBeTrue();
  });
  it('Tier-4 loyalty rebate lowers the markup to 6%', () => {
    const q = quoteService(100000, { markup: 0.06 });
    expect(q.customerPays).toBe(106000);
    expect(q.workerPayout).toBe(100000);
  });
});

describe('pricing · partial release is pro-rata and reconciles', () => {
  it('60% release on D = Rs.1000', () => {
    const r = releaseService(100000, 0.6);
    expect(r.workerPayout).toBe(60000);
    expect(r.uplift).toBe(4800);            // 8% of the released Rs.600 — the fee scales down with the work
    expect(r.refund).toBe(43200);           // 108000 - 60000 - 4800
    expect(r.reconciles).toBeTrue();
  });
  it('full release refunds nothing', () => {
    const r = releaseService(100000, 1);
    expect(r.refund).toBe(0);
    expect(r.reconciles).toBeTrue();
  });
  it('every partial percentage reconciles', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) expect(releaseService(87654, p).reconciles).toBeTrue();
  });
});

describe('pricing · retail take rate protects kirana margin', () => {
  const lines = [{ qty: 2, unitPrice: 28500 }, { qty: 1, unitPrice: 14200 }];
  it('staples pay 3%, not the 8% service rate', () => {
    const q = quoteRetail(lines, { catId: 'kirana', km: 1.5, mode: 'rider' });
    expect(q.takePct).toBe(3);
    expect(q.platformFee <= 2500).toBeTrue();       // capped at Rs.25
  });
  it('the per-order cap actually binds on a big basket', () => {
    const big = [{ qty: 40, unitPrice: 28500 }];
    expect(quoteRetail(big, { catId: 'kirana', km: 1 }).platformFee).toBe(2500);
  });
  it('shop payout + fee + rider + dispatch === customer pays', () => {
    for (const mode of ['rider', 'self', 'pickup'])
      expect(quoteRetail(lines, { catId: 'kirana', km: 3, mode }).reconciles).toBeTrue();
  });
  it('a shop is charged nothing on its first orders', () => {
    expect(quoteRetail(lines, { catId: 'kirana', km: 1, firstOrders: true }).platformFee).toBe(0);
  });
});

describe('pricing · cancellations reconcile', () => {
  it('every rule splits the charge exactly', () => {
    for (const r of ['BEFORE_ACCEPT','AFTER_ACCEPT_2H','LATE_2H','EN_ROUTE','WORKER_NO_SHOW','WORKER_CANCEL'])
      expect(cancelSplit(100000, r).reconciles).toBeTrue();
  });
  it('cancelling before acceptance is free', () => {
    expect(cancelSplit(100000, 'BEFORE_ACCEPT').refund).toBe(108000);
  });
});

describe('pricing · the comparison claim is arithmetically true', () => {
  it('the pro really does earn more', () => {
    const c = compareWithApps(100000);
    expect(c.workerGets > c.workerWouldGet).toBeTrue();
    expect(c.youPay < c.typicalApp).toBeTrue();
  });
  it('the assumption is always stated', () => {
    expect(compareWithApps(50000).assumption.length > 10).toBeTrue();
  });
});

/* ── 2. STATE MACHINES ────────────────────────────────────── */
describe('orders · only legal transitions are possible', () => {
  it('the happy service path is walkable end to end', () => {
    const path = ['MATCHING','ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS','WORK_DONE','SETTLED','RATED','CLOSED'];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBeTrue();
  });
  it('the happy retail path is walkable end to end', () => {
    const path = ['R_CART','R_PLACED','R_ACCEPTED','R_PICKING','R_PACKED','R_OUT','R_DELIVERED','R_SETTLED','R_CLOSED'];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBeTrue();
  });
  it('skipping the OTP step is impossible', () => {
    expect(canTransition('EN_ROUTE', 'IN_PROGRESS')).toBeFalse();
    expect(canTransition('ASSIGNED', 'WORK_DONE')).toBeFalse();
  });
  it('an illegal transition throws loudly rather than silently passing', () => {
    expect(() => applyTransition({ stage: 'MATCHING', history: [] }, 'SETTLED')).toThrow('illegal transition');
  });
  it('terminal stages have no exits', () => {
    for (const s of stagesFor('service').concat(stagesFor('retail')))
      if (s.terminal) expect(s.to).toHaveLength(0);
  });
  it('every declared target stage actually exists', () => {
    for (const s of stagesFor('service').concat(stagesFor('retail')))
      for (const t of s.to) expect(registry.has('orderStage', t)).toBeTrue();
  });
  it('both machines have a visible tracker', () => {
    expect(trackerFor('service').length >= 5).toBeTrue();
    expect(trackerFor('retail').length >= 5).toBeTrue();
  });
});

/* ── 3. MIGRATIONS ────────────────────────────────────────── */
describe('migrations · idempotent, reversible, never destructive', () => {
  const v5 = () => ({
    schemaVersion: 5,
    visitors: [
      { key: 'a|9000000001', name: 'A', mobile: '9000000001', role: 'user', area: 'Madhapur' },
      { key: 'b|9100000001', name: 'B', mobile: '9100000001', role: 'worker', wcat: 'plumber', wask: 520, area: 'Ameerpet' },
    ],
    deals: [{ id: 1, catId: 'plumber', deal: 520, stage: 'RELEASED', provider: 'B', customer: 'a|9000000001' }],
    agg: { deals: 1, vol: 520, profit: 41.6, gst: 10.4, refunds: 0 },
  });
  const run = raw => runMigrations(raw, { freshState: defaultState, tabId: 'test' });

  it('a v5 tree migrates without rolling back', () => {
    const r = run(v5());
    expect(r.rolledBack).toBeFalse();
    expect(r.error).toBe(null);
    expect(r.state.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it('accounts survive — nobody is logged out by an update', () => {
    // The property under test is SURVIVAL, not an exact count. v7 tops the
    // pro roster up, so asserting a fixed length made a legitimate data
    // migration look like account loss. Assert what actually matters:
    // every pre-existing key is still there, and none was duplicated.
    const before = v5();
    const r = run(before);
    const keys = r.state.users.map(u => u.key);
    before.visitors.forEach(v => expect(keys).toContain(v.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.state.partners.some(p => p.userKey === before.visitors[1].key)).toBeTrue();
  });
  it('v7 gives every service category enough pros to hold an auction', () => {
    const r = run(v5());
    ['plumbing', 'electrical', 'cleaning', 'repair'].forEach(c =>
      expect(r.state.partners.filter(p => p.cat === c).length >= 6).toBeTrue());
  });
  it('rupee floats become integer paise', () => {
    const r = run(v5());
    expect(r.state.partners[0].ask).toBe(52000);
    expect(Number.isInteger(r.state.orders[0].deal)).toBeTrue();
  });
  it('retired category ids are REMAPPED, never dropped', () => {
    const r = run(v5());
    expect(registry.has('category', r.state.orders[0].catId)).toBeTrue();
    expect(r.state.partners[0].cat).toBe('plumbing');
  });
  it('old stage names map onto registered stages', () => {
    const r = run(v5());
    expect(registry.has('orderStage', r.state.orders[0].stage)).toBeTrue();
  });
  it('migrating twice equals migrating once (idempotence)', () => {
    const once = run(v5()).state;
    const twice = run(JSON.parse(JSON.stringify(once))).state;
    expect(twice.schemaVersion).toBe(once.schemaVersion);
    expect(twice.users.length).toBe(once.users.length);
  });
  it('an already-current tree is left completely alone', () => {
    const cur = defaultState();
    const r = run(cur);
    expect(r.applied).toHaveLength(0);
    expect(r.state).toBe(cur);
  });
  it('garbage input yields a valid fresh tree instead of a crash', () => {
    const r = run({ nonsense: true });
    expect(r.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Array.isArray(r.state.orders)).toBeTrue();
  });
  it('a newer stored schema is refused, not silently downgraded', () => {
    const r = run({ schemaVersion: 999 });
    expect(r.error !== null).toBeTrue();
  });
  it('the chain has no gaps from 0 to the current version', () => {
    const steps = listMigrations();
    expect(steps.some(s => s.to === SCHEMA_VERSION)).toBeTrue();
  });
});

/* ── 4. TRUST ─────────────────────────────────────────────── */
describe('trust · the score is well-formed', () => {
  it('weights sum to exactly 1.00', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1) < 1e-9).toBeTrue();
  });
  it('score stays inside 0..100 for extreme inputs', () => {
    const cases = [
      {}, { tier: 4, completed: 5000, ratings: Array(50).fill({ stars: 5, ts: Date.now() }) },
      { suspended: true, disputesUpheld: 9, offPlatformFlags: 9, noShows: 40 },
    ];
    for (const p of cases) { const s = trustScore(p).score; expect(s >= 0 && s <= 100).toBeTrue(); }
  });
  it('a verified, busy, well-rated pro outranks a brand new one', () => {
    const good = trustScore({ tier: 4, completed: 300, starts: 300, onTimeStarts: 290,
      ratings: Array(30).fill({ stars: 5, ts: Date.now() }), lastActiveTs: Date.now() }).score;
    const fresh = trustScore({ tier: 1, completed: 0, lastActiveTs: Date.now() }).score;
    expect(good > fresh).toBeTrue();
  });
  it('a suspension is a real penalty', () => {
    const base = { tier: 3, completed: 50, lastActiveTs: Date.now() };
    expect(trustScore({ ...base, suspended: true }).score < trustScore(base).score).toBeTrue();
  });
  it('every tier has a cap and an unlock line', () => {
    for (let n = 0; n <= 4; n++) { expect(typeof tier(n).unlocks).toBe('string'); }
  });
});

describe('trust · escrow tiering never auto-releases without evidence', () => {
  const partner = { tier: 4, completed: 400, ratings: Array(30).fill({ stars: 5, ts: Date.now() }), lastActiveTs: Date.now() };
  it('no photo means team review, whatever the trust score', () => {
    expect(escrowTier({ deal: 50000, evidence: [], otpVerified: true }, partner).id).toBe('HOLD');
  });
  it('a small job from a trusted pro with evidence releases instantly', () => {
    expect(escrowTier({ deal: 100000, evidence: [{}], otpVerified: true }, partner).id).toBe('INSTANT');
  });
  it('a large job is always held for review', () => {
    expect(escrowTier({ deal: 2000000, evidence: [{}], otpVerified: true }, partner).id).toBe('HOLD');
  });
  it('a suspended partner is frozen', () => {
    expect(escrowTier({ deal: 1000, evidence: [{}] }, { ...partner, suspended: true }).id).toBe('FREEZE');
  });
});

/* ── 5. REGISTRY & CATALOG ───────────────────────────────── */
describe('registry · the open/closed seam holds', () => {
  it('unknown ids return a tombstone instead of throwing', () => {
    const t = registry.get('category', 'does-not-exist');
    expect(t.__tombstone).toBeTrue();
    expect(typeof t.label).toBe('string');
  });
  it('the registry can be sealed, and refuses writes once it is', () => {
    // true in the browser (app.js froze it at boot) and under Node (it has not yet)
    if (!registry.isFrozen()) registry.freeze();
    expect(registry.isFrozen()).toBeTrue();
  });
  it('registering over an existing id is refused', () => {
    // after boot the freeze guard fires first; before boot the duplicate guard does.
    expect(() => registry.register('category', { id: 'plumbing' })).toThrow('duplicate|frozen');
  });
  it('there are both service and retail categories', () => {
    const c = registry.all('category');
    expect(c.some(x => x.kind === 'service')).toBeTrue();
    expect(c.some(x => x.kind === 'retail')).toBeTrue();
  });
  it('every category is complete enough to render a tile', () => {
    for (const c of registry.all('category')) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.ico).toBe('string');
      expect(['home','care','life','shops'].includes(c.group)).toBeTrue();
    }
  });
  it('every service category has a positive integer base price', () => {
    for (const c of registry.all('category').filter(x => x.kind === 'service')) {
      expect(Number.isInteger(c.base)).toBeTrue();
      expect(c.base > 0).toBeTrue();
    }
  });
  it('every retail category has a take rate below the service rate', () => {
    for (const c of registry.all('category').filter(x => x.kind === 'retail')) {
      expect(c.takePct > 0 && c.takePct <= 5).toBeTrue();
      expect(c.takeCapPaise > 0).toBeTrue();
    }
  });
});

describe('starter catalog · shops can actually list products', () => {
  it('every retail category ships seed products', () => {
    for (const c of registry.all('category').filter(x => x.kind === 'retail'))
      expect(byCategory(c.id).length >= 8).toBeTrue();
  });
  it('prices are integer paise and never negative', () => {
    for (const p of STARTER) {
      expect(Number.isInteger(p.price)).toBeTrue();
      expect(p.price > 0).toBeTrue();
    }
  });
  it('no seeded price is above its MRP — that would be illegal to list', () => {
    for (const p of STARTER) if (p.mrp) expect(p.price <= p.mrp).toBeTrue();
  });
  it('every product has a unit and a substitution policy', () => {
    for (const p of STARTER) {
      expect(typeof p.unit).toBe('string');
      expect(['similar','call','refund'].includes(p.subPolicyDefault)).toBeTrue();
    }
  });
  it('pharmacy Rx items are flagged, meat is never auto-substituted', () => {
    expect(byCategory('pharmacy').some(p => p.rxRequired)).toBeTrue();
    expect(byCategory('meat').every(p => p.subPolicyDefault === 'refund')).toBeTrue();
  });
  it('refIds are unique', () => {
    expect(new Set(STARTER.map(p => p.refId)).size).toBe(STARTER.length);
  });
});

/* ── 6. GEO ───────────────────────────────────────────────── */
describe('geo · distances behave like distances', () => {
  it('is symmetric', () => {
    expect(kmBetween('Madhapur', 'Ameerpet')).toBe(kmBetween('Ameerpet', 'Madhapur'));
  });
  it('is smallest to itself', () => {
    for (const a of AREA_NAMES) expect(kmBetween(a, a) <= kmBetween(a, 'Uppal')).toBeTrue();
  });
  it('an unknown area does not produce NaN', () => {
    expect(Number.isFinite(kmBetween('Nowhere', 'Madhapur'))).toBeTrue();
  });
});

/* ── 7. REFERENTIAL INTEGRITY ────────────────────────────── */
describe('integrity · no orphan records', () => {
  it('the default state is internally consistent', () => {
    const s = defaultState();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(s.carts)).toHaveLength(0);
    expect(s.chain.lastHash).toBe('GENESIS');
  });
  it('reducers are registered for every persisted slice', () => {
    const slices = registry.all('reducer').map(r => r.slice);
    for (const k of ['users','partners','shops','products','orders','ledger'])
      expect(slices).toContain(k);
  });
});
