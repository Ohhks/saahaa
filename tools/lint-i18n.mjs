/* SAAHAA · tools/lint-i18n.mjs — is the APP translated, or only the table?

   This lint used to print "53 keys defined, 53 rendered ✓" while seven keys
   were rendered nowhere and the app itself was about two per cent translated.
   Two audits in a row found a Telugu tab bar sitting on an entirely English
   product, and every key-level check passed the whole time.

   Two things went wrong, and both are the same mistake: measuring what was
   easy to measure instead of what mattered.

     1. The "stem" escape hatch — meant for `t(s.k + '.t')`, where a view builds
        a key from a prefix — matched that prefix ANYWHERE in the tree. So
        `money.available` counted as used because the unrelated literal
        `['money', 'Sales']` exists in partner.js.
     2. Nothing counted how many places actually call `t()`. A table with no
        gaps says nothing about whether any screen reads from it.

   A measurement that tells you what you hoped is worse than no measurement.

   Run: node tools/lint-i18n.mjs        (wired into tools/preflight.sh)
   Exits non-zero on a dead key, an undefined key, or too little coverage. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const I18N = join(ROOT, 'src', 'ui', 'i18n.js');

/* The floor this build refuses to drop below. A ratchet, not a target: raise it
   whenever coverage grows so it can never quietly slide back. */
const MIN_SITES = 40;

const walk = d => {
  let out = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
  }
  return out;
};

/* `t(` with no boundary matched get(, esc(, isOn(, format( — everything that
   happens to end in a t. It reported 645 render sites and 46 undefined keys,
   all of them nonsense like 'app' and 'SIM_MARKET'. */
const BOUND = '(?<![\\w.$])';

const src = readFileSync(I18N, 'utf8');
const enBlock = src.slice(src.indexOf('const EN = {'), src.indexOf('const HI = {'));
const defined = [...enBlock.matchAll(/^\s*'([\w.]+)':/gm)].map(m => m[1]);

const files = walk(join(ROOT, 'src')).filter(f => f.endsWith('.js') && !f.includes('i18n.js'));
const body = files.map(f => readFileSync(f, 'utf8')).join('\n');

/* Which suffixes a view genuinely builds onto a stem, e.g. t(s.k + '.t'). */
const STEM = new RegExp(BOUND + 't\\(\\s*[\\w.]+\\s*\\+\\s*[\'"]([.][\\w.]+)[\'"]', 'g');
const stems = new Set([...body.matchAll(STEM)].map(m => m[1]));

const builtFromStem = key => {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return false;
  if (!stems.has(key.slice(dot))) return false;
  /* and the stem must appear as a whole quoted string, never as a substring */
  const stem = key.slice(0, dot).replace(/\./g, '\\.');
  return new RegExp('[\'"`]' + stem + '[\'"`]').test(body);
};

const unused = defined.filter(k =>
  !body.includes("'" + k + "'") && !body.includes('"' + k + '"') && !builtFromStem(k));

const LITERAL = new RegExp(BOUND + 't\\(\\s*[\'"`]', 'g');
const COMPUTED = new RegExp(BOUND + 't\\(\\s*[\\w.]+\\s*\\+', 'g');
const sites = [...body.matchAll(LITERAL)].length + [...body.matchAll(COMPUTED)].length;

const ASKED = new RegExp(BOUND + 't\\(\\s*[\'"]([\\w.]+)[\'"]', 'g');
const asked = new Set([...body.matchAll(ASKED)].map(m => m[1]));
const missing = [...asked].filter(k => !defined.includes(k));

console.log('  i18n: ' + defined.length + ' keys, ' + (defined.length - unused.length)
  + ' rendered, ' + sites + ' render sites');

let bad = 0;
if (unused.length) {
  bad = 1;
  console.log('\n  x DEFINED BUT NEVER RENDERED (' + unused.length + ') — translated for nobody:');
  unused.forEach(k => console.log('      ' + k));
  console.log('    Render it or delete it. A key no screen reads is a translation nobody gets.');
}
if (missing.length) {
  bad = 1;
  console.log('\n  x ASKED FOR BUT NOT DEFINED (' + missing.length + ') — these fall back to the key name:');
  missing.forEach(k => console.log('      ' + k));
}
if (sites < MIN_SITES) {
  bad = 1;
  console.log('\n  x ONLY ' + sites + ' RENDER SITES (floor is ' + MIN_SITES + ').');
  console.log('    A full table on an untranslated app means somebody switching language gets');
  console.log('    a translated tab bar and an English product — worse than English alone.');
  console.log('    Raise coverage, or stop offering the language. See docs/I18N.md.');
}
if (!bad) console.log('  ok every key renders, every asked key exists, coverage is above the floor');
process.exit(bad);
