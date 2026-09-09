/* SAAHAA · core/photos.js — where a picture lives.

   A shop's front, a product on a shelf, a job finished well. Until now the
   product had no pictures at all, which is most of why a listing looked like a
   spreadsheet row and not like a shop.

   THREE DECISIONS WORTH KNOWING

   1. Pictures are NOT in the state blob. `SAAHAA_V6_STATE` is rewritten
      (debounced) on every change and is already a quarter of a megabyte;
      putting images in it would make every keystroke stringify megabytes on
      the main thread — the same class of stall the home screen just had. Each
      picture is its own key, so writing one writes one.

   2. A record stores an ID, never the bytes. `product.photo = 'ph_x9…'`, and
      the bytes are fetched when something is actually drawn.

   3. There is a hard budget. localStorage is about 5MB for the WHOLE origin —
      shared with the state, the audit log and the backups. Photos may take
      3MB of it and no more, and a single photo 90KB. Over budget we refuse
      and say so; we never silently drop somebody's shop front to make room.

   DOM-free on purpose: the resizing (canvas, FileReader) is ui/photo.js,
   because that needs a document. This half is storage and arithmetic, so it
   runs and is tested under plain Node. */

import * as persist from './persist.js';

export const MAX_ONE   = 90 * 1024;          // one picture, as stored (a data URL)
export const MAX_TOTAL = 3 * 1024 * 1024;    // all pictures together

/* WHERE THE PICTURES SIT.
   The in-app suite (Admin -> System & audit -> Run tests) runs against the very
   storage the person is using. A suite that calls gc() to tidy up after itself
   therefore DELETED every real picture on the device — a shopkeeper pressing a
   diagnostic button lost their shop front. The shelf is now swappable, so the
   tests keep their own and can never reach anybody's. */
let shelf = '';
const INDEX_OF = s => 'SAAHAA_PHOTOS' + s;
const KEY_OF = (s, id) => 'SAAHAA_PHOTO' + s + '_' + id;
const idxKey = () => INDEX_OF(shelf);
const KEY = id => KEY_OF(shelf, id);

/** Where a picture actually sits, on the shelf currently in use. */
export const storageKey = id => KEY(id);

/** Tests only: move to a named shelf, and get back a function that restores. */
export function useShelf(name = '') {
  const was = shelf;
  shelf = name ? '_' + String(name).replace(/[^A-Za-z0-9]/g, '') : '';
  return () => { shelf = was; };
}

/** Only ever a real raster data URL. The store is user-editable — a value that
    is not one of these is treated as missing rather than handed to an <img>. */
export const isPhotoUrl = v =>
  typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

export const newId = () =>
  'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const index = () => { const i = persist.read(idxKey(), {}); return (i && typeof i === 'object') ? i : {}; };
const saveIndex = i => persist.write(idxKey(), i);

/** What the pictures are costing, so a screen can say it plainly. */
export function usage() {
  const i = index();
  const ids = Object.keys(i);
  const bytes = ids.reduce((n, k) => n + (i[k] && i[k].b | 0), 0);
  return { count: ids.length, bytes, maxBytes: MAX_TOTAL,
           freeBytes: Math.max(0, MAX_TOTAL - bytes),
           pct: Math.min(100, Math.round((bytes / MAX_TOTAL) * 100)) };
}

/**
 * Store one picture. Returns { ok, id, bytes, reason }.
 * Refuses rather than evicting: the picture somebody else already published is
 * not ours to delete to make room for this one.
 */
export function put(dataUrl, id = newId()) {
  if (!isPhotoUrl(dataUrl)) return { ok: false, reason: 'That is not an image' };
  const bytes = dataUrl.length;
  if (bytes > MAX_ONE)
    return { ok: false, reason: `That picture is ${(bytes / 1024).toFixed(0)}KB — the most one may be is ${Math.floor(MAX_ONE / 1024)}KB` };

  const i = index();
  const had = (i[id] && i[id].b | 0) || 0;
  const after = usage().bytes - had + bytes;
  if (after > MAX_TOTAL)
    return { ok: false, reason: 'Pictures are full on this device — remove one before adding another' };

  const w = persist.write(KEY(id), dataUrl);
  if (w && w.ok === false) return { ok: false, reason: 'This device has no room left for pictures' };
  i[id] = { b: bytes, at: Date.now() };
  saveIndex(i);
  return { ok: true, id, bytes };
}

/** The bytes to draw, or '' — never null, so a template can use it directly. */
export function url(id) {
  if (!id) return '';
  const v = persist.read(KEY(id), '');
  return isPhotoUrl(v) ? v : '';
}

export const has = id => !!url(id);

export function remove(id) {
  if (!id) return false;
  persist.remove(KEY(id));
  const i = index();
  if (!(id in i)) return false;
  delete i[id];
  saveIndex(i);
  return true;
}

/**
 * Drop pictures nothing points at any more — a product deleted, a shop closed.
 * `keep` is every id still referenced; anything else is an orphan holding
 * budget hostage. Returns how many went.
 */
export function gc(keep = []) {
  const live = new Set(keep.filter(Boolean));
  let n = 0;
  for (const id of Object.keys(index())) if (!live.has(id)) { remove(id); n++; }
  return n;
}

/** Every photo id a state references — the argument gc() wants. */
export function referenced(state = {}) {
  const out = [];
  const take = v => { if (v) out.push(v); };
  (state.shops || []).forEach(s => { take(s.photo); (s.gallery || []).forEach(take); });
  (state.products || []).forEach(p => take(p.photo));
  (state.partners || []).forEach(p => { take(p.photo); take(p.selfie); (p.work || []).forEach(take); });
  (state.orders || []).forEach(o => (o.evidence || []).forEach(e => take(e && e.photo)));
  return out;
}
