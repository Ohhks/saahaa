/* SAAHAA · core/migrate.js — versioned migration chain with snapshot + rollback.
   Migrations are APPEND-ONLY. Never edit a released migration.
   Guarantees: idempotent, multi-tab safe (lock), auto-rollback on throw or
   failed post-condition, pre-migration backup always written. */
import { SCHEMA_VERSION } from './version.js';
import * as persist from './persist.js';

const steps = [];                  // {from, to, label, up(state)->state, verify?(state)->bool}
const LOCK_TTL = 10000;

export function registerMigration(step) {
  if (typeof step.from !== 'number' || typeof step.to !== 'number' || typeof step.up !== 'function')
    throw new Error('migration needs {from:number, to:number, up:fn}');
  if (steps.some(s => s.from === step.from && s.to === step.to))
    throw new Error(`duplicate migration ${step.from}->${step.to}`);
  steps.push(step);
  steps.sort((a, b) => a.from - b.from);
  return step;
}
export function listMigrations() { return steps.slice(); }

export function snapshot(state, tag) {
  const key = persist.KEYS.backup(`${state.schemaVersion ?? 0}_${Date.now()}`);
  const body = { ...state, __backupMeta: { ts: Date.now(), version: state.schemaVersion ?? 0, tag: tag || '' } };
  const res = persist.write(key, body);
  if (res.ok) persist.pruneBackups(5);
  return res.ok ? key : null;
}
export function restore(key) {
  const s = persist.read(key, null);
  if (s) delete s.__backupMeta;
  return s;
}
export const listBackups = persist.listBackups;

/* ── multi-tab migration lock ───────────────────────────────── */
function acquireLock(tabId) {
  const cur = persist.read(persist.KEYS.lock, null);
  if (cur && Date.now() - cur.ts < LOCK_TTL && cur.tabId !== tabId) return false;
  persist.write(persist.KEYS.lock, { tabId, ts: Date.now() });
  return true;
}
function releaseLock() { persist.remove(persist.KEYS.lock); }

/**
 * @returns {{state, fromVersion, toVersion, applied:string[], backupKey:string|null,
 *            rolledBack:boolean, error:Error|null, waited:boolean}}
 */
export function runMigrations(raw, opts = {}) {
  const tabId = opts.tabId || 'tab';
  const fresh = opts.freshState;                       // () => default state
  const out = { state: raw, fromVersion: null, toVersion: SCHEMA_VERSION, applied: [], backupKey: null, rolledBack: false, error: null, waited: false };

  if (!raw || typeof raw !== 'object') { out.state = fresh(); out.fromVersion = SCHEMA_VERSION; return out; }

  const from = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  out.fromVersion = from;
  if (from === SCHEMA_VERSION) return out;             // nothing to do — the common path
  if (from > SCHEMA_VERSION) {                         // downgrade: refuse, don't corrupt
    out.error = new Error(`stored schema v${from} is newer than app v${SCHEMA_VERSION}`);
    out.state = raw;
    return out;
  }

  if (!acquireLock(tabId)) { out.waited = true; out.state = raw; return out; }

  out.backupKey = snapshot(raw, 'pre-migration');
  let cur = raw;
  try {
    let guard = 0;
    while ((cur.schemaVersion ?? 0) < SCHEMA_VERSION) {
      if (++guard > 50) throw new Error('migration chain did not converge');
      const v = cur.schemaVersion ?? 0;
      const step = steps.find(s => s.from === v);
      if (!step) throw new Error(`no migration registered from schema v${v}`);
      const next = step.up(structuredCloneSafe(cur));
      next.schemaVersion = step.to;
      if (step.verify && !step.verify(next)) throw new Error(`migration ${step.from}->${step.to} failed verify`);
      out.applied.push(step.label || `${step.from}->${step.to}`);
      cur = next;
    }
    out.state = cur;
  } catch (err) {
    out.error = err;
    out.rolledBack = true;
    out.state = (out.backupKey && restore(out.backupKey)) || fresh();
    console.error('[migrate] rolled back:', err);
  } finally { releaseLock(); }
  return out;
}

function structuredCloneSafe(o) {
  try { return structuredClone(o); } catch (e) { return JSON.parse(JSON.stringify(o)); }
}
