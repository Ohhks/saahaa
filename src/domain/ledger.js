/* SAAHAA · domain/ledger.js — double-entry accounting and its invariants.

   The verification panel's top-priority finding: build this BEFORE money is
   real, because it is impossible to retrofit. A missing FOR UPDATE, a
   double-fired RPC or an off-by-one mints or destroys value silently, and
   nobody notices until real cash is involved.

   Every entry moves value between two NAMED ACCOUNTS. Nothing is created and
   nothing vanishes: the sum of every delta across the whole book is exactly
   zero, forever. If it isn't, the app freezes releases and says so rather
   than continuing to write bad numbers.

   Accounts are strings with a type prefix:
     WORLD:funding      money entering the system (a top-up)
     CUSTOMER:<key>     a customer's spendable wallet
     ESCROW:<orderId>   locked for one specific order
     PARTNER:<id>       a pro's spendable balance
     HOLDBACK:<id>      a pro's reliability holdback, released after 7 clean days
     SHOP:<id>          a shop's spendable balance
     RIDER:pool         delivery earnings
     PLATFORM:fee       SAAHAA revenue, net of GST
     PLATFORM:gst       GST collected, owed to the government — never revenue
     PLATFORM:goodwill  credits we fund ourselves
*/

import * as M from '../core/money.js';

export const ACCOUNT_TYPES = ['WORLD', 'CUSTOMER', 'ESCROW', 'PARTNER', 'HOLDBACK',
                              'SHOP', 'RIDER', 'PLATFORM'];

export const acct = {
  world:    () => 'WORLD:funding',
  customer: k => 'CUSTOMER:' + k,
  escrow:   o => 'ESCROW:' + o,
  partner:  p => 'PARTNER:' + p,
  holdback: p => 'HOLDBACK:' + p,
  shop:     s => 'SHOP:' + s,
  rider:    () => 'RIDER:pool',
  fee:      () => 'PLATFORM:fee',
  gst:      () => 'PLATFORM:gst',
  goodwill: () => 'PLATFORM:goodwill',
};
export const typeOf = a => String(a).split(':')[0];

/** Holdback policy (panel V-B, adopted): the worker's stake is implicit —
    they never pay to join, but a slice of each payout is held briefly. This
    grows skin-in-the-game exactly as volume, and therefore fraud capacity,
    grows. A cold-start marketplace cannot demand cash up front from supply. */
export const HOLDBACK_PCT = 10;
export const HOLDBACK_CAP = 50000;          // ₹500 in paise, cumulative
export const HOLDBACK_DAYS = 7;

export function holdbackFor(payoutPaise, currentHeldPaise = 0) {
  const want = M.pct(payoutPaise, HOLDBACK_PCT);
  const room = Math.max(0, HOLDBACK_CAP - currentHeldPaise);
  return Math.min(want, room);
}

/* ── posting ───────────────────────────────────────────────── */
/**
 * Build a balanced multi-leg entry. Legs must sum to zero.
 * @param {string} kind  e.g. 'ESCROW_LOCK', 'RELEASE', 'REFUND', 'FEE', 'GST'
 * @param {Array}  legs  [{ account, delta }]  delta in paise, signed
 */
export function entry(kind, legs, meta = {}) {
  const sum = legs.reduce((n, l) => n + (l.delta | 0), 0);
  if (sum !== 0) throw new Error(`unbalanced ${kind}: legs sum to ${sum}, must be 0`);
  if (legs.some(l => !l.account || typeof l.delta !== 'number'))
    throw new Error(`malformed leg in ${kind}`);
  if (legs.some(l => !ACCOUNT_TYPES.includes(typeOf(l.account))))
    throw new Error(`unknown account type in ${kind}`);
  return { kind, legs, meta, ts: Date.now() };
}

/** Convenience for the common two-leg move. */
export const transfer = (kind, from, to, amount, meta) =>
  entry(kind, [{ account: from, delta: -amount }, { account: to, delta: amount }], meta);

/* ── replay ────────────────────────────────────────────────── */
export function balances(entries) {
  const bal = Object.create(null);
  for (const e of entries) {
    const legs = e.legs || legacyLegs(e);
    for (const l of legs) bal[l.account] = (bal[l.account] || 0) + l.delta;
  }
  return bal;
}

/** v6.0 wrote single-move entries {partyA, partyB, amountPaise}. Read them as
    two legs so old books still replay. Append-only history is never rewritten. */
function legacyLegs(e) {
  if (!e || e.amountPaise == null) return [];
  return [{ account: e.partyA, delta: -e.amountPaise },
          { account: e.partyB, delta: e.amountPaise }];
}

export function balanceOf(entries, account) { return balances(entries)[account] || 0; }

export function sumByType(entries, type) {
  const bal = balances(entries);
  return Object.keys(bal).filter(a => typeOf(a) === type)
                         .reduce((n, a) => n + bal[a], 0);
}

/* ── the invariants ────────────────────────────────────────────
   Run at boot, before every release, and in the nightly sweep.
   A failure freezes payouts — it never auto-repairs, because auto-repair is
   indistinguishable from an attacker covering their tracks. */
export function checkInvariants(entries, opts = {}) {
  const checks = [];
  const bal = balances(entries);
  const add = (id, ok, detail, fatal = false) => checks.push({ id, ok: !!ok, detail, fatal });

  /* 1. the book balances — the one that cannot ever be false */
  const total = Object.values(bal).reduce((a, b) => a + b, 0);
  add('book.balances', total === 0,
      total === 0 ? 'every rupee accounted for' : `book is off by ${M.fmt2(total)}`, true);

  /* 2. every entry was itself balanced */
  const bad = entries.filter(e => {
    const legs = e.legs || legacyLegs(e);
    return legs.reduce((n, l) => n + l.delta, 0) !== 0;
  });
  add('entries.balanced', bad.length === 0,
      bad.length ? `${bad.length} unbalanced entries` : `${entries.length} entries all balanced`, true);

  /* 3. nobody's spendable balance is negative */
  const neg = Object.entries(bal).filter(([a, v]) => v < 0 && typeOf(a) !== 'WORLD');
  add('balances.non-negative', neg.length === 0,
      neg.length ? neg.map(([a, v]) => `${a} ${M.fmt2(v)}`).join(', ') : 'no negative balances', true);

  /* 4. escrow held matches what the app thinks it is holding */
  const escrow = sumByType(entries, 'ESCROW');
  if (opts.expectedEscrow != null) {
    add('escrow.reconciles', escrow === opts.expectedEscrow,
        `ledger ${M.fmt2(escrow)} vs aggregate ${M.fmt2(opts.expectedEscrow)}`, false);
  }
  add('escrow.non-negative', escrow >= 0, `escrow holds ${M.fmt2(escrow)}`, true);

  /* 5. no escrow account is left holding money for a finished order */
  if (opts.closedOrderIds) {
    const stranded = opts.closedOrderIds
      .map(id => ['ESCROW:' + id, bal['ESCROW:' + id] || 0])
      .filter(([, v]) => v !== 0);
    add('escrow.no-stranded', stranded.length === 0,
        stranded.length ? `${stranded.length} closed orders still hold funds` : 'no stranded escrow');
  }

  /* 6. GST is never spent — it is owed to the government, not revenue */
  add('gst.non-negative', (bal[acct.gst()] || 0) >= 0,
      `GST collected ${M.fmt2(bal[acct.gst()] || 0)}`, true);

  const fatal = checks.some(c => !c.ok && c.fatal);
  return { ok: checks.every(c => c.ok), fatal, checks, balances: bal, escrow };
}

/** Human-readable trial balance for the admin console. */
export function trialBalance(entries) {
  const bal = balances(entries);
  return Object.entries(bal)
    .map(([account, amount]) => ({ account, type: typeOf(account), amount }))
    .filter(r => r.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/* ── the standard postings ─────────────────────────────────────
   Named so the whole money story is greppable in one file. */
export const post = {
  /** Customer tops up a simulated wallet. Real money would replace WORLD. */
  topUp: (customerKey, amount) =>
    transfer('TOPUP', acct.world(), acct.customer(customerKey), amount),

  /** Booking: funds leave the customer and are locked against ONE order. */
  lock: (customerKey, orderId, amount) =>
    transfer('ESCROW_LOCK', acct.customer(customerKey), acct.escrow(orderId), amount),

  /** Settlement, as one balanced entry so it can never half-apply. */
  release({ orderId, partnerId, payout, fee, gst, refundTo, refund = 0, holdback = 0 }) {
    const legs = [{ account: acct.escrow(orderId), delta: -(payout + fee + gst + refund) }];
    if (payout - holdback > 0) legs.push({ account: acct.partner(partnerId), delta: payout - holdback });
    if (holdback > 0) legs.push({ account: acct.holdback(partnerId), delta: holdback });
    if (fee > 0) legs.push({ account: acct.fee(), delta: fee });
    if (gst > 0) legs.push({ account: acct.gst(), delta: gst });
    if (refund > 0) legs.push({ account: acct.customer(refundTo), delta: refund });
    return entry('RELEASE', legs, { orderId, partnerId });
  },

  /** Shop settlement for a retail order. */
  settleRetail({ orderId, shopId, shopPayout, fee, gst, riderPayout = 0, refundTo, refund = 0 }) {
    const legs = [{ account: acct.escrow(orderId), delta: -(shopPayout + fee + gst + riderPayout + refund) }];
    if (shopPayout > 0) legs.push({ account: acct.shop(shopId), delta: shopPayout });
    if (fee > 0) legs.push({ account: acct.fee(), delta: fee });
    if (gst > 0) legs.push({ account: acct.gst(), delta: gst });
    if (riderPayout > 0) legs.push({ account: acct.rider(), delta: riderPayout });
    if (refund > 0) legs.push({ account: acct.customer(refundTo), delta: refund });
    return entry('SETTLE_RETAIL', legs, { orderId, shopId });
  },

  /** Cancellation: escrow splits between refund, compensation and the platform. */
  cancel({ orderId, customerKey, refund, partnerId, compensation = 0, fee = 0 }) {
    const legs = [{ account: acct.escrow(orderId), delta: -(refund + compensation + fee) }];
    if (refund > 0) legs.push({ account: acct.customer(customerKey), delta: refund });
    if (compensation > 0) legs.push({ account: acct.partner(partnerId), delta: compensation });
    if (fee > 0) legs.push({ account: acct.fee(), delta: fee });
    return entry('CANCEL', legs, { orderId });
  },

  /** Holdback matures after a clean window. */
  releaseHoldback: (partnerId, amount) =>
    transfer('HOLDBACK_RELEASE', acct.holdback(partnerId), acct.partner(partnerId), amount),

  /** A goodwill credit we fund ourselves — e.g. a pro no-show. */
  goodwill: (customerKey, amount) =>
    transfer('GOODWILL', acct.goodwill(), acct.customer(customerKey), amount),
};
