/* SAAHAA · core/store.js — single serializable state tree.
   Reducers are pure and registered (Open/Closed); nothing mutates state
   outside a reducer. Migrations, self-tests, snapshots and rollback all
   operate on this one object. */
import * as registry from './registry.js';

export function createStore(rootReducer, preloadedState) {
  let state = preloadedState;
  let prev = state;
  const listeners = new Set();
  const selectors = [];          // {path, fn, last}
  let dispatching = false;
  const history = [];            // bounded action log for diagnostics
  const HIST_MAX = 120;

  function getState() { return state; }

  function dispatch(action) {
    if (!action || !action.type) throw new Error('dispatch: action needs a type');
    if (dispatching) throw new Error(`dispatch: reentrant dispatch of ${action.type}`);
    dispatching = true;
    try { prev = state; state = rootReducer(state, action); }
    finally { dispatching = false; }
    history.push({ type: action.type, ts: Date.now() });
    if (history.length > HIST_MAX) history.shift();
    notify(action);
    return action;
  }

  function notify(action) {
    for (const fn of [...listeners]) {
      try { fn(state, prev, action); } catch (e) { console.error('[store listener]', e); }
    }
    for (const s of selectors) {
      const now = pluck(state, s.path);
      if (now !== s.last) { const was = s.last; s.last = now; try { s.fn(now, was, action); } catch (e) { console.error('[store selector]', s.path, e); } }
    }
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** fires only when the slice at `path` changes identity */
  function select(path, fn) {
    const entry = { path, fn, last: pluck(state, path) };
    selectors.push(entry);
    return () => { const i = selectors.indexOf(entry); if (i >= 0) selectors.splice(i, 1); };
  }

  /** migration / rollback / safe-mode ONLY */
  function replaceState(next, reason) {
    prev = state; state = next;
    history.push({ type: '@@REPLACE:' + (reason || 'unknown'), ts: Date.now() });
    notify({ type: '@@REPLACE', payload: { reason } });
  }

  return { getState, dispatch, subscribe, select, replaceState, actions: () => history.slice() };
}

export function pluck(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Root reducer built from the 'reducer' registry namespace — adding a new
    slice of state means registering a new reducer file, editing nothing. */
export function combineFromRegistry() {
  const entries = registry.all('reducer');   // {id, slice, reduce(sliceState, action, wholeState)}
  return function root(state, action) {
    let changed = false;
    const next = { ...state };
    for (const e of entries) {
      const cur = state[e.slice];
      const out = e.reduce(cur, action, state);
      if (out !== cur) { next[e.slice] = out; changed = true; }
    }
    return changed ? next : state;
  };
}
