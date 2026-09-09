/* SAAHAA · core/selftests.erase.js — the right to be removed.

   The privacy page promises a person can have their data deleted. A promise
   about deletion is only worth what the mechanism actually does, so these tests
   pin down all three halves of it: what goes, what is emptied but kept because
   somebody ELSE's record points at it, and what stays because the books must
   balance and the law says so.

   The one that matters most is the last: an erasure must never break the
   ledger. If it did, the honest thing would be to refuse to erase — so this
   suite would rather fail than let that ship quietly. */

import { describe, it, expect } from './selftest.js';
import * as E from '../domain/erase.js';

/* A state with one customer who has an order, a review and a chat, plus a pro
   and a shop of their own — everything erasure has to reason about. */
const world = () => ({
  users: [
    { key: 'C20262001', code: 'C20262001', role: 'customer', name: 'Kavya M', mobile: '9876543210' },
    { key: 'P20262001', code: 'P20262001', role: 'partner', name: 'Rao', mobile: '9811111111' },
  ],
  partners: [{ id: 'p1', userKey: 'P20262001', name: 'Rao', mobile: '9811111111',
               photo: 'ph_a', selfie: 'ph_b', work: ['ph_c'], online: true }],
  shops: [{ id: 's1', ownerKey: 'P20262001', name: 'Rao Hardware', photo: 'ph_d', isOpen: true }],
  products: [{ id: 'pr1', shopId: 's1', photo: 'ph_e' }],
  orders: [{ id: 'o1', customerKey: 'C20262001', customerName: 'Kavya M', customerArea: 'Madhapur',
             customerLoc: { lat: 17.4, lng: 78.3 }, partnerId: 'p1' }],
  reviews: [{ id: 'rv1', byKey: 'C20262001', byName: 'Kavya M', stars: 5, text: 'Neat work' }],
  chats: { o1: [{ id: 'm1', name: 'Kavya M', text: 'Gate code is 4471' },
                { id: 'm2', name: 'Rao', text: 'On my way' }] },
  ledger: [{ id: 'l1', partyA: 'WORLD:funding', partyB: 'CUSTOMER:C20262001', amountPaise: 5000 },
           { id: 'l2', partyA: 'ESCROW:o1', partyB: 'PARTNER:p1', amountPaise: 4000 }],
});

describe('erase · the plan says what will happen before anything happens', () => {
  it('finds the account and counts what it touches', () => {
    const plan = E.erasePlan('C20262001', world());
    expect(plan.found).toBeTrue();
    expect(plan.account.code).toBe('C20262001');
    expect(plan.deIdentified.orders).toBe(1);
    expect(plan.kept.ledgerLegs).toBe(1);          // the leg naming CUSTOMER:C20262001
  });
  it('says plainly why the ledger is kept', () => {
    expect(E.erasePlan('C20262001', world()).kept.reason).toContain('books');
  });
  it('an account nobody holds is reported as not found, not silently "done"', () => {
    expect(E.erasePlan('C99999999', world()).found).toBeFalse();
  });
  it('counts every picture a pro and their shop are responsible for', () => {
    // portrait, selfie, one work photo, the shop front, one product picture
    expect(E.photoIdsOf('P20262001', world()).sort()).toEqual(['ph_a', 'ph_b', 'ph_c', 'ph_d', 'ph_e']);
  });
  it('planning changes nothing', () => {
    const st = world();
    const before = JSON.stringify(st);
    E.erasePlan('C20262001', st); E.erasePlan('P20262001', st);
    expect(JSON.stringify(st)).toBe(before);
  });
});

describe('erase · what is kept is kept for a stated reason', () => {
  it('the ledger legs are never counted as removable', () => {
    const plan = E.erasePlan('P20262001', world());
    expect(plan.kept.ledgerLegs).toSatisfy(n => n >= 1, 'the pro was paid, and that leg stays');
    expect(plan.removed.account).toBe(1);
  });
  it('a pro and a shop are de-identified rather than deleted, because orders point at them', () => {
    const plan = E.erasePlan('P20262001', world());
    expect(plan.deIdentified.pros).toBe(1);
    expect(plan.deIdentified.shops).toBe(1);
  });
  it('the words a person wrote are counted as removed, not kept', () => {
    const plan = E.erasePlan('C20262001', world());
    expect(plan.removed.reviewsWritten).toBe(1);
    expect(plan.removed.chatThreads).toBe(1);
  });
});
