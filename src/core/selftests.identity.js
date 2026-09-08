/* SAAHAA · core/selftests.identity.js — account codes, and the rule that lets
   one person be a customer and a pro at once without the two ever mixing.

   The bug these guard against is not cosmetic: before codes, the account key
   was name+mobile, so the same person signing up twice produced the SAME key —
   one account silently overwriting the other, with its wallet and its orders
   pointing at whichever row won. */

import { describe, it, expect } from './selftest.js';
import * as ID from '../domain/identity.js';
import { runMigrations } from './migrate.js';

const AT = new Date('2026-05-05T10:00:00Z').getTime();
const mk = (role, mobile, users, createdAt = AT) => {
  const code = ID.nextCode(role, users, createdAt);
  const u = { key: code, code, role, mobile, createdAt, name: role + ' ' + mobile };
  users.push(u);
  return u;
};

describe('identity · the code says what the account is for', () => {
  it('reads as prefix, year, sequence — and the sequence starts at 2001', () => {
    const p = ID.parseCode('C20262001');
    expect(p.role).toBe('customer'); expect(p.year).toBe(2026); expect(p.seq).toBe(2001);
    expect(ID.roleOfCode('P20262001')).toBe('partner');
    expect(ID.roleOfCode('S20262001')).toBe('shop');
  });
  it('is forgiving about how a person types it, and strict about what counts', () => {
    expect(ID.isCode(' c2026 2001 ')).toBeTrue();
    expect(ID.normaliseCode('c-2026-2001')).toBe('C20262001');
    ['9876543210', 'C2026200', 'X20262001', 'hello', '', null].forEach(bad =>
      expect(ID.isCode(bad)).toBeFalse());
  });
  it('never hands the same code to two accounts that exist', () => {
    const users = [];
    const a = mk('customer', '9000000001', users), b = mk('customer', '9000000002', users);
    expect(a.code).toBe('C20262001'); expect(b.code).toBe('C20262002');
    expect(ID.nextCode('customer', users, AT)).toBe('C20262003');
    expect(new Set(users.map(u => u.code)).size).toBe(users.length);
  });
  it('an account with no usable createdAt is dated today, never 1970', () => {
    [0, null, undefined, 'nonsense'].forEach(ts => {
      const [u] = ID.backfillCodes([{ key: 'k', role: 'customer', mobile: '9000000001', createdAt: ts }], AT);
      expect(u.code).toBe('C20262001');
    });
  });
  it('counts each role separately, so a pro is P…2001 even when customers exist', () => {
    const users = [];
    mk('customer', '9000000001', users); mk('customer', '9000000002', users);
    expect(ID.nextCode('partner', users, AT)).toBe('P20262001');
    expect(ID.nextCode('shop', users, AT)).toBe('S20262001');
  });
  it('starts a new sequence in a new year', () => {
    const users = []; mk('customer', '9000000001', users);
    expect(ID.nextCode('customer', users, new Date('2027-01-02').getTime())).toBe('C20272001');
  });
});

describe('identity · one person, one number, two accounts', () => {
  const build = () => {
    const users = [];
    const cust = mk('customer', '9876543210', users);
    const pro  = mk('partner',  '9876543210', users);   // the SAME number
    mk('customer', '9000000009', users);
    return { users, cust, pro };
  };
  it('the two accounts are genuinely separate rows with separate keys', () => {
    const { cust, pro } = build();
    expect(cust.key).toBe('C20262001'); expect(pro.key).toBe('P20262001');
    expect(cust.key === pro.key).toBeFalse();
  });
  it('the number finds both; the code finds exactly one', () => {
    const { users } = build();
    const byNumber = ID.resolve('9876543210', users);
    expect(byNumber.kind).toBe('mobile'); expect(byNumber.matches).toHaveLength(2);
    const byId = ID.resolve('p20262001', users);
    expect(byId.kind).toBe('code'); expect(byId.matches).toHaveLength(1);
    expect(byId.matches[0].role).toBe('partner');
  });
  it('the customer account is offered first, so the common case is the default', () => {
    const { users } = ID.resolve ? build() : {};
    expect(ID.accountsOn('9876543210', users).map(u => u.role)).toEqual(['customer', 'partner']);
  });
  it('a number nobody holds, and junk, resolve to nothing rather than to somebody', () => {
    const { users } = build();
    expect(ID.resolve('9111111111', users).matches).toHaveLength(0);
    expect(ID.resolve('C20269999', users).matches).toHaveLength(0);
    expect(ID.resolve('nonsense', users).kind).toBe('unknown');
  });
  it('a code that is not an account is never mistaken for a number', () => {
    const { users } = build();
    expect(ID.resolve('S20262001', users).kind).toBe('code');
  });
});

describe('identity · accounts that predate codes keep everything they had', () => {
  const legacy = () => ([
    { key: 'anoosh kumar|9000000001', role: 'customer', mobile: '9000000001', createdAt: new Date('2026-01-03').getTime() },
    { key: 'amit verma|9100000001',   role: 'partner',  mobile: '9100000001', createdAt: new Date('2026-01-02').getTime() },
    { key: 'lakshmi|9200000001',      role: 'shop',     mobile: '9200000001', createdAt: new Date('2026-01-01').getTime() },
  ]);
  it('the internal key is never rewritten — orders and ledger legs point at it', () => {
    const before = legacy();
    const after = ID.backfillCodes(before, AT);
    expect(after.map(u => u.key)).toEqual(before.map(u => u.key));
  });
  it('codes are handed out oldest first, per role', () => {
    const after = ID.backfillCodes(legacy(), AT);
    const by = r => after.find(u => u.role === r).code;
    expect(by('customer')).toBe('C20262001');
    expect(by('partner')).toBe('P20262001');
    expect(by('shop')).toBe('S20262001');
  });
  it('running it twice changes nothing', () => {
    const once = ID.backfillCodes(legacy(), AT);
    expect(ID.backfillCodes(once, AT).map(u => u.code)).toEqual(once.map(u => u.code));
  });
});

describe('migration v10 · every account comes out with a code, nothing else moves', () => {
  it('a v9 tree gains codes and keeps its keys, its credential and its dials', () => {
    const v9 = {
      schemaVersion: 9, createdAt: 5, seeded: true,
      users: [{ key: 'a|9000000001', role: 'customer', mobile: '9000000001', createdAt: new Date('2026-02-01').getTime() },
              { key: 'b|9100000001', role: 'partner',  mobile: '9100000001', createdAt: new Date('2026-02-02').getTime() }],
      partners: [{ id: 'p1', userKey: 'b|9100000001', tier: 2, vouches: [] }],
      shops: [], products: [], orders: [{ id: 'o1', customerKey: 'a|9000000001' }],
      ledger: [], chain: { length: 0, lastHash: 'GENESIS' },
      admin: { hash: 'h', salt: 's', setupDone: true },
      settings: { pricing: { serviceMarkupPct: 9 }, automation: null },
    };
    const r = runMigrations(v9, { silent: true });
    expect(r.rolledBack || false).toBeFalse();
    const st = r.state;
    expect(st.schemaVersion).toSatisfy(n => n >= 10, 'at least 10');
    expect(st.users.map(u => u.code)).toEqual(['C20262001', 'P20262001']);
    // the joins still join
    expect(st.users.map(u => u.key)).toEqual(['a|9000000001', 'b|9100000001']);
    expect(st.orders[0].customerKey).toBe('a|9000000001');
    expect(st.partners[0].userKey).toBe('b|9100000001');
    expect(st.admin.hash).toBe('h');
    expect(st.settings.pricing.serviceMarkupPct).toBe(9);
  });
});
