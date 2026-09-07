/* SAAHAA · functions/_shared/razorpay.ts — the only file that holds the
   secret key in its hands.

   rzp()            an authenticated fetch against https://api.razorpay.com/v1
                    (HTTP Basic: RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET).
   hmacHex()        HMAC-SHA256 with Web Crypto, hex output — used for the
                    checkout signature (order_id|payment_id) and the webhook
                    body.
   timingSafeEqual  constant-time string compare, so a signature check does
                    not leak how many leading bytes matched.

   MUST NEVER: log a secret, put a secret in an error message, return a
   secret to a caller. RazorpayError carries Razorpay's public description
   and code only. */

const API = 'https://api.razorpay.com/v1';

export class RazorpayError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = '') {
    super(message);
    this.name = 'RazorpayError';
    this.status = status;
    this.code = code;
  }
}

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set (supabase secrets set ${name}=…)`);
  return v;
}

/** The PUBLIC key id (rzp_test_… / rzp_live_…). Safe to return to the browser. */
export const keyId = (): string => need('RAZORPAY_KEY_ID');
/** The SECRET. Only ever passed to fetch() and to hmacHex(). */
export const keySecret = (): string => need('RAZORPAY_KEY_SECRET');

export interface RzpInit {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

/** Call the Razorpay REST API. Resolves with the parsed JSON; rejects with RazorpayError on a non-2xx. */
export async function rzp<T = Record<string, unknown>>(path: string, init: RzpInit = {}): Promise<T> {
  const auth = 'Basic ' + btoa(`${keyId()}:${keySecret()}`);
  const res = await fetch(API + path, {
    method: init.method ?? 'GET',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = (data.error ?? {}) as { description?: string; code?: string };
    throw new RazorpayError(err.description || `Razorpay returned ${res.status}`, res.status, err.code ?? '');
  }
  return data as T;
}

/** HMAC-SHA256(message) keyed with `secret`, lower-case hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time equality for two short strings (signatures, tokens). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  // Always walk the full length of `x`; a length mismatch is folded into the
  // result rather than returned early.
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (i < y.length ? y[i] : 0);
  return diff === 0;
}

/** A Razorpay `notes` object: string values, each at most 256 chars, at most 15 keys. */
export function notes(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o).slice(0, 15)) if (v) out[k] = String(v).slice(0, 256);
  return out;
}
