/* SAAHAA · core/ctx.js — the app context singleton.
   Views import THIS, never app.js, so there is no import cycle and any view
   can be loaded, tested or removed independently. app.js fills it at boot. */

import * as persist from './persist.js';
import { USER_SESSION_MS } from './security.js';

export const ctx = {
  store: null,
  session: null,          // { key, name, role, area, ... } or null for guest
  view: 'home',           // current route
  param: null,            // route parameter (catId, shopId, orderId…)
  ready: false,
  render: () => {},       // set by app.js
  go: () => {},           // set by app.js
};

export const getState = () => ctx.store.getState();
export const dispatch = a => ctx.store.dispatch(a);
export const me = () => ctx.session;
export const isGuest = () => !ctx.session;
/* A guest who picks an area was previously ignored: the value was written to
   localStorage and never read back, so the header kept saying Madhapur and
   every distance was wrong. */
export const myArea = () =>
  (ctx.session && ctx.session.area) || persist.read(persist.KEYS.guestArea, '') || 'Madhapur';

/* The session used to live only in memory, so every refresh — and every PWA
   relaunch — silently signed the user out. A partner would sign in, reload,
   and find the Earn tab showing the guest pitch instead of their console. */
export function saveSession(s) {
  /* Every session carries the moment it was ISSUED. Without it a session was
     immortal: a phone signed in once stayed signed in for the life of the
     device, and a lost handset kept someone's wallet and order history open
     forever. See core/security.js · USER_SESSION_MS.

     `issuedAt` is stamped on the in-memory object too, and carried forward
     when one is already present — otherwise every re-save (changing area, for
     instance) would silently renew the clock and the expiry would never fire
     for an active user. Signing in afresh is what starts a new 30 days. */
  ctx.session = s ? { ...s, issuedAt: s.issuedAt || Date.now() } : s;
  if (ctx.session) persist.write(persist.KEYS.session, ctx.session);
  else persist.remove(persist.KEYS.session);
  return ctx.session;
}
export function restoreSession(users) {
  const saved = persist.read(persist.KEYS.session, null);
  if (!saved || !saved.key) return null;
  /* An expired session — or one written before issuedAt existed, which we
     cannot date and therefore cannot trust — is cleared, not honoured. */
  const issuedAt = Number(saved.issuedAt) || 0;
  if (!issuedAt || Date.now() - issuedAt > USER_SESSION_MS) {
    persist.remove(persist.KEYS.session);
    ctx.session = null;
    return null;
  }
  // trust the stored key, but re-read the record so a role or tier change lands
  const fresh = (users || []).find(u => u.key === saved.key);
  ctx.session = fresh ? { ...fresh, area: saved.area || fresh.area, issuedAt } : null;
  if (!ctx.session) persist.remove(persist.KEYS.session);
  return ctx.session;
}

export function userByKey(key) { return getState().users.find(u => u.key === key) || null; }
export function myPartner() {
  const s = ctx.session;
  if (!s || s.role !== 'partner') return null;
  return getState().partners.find(p => p.userKey === s.key) || null;
}
export function myShop() {
  const s = ctx.session;
  if (!s || s.role !== 'shop') return null;
  return getState().shops.find(x => x.ownerKey === s.key) || null;
}
export function myOrders() {
  const s = ctx.session;
  if (!s) return [];
  const st = getState();
  if (s.role === 'partner') { const p = myPartner(); return st.orders.filter(o => p && o.partnerId === p.id); }
  if (s.role === 'shop')    { const sh = myShop();   return st.orders.filter(o => sh && o.shopId === sh.id); }
  return st.orders.filter(o => o.customerKey === s.key);
}
