/* SAAHAA · net/rail.js — the one door to the Worker that owns identity.

   WHAT THIS FIXES. Until now an account was a row in one browser's
   localStorage and nothing else. Two consequences, both of which the owner met
   in the same minute: the console showed no customers while people were
   signing up, because it was reading the accounts on the OWNER'S device; and
   domain/identity.js numbered each account from the list it could see, so
   every phone independently minted C20262001. The second is the worse one — a
   name that is supposed to identify one person was being handed out repeatedly.

   Neither can be fixed on a device, because both are questions about everybody.
   So they are asked of the Worker, which is the only thing holding the
   service-role key.

   WHAT IS **NOT** HERE, DELIBERATELY. Orders, the ledger, the catalogue and
   every screen still work exactly as they did: on the device, offline, with no
   network on the path of anything a plumber does standing in a kitchen. This
   file is identity, and identity only.

   THE PASSWORD IS SENT, NOT THE HASH. Over TLS, to be compared and dropped.
   Sending the derived hash would make the hash the password — replayable by
   anyone who read it once — and would force the server to hand out each
   account's salt to whoever asked. */

import { emit } from '../core/bus.js';
import * as cfg from '../core/config.js';

export const isConfigured = () => cfg.hasRail();

/** Why a call failed, in the two shapes a caller actually branches on. */
export class RailError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = 'RailError';
    this.status = status;
    /* OFFLINE IS NOT AN ERROR THE WAY 401 IS. One means "we could not ask",
       the other means "we asked and the answer was no", and a caller that
       treats them alike either locks people out of a working device or lets
       them in on a password nobody checked. */
    this.offline = offline;
  }
}

async function post(path, body, { timeoutMs = 12000, token = null } = {}) {
  /* `base` is '' on the deployed site — /api/… on this origin, through the
     service binding. `null` is the only value that means there is no rail. */
  const base = cfg.railUrl();
  if (base === null) throw new RailError('The server is not configured', { offline: true });

  /* A PHONE ON A BAD SIGNAL DOES NOT FAIL — IT HANGS. Without this the signup
     button spins until the network gives up on its own, which on a 2G tail can
     be a minute, and the person presses it again. */
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: token
        ? { 'content-type': 'application/json', authorization: 'Bearer ' + token }
        : { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ac.signal,
    });
  } catch (e) {
    emit('rail:offline', { path });
    throw new RailError('Could not reach SAAHAA. Check your connection and try again.', { offline: true });
  } finally {
    clearTimeout(timer);
  }

  let out = null;
  try { out = await res.json(); } catch (e) { out = null; }
  if (!res.ok || !out || out.ok === false) {
    const reason = (out && out.reason) || 'Something went wrong. Please try again.';
    /* A 5xx is the server failing, not the person: it must not be reported as
       a refusal, or somebody retypes a correct password until they give up. */
    emit('rail:error', { path, status: res.status });
    throw new RailError(reason, { status: res.status, offline: res.status >= 500 });
  }
  emit('rail:ok', { path });
  return out;
}

/** Open an account. The SERVER names it — the device never guesses a code.
    Returns the account AND a session token: the password is not kept, and
    publishing a listing later cannot ask for it again. */
export async function signUp({ role, name, mobile, area, password }) {
  const out = await post('/api/accounts/signup', { role, name, mobile, area, password });
  return { account: out.account, token: out.token };
}

/** Prove a password from any device. Returns every account it opens. */
export async function signIn({ ident, password }) {
  const out = await post('/api/accounts/signin', { ident, password });
  return out.accounts || [];
}

/** Every account on the platform — the owner console's roster. */
export async function roster(password) {
  const out = await post('/api/accounts/roster', { password });
  return { accounts: out.accounts || [], counts: out.counts || {} };
}

/** Put this account's own listing in the directory every device reads. */
export async function publishListing({ token, kind, area, payload }) {
  await post('/api/listings/publish', { kind, area, payload }, { token });
  return true;
}

/** Every pro and shop a customer may see. Never throws — a directory that
    cannot be read is a quieter failure than a screen that will not paint. */
export async function listings() {
  const base = cfg.railUrl();
  if (base === null) return [];
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const r = await fetch(base + '/api/listings', { signal: ac.signal });
    clearTimeout(timer);
    const b = await r.json().catch(() => null);
    return (b && b.ok && Array.isArray(b.listings)) ? b.listings : [];
  } catch (e) {
    emit('rail:offline', { path: '/api/listings' });
    return [];
  }
}
