/* SAAHAA · tools/lint-dead.mjs — code that exists and never runs.

   This repo's characteristic failure is not bad code. It is UNEXECUTED code,
   and a confident comment sitting on top of it.

     · `checkInvariants` knows the book must balance and no account may go
       negative. It had zero callers, and sat there through four audits while
       two separate bugs drove escrow negative and let a shop be paid more than
       the customer ever paid.
     · `R_REAUTH` — "Final bill — approve", owner: customer — is a declared
       order stage that nothing has ever advanced to, under a comment promising
       the customer approves anything over her estimate.
     · `CANCEL_RULES.WORKER_NO_SHOW` was published on the public refunds page
       for six versions with nothing in the app able to reach it.
     · `.rail` was styled `display:none` while a view still rendered it.

   Every one of those was invisible: no error, no blank screen, no failing test.
   Only a person reading the source ever found them, one audit at a time. This
   is the machine that finds them instead.

   Run: node tools/lint-dead.mjs        (wired into tools/preflight.sh)
   Exits non-zero on a finding. An intentional exception is declared inline in
   the source with a `dead-ok:` comment, so the reason lives next to the code
   rather than in a list here. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const walk = d => {
  let out = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
  }
  return out;
};

const files = walk(SRC).filter(f => f.endsWith('.js'));
const text = new Map(files.map(f => [relative(ROOT, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
const all = [...text.values()].join('\n');
/* everything except the self-test suites — a test is not a caller */
const app = [...text.entries()].filter(([f]) => !/selftests?\./.test(f)).map(([, s]) => s).join('\n');

const findings = [];
const say = (kind, what, where, why) => findings.push({ kind, what, where, why });

/* An exception is declared where the thing lives: `dead-ok: reason`. */
const cssText = ['src/ui/tokens.css', 'src/ui/brand.css']
  .map(f => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
/* the exemption may live in a stylesheet comment too — a hidden class's reason
   belongs next to the rule that hides it, not in a JS file across the repo */
const searchable = all + '\n' + cssText;
const excused = name => new RegExp('dead-ok:[^\\n]*\\b' + name + '\\b').test(searchable)
  || new RegExp('\\b' + name + '\\b[^\\n]*dead-ok:').test(searchable);

/* ── 1 · an exported function nothing outside the tests ever calls ── */
const EXPORTED = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
for (const [file, src] of text) {
  if (/selftests?\./.test(file)) continue;
  for (const m of src.matchAll(EXPORTED)) {
    const name = m[1] || m[2];
    if (!name || excused(name)) continue;
    /* Count EVERY mention of the name across the app. A name that appears
       exactly once — its own declaration — is the `checkInvariants` shape: not
       called, not imported, not referenced as a namespace property, unable to
       run whatever its comment claims.

       Anything less strict than "appears exactly once" produced 44 findings,
       most of them constants and adapters legitimately staged for a rail that
       is not switched on. A lint nobody can trust is ignored, which is the same
       failure as a lint that lies. */
    /* NOTE the lookbehind excludes `$` and word chars but NOT `.` — a call
       through a namespace (`audit.toCSV(…)`) is a use, and excluding the dot
       made every one of those invisible and produced 143 false findings. */
    const mentions = (app.match(new RegExp('(?<![\\w$])' + name + '(?![\\w$])', 'g')) || []).length;
    if (mentions <= 1) {
      say('export', name, file, 'appears exactly once in the whole app — nothing can ever run it');
    }
  }
}

/* ── 2 · an order stage nothing can ever reach ────────────────── */
const orders = text.get('src/domain/orders.js') || '';
const stages = [...orders.matchAll(/\{\s*id:\s*'([A-Z_]+)'/g)].map(m => m[1]);
for (const st of stages) {
  if (excused(st)) continue;
  const reachable = new RegExp("to:\\s*\\[[^\\]]*'" + st + "'").test(orders);   // some stage lists it
  const advanced = new RegExp("advance\\([^)]*'" + st + "'").test(app)
    || new RegExp("'" + st + "'").test(app.replace(orders, ''));                // or a view drives it
  if (!reachable && !advanced) say('stage', st, 'src/domain/orders.js', 'declared and nothing advances to it');
}

/* ── 3 · a class the stylesheet hides while a view still renders it ── */
const css = ['src/ui/tokens.css', 'src/ui/brand.css']
  .map(f => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
const hidden = new Set();
for (const m of css.matchAll(/([.#][\w-]+(?:\s*,\s*[.#][\w-]+)*)\s*\{([^}]*)\}/g)) {
  if (!/display\s*:\s*none/.test(m[2])) continue;
  /* a rule scoped to a parent (`.sheet .grab`) or to print is deliberate */
  if (/@media\s+print/.test(css.slice(Math.max(0, m.index - 400), m.index))) continue;
  for (const sel of m[1].split(',')) {
    const s = sel.trim();
    if (s.startsWith('.') && !s.includes(' ')) hidden.add(s.slice(1));
  }
}
for (const cls of hidden) {
  if (excused(cls)) continue;
  if (!new RegExp('class="[^"]*\\b' + cls + '\\b').test(app)) continue;
  /* A class hidden at one width and shown at another is responsive design, not
     dead code — `.topbar` and `.nav` are each display:none on exactly the width
     where the other one is the navigation. Only a class that is never given a
     display back anywhere has the `.rail` shape, which is the one that silently
     removed a feature. */
  const shownAgain = new RegExp('[.#]' + cls + '[^{}]*\\{[^}]*display\\s*:\\s*(?!none)[\\w-]+').test(css);
  if (!shownAgain) {
    say('css', '.' + cls, 'tokens.css/brand.css', 'display:none everywhere, yet a view still renders it');
  }
}

/* ── report ───────────────────────────────────────────────────── */
console.log('  dead-code: ' + files.length + ' files scanned, ' + findings.length + ' finding(s)');
if (!findings.length) {
  console.log('  ok nothing is declared-and-unreachable');
  process.exit(0);
}
const byKind = { export: 'EXPORTED AND NEVER CALLED', stage: 'STAGE NOTHING CAN REACH', css: 'RENDERED BUT HIDDEN' };
for (const kind of ['stage', 'css', 'export']) {
  const rows = findings.filter(f => f.kind === kind);
  if (!rows.length) continue;
  console.log('\n  x ' + byKind[kind] + ' (' + rows.length + '):');
  rows.forEach(f => console.log('      ' + f.what + '  —  ' + f.where + '\n        ' + f.why));
}
console.log('\n    Wire it up, delete it, or write `dead-ok: <name> — why` next to it.');
console.log('    A promise the code cannot keep is worse than a missing feature.');

/* WHICH FINDINGS STOP A RELEASE.
   Stages and hidden classes are precise: an unreachable stage and a rendered
   class with no display are each a feature the product claims and cannot
   deliver, and both have already cost real bugs (R_REAUTH, `.rail`).

   The orphaned-export check has real signal — it is what would have caught
   `checkInvariants` sitting uncalled through four audits — but it also lists a
   long tail of small utilities and debug helpers that are deliberately kept.
   Failing the build on those would train everybody to ignore the whole lint,
   which is exactly how the last measurement problem started. So it reports and
   does not block, under a budget that may shrink and never grow. */
const BLOCKING = findings.filter(f => f.kind !== 'export');
const ORPHAN_BUDGET = 28;
const orphans = findings.length - BLOCKING.length;
if (orphans > ORPHAN_BUDGET) {
  console.log('\n  x ' + orphans + ' orphaned exports, over the budget of ' + ORPHAN_BUDGET + '.');
  console.log('    Each new one must be wired, deleted or excused — the tail shrinks, it does not grow.');
}
process.exit(BLOCKING.length || orphans > ORPHAN_BUDGET ? 1 : 0);
