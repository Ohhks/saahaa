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
const ratio = (rgbA, rgbB) => {
  const [l1, l2] = [lum(rgbA), lum(rgbB)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
};

/* Strip CSS comments first. The prose in this file names tokens, and a naive
   scan reads those mentions as real declarations. */
const tokens = (await read('src/ui/tokens.css')).replace(/\/\*[\s\S]*?\*\//g, '');

/* A declaration block by its exact selector. Rules like
   `:root[data-theme="dark"] .tag` appear later in the file and share the
   prefix — requiring the brace immediately after the selector keeps them out. */
const blockOf = sel => {
  const at = tokens.indexOf(sel + '{');
  if (at < 0) return {};
  let i = at + sel.length + 1, depth = 1; const start = i;
  while (i < tokens.length && depth) { const c = tokens[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
  const out = {};
  for (const m of tokens.slice(start, i - 1).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+)/gi)) out[m[1]] = m[2].trim();
  return out;
};
const LIGHT = blockOf(':root');
const DARK = { ...LIGHT, ...blockOf(':root[data-theme="dark"]') };

/* Resolve a token to {rgb, a}. Three forms appear in this file: a hex, a
   var() indirection, and color-mix(… N%, transparent) — which is an ALPHA,
   not a colour. Reading only hex is why `ink-2` and `ink-3` used to print
   "tokens not both hex, skipped" and still counted as passing checks: two of
   the four contrast rules were decorative. */
const resolve = (name, scope, seen = new Set()) => {
  if (seen.has(name)) return null;           /* a var() cycle is a stack overflow otherwise */
  seen.add(name);
  const v = (scope[name] || '').trim();
  if (!v) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return { rgb: hex(v), a: 1 };
  const asVar = v.match(/^var\(\s*--([a-z0-9-]+)/i);
  if (asVar) return resolve(asVar[1], scope, seen);
  const mix = v.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/i);
  if (mix) {
    const inner = mix[1].trim();
    const innerVar = inner.match(/^var\(\s*--([a-z0-9-]+)/i);
    const base = /^#/.test(inner) ? { rgb: hex(inner), a: 1 }
               : innerVar ? resolve(innerVar[1], scope, seen) : null;
    if (!base) return null;
    return { rgb: base.rgb, a: base.a * (+mix[2] / 100) };
  }
  return null;
};
/* what the eye actually receives: the ink composited onto its ground */
const over = (c, bg) => c.rgb.map((v, i) => Math.round(v * c.a + bg[i] * (1 - c.a)));

/* The pairs the product actually puts together. Checking every combination
   would flag pairs nobody ever sees; these are the ones a person reads. */
const PAIRS = [
  ['color-text', 'color-bg', 4.5, 'body text on the page'],
  ['color-text', 'surface', 4.5, 'body text on a card'],
  ['ink-2', 'color-bg', 4.5, 'secondary text'],
  ['ink-3', 'color-bg', 3.0, 'muted text (large/secondary only)'],
];
/* Dark mode was never measured at all. It is half the hours of the day. */
for (const [theme, scope] of [['light', LIGHT], ['dark', DARK]]) {
  PAIRS.forEach(([fg, bg, need, what]) => {
    const ink = resolve(fg, scope), ground = resolve(bg, scope);
    /* A check that cannot be computed is not a check that passed. */
    if (!ink || !ground) return add(false, 8, `${what} · ${theme} — could not resolve --${ink ? bg : fg}`);
    const r = ratio(over(ink, ground.rgb), ground.rgb);
    add(r >= need, 8, `${what} · ${theme} is ${r}:1 (needs ${need}:1)`, r >= need ? '' : `--${fg} on --${bg}`);
  });
}

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
/* The stylesheets, which is where sizing actually lives. Scanning only the
   views meant this gate read inline styles and ignored the two files that set
   the type scale for the whole product — four rules under the 12px floor sat
   there unseen while it reported 100/100. */
for (const f of ['src/ui/tokens.css', 'src/ui/brand.css']) {
  const css = (await read(f)).replace(/\/\*[\s\S]*?\*\//g, '');
  const name = f.split('/').pop();
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, sel, body] = rule;
    for (const m of body.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (+m[1] < 12 && !/attribution|leaflet/.test(sel)) small.push(`${name} ${sel.trim().slice(0, 40)}: ${m[1]}px`);
    }
    /* a height on the control itself — an icon inside it is not a tap target */
    /* `\b` before a dot can never match — a newline and a `.` are both
       non-word characters, so this test silently skipped every class
       selector and the whole tap-target scan of the CSS read nothing. */
    if (!/(\bbutton|\.btn|\.chip|\.tab|\.fab|\[data-act)/.test(sel)) continue;
    if (/\b(svg|img|\.ic\b|::?(before|after))/.test(sel)) continue;
    for (const m of body.matchAll(/(?:^|;)\s*(?:min-)?height\s*:\s*(\d+)px/g)) {
      if (+m[1] < 44) tiny.push(`${name} ${sel.trim().slice(0, 40)}: ${m[1]}px`);
    }
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
