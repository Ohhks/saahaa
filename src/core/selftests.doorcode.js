/* SAAHAA · core/selftests.doorcode.js — the code at the door.

   THE PRODUCT NO LONGER SENDS ANYBODY A CODE. There is no SMS rail, there was
   never going to be one, and the four-digit number a job used to generate was
   one more thing a customer had to find at the exact moment somebody was
   standing at her gate. So the door check is her own SAAHAA code: permanent,
   already on her screen, the same every job, and known to nobody who has not
   actually met her.

   Two things have to hold for that to be safe, and they pull in opposite
   directions. It must be FORGIVING to type — a pro is thumbing it in on a
   doorstep, and case, spaces and hyphens are noise, not a wrong answer. And it
   must be STRICT about what it accepts — a code that is one character short, or
   a different person's code, or nothing at all, has to fail. Everything below
   is one of those two. */

import { describe, it, expect } from './selftest.js';
import { sameCode } from '../domain/flow.js';
import * as ID from '../domain/identity.js';
import { canTransition } from '../domain/orders.js';
import '../domain/state.js';

describe('door code · forgiving about how a thumb types it', () => {
  const real = 'C20262001';

  it('ignores case', () => {
    expect(sameCode('c20262001', real)).toBeTrue();
    expect(sameCode('C20262001', real)).toBeTrue();
  });
  it('ignores the spaces and hyphens people put in long codes', () => {
    expect(sameCode('C 2026 2001', real)).toBeTrue();
    expect(sameCode('C-2026-2001', real)).toBeTrue();
    expect(sameCode('  c-2026 2001  ', real)).toBeTrue();
  });
  it('works in both directions — neither side is the trusted one', () => {
    expect(sameCode(real, 'c 2026 2001')).toBeTrue();
  });
});

describe('door code · strict about what counts as right', () => {
  const real = 'C20262001';

  it('a different person is not a match', () => {
    expect(sameCode('C20262002', real)).toBeFalse();
    expect(sameCode('P20262001', real)).toBeFalse();   // same number, wrong role
  });
  it('a truncated or padded code is not a match', () => {
    expect(sameCode('C2026200', real)).toBeFalse();
    expect(sameCode('C202620012', real)).toBeFalse();
  });
  it('nothing typed is never a match — an empty field must not open a job', () => {
    for (const empty of ['', '   ', '--', null, undefined]) {
      expect(sameCode(empty, real)).toBeFalse();
    }
  });
  /* If both sides were empty the comparison would be true, and a job with no
     code on it would start on an empty field. Orders always carry one, but the
     check should not depend on that being true forever. */
  it('two empties are not a match either', () => {
    expect(sameCode('', '')).toBeFalse();
    expect(sameCode(null, undefined)).toBeFalse();
  });
});

describe('door code · it really is the code people already have', () => {
  it('a customer code is what a customer would read out', () => {
    const users = [{ role: 'customer', code: 'C20262001', createdAt: Date.UTC(2026, 0, 1) }];
    const next = ID.nextCode('customer', users, Date.UTC(2026, 0, 2));
    expect(next).toSatisfy(c => ID.CODE_RE.test(c), 'a real account code: ' + next);
    /* the shape the door step tells the pro to expect */
    expect(next).toHaveLength(9);
    expect(next[0]).toBe('C');
  });
  it('the code a person is issued matches itself through the door check', () => {
    const code = ID.nextCode('customer', [], Date.UTC(2026, 5, 5));
    expect(sameCode(code, code)).toBeTrue();
    expect(sameCode(code.toLowerCase(), code)).toBeTrue();
  });
});

/* ── the two doors must behave the same ────────────────────────
   A job's door (`verifyOtp`) counted failures, stopped at three and raised a
   real dispute. The grocery door (`checkRetailCode`) said "wrong code" and let
   the rider try for ever — no count, no limit, no record — so the same nine
   characters were protected on one doorstep and not on the other, for no reason
   a customer could discover. They count the same now, and these pin the state
   machine that the retail limit needs: without a DISPUTED edge out of R_OUT the
   dispute opened and the order never moved, and without the way back the retry
   threw `illegal transition`. */
describe('door code · a failed grocery door goes somewhere, and can come back', () => {
  it('R_OUT can reach DISPUTED — three wrong codes must be able to freeze it', () => {
    expect(canTransition('R_OUT', 'DISPUTED')).toBe(true);
  });
  it('DISPUTED can return to R_OUT — the owner can hand the rider another try', () => {
    expect(canTransition('DISPUTED', 'R_OUT')).toBe(true);
  });
  it('and the service door still has its own way back', () => {
    expect(canTransition('ARRIVED', 'DISPUTED')).toBe(true);
    expect(canTransition('DISPUTED', 'ARRIVED')).toBe(true);
  });
  it('a retry never lands a grocery order on a service stage', () => {
    /* the bug this replaced: retryDoorCode advanced everything to ARRIVED */
    expect(canTransition('DISPUTED', 'ARRIVED') && canTransition('DISPUTED', 'R_OUT')).toBe(true);
    expect(canTransition('R_OUT', 'ARRIVED')).toBe(false);
  });
});
