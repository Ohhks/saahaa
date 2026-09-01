/* SAAHAA · core/config.js — public runtime configuration.

   WHAT IS SAFE TO COMMIT HERE:
     · the Supabase project URL
     · the ANON key — it is public by design, ships in every browser, and
       authorises nothing on its own; Row Level Security decides access.

   WHAT MUST NEVER APPEAR HERE, OR ANYWHERE IN THIS REPO:
     · the service_role key  (bypasses ALL RLS — it is a master key)
     · the database password
     · any personal access token
   Those live only in GitHub Actions secrets and in your Supabase dashboard.
   If one ever lands in a commit, rotate it immediately — git history is public.

   Override at runtime without editing this file:
     ?sb=https://xxxx.supabase.co&key=eyJ...      (once, stored locally)
     or set localStorage SAAHAA_SB_URL / SAAHAA_SB_KEY */

import * as persist from './persist.js';

const BAKED = {
  // Filled in by `python tools/setup-supabase.py`, or paste yours here.
  url: '',
  anonKey: '',
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
