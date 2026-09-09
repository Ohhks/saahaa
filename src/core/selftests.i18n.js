/* SAAHAA · core/selftests.i18n.js — the app in somebody else's language.

   A pro's public page defaults their languages to "Telugu, Hindi", and until
   8.7.0 every word of the app was English — including the five-question trade
   test that locks for twenty-four hours after three wrong answers. That is a
   reading test wearing a trade test's clothes.

   What these pin is not the prose, which a native speaker still has to read.
   It is the two things that make a translation safe to ship: a missing string
   must never reach a screen as a blank or a key name, and the keys that cost
   somebody money or a day's work must exist in every language offered. A
   half-translated door screen is worse than an English one. */

import { describe, it, expect } from './selftest.js';
import * as i18n from '../ui/i18n.js';

/* The strings a person meets at a moment where misunderstanding costs them:
   the code at the door, the stake that locks with it, the quiz that can take a
   day away, and the warning that the device has stopped saving. */
const CRITICAL = [
  'door.customer.title', 'door.customer.body',
  'door.pro.title', 'door.pro.shape', 'door.pro.field', 'door.pro.stake', 'door.pro.submit',
  'ob.quizWarn', 'ob.noCode', 'ob.yourCode', 'ob.yourCodeBody',
  'money.minWithdraw', 'money.stakeBack',
  'warn.deviceFull', 'job.cannotDo',
];

describe('i18n · every language offered is actually offered', () => {
  it('lists the languages this product is for', () => {
    const ids = i18n.LANGS.map(l => l.id);
    expect(ids).toSatisfy(x => x.includes('en'), 'English');
    expect(ids).toSatisfy(x => x.includes('hi'), 'Hindi — the pro page defaults to it');
    expect(ids).toSatisfy(x => x.includes('te'), 'Telugu — the pro page defaults to it');
  });
  it('names each one in its own script, not in English', () => {
    for (const l of i18n.LANGS) {
      expect(typeof l.native).toBe('string');
      expect(l.native.length).toSatisfy(n => n > 0, l.id + ' has a native name');
    }
    /* somebody who cannot read English has to find their own language in the list */
    expect(i18n.LANGS.find(l => l.id === 'hi').native).toSatisfy(v => /[ऀ-ॿ]/.test(v), 'Devanagari');
    expect(i18n.LANGS.find(l => l.id === 'te').native).toSatisfy(v => /[ఀ-౿]/.test(v), 'Telugu script');
  });
});

describe('i18n · nothing a person needs is left blank', () => {
  it('a missing key falls back to English, never to an empty string', () => {
    const restore = i18n.lang();
    i18n.setLang('te');
    const v = i18n.t('a.key.that.does.not.exist.anywhere');
    expect(typeof v).toBe('string');
    expect(v.length).toSatisfy(n => n > 0, 'never blank');
    i18n.setLang(restore);
  });

  it('the strings that cost money or a day are translated in EVERY language', () => {
    const restore = i18n.lang();
    /* Capture English FIRST. `t()` always reads the module's current language,
       so comparing inside the loop compared each string with itself. */
    i18n.setLang('en');
    const english = {};
    for (const key of CRITICAL) english[key] = i18n.t(key, { amount: '₹100' });

    for (const l of i18n.LANGS) {
      i18n.setLang(l.id);
      for (const key of CRITICAL) {
        const v = i18n.t(key, { amount: '₹100' });
        expect(v).toSatisfy(x => typeof x === 'string' && x.length > 0, `${l.id}: ${key} is empty`);
        expect(v).toSatisfy(x => x !== key, `${l.id}: ${key} fell through to the key name`);
        if (l.id !== 'en') {
          expect(v).toSatisfy(x => x !== english[key], `${l.id}: ${key} is still the English string`);
        }
      }
    }
    i18n.setLang(restore);
  });

  it('interpolation puts the rupees in, in every language', () => {
    const restore = i18n.lang();
    for (const l of i18n.LANGS) {
      i18n.setLang(l.id);
      const v = i18n.t('door.pro.stake', { amount: '₹250' });
      expect(v).toSatisfy(x => x.includes('₹250'), `${l.id} shows the amount`);
      expect(v).toSatisfy(x => !x.includes('{amount}'), `${l.id} left a placeholder on screen`);
    }
    i18n.setLang(restore);
  });
});

describe('i18n · the app is honest about what has not been checked', () => {
  it('says a non-English translation has had no native review', () => {
    const restore = i18n.lang();
    i18n.setLang('en');
    expect(i18n.unreviewed()).toBeFalse();
    i18n.setLang('hi');
    expect(i18n.unreviewed()).toBeTrue();
    expect(i18n.t('lang.unreviewed')).toSatisfy(v => v.length > 10, 'and says so in that language');
    i18n.setLang(restore);
  });
  it('reports which keys a language is still missing, so the gap is countable', () => {
    expect(i18n.missing('en')).toHaveLength(0);
    expect(Array.isArray(i18n.missing('te'))).toBeTrue();
  });
});
