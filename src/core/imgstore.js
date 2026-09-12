/* SAAHAA · core/imgstore.js — why a thousand shops do not need a thousand
   photographs of the same bag of atta.

   THE PROBLEM, STATED HONESTLY. Every shop wants pictures of its stock, and
   pictures are the one thing that does not fit: 500 MB of Postgres is ~150,000
   orders, but 1 GB of file storage is ~5,000 photographs. Let forty shops
   upload forty product photos each and the budget is gone before the first
   month closes, while the database has barely been touched.

   THE OBSERVATION THAT SOLVES IT. A kirana does not invent its stock. It picks
   from `domain/starter-catalog.js`: 'Aashirvaad Atta 5kg' is the SAME product
   in every shop that sells it. So the image belongs to the PRODUCT, not to the
   shop-product. One canonical picture of that bag serves every shop in
   Hyderabad that stocks it, for ever.

     40 shops x 40 items  =  1,600 listings
     ...but only ~150 distinct catalogue products
     => 150 images, not 1,600. And it gets BETTER with scale, because the
        catalogue does not grow when shops do.

   Three mechanisms, in the order they save the most:

     1. CANONICAL  — a catalogue item resolves to one shared image key.
     2. CONTENT-ADDRESSED — anything genuinely custom is keyed by the hash of
        its own bytes, so two shops that upload the identical photograph (or
        one shop that uploads the same one twice) store it once.
     3. A PLACEHOLDER SO SMALL IT LIVES IN THE ROW — a 6x6 average-colour grid,
        ~40 bytes of base64, rendered instantly while the real image loads, or
        instead of it for ever on a slow connection. A list of forty products
        costs 1.6 KB of placeholders and zero image requests.

   WHAT THIS MODULE DOES NOT DO. It does not store bytes. `core/photos.js` is
   still the shelf; this decides the KEY under which a picture is filed and
   whether it needs filing at all. Keeping those separate is what makes the
   canonical trick a two-line change at the call site rather than a rewrite. */

/* The compression target at the door. A 1280px WebP at q0.7 is a clear picture
   of a shelf and about 40 KB; the old 90 KB ceiling was a JPEG-era number. */
export const MAX_EDGE = 1280;
export const WEBP_Q = 0.7;
export const TARGET_BYTES = 48 * 1024;

/** A catalogue product's canonical key: same product, same key, every shop.
    Normalised so 'Amul Ghee 500ml', 'amul ghee  500ML' and 'Amul  Ghee 500ml'
    are one picture and not three. */
export function canonicalKey(name) {
  const n = String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')          // '(loose)' is a way of selling, not a product
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return n ? 'cat:' + n : '';
}

/** 16 hex of SHA-256 over the bytes. Same picture, same key, one copy stored. */
export async function contentKey(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await crypto.subtle.digest('SHA-256', buf);
  return 'own:' + [...new Uint8Array(d)].slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Which key a listing should use. A catalogue product takes the shared one
    unless the shop has deliberately photographed its own. */
export function keyForListing(product = {}) {
  if (product.ownPhotoKey) return product.ownPhotoKey;
  return canonicalKey(product.catalogName || product.name);
}

/* ── the placeholder ──────────────────────────────────────────
   A 6x6 grid of average colours, 4 bits a channel, packed to base64. About 40
   bytes. It is not a thumbnail and is not trying to be: it is the shape and
   colour of the thing, which is all a list needs while the real picture is on
   its way — and all it ever gets on a connection that cannot afford more. */
export const GRID = 6;

/** Build one from raw RGBA (from a canvas). Pure, so it is testable in Node. */
export function blurFromRGBA(rgba, w, h, grid = GRID) {
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * w) / grid), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / grid));
      const y0 = Math.floor((gy * h) / grid), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / grid));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
        }
      }
      if (!n) { cells.push(0); continue; }
      /* 4 bits a channel: a shelf is not a photograph competition, and this is
         the difference between 40 bytes and 110 */
      const R = Math.min(15, Math.round(r / n / 17));
      const G = Math.min(15, Math.round(g / n / 17));
      const B = Math.min(15, Math.round(b / n / 17));
      cells.push((R << 8) | (G << 4) | B);
    }
  }
  const bytes = new Uint8Array(cells.length * 2);
  cells.forEach((c, i) => { bytes[i * 2] = (c >> 8) & 0xff; bytes[i * 2 + 1] = c & 0xff; });
  return b64(bytes);
}

/** CSS that paints one, with no image request at all. */
export function blurToCss(blur, grid = GRID) {
  const bytes = unb64(blur);
  if (!bytes || bytes.length < grid * grid * 2) return '';
  const stops = [];
  for (let i = 0; i < grid * grid; i++) {
    const c = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    const r = ((c >> 8) & 15) * 17, g = ((c >> 4) & 15) * 17, b = (c & 15) * 17;
    const gx = i % grid, gy = (i / grid) | 0;
    stops.push(`radial-gradient(circle at ${((gx + .5) / grid) * 100}% ${((gy + .5) / grid) * 100}%,`
      + `rgb(${r},${g},${b}) 0, transparent ${100 / grid}%)`);
  }
  return stops.join(',');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
         + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '')
         + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return out;
}
function unb64(s) {
  const str = String(s || '');
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const n = (B64.indexOf(str[i]) << 18) | (B64.indexOf(str[i + 1]) << 12)
            | ((B64.indexOf(str[i + 2]) & 63) << 6) | (B64.indexOf(str[i + 3]) & 63);
    out.push((n >> 16) & 255);
    if (str[i + 2]) out.push((n >> 8) & 255);
    if (str[i + 3]) out.push(n & 255);
  }
  return new Uint8Array(out);
}

/** How much a whole roster actually costs, once sharing is counted. The number
    that matters is DISTINCT keys, not listings — and the gap between them is
    the whole point of this module. */
export function rosterCost(products = []) {
  const keys = new Set();
  products.forEach(p => { const k = keyForListing(p); if (k) keys.add(k); });
  const naive = products.length * TARGET_BYTES;
  const real = keys.size * TARGET_BYTES;
  return {
    listings: products.length, distinct: keys.size,
    naiveBytes: naive, bytes: real,
    savedBytes: naive - real,
    ratio: keys.size ? +(products.length / keys.size).toFixed(1) : 0,
  };
}
