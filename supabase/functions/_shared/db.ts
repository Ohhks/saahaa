/* SAAHAA · functions/_shared/db.ts — the service-role door into Postgres.

   Edge Functions run on Supabase's servers, and Supabase injects
   SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY into their
   environment automatically. The service-role key BYPASSES ROW LEVEL
   SECURITY — it is the database's master key — which is exactly why the
   gateway_* tables (migration 0004) have no write policy at all: the only
   thing that can write them is this code, running here, holding that key.
   The browser never sees it: it is not in the bundle, not in any response,
   and this module never puts it in a log line.

   Plain PostgREST over fetch, no SDK: three verbs are all the rail needs. */

function base(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from the function environment');
  return { url: url.replace(/\/+$/, ''), key };
}

async function call(path: string, init: RequestInit & { prefer?: string }): Promise<Response> {
  const { url, key } = base();
  const headers: Record<string, string> = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(init.prefer ? { 'Prefer': init.prefer } : {}),
  };
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`postgrest ${res.status} on ${path.split('?')[0]}: ${text}`);
  }
  return res;
}

/** INSERT … ON CONFLICT DO NOTHING. Resolves true when the row was new, false on a duplicate. */
export async function insertIgnore(table: string, row: Record<string, unknown>, conflict = 'id'): Promise<boolean> {
  const res = await call(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    body: JSON.stringify([row]),
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

/** INSERT … ON CONFLICT DO UPDATE (every column in `row`). */
export async function upsert(table: string, row: Record<string, unknown>, conflict = 'id'): Promise<void> {
  await call(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    body: JSON.stringify([row]),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/** UPDATE table SET values WHERE <filter>. `filter` is a PostgREST query string, e.g. `payment_id=eq.pay_x&status=neq.captured`. */
export async function patch(table: string, filter: string, values: Record<string, unknown>): Promise<void> {
  await call(`${table}?${filter}`, { method: 'PATCH', body: JSON.stringify(values), prefer: 'return=minimal' });
}

/** SELECT with a PostgREST query string, e.g. `id=eq.<uuid>&select=role,is_banned`. */
export async function select<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  const res = await call(`${table}?${query}`, { method: 'GET' });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows as T[] : [];
}
