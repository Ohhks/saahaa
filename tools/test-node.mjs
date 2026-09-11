#!/usr/bin/env node
/* SAAHAA · tools/test-node.mjs — run the domain suites under plain Node.
   Zero dependencies. Node 20+ only.

   PRINCIPLE: stubs must be HONEST. A stub that lets a broken test pass is
   worse than no test. So:
     · crypto.subtle is NOT stubbed — Node 20 has real WebCrypto. A fake
       digest gives green tests and wrong production hashes.
     · document/window are POISON PILLS that throw on any access. A suite that
       trips one is browser-only BY DEFINITION, not by anyone's judgement.
     · fetch throws. A unit test that silently reaches Supabase will one day
       reach production.

   Usage:  node tools/test-node.mjs            (CI)
           node tools/test-node.mjs --verbose  */

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/* ── environment ──────────────────────────────────────────── */
if (!globalThis.crypto?.subtle?.digest) {
  console.error('FATAL: this runner needs Node 20+ with WebCrypto. Do not stub crypto.');
  process.exit(1);
}

class MemStorage {
  #m = new Map();
  getItem(k) { const v = this.#m.get(String(k)); return v === undefined ? null : v; }
  setItem(k, v) { this.#m.set(String(k), String(v)); }     // real storage coerces; so do we
  removeItem(k) { this.#m.delete(String(k)); }
  clear() { this.#m.clear(); }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  get length() { return this.#m.size; }
}
/* A MONEY HELPER HANDED THE WRONG TOTAL FAILS HERE INSTEAD OF BEING QUIETLY
   REPAIRED AT RENDER TIME. See core/money.js `roundParts`. */
globalThis.__SAAHAA_STRICT = true;
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();

const poison = name => new Proxy({}, {
  get(_, prop) {
    if (typeof prop === 'symbol') return undefined;
    throw new Error(`DOM_ACCESS_IN_NODE_TEST: ${name}.${String(prop)}`);
  },
});
globalThis.document = poison('document');
globalThis.window = new Proxy({
  location: { hash: '', search: '', pathname: '/', href: 'http://localhost/' },
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
}, {
  get(t, p) {
    if (p in t) return t[p];
    throw new Error(`DOM_ACCESS_IN_NODE_TEST: window.${String(p)}`);
  },
});
// Node 22 ships a read-only `navigator`; define over it rather than assigning
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: { userAgent: 'node-selftest', onLine: true, language: 'en-IN' },
});
globalThis.fetch = () => { throw new Error('NETWORK_IN_UNIT_TEST'); };
globalThis.WebSocket = function () { throw new Error('NETWORK_IN_UNIT_TEST'); };
globalThis.alert = globalThis.confirm = globalThis.prompt = () => {
  throw new Error('DOM_ACCESS_IN_NODE_TEST: dialog');
};
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);

/* ── run ──────────────────────────────────────────────────── */
const load = p => import(pathToFileURL(resolve(ROOT, p)).href);

const t0 = performance.now();
let harness, browserOnly = [];

try {
  // registering the catalogs is what populates the registry the suites assert on
  await load('src/domain/catalog.services.js');
  await load('src/domain/catalog.retail.js');
  await load('src/domain/state.js');
  await load('src/core/migrations.js');
  await load('src/core/selftests.js');
  await load('src/core/selftests.money.js');
  await load('src/core/selftests.security.js');
  await load('src/core/selftests.auto.js');
  await load('src/core/selftests.identity.js');
  await load('src/core/selftests.photos.js');
  await load('src/core/selftests.erase.js');
  await load('src/core/selftests.recovery.js');
  await load('src/core/selftests.doorcode.js');
  await load('src/core/selftests.scale.js');
  await load('src/core/selftests.i18n.js');
  harness = await load('src/core/selftest.js');
} catch (err) {
  if (String(err.message).startsWith('DOM_ACCESS_IN_NODE_TEST')) {
    console.error(`\nA domain module touched the DOM at import time: ${err.message}`);
    console.error('Domain modules must be DOM-free. Move that code into src/ui/.\n');
  } else {
    console.error('\nFailed to load the suites:\n', err);
  }
  process.exit(1);
}

const res = await harness.runAll();

for (const s of res.suites) {
  const bad = s.cases.filter(c => !c.ok);
  const dom = bad.filter(c => String(c.message).startsWith('DOM_ACCESS_IN_NODE_TEST'));
  if (dom.length === s.cases.length && s.cases.length) { browserOnly.push(s.name); continue; }
  const mark = s.failed ? 'FAIL' : 'ok  ';
  if (s.failed || VERBOSE) console.log(`${mark} ${s.name}  ${s.passed}/${s.passed + s.failed}`);
  for (const c of bad) console.log(`      · ${c.name}\n        ${c.message}`);
}

const ms = Math.round(performance.now() - t0);
console.log(`\nPASS ${res.passed}  FAIL ${res.failed}  BROWSER-ONLY ${browserOnly.length}  ${ms}ms`);
if (browserOnly.length) console.log(`browser-only suites: ${browserOnly.join(', ')}`);

if (res.failed) {
  console.log('\nA release with any failing test does not ship. Fix, then re-run.');
  process.exit(1);
}
process.exit(0);
