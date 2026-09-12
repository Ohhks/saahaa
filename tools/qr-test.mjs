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

/* ── 3b · READ IT BACK THE WAY A SCANNER DOES ────────────────
   Structure and syndromes prove the parts. They do not prove the whole thing
   is legible: a symbol can have perfect finders, valid ECC and still carry the
   wrong bits if the zigzag, the mask or the format strip disagree with the
   spec. So this walks the decoder's path — read the format strip, learn the
   mask from it, unmask, walk the interleave backwards, parse byte mode — with
   the function-pattern map rebuilt from the spec rather than borrowed from the
   encoder, so the two can actually disagree. If this passes, a scanner gets
   back the URL that went in. */
const VERSIONS = { 1:[26,10,[[1,16]]],2:[44,16,[[1,28]]],3:[70,26,[[1,44]]],4:[100,18,[[2,32]]],
  5:[134,24,[[2,43]]],6:[172,16,[[4,27]]],7:[196,18,[[4,31]]],8:[242,22,[[2,38],[2,39]]],
  9:[292,22,[[3,36],[2,37]]],10:[346,26,[[4,43],[1,44]]] };
const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
const MASKS = [
  (i,j)=>(i+j)%2===0, (i,j)=>i%2===0, (i,j)=>j%3===0, (i,j)=>(i+j)%3===0,
  (i,j)=>(Math.floor(i/2)+Math.floor(j/3))%2===0, (i,j)=>((i*j)%2)+((i*j)%3)===0,
  (i,j)=>(((i*j)%2)+((i*j)%3))%2===0, (i,j)=>(((i+j)%2)+((i*j)%3))%2===0 ];

function decode(m) {
  const n = m.length, version = (n - 17) / 4;
  /* format strip, top-left copy */
  let fmt = 0;
  const bitAt = (r,c) => m[r][c] ? 1 : 0;
  const bits = [];
  for (let i = 0; i <= 5; i++) bits[i] = bitAt(8, i);
  bits[6] = bitAt(8,7); bits[7] = bitAt(8,8); bits[8] = bitAt(7,8);
  for (let i = 0; i <= 5; i++) bits[14 - i] = bitAt(i, 8);
  for (let i = 0; i < 15; i++) fmt |= bits[i] << i;
  const data5 = ((fmt ^ 0x5412) >> 10) & 0x1f;
  const ecLevel = (data5 >> 3) & 3, mask = data5 & 7;

  /* which modules are function patterns — rebuilt from the spec, not borrowed */
  const fn = Array.from({length:n},()=>new Array(n).fill(false));
  const box = (r,c,h,w)=>{for(let i=0;i<h;i++)for(let j=0;j<w;j++) if(r+i>=0&&c+j>=0&&r+i<n&&c+j<n) fn[r+i][c+j]=true;};
  box(0,0,9,9); box(0,n-8,9,8); box(n-8,0,8,9);
  for (let i=0;i<n;i++){ fn[6][i]=true; fn[i][6]=true; }
  for (const a of ALIGN[version]) for (const b of ALIGN[version]) {
    if ((a===6&&b===6)||(a===6&&b===n-7)||(a===n-7&&b===6)) continue;
    box(a-2,b-2,5,5);
  }
  if (version>=7){ box(0,n-11,6,3); box(n-11,0,3,6); }

  const out = [];
  let bit = 0, byte = 0, up = true;
  for (let right = n-1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) {
      const row = up ? n-1-v : v;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (fn[row][col]) continue;
        let d = m[row][col];
        if (MASKS[mask](row, col)) d = !d;
        byte = (byte << 1) | (d ? 1 : 0);
        if (++bit === 8) { out.push(byte); bit = 0; byte = 0; }
      }
    }
    up = !up;
  }

  /* de-interleave */
  const [, ecPer, groups] = VERSIONS[version];
  const blocks = [];
  for (const [count,size] of groups) for (let i=0;i<count;i++) blocks.push({size, d:[]});
  const maxD = Math.max(...blocks.map(b=>b.size));
  let k = 0;
  for (let i=0;i<maxD;i++) for (const b of blocks) if (i < b.size) b.d.push(out[k++]);
  const data = blocks.flatMap(b=>b.d);

  /* byte mode */
  let p = 0;
  const take = len => { let v=0; for(let i=0;i<len;i++){ const bitIdx=p+i; v=(v<<1)|((data[bitIdx>>3]>>(7-(bitIdx&7)))&1);} p+=len; return v; };
  const mode = take(4);
  const count = take(version>=10?16:8);
  const bytes = [];
  for (let i=0;i<count;i++) bytes.push(take(8));
  return { version, ecLevel, mask, mode, text: new TextDecoder().decode(new Uint8Array(bytes)) };
}


for (const url of URLS) {
  const r = decode(qr.encode(url));
  say(r.text === url, `a scanner reads back exactly what went in (v${r.version}, mask ${r.mask})`,
      r.text === url ? '' : `got ${JSON.stringify(r.text).slice(0, 60)}`);
  say(r.mode === 4, 'in byte mode');
  say(r.ecLevel === 0, 'at error-correction level M');
}

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
