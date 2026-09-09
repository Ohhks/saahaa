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
    requests: [],   // open service requests, out for bids
    bids:     [],   // sealed bids against those requests
    orders:   [],   // service AND retail, discriminated by .kind
    carts:    {},   // userKey -> { shopId, lines:[] }   (one shop per cart)
    ledger:   [],
    chain:    { length: 0, lastHash: 'GENESIS' },
    reviews:  [],
    disputes: [],
    chats:    {},
    agg:      { serviceOrders:0, retailOrders:0, gmv:0, revenue:0, gst:0, refunds:0, escrow:0, saved:0 },
    admin:    { setupDone:false, salt:'', iterations:0, hash:'', changedAt:0 },
    settings: { pricing: null },   // the owner's dials; null = launch defaults (domain/settings.js)
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

/* Requests and bids are the P2P auction. Bids are SEALED — the reducer stores
   them all, and it is the VIEW's job never to show one bidder another's price
   while the window is open. */
register('reducer', { id:'requests', slice:'requests', reduce(s = [], a) {
  switch (a.type) {
    case 'request/add':   return [a.payload].concat(s).slice(0, 200);
    case 'request/patch': return patch(s, a.payload.id, r => ({ ...r, ...a.payload.patch }));
    default: return s;
  }
}});

register('reducer', { id:'bids', slice:'bids', reduce(s = [], a) {
  switch (a.type) {
    /* BIDS GROW FOREVER OTHERWISE. Requests are capped at 200 and each one can
       draw several sealed rates, so this list outruns every other slice in the
       state — on a device that never clears, it is the first thing to fill the
       5 MB. Losing the tail of a decided auction costs nothing; the order it
       produced is the record that matters. */
    case 'bid/add':   return s.concat([a.payload]).slice(-1200);
    case 'bid/patch': return patch(s, a.payload.id, b => ({ ...b, ...a.payload.patch }));
    case 'bid/rejectOthers':
      return s.map(b => (b.requestId === a.payload.requestId && b.id !== a.payload.keepId
                         && ['submitted','shortlisted','countered'].includes(b.status))
                        ? { ...b, status: 'rejected' } : b);
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
    /* A cap here has to be careful: an open dispute is somebody waiting for
       their money back, and a plain slice() would eventually evict the oldest
       one — which is precisely the one that has been waiting longest. So every
       unresolved dispute is kept, however old, and only the RESOLVED tail is
       trimmed. */
    case 'dispute/open': {
      const next = [a.payload].concat(s);
      if (next.length <= 300) return next;
      const open = next.filter(d => !d.resolvedAt);
      const done = next.filter(d => d.resolvedAt).slice(0, Math.max(0, 300 - open.length));
      return open.concat(done);
    }
    case 'dispute/resolve':return patch(s, a.payload.id, d => ({ ...d, ...a.payload.patch, resolvedAt:Date.now() }));
    default: return s;
  }
}});

register('reducer', { id:'chats', slice:'chats', reduce(s = {}, a) {
  if (a.type === 'chat/add') {
    const list = (s[a.payload.orderId] || []).concat([a.payload.msg]);
    return { ...s, [a.payload.orderId]: list.slice(-200) };
  }
  /* Erasure (domain/erase.js): the message stays so the other side's thread
     still reads as a conversation, but the words and the name go — what a
     person wrote is part of the person. */
  if (a.type === 'chat/scrub') {
    const who = a.payload.name;
    const out = {};
    for (const [oid, msgs] of Object.entries(s)) {
      out[oid] = msgs.map(m => m.name === who
        ? { ...m, name: 'Removed account', text: '(message removed)', scrubbed: true } : m);
    }
    return out;
  }
  return s;
}});

register('reducer', { id:'agg', slice:'agg', reduce(s = {}, a) {
  return a.type === 'agg/bump' ? { ...s, ...a.payload } : s;
}});

register('reducer', { id:'settings', slice:'settings', reduce(s = { pricing: null, automation: null }, a) {
  return a.type === 'settings/set' ? { ...s, ...a.payload } : s;
}});

register('reducer', { id:'admin', slice:'admin', reduce(s = {}, a) {
  return a.type === 'admin/set' ? { ...s, ...a.payload } : s;
}});

register('reducer', { id:'meta', slice:'seeded', reduce(s = false, a) {
  /* `seed/reset` exists so a demo purge can also forget that a seed happened.
     Without it ?demo=1 worked exactly once per device: the purge removed the
     roster and left this true, so nothing ever re-seeded. */
  if (a.type === 'seed/reset') return false;
  return a.type === 'seed/done' ? true : s;
}});

register('reducer', { id:'createdAt', slice:'createdAt', reduce(s = 0, a) {
  return a.type === 'meta/born' && !s ? a.payload : s;
}});

register('reducer', { id:'schema', slice:'schemaVersion', reduce(s = SCHEMA_VERSION) { return s; }});
