/* SAAHAA · core/selftest.js — the in-app test runner. This IS our CI.
   Run: index.html?selftest=1  ·  or Admin → DevOps → Run self-test.
   A release with failed>0 does not ship. */
import { VERSION } from './version.js';

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, cases: [] };
  suites.push(current);
  try { fn(); } finally { current = null; }
}
export function it(name, fn) {
  if (!current) throw new Error('it() outside describe()');
  current.cases.push({ name, fn });
}

class AssertError extends Error {}
const show = v => { try { return typeof v === 'object' ? JSON.stringify(v) : String(v); } catch (e) { return String(v); } };
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function expect(actual) {
  return {
    toBe(v)        { if (actual !== v) throw new AssertError(`expected ${show(v)}, got ${show(actual)}`); },
    toEqual(v)     { if (!deep(actual, v)) throw new AssertError(`deep-equal failed:\n  expected ${show(v)}\n  got      ${show(actual)}`); },
    toBeCloseTo(v, tol = 0) { if (Math.abs(actual - v) > tol) throw new AssertError(`expected ~${v} (±${tol}), got ${actual}`); },
    toBeTrue()     { if (actual !== true) throw new AssertError(`expected true, got ${show(actual)}`); },
    toBeFalse()    { if (actual !== false) throw new AssertError(`expected false, got ${show(actual)}`); },
    toBeTruthy()   { if (!actual) throw new AssertError(`expected truthy, got ${show(actual)}`); },
    toHaveLength(n){ if (!actual || actual.length !== n) throw new AssertError(`expected length ${n}, got ${actual && actual.length}`); },
    toContain(v)   { if (!actual || !actual.includes(v)) throw new AssertError(`expected to contain ${show(v)}`); },
    toThrow(re)    {
      let threw = false, msg = '';
      try { actual(); } catch (e) { threw = true; msg = e.message; }
      if (!threw) throw new AssertError('expected function to throw');
      if (re && !new RegExp(re).test(msg)) throw new AssertError(`throw message ${show(msg)} !~ ${re}`);
    },
    toSatisfy(pred, label = 'predicate') { if (!pred(actual)) throw new AssertError(`${label} failed for ${show(actual)}`); },
  };
}

export async function runAll({ filter } = {}) {
  const t0 = performance.now();
  const res = { passed: 0, failed: 0, durationMs: 0, failures: [], version: VERSION, suites: [] };
  for (const s of suites) {
    if (filter && !s.name.toLowerCase().includes(String(filter).toLowerCase())) continue;
    const sres = { name: s.name, passed: 0, failed: 0, cases: [] };
    for (const c of s.cases) {
      try { await c.fn(); sres.passed++; res.passed++; sres.cases.push({ name: c.name, ok: true }); }
      catch (err) {
        sres.failed++; res.failed++;
        sres.cases.push({ name: c.name, ok: false, message: err.message });
        res.failures.push({ suite: s.name, case: c.name, message: err.message });
      }
    }
    res.suites.push(sres);
  }
  res.durationMs = Math.round(performance.now() - t0);
  globalThis.__SAAHAA_TEST_RESULT__ = res;
  return res;
}
export function suiteCount() { return suites.length; }
export function caseCount() { return suites.reduce((n, s) => n + s.cases.length, 0); }
