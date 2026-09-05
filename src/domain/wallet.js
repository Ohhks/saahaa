/* SAAHAA · domain/wallet.js — the worker's wallet and the commitment stake.

   THE RULE, IN ONE LINE. When work starts, a minimum amount of the worker's
   own money is locked. When the work is finished and confirmed, the worker
   receives that locked amount back in full — plus the whole of their quote.
   SAAHAA receives the whole of its 8% charge. Nobody's money is taken from
   anybody else's; every rupee is a leg on the ledger.

   WHY A STAKE AT ALL. Escrow protects the customer's money. Nothing protected
   the customer's TIME: a pro who checks in and walks out cost them an
   afternoon and cost us nothing. The stake is skin in the game from the
   moment the door opens — and because it comes back in full on every honest
   job, an honest pro never feels it.

   FOUR STATES, NEVER BLENDED (the same four the UI shows everywhere):
     AVAILABLE  PARTNER:<id>   what the pro can withdraw now
     LOCKED     STAKE:<id>     committed to a job in progress
     PENDING    HOLDBACK:<id>  a slice of a payout held 7 days (ledger policy)
     RELEASED   lifetime paid  every payout ever credited

   COLD START. A new pro has an empty wallet and cannot be told "top up
   before your first job" — that is how a marketplace gets no supply. So the
   stake is funded from the wallet as far as it goes, and the shortfall is
   carried ON CREDIT against this job's own payout: it still comes back in
   full at settlement (nothing to return, nothing was taken), and if the pro
   walks out it becomes a debt recovered from the next payout. Real money
   locks as soon as there is real money. */

import * as M from '../core/money.js';
import { acct, balances, HOLDBACK_DAYS } from './ledger.js';

/* ── the stake ─────────────────────────────────────────────── */
export const MIN_STAKE  = 10000;    // ₹100 — the minimum locked on every job
export const STAKE_PCT  = 5;        // or 5% of the deal, whichever is larger…
export const MAX_STAKE  = 50000;    // …capped at ₹500 so a big job is not a wall

export function stakeFor(dealPaise) {
  return Math.min(MAX_STAKE, Math.max(MIN_STAKE, M.pct(dealPaise | 0, STAKE_PCT)));
}

/* ── accounts the wallet reads ─────────────────────────────── */
export const stakeAcct = p => 'STAKE:' + p;
export const walletAcct = p => acct.partner(p);
export const holdbackAcct = p => acct.holdback(p);

/**
 * The wallet, derived from the ledger — never stored, so it cannot drift
 * from the books. `entries` are the raw ledger blocks (partyA/partyB shape).
 */
export function walletOf(entries, partnerId, partner = {}) {
  const b = balances(entries);
  const available = Math.max(0, b[walletAcct(partnerId)] || 0);
  const locked    = Math.max(0, b[stakeAcct(partnerId)] || 0);
  const pending   = Math.max(0, b[holdbackAcct(partnerId)] || 0);
  const released  = entries
    .filter(e => e.partyB === walletAcct(partnerId) && (e.kind === 'ESCROW_RELEASE' || e.kind === 'COMPENSATION' || e.kind === 'HOLDBACK_RELEASE'))
    .reduce((n, e) => n + (e.amountPaise | 0), 0);
  const withdrawn = entries
    .filter(e => e.partyA === walletAcct(partnerId) && e.kind === 'WITHDRAW')
    .reduce((n, e) => n + (e.amountPaise | 0), 0);
  return { available, locked, pending, released, withdrawn, debt: partner.walletDebt | 0 };
}

/** How a stake of `need` would be funded from `available`: real money first,
    the rest on credit against the job's own payout. */
export function fundStake(need, available) {
  const funded = Math.min(need, Math.max(0, available | 0));
  return { need, funded, onCredit: need - funded };
}

/** Holdback releases are due once they are HOLDBACK_DAYS old. */
export function holdbackDue(entries, now = Date.now()) {
  const cutoff = now - HOLDBACK_DAYS * 86400000;
  const released = new Set(entries.filter(e => e.kind === 'HOLDBACK_RELEASE').map(e => e.meta && e.meta.of));
  return entries.filter(e => e.kind === 'HOLDBACK' && e.ts <= cutoff && !released.has(e.id));
}
