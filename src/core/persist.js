/* SAAHAA · core/persist.js — the ONLY module allowed to touch localStorage.
   Swapping to IndexedDB / Supabase later touches this file alone. */

import { emit } from './bus.js';
export const KEYS = {
  state:  'SAAHAA_V6_STATE',
  flags:  'SAAHAA_FLAGS',
  audit:  'SAAHAA_AUDIT',
  lock:   'SAAHAA_MIGRATION_LOCK',
  session:'SAAHAA_SESSION',
  guestArea:'SAAHAA_GUEST_AREA',
  backup: p => `SAAHAA_BACKUP_${p}`,
};

let available = true;
try { localStorage.setItem('__saahaa_probe', '1'); localStorage.removeItem('__saahaa_probe'); }
catch (e) { available = false; }

export const isAvailable = () => available;

export function readRaw(key) {
  if (!available) return null;
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
export function read(key, fallback = null) {
  const s = readRaw(key);
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}
export function write(key, value) {
  if (!available) return { ok: false, reason: 'unavailable' };
  let s;
  try { s = JSON.stringify(value); } catch (e) { return { ok: false, reason: 'serialize', error: e }; }
  try { localStorage.setItem(key, s); return { ok: true, bytes: s.length }; }
  catch (e) {
    // quota — shed oldest backups, then retry once
    const shed = pruneBackups(1);
    try { localStorage.setItem(key, s); return { ok: true, bytes: s.length, shed }; }
    catch (e2) { return { ok: false, reason: 'quota', error: e2 }; }
  }
}
export function remove(key) { if (available) { try { localStorage.removeItem(key); } catch (e) {} } }

export function listBackups() {
  if (!available) return [];
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('SAAHAA_BACKUP_')) {
      const raw = readRaw(k) || '';
      let meta = {};
      try { meta = JSON.parse(raw).__backupMeta || {}; } catch (e) {}
      out.push({ key: k, bytes: raw.length, ts: meta.ts || 0, version: meta.version ?? '?', tag: meta.tag || '' });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}
/** Keep the newest `keep` backups, delete the rest. Returns deleted keys. */
export function pruneBackups(keep = 5) {
  const list = listBackups();
  const kill = list.slice(keep);
  kill.forEach(b => remove(b.key));
  return kill.map(b => b.key);
}
export function usageBytes() {
  if (!available) return 0;
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('SAAHAA')) n += k.length + (readRaw(k) || '').length;
  }
  return n;
}

/* debounced writer so a burst of dispatches costs one serialize */
let pending = null, timer = null;

/* WHEN THE DEVICE IS FULL, SOMEBODY HAS TO BE TOLD.

   `write()` has always returned {ok:false, reason:'quota'} when localStorage
   refuses, and both writers below used to throw that answer away. The result
   was the worst failure this product could have: the app kept working, looked
   perfectly healthy, and silently stopped saving. Orders, wallet balances and
   ledger legs went on appearing on screen while nothing reached the disk, and
   the next reload rolled the device back to the last write that happened to
   succeed. For an app holding people's money that is worse than a crash — a
   crash is at least visible.

   A failed save is now an event. app.js listens and says so on screen, and
   keeps saying so, because the person needs to stop trusting what they are
   looking at until they free something up. `saveFailed()` lets a re-render ask
   the same question without having to catch the event. */
let lastFailure = null;
export const saveFailed = () => lastFailure;

function commit(key, value) {
  const r = write(key, value);
  if (r && r.ok) {
    if (lastFailure) { lastFailure = null; emit('persist:recovered', { key }); }
  } else {
    lastFailure = { key, reason: (r && r.reason) || 'unknown', at: Date.now() };
    emit('persist:failed', lastFailure);
  }
  return r;
}

export function writeDebounced(key, valueFn, ms = 220) {
  pending = valueFn;
  if (timer) return;
  timer = setTimeout(() => { const fn = pending; timer = null; pending = null; if (fn) commit(key, fn()); }, ms);
}
export function flush(key) { if (timer) { clearTimeout(timer); timer = null; } if (pending) { const fn = pending; pending = null; commit(key, fn()); } }

/* How close this device is to refusing the next write. Cheap enough to call on
   a render: it measures what is stored, not what could be. 5 MB is the smallest
   real budget in the wild (iOS Safari, per origin), so it is the one to warn
   against — a device that turns out to have more is a pleasant surprise, and a
   warning that arrives too early costs nobody anything. */
export const STORE_BUDGET = 5 * 1024 * 1024;
export function usage() {
  if (!available) return { bytes: 0, budget: STORE_BUDGET, pct: 0 };
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += k.length + (localStorage.getItem(k) || '').length;
    }
  } catch (e) {}
  return { bytes: n, budget: STORE_BUDGET, pct: Math.min(1, n / STORE_BUDGET) };
}
