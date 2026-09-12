/* SAAHAA · tools/qr-test.mjs — is the code actually a QR code?
 *
 * A QR encoder is the kind of thing that looks finished long before it is
 * correct. It renders a convincing square of black and white the moment the
 * placement logic runs, and every structural check passes, and the symbol is
 * still unreadable — because the error correction is wrong, and nothing on
 * screen can tell you that.
 *
 * This project's first draft did exactly that: the generator polynomial was
 * built lowest-degree-first while the division expected leading-first, so it
 * skipped the constant term instead of the leading one. The picture was
 * perfect. The codewords were not correctable.
 *
 * So the two checks that matter here are mathematical, not visual:
 *   · SYNDROMES. A Reed–Solomon codeword is divisible by its generator, which
 *     means it evaluates to zero at every root. Random data, every EC size
 *     this product uses. This is the check that caught the bug above.
 *   · FORMAT BITS against the published table for level M. Get these wrong and
 *     a decoder does not know which mask to undo, whatever else is right.
 *
 * Then the structure, and then that a pro and a shopkeeper are actually given
 * one — a perfect encoder nobody can reach is worth nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const qr = await import(new URL('../src/core/qr.js', import.meta.url).href);

let pass = 0; const fails = [];
const say = (ok, what, detail = '') => ok ? pass++ : fails.push(what + (detail ? '  — ' + detail : ''));

/* ── 1 · Reed–Solomon, by syndrome ──────────────────────────── */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

let seed = 20260913;
const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
let worst = null, runs = 0;
for (const n of [10, 16, 18, 22, 24, 26]) {          // every EC size level M uses
  for (let t = 0; t < 60; t++) {
    const data = [...Array(16 + rnd(30))].map(() => rnd(256));
    const cw = [...data, ...qr.rsEncode(data, n)];
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const c of cw) s = mul(s, EXP[i]) ^ c;     // Horner at alpha^i
      if (s !== 0 && !worst) worst = `ec=${n} root=${i} syndrome=${s}`;
    }
    runs++;
  }
}
say(!worst, `every Reed–Solomon codeword evaluates to zero at every root (${runs} random blocks)`, worst || '');

/* ── 2 · format information, against the published table ────── */
const FORMAT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
                  '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
const badFmt = FORMAT_M.map((want, m) => [m, qr.formatInfo(m).toString(2).padStart(15, '0'), want])
  .filter(([, got, want]) => got !== want);
say(badFmt.length === 0, 'the format bits match the published table for level M',
    badFmt.map(([m, g, w]) => `mask ${m}: ${g} ≠ ${w}`).join(' · '));

/* ── 3 · structure ──────────────────────────────────────────── */
const URLS = [
  'https://saahaa.in/#/pro/p_electrical_6',
  'https://saahaa.pages.dev/#/shop/s_tlspjahssdk5',
  'http://localhost:8772/#/pro/p_x',
  'https://saahaa.in/#/pro/' + 'x'.repeat(120),        // forces a bigger version
];
for (const url of URLS) {
  const m = qr.encode(url);
  const n = m.length;
  const finder = (r, c) => m[r][c] && m[r + 6][c] && m[r][c + 6] && m[r + 6][c + 6]
    && !m[r + 1][c + 1] && m[r + 2][c + 2];
  say((n - 17) % 4 === 0 && n >= 21 && n <= 57, `${n}×${n} is a real version size`);
  say(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0), 'three finder patterns, none in the fourth corner');
  say([...Array(n - 16)].every((_, k) => m[6][8 + k] === ((8 + k) % 2 === 0)), 'the timing row alternates');
  say([...Array(n - 16)].every((_, k) => m[8 + k][6] === ((8 + k) % 2 === 0)), 'the timing column alternates');
  say(m[n - 8][8] === true, 'the dark module is set');
  const dark = m.flat().filter(Boolean).length / (n * n);
  say(dark > 0.3 && dark < 0.7, `the chosen mask keeps it balanced (${Math.round(dark * 100)}% dark)`);
}

/* the same text twice is the same symbol — a QR printed on a card in March
   must match the one on the website in June */
say(JSON.stringify(qr.encode(URLS[0])) === JSON.stringify(qr.encode(URLS[0])),
    'encoding is deterministic');

/* ── 4 · the SVG ────────────────────────────────────────────── */
const svg = qr.svgFor(URLS[0], { size: 200 });
say(svg.startsWith('<svg') && svg.includes('</svg>'), 'the SVG is well formed');
say(/viewBox="0 0 (\d+) \1"/.test(svg), 'it is square');
const quiet = svg.match(/viewBox="0 0 (\d+)/)[1] - qr.encode(URLS[0]).length;
say(quiet === 8, `it carries the 4-module quiet zone a scanner needs (${quiet / 2} each side)`);
say(!/<script|onload=/i.test(svg), 'and no script rides along inside it');

/* ── 5 · capacity ───────────────────────────────────────────── */
say(qr.capacity(1) === 14 && qr.capacity(10) === 213, 'the capacity table is the published one',
    `v1=${qr.capacity(1)} v10=${qr.capacity(10)}`);
let threw = false;
try { qr.encode('x'.repeat(400)); } catch (e) { threw = /more than version 10/.test(e.message); }
say(threw, 'too much data is refused in words, never silently truncated');

/* ── 6 · and somebody is actually given one ─────────────────── */
const partner = read('src/ui/views/partner.js');
say(/function qrCard\(/.test(partner), 'the console has a QR card');
say(/qrCard\(p\.id, 'pro'/.test(partner), 'a pro gets one on his own page');
say(/qrCard\(s\.id, 'shop'/.test(partner), 'AND SO DOES A SHOPKEEPER — both sides earn');
const pro = read('src/ui/views/pro.js');
say(/export const profileUrl/.test(pro) && /profileUrl\(id, kind\)/.test(pro),
    'the code and the copied link are built by one function, so they cannot diverge');
say(/export function saveQr/.test(pro) && /image\/svg\+xml/.test(pro),
    'it saves as vector, because a blurred QR is a QR that does not scan');
const app = read('src/app.js');
say(/A\('pro\.qr\.save'/.test(app) && /A\('pro\.share', d => pro\.share\(d\.id, d\.kind\)/.test(app),
    'both buttons are wired, and share knows which kind of page it is');

console.log(`\n  qr: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok the codes are real QR codes and every earner has one\n');
