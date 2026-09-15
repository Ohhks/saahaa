/* SAAHAA · core/config.js — public runtime configuration.

   WHAT IS SAFE TO COMMIT HERE:
     · the Supabase project URL
     · the ANON key — it is public by design, ships in every browser, and
       authorises nothing on its own; Row Level Security decides access.

   WHAT MUST NEVER APPEAR HERE, OR ANYWHERE IN THIS REPO:
     · the service-role key  (bypasses ALL RLS — it is a master key)
     · the database password
     · any personal access token
   Those live only in GitHub Actions secrets and in your Supabase dashboard.
   If one ever lands in a commit, rotate it immediately — git history is public.

   Override at runtime without editing this file:
     ?sb=https://xxxx.supabase.co&key=eyJ...      (once, stored locally)
     or set localStorage SAAHAA_SB_URL / SAAHAA_SB_KEY */

import * as persist from './persist.js';

const BAKED = {
  // Written by `python tools/setup-supabase.py`. Both values are public:
  // the anon key authorises nothing on its own — RLS decides access.
  url: 'https://pokoynttebwwswazrunw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBva295bnR0ZWJ3d3N3YXpydW53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNjU0NDksImV4cCI6MjEwNDk0MTQ0OX0.IZaj34yrd0nTYhuU3t6sDCoeD1qwV3KYTx2K6QxeFE0',
};

const KEY_URL = 'SAAHAA_SB_URL';
const KEY_ANON = 'SAAHAA_SB_KEY';

function fromQuery() {
  try {
    const q = new URLSearchParams(location.search);
    const url = q.get('sb'), key = q.get('key');
    if (url && key) {
      persist.write(KEY_URL, url);
      persist.write(KEY_ANON, key);
      return { url, anonKey: key };
    }
  } catch (e) {}
  return null;
}

export function supabaseConfig() {
  return fromQuery()
      || { url: persist.read(KEY_URL, '') || BAKED.url,
           anonKey: persist.read(KEY_ANON, '') || BAKED.anonKey };
}

export function setSupabaseConfig(url, anonKey) {
  persist.write(KEY_URL, url || '');
  persist.write(KEY_ANON, anonKey || '');
}
export function clearSupabaseConfig() {
  persist.remove(KEY_URL); persist.remove(KEY_ANON);
}
export const hasSupabase = () => { const c = supabaseConfig(); return !!(c.url && c.anonKey); };

/* ── the rail: the Worker that owns identity ────────────────────
   WHY THERE IS A SERVER IN AN OFFLINE-FIRST APP AT ALL. Two things cannot be
   decided on a device and were being decided on one: the next account code
   (domain/identity.js counted the accounts it could see, so two phones both
   minted C20262001), and whether a mobile number is already taken. Both need a
   single writer. The Worker is that writer; it holds the service-role key and
   the browser holds none.

   Everything else stays exactly where it was. The device is still the working
   copy, still renders offline, still owns its own session.

   Override for a fork or a local Worker: ?rail=https://…  (stored per device),
   or ?rail=off to run the old device-only way. */
const BAKED_RAIL = 'https://saahaa-api.siidhartha12.workers.dev';
const KEY_RAIL = 'SAAHAA_RAIL';

export function railUrl() {
  try {
    const q = new URLSearchParams(location.search).get('rail');
    if (q) persist.write(KEY_RAIL, q === 'off' ? '' : q.replace(/\/+$/, ''));
  } catch (e) {}
  const saved = persist.read(KEY_RAIL, null);
  return String(saved === null ? BAKED_RAIL : saved).replace(/\/+$/, '');
}
export const hasRail = () => !!railUrl();
export const setRailUrl = u => persist.write(KEY_RAIL, String(u || '').replace(/\/+$/, ''));

/* Which backend the app runs against.
   'auto'  — use Supabase when configured and reachable, otherwise local
   'local' — never touch the network (the demo/offline mode)
   'cloud' — require Supabase; surface an error rather than silently falling back */
export function backendMode() {
  try {
    const q = new URLSearchParams(location.search).get('backend');
    if (q) return q;
  } catch (e) {}
  return persist.read('SAAHAA_BACKEND', 'auto');
}
export const setBackendMode = m => persist.write('SAAHAA_BACKEND', m);

/* ── the owner's credential ─────────────────────────────────────
   The PASSWORD IS NOT HERE. This is a PBKDF2-SHA256 hash (250,000 rounds)
   over a random salt; a login is verified by re-deriving and comparing.
   It bootstraps the admin account on a fresh device and replaces any demo
   credential. Rotate it from Admin → System & audit → change password (that
   writes a new hash into state); to rotate the bootstrap itself run
   `node tools/admin-cred.mjs '<new password>'` and paste the result here. */
export const ADMIN_BOOTSTRAP = {
  username: 'siidhartha12',
  salt: '4da0f76dcbf7f8a102f6eb757c3d46d6',
  hash: '895883bb11300d91f5bcf91234e0c44b7a0627a0017203b0cd6a975e982bbe14',
  iterations: 250000,
  version: 1,
};

/* ── payments: the rail (core/gateway.js) ───────────────────────
   'sim' until the Razorpay account exists. keyId is the PUBLIC key id — it
   is meant to sit in the page. The SECRET key and the webhook secret NEVER
   come near this file: they live in the Edge Functions' secrets
   (supabase/functions/README.md). functionsUrl is the base of those
   functions, e.g. https://<ref>.functions.supabase.co */
export const PAYMENTS = {
  mode: 'sim',            // 'sim' | 'razorpay'
  keyId: '',              // rzp_test_… or rzp_live_… (public)
  functionsUrl: '',       // Supabase Edge Functions base URL
  name: 'SAAHAA',
  themeColor: '#7C3AED',
};
const KEY_PAY = 'SAAHAA_PAYMENTS';
/** Live payments config: URL switch (?payments=razorpay&rzkey=…&fnurl=…) > device override > baked. */
export function paymentsConfig() {
  let o = null;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('payments')) {
      o = { mode: q.get('payments'), keyId: q.get('rzkey') || '', functionsUrl: q.get('fnurl') || '' };
      persist.write(KEY_PAY, o);
    }
  } catch (e) {}
  const saved = o || persist.read(KEY_PAY, null) || {};
  const cfg = { ...PAYMENTS, ...saved };
  /* three rails now — the manual UPI one is what actually runs in production
     until volume pays for an aggregator licence. Normalising it away here was
     quietly defeating core/gateway.js, which had already learned about it. */
  cfg.mode = cfg.mode === 'razorpay' ? 'razorpay' : cfg.mode === 'upi-manual' ? 'upi-manual' : 'sim';
  return cfg;
}
export function setPaymentsConfig({ mode, keyId, functionsUrl } = {}) {
  const next = { mode: mode === 'razorpay' ? 'razorpay' : 'sim', keyId: String(keyId || ''), functionsUrl: String(functionsUrl || '').replace(/\/+$/, '') };
  persist.write(KEY_PAY, next);
  return next;
}
export function clearPaymentsConfig() { persist.remove(KEY_PAY); }

/* ── the company, as the legal pages and the gateway show it ──
   Empty strings render as "not yet set" on the Contact page; fill these the
   day the entity exists (docs/LAUNCH.md step 6). Nothing here is secret. */
export const CONTACT = {
  legalName: '',          // e.g. "SAAHAA (sole proprietorship of …)"
  email: '',
  phone: '',
  address: '',            // registered address, one line
  gstin: '',
  city: 'Hyderabad',
};
