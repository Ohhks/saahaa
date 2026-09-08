/* SAAHAA · domain/identity.js — who an account is, in a form a person can say
   out loud.

   Until now the mobile number WAS the identity, and that made one thing
   impossible: a plumber who also wants to buy groceries had to choose. One
   number, one account, one role, forever.

   Every account now carries a code:

       C 2026 2001        C20262001   a customer account
       P 2026 2001        P20262001   a pro's account
       S 2026 2001        S20262001   a shop owner's account
       │  │    │
       │  │    └── a 4-digit sequence, per role, per year, starting at 2001
       │  └─────── the year the account was opened
       └────────── what the account is for

   So one person, one number, two accounts — C20262001 to book a plumber and
   P20262001 to be one — each with its own password, its own wallet and its
   own history. They never mix, because they were never the same account.

   THE CODE IS NOT A SECRET and must never be treated as one: it is a name, of
   the same kind as an account number printed on a passbook. It identifies; the
   password authenticates.

   The internal `key` an order, a partner row or a ledger leg points at is NOT
   this code for accounts that already existed — rewriting those would rewrite
   history. Accounts opened from here on use their code as the key, which is
   how two accounts on one number stop colliding (the old key was name+mobile,
   identical for both). Both kinds live together; `code` is the thing to show,
   `key` the thing to join on.

   DOM-free and store-free: every function takes the rows it needs. */

export const PREFIX = { customer: 'C', partner: 'P', shop: 'S' };
export const ROLE_OF = { C: 'customer', P: 'partner', S: 'shop' };
export const ROLE_LABEL = { customer: 'Customer', partner: 'Pro', shop: 'Shop' };
const SEQ_START = 2001;

export const CODE_RE = /^([CPS])(\d{4})(\d{4})$/;

/** Tidy what a person typed: spaces out, letters up. Never throws. */
export const normaliseCode = v => String(v == null ? '' : v).replace(/[\s-]/g, '').toUpperCase();

/** Is this a SAAHAA account code? */
export const isCode = v => CODE_RE.test(normaliseCode(v));

/** What kind of account a code names, or null. */
export function roleOfCode(v) {
  const m = CODE_RE.exec(normaliseCode(v));
  return m ? ROLE_OF[m[1]] : null;
}

/** Split a code into its parts, or null. */
export function parseCode(v) {
  const m = CODE_RE.exec(normaliseCode(v));
  return m ? { prefix: m[1], role: ROLE_OF[m[1]], year: +m[2], seq: +m[3], code: normaliseCode(v) } : null;
}

/* A state carried over from an old build can hold createdAt: 0, or nothing at
   all. Left alone that mints C19702001, which reads as a mistake and sorts
   wrongly forever. Anything before SAAHAA existed is treated as "today". */
const FIRST_YEAR = 2020;
const yearOf = (ts, fallback) => {
  const y = new Date(ts || 0).getFullYear();
  return Number.isFinite(y) && y >= FIRST_YEAR ? y : new Date(fallback).getFullYear();
};

/**
 * The next free code for a role in a year: one above the highest that role
 * holds this year.
 *
 * The guarantee is uniqueness ACROSS THE ACCOUNTS THAT EXIST, which is the
 * guarantee the product needs — nothing in it removes an account, and the one
 * thing that clears them all (Admin -> Fresh start) clears the orders, ledger
 * and audit entries that referenced the codes in the same breath.
 */
export function nextCode(role, users = [], now = Date.now()) {
  const prefix = PREFIX[role] || PREFIX.customer;
  const year = new Date(now).getFullYear();
  let top = SEQ_START - 1;
  for (const u of users) {
    const p = parseCode(u && u.code);
    if (p && p.prefix === prefix && p.year === year && p.seq > top) top = p.seq;
  }
  const seq = Math.max(SEQ_START, top + 1);
  return `${prefix}${year}${String(seq).padStart(4, '0')}`;
}

/** The accounts held on one mobile number, in a stable order. */
export function accountsOn(mobile, users = []) {
  const m = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (m.length !== 10) return [];
  const order = { customer: 0, partner: 1, shop: 2 };
  return users
    .filter(u => String(u.mobile || '').replace(/\D/g, '').slice(-10) === m)
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** The one account a code names, or null. */
export const byCode = (code, users = []) => {
  const c = normaliseCode(code);
  return users.find(u => normaliseCode(u.code) === c) || null;
};

/**
 * What a person typed at the sign-in field, resolved.
 * Returns { kind: 'code'|'mobile'|'unknown', matches: [] } — the caller decides
 * what to do with none, one, or several.
 */
export function resolve(input, users = []) {
  const raw = String(input == null ? '' : input).trim();
  if (isCode(raw)) {
    const u = byCode(raw, users);
    return { kind: 'code', code: normaliseCode(raw), matches: u ? [u] : [] };
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return { kind: 'mobile', mobile: digits, matches: accountsOn(digits, users) };
  return { kind: 'unknown', matches: [] };
}

/** "Pro · P20262001" — what a chooser or a profile shows. */
export const labelOf = u =>
  !u ? '' : `${ROLE_LABEL[u.role] || 'Account'}${u.code ? ' · ' + u.code : ''}`;

/**
 * Assign codes to accounts that predate them, oldest first so the sequence
 * follows the order people actually joined. Pure: returns a new array.
 */
export function backfillCodes(users = [], now = Date.now()) {
  const withCode = users.filter(u => u && isCode(u.code));
  const out = users.slice();
  const missing = out
    .map((u, i) => ({ u, i }))
    .filter(x => x.u && !isCode(x.u.code))
    .sort((a, b) => (a.u.createdAt || 0) - (b.u.createdAt || 0) || String(a.u.key).localeCompare(String(b.u.key)));
  const pool = withCode.slice();
  for (const { u, i } of missing) {
    const year = yearOf(u.createdAt, now);
    const at = new Date(now); at.setFullYear(year);
    const code = nextCode(u.role || 'customer', pool, at.getTime());
    out[i] = { ...u, code };
    pool.push(out[i]);
  }
  return out;
}
