#!/usr/bin/env node
/* SAAHAA · tools/guard-ui.mjs — the engine guard.

   A UI redesign is allowed to change how things LOOK and are LAID OUT. It is
   not allowed to change what things DO. This script makes that rule
   mechanical instead of aspirational, by comparing the working tree with the
   frozen pre-redesign snapshot at ../saahaa02:

     1. ENGINE FROZEN   every file under src/domain, src/core, src/net,
                        supabase, .github and tools (except this file) must be
                        byte-identical to the snapshot. That is the P2P
                        protocol (auction/bidding), the money engine, the
                        state machines, the automations (auto-release, escrow
                        tiering, migrations) and the CI — untouchable.
     2. CONTRACT KEPT   for app.js and every view: the set of data-act names,
                        data-role names, element ids and exported symbols must
                        still be present. Additions are allowed only when the
                        action is registered in app.js wireActions().
     3. TESTS GREEN     tools/test-node.mjs must pass.

   Usage:  node tools/guard-ui.mjs            (exit 1 on any violation)
           node tools/guard-ui.mjs --quiet    (summary only)               */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.resolve(ROOT, '..', 'saahaa02');
const quiet = process.argv.includes('--quiet');
const problems = [];
const notes = [];

if (!fs.existsSync(SNAP)) { console.error(`guard: snapshot missing at ${SNAP}`); process.exit(2); }

/* ── 1. the engine is frozen ─────────────────────────────────── */
const FROZEN = ['src/domain', 'src/core', 'src/net', 'supabase', '.github', 'tools'];
const OWN = new Set(['tools/guard-ui.mjs', 'tools/deck.py', 'tools/shots.py',   // tooling, not engine
                     'src/core/version.js']);                                   // release metadata: every release must change it
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
for (const d of FROZEN) {
  const snapFiles = walk(path.join(SNAP, d)).map(f => path.relative(SNAP, f).replace(/\\/g, '/'));
  const liveFiles = walk(path.join(ROOT, d)).map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
  for (const rel of snapFiles) {
    if (OWN.has(rel)) continue;
    const live = path.join(ROOT, rel);
    if (!fs.existsSync(live)) { problems.push(`ENGINE  deleted: ${rel}`); continue; }
    if (!fs.readFileSync(live).equals(fs.readFileSync(path.join(SNAP, rel)))) problems.push(`ENGINE  modified: ${rel}`);
  }
  for (const rel of liveFiles) {
    if (OWN.has(rel)) continue;
    if (!snapFiles.includes(rel)) problems.push(`ENGINE  new file in frozen area: ${rel}`);
  }
}

/* ── 2. the UI contract is kept ──────────────────────────────── */
const uniq = a => [...new Set(a)];
const grab = (src, re) => uniq([...src.matchAll(re)].map(m => m[1]));
const acts    = s => grab(s, /data-act="([a-zA-Z0-9_.-]+)"/g).concat(grab(s, /data-act='([a-zA-Z0-9_.-]+)'/g))
                     .concat(grab(s, /A\('([a-zA-Z0-9_.-]+)'/g));
const roles   = s => grab(s, /data-role="([a-zA-Z0-9_.-]+)"/g);
const ids     = s => grab(s, /\bid="([a-zA-Z][a-zA-Z0-9_-]*)"/g).filter(i => !/^\$\{/.test(i));
const exportsOf = s => uniq([
  ...grab(s, /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g),
  ...grab(s, /export\s+const\s+([a-zA-Z0-9_]+)/g),
  ...grab(s, /export\s+let\s+([a-zA-Z0-9_]+)/g),
  ...[...s.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
]);

const appLive = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
const registered = new Set(grab(appLive, /A\('([a-zA-Z0-9_.-]+)'/g)
  .concat(...[...appLive.matchAll(/\[((?:'[a-zA-Z0-9_.-]+',?\s*)+)\]\s*\.forEach\(n => A\(n/g)]
    .map(m => m[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean))));

const UI_FILES = ['src/app.js', ...walk(path.join(SNAP, 'src/ui')).map(f => path.relative(SNAP, f).replace(/\\/g, '/')).filter(f => f.endsWith('.js'))];
for (const rel of UI_FILES) {
  const snapP = path.join(SNAP, rel), liveP = path.join(ROOT, rel);
  if (!fs.existsSync(liveP)) { problems.push(`UI      deleted: ${rel}`); continue; }
  const a = fs.readFileSync(snapP, 'utf8'), b = fs.readFileSync(liveP, 'utf8');
  const missing = (label, was, now) => was.filter(x => !now.includes(x)).forEach(x => problems.push(`UI      ${rel}: ${label} "${x}" lost`));
  missing('data-act', acts(a).filter(x => !x.startsWith('A(')), acts(b));
  missing('data-role', roles(a), roles(b));
  missing('id', ids(a), ids(b));
  missing('export', exportsOf(a), exportsOf(b));
  // additions are fine, but only for actions that exist
  for (const x of acts(b)) if (!acts(a).includes(x) && !registered.has(x) && !x.includes('${'))
    problems.push(`UI      ${rel}: new data-act "${x}" has no registered action in app.js`);
  if (a !== b) notes.push(`changed: ${rel}`);
}
// a moved accountView is allowed: the acts must survive somewhere in src/ui
const allLive = walk(path.join(ROOT, 'src/ui')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n') + appLive;
for (const x of acts(fs.readFileSync(path.join(SNAP, 'src/app.js'), 'utf8')).filter(x => !x.startsWith('A(')))
  if (!allLive.includes(`data-act="${x}"`) && !allLive.includes(`'${x}'`)) problems.push(`UI      control "${x}" no longer rendered anywhere`);

/* ── 3. tests ────────────────────────────────────────────────── */
let tests = '';
try { tests = execSync('node tools/test-node.mjs', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { tests = (e.stdout || '') + (e.stderr || ''); problems.push('TESTS   tools/test-node.mjs failed'); }
const summary = (tests.match(/PASS \d+\s+FAIL \d+/) || ['tests: ?'])[0];

/* ── report ──────────────────────────────────────────────────── */
if (!quiet) { for (const n of notes) console.log('  ' + n); }
console.log(`\nguard: engine ${problems.some(p => p.startsWith('ENGINE')) ? 'TOUCHED' : 'frozen'} · contract ${problems.some(p => p.startsWith('UI')) ? 'BROKEN' : 'kept'} · ${summary}`);
if (problems.length) { console.log('\nVIOLATIONS'); problems.forEach(p => console.log('  ✗ ' + p)); process.exit(1); }
console.log('  ✓ no violations');
