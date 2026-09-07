/* SAAHAA · functions/_shared/cors.ts — which browsers may call the rail.

   The app is a static bundle on GitHub Pages (https://ohhks.github.io) and
   a local dev server (http://localhost:8772). Only those origins — or the
   comma-separated list in the ALLOWED_ORIGINS secret — get an
   Access-Control-Allow-Origin header. Everything else gets no CORS header,
   so a browser on a foreign page cannot read the response.

   CORS is a browser courtesy, not an authentication control: curl ignores
   it. Nothing here decides whether a request is ALLOWED to move money; that
   is the Razorpay signature (verify / webhook) and the admin check (payout). */

const DEFAULT_ORIGINS = ['https://ohhks.github.io', 'http://localhost:8772'];

export function allowedOrigins(): string[] {
  const raw = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return raw.length ? raw : DEFAULT_ORIGINS;
}

/** True when the request carries no Origin (curl, server-to-server) or an allowed one. */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  return allowedOrigins().includes(origin.replace(/\/+$/, ''));
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').replace(/\/+$/, '');
  const h: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && allowedOrigins().includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

/** Answer an OPTIONS preflight, or return null so the caller carries on. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
