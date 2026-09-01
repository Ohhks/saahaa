/* SAAHAA · core/bus.js — pub/sub for side-effects & notifications ONLY.
   State truth lives in the store. UI depends on this abstraction, never on
   BroadcastChannel directly (Dependency Inversion). */
const listeners = new Map();      // event -> Set<fn>
const ring = [];                  // bounded diagnostics buffer
const RING_MAX = 200;

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}
export function off(event, fn) { const s = listeners.get(event); if (s) s.delete(fn); }
export function emit(event, payload) {
  ring.push({ event, ts: Date.now() });
  if (ring.length > RING_MAX) ring.shift();
  const s = listeners.get(event);
  if (!s) return;
  for (const fn of [...s]) {
    try { fn(payload); }
    catch (err) { console.error('[bus]', event, err); emitError(event, err); }
  }
}
function emitError(event, err) {
  const s = listeners.get('bus:error');
  if (s) for (const fn of [...s]) { try { fn({ event, err }); } catch (e) {} }
}
export function recent() { return ring.slice(); }
export function eventNames() { return [...listeners.keys()]; }
