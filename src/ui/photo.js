/* SAAHAA · ui/photo.js — taking a picture and making it small enough to keep.

   A phone photograph is three to eight megabytes. The whole device budget for
   pictures is three. So nothing is ever stored as it arrives: it is drawn into
   a canvas at a sensible size, re-encoded as JPEG, and shrunk again if it is
   still too heavy. What reaches core/photos.js is always a few tens of KB.

   This is the half that needs a document — the file input, the decode, the
   canvas. The storage, the budget and the validation are core/photos.js, which
   is DOM-free and unit-tested. */

import * as photos from '../core/photos.js';

const DEFAULTS = { maxEdge: 640, quality: 0.72, minQuality: 0.4, minEdge: 320 };

/** Ask for a file. Resolves null if the person changes their mind. */
export function chooseFile({ capture = false } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    if (capture) el.capture = 'environment';       // a phone opens the camera
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    /* No 'cancel' event in every browser: if focus comes back to the window and
       nothing was chosen, treat it as a cancel rather than hanging forever. */
    let settled = false;
    const done = v => { if (!settled) { settled = true; el.remove(); resolve(v); } };
    el.addEventListener('change', () => done(el.files && el.files[0] ? el.files[0] : null));
    window.addEventListener('focus', () => setTimeout(() => done(el.files && el.files[0] ? el.files[0] : null), 700), { once: true });
    document.body.appendChild(el);
    el.click();
  });
}

const decode = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read')); };
  img.src = url;
});

/** Draw to a canvas at `edge` on the long side and encode as JPEG. */
function encode(img, edge, quality) {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';                 // JPEG has no transparency; white beats black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

/**
 * A file in, a stored picture out: { ok, id, bytes, w, h, reason }.
 * Tries the requested size, then leans on quality, then on size, and gives up
 * honestly rather than storing something enormous.
 */
export async function shrinkAndStore(file, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!file) return { ok: false, reason: 'No picture chosen' };
  if (!/^image\//.test(file.type || '')) return { ok: false, reason: 'That file is not a picture' };

  let img;
  try { img = await decode(file); }
  catch (e) { return { ok: false, reason: e.message }; }

  let edge = o.maxEdge, quality = o.quality, data = encode(img, edge, quality);
  while (data.length > photos.MAX_ONE) {
    if (quality > o.minQuality) quality = Math.max(o.minQuality, quality - 0.12);
    else if (edge > o.minEdge) edge = Math.max(o.minEdge, Math.round(edge * 0.8));
    else break;
    data = encode(img, edge, quality);
  }
  const r = photos.put(data);
  return r.ok ? { ...r, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height } : r;
}

/** The whole gesture: ask, shrink, store. */
export async function pick(opts = {}) {
  const file = await chooseFile(opts);
  if (!file) return { ok: false, cancelled: true, reason: '' };
  return shrinkAndStore(file, opts);
}

/** What a template draws. Returns '' when there is no picture. */
export const url = id => photos.url(id);
