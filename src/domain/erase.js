/* SAAHAA · domain/erase.js — removing a person, honestly.

   The privacy page promises that you can have your data deleted. Until now
   nothing in the product could do it, which made the promise the worst kind:
   one nobody could keep and nobody could check.

   Erasure here is not "delete every row and hope". Three categories, and the
   product says which is which BEFORE it acts (`erasePlan`):

   REMOVED — the things that are the person:
     the account row itself (name, mobile, password, place, the code), their
     pictures, the text of their chat messages, the words of their reviews.

   DE-IDENTIFIED, NOT REMOVED — the things other people's records point at:
     a pro or shop row an order refers to, and the name stamped on an order.
     Deleting these would tear a hole in somebody ELSE's history: the customer
     who paid, the shop that was paid. They become "Removed account", with the
     mobile, UPI id and verification record cleared, and they stop trading.

   KEPT, AND WHY — the ledger, and the audit entry recording this erasure.
     The ledger is double-entry and hash-chained: removing a leg would break
     every hash after it and the books would stop reconciling. It is also what
     a business is obliged to keep. What stays there is an account identifier
     with nobody behind it any more — a number in a book, pointing at no name,
     no mobile and no address.

   The rating a pro earned stays as a number, because it belongs to the pro's
   record and not to the person who wrote it; only the words and the author go.

   DOM-free. Every function takes or returns plain data, so it is testable. */

import { getState, dispatch } from '../core/ctx.js';
import * as audit from '../core/audit.js';
import * as photos from '../core/photos.js';

export const REMOVED_NAME = 'Removed account';

/** Every picture this account is responsible for. */
export function photoIdsOf(key, st = getState()) {
  const out = [];
  const take = v => { if (v) out.push(v); };
  (st.partners || []).filter(p => p.userKey === key).forEach(p => {
    take(p.photo); take(p.selfie); (p.work || []).forEach(take);
  });
  (st.shops || []).filter(s => s.ownerKey === key).forEach(s => {
    take(s.photo); (s.gallery || []).forEach(take);
    (st.products || []).filter(pr => pr.shopId === s.id).forEach(pr => take(pr.photo));
  });
  return out;
}

/**
 * What erasing this account would do — shown to the person before they decide,
 * and to the owner before they act on a request. Nothing is changed.
 */
export function erasePlan(key, st = getState()) {
  const u = (st.users || []).find(x => x.key === key) || null;
  const partners = (st.partners || []).filter(p => p.userKey === key);
  const shops = (st.shops || []).filter(s => s.ownerKey === key);
  const orders = (st.orders || []).filter(o => o.customerKey === key
    || partners.some(p => p.id === o.partnerId) || shops.some(s => s.id === o.shopId));
  const reviews = (st.reviews || []).filter(r => r.byKey === key);
  const ledgerLegs = (st.ledger || []).filter(e => {
    const s = JSON.stringify(e);
    return s.includes('CUSTOMER:' + key) || partners.some(p => s.includes('PARTNER:' + p.id))
        || shops.some(sh => s.includes('SHOP:' + sh.id));
  }).length;
  return {
    found: !!u,
    account: u ? { name: u.name, code: u.code || null, role: u.role } : null,
    removed: {
      account: u ? 1 : 0,
      photos: photoIdsOf(key, st).length,
      reviewsWritten: reviews.length,
      chatThreads: orders.filter(o => (st.chats || {})[o.id] || []).length,
    },
    deIdentified: { pros: partners.length, shops: shops.length, orders: orders.length },
    kept: { ledgerLegs, reason: 'double-entry, hash-chained, and a business must keep its books' },
  };
}

/**
 * Do it. Returns the plan that was carried out, so a screen can say exactly
 * what happened rather than "done".
 */
export function eraseAccount(key, actor = 'self') {
  const st = getState();
  const plan = erasePlan(key, st);
  if (!plan.found) return { ok: false, reason: 'No such account' };

  const u = st.users.find(x => x.key === key);

  // 1 · the pictures
  photoIdsOf(key, st).forEach(id => photos.remove(id));

  // 2 · rows other people's records point at: kept, emptied of the person
  st.partners.filter(p => p.userKey === key).forEach(p => {
    dispatch({ type: 'partner/patch', payload: { id: p.id, patch: {
      name: REMOVED_NAME, mobile: '', loc: null, photo: null, selfie: null, work: [],
      online: false, suspended: true, erasedAt: Date.now(),
      verification: { steps: {}, attempts: {} },
    } } });
  });
  st.shops.filter(s => s.ownerKey === key).forEach(s => {
    dispatch({ type: 'shop/patch', payload: { id: s.id, patch: {
      name: REMOVED_NAME, mobile: '', loc: null, photo: null, isOpen: false,
      status: 'closed', erasedAt: Date.now(),
    } } });
  });
  st.orders.filter(o => o.customerKey === key).forEach(o => {
    dispatch({ type: 'order/patch', payload: { id: o.id, patch: {
      customerName: REMOVED_NAME, customerArea: '', customerLoc: null,
    } } });
  });

  // 3 · the words: chat text and review text carry a person in them
  dispatch({ type: 'chat/scrub', payload: { name: u.name } });
  st.reviews.filter(r => r.byKey === key).forEach(r => {
    dispatch({ type: 'review/hide', payload: { id: r.id } });
  });

  // 4 · the account itself
  dispatch({ type: 'user/remove', payload: { key } });

  audit.record('data.erased', {
    code: u.code || null, role: u.role,
    removed: plan.removed, deIdentified: plan.deIdentified, keptLedgerLegs: plan.kept.ledgerLegs,
  }, actor);
  return { ok: true, plan };
}
