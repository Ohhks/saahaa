/* SAAHAA · core/selftests.photos.js — the picture store.

   What these protect: a device with 5MB of storage for EVERYTHING, shared with
   the state, the audit log and the backups. A photo store that quietly grows
   takes the whole app down with a QuotaExceededError at the worst moment —
   mid-checkout, on somebody's only phone. So the budget is tested, refusal is
   tested, and the fact that a tampered store cannot put a hostile string into
   an <img src> is tested. */

import { describe, it as rawIt, expect } from './selftest.js';
import * as P from '../core/photos.js';
import * as persist from '../core/persist.js';

/* a valid, tiny data URL — the shape toDataURL('image/jpeg') produces */
const img = (n = 40) => 'data:image/jpeg;base64,' + 'A'.repeat(n);

/* THE SUITE RUNS ON ITS OWN SHELF. It used to call gc([]) against the real
   store to tidy up between cases, so pressing "Run tests" in the admin console
   deleted every picture on the device.

   The shelf is switched around each test and put back afterwards — NOT at
   import time, because these modules are imported at boot and that would move
   the whole running app onto the test shelf. */
const it = (name, fn) => rawIt(name, async () => {
  const restore = P.useShelf('selftest');
  try { return await fn(); } finally { P.gc([]); restore(); }
});
const clear = () => { P.gc([]); };

describe('photos · a picture is stored by id, never inside the state blob', () => {
  it('round-trips, and the state blob is not where it went', () => {
    clear();
    const r = P.put(img(64));
    expect(r.ok).toBeTrue();
    expect(P.url(r.id)).toBe(img(64));
    expect(P.has(r.id)).toBeTrue();
    // the picture lives under its own key, so writing the state never rewrites it
    expect(String(persist.read('SAAHAA_V6_STATE', '') || '')).toSatisfy(
      s => !String(s).includes('data:image/'), 'no image bytes in the state blob');
  });
  it('remove takes it away and frees the budget', () => {
    clear();
    const r = P.put(img(64));
    const before = P.usage().bytes;
    expect(P.remove(r.id)).toBeTrue();
    expect(P.url(r.id)).toBe('');
    expect(P.usage().bytes).toSatisfy(b => b < before, 'budget came back');
    expect(P.remove(r.id)).toBeFalse();          // idempotent
  });
});

describe('photos · the budget is real, and refusing is honest', () => {
  it('one oversized picture is refused with a reason a person can act on', () => {
    clear();
    const r = P.put(img(P.MAX_ONE + 10));
    expect(r.ok).toBeFalse();
    expect(r.reason).toContain('KB');
  });
  it('the total is capped, and a refusal never deletes what is already there', () => {
    clear();
    const kept = [];
    // fill most of the budget with legal-sized pictures
    for (let i = 0; i < 40; i++) {
      const r = P.put(img(P.MAX_ONE - 200));
      if (r.ok) kept.push(r.id); else break;
    }
    const used = P.usage();
    expect(used.bytes).toSatisfy(b => b <= P.MAX_TOTAL, 'never over the cap');
    const before = used.count;
    const over = P.put(img(P.MAX_ONE - 200));
    if (!over.ok) {
      expect(over.reason).toContain('full');
      expect(P.usage().count).toBe(before);      // nothing was evicted to make room
      kept.forEach(id => expect(P.has(id)).toBeTrue());
    }
    clear();
  });
  it('usage reports something a screen can show', () => {
    clear();
    P.put(img(64));
    const u = P.usage();
    expect(u.count).toBe(1);
    expect(u.pct).toSatisfy(p => p >= 0 && p <= 100, 'a percentage');
    expect(u.freeBytes).toSatisfy(b => b > 0, 'room left');
  });
});

describe('photos · nothing but a real image ever reaches an <img>', () => {
  it('refuses anything that is not a raster data URL', () => {
    clear();
    ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'data:image/svg+xml;base64,AAAA',
     'http://example.com/a.jpg', '', null, undefined, 42].forEach(bad => {
      expect(P.isPhotoUrl(bad)).toBeFalse();
      expect(P.put(bad).ok).toBeFalse();
    });
  });
  it('a store tampered with by hand reads back as no picture, not as a payload', () => {
    clear();
    const r = P.put(img(64));
    persist.write(P.storageKey(r.id), 'javascript:alert(1)');   // straight past put()'s validation
    expect(P.url(r.id)).toBe('');                 // treated as missing
  });
  it('svg is refused — it can carry script, and a shop front does not need it', () => {
    expect(P.isPhotoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeFalse();
  });
});

describe('photos · orphans are collected, live pictures are not', () => {
  it('gc keeps what is referenced and drops what is not', () => {
    clear();
    const a = P.put(img(64)).id, b = P.put(img(64)).id;
    expect(P.gc([a])).toBe(1);
    expect(P.has(a)).toBeTrue();
    expect(P.has(b)).toBeFalse();
    clear();
  });
  it('referenced() finds every id a state points at', () => {
    const ids = P.referenced({
      shops: [{ photo: 's1', gallery: ['s2', 's3'] }],
      products: [{ photo: 'p1' }, {}],
      partners: [{ photo: 'w1', work: ['w2'] }],
      orders: [{ evidence: [{ photo: 'e1' }, { label: 'no photo' }] }],
    });
    expect(ids.sort()).toEqual(['e1', 'p1', 's1', 's2', 's3', 'w1', 'w2']);
  });
});
