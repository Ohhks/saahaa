/* SAAHAA · domain/state.js — the state tree + its reducers.
   Reducers are PURE and REGISTERED. Adding a new slice of state means
   registering one more reducer file; combineFromRegistry() picks it up with
   no edit to the store. */

import { register } from '../core/registry.js';
import { SCHEMA_VERSION } from '../core/version.js';

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: 0,
    users:    [],   // customers + partners + shop owners (one account spine)
    partners: [],   // worker/pro profiles (1:1 with a user of role 'partner')
    shops:    [],
    products: [],
    orders:   [],   // service AND retail, discriminated by .kind
    carts:    {},   // userKey -> { shopId, lines:[] }   (one shop per cart)
    ledger:   [],
    chain:    { length: 0, lastHash: 'GENESIS' },
    reviews:  [],
    disputes: [],
    chats:    {},
    agg:      { serviceOrders:0, retailOrders:0, gmv:0, revenue:0, gst:0, refunds:0, escrow:0, saved:0 },
    admin:    { setupDone:false, salt:'', iterations:0, hash:'', changedAt:0 },
    seeded:   false,
  };
}

/* ── helpers ───────────────────────────────────────────────── */
const upsert = (list, item, key = 'id') => {
  const i = list.findIndex(x => x[key] === item[key]);
  if (i < 0) return list.concat([item]);
  const next = list.slice(); next[i] = { ...next[i], ...item }; return next;
};
const patch = (list, id, fn, key = 'id') => {
  const i = list.findIndex(x => x[key] === id);
  if (i < 0) return list;
  const next = list.slice(); next[i] = fn(next[i]); return next;
};

/* ── reducers ──────────────────────────────────────────────── */
register('reducer', { id:'users', slice:'users', reduce(s = [], a) {
  switch (a.type) {
    case 'user/add':    return upsert(s, a.payload, 'key');
    case 'user/patch':  return patch(s, a.payload.key, u => ({ ...u, ...a.payload.patch }), 'key');
    case 'user/remove': return s.filter(u => u.key !== a.payload.key);
    case 'seed/users':  return a.payload;
    default: return s;
  }
}});

register('reducer', { id:'partners', slice:'partners', reduce(s = [], a) {
  switch (a.type) {
    case 'partner/add':   return upsert(s, a.payload);
    case 'partner/patch': return patch(s, a.payload.id, p => ({ ...p, ...a.payload.patch }));
    case 'partner/rate':  return patch(s, a.payload.id, p => ({
      ...p, ratings: (p.ratings || []).concat([a.payload.rating]).slice(-50) }));
    case 'seed/partners': return a.payload;
    default: return s;
  }
}});

register('reducer', { id:'shops', slice:'shops', reduce(s = [], a) {
  switch (a.type) {
    case 'shop/add':    return upsert(s, a.payload);
    case 'shop/patch':  return patch(s, a.payload.id, x => ({ ...x, ...a.payload.patch }));
    case 'shop/toggle': return patch(s, a.payload.id, x => ({ ...x, isOpen: !x.isOpen }));
    case 'seed/shops':  return a.payload;
    default: return s;
  }
}});

register('reducer', { id:'products', slice:'products', reduce(s = [], a) {
  switch (a.type) {
    case 'product/add':     return upsert(s, a.payload);
    case 'product/addMany': return a.payload.reduce((acc, p) => upsert(acc, p), s);
    case 'product/patch':   return patch(s, a.payload.id, p => ({ ...p, ...a.payload.patch }));
    case 'product/remove':  return s.filter(p => p.id !== a.payload.id);
    case 'product/stock':   return patch(s, a.payload.id, p => ({ ...p, stockQty: Math.max(0, a.payload.qty) }));
    case 'seed/products':   return a.payload;
    default: return s;
  }
}});

register('reducer', { id:'orders', slice:'orders', reduce(s = [], a) {
  switch (a.type) {
    case 'order/add':   return [a.payload].concat(s).slice(0, 400);
    case 'order/patch': return patch(s, a.payload.id, o => ({ ...o, ...a.payload.patch }));
    case 'order/replace': return patch(s, a.payload.id, () => a.payload.order);
    case 'seed/orders': return a.payload;
    default: return s;
  }
}});

register('reducer', { id:'carts', slice:'carts', reduce(s = {}, a) {
  switch (a.type) {
    case 'cart/set':   return { ...s, [a.payload.key]: a.payload.cart };
    case 'cart/clear': { const n = { ...s }; delete n[a.payload.key]; return n; }
    default: return s;
  }
}});

register('reducer', { id:'ledger', slice:'ledger', reduce(s = [], a) {
  switch (a.type) {
    case 'ledger/append': return s.concat([a.payload]).slice(-2000);
    default: return s;
  }
}});

register('reducer', { id:'chain', slice:'chain', reduce(s = { length:0, lastHash:'GENESIS' }, a) {
  return a.type === 'ledger/append'
    ? { length: a.payload.blockIdx + 1, lastHash: a.payload.hash }
    : s;
}});

register('reducer', { id:'reviews', slice:'reviews', reduce(s = [], a) {
  switch (a.type) {
    case 'review/add':  return [a.payload].concat(s).slice(0, 500);
    case 'review/hide': return patch(s, a.payload.id, r => ({ ...r, hidden:true, hiddenAt:Date.now() }));
    default: return s;
  }
}});

register('reducer', { id:'disputes', slice:'disputes', reduce(s = [], a) {
  switch (a.type) {
    case 'dispute/open':   return [a.payload].concat(s);
    case 'dispute/resolve':return patch(s, a.payload.id, d => ({ ...d, ...a.payload.patch, resolvedAt:Date.now() }));
    default: return s;
  }
}});

register('reducer', { id:'chats', slice:'chats', reduce(s = {}, a) {
  if (a.type !== 'chat/add') return s;
  const list = (s[a.payload.orderId] || []).concat([a.payload.msg]);
  return { ...s, [a.payload.orderId]: list.slice(-200) };
}});

register('reducer', { id:'agg', slice:'agg', reduce(s = {}, a) {
  return a.type === 'agg/bump' ? { ...s, ...a.payload } : s;
}});

register('reducer', { id:'admin', slice:'admin', reduce(s = {}, a) {
  return a.type === 'admin/set' ? { ...s, ...a.payload } : s;
}});

register('reducer', { id:'meta', slice:'seeded', reduce(s = false, a) {
  return a.type === 'seed/done' ? true : s;
}});

register('reducer', { id:'createdAt', slice:'createdAt', reduce(s = 0, a) {
  return a.type === 'meta/born' && !s ? a.payload : s;
}});

register('reducer', { id:'schema', slice:'schemaVersion', reduce(s = SCHEMA_VERSION) { return s; }});
