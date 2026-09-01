/* SAAHAA · core/ctx.js — the app context singleton.
   Views import THIS, never app.js, so there is no import cycle and any view
   can be loaded, tested or removed independently. app.js fills it at boot. */

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
export const myArea = () => (ctx.session && ctx.session.area) || 'Madhapur';

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
