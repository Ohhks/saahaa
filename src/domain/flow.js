/* SAAHAA · domain/flow.js — the use-cases. Views call these; they never
   dispatch raw actions themselves, so every money movement and every state
   transition goes through one auditable place. */

import { ctx, getState, dispatch, me, myArea } from '../core/ctx.js';
import { nid, otp as makeOtp } from '../core/id.js';
import { appendBlock } from '../core/crypto.js';
import * as audit from '../core/audit.js';
import * as M from '../core/money.js';
import { find } from '../core/registry.js';
import { applyTransition, canTransition } from './orders.js';
import { quoteService, quoteRetail, compareWithApps, releaseService, cancelSplit } from './pricing.js';
import { lockedMatch, rankShops, kmBetween, etaMins } from './match.js';
import { escrowTier, markupFor, trustScore } from './trust.js';
import { toast } from '../ui/dom.js';

/* ── ledger (double-entry, hash-chained) ───────────────────── */
async function ledger(kind, amountPaise, partyA, partyB, meta = {}) {
  const st = getState();
  const rec = { id: nid('led'), kind, amountPaise, partyA, partyB, ts: Date.now(), meta };
  const block = await appendBlock(st.chain, rec);
  dispatch({ type: 'ledger/append', payload: block });
  return block;
}

/* ── SERVICE: the 3-tap booking ────────────────────────────── */
export function findMatch(catId, opts = {}) {
  const st = getState();
  const cat = find('category', catId);
  const deal = opts.deal || (cat && cat.base) || 50000;
  return lockedMatch(st.partners, { catId, area: opts.area || myArea(), dealPaise: deal });
}

export function previewBooking(catId, partner, sub) {
  const cat = find('category', catId);
  const deal = partner ? partner.ask : (cat && cat.base) || 50000;
  const q = quoteService(deal, { markup: markupFor(partner || {}) });
  const cmp = compareWithApps(deal);
  return { cat, partner, sub, deal, quote: q, compare: cmp };
}

export async function bookService({ catId, partner, sub, deal, slot }) {
  const s = me();
  if (!s) throw new Error('Please sign in first');
  const cat = find('category', catId);
  const price = deal ?? partner.ask;
  const q = quoteService(price, { markup: markupFor(partner) });
  const km = kmBetween(s.area, partner.area);
  const now = Date.now();

  const order = {
    id: nid('ord'), kind: 'service', catId, sub: sub || null,
    customerKey: s.key, customerName: s.name, customerArea: s.area,
    partnerId: partner.id, partnerName: partner.name, partnerArea: partner.area,
    km, eta: etaMins(km),
    deal: q.deal, customerPays: q.customerPays, platformFee: q.platformFee, gst: q.gst,
    saved: compareWithApps(price).saved,
    slot: slot || 'now',
    stage: 'MATCHING', stageTs: now, createdAt: now,
    history: [{ stage: 'DRAFT', at: now }, { stage: 'MATCHING', at: now }],
    otp: makeOtp(), otpVerified: false, evidence: [], escrowed: q.customerPays,
  };
  dispatch({ type: 'order/add', payload: order });
  await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id,
               { catId, deal: q.deal, fee: q.platformFee, gst: q.gst });
  bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  audit.record('booking.created', { id: order.id, catId, deal: q.deal }, s.key);

  // The hero card is a pro who has ALREADY accepted, so the demo mirrors
  // reality: acceptance lands in a moment, not never.
  setTimeout(() => advance(order.id, 'ASSIGNED', {}), 900);
  return order;
}

/* ── stage machine driver ──────────────────────────────────── */
export function advance(orderId, toStage, patch = {}) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return null;
  if (!canTransition(o.stage, toStage)) { toast(`Cannot go ${o.stage} → ${toStage}`, 'danger'); return null; }
  const next = applyTransition(o, toStage, patch);
  dispatch({ type: 'order/replace', payload: { id: orderId, order: next } });
  ctx.render();
  return next;
}

export function verifyOtp(orderId, entered) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return false;
  if (String(entered).trim() !== String(o.otp)) {
    const fails = (o.otpFails || 0) + 1;
    dispatch({ type: 'order/patch', payload: { id: orderId, patch: { otpFails: fails } } });
    audit.record('otp.failed', { id: orderId, fails });
    toast(fails >= 3 ? 'Too many wrong codes — this job is now flagged' : 'Wrong code', 'danger');
    if (fails >= 3) advance(orderId, 'DISPUTED', { disputed: true, disputeReason: 'otp_fail' });
    return false;
  }
  audit.record('otp.verified', { id: orderId });
  advance(orderId, 'IN_PROGRESS', { otpVerified: true, startedAt: Date.now() });
  toast('Verified — work started');
  return true;
}

export function addEvidence(orderId, label) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const ev = (o.evidence || []).concat([{ id: nid('ev'), label, ts: Date.now() }]);
  dispatch({ type: 'order/patch', payload: { id: orderId, patch: { evidence: ev } } });
  toast(`${label} photo attached`);
  ctx.render();
}

/** Worker marks done. No photo -> never auto-release (V4: the single highest
    value anti-fraud rule in the system). */
export function markDone(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  if (!o.evidence || !o.evidence.length) { toast('Attach at least one photo of the finished work', 'warn'); return; }
  const st = getState();
  const partner = st.partners.find(p => p.id === o.partnerId) || {};
  const tierInfo = escrowTier({ ...o, stage: 'WORK_DONE' }, partner);
  advance(orderId, 'WORK_DONE', { escrowTier: tierInfo.id, releaseAt: Date.now() + (isFinite(tierInfo.holdMs) ? tierInfo.holdMs : 0) });
  toast(tierInfo.id === 'HOLD' ? 'Sent for team review' : `Done — ${tierInfo.label.toLowerCase()}`);
}

/** Customer taps Confirm — the second factor without typing a second OTP. */
export async function confirmAndRelease(orderId, pct = 1) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const r = releaseService(o.deal, pct, { markup: markupFor({}) });
  advance(orderId, pct >= 1 ? 'SETTLED' : 'PARTIAL', {
    releasedPct: pct, workerPayout: r.workerPayout, refund: r.refund,
    platformFee: r.platformFee, gst: r.gst, settledAt: Date.now(),
  });
  await ledger('ESCROW_RELEASE', r.workerPayout, 'ESCROW:' + o.id, 'PARTNER:' + o.partnerId, { pct });
  if (r.platformFee) await ledger('FEE', r.platformFee, 'ESCROW:' + o.id, 'PLATFORM:FEE', {});
  if (r.gst)         await ledger('GST', r.gst, 'ESCROW:' + o.id, 'PLATFORM:GST', {});
  if (r.refund)      await ledger('REFUND', r.refund, 'ESCROW:' + o.id, 'CUSTOMER:' + o.customerKey, {});

  const a = getState().agg;
  bumpAgg({
    serviceOrders: a.serviceOrders + 1,
    gmv: a.gmv + r.workerPayout,
    revenue: a.revenue + r.platformFee,
    gst: a.gst + r.gst,
    refunds: a.refunds + r.refund,
    escrow: Math.max(0, a.escrow - o.customerPays),
    saved: a.saved + (o.saved || 0),
  });
  const p = getState().partners.find(x => x.id === o.partnerId);
  if (p) dispatch({ type: 'partner/patch', payload: { id: p.id, patch: {
    completed: (p.completed || 0) + 1, starts: (p.starts || 0) + 1,
    onTimeStarts: (p.onTimeStarts || 0) + 1, lastActiveTs: Date.now() } } });

  audit.record(pct >= 1 ? audit.ACTIONS.ESCROW_RELEASE : audit.ACTIONS.ESCROW_PARTIAL,
               { id: o.id, amount: r.workerPayout, refund: r.refund, pct }, me() ? me().key : 'admin');
  toast(pct >= 1 ? `${M.fmt(r.workerPayout)} released to ${o.partnerName}` : `Partial — ${M.fmt(r.refund)} refunded`);
}

export async function cancelOrder(orderId, ruleId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const split = cancelSplit(o.deal, ruleId);
  advance(orderId, 'CANCELLED', { cancelRule: ruleId, refund: split.refund, cancelledAt: Date.now() });
  if (split.refund) await ledger('REFUND', split.refund, 'ESCROW:' + o.id, 'CUSTOMER:' + o.customerKey, { ruleId });
  if (split.worker) await ledger('COMPENSATION', split.worker, 'ESCROW:' + o.id, 'PARTNER:' + o.partnerId, { ruleId });
  const a = getState().agg;
  bumpAgg({ escrow: Math.max(0, a.escrow - o.customerPays), refunds: a.refunds + split.refund });
  audit.record('booking.cancelled', { id: o.id, ruleId, refund: split.refund }, me() ? me().key : 'system');
  toast(split.label);
}

/* ── DISPUTE: 3 taps to raise ──────────────────────────────── */
export const DISPUTE_REASONS = ['Not done', 'Partly done', 'Damage', 'Late / No-show',
                                'Overcharged', 'Rude or unsafe', 'Wrong person came'];
export function raiseDispute(orderId, reason, note) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  const d = { id: nid('dsp'), orderId, reason, note: note || '', by: me() && me().key,
              openedAt: Date.now(), status: 'OPEN', amount: o.customerPays };
  dispatch({ type: 'dispute/open', payload: d });
  if (canTransition(o.stage, 'DISPUTED')) advance(orderId, 'DISPUTED', { disputed: true, disputeReason: reason });
  audit.record('dispute.opened', { id: d.id, orderId, reason }, me() && me().key);
  toast('Reported. Your money is frozen until this is settled.');
  return d;
}

/* ── RETAIL: cart + checkout ───────────────────────────────── */
export function getCart() {
  const s = me(); if (!s) return null;
  return getState().carts[s.key] || null;
}
/** One shop per cart, enforced (V2-B4, confidence 5). */
export function addToCart(product, qty = 1) {
  const s = me();
  if (!s) { toast('Sign in to start a cart'); return { needsAuth: true }; }
  const cart = getCart();
  if (cart && cart.shopId !== product.shopId && cart.lines.length) {
    return { conflict: true, currentShopId: cart.shopId, product, qty };
  }
  const lines = (cart && cart.shopId === product.shopId ? cart.lines : []).slice();
  const i = lines.findIndex(l => l.productId === product.id);
  if (i >= 0) lines[i] = { ...lines[i], qty: lines[i].qty + qty };
  else lines.push({
    lineId: nid('ln'), productId: product.id, shopId: product.shopId,
    name: product.name, unit: product.unit, unitPrice: product.price, mrp: product.mrp,
    qty, variableWeight: product.variableWeight, subPolicy: product.subPolicyDefault || 'call',
    rxRequired: product.rxRequired, addedAt: Date.now(),
  });
  dispatch({ type: 'cart/set', payload: { key: s.key, cart: { shopId: product.shopId, lines } } });
  return { ok: true, count: lines.reduce((n, l) => n + l.qty, 0) };
}
export function setLineQty(lineId, qty) {
  const s = me(); const cart = getCart(); if (!cart) return;
  const lines = cart.lines.map(l => l.lineId === lineId ? { ...l, qty } : l).filter(l => l.qty > 0);
  if (!lines.length) dispatch({ type: 'cart/clear', payload: { key: s.key } });
  else dispatch({ type: 'cart/set', payload: { key: s.key, cart: { ...cart, lines } } });
}
export function setLineSubPolicy(lineId, policy) {
  const s = me(); const cart = getCart(); if (!cart) return;
  const lines = cart.lines.map(l => l.lineId === lineId ? { ...l, subPolicy: policy } : l);
  dispatch({ type: 'cart/set', payload: { key: s.key, cart: { ...cart, lines } } });
}
export function clearCart() { const s = me(); if (s) dispatch({ type: 'cart/clear', payload: { key: s.key } }); }

export function cartQuote(mode = 'rider') {
  const cart = getCart(); if (!cart) return null;
  const shop = getState().shops.find(s => s.id === cart.shopId);
  if (!shop) return null;
  const km = kmBetween(myArea(), shop.area);
  const first = (shop.ordersCompleted || 0) < 30;
  return { shop, km, ...quoteRetail(cart.lines, { catId: shop.catId, km, mode, firstOrders: first }) };
}

export async function placeRetailOrder(mode = 'rider') {
  const s = me(); if (!s) throw new Error('Please sign in first');
  const cart = getCart(); const q = cartQuote(mode);
  if (!cart || !q) return null;
  const now = Date.now();
  const order = {
    id: nid('ord'), kind: 'retail', catId: q.shop.catId, shopId: q.shop.id, shopName: q.shop.name,
    customerKey: s.key, customerName: s.name, customerArea: s.area,
    lines: cart.lines.map(l => ({ ...l, pickedQty: null, status: 'pending' })),
    itemsTotal: q.itemsTotal, deliveryFee: q.deliveryFee, customerPays: q.customerPays,
    platformFee: q.platformFee, gst: q.platformFeeGst, shopPayout: q.shopPayout,
    riderPayout: q.riderPayout, mode, km: q.km, eta: q.shop.prepMins + etaMins(q.km),
    provisional: cart.lines.some(l => l.variableWeight),
    stage: 'R_PLACED', stageTs: now, createdAt: now,
    history: [{ stage: 'R_CART', at: now }, { stage: 'R_PLACED', at: now }],
    otp: makeOtp(), evidence: [],
  };
  dispatch({ type: 'order/add', payload: order });
  await ledger('ESCROW_IN', q.customerPays, 'CUSTOMER:' + s.key, 'ESCROW:' + order.id, { shopId: q.shop.id });
  bumpAgg({ escrow: getState().agg.escrow + q.customerPays });
  clearCart();
  audit.record('retail.placed', { id: order.id, shopId: q.shop.id, total: q.customerPays }, s.key);
  setTimeout(() => advance(order.id, 'R_ACCEPTED', {}), 1100);
  return order;
}

export async function settleRetail(orderId) {
  const o = getState().orders.find(x => x.id === orderId);
  if (!o) return;
  advance(orderId, 'R_SETTLED', { settledAt: Date.now() });
  await ledger('SHOP_PAYOUT', o.shopPayout, 'ESCROW:' + o.id, 'SHOP:' + o.shopId, {});
  if (o.platformFee) await ledger('FEE', o.platformFee, 'ESCROW:' + o.id, 'PLATFORM:FEE', {});
  if (o.riderPayout) await ledger('RIDER', o.riderPayout, 'ESCROW:' + o.id, 'RIDER:pool', {});
  const a = getState().agg;
  bumpAgg({ retailOrders: a.retailOrders + 1, gmv: a.gmv + o.itemsTotal,
            revenue: a.revenue + o.platformFee, escrow: Math.max(0, a.escrow - o.customerPays) });
  toast(`Settled — ${M.fmt(o.shopPayout)} to ${o.shopName}`);
}

/* ── shop owner: self-listing ──────────────────────────────── */
export function addProductFromStarter(shopId, sc, priceOverride, stock) {
  const p = {
    id: nid('pr'), shopId, catId: sc.catId, refId: sc.refId,
    name: sc.name, aisle: sc.aisle, unit: sc.unit,
    price: priceOverride ?? sc.price, mrp: sc.mrp,
    stockQty: stock ?? 10, lowStockAt: 5, trackStock: !sc.variableWeight,
    variableWeight: sc.variableWeight, coldChain: sc.coldChain, perishable: sc.perishable,
    rxRequired: sc.rxRequired, bookingOnly: sc.bookingOnly,
    subPolicyDefault: sc.subPolicyDefault, active: true, soldCount: 0, createdAt: Date.now(),
  };
  dispatch({ type: 'product/add', payload: p });
  audit.record('listing.added', { id: p.id, shopId, name: p.name }, me() && me().key);
  return p;
}
export function addCustomProduct(shopId, catId, fields) {
  const p = { id: nid('pr'), shopId, catId, refId: null, active: true, soldCount: 0,
              lowStockAt: 5, trackStock: true, createdAt: Date.now(), ...fields };
  dispatch({ type: 'product/add', payload: p });
  return p;
}
/** MRP lock: selling above MRP is illegal under Legal Metrology. Refuse it. */
export function setProductPrice(productId, pricePaise) {
  const p = getState().products.find(x => x.id === productId);
  if (!p) return { ok: false };
  if (p.mrp && pricePaise > p.mrp)
    return { ok: false, reason: `You cannot sell above MRP (${M.fmt(p.mrp)}) — it is illegal under Legal Metrology.` };
  dispatch({ type: 'product/patch', payload: { id: productId, patch: { price: pricePaise } } });
  return { ok: true };
}

/* ── shared ────────────────────────────────────────────────── */
function bumpAgg(patch) { dispatch({ type: 'agg/bump', payload: patch }); }
export function sendChat(orderId, text) {
  const s = me(); if (!s || !text.trim()) return;
  const flagged = /\b\d{10}\b|@(ok|ybl|paytm|upi|axl)|\bcash\b|\bgpay\b|\bphonepe\b/i.test(text);
  const msg = { id: nid('m'), name: s.name, role: s.role, text: flagged ? maskContact(text) : text,
                ts: Date.now(), flagged };
  dispatch({ type: 'chat/add', payload: { orderId, msg } });
  if (flagged) { audit.record('fraud.offplatform', { orderId, by: s.key }); toast('Phone numbers and payment IDs are hidden — keep payments in SAAHAA so both sides stay protected.', 'warn'); }
  return msg;
}
const maskContact = t => t.replace(/\b\d{10}\b/g, '••••••••••').replace(/@(ok|ybl|paytm|upi|axl)\w*/gi, '@•••');

export { trustScore, rankShops, quoteService, compareWithApps, M as money };
