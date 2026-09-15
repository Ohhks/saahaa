/* SAAHAA · worker-site/index.js — the front door.
 *
 * WHY THIS EXISTS AT ALL, WHEN THE SITE IS STATIC FILES. Until now the browser
 * called the API by its absolute address — https://saahaa-api.<sub>.workers.dev
 * — which is a different origin from the site. Three costs came with that, and
 * a fourth that only showed up in the dashboard:
 *
 *   1. Every call was cross-origin, so the API had to answer CORS preflights
 *      and hand out `access-control-allow-origin: *` to the whole internet.
 *   2. The site's Content-Security-Policy had to name `https://*.workers.dev`,
 *      widening `connect-src` from "this site" to "any Cloudflare subdomain
 *      anybody owns".
 *   3. The address was baked into src/core/config.js, so moving to a custom
 *      domain or changing the workers.dev subdomain silently broke signup.
 *   4. The two Workers had no relationship Cloudflare knew about. The site's
 *      Bindings panel read "No workers bound to this worker", and it was right.
 *
 * A service binding fixes all four. `/api/*` is handed to saahaa-api over
 * Cloudflare's internal RPC — it never leaves their network, never touches DNS
 * and never crosses an origin — and everything else is a file.
 *
 * WHAT THIS MUST NEVER BECOME. It is a router, not a place for logic. The
 * service-role key lives in saahaa-api and nowhere else; if this file ever
 * needs a secret, something has been put in the wrong Worker.
 *
 * A NOTE ON THE FREE TIER. Requests that match a static asset are served by
 * Cloudflare before this code runs, so they stay free and unmetered; only
 * /api/* and genuine misses invoke it. Adding this router did not start
 * charging for the site.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* `/api` exactly, as well as `/api/...`: a bare /api is a mistake worth
       forwarding, because the API answers it with a 404 that names the real
       endpoints — which is more use than this Worker serving it the SPA. */
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return env.API.fetch(request);
    }

    /* Everything else is the site. ASSETS applies not_found_handling, so a
       deep link that is not a file still comes back as the app rather than a
       dead end. */
    return env.ASSETS.fetch(request);
  },
};
