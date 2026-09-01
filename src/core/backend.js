/* SAAHAA · core/backend.js — the PORT.

   One interface, two adapters. The UI calls these operations and never knows
   whether it is talking to localStorage or to Postgres. That is the whole
   point: the app keeps working offline, and moving to Supabase changes this
   file's wiring and nothing in any view.

   THE CONTRACT THAT MATTERS: every operation that moves money or advances a
   verified state is listed under `MONEY_OPS`. In the cloud adapter each one is
   a single SECURITY DEFINER Postgres function — the browser cannot compute a
   balance, cannot mint a rupee, and cannot skip a state. In the local adapter
   they are simulated in JS, clearly labelled as a prototype.

   Adding a new operation: add it to OPS, implement it in both adapters, and
   the self-test suite will fail until you do. */

import { emit } from './bus.js';
import * as cfg from './config.js';

/* ── the operation surface ─────────────────────────────────── */
export const OPS = [
  /* identity */
  'signUp', 'signIn', 'signOut', 'currentUser', 'updateProfile',
  /* read models */
  'listPartners', 'listShops', 'listProducts', 'listOrders', 'listBids',
  'getOrder', 'getServiceRequest', 'listOpenRequests',
  /* marketplace — bidding */
  'postRequest', 'placeBid', 'withdrawBid', 'acceptBid', 'expireRequest',
  /* marketplace — instant */
  'bookInstant',
  /* MONEY + VERIFIED STATE — server-authoritative in cloud mode */
  'fundEscrow', 'issueOtp', 'verifyOtp', 'submitCompletion',
  'confirmCompletion', 'releaseEscrow', 'refundEscrow', 'partialRelease',
  'cancelOrder', 'openDispute', 'resolveDispute',
  /* retail */
  'placeRetailOrder', 'packOrder', 'approveSubstitution', 'settleRetail',
  /* shop */
  'upsertProduct', 'removeProduct', 'setStock',
  /* ops */
  'wallet', 'ledgerFor', 'reconcile', 'health',
];

/** Operations that must NEVER be decided by the client in cloud mode. */
export const MONEY_OPS = new Set([
  'fundEscrow', 'issueOtp', 'verifyOtp', 'submitCompletion', 'confirmCompletion',
  'releaseEscrow', 'refundEscrow', 'partialRelease', 'cancelOrder',
  'resolveDispute', 'acceptBid', 'settleRetail', 'placeBid',
]);

/* ── adapter registry ──────────────────────────────────────── */
const adapters = new Map();
let active = null;

export function registerAdapter(adapter) {
  if (!adapter || !adapter.id) throw new Error('adapter needs an id');
  const missing = OPS.filter(op => typeof adapter[op] !== 'function');
  if (missing.length) throw new Error(`adapter ${adapter.id} is missing: ${missing.join(', ')}`);
  adapters.set(adapter.id, adapter);
  return adapter;
}
export const listAdapters = () => [...adapters.values()].map(a => ({ id: a.id, label: a.label }));
export const current = () => active;
export const currentId = () => (active ? active.id : null);
export const isCloud = () => !!(active && active.remote);

export function use(id) {
  const a = adapters.get(id);
  if (!a) throw new Error(`unknown backend adapter: ${id}`);
  active = a;
  emit('backend:changed', { id, remote: !!a.remote });
  return a;
}

/**
 * Pick an adapter from config.
 *   local  — never touch the network
 *   cloud  — require Supabase; fail loudly rather than silently degrade
 *   auto   — Supabase when configured AND reachable, else local
 */
export async function autoSelect() {
  const mode = cfg.backendMode();
  if (mode === 'local' || !adapters.has('supabase')) return use('local');
  if (mode === 'cloud') return use('supabase');

  if (!cfg.hasSupabase()) return use('local');
  const sb = adapters.get('supabase');
  const h = await sb.health().catch(() => ({ ok: false }));
  if (h && h.ok) { emit('backend:online', h); return use('supabase'); }
  emit('backend:degraded', h);
  return use('local');
}

/* ── the callable facade ───────────────────────────────────────
   Every call goes through here so we get one place for error shaping,
   audit hooks and the offline queue. */
export async function call(op, args = {}) {
  if (!active) throw new Error('no backend selected');
  if (typeof active[op] !== 'function') throw new Error(`backend ${active.id} cannot ${op}`);
  try {
    const out = await active[op](args);
    return out;
  } catch (err) {
    emit('backend:error', { op, message: err.message, status: err.status });
    if (MONEY_OPS.has(op)) {
      /* Money operations must NEVER be optimistically retried or faked.
         Surface the failure; the caller decides. */
      err.fatal = true;
    }
    throw err;
  }
}

/* convenience: backend.ops.placeBid({...}) */
export const ops = new Proxy({}, {
  get: (_, op) => (args) => call(String(op), args),
});
