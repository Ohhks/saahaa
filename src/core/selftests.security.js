/* SAAHAA · core/selftests.security.js — the suites for the security layer.

   These tests are cheap and they are the only thing standing between a
   refactor and a silently re-opened door. Every rule in core/security.js has a
   test here that FAILS if the rule is deleted.

   What these tests DO NOT prove: that the app is secure. They prove the
   client-side rules behave as written. The rules that actually protect money
   live in Supabase (RLS + SECURITY DEFINER RPCs) and are tested there.
   See docs/SECURITY.md. */

import { describe, it, expect } from './selftest.js';
import * as S from './security.js';
import { sha256 } from './crypto.js';
import * as adminauth from './adminauth.js';
import { stripCredential, CREDENTIAL_FIELDS } from './ctx.js';
import { ADMIN_BOOTSTRAP } from './config.js';
import * as persist from './persist.js';

/* ── passwords ─────────────────────────────────────────────── */
describe('security · a password that would be guessed is refused at the door', () => {
  it('a short password is refused, with a reason a human can act on', () => {
    const why = S.passwordProblem('abc123');
    expect(typeof why).toBe('string');
    expect(why).toContain('8 characters');
  });
  it('empty and null are refused, not crashed on', () => {
    expect(typeof S.passwordProblem('')).toBe('string');
    expect(typeof S.passwordProblem(null)).toBe('string');
    expect(typeof S.passwordProblem(undefined)).toBe('string');
  });
  it('a digits-only password is refused however long it is', () => {
    expect(S.passwordProblem('9876543210')).toContain('digits');
    expect(S.passwordProblem('112233445566778899')).toContain('digits');
  });
  it('the world’s most-guessed passwords are refused, in any case', () => {
    for (const pw of ['password', 'PASSWORD', 'Password123', 'letmein', 'qwerty123', 'saahaa123', 'welcome123', 'admin123']) {
      expect(S.passwordProblem(pw)).toSatisfy(v => typeof v === 'string', 'common password ' + pw + ' must be refused');
    }
  });
  it('the common-password list is a real list, not a token gesture', () => {
    expect(S.commonPasswordCount()).toSatisfy(n => n >= 45, 'at least 45 common passwords');
  });
  it('one repeated character is not a password', () => {
    expect(typeof S.passwordProblem('aaaaaaaaaa')).toBe('string');
  });
  it('a password containing the owner’s own mobile is refused', () => {
    expect(S.passwordProblem('ram9876543210', '9876543210')).toContain('mobile');
    expect(S.passwordProblem('ram9876543210', '+91 98765 43210')).toContain('mobile');
  });
  it('a decent password passes, and passing means exactly null', () => {
    expect(S.passwordProblem('kirana-street-42')).toBe(null);
    expect(S.passwordProblem('MadhapurRain88')).toBe(null);
    expect(S.passwordProblem('correct horse battery')).toBe(null);
  });
  it('a good password is not refused just because a mobile was supplied', () => {
    expect(S.passwordProblem('MadhapurRain88', '9876543210')).toBe(null);
  });
});

/* ── mobile ────────────────────────────────────────────────── */
describe('security · one number, one spelling, one account', () => {
  it('every way an Indian types their number collapses to the same ten digits', () => {
    for (const s of ['9876543210', '98765 43210', '98765-43210', '+91 9876543210',
                     '+919876543210', '919876543210', '09876543210', '0091 9876543210',
                     '(98765) 43210']) {
      expect(S.normaliseMobile(s)).toBe('9876543210');
    }
  });
  it('anything that is not ten digits comes back empty, never half-parsed', () => {
    for (const s of ['', '123', '12345678901234', 'ninesevensix', null, undefined, 'admin']) {
      expect(S.normaliseMobile(s)).toBe('');
    }
  });
  it('a nine-digit number is not silently padded into a valid one', () => {
    expect(S.normaliseMobile('987654321')).toBe('');
  });
});

/* ── login gate ────────────────────────────────────────────── */
describe('security · guessing a password gets slower, and stays bounded', () => {
  it('the first five failures cost nothing — typos are normal', () => {
    S.clearLoginGates();
    const m = '9000000001';
    for (let i = 1; i <= 4; i++) {
      const r = S.noteLoginFail(m);
      expect(r.blocked).toBeFalse();
      expect(r.fails).toBe(i);
    }
    expect(S.loginGate(m).blocked).toBeFalse();
  });
  it('the fifth failure starts a 30-second wait', () => {
    S.clearLoginGates();
    const m = '9000000002';
    let r;
    for (let i = 0; i < 5; i++) r = S.noteLoginFail(m);
    expect(r.fails).toBe(5);
    expect(r.blocked).toBeTrue();
    expect(r.waitMs).toBe(30000);
    expect(S.loginGate(m).blocked).toBeTrue();
  });
  it('the wait doubles: 30s, 60s, 120s, 240s…', () => {
    expect(S.backoffMs(4)).toBe(0);
    expect(S.backoffMs(5)).toBe(30000);
    expect(S.backoffMs(6)).toBe(60000);
    expect(S.backoffMs(7)).toBe(120000);
    expect(S.backoffMs(8)).toBe(240000);
  });
  it('the wait is CAPPED at 15 minutes — an unbounded lockout is a weapon', () => {
    expect(S.backoffMs(12)).toBe(S.LOGIN_MAX_MS);
    expect(S.backoffMs(200)).toBe(S.LOGIN_MAX_MS);
    expect(S.LOGIN_MAX_MS).toBe(15 * 60 * 1000);
  });
  it('the gate is PER NUMBER — one attacker cannot lock out the whole town', () => {
    S.clearLoginGates();
    for (let i = 0; i < 8; i++) S.noteLoginFail('9000000003');
    expect(S.loginGate('9000000003').blocked).toBeTrue();
    expect(S.loginGate('9000000004').blocked).toBeFalse();
  });
  it('a successful sign-in clears the record completely', () => {
    S.clearLoginGates();
    const m = '9000000005';
    for (let i = 0; i < 6; i++) S.noteLoginFail(m);
    expect(S.loginGate(m).blocked).toBeTrue();
    S.noteLoginOk(m);
    expect(S.loginGate(m)).toEqual({ blocked: false, waitMs: 0, fails: 0 });
  });
  it('an unparseable number never blocks and never writes a record', () => {
    S.clearLoginGates();
    expect(S.noteLoginFail('not-a-number').blocked).toBeFalse();
    expect(S.loginGate('not-a-number').blocked).toBeFalse();
  });
  it('the same number written three ways shares ONE counter', () => {
    S.clearLoginGates();
    S.noteLoginFail('9000000006');
    S.noteLoginFail('+91 90000 00006');
    S.noteLoginFail('09000000006');
    expect(S.loginGate('9000000006').fails).toBe(3);
  });
  it('the counter survives a reload — it lives in storage, not memory', () => {
    S.clearLoginGates();
    for (let i = 0; i < 5; i++) S.noteLoginFail('9000000007');
    const raw = persist.readRaw('SAAHAA_LOGIN_GATE');
    expect(typeof raw).toBe('string');
    expect(raw).toContain('9000000007');
  });
});

/* ── session policy ────────────────────────────────────────── */
describe('security · a session does not outlive the phone it was made on', () => {
  it('the customer session is thirty days, stated once and imported everywhere', () => {
    expect(S.USER_SESSION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

/* ── free text ─────────────────────────────────────────────── */
/* The characters under test are INVISIBLE by definition, so they are built by
   code point here rather than pasted — a test you cannot read is a test nobody
   maintains, and a stray paste is how one of them silently disappears. */
const CH = c => String.fromCharCode(c);
const NUL = CH(0), BEL = CH(7), ESCC = CH(0x1b), DEL = CH(0x7f), C1 = CH(0x9b);
const ZWSP = CH(0x200b), RLO = CH(0x202e), BOM = CH(0xfeff), SHY = CH(0xad);

describe('security · text stored is text, not machinery', () => {
  it('control characters are stripped', () => {
    expect(S.safeText('Ra' + NUL + 'm' + BEL + ' Kumar')).toBe('Ram Kumar');
    expect(S.safeText('a' + ESCC + 'b' + DEL + 'c' + C1)).toBe('abc');
  });
  it('newlines and tabs become a space, so words never fuse', () => {
    expect(S.safeText('Ram\nKumar')).toBe('Ram Kumar');
    expect(S.safeText('Ram\t\tKumar')).toBe('Ram Kumar');
  });
  it('zero-width and bidi-override characters are stripped — an invisible name is a lie', () => {
    expect(S.safeText('Ra' + ZWSP + 'm')).toBe('Ram');
    expect(S.safeText('shop' + RLO + 'gnihsiw')).toBe('shopgnihsiw');
    expect(S.safeText(BOM + 'Ram' + SHY)).toBe('Ram');
  });
  it('it trims, and collapses a run of spaces', () => {
    expect(S.safeText('   Ram    Kumar   ')).toBe('Ram Kumar');
  });
  it('it caps the length, so one field cannot eat the storage quota', () => {
    expect(S.safeText('x'.repeat(5000), 40)).toHaveLength(40);
    expect(S.safeText('x'.repeat(5000))).toHaveLength(200);
  });
  it('null, undefined and numbers come back as a string, never a crash', () => {
    expect(S.safeText(null)).toBe('');
    expect(S.safeText(undefined)).toBe('');
    expect(S.safeText(42)).toBe('42');
  });
  it('it does NOT escape markup — that is esc()’s job at render time', () => {
    // safeText is a STORAGE rule. Conflating the two is how one of them gets dropped.
    expect(S.safeText('<b>Ram</b>')).toBe('<b>Ram</b>');
  });
});

/* ── URLs ──────────────────────────────────────────────────── */
describe('security · only http and https ever become a link', () => {
  it('ordinary web addresses pass', () => {
    expect(S.isSafeUrl('https://saahaa.in/pro/123')).toBeTrue();
    expect(S.isSafeUrl('http://ohhks.github.io/saahaa/')).toBeTrue();
  });
  it('javascript: is refused, however it is spelled', () => {
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)',
                     'java' + CH(9) + 'script:alert(1)', 'java' + CH(10) + 'script:alert(1)',
                     'java' + CH(0) + 'script:alert(1)', 'jav ascript:alert(1)']) {
      expect(S.isSafeUrl(u)).toBeFalse();
    }
  });
  it('data:, blob:, vbscript: and file: are refused', () => {
    expect(S.isSafeUrl('data:text/html,<scr' + 'ipt>alert(1)</scr' + 'ipt>')).toBeFalse();   // never a literal close tag: the bundle is one inline script
    expect(S.isSafeUrl('blob:https://saahaa.in/abc')).toBeFalse();
    expect(S.isSafeUrl('vbscript:msgbox(1)')).toBeFalse();
    expect(S.isSafeUrl('file:///etc/passwd')).toBeFalse();
  });
  it('junk, relative paths and non-strings are refused rather than guessed at', () => {
    for (const u of ['', '   ', 'saahaa.in', '/pro/123', '//evil.example', null, undefined, 42, {}]) {
      expect(S.isSafeUrl(u)).toBeFalse();
    }
  });
});

/* ── the admin credential ──────────────────────────────────── */
describe('security · no password ships in this repo', () => {
  it('the bootstrap credential is a hash, and the demo password is NOT what it verifies', () => {
    const cred = adminauth.bootstrapCredential();
    expect(cred).toBeTruthy();
    expect(cred.isDemo).toBeFalse();
    expect(cred.setupDone).toBeTrue();
    // the retired demo password must not be the credential the app boots with
    expect(cred.hash).toSatisfy(h => h !== adminauth.DEMO_PASSWORD, 'hash is not the plaintext');
    expect(cred.salt).toSatisfy(s => s !== adminauth.DEMO_PASSWORD, 'salt is not the plaintext');
  });
  it('the bootstrap hash is a real 256-bit PBKDF2 output over a 128-bit salt', () => {
    expect(ADMIN_BOOTSTRAP.hash).toSatisfy(h => /^[0-9a-f]{64}$/.test(h), '64 hex characters');
    expect(ADMIN_BOOTSTRAP.salt).toSatisfy(s => /^[0-9a-f]{32}$/.test(s), '32 hex characters');
  });
  it('the iteration count is not quietly weakened', () => {
    expect(ADMIN_BOOTSTRAP.iterations).toSatisfy(n => n >= 250000, 'at least 250,000 rounds');
  });
  it('deriving the retired demo password does NOT reproduce the shipped hash', async () => {
    const { hash } = await adminauth.derive(adminauth.DEMO_PASSWORD, ADMIN_BOOTSTRAP.salt, ADMIN_BOOTSTRAP.iterations);
    expect(hash).toSatisfy(h => h !== ADMIN_BOOTSTRAP.hash, 'the shipped credential is not saahaa123');
  });
  it('the bootstrap block carries a hash and nothing that looks like a secret', () => {
    const keys = Object.keys(ADMIN_BOOTSTRAP);
    expect(keys).toSatisfy(k => !k.some(x => new RegExp('^(password|pass|pw|secret|token|service' + '_role)$', 'i').test(x)),
      'no plaintext-secret field in the bootstrap block');
    const blob = JSON.stringify(ADMIN_BOOTSTRAP);
    expect(blob).toSatisfy(b => !new RegExp('service' + '_role|eyJ[A-Za-z0-9_-]{20,}').test(b),
      'no service-role key and no JWT baked into the bootstrap block');
  });
});

/* ── what the screens promise is hidden, hidden ──────────────────
   The chat says contact details are masked. The rule used to be \b\d{10}\b,
   which is not how anyone writes a phone number: "98765 43210" went through
   in the clear, unflagged and unaudited, while the screen said otherwise. */
import { maskContact } from '../domain/flow.js';
describe('chat masking · a number written the way people write it is still a number', () => {
  it('masks every ordinary way of typing ten digits', () => {
    ['call 9876543210', 'call 98765 43210', 'ring 98765-43210',
     'my no is +91 98765 43210', 'whatsapp 91 98765 43210'].forEach(t =>
      expect(maskContact(t)).toSatisfy(s => !/\d{5}/.test(s), 'no run of digits survives: ' + t));
  });
  it('masks e-mail and UPI ids too', () => {
    expect(maskContact('mail ravi.k@gmail.com')).toContain('•••@•••');
    expect(maskContact('pay ravi@okaxis')).toContain('@•••');
  });
  it('leaves ordinary sentences with numbers alone — it is a mask, not a censor', () => {
    ['the price is 350 rupees', 'order 4471 at 9 am', '2 items, 40 left', 'flat 302, 3rd floor']
      .forEach(t => expect(maskContact(t)).toBe(t));
  });
});

/* PASSWORDS. Until 8.8.0 a person's password was stored as `sha256(password)`:
   unsalted, one round. Two people who both chose "123" had the same stored
   string, and the whole state blob is exportable from the admin console. The
   owner's own credential in this codebase has always used PBKDF2 at 250,000
   rounds with a random salt — the right pattern was written and never applied
   to the people whose livelihoods are in the app. */
describe('security · a password is salted and stretched, and old ones still work', () => {
  it('two people who pick the same password do not get the same stored hash', async () => {
    const a = await S.hashPassword('Str0ngPass!9');
    const b = await S.hashPassword('Str0ngPass!9');
    expect(a.pass).toSatisfy(v => v !== b.pass, 'salted, so identical passwords differ');
    expect(a.passSalt).toSatisfy(v => v !== b.passSalt, 'and the salts differ');
    expect(a.passIter).toSatisfy(n => n >= 100000, 'stretched, got ' + a.passIter);
  });

  it('the stored value is never the bare sha256 of the password', async () => {
    const cred = await S.hashPassword('123');
    const bare = await sha256('123');
    expect(cred.pass).toSatisfy(v => v !== bare, 'a rainbow table must not open it');
  });

  it('the right password opens it and the wrong one does not', async () => {
    const cred = await S.hashPassword('Str0ngPass!9');
    expect((await S.checkPassword('Str0ngPass!9', cred)).ok).toBeTrue();
    expect((await S.checkPassword('Str0ngPass!8', cred)).ok).toBeFalse();
  });

  it('an account stored the OLD way still signs in, and is upgraded on the way', async () => {
    /* nobody may be locked out by this change */
    const legacy = { pass: await sha256('123') };
    const r = await S.checkPassword('123', legacy);
    expect(r.ok).toBeTrue();
    expect(r.upgrade).toSatisfy(u => !!u && !!u.passSalt, 'a salted credential to store');
    expect((await S.checkPassword('nope', legacy)).ok).toBeFalse();
  });
});

/* ── the credential must not travel with the session ───────────
   The sign-IN path stripped `pass`/`passSalt`/`passIter` by hand; the sign-UP
   path, written later and forty lines away, passed the whole user record. So
   the same account's password hash and salt sat in localStorage if the person
   had just registered and did not if they had come back — which door they
   walked through decided whether their credential was on disk, and nothing
   anywhere said so. Two callers is two chances to forget, and one had. */
describe('session · never carries the password with it', () => {
  const user = { key: 'k|9000000001', name: 'A', role: 'customer', code: 'C20262001',
                 pass: 'pbkdf2$deadbeef', passSalt: 'abc123', passIter: 210000 };

  it('the strip removes every credential field and keeps everything else', () => {
    const s = stripCredential(user);
    for (const f of CREDENTIAL_FIELDS) expect(s[f] === undefined).toBe(true);
    expect(s.key).toBe(user.key);
    expect(s.code).toBe('C20262001');
    expect(s.role).toBe('customer');
  });

  it('the list is not empty — an empty list would pass every other test here', () => {
    expect(CREDENTIAL_FIELDS.length).toSatisfy(v => v >= 3, 'pass, passSalt, passIter at least');
    expect(CREDENTIAL_FIELDS.includes('pass')).toBe(true);
    expect(CREDENTIAL_FIELDS.includes('passSalt')).toBe(true);
    expect(CREDENTIAL_FIELDS.includes('passIter')).toBe(true);
  });

  it('nothing that looks like a hash survives, whatever the field is called', () => {
    const s = stripCredential(user);
    const blob = JSON.stringify(s);
    expect(blob.includes('deadbeef')).toBe(false);
    expect(blob.includes('abc123')).toBe(false);
    expect(blob.includes('210000')).toBe(false);
  });

  it('it is safe on the shapes a caller can actually pass', () => {
    expect(stripCredential(null)).toBe(null);
    expect(stripCredential(undefined)).toBe(undefined);
    expect(JSON.stringify(stripCredential({}))).toBe('{}');
  });

  it('and it does not mutate what it was handed', () => {
    const u = { ...user };
    stripCredential(u);
    expect(u.pass).toBe('pbkdf2$deadbeef');    // the store's own record is untouched
  });
});
