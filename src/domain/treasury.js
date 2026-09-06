/* SAAHAA · domain/treasury.js — the company's own wallet, read from the books.

   Everyone pays SAAHAA; SAAHAA pays everyone. Every rupee a customer pays
   lands in their CUSTOMER account, moves into the order's ESCROW, and leaves
   escrow as the worker's or the shop's payout, the rider's fee, a refund —
   and OUR part: the platform fee (PLATFORM:fee) and the GST we hold for the
   government (PLATFORM:gst). This module never invents a number: it replays
   the hash-chained ledger and reports the balances, so what the owner sees
   is exactly what the books say, to the paisa.

   Two owner actions, both audited and step-up protected in the UI:
     withdrawFees(paise)  PLATFORM:fee  -> WORLD:bank   (our earnings, to the company bank)
     remitGst(paise)      PLATFORM:gst  -> WORLD:tax    (the government's share, to the GST portal)

   LIABILITIES are money we hold for other people: escrow in flight, customer
   wallets, worker and shop wallets, stakes, holdbacks, the rider pool. They
   are never ours and the treasury shows them as what they are. */

import { getState } from '../core/ctx.js';
import { balances } from './ledger.js';
import * as audit from '../core/audit.js';
import * as M from '../core/money.js';
import { postLedger } from './flow.js';

export const BANK = 'WORLD:bank';
export const TAX  = 'WORLD:tax';

const sumPrefix = (b, prefix) => Object.entries(b).reduce((n, [k, v]) => k.startsWith(prefix) ? n + v : n, 0);

/** The company's position, replayed from the ledger. All figures in paise. */
export function treasury(entries = getState().ledger) {
  const b = balances(entries);
  const feeEarned       = b['PLATFORM:fee'] || 0;          // ours, still in the system
  const gstPayable      = b['PLATFORM:gst'] || 0;          // the government's, held by us
  const goodwill        = b['PLATFORM:goodwill'] || 0;     // credits granted (negative) / debts recovered
  const escrow          = sumPrefix(b, 'ESCROW:');
  const customerWallets = sumPrefix(b, 'CUSTOMER:');
  const partnerWallets  = sumPrefix(b, 'PARTNER:');
  const shopWallets     = sumPrefix(b, 'SHOP:');
  const stakes          = sumPrefix(b, 'STAKE:');
  const holdbacks       = sumPrefix(b, 'HOLDBACK:');
  const riderPool       = b['RIDER:pool'] || 0;
  const withdrawn       = b[BANK] || 0;                    // what we have taken out, cumulative
  const remitted        = b[TAX] || 0;                     // GST paid to the government, cumulative
  const moneyIn         = -(b['WORLD:funding'] || 0);      // everything that ever entered minus what left to people
  const liabilities     = escrow + customerWallets + partnerWallets + shopWallets + stakes + holdbacks + riderPool;
  // the books sum to zero by construction; this is the same identity written the owner's way
  const reconciles = moneyIn === liabilities + feeEarned + gstPayable + goodwill + withdrawn + remitted;
  return { feeEarned, gstPayable, goodwill, escrow, customerWallets, partnerWallets, shopWallets, stakes, holdbacks,
           riderPool, withdrawn, remitted, moneyIn, liabilities, ours: feeEarned + withdrawn, reconciles,
           withdrawable: Math.max(0, feeEarned), gstDue: Math.max(0, gstPayable) };
}

/** Our part of one order, as it was booked (orders snapshot their fees). */
export function ourPartOf(o) {
  // pricing.js: a SERVICE order's platformFee is already net of GST (gst separate);
  // a RETAIL order's platformFee includes its GST (gst = the GST part)
  const gst = o.gst | 0;
  const fee = o.kind === 'retail' ? Math.max(0, (o.platformFee | 0) - gst) : (o.platformFee | 0);
  const dispatchCut = o.kind === 'retail'
    ? Math.max(0, (o.customerPays | 0) - (o.shopPayout | 0) - (o.platformFee | 0) - (o.riderPayout | 0)) : 0;
  return { fee, gst, dispatchCut, ours: fee + dispatchCut, customerPays: o.customerPays | 0 };
}

/** Take earned fees out to the company bank. Never more than earned. */
export async function withdrawFees(paise, actor = 'admin') {
  const amt = M.int(paise);
  const t = treasury();
  if (amt < 100) return { ok: false, reason: 'Minimum ₹1' };
  if (amt > t.withdrawable) return { ok: false, reason: `Only ${M.fmt(t.withdrawable)} is ours to withdraw` };
  await postLedger('FEE_WITHDRAW', amt, 'PLATFORM:fee', BANK, { by: actor });
  audit.record('treasury.withdraw', { amt }, actor);
  return { ok: true, amt };
}

/** Remit the GST we hold. Never more than held. */
export async function remitGst(paise, actor = 'admin') {
  const amt = M.int(paise);
  const t = treasury();
  if (amt < 100) return { ok: false, reason: 'Minimum ₹1' };
  if (amt > t.gstDue) return { ok: false, reason: `Only ${M.fmt(t.gstDue)} of GST is held` };
  await postLedger('GST_REMIT', amt, 'PLATFORM:gst', TAX, { by: actor });
  audit.record('treasury.remitGst', { amt }, actor);
  return { ok: true, amt };
}
