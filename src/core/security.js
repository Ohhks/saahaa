/* SAAHAA · core/security.js — the input-hardening and session-policy layer.

   HONEST SCOPE — read docs/SECURITY.md before real money changes hands.
   Everything in this file runs in the user's own browser. A determined user
   can open DevTools and call any of it with any argument, or skip it entirely.
   So NOTHING here is a security boundary against its own operator. What it IS:

     · a correctness boundary — junk, control characters and hostile URLs never
       reach the store, so a later server-side import cannot be poisoned by
       data this client wrote;
     · a cost boundary — the login gate makes credential stuffing against a
       shared device slow and noisy rather than instant;
     · a hygiene boundary — weak passwords are refused at the point of choice,
       which is the only place refusing them helps at all.

   The real boundary is Supabase: Row Level Security + SECURITY DEFINER RPCs.
   Every rule here must ALSO exist there before the app touches real money.

   DOM-free and network-free on purpose: it must be unit-testable under plain
   Node — see core/selftests.security.js. */

import * as persist from './persist.js';
import { sha256 } from './crypto.js';

/* ── session policy ────────────────────────────────────────────
   A customer session survives a refresh and a PWA relaunch, but not forever:
   an abandoned phone should not stay signed in for the rest of its life.
   30 days is the "remember me" people expect from a marketplace app, and is
   short enough that a stale session cannot outlive a role change by much. */
export const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

/* ── login gate ────────────────────────────────────────────────
   Per mobile number, persisted, so a reload does not reset the counter.
   5 free attempts (typos are normal), then 30s doubling to a 15-minute
   ceiling. The ceiling matters: an unbounded lockout is a denial of service
   an attacker can aim at a victim's own account. */
export const LOGIN_FREE_FAILS = 5;
export const LOGIN_BASE_MS    = 30 * 1000;
export const LOGIN_MAX_MS     = 15 * 60 * 1000;
const GATE_KEY = 'SAAHAA_LOGIN_GATE';
const GATE_TTL_MS = 24 * 60 * 60 * 1000;   // forget an old, cold entry

function gates() {
  const g = persist.read(GATE_KEY, {});
  return (g && typeof g === 'object' && !Array.isArray(g)) ? g : {};
}
function saveGates(g) {
  // never let this map grow without bound — it is keyed by user input
  const now = Date.now();
  const live = {};
  for (const [k, v] of Object.entries(g)) {
    if (v && typeof v === 'object' && now - (v.at || 0) < GATE_TTL_MS) live[k] = v;
  }
  persist.write(GATE_KEY, live);
  return live;
}

/** Wait after `fails` failures: 0 while under the free limit, then doubling. */
export function backoffMs(fails) {
  const over = (fails | 0) - LOGIN_FREE_FAILS;
  if (over < 0) return 0;
  return Math.min(LOGIN_MAX_MS, LOGIN_BASE_MS * Math.pow(2, over));
}

/** May this mobile attempt a sign-in right now? */
export function loginGate(mobile) {
  const id = normaliseMobile(mobile);
  if (!id) return { blocked: false, waitMs: 0, fails: 0 };
  const e = gates()[id];
  if (!e) return { blocked: false, waitMs: 0, fails: 0 };
  const waitMs = Math.max(0, (e.until || 0) - Date.now());
  return { blocked: waitMs > 0, waitMs, fails: e.fails || 0 };
}

export function noteLoginFail(mobile) {
  const id = normaliseMobile(mobile);
  if (!id) return { blocked: false, waitMs: 0, fails: 0 };
  const g = gates();
  const fails = ((g[id] && g[id].fails) || 0) + 1;
  const wait = backoffMs(fails);
  g[id] = { fails, until: Date.now() + wait, at: Date.now() };
  saveGates(g);
  return { blocked: wait > 0, waitMs: wait, fails };
}

export function noteLoginOk(mobile) {
  const id = normaliseMobile(mobile);
  if (!id) return;
  const g = gates();
  if (g[id]) { delete g[id]; saveGates(g); }
}

/** Test/support hook — wipes every recorded failure. */
export function clearLoginGates() { persist.remove(GATE_KEY); }

/* ── mobile ────────────────────────────────────────────────────
   People type +91 98765 43210, 098765-43210 and 9876543210 for the same
   number. Storing three spellings of one identity is how a duplicate account
   — and a lost order history — happens. One spelling wins. */
export function normaliseMobile(s) {
  let d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.length === 14 && d.startsWith('0091')) d = d.slice(4);        // 0091 98765 43210
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : '';
}

/* ── passwords ─────────────────────────────────────────────────
   A short list beats a long one: the 50 below cover the overwhelming majority
   of what a real credential-stuffing run tries first against an Indian
   consumer app, and the list ships in every browser, so it must stay small.
   Everything else is caught by the shape rules. */
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', '123456', '111111', '000000', '1234567', '12345', 'qwerty',
  'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'a1b2c3d4', 'iloveyou',
  'admin', 'admin123', 'administrator', 'welcome', 'welcome1', 'welcome123',
  'letmein', 'monkey', 'dragon', 'football', 'baseball', 'sunshine',
  'princess', 'superman', 'trustno1', 'master', 'shadow', 'michael',
  'jordan23', 'starwars', 'whatever', 'computer', 'internet', 'samsung',
  'saahaa', 'saahaa123', 'india123', 'bharat123', 'krishna123', 'ganesh123',
  'mypassword', 'changeme',
]);
/** Exposed so the self-tests can assert the list is actually a list of 50. */
export const commonPasswordCount = () => COMMON.size;

/**
 * Why this password may not be used — one sentence a human can act on, or null.
 * @param {string} pw
 * @param {string} [mobile] the number being registered, when known
 * @returns {string|null}
 */
/* ── HOW A PERSON'S PASSWORD IS STORED ─────────────────────────
   It was `sha256(password)`: unsalted, one round. Two people who both chose
   "123" had the same stored string, every stored hash was a rainbow-table
   lookup away from the password, and the whole state blob is exportable from
   the admin console. Meanwhile the OWNER's credential in this same codebase
   has always used PBKDF2-SHA256 with a random salt at 250,000 rounds — the
   right pattern was already written, and it had simply never been applied to
   the people whose livelihoods are in the app.

   Old accounts keep working: a stored hash with no salt is verified the old
   way and quietly upgraded the next time that person signs in, so nobody is
   locked out by this change. */
const ITERATIONS = 250000;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function randomSaltHex() {
  const a = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return hex(a.buffer);
}

async function pbkdf2(password, saltHex, iterations = ITERATIONS) {
  const subtle = (globalThis.crypto || {}).subtle;
  if (!subtle) return null;                       // no WebCrypto: caller falls back
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

/** Make a stored credential for a NEW password. */
export async function hashPassword(password) {
  const salt = randomSaltHex();
  const h = await pbkdf2(password, salt);
  if (!h) return { pass: await sha256(password), passSalt: '', passIter: 0 };   // ancient browser
  return { pass: h, passSalt: salt, passIter: ITERATIONS };
}

/**
 * Does this password open this account? Understands both shapes, so an account
 * created before 8.8.0 still signs in.
 * Returns { ok, upgrade } — `upgrade` is a fresh credential to store when an
 * old unsalted hash was accepted.
 */
export async function checkPassword(password, user) {
  if (!user) return { ok: false, upgrade: null };
  if (user.passSalt) {
    const h = await pbkdf2(password, user.passSalt, user.passIter || ITERATIONS);
    return { ok: !!h && h === user.pass, upgrade: null };
  }
  const legacy = await sha256(password);
  if (legacy !== user.pass) return { ok: false, upgrade: null };
  return { ok: true, upgrade: await hashPassword(password) };
}

export function passwordProblem(pw, mobile) {
  const s = String(pw == null ? '' : pw);
  if (!s) return 'Please choose a password.';
  if (s.length < 8) return 'Use at least 8 characters — a short password is guessed in seconds.';
  if (/^\d+$/.test(s)) return 'Add letters, not only digits.';
  if (COMMON.has(s.toLowerCase())) return 'That is one of the most-guessed passwords in the world. Please pick another.';
  if (/^(.)\1+$/.test(s)) return 'One repeated character is not a password.';
  const m = normaliseMobile(mobile);
  if (m && s.replace(/\D/g, '').includes(m)) return 'Your password cannot contain your mobile number.';
  return null;
}

/* ── free text ─────────────────────────────────────────────────
   Names, notes, addresses, chat, review text. esc() in ui/dom.js stops this
   becoming markup at RENDER time; safeText stops it becoming junk at STORAGE
   time. Both, always — neither is a substitute for the other. */
const CONTROL   = /[\u0000-\u001F\u007F-\u009F]/g;
/* zero-width and bidi-override characters: invisible in every UI, and the
   classic way to make a name render as a name that it is not */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function safeText(s, max = 200) {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : 200;
  return String(s == null ? '' : s)
    .replace(/[\t\r\n]+/g, ' ')      // whitespace controls become a space, not nothing
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, cap);
}

/* ── URLs ──────────────────────────────────────────────────────
   Anything a user can type that later becomes an href or an img src. Only
   http and https survive; javascript:, data:, blob:, vbscript: and file: do
   not. Note the pre-strip: "java\tscript:alert(1)" is a real bypass against
   naive prefix checks, because the HTML parser removes the tab for you. */
export function isSafeUrl(u) {
  if (typeof u !== 'string') return false;
  const s = u.replace(CONTROL, '').replace(INVISIBLE, '').replace(/\s/g, '');
  if (!s) return false;
  let p;
  try { p = new URL(s); } catch (e) { return false; }
  return p.protocol === 'http:' || p.protocol === 'https:';
}
