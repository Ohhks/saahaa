/* SAAHAA · core/selftests.recovery.js — getting back into an account.

   These cover the parts that do not need a store: the shape of the code and
   the rule about when a reset is still live. The full issue/redeem round trip
   needs a running store and is walked by the guardian.

   The thing being protected: a pro's account is their livelihood, and a reset
   is the one door into it that is not the password. A door like that must be
   short-lived, single-use, and unhelpful to anyone guessing. */

import { describe, it, expect } from './selftest.js';
import * as R from '../domain/recovery.js';

describe('recovery · a code somebody can read down a phone line', () => {
  it('is the stated length and avoids the characters people mishear', () => {
    for (let i = 0; i < 200; i++) {
      const c = R.makeCode();
      expect(c).toHaveLength(R.CODE_LEN);
      expect(c).toSatisfy(x => !/[IO01]/.test(x), 'no I, O, 0 or 1 — they are misread aloud: ' + c);
      expect(c).toSatisfy(x => /^[A-Z2-9]+$/.test(x), 'upper case and digits only: ' + c);
    }
  });
  it('does not repeat itself', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(R.makeCode());
    expect(seen.size).toSatisfy(n => n > 290, 'codes are not predictable');
  });
  it('is forgiving about how it is typed back', () => {
    expect(R.normalise(' a2c-4e6 ')).toBe('A2C4E6');
    expect(R.normalise(null)).toBe('');
  });
});

describe('recovery · the door closes by itself', () => {
  const now = 1_000_000;
  it('a reset is live only until it expires', () => {
    const live = { reset: { hash: 'h', expiresAt: now + 1000 } };
    expect(R.pending(live, now)).toBeTrue();
    expect(R.pending(live, now + 2000)).toBeFalse();
  });
  it('an account with no reset, or one already used, is not open', () => {
    expect(R.pending({}, now)).toBeFalse();
    expect(R.pending({ reset: null }, now)).toBeFalse();
    expect(R.pending({ reset: { expiresAt: now + 1000 } }, now)).toBeFalse();   // no hash: used
    expect(R.pending(null, now)).toBeFalse();
  });
  it('the window is half an hour — long enough for a phone call, not a day', () => {
    expect(R.TTL_MS).toBe(30 * 60 * 1000);
  });
});
