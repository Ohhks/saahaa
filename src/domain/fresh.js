/* SAAHAA · domain/fresh.js — a clean slate, on purpose and on record.

   Two jobs:

   1. DEMO NEVER LEAKS. `?demo=1` seeds an example roster on a device so the
      product can be walked. If that device later opens the app WITHOUT
      `?demo=1`, the roster must not be there pretending to be customers.
      purgeIfDemoResidue() runs at every boot, before seeding, and wipes a
      state that carries demo-origin records — keeping the owner's credential
      and the owner's dials, which are real.

   2. FRESH START. The owner can wipe every account, order and ledger entry
      from Admin → System & audit. A snapshot is taken first (restorable from
      the same screen), the wipe is audited with counts, and the credential
      and the dials survive. Nothing is deleted quietly.

   Demo records are recognised two ways: the `origin: 'demo'` mark seed.js
   stamps on everything it makes, and — for states seeded before the mark
   existed — the example roster's mobile ranges (90/91/92 000000xx). */

import { getState, ctx } from '../core/ctx.js';
import * as audit from '../core/audit.js';
import * as migrate from '../core/migrate.js';
import * as photos from '../core/photos.js';

export const DEMO_MOBILE = /^9[012]000000\d\d$/;
const isDemo = r => !!r && (r.origin === 'demo' || (r.mobile != null && DEMO_MOBILE.test(String(r.mobile))));

/** How much demo material a state carries, by slice. */
export function demoResidue(st) {
  const n = {
    users:    (st.users    || []).filter(isDemo).length,
    partners: (st.partners || []).filter(isDemo).length,
    shops:    (st.shops    || []).filter(isDemo).length,
    products: (st.products || []).filter(isDemo).length,
  };
  n.total = n.users + n.partners + n.shops + n.products;
  return n;
}

/** The same state with every person, order and rupee removed — credential and dials kept. */
export function freshState(old) {
  return {
    ...old,
    users: [], partners: [], shops: [], products: [], orders: [], requests: [], bids: [],
    carts: {}, ledger: [], chain: { length: 0, lastHash: 'GENESIS' }, reviews: [], disputes: [], chats: {},
    agg: {}, seeded: false,
    admin: old.admin || {}, settings: old.settings || { pricing: null, automation: null },
  };
}

export function counts(st) {
  return { users: (st.users || []).length, partners: (st.partners || []).length, shops: (st.shops || []).length,
           products: (st.products || []).length, orders: (st.orders || []).length, ledger: (st.ledger || []).length };
}

/**
 * Boot guard. Returns the state to continue with: unchanged when clean or in
 * demo mode, otherwise a fresh one (and the reason is on the audit log).
 */
/**
 * @param {object} st         the state to judge
 * @param {boolean} demoMode  true when ?demo=1 asked for the roster
 * @param {object} [opts]     { commit } — false computes the answer WITHOUT
 *   writing to the audit log or touching the picture store. A test asking
 *   "what would this do" must not do it: this function used to write a real
 *   `data.demoPurged` entry and wipe every picture whenever a suite ran.
 */
export function purgeIfDemoResidue(st, demoMode, opts = {}) {
  const commit = opts.commit !== false;
  if (demoMode) return st;
  const r = demoResidue(st);
  if (!r.total) return st;
  if (commit) {
    audit.record('data.demoPurged', { ...r, kept: 'admin, settings' }, 'system');
    photos.gc([]);               // the example roster's pictures go with it
  }
  return freshState(st);
}

/** The owner's wipe. Snapshot first, then replace, then record. */
export function freshStart(actor = 'admin') {
  const st = getState();
  const before = counts(st);
  const snap = migrate.snapshot(st, 'pre-fresh');
  const pics = photos.usage().count;
  ctx.store.replaceState(freshState(st), 'fresh-start');
  photos.gc([]);                 // every picture belonged to what was just removed
  audit.record('data.freshStart', { before, photos: pics, snapshot: snap || null }, actor);
  return before;
}
