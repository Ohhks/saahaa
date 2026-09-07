/* SAAHAA · functions/_shared/json.ts — JSON in, JSON out.

   The client contract (src/core/gateway.js postJson) is:
     · a 2xx with a JSON body whose `ok` is not false  → success
     · anything else                                    → throws j.error || j.reason
   So every failure here carries {ok:false, error} and a real HTTP status;
   the app shows `error` to the person on the screen. Keep it human, and
   never put a secret, a key id or a stack trace in it. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function fail(error: string, status = 400, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error, ...extra }, status, headers);
}

/** Parse a JSON object body; throws on anything that is not a plain object. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) throw new Error('empty body');
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('body must be a JSON object');
  return v as Record<string, unknown>;
}

/** A trimmed string of at most `max` characters, '' for anything that is not a string. */
export function str(v: unknown, max = 256): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Whole paise between lo and hi inclusive. Rejects floats, strings, NaN. */
export function isPaise(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/* The limits the rail accepts. 1_00_00_000 paise = ₹1,00,000 — above the
   largest single top-up, stake or booking the product can produce today. */
export const MIN_PAISE = 100;
export const MAX_PAISE = 1_00_00_000;

/* The app's own identifiers. `purpose` is one of the gateway's short slugs
   (topup, stake-topup, refund-out, earnings, service, retail …). `key` is a
   customer key — `name|mobile`, lower-cased, so it carries a space and a
   pipe (domain/seed.js) — or a partner id such as `p_ab12…`. It lands in
   Razorpay `notes` unchanged, so the only rule is: printable, ≤ 64 chars. */
export const PURPOSE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
// deno-lint-ignore no-control-regex
export const KEY_RE = /^[^\x00-\x1f\x7f]{0,64}$/;
export const UPI_RE = /^[A-Za-z0-9._-]{1,64}@[A-Za-z][A-Za-z0-9]{1,31}$/;
