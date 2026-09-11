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
const MIN_SITES = 510;

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

/* AND THE OTHER SHAPE: a whole FAMILY keyed by an id, `t('cat.' + c.id)`. The
   stem rule above understands `t(x + '.suffix')` — a fixed suffix on a varying
   stem — and this is its mirror: a fixed PREFIX with a varying tail. The 24
   category names are looked up that way, and without this the lint calls every
   one of them "translated for nobody" and the build fails on a family that is
   rendered on four screens at once. */
const PREFIX = new RegExp(BOUND + 't\\(\\s*[\'"]([\\w.]+\\.)[\'"]\\s*\\+', 'g');
/* the accessor for a family lives in i18n.js itself, which `files` deliberately
   excludes — so the prefix scan reads that file too, and only for this */
const prefixes = [...(body + '\n' + src).matchAll(PREFIX)].map(m => m[1]);
const builtFromPrefix = key => prefixes.some(pre => {
  if (!key.startsWith(pre)) return false;
  /* AND THE SAME TIE-DOWN THE STEM RULE NEEDED. An escape hatch matching on the
     prefix alone would pass `cat.zzz` forever: nothing renders it, no category
     has that id, and the lint would call it rendered because some view says
     t('cat.' + c.id) - the identical mistake this file's header describes. The
     tail has to be a REAL id: a whole quoted string somewhere in the tree. */
  const tail = key.slice(pre.length);
  return body.includes("'" + tail + "'") || body.includes('"' + tail + '"');
});

const builtFromStem = key => {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return false;
  if (!stems.has(key.slice(dot))) return false;
  /* and the stem must appear as a whole quoted string, never as a substring */
  const stem = key.slice(0, dot).replace(/\./g, '\\.');
  return new RegExp('[\'"`]' + stem + '[\'"`]').test(body);
};

const unused = defined.filter(k =>
  !body.includes("'" + k + "'") && !body.includes('"' + k + '"') && !builtFromStem(k) && !builtFromPrefix(k));

const LITERAL = new RegExp(BOUND + 't\\(\\s*[\'"`]', 'g');
const COMPUTED = new RegExp(BOUND + 't\\(\\s*[\\w.]+\\s*\\+', 'g');
/* AND THE COVERAGE NUMBER COULD NOT SEE HALF THE APP. `BOUND` exists to stop
   `get(`, `esc(` and `format(` counting as translator calls, and it does that by
   refusing any `t(` preceded by a word character or a DOT -- which also refuses
   every `i18n.t('…')`. `account.js` and `app.js` hold 55 of those between them,
   so adding twenty-seven real render sites to the account screen moved the
   reported total by zero. A namespaced call is unambiguous: `x.t(` is the
   translator and nothing else ends in `.t`. The ratchet was measuring a subset
   of the app and calling it the app. */
const NS_LITERAL = /[\w$]+\.t\(\s*['"`]/g;
const NS_COMPUTED = /[\w$]+\.t\(\s*[\w.]+\s*\+/g;
const sites = [...body.matchAll(LITERAL)].length + [...body.matchAll(COMPUTED)].length
            + [...body.matchAll(NS_LITERAL)].length + [...body.matchAll(NS_COMPUTED)].length;

const ASKED = new RegExp(BOUND + 't\\(\\s*[\'"]([\\w.]+)[\'"]', 'g');
const NS_ASKED = /[\w$]+\.t\(\s*['"]([\w.]+)['"]/g;
const asked = new Set([...body.matchAll(ASKED)].map(m => m[1])
  .concat([...body.matchAll(NS_ASKED)].map(m => m[1])));
/* A KEY ENDING IN A DOT IS A PREFIX, NOT A KEY. `t('leg.' + kind)` makes the
   ASKED scan capture the literal "leg." and then report it as an undefined key.
   It went unnoticed for the `cat.` family only because that accessor lives in
   i18n.js, which this scan deliberately excludes -- so the same shape passed in
   one file and failed in another. */
const missing = [...asked].filter(k => !k.endsWith('.') && !defined.includes(k));

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
/* ── the translator, shadowed ─────────────────────────────────
   `import { t } from '../i18n.js'` at the top, and then four hundred lines
   down, `const t = trustScore(p)`. Every `t('earn.…')` in that scope becomes a
   call on a number, the whole screen throws "t is not a function", and the app
   paints its error page where the partner console should be.

   It is invisible to every other gate. The module parses. The tests pass. The
   build emits. The key exists and this very lint counts its render site as
   rendered — the site is simply reached in a scope where `t` means something
   else. Only opening the screen finds it, which is how it was found.

   A file that imports the translator may not rebind that name. */
/* AND AN ARROW PARAMETER SLIPPED THROUGH. `rows.map(([r, t, s]) => …)` in
   auth.js bound `t` to a label string for the whole of that callback, in a
   file that imports the translator. Nothing inside it translated, so it never
   fired — a trap left armed for whoever edited that map next. The check read
   const/let/var and `function` parameters; arrows and destructuring are how
   most of this codebase is written. */
const SHADOW_DECL = /(?:^|[\s;{(])(?:const|let|var)\s+t\s*=|function\s+\w+\s*\([^)]*(?:^|[\s,(])t\s*[,)]|\(\s*\[[^\]]*(?:^|[\s,[])t\s*[,\]][^)]*\)\s*=>|\(\s*(?:[\w$]+\s*,\s*)*t\s*(?:,\s*[\w$]+\s*)*\)\s*=>/gm;
const IMPORTS_T = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n\.js/;
const shadows = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (!IMPORTS_T.test(text)) continue;
  const rel = f.split(/[\\/]/).slice(-2).join('/');
  for (const m of text.matchAll(SHADOW_DECL)) {
    shadows.push(rel + ':' + text.slice(0, m.index).split('\n').length + '  ' + m[0].trim());
  }
}
if (shadows.length) {
  console.log('\n  x THE TRANSLATOR IS SHADOWED (' + shadows.length + '):');
  shadows.forEach(x => console.log('      ' + x));
  console.log('\n    A file that imports `t` may not rebind that name. Every t() call in that');
  console.log('    scope throws at render time and the screen becomes the error page.');
  process.exit(1);
}
console.log('  ok the translator is not shadowed anywhere it is imported');

/* ── the translator, CALLED and never imported ────────────────
   A ROUND-10 AUDIT SCORED THIS PRODUCT 4/10 BECAUSE OF ONE MISSING LINE.
   `ui/views/ask.js` was translated -- 88 call sites -- and the file never
   imported `t`. Every render of the multi-quote screen threw
   `ReferenceError: t is not defined` and painted the error page. The entire
   "ask several pros for a price" journey, the thing the product sells hardest,
   was dead for every user, with three real quotes stranded behind a link that
   only appears on Home.

   EVERY OTHER GATE PASSED. The module parses -- a free variable is legal
   JavaScript. 301 tests pass; they do not render this view. Six journeys pass;
   they drive the domain, not the DOM. The dist smoke test passes because it
   checks that the HOME shell paints. This lint itself passed, and counted all
   88 sites as coverage.

   The sibling check above catches the opposite mistake -- a file that imports
   `t` and then rebinds the name. This is the same defect from the other side,
   and it is the same shape as the `flags` regression that dead-code check 7
   exists for, except `t` is a bare function rather than a namespace, so that
   check could never see it.

   A file that CALLS the translator must import it. */
const CALLS_T = new RegExp(BOUND + 't\\(\\s*[\'"`\\w]', 'g');
const uncalled = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const hits = [...text.matchAll(CALLS_T)].length;
  if (!hits || IMPORTS_T.test(text)) continue;
  /* A LOCAL `t` INSIDE A FUNCTION DISABLED THIS CHECK FOR THE WHOLE FILE.
     `account.js` has `const t = el.closest(...)` buried in one handler, and that
     single indented line meant nine bare `t(` calls added later were never
     flagged - the screen died with "t is not defined" and only the render gate
     caught it. A module-scope `const t` really is that file's own translator and
     must be skipped; one inside a function is a local that cannot be supplying
     calls elsewhere in the module. */
  if (/^(?:const|let|var|function)\s+t/m.test(text)) continue;
  uncalled.push(f.split(/[\\/]/).slice(-2).join('/') + '  ' + hits + ' call(s)');
}
if (uncalled.length) {
  console.log('\n  x THE TRANSLATOR IS CALLED BUT NEVER IMPORTED (' + uncalled.length + '):');
  uncalled.forEach(x => console.log('      ' + x));
  console.log('\n    Every render of that view throws "t is not defined" and paints the error');
  console.log('    page. The module still parses, the tests still pass, and the bundle still');
  console.log('    builds — only opening the screen finds it. Add the import.');
  process.exit(1);
}
console.log('  ok every view that calls the translator imports it');

/* ── the same key, twice in one table ─────────────────────────
   `shop.payouts` and `shop.settledOrders` were each defined TWICE in all three
   language tables. In an object literal the last one silently wins, so half of
   those definitions were dead the moment they were written -- and a translator
   correcting the copy at the first site would have watched their change do
   nothing, with no error anywhere to explain why.

   It caused no visible bug this time only because the two copies happened to
   hold identical text. That is luck, not design: the failure mode is a
   translation that is present in the file, counted by the check above as
   rendered, and never displayed.

   A key is defined once per table. */
const tableOf = name => {
  const from = src.indexOf('const ' + name + ' = {');
  return from < 0 ? '' : src.slice(from, src.indexOf('\n};', from));
};
const dupes = [];
for (const name of ['EN', 'HI', 'TE']) {
  const seen = new Set(), twice = new Set();
  for (const m of tableOf(name).matchAll(/^\s*'([\w.]+)':/gm)) {
    if (seen.has(m[1])) twice.add(m[1]); else seen.add(m[1]);
  }
  twice.forEach(k => dupes.push(name + '  ' + k));
}
if (dupes.length) {
  console.log('\n  x THE SAME KEY IS DEFINED TWICE (' + dupes.length + '):');
  dupes.forEach(x => console.log('      ' + x));
  console.log('\n    The last definition silently wins, so the earlier one is dead text that');
  console.log('    this lint still counts as rendered. Delete one.');
  process.exit(1);
}
console.log('  ok no key is defined twice in the same table');



if (!bad) console.log('  ok every key renders, every asked key exists, coverage is above the floor');
process.exit(bad);

