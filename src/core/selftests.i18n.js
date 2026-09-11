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
import * as Q from '../domain/quiz.js';
import * as V from '../domain/verification.js';
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

/* ── the rules, in the language he reads ───────────────────────
   The agreement a partner signs and the conduct quiz he is marked on were
   English-only, on an onboarding that tells him two screens earlier — in
   Telugu — that it knows he may not read English. Being marked on rules you
   cannot read is not being taught them; it is being filtered on English, and
   failing locks the trade for 24 hours.

   Translating a marked quiz is the dangerous kind of translation, so what
   these pin is not the wording but the SAFETY: the correct answer must land on
   the same index in every language, or a Telugu-speaking pro fails a question
   he answered correctly. `conductFor` maps options positionally and copies `a`
   from the English bank, which makes that impossible by construction — and
   this is the test that says so. */
describe('onboarding · the rules are translated, and translating cannot move the answer', () => {
  it('every language has one entry per conduct question, with the same options', () => {
    for (const l of ['en', 'hi', 'te']) {
      const bank = Q.conductFor(l);
      expect(bank.length).toBe(Q.CONDUCT.length);
      bank.forEach((item, i) => {
        expect(item.o.length).toBe(Q.CONDUCT[i].o.length);
        expect(item.a).toBe(Q.CONDUCT[i].a);        // the answer never moves
      });
    }
  });

  it('nothing is blank — a missing string falls back to English, never to nothing', () => {
    for (const l of ['en', 'hi', 'te']) {
      for (const item of Q.conductFor(l)) {
        expect(String(item.q || '').length).toSatisfy(v => v > 0, 'a question with no words');
        for (const o of item.o) expect(String(o || '').length).toSatisfy(v => v > 0, 'a choice with no words');
      }
    }
  });

  it('Hindi and Telugu are actually different words, not the English copied over', () => {
    /* the failure this catches is a stub map that passes every test above */
    for (const l of ['hi', 'te']) {
      const bank = Q.conductFor(l);
      const same = bank.filter((item, i) => item.q === Q.CONDUCT[i].q).length;
      expect(same).toBe(0, `${l}: ${same} question(s) still in English`);
    }
  });

  it('an unknown language is the English bank, not a crash and not a blank', () => {
    expect(Q.conductFor('fr').length).toBe(Q.CONDUCT.length);
    expect(Q.conductFor(undefined)[0].q).toBe(Q.CONDUCT[0].q);
  });

  it('all five terms of the agreement exist in all three languages', () => {
    for (const l of ['en', 'hi', 'te']) {
      const terms = V.termsFor(l);
      expect(terms.length).toBe(V.TERMS.length);
      for (const line of terms) expect(String(line || '').length).toSatisfy(v => v > 0, 'a blank promise');
    }
    for (const l of ['hi', 'te']) {
      const same = V.termsFor(l).filter((line, i) => line === V.TERMS[i]).length;
      expect(same).toBe(0, `${l}: ${same} term(s) still in English`);
    }
  });
});
