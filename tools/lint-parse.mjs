#!/usr/bin/env node
/* SAAHAA · tools/lint-parse.mjs — does every module actually PARSE as a module?

   `node --check file.js` was the syntax gate in this repo, and it does not
   answer that question. With no `"type": "module"` in package.json it parses
   the file as CommonJS FIRST, and a file that is valid CommonJS passes even
   when the ES-module parse fails. That is not hypothetical: a stray backtick
   inside an HTML comment — a comment sitting INSIDE a template literal, where
   a backtick closes the template — took `src/ui/views/orders.js` down. Every
   module returned HTTP 200, `node --check` was silent on all 80 files, the
   build emitted a bundle, and the app was a blank screen.

   This compiles each file with the real ES-module parser, which is the parser
   the browser uses. Nothing is executed: `SourceTextModule` stops at compile.

   Run: node tools/lint-parse.mjs      (wired into tools/preflight.sh) */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = [...walk(join(ROOT, 'src')), join(ROOT, 'tools', 'test-node.mjs')]
  .filter(f => /\.m?js$/.test(f));

const bad = [];
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  try {
    /* compile only — imports are never resolved, nothing runs */
    new vm.SourceTextModule(readFileSync(f, 'utf8'), { identifier: rel });
  } catch (e) {
    bad.push([rel, e.message]);
  }
}

console.log('  parse: ' + files.length + ' modules compiled with the real ES-module parser');
if (!bad.length) { console.log('  ok every module parses as a module'); process.exit(0); }
console.log('\n  x THESE DO NOT PARSE AS MODULES (' + bad.length + '):');
for (const [f, m] of bad) console.log('      ' + f + '\n        ' + m);
console.log('\n    `node --check` cannot see this — it parses these files as CommonJS.');
console.log('    A backtick inside a comment that lives inside a template literal is the usual cause.');
process.exit(1);
