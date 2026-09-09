/* SAAHAA · tools/lint-i18n.mjs — a translated string nobody renders is not a translation.

   The first version of the language layer shipped 53 keys and rendered 24 of
   them. Telugu existed for all seven onboarding steps, for every money word,
   for the door-code errors, and for the note explaining that the trade quiz is
   only in English — and every one of those was dead, because the views printed
   the English source directly. A pro switching to Telugu got two translated
   paragraphs marooned in an English sign-up, which is worse than English.

   The module's own docstring claimed those strings were live. Nothing caught
   it because a dead key breaks nothing: no error, no blank, no warning. This
   is the check that makes it visible.

   Run: node tools/lint-i18n.mjs      (wired into tools/preflight.sh)
   Exits non-zero if a key is defined and never used, or used and never defined. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const I18N = join(ROOT, 'src', 'ui', 'i18n.js');

const walk = d => {
  let out = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
  }
  return out;
};

const src = readFileSync(I18N, 'utf8');

/* the English table is the source of truth for what keys exist */
const enBlock = src.slice(src.indexOf('const EN = {'), src.indexOf('const HI = {'));
const defined = [...enBlock.matchAll(/^\s*'([\w.]+)':/gm)].map(m => m[1]);

/* every other .js file that could render one */
const files = walk(join(ROOT, 'src'))
  .filter(f => f.endsWith('.js') && !f.includes('i18n.js'));

const body = files.map(f => readFileSync(f, 'utf8')).join('\n');

const unused = defined.filter(k => !body.includes(`'${k}'`) && !body.includes(`"${k}"`)
  /* `t(s.k + '.t')` builds a key from a prefix — count the prefix as a use */
  && !(k.includes('.') && body.includes(`'${k.slice(0, k.lastIndexOf('.'))}'`)));

/* keys a view asks for that the table does not have */
const asked = new Set([...body.matchAll(/\bt\(\s*'([\w.]+)'/g)].map(m => m[1]));
const missing = [...asked].filter(k => !defined.includes(k));

const pad = (s, n) => String(s).padEnd(n);
console.log(`  i18n: ${defined.length} keys defined, ${defined.length - unused.length} rendered`);

let bad = 0;
if (unused.length) {
  bad = 1;
  console.log(`\n  ✗ DEFINED BUT NEVER RENDERED (${unused.length}) — translated for nobody:`);
  unused.forEach(k => console.log('      ' + k));
  console.log('    Either render it, or delete it. A key that no screen reads is a promise');
  console.log('    of translation that the person never receives.');
}
if (missing.length) {
  bad = 1;
  console.log(`\n  ✗ ASKED FOR BUT NOT DEFINED (${missing.length}) — these fall back to the key name:`);
  missing.forEach(k => console.log('      ' + k));
}
if (!bad) console.log('  ✓ every key is rendered, and every key a view asks for exists');
process.exit(bad);
