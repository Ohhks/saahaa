/* SAAHAA · domain/orders.js — the ORDER STATE MACHINES, as registry entries.
   OPEN/CLOSED: adding a stage means registering one more entry. The tracker
   UI, the filter chips, the badge colours, the admin queues and the legality
   guard all derive from this registry — there is no switch statement anywhere.

   Two machines, because a service order and a grocery order are genuinely
   different objects (panel V1-B4, confidence 5):
     - a service has an APPOINTMENT (slot, duration, a named worker)
     - a product order has an ETA and N independent SKUs from one vendor
     - a service price is locked at booking; a grocery price is PROVISIONAL
       until items are weighed
   One cart cannot hold both. One order list shows both. */

import { register, all, get } from '../core/registry.js';

/* stage = {id, kind, label, short, owner, to[], tracker, tone, terminal} */
const SERVICE_STAGES = [
  { id:'DRAFT',       label:'Draft',              short:'Draft',      owner:'customer', to:['MATCHING','CANCELLED'], tracker:false, tone:'soft' },
  { id:'MATCHING',    label:'Finding your pro',   short:'Matching',   owner:'system',   to:['ASSIGNED','NO_MATCH','CANCELLED'], tracker:true, tone:'info', ico:'🔎' },
  { id:'NO_MATCH',    label:'No pro free',        short:'No match',   owner:'system',   to:['MATCHING','CANCELLED'], tracker:false, tone:'warn' },
  { id:'ASSIGNED',    label:'Pro accepted',       short:'Accepted',   owner:'worker',   to:['EN_ROUTE','MATCHING','CANCELLED'], tracker:true, tone:'ok', ico:'🤝' },
  { id:'SCHEDULED',   label:'Booked for later',   short:'Scheduled',  owner:'system',   to:['EN_ROUTE','CANCELLED','EXPIRED'], tracker:false, tone:'info' },
  { id:'EN_ROUTE',    label:'On the way to you',  short:'On the way', owner:'worker',   to:['ARRIVED','CANCELLED'], tracker:true, tone:'info', ico:'🛵' },
  { id:'ARRIVED',     label:'Pro has arrived',    short:'Arrived',    owner:'worker',   to:['IN_PROGRESS','CANCELLED'], tracker:true, tone:'info', ico:'📍', needsOtp:true },
  { id:'IN_PROGRESS', label:'Work in progress',   short:'Working',    owner:'worker',   to:['AWAITING_APPROVAL','WORK_DONE','DISPUTED'], tracker:true, tone:'info', ico:'🔨' },
  { id:'AWAITING_APPROVAL', label:'Extra work — your approval needed', short:'Approve?', owner:'customer', to:['IN_PROGRESS','WORK_DONE','DISPUTED'], tracker:false, tone:'warn' },
  { id:'WORK_DONE',   label:'Work finished',      short:'Done',       owner:'worker',   to:['SETTLED','DISPUTED'], tracker:true, tone:'ok', ico:'📸', needsEvidence:true },
  { id:'SETTLED',     label:'Paid & settled',     short:'Settled',    owner:'system',   to:['RATED','DISPUTED'], tracker:true, tone:'ok', ico:'💰' },
  { id:'RATED',       label:'Rated',              short:'Rated',      owner:'customer', to:['CLOSED'], tracker:false, tone:'ok' },
  { id:'PARTIAL',     label:'Partly released',    short:'Partial',    owner:'system',   to:['CLOSED'], tracker:false, tone:'warn' },
  { id:'DISPUTED',    label:'Under review',       short:'Disputed',   owner:'admin',    to:['SETTLED','PARTIAL','REFUNDED','CLOSED'], tracker:false, tone:'bad', ico:'⚖️' },
  { id:'REFUNDED',    label:'Refunded',           short:'Refunded',   owner:'system',   to:['CLOSED'], tracker:false, tone:'warn' },
  { id:'CANCELLED',   label:'Cancelled',          short:'Cancelled',  owner:'either',   to:[], tracker:false, tone:'bad', terminal:true },
  { id:'EXPIRED',     label:'Expired',            short:'Expired',    owner:'system',   to:[], tracker:false, tone:'soft', terminal:true },
  { id:'CLOSED',      label:'Closed',             short:'Closed',     owner:'system',   to:[], tracker:false, tone:'soft', terminal:true },
];

const RETAIL_STAGES = [
  { id:'R_CART',      label:'In cart',                short:'Cart',       owner:'customer', to:['R_PLACED'], tracker:false, tone:'soft' },
  { id:'R_PLACED',    label:'Order placed',           short:'Placed',     owner:'system',   to:['R_ACCEPTED','R_NO_VENDOR','R_CANCELLED'], tracker:true, tone:'info', ico:'🧾' },
  { id:'R_NO_VENDOR', label:'Shop unavailable',       short:'No shop',    owner:'system',   to:['R_CANCELLED'], tracker:false, tone:'warn' },
  { id:'R_ACCEPTED',  label:'Shop accepted',          short:'Accepted',   owner:'shop',     to:['R_PICKING','R_CANCELLED'], tracker:true, tone:'ok', ico:'🏪' },
  { id:'R_PICKING',   label:'Packing your order',     short:'Packing',    owner:'shop',     to:['R_SUB_PENDING','R_PACKED','R_CANCELLED'], tracker:true, tone:'info', ico:'🧺' },
  { id:'R_SUB_PENDING', label:'Item unavailable — your call', short:'Substitute?', owner:'customer', to:['R_PICKING'], tracker:false, tone:'warn', ico:'🔁' },
  { id:'R_PACKED',    label:'Weighed & packed',       short:'Packed',     owner:'shop',     to:['R_REAUTH','R_OUT','R_PICKUP_READY','R_CANCELLED'], tracker:true, tone:'ok', ico:'⚖️' },
  { id:'R_REAUTH',    label:'Final bill — approve',   short:'Approve',    owner:'customer', to:['R_OUT','R_CANCELLED'], tracker:false, tone:'warn' },
  { id:'R_PICKUP_READY', label:'Ready for pickup',    short:'Pickup',     owner:'customer', to:['R_DELIVERED'], tracker:false, tone:'ok' },
  { id:'R_OUT',       label:'Out for delivery',       short:'On the way', owner:'rider',    to:['R_DELIVERED','R_FAILED'], tracker:true, tone:'info', ico:'🛵' },
  { id:'R_DELIVERED', label:'Delivered',              short:'Delivered',  owner:'rider',    to:['R_SETTLED','R_RETURN'], tracker:true, tone:'ok', ico:'✅', needsOtp:true },
  { id:'R_FAILED',    label:'Delivery failed',        short:'Failed',     owner:'system',   to:['R_RETURN','R_CANCELLED'], tracker:false, tone:'bad' },
  { id:'R_RETURN',    label:'Return requested',       short:'Return',     owner:'customer', to:['R_REFUNDED'], tracker:false, tone:'warn' },
  { id:'R_REFUNDED',  label:'Refunded',               short:'Refunded',   owner:'system',   to:['R_CLOSED'], tracker:false, tone:'warn' },
  { id:'R_SETTLED',   label:'Settled',                short:'Settled',    owner:'system',   to:['R_CLOSED'], tracker:true, tone:'ok', ico:'💰' },
  { id:'R_CANCELLED', label:'Cancelled',              short:'Cancelled',  owner:'either',   to:[], tracker:false, tone:'bad', terminal:true },
  { id:'R_CLOSED',    label:'Closed',                 short:'Closed',     owner:'system',   to:[], tracker:false, tone:'soft', terminal:true },
];

SERVICE_STAGES.forEach(s => register('orderStage', Object.freeze({ ...s, kind: 'service' })));
RETAIL_STAGES .forEach(s => register('orderStage', Object.freeze({ ...s, kind: 'retail' })));

/* ── the machine ───────────────────────────────────────────── */
export const stage = id => get('orderStage', id);
export const stagesFor = kind => all('orderStage').filter(s => s.kind === kind);
export const trackerFor = kind => stagesFor(kind).filter(s => s.tracker);

export function canTransition(fromId, toId) {
  const s = get('orderStage', fromId);
  if (!s || s.__tombstone) return false;
  return Array.isArray(s.to) && s.to.includes(toId);
}

/** Pure. Returns a NEW order or throws on an illegal transition —
    illegal transitions must be loud, never silently ignored. */
export function applyTransition(order, toId, patch = {}, now = Date.now()) {
  if (!canTransition(order.stage, toId))
    throw new Error(`illegal transition ${order.stage} -> ${toId}`);
  const hist = (order.history || []).concat([{ stage: toId, at: now }]);
  return { ...order, ...patch, stage: toId, stageTs: now, history: hist };
}

export function isTerminal(id) { const s = get('orderStage', id); return !!(s && s.terminal); }

/** progress index within the visible tracker, -1 if the stage is off-tracker */
export function trackerIndex(order) {
  const list = trackerFor(order.kind || 'service');
  const i = list.findIndex(s => s.id === order.stage);
  if (i >= 0) return i;
  // off-tracker stage (dispute, substitution): show progress up to the last on-tracker stage reached
  const seen = (order.history || []).map(h => h.stage);
  for (let k = list.length - 1; k >= 0; k--) if (seen.includes(list[k].id)) return k;
  return 0;
}

export const TRACKER_LEN = kind => trackerFor(kind).length;
