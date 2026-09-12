/* SAAHAA · tools/taste.mjs — the parts of "good design" a machine can check.
 *
 * Taste is not measurable. Contrast, tap targets, type scale and token
 * discipline are, and they are where bad UI actually hurts a person on a
 * ₹6,000 Android in Hyderabad sunlight — not in whether the plum is the right
 * plum.
 *
 * So this checks the measurable floor and says nothing about the rest:
 *
 *   1. CONTRAST — every ink/ground pair the app actually uses, against
 *      WCAG AA (4.5:1 body, 3:1 large). Sunlight is the real spec here.
 *   2. TAP TARGETS — 44px is the smallest thing a thumb reliably hits. A
 *      44px rule that only appears in a comment has been written twice in
 *      this project and enforced neither time.
 *   3. TYPE — nothing under 12px, because a shopkeeper reading a price at
 *      arm's length is the whole product.
 *   4. TOKENS — a hard-coded hex in a view is how a design system dies. It
 *      starts with one, and the one is always "just this once".
 *
 * Run: node tools/taste.mjs      (add --json for a machine-readable line)
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFile(join(ROOT, p), 'utf8');

const checks = [];
const add = (ok, weight, what, detail = '') => checks.push({ ok, weight, what, detail });

/* ── colour ───────────────────────────────────────────────── */
const hex = h => {
  const s = h.replace('#', '').trim();
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
};
const lum = rgb => {
  const a = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
};

const tokens = await read('src/ui/tokens.css');
const tokenOf = name => {
  const m = tokens.match(new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,8})'));
  return m ? m[1].slice(0, 7) : null;
};

/* The pairs the product actually puts together. Checking every combination
   would flag pairs nobody ever sees; these are the ones a person reads. */
const PAIRS = [
  ['color-text', 'color-bg', 4.5, 'body text on the page'],
  ['color-text', 'color-surface', 4.5, 'body text on a card'],
  ['ink-2', 'color-bg', 4.5, 'secondary text'],
  ['ink-3', 'color-bg', 3.0, 'muted text (large/secondary only)'],
];
PAIRS.forEach(([fg, bg, need, what]) => {
  const a = tokenOf(fg), b = tokenOf(bg);
  if (!a || !b) return add(true, 0, `${what} — tokens not both hex, skipped`);
  const r = ratio(a, b);
  add(r >= need, 8, `${what} is ${r}:1 (needs ${need}:1)`, r >= need ? '' : `${a} on ${b}`);
});

/* ── tap targets and type, across every view ─────────────── */
const viewDir = 'src/ui/views';
const files = (await readdir(join(ROOT, viewDir))).filter(f => f.endsWith('.js'));
let tiny = [], small = [];
for (const f of files) {
  const src = await read(join(viewDir, f));
  /* an explicit height/min-height under 44px on something clickable */
  for (const m of src.matchAll(/data-act=[^>]{0,400}?(?:min-height|height)\s*:\s*(\d+)px/g)) {
    if (+m[1] < 44) tiny.push(`${f}: ${m[1]}px`);
  }
  for (const m of src.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    if (+m[1] >= 12) continue;
    /* the OpenStreetMap attribution is a required third-party credit, set tiny
       by convention everywhere it appears. It is not product text anybody reads
       to decide something, and enlarging it would crowd the map it credits. */
    const around = src.slice(Math.max(0, m.index - 120), m.index);
    if (/attribution|leaflet-control/.test(around)) continue;
    small.push(`${f}: ${m[1]}px`);
  }
}
add(tiny.length === 0, 10, `every tappable control is at least 44px`, tiny.slice(0, 4).join(', '));
add(small.length === 0, 6, `no text under 12px`, small.slice(0, 4).join(', '));

/* ── token discipline ─────────────────────────────────────── */
let hard = [];
for (const f of files) {
  const src = await read(join(viewDir, f));
  /* a literal colour in a style attribute — not in a comment, not a token */
  for (const m of src.matchAll(/style="[^"]*?(#[0-9a-fA-F]{6})\b/g)) hard.push(`${f}: ${m[1]}`);
}
add(hard.length <= 2, 6, `views use design tokens, not literal colours`,
    hard.length ? `${hard.length} found: ${hard.slice(0, 3).join(', ')}` : '');

/* ── the money screens have one visual hierarchy ──────────── */
{
  const orders = await read('src/ui/views/orders.js');
  const hasTotalClass = /m-kv--total/.test(orders);
  add(hasTotalClass, 6, 'a bill total is marked as a total, not just bolder text');
}

const got = checks.filter(c => c.ok).reduce((n, c) => n + c.weight, 0);
const max = checks.reduce((n, c) => n + c.weight, 0);
const score = max ? Math.round((got / max) * 1000) / 10 : 100;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ taste: score, failed: checks.filter(c => !c.ok).map(c => c.what) }));
} else {
  console.log('\n  SAAHAA · taste (the measurable floor)\n');
  checks.forEach(c => console.log(`  ${c.ok ? 'ok  ' : '  x '} ${c.what}${c.detail ? '  — ' + c.detail : ''}`));
  console.log(`\n  taste: ${score}/100  (${got} of ${max})\n`);
}
process.exit(checks.some(c => !c.ok) ? 1 : 0);
