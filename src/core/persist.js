/* SAAHAA · core/persist.js — the ONLY module allowed to touch localStorage.
   Swapping to IndexedDB / Supabase later touches this file alone. */
export const KEYS = {
  state:  'SAAHAA_V6_STATE',
  flags:  'SAAHAA_FLAGS',
  audit:  'SAAHAA_AUDIT',
  lock:   'SAAHAA_MIGRATION_LOCK',
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
export function writeDebounced(key, valueFn, ms = 220) {
  pending = valueFn;
  if (timer) return;
  timer = setTimeout(() => { const fn = pending; timer = null; pending = null; if (fn) write(key, fn()); }, ms);
}
export function flush(key) { if (timer) { clearTimeout(timer); timer = null; } if (pending) { const fn = pending; pending = null; write(key, fn()); } }
