/* SAAHAA · core/registry.js — the Open/Closed seam.
   Add a category / order stage / panel / migration / test by REGISTERING a new
   entry from a NEW file. Never by editing a switch statement.
   Entries are append-only; retire with {deprecated:true}, never delete. */
const ns = new Map();             // namespace -> Map<id, entry>
let frozen = false;

const TOMBSTONE = id => ({ id, label: `Legacy: ${id}`, ico: '❔', deprecated: true, __tombstone: true });

export function register(namespace, entry) {
  if (frozen) throw new Error(`registry frozen — cannot register ${namespace}/${entry && entry.id}`);
  if (!entry || !entry.id) throw new Error(`registry: ${namespace} entry needs an id`);
  if (!ns.has(namespace)) ns.set(namespace, new Map());
  const m = ns.get(namespace);
  if (m.has(entry.id)) throw new Error(`registry: duplicate ${namespace}/${entry.id}`);
  m.set(entry.id, Object.freeze(entry));
  return entry;
}
export function registerAll(namespace, entries) { entries.forEach(e => register(namespace, e)); return entries; }

/** Never throws. Unknown ids return a tombstone so old persisted records
    render a legible chip instead of white-screening the app. */
export function get(namespace, id) {
  const m = ns.get(namespace);
  const hit = m && m.get(id);
  return hit || TOMBSTONE(id);
}
export function find(namespace, id) { const m = ns.get(namespace); return m ? m.get(id) : undefined; }
export function has(namespace, id) { return !!(ns.get(namespace) && ns.get(namespace).has(id)); }
export function all(namespace) { const m = ns.get(namespace); return m ? [...m.values()] : []; }
export function live(namespace) { return all(namespace).filter(e => !e.deprecated); }
export function namespaces() { return [...ns.keys()]; }
export function count(namespace) { return all(namespace).length; }
export function freeze() { frozen = true; }
export function isFrozen() { return frozen; }
/* test-only */
export function __reset() { ns.clear(); frozen = false; }
