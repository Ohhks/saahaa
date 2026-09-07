/* SAAHAA · core/selftests.auto.js — the suites for 7.0 "Self-running":
   the clean slate, the company treasury, the gateway door, the automation
   dials and the v9 migration. Pure functions only, so they run under plain
   Node as well as in the browser. The parts that need a live store (vouching,
   the sweep) are exercised by the guardian's end-to-end matrix. */

import { describe, it, expect } from './selftest.js';
import * as F from '../domain/fresh.js';
import * as T from '../domain/treasury.js';
import * as G from './gateway.js';
import * as S from '../domain/settings.js';
import { runMigrations } from './migrate.js';
import { entry, transfer } from '../domain/ledger.js';

/* ── fresh ─────────────────────────────────────────────────── */
describe('fresh · demo never leaks, the credential and the dials always survive', () => {
  const demoState = () => ({
    schemaVersion: 9, createdAt: 1, seeded: true,
    users: [{ key: 'a|9000000001', mobile: '9000000001', origin: 'demo' }, { key: 'b|9876543210', mobile: '9876543210' }],
    partners: [{ id: 'p1', origin: 'demo' }], shops: [{ id: 's1', origin: 'demo' }], products: [{ id: 'pr1', origin: 'demo' }],
    orders: [{ id: 'o1' }], ledger: [{ id: 'l1' }], chain: { length: 1, lastHash: 'x' },
    admin: { hash: 'h', salt: 's', setupDone: true }, settings: { pricing: { serviceMarkupPct: 9 }, automation: null },
  });
  it('counts demo residue by origin mark AND by the example mobile ranges', () => {
    const r = F.demoResidue({ users: [{ mobile: '9100000007' }, { mobile: '9876543210' }, { origin: 'demo' }], partners: [], shops: [], products: [] });
    expect(r.users).toBe(2); expect(r.total).toBe(2);
  });
  it('a clean state passes through untouched (same object)', () => {
    const st = { users: [{ mobile: '9876543210' }], partners: [], shops: [], products: [] };
    expect(F.purgeIfDemoResidue(st, false)).toBe(st);
  });
  it('demo mode keeps the roster; production mode drops it', () => {
    const st = demoState();
    expect(F.purgeIfDemoResidue(st, true)).toBe(st);
    const out = F.purgeIfDemoResidue(st, false);
    expect(out.users).toHaveLength(0); expect(out.orders).toHaveLength(0); expect(out.ledger).toHaveLength(0);
    expect(out.seeded).toBeFalse();
  });
  it('the fresh state keeps the owner: credential hash, dials, schema, birth date', () => {
    const out = F.freshState(demoState());
    expect(out.admin.hash).toBe('h'); expect(out.settings.pricing.serviceMarkupPct).toBe(9);
    expect(out.schemaVersion).toBe(9); expect(out.createdAt).toBe(1);
    expect(out.chain.lastHash).toBe('GENESIS');
  });
});

/* ledger.transfer is (kind, from, to, amount); the books below read better as (kind, amount, from, to) */
const mv = (kind, amt, from, to) => transfer(kind, from, to, amt);

/* ── treasury ──────────────────────────────────────────────── */
describe('treasury · our part is what the books say, never what a screen says', () => {
  // a ₹1,000 job at 8%: customer pays ₹1,080; worker gets ₹1,000; fee ₹67.80 ex-GST; GST ₹12.20
  const legs = [
    mv('PAYMENT_IN',     108000, 'WORLD:funding', 'CUSTOMER:c1'),
    mv('ESCROW_IN',      108000, 'CUSTOMER:c1',   'ESCROW:o1'),
    mv('ESCROW_RELEASE', 100000, 'ESCROW:o1',     'PARTNER:p1'),
    mv('FEE',              6780, 'ESCROW:o1',     'PLATFORM:fee'),
    mv('GST',              1220, 'ESCROW:o1',     'PLATFORM:gst'),
  ];
  it('after one settled job: escrow empty, worker holds the quote, we hold the fee, the government its GST', () => {
    const t = T.treasury(legs);
    expect(t.escrow).toBe(0); expect(t.partnerWallets).toBe(100000);
    expect(t.feeEarned).toBe(6780); expect(t.gstPayable).toBe(1220);
    expect(t.moneyIn).toBe(108000); expect(t.reconciles).toBeTrue();
  });
  it('a withdrawal to the bank moves ours out and keeps the identity', () => {
    const t = T.treasury(legs.concat([mv('FEE_WITHDRAW', 6780, 'PLATFORM:fee', T.BANK)]));
    expect(t.feeEarned).toBe(0); expect(t.withdrawn).toBe(6780); expect(t.ours).toBe(6780); expect(t.reconciles).toBeTrue();
  });
  it('a refund is the customer’s wallet money, a liability, never ours', () => {
    const t = T.treasury([mv('PAYMENT_IN', 5000, 'WORLD:funding', 'CUSTOMER:c2'), mv('ESCROW_IN', 5000, 'CUSTOMER:c2', 'ESCROW:o2'),
                          mv('REFUND', 5000, 'ESCROW:o2', 'CUSTOMER:c2')]);
    expect(t.customerWallets).toBe(5000); expect(t.liabilities).toBe(5000); expect(t.feeEarned).toBe(0); expect(t.reconciles).toBeTrue();
  });
  it('our part of an order is fee ex-GST plus the dispatch cut on a delivery', () => {
    // a service order carries platformFee net of GST already (pricing.quoteService)
    expect(T.ourPartOf({ kind: 'service', platformFee: 6780, gst: 1220, customerPays: 108000 })).toEqual({ fee: 6780, gst: 1220, dispatchCut: 0, ours: 6780, customerPays: 108000 });
    const r = T.ourPartOf({ kind: 'retail', customerPays: 61900, shopPayout: 58200, platformFee: 1800, riderPayout: 1400, gst: 275 });
    expect(r.dispatchCut).toBe(500); expect(r.ours).toBe(1525 + 500);
  });
});

/* ── gateway ───────────────────────────────────────────────── */
describe('gateway · one door in, one door out, honest about the sandbox', () => {
  it('collect and payout return receipts with a reference and the rail name', async () => {
    const c = await G.collect({ paise: 1234, purpose: 'service', key: 'c1' });
    expect(c.ok).toBeTrue(); expect(c.paise).toBe(1234); expect(typeof c.ref).toBe('string'); expect(c.via).toBe(G.VIA);
    const p = await G.payout({ paise: 500, key: 'p1', upi: 'x@upi' });
    expect(p.ok).toBeTrue(); expect(p.upi).toBe('x@upi');
  });
  it('zero and negative amounts are refused, not silently accepted', async () => {
    expect((await G.collect({ paise: 0 })).ok).toBeFalse();
    expect((await G.payout({ paise: -5 })).ok).toBeFalse();
  });
  it('the sandbox says so', () => { expect(G.isSandbox()).toBeTrue(); expect(G.label()).toContain('no real money'); });
});

/* ── automation dials ──────────────────────────────────────── */
describe('automation dials · validated, pushed, complete', () => {
  it('defaults are complete and the kill switch is on', () => {
    const a = S.getAutomation(); expect(a.autoApprove).toBeTrue(); expect(a.bgJobs).toBe(3); expect(a.bgVouches).toBe(2);
  });
  it('out-of-range dials are refused with the field named', () => {
    const v = S.validateAutomation({ bgJobs: 0, bgRating: 6 });
    expect(v.ok).toBeFalse(); expect(v.errors.join(' ')).toContain('bgJobs'); expect(v.errors.join(' ')).toContain('bgRating');
  });
  it('a push lands and a later read sees it', () => {
    const r = S.pushAutomation({ bgJobs: 5, autoApprove: 'false' }, 'test');
    expect(r.ok).toBeTrue(); expect(S.getAutomation().bgJobs).toBe(5); expect(S.getAutomation().autoApprove).toBeFalse();
    S.pushAutomation({ bgJobs: 3, autoApprove: true }, 'test');
  });
});

/* ── migration v9 ──────────────────────────────────────────── */
describe('migration v9 · vouches and the automation slot exist, nothing is lost', () => {
  it('a v8 tree gains vouches, tier3At and settings.automation; the credential survives', () => {
    const v8 = { schemaVersion: 8, createdAt: 5, seeded: false, users: [{ key: 'u', mobile: '9876543210' }],
                 partners: [{ id: 'p', tier: 3, verifiedAt: 7 }, { id: 'q', tier: 2 }], shops: [], products: [], orders: [], ledger: [],
                 chain: { length: 0, lastHash: 'GENESIS' }, admin: { hash: 'h', salt: 's', setupDone: true }, settings: { pricing: null } };
    const r = runMigrations(v8, { silent: true });
    expect(r.rolledBack || false).toBeFalse();
    const st = r.state;
    expect(st.schemaVersion).toSatisfy(n => n >= 9, 'at least 9');
    expect(st.settings.automation).toBe(null);
    expect(st.partners[0].vouches).toEqual([]); expect(st.partners[0].tier3At).toBe(7); expect(st.partners[1].tier3At).toBe(0);
    expect(st.admin.hash).toBe('h'); expect(st.users).toHaveLength(1);
  });
});

/* ── the rail switch ───────────────────────────────────────── */
import { paymentsConfig, setPaymentsConfig, clearPaymentsConfig } from './config.js';
describe('gateway · the rail is sim until configured, and razorpay fails closed when half-configured', () => {
  it('ships in sim mode with the sandbox label', () => {
    clearPaymentsConfig();
    expect(paymentsConfig().mode).toBe('sim'); expect(G.mode()).toBe('sim'); expect(G.via()).toBe('upi-sim');
  });
  it('a device override switches the mode and strips a trailing slash from the functions URL', () => {
    const c = setPaymentsConfig({ mode: 'razorpay', keyId: 'rzp_test_x', functionsUrl: 'https://abc.functions.supabase.co/' });
    expect(c.functionsUrl).toBe('https://abc.functions.supabase.co');
    expect(paymentsConfig().mode).toBe('razorpay'); expect(G.isSandbox()).toBeFalse(); expect(G.label()).toContain('Razorpay');
    clearPaymentsConfig();
  });
  it('razorpay mode with no key or no opener refuses to collect — it never falls back to the sandbox', async () => {
    setPaymentsConfig({ mode: 'razorpay', keyId: '', functionsUrl: 'https://abc.functions.supabase.co' });
    const r = await G.collect({ paise: 500, key: 'c1' });
    expect(r.ok).toBeFalse(); expect(r.reason).toContain('not configured');
    setPaymentsConfig({ mode: 'razorpay', keyId: 'rzp_test_x', functionsUrl: 'https://abc.functions.supabase.co' });
    G.useOpener(null);
    const r2 = await G.collect({ paise: 500, key: 'c1' });
    expect(r2.ok).toBeFalse(); expect(r2.reason).toContain('opener');
    clearPaymentsConfig();
    expect((await G.collect({ paise: 500, key: 'c1' })).via).toBe('upi-sim');
  });
  it('an unknown mode value is treated as sim, never as live', () => {
    setPaymentsConfig({ mode: 'stripe' }); expect(paymentsConfig().mode).toBe('sim'); clearPaymentsConfig();
  });
});
