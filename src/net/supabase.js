/* SAAHAA · net/supabase.js — a minimal, zero-dependency Supabase client.

   WHY NOT @supabase/supabase-js?
   Two hard constraints make the official SDK unusable here:
     1. Our CSP is `script-src 'self'` — no CDN script can load.
     2. There is no npm and no bundler in this project, by design.
   The SDK is also ~40 KB gzipped for features we don't use. Supabase's
   PostgREST, GoTrue and Realtime are all plain HTTP/WebSocket, so a focused
   client is about 200 lines and costs nothing.

   The ANON KEY IS PUBLIC BY DESIGN. It identifies the project, it does not
   authorise anything — Row Level Security decides what a caller may read or
   write. The service-role key must NEVER appear in this repo or in a browser.

   Everything money-related goes through rpc() to a SECURITY DEFINER function.
   The client is never trusted to compute or move a rupee. */

import { emit } from '../core/bus.js';

let CFG = { url: '', anonKey: '', schema: 'public' };
let TOKEN = null;          // access token of the signed-in user, if any
let REFRESH = null;
let USER = null;

export function configure({ url, anonKey, schema }) {
  CFG = { url: String(url || '').replace(/\/+$/, ''), anonKey: anonKey || '', schema: schema || 'public' };
  return isConfigured();
}
export const isConfigured = () => !!(CFG.url && CFG.anonKey);
export const currentUser = () => USER;
export const accessToken = () => TOKEN;

function headers(extra = {}) {
  const h = {
    'apikey': CFG.anonKey,
    'Authorization': 'Bearer ' + (TOKEN || CFG.anonKey),
    'Content-Type': 'application/json',
    'Accept-Profile': CFG.schema,
    'Content-Profile': CFG.schema,
    ...extra,
  };
  return h;
}

class SupabaseError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; this.name = 'SupabaseError'; }
}

async function request(path, opts = {}) {
  if (!isConfigured()) throw new SupabaseError('Supabase is not configured', 0, null);
  let res;
  try {
    res = await fetch(CFG.url + path, { ...opts, headers: headers(opts.headers) });
  } catch (netErr) {
    emit('net:offline', { path });
    throw new SupabaseError('Network unreachable', 0, null);
  }
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
  if (!res.ok) {
    const msg = (body && (body.message || body.error_description || body.error || body.hint)) || res.statusText;
    emit('net:error', { path, status: res.status, message: msg });
    throw new SupabaseError(msg, res.status, body);
  }
  emit('net:ok', { path });
  return body;
}

/* ── AUTH (GoTrue) ─────────────────────────────────────────────
   Anonymous sign-in gives every visitor a real, RLS-enforceable identity
   with no SMS cost and no password. The phone number is claimed later as a
   profile field, verified socially rather than by paid SMS. */
export const auth = {
  async signInAnonymously() {
    const out = await request('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ data: { anonymous: true } }),
    });
    return setSession(out);
  },

  async signUpEmail(email, password, data = {}) {
    const out = await request('/auth/v1/signup', {
      method: 'POST', body: JSON.stringify({ email, password, data }),
    });
    return setSession(out);
  },

  async signInEmail(email, password) {
    const out = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    return setSession(out);
  },

  async refresh(refreshToken) {
    const out = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: refreshToken || REFRESH }),
    });
    return setSession(out);
  },

  async getUser() {
    if (!TOKEN) return null;
    USER = await request('/auth/v1/user', { method: 'GET' });
    return USER;
  },

  async signOut() {
    if (TOKEN) { try { await request('/auth/v1/logout', { method: 'POST' }); } catch (e) {} }
    TOKEN = REFRESH = USER = null;
    emit('auth:changed', null);
  },

  restore(session) {
    if (!session || !session.access_token) return null;
    TOKEN = session.access_token; REFRESH = session.refresh_token; USER = session.user || null;
    emit('auth:changed', USER);
    return USER;
  },
};

function setSession(out) {
  if (!out) return null;
  TOKEN = out.access_token || TOKEN;
  REFRESH = out.refresh_token || REFRESH;
  USER = out.user || out;
  emit('auth:changed', USER);
  return { user: USER, access_token: TOKEN, refresh_token: REFRESH, expires_in: out.expires_in };
}

/* ── POSTGREST query builder ───────────────────────────────────
   Deliberately small: select / insert / update / delete with filters,
   ordering and limits. Anything cleverer than this belongs in an RPC. */
export function from(table) {
  const q = { table, params: [], method: 'GET', body: null, hdrs: {} };
  const api = {
    select(cols = '*') { q.params.push(['select', cols]); return api; },
    eq(col, v)   { q.params.push([col, 'eq.' + enc(v)]); return api; },
    neq(col, v)  { q.params.push([col, 'neq.' + enc(v)]); return api; },
    gt(col, v)   { q.params.push([col, 'gt.' + enc(v)]); return api; },
    gte(col, v)  { q.params.push([col, 'gte.' + enc(v)]); return api; },
    lt(col, v)   { q.params.push([col, 'lt.' + enc(v)]); return api; },
    lte(col, v)  { q.params.push([col, 'lte.' + enc(v)]); return api; },
    like(col, v) { q.params.push([col, 'like.' + enc(v)]); return api; },
    ilike(col, v){ q.params.push([col, 'ilike.' + enc(v)]); return api; },
    is(col, v)   { q.params.push([col, 'is.' + enc(v)]); return api; },
    in(col, arr) { q.params.push([col, 'in.(' + arr.map(enc).join(',') + ')']); return api; },
    order(col, { ascending = true } = {}) { q.params.push(['order', `${col}.${ascending ? 'asc' : 'desc'}`]); return api; },
    limit(n)     { q.params.push(['limit', String(n)]); return api; },
    range(a, b)  { q.hdrs.Range = `${a}-${b}`; return api; },
    single()     { q.hdrs.Accept = 'application/vnd.pgrst.object+json'; return api; },

    insert(rows, { upsert = false, onConflict } = {}) {
      q.method = 'POST';
      q.body = JSON.stringify(Array.isArray(rows) ? rows : [rows]);
      q.hdrs.Prefer = 'return=representation' + (upsert ? ',resolution=merge-duplicates' : '');
      if (onConflict) q.params.push(['on_conflict', onConflict]);
      return api;
    },
    update(patch) {
      q.method = 'PATCH'; q.body = JSON.stringify(patch);
      q.hdrs.Prefer = 'return=representation';
      return api;
    },
    delete() { q.method = 'DELETE'; q.hdrs.Prefer = 'return=representation'; return api; },

    then(resolve, reject) { return run().then(resolve, reject); },
  };
  function run() {
    const qs = q.params.map(([k, v]) => `${encodeURIComponent(k)}=${v}`).join('&');
    return request(`/rest/v1/${table}${qs ? '?' + qs : ''}`,
      { method: q.method, body: q.body, headers: q.hdrs });
  }
  return api;
}
const enc = v => encodeURIComponent(v == null ? 'null' : String(v));

/** The ONLY way money moves. Every one of these is a SECURITY DEFINER
    function that re-checks the caller's role and the state machine in SQL. */
export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

/* ── REALTIME (WebSocket, Phoenix protocol) ────────────────────
   Used for: a worker hearing about a new job within a second, and a customer
   watching their order advance. Free tier allows 200 concurrent connections,
   which is far past where this business needs to be before it can pay. */
let ws = null, refCounter = 0, hbTimer = null;
const subs = new Map();     // topic -> { cb, joined }

export function realtimeConnect() {
  if (!isConfigured() || ws) return ws;
  const url = CFG.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' +
              encodeURIComponent(CFG.anonKey) + '&vsn=1.0.0';
  ws = new WebSocket(url);

  ws.onopen = () => {
    emit('realtime:open', {});
    hbTimer = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    for (const topic of subs.keys()) joinTopic(topic);
  };
  ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
    const entry = subs.get(msg.topic);
    if (entry && msg.event && msg.event !== 'phx_reply') {
      try { entry.cb(msg.payload, msg.event); } catch (err) { console.error('[realtime]', err); }
    }
  };
  ws.onclose = () => {
    clearInterval(hbTimer); ws = null;
    emit('realtime:closed', {});
    setTimeout(realtimeConnect, 3000);          // reconnect, subscriptions replay
  };
  ws.onerror = () => emit('realtime:error', {});
  return ws;
}

function send(topic, event, payload) {
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ topic, event, payload, ref: String(++refCounter) }));
  return true;
}

function joinTopic(topic) {
  const cfg = subs.get(topic);
  if (!cfg) return;
  send(topic, 'phx_join', {
    config: {
      postgres_changes: cfg.changes || [],
      broadcast: { self: false },
      presence: { key: '' },
    },
    access_token: TOKEN || CFG.anonKey,
  });
}

/**
 * @param {string} name        channel name, e.g. 'bids:req_123'
 * @param {object} o           { table, event:'INSERT'|'UPDATE'|'*', filter:'id=eq.x', onChange }
 */
export function subscribe(name, o = {}) {
  const topic = 'realtime:' + name;
  subs.set(topic, {
    cb: o.onChange || (() => {}),
    changes: o.table ? [{ event: o.event || '*', schema: CFG.schema, table: o.table, filter: o.filter }] : [],
  });
  realtimeConnect();
  if (ws && ws.readyState === 1) joinTopic(topic);
  return () => { send(topic, 'phx_leave', {}); subs.delete(topic); };
}

export function realtimeClose() {
  if (ws) { try { ws.close(); } catch (e) {} }
  ws = null; subs.clear(); clearInterval(hbTimer);
}

/* ── health ────────────────────────────────────────────────── */
export async function ping() {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  const t0 = performance.now();
  try {
    await request('/rest/v1/', { method: 'GET' });
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, reason: e.message, status: e.status };
  }
}

export { SupabaseError };
