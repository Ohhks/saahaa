/* SAAHAA · core/qr.js — a QR encoder, written here because it has to be.
 *
 * WHY NOT A LIBRARY. The CSP is `script-src 'self'` with no CDN, there is no
 * npm in this project, and the bundle is a single inlined file. Vendoring a
 * minified encoder would put 12 KB of unreadable code in the middle of a repo
 * whose whole argument is that the money path can be read. So: byte mode,
 * error-correction level M, versions 1–10, which covers any profile URL this
 * product can produce with room to spare.
 *
 * WHY LEVEL M AND FULL MASK SELECTION. These codes get printed on a card taped
 * to a shutter, photographed in sunlight, at an angle, by a ₹6,000 phone. M
 * recovers 15% of a damaged symbol. The mask matters more than it looks: the
 * spec's penalty rules exist because a badly masked symbol develops runs and
 * blocks that a decoder mistakes for finder patterns, and a code that scans on
 * a monitor can fail on paper. All eight masks are built and scored.
 *
 * The output is a boolean matrix. Rendering is svg() below — an SVG string, so
 * it prints at any size, costs nothing to store, and needs no canvas.
 */

/* ── GF(256), the field Reed–Solomon lives in ──────────────── */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The generator polynomial for `n` error-correction codewords.
    Coefficients are stored LEADING FIRST and the polynomial is monic, so
    rsEncode below can skip g[0]. The first version of this built the same
    polynomial in the opposite order — correct on its own terms, and silently
    wrong once divided, because the division then skipped the constant term
    instead of the leading one. The symbol still rendered; it just could not be
    corrected. Syndromes are the only honest test of this and tools/qr-test.mjs
    runs them. */
function rsGen(n) {
  const g = [1];
  for (let i = 0; i < n; i++) {
    g.push(0);
    for (let j = g.length - 1; j > 0; j--) g[j] ^= mul(g[j - 1], EXP[i]);
  }
  return g;
}

/** The n EC codewords for one data block. Exported so tools/qr-test.mjs can
    check it against the spec's own worked example rather than against itself. */
export function rsEncode(data, n) {
  const g = rsGen(n), res = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], factor);
  }
  return res;
}

/* ── the tables, level M only ───────────────────────────────── */
/* [total codewords, ec codewords per block, [block count, data codewords]…] */
const VERSIONS = {
  1:  [26,  10, [[1, 16]]],
  2:  [44,  16, [[1, 28]]],
  3:  [70,  26, [[1, 44]]],
  4:  [100, 18, [[2, 32]]],
  5:  [134, 24, [[2, 43]]],
  6:  [172, 16, [[4, 27]]],
  7:  [196, 18, [[4, 31]]],
  8:  [242, 22, [[2, 38], [2, 39]]],
  9:  [292, 22, [[3, 36], [2, 37]]],
  10: [346, 26, [[4, 43], [1, 44]]],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
                7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const dataCodewords = v => VERSIONS[v][2].reduce((n, [c, d]) => n + c * d, 0);
/** How many bytes of payload a version holds: data codewords less the header. */
export const capacity = v => dataCodewords(v) - (v >= 10 ? 3 : 2);

/* ── bit stream ─────────────────────────────────────────────── */
class Bits {
  constructor() { this.b = []; }
  push(value, len) { for (let i = len - 1; i >= 0; i--) this.b.push((value >> i) & 1); }
  get length() { return this.b.length; }
}

/* ── BCH, for the format and version strips ─────────────────── */
/* the spec's own BCH(15,5): compute the remainder honestly rather than ship a
   15-entry lookup table nobody can check */
export function formatInfo(mask) {
  const data = (0b00 << 3) | mask;          // M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}
function versionInfo(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (v << 12) | (rem & 0xfff);
}

/* ── the symbol ─────────────────────────────────────────────── */
function place(version, codewords, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) m[r][c] = v; };

  const finder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const inner = i >= 0 && i <= 6 && j >= 0 && j <= 6;
      const on = inner && (i === 0 || i === 6 || j === 0 || j === 6 ||
                           (i >= 2 && i <= 4 && j >= 2 && j <= 4));
      set(r + i, c + j, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (const a of ALIGN[version]) for (const b of ALIGN[version]) {
    /* the three finder corners have no alignment pattern on top of them */
    if ((a === 6 && b === 6) || (a === 6 && b === size - 7) || (a === size - 7 && b === 6)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      set(a + i, b + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
  }

  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
  m[size - 8][8] = true;                                   // the dark module, always

  /* format strips: reserved now, written after masking */
  const fmtCells = [];
  for (let i = 0; i <= 5; i++) fmtCells.push([8, i], [i, 8]);
  fmtCells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 0; i < 8; i++) fmtCells.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) fmtCells.push([8, size - 1 - i]);
  fmtCells.forEach(([r, c]) => { if (m[r][c] === null) m[r][c] = false; });

  if (version >= 7) {
    const vi = versionInfo(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vi >> i) & 1) === 1;
      m[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      m[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  /* the zig-zag: two columns at a time, right to left, skipping column 6 */
  const reserved = m.map(row => row.map(c => c !== null));
  let bit = 0, up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const row = up ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (reserved[row][col]) continue;
        let dark = bit < codewords.length * 8
          && ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        bit++;
        /* the mask is applied to data modules only, never to function patterns */
        const i = row, j = col;
        const flip = [
          () => (i + j) % 2 === 0,
          () => i % 2 === 0,
          () => j % 3 === 0,
          () => (i + j) % 3 === 0,
          () => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
          () => ((i * j) % 2) + ((i * j) % 3) === 0,
          () => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
          () => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
        ][mask]();
        if (flip) dark = !dark;
        m[row][col] = dark;
      }
    }
    up = !up;
  }

  const fmt = formatInfo(mask);
  const fbit = i => ((fmt >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) { m[8][i] = fbit(i); m[i][8] = fbit(14 - i); }
  m[8][7] = fbit(6); m[8][8] = fbit(7); m[7][8] = fbit(8);
  for (let i = 0; i < 7; i++) m[size - 1 - i][8] = fbit(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = fbit(14 - i);
  m[size - 8][8] = true;

  return m;
}

/* The spec's four penalty rules. Without these a symbol can grow runs and
   2x2 blocks that a decoder reads as structure — fine on screen, unreliable
   on a printed card in the sun, which is where these actually get used. */
function penalty(m) {
  const n = m.length; let score = 0;
  const run = line => {
    let last = null, len = 0;
    for (const v of line) {
      if (v === last) { len++; if (len === 5) score += 3; else if (len > 5) score += 1; }
      else { last = v; len = 1; }
    }
  };
  for (let i = 0; i < n; i++) { run(m[i]); run(m.map(r => r[i])); }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++)
    if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) score += 3;
  const BAD = [true, false, true, true, true, false, true];
  const hasPattern = (line, at) => BAD.every((v, k) => line[at + k] === v);
  const four = [false, false, false, false];
  const scan = line => {
    for (let i = 0; i + 7 <= n; i++) {
      if (!hasPattern(line, i)) continue;
      const before = line.slice(Math.max(0, i - 4), i);
      const after = line.slice(i + 7, i + 11);
      if ((before.length === 4 && before.every(v => v === false)) ||
          (after.length === 4 && after.every(v => v === false))) score += 40;
    }
  };
  void four;
  for (let i = 0; i < n; i++) { scan(m[i]); scan(m.map(r => r[i])); }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/**
 * Encode a string as a QR symbol.
 * @returns {boolean[][]} the module matrix, dark = true
 */
export function encode(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = Number(Object.keys(VERSIONS).find(v => bytes.length <= capacity(+v)));
  if (!version) throw new Error(`qr: ${bytes.length} bytes is more than version 10 holds`);

  const [, ecPer, groups] = VERSIONS[version];
  const bits = new Bits();
  bits.push(0b0100, 4);                                  // byte mode
  bits.push(bytes.length, version >= 10 ? 16 : 8);
  bytes.forEach(b => bits.push(b, 8));

  const total = dataCodewords(version) * 8;
  bits.push(0, Math.min(4, total - bits.length));        // terminator
  while (bits.length % 8) bits.b.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.b.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  /* the two pad bytes the spec names, alternating, to the end of the capacity */
  for (let i = 0; data.length < dataCodewords(version); i++) data.push(i % 2 ? 0x11 : 0xec);

  /* split into blocks, compute EC per block, then interleave both */
  const blocks = []; let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) {
    const d = data.slice(at, at + size); at += size;
    blocks.push({ d, e: rsEncode(d, ecPer) });
  }
  const out = [];
  const maxD = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecPer; i++) for (const b of blocks) out.push(b.e[i]);

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = place(version, out, mask);
    const p = penalty(m);
    if (p < bestScore) { bestScore = p; best = m; }
  }
  return best;
}

/**
 * Render a matrix as an SVG string.
 * @param {boolean[][]} m
 * @param {object} opts {size, quiet, dark, light, label}
 */
export function svg(m, opts = {}) {
  const quiet = opts.quiet ?? 4;                 // the spec's margin; without it many scanners fail
  const n = m.length + quiet * 2;
  const size = opts.size || 240;
  const dark = opts.dark || '#201e1d';
  const light = opts.light || '#ffffff';
  let d = '';
  for (let r = 0; r < m.length; r++) {
    let c = 0;
    while (c < m.length) {
      if (!m[r][c]) { c++; continue; }
      let w = 1;
      while (c + w < m.length && m[r][c + w]) w++;      // one path per run, not per module
      d += `M${c + quiet} ${r + quiet}h${w}v1h-${w}z`;
      c += w;
    }
  }
  const title = opts.label ? `<title>${String(opts.label).replace(/[<&>]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
       + `viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img">${title}`
       + `<rect width="${n}" height="${n}" fill="${light}"/>`
       + `<path d="${d}" fill="${dark}"/></svg>`;
}

/** Everything in one call: text in, SVG out. */
export const svgFor = (text, opts) => svg(encode(text), { label: text, ...opts });
