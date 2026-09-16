/* SAAHAA · core/adminauth.js — admin login, INSIDE the site.

   HONEST SCOPE (read docs/SECURITY.md before real money changes hands):
   client-side auth is UI hiding, not authorization. Anyone with DevTools can
   set a variable. What this module does is raise the bar against casual
   snooping and make every admin action reconstructible:

     · PBKDF2-SHA256, 250k iterations, 16-byte random salt — never plaintext,
       never a bare SHA-256, never `if (pw === '...')`
     · exponential backoff after 3 attempts, hard lockout after 5
     · session token in sessionStorage (dies with the tab), 15-min idle,
       8-hour absolute cap
     · step-up re-auth for money movements above ₹5,000
     · every attempt, success and failure written to the audit log

   The owner's credential is a PBKDF2 hash shipped in core/config.js
   (ADMIN_BOOTSTRAP) — never a password. Any state still carrying the retired
   demo credential is replaced by it at boot (migration v8). */

import * as persist from './persist.js';
import { ADMIN_BOOTSTRAP } from './config.js';
import * as audit from './audit.js';
import { sha256 } from './crypto.js';

const SESS_KEY = 'SAAHAA_ADMIN_SESS';
const GATE_KEY = 'SAAHAA_ADMIN_GATE';
const IDLE_MS  = 15 * 60 * 1000;
const ABS_MS   = 8 * 60 * 60 * 1000;
export const STEPUP_THRESHOLD = 500000;   // ₹5,000 in paise
export const DEMO_PASSWORD = 'saahaa123'; // retired: any state still carrying it is replaced at boot
export const ADMIN_USERNAME = (ADMIN_BOOTSTRAP && ADMIN_BOOTSTRAP.username) || 'admin';
/** The credential a fresh device starts with — a hash, never a password. */
export const bootstrapCredential = () => ADMIN_BOOTSTRAP && ADMIN_BOOTSTRAP.hash
  ? { salt: ADMIN_BOOTSTRAP.salt, hash: ADMIN_BOOTSTRAP.hash, iterations: ADMIN_BOOTSTRAP.iterations, weak: false,
      changedAt: 0, setupDone: true, isDemo: false, bootstrapVersion: ADMIN_BOOTSTRAP.version || 1 }
  : null;

const ITER = 250000;

/* ── PBKDF2 ────────────────────────────────────────────────── */
function randSalt() {
  const b = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues
    ? crypto.getRandomValues(b)
    : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function derive(password, saltHex, iterations = ITER) {
  const subtle = (globalThis.crypto || {}).subtle;
  if (!subtle || !subtle.importKey) {
    // http:// without secure context — degrade loudly, not silently
    let h = password + '|' + saltHex;
    for (let i = 0; i < 2000; i++) h = await sha256(h);
    return { hash: h, iterations: 2000, weak: true };
  }
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return { hash: [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join(''), iterations, weak: false };
}

export async function makeCredential(password) {
  const salt = randSalt();
  const { hash, iterations, weak } = await derive(password, salt);
  return { salt, hash, iterations, weak, changedAt: Date.now(), setupDone: true, isDemo: password === DEMO_PASSWORD };
}

/* ── rate limit / lockout ──────────────────────────────────── */
function gate() { return persist.read(GATE_KEY, { fails: 0, nextAt: 0, lockUntil: 0 }); }
function setGate(g) { persist.write(GATE_KEY, g); }

/**
 * A shipped credential that is NEWER than the one this device holds.
 *
 * WHY THIS HAD TO BE WRITTEN. `bootstrapVersion` was recorded on every
 * credential and then read by nothing at all, so rotating ADMIN_BOOTSTRAP
 * changed the password on a FRESH device and on no other — migration v7->v8
 * only fills a credential in when there is none, deliberately, so it will not
 * overwrite one. The result was a rotation that looked done, passed every
 * gate, and left every existing console on the old password. A field that is
 * written and never read is a promise the code does not keep.
 *
 * Bumping the version in src/core/config.js is an explicit act by whoever
 * deploys, and it wins — including over a password set from Admin -> System on
 * this device, which is the only way it can mean "the password is now this".
 * The replacement is audited, so it is never silent.
 */
export function bootstrapSupersedes(stored) {
  const boot = bootstrapCredential();
  if (!boot) return null;
  const have = (stored && stored.bootstrapVersion) || 0;
  return boot.bootstrapVersion > have ? boot : null;
}

export function gateStatus() {
  const g = gate(), now = Date.now();
  if (g.lockUntil > now) return { blocked: true, reason: 'locked', waitMs: g.lockUntil - now, fails: g.fails };
  if (g.nextAt > now)    return { blocked: true, reason: 'backoff', waitMs: g.nextAt - now, fails: g.fails };
  return { blocked: false, fails: g.fails, waitMs: 0 };
}
function onFail() {
  const g = gate();
  g.fails = (g.fails || 0) + 1;
  if (g.fails >= 5) { g.lockUntil = Date.now() + 30 * 60 * 1000; g.fails = 0; }
  else if (g.fails > 3) g.nextAt = Date.now() + Math.min(60, 2 ** (g.fails - 3)) * 1000;
  setGate(g);
  return g;
}
function onSuccess() { setGate({ fails: 0, nextAt: 0, lockUntil: 0 }); }

/* ── login ─────────────────────────────────────────────────── */
/* THE OWNER'S PASSWORD, FOR AS LONG AS THE CONSOLE IS OPEN AND NOT A MOMENT
   LONGER. The Worker will not hand over the platform roster to a browser that
   cannot prove who it is, and the only proof this console has is the password
   that was just typed. Keeping it in a module variable means it dies with the
   tab: it is never written to sessionStorage, never to localStorage, never to
   the audit log. A refresh loses it, and the roster then asks again — which is
   the correct trade, because the alternative is storing a password somewhere
   it can be read. */
let liveSecret = null;
export const ownerSecret = () => liveSecret;

export async function login(username, password, cred) {
  const g = gateStatus();
  if (g.blocked) {
    audit.record(audit.ACTIONS.ADMIN_LOGIN_FAIL, { reason: g.reason, waitMs: g.waitMs }, username);
    return { ok: false, reason: g.reason, waitMs: g.waitMs };
  }
  if (String(username).trim().toLowerCase() !== ADMIN_USERNAME.toLowerCase()) {
    onFail();
    audit.record(audit.ACTIONS.ADMIN_LOGIN_FAIL, { reason: 'user' }, username);
    return { ok: false, reason: 'bad' };
  }
  if (!cred || !cred.setupDone) return { ok: false, reason: 'nosetup' };

  const { hash } = await derive(password, cred.salt, cred.iterations);
  if (hash !== cred.hash) {
    const after = onFail();
    audit.record(audit.ACTIONS.ADMIN_LOGIN_FAIL, { reason: 'pass', fails: after.fails }, 'admin');
    return { ok: false, reason: 'bad', fails: after.fails };
  }
  onSuccess();
  liveSecret = password;          // memory only — see ownerSecret() above
  const sess = { t: randSalt(), start: Date.now(), touched: Date.now() };
  try { sessionStorage.setItem(SESS_KEY, JSON.stringify(sess)); } catch (e) {}
  audit.record(audit.ACTIONS.ADMIN_LOGIN, { via: 'in-site' }, 'admin');
  return { ok: true, session: sess, isDemo: !!cred.isDemo };
}

export function session() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null'); } catch (e) {}
  if (!s) return null;
  const now = Date.now();
  if (now - s.touched > IDLE_MS) { logout('idle'); return null; }
  if (now - s.start > ABS_MS)    { logout('expired'); return null; }
  return s;
}
export const isLoggedIn = () => !!session();
export function touch() {
  const s = session();
  if (s) { s.touched = Date.now(); try { sessionStorage.setItem(SESS_KEY, JSON.stringify(s)); } catch (e) {} }
}
export function logout(reason = 'manual') {
  liveSecret = null;
  try { sessionStorage.removeItem(SESS_KEY); } catch (e) {}
  audit.record(audit.ACTIONS.ADMIN_LOGOUT, { reason }, 'admin');
}

/** Step-up: re-type the password before moving real money. */
export async function stepUp(password, cred) {
  if (!isLoggedIn()) return false;
  const { hash } = await derive(password, cred.salt, cred.iterations);
  const ok = hash === cred.hash;
  audit.record(ok ? 'admin.stepup' : audit.ACTIONS.ADMIN_LOGIN_FAIL, { stepUp: true }, 'admin');
  return ok;
}

const WEAK = ['password', '12345678', 'admin123', 'saahaa', 'qwerty123', '11111111'];
export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return 'Use at least 8 characters.';
  if (WEAK.includes(pw.toLowerCase())) return 'That password is too common.';
  if (/^\d+$/.test(pw)) return 'Add letters, not only digits.';
  return null;
}
