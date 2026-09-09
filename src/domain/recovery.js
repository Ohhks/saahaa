/* SAAHAA · domain/recovery.js — getting back in.

   A pro's account holds their storefront, their wallet, their rating and every
   job they have ever done. Until now, forgetting the password lost all of it,
   permanently: there was no reset anywhere in the product. For the person this
   was built for — one phone, one number, a livelihood — that is the worst
   failure the app could have.

   WHY IT WORKS THIS WAY. A "forgot password" link normally mails or texts a
   code. There is no mail and no SMS rail yet (docs/LAUNCH.md), and inventing
   one that silently does nothing would be worse than none. So the reset is
   what a neighbourhood business actually does: the person rings the owner, the
   owner checks they are who they say they are, and issues a one-time code the
   owner reads out. The code is short enough to say down a phone line.

   WHAT IS STORED. Never the code — only its SHA-256, the moment it expires and
   the fact it has not been used. The owner sees the code once, at the moment of
   issuing, and the app never shows it again. Issue and redeem are both audited;
   the code itself never reaches the log.

   The day the SMS rail is wired, `issue()` stays exactly as it is and the code
   is texted instead of read out. */

import { getState, dispatch } from '../core/ctx.js';
import { sha256 } from '../core/crypto.js';
import { hashPassword } from '../core/security.js';
import * as audit from '../core/audit.js';
import * as ID from './identity.js';

export const CODE_LEN = 6;
export const TTL_MS = 30 * 60 * 1000;          // half an hour: long enough for a phone call
/* No I, O, 0 or 1 — this gets read out loud and written on a scrap of paper. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  const a = new Uint8Array(CODE_LEN);
  (globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return Array.from(a, n => ALPHABET[n % ALPHABET.length]).join('');
}

export const normalise = v => String(v == null ? '' : v).replace(/[\s-]/g, '').toUpperCase();

/**
 * Issue a reset for one account. Returns the code ONCE — the caller shows it to
 * the owner and forgets it. Only the hash is kept.
 */
export async function issue(userKey, actor = 'admin', now = Date.now()) {
  const u = getState().users.find(x => x.key === userKey);
  if (!u) return { ok: false, reason: 'No such account' };
  const code = makeCode();
  dispatch({ type: 'user/patch', payload: { key: userKey, patch: {
    reset: { hash: await sha256(code), expiresAt: now + TTL_MS, issuedAt: now, by: actor },
  } } });
  audit.record('account.resetIssued', { code: u.code || null, role: u.role, expiresInMin: TTL_MS / 60000 }, actor);
  return { ok: true, code, expiresAt: now + TTL_MS, account: { name: u.name, code: u.code || null } };
}

/** Is there a live reset waiting on this account? */
export function pending(u, now = Date.now()) {
  const r = u && u.reset;
  return !!(r && r.hash && r.expiresAt > now);
}

/**
 * Redeem a code and set a new password. `who` may be a mobile number or an
 * account code — the same thing the sign-in field takes.
 *
 * Deliberately vague on failure: "that code is wrong or has expired" tells an
 * attacker nothing about which accounts exist or have a reset waiting.
 */
export async function redeem(who, code, newPassword, now = Date.now()) {
  const bad = { ok: false, reason: 'That code is wrong, used, or has expired' };
  const r = ID.resolve(who, getState().users);
  if (r.matches.length !== 1) {
    return r.matches.length > 1
      ? { ok: false, reason: 'That number has more than one account — use the ID of the one you are resetting', ambiguous: r.matches }
      : bad;
  }
  const u = r.matches[0];
  if (!pending(u, now)) return bad;
  if (await sha256(normalise(code)) !== u.reset.hash) {
    audit.record('account.resetFailed', { code: u.code || null }, 'self');
    return bad;
  }
  dispatch({ type: 'user/patch', payload: { key: u.key, patch: {
    ...(await hashPassword(newPassword)), reset: null,   // salted, like every other credential

  } } });
  audit.record('account.resetUsed', { code: u.code || null, role: u.role }, 'self');
  return { ok: true, account: { key: u.key, name: u.name, code: u.code || null, role: u.role } };
}
