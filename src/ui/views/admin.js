/* SAAHAA · ui/views/admin.js — the admin COMMAND CENTRE, inside the website.
   Sign in with the owner's username (core/adminauth.js · ADMIN_USERNAME) and
   the owner's own password, or open #/admin. No credential is printed here,
   in the markup, or anywhere else in the shipped bundle.

   OPEN CIRCLE · LIVING GLASS.  Same engine, rebuilt experience.

   Eight sections, no more: an admin console with twenty nav items is an
   unused admin console. Each screen still separates what the ADMIN DOES BY
   HAND from what the SYSTEM COMPUTES — the distinction the owner asked for —
   and nothing on any screen is invented: every number is read straight off
   the ledger, the order registry, the aggregate or the health checks.

   The money rule, made visible rather than merely obeyed: customer money,
   escrow, pro payouts, shop payouts, platform fee, GST, rider pool, holdback
   and goodwill are EIGHT DIFFERENT THINGS and never share a number. The Money
   Flow panel on the dashboard exists so that separation is the first thing
   the owner sees, not a footnote. */

import { mount, esc, toast, timeAgo, clockTime } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, dispatch, me } from '../../core/ctx.js';
import { get, live, all as allOf, namespaces, count } from '../../core/registry.js';
import * as adminauth from '../../core/adminauth.js';
import * as audit from '../../core/audit.js';
import * as flags from '../../core/flags.js';
import * as persist from '../../core/persist.js';
import * as migrate from '../../core/migrate.js';
import * as selftest from '../../core/selftest.js';
import { checkHealth } from '../../core/health.js';
import { verifyChain } from '../../core/crypto.js';
import { VERSION, SCHEMA_VERSION, BUILD_ID, CODENAME } from '../../core/version.js';
import * as M from '../../core/money.js';
import { trustScore, tier, ESCROW } from '../../domain/trust.js';
import { stage } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as V from '../../domain/verification.js';
import * as settings from '../../domain/settings.js';
import { quoteService, quoteRetail } from '../../domain/pricing.js';
import { geoOf } from '../../domain/match.js';
import * as gmap from '../map.js';
import { mark } from '../logo.js';

let section = 'dash';
let testResult = null, chainResult = null;
/* FLOW: which role is being watched, and whose journey is open. */
let flowRole = 'all', flowPick = null;
/* MAP: the live Leaflet handle and the element it was built into. */
let mapHandle = null, mapEl = null, mapForce = false;
export const setSection = s => { section = s; };

const SECTIONS = [
  ['dash','Dashboard'], ['approvals','Approvals'], ['escrow','Bookings & escrow'],
  ['disputes','Disputes'], ['people','Users & partners'], ['moderation','Moderation'],
  ['finance','Finance'], ['system','System & audit'],
];

/* ══════════════ shared vocabulary ══════════════ */

const initials = n => (String(n || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0] || '').join('') || '?').toUpperCase();
const avatar = n => `<span class="avatar" aria-hidden="true">${esc(initials(n))}</span>`;

const pill = (text, tone = 'soft', extra = '') =>
  `<span class="pill pill--${tone}${extra ? ' ' + extra : ''}">${esc(text)}</span>`;

const riseOf = i => `rise${i > 1 ? ' rise-' + Math.min(5, i) : ''}`;

/** One computed fact. Huge number, quiet label. `v` is already-formatted. */
const capsule = (k, v, d, tone = 'soft', i = 1) => `<div class="capsule capsule--${tone} ${riseOf(i)}">
  <div class="capsule__k">${esc(k)}</div>
  <div class="capsule__v num">${v}</div>
  ${d ? `<div class="capsule__d">${esc(d)}</div>` : ''}</div>`;

/** A thing that needs a decision: evidence first, then one primary action. */
const cmd = ({ title, sub = '', right = '', facts = '', actions = '', tone = '', i = 1 }) => `
  <div class="cmd glass ${tone} ${riseOf(i)}">
    <div class="between">
      <div class="grow">
        <div class="cmd__title">${title}</div>
        ${sub ? `<div class="cmd__sub">${sub}</div>` : ''}
      </div>
      ${right}
    </div>
    ${facts}
    ${actions ? `<div class="cmd__action">${actions}</div>` : ''}
  </div>`;

const facts = parts => `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">
  ${parts.filter(Boolean).map(p => `<span class="chip--smart">${p}</span>`).join('')}</div>`;

const empty = msg => `<div class="empty--smart"><p class="tiny muted">${esc(msg)}</p></div>`;

const secHead = (title, right = '') =>
  `<div class="hd"><h2 class="h-sec">${esc(title)}</h2>${right}</div>`;

/** THE separation of powers, on every single screen. Never dropped. */
const note = (auto, manual) => `<div class="glass rise" style="margin-bottom:var(--sp-6)">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:var(--sp-6)">
    <div>
      <div class="eyebrow">System computes</div>
      <p class="tiny muted">${esc(auto)}</p>
    </div>
    <div>
      <div class="eyebrow">You do by hand</div>
      <p class="tiny muted">${esc(manual)}</p>
    </div>
  </div></div>`;

/* Escrow release tiering — the label and the temperature both come from the
   domain, so this table never drifts from trust.js. */
const TIER_TONE = { INSTANT:'ok', FAST:'info', STANDARD:'soft', HOLD:'warn', FREEZE:'bad' };
const tierPill = id => {
  const k = id || 'STANDARD';
  const t = ESCROW[k];
  return `<span class="pill pill--${TIER_TONE[k] || 'soft'}" title="${esc(t ? t.label : '')}">${esc(k)}</span>`;
};

/* ══════════════ LOGIN ══════════════ */
export function renderLogin() {
  const g = adminauth.gateStatus();
  return `
  <div class="on-plum" style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div class="glass glass--deep rise" style="width:100%;max-width:380px;text-align:center;padding:32px 24px">
      <div style="display:flex;justify-content:center;margin-bottom:20px">${mark(96, { detail: true })}</div>
      <div class="wordmark display" style="font-size:26px">SAAHAA</div>
      <p class="eyebrow" style="margin:8px 0 26px">ADMIN CONSOLE</p>

      ${g.blocked ? `<div class="glass glass--deep" style="border-color:var(--danger);margin-bottom:16px">
        <b style="color:var(--danger)">${g.reason === 'locked' ? 'Locked' : 'Too many attempts'}</b>
        <p class="tiny muted" style="margin-top:6px">Try again in ${Math.ceil(g.waitMs / 1000)}s.</p></div>` : ''}

      <div class="field"><input id="adUser" placeholder=" " value="${esc(adminauth.ADMIN_USERNAME)}" autocomplete="username"><label>Username</label></div>
      <div class="field"><input id="adPass" type="password" placeholder=" " autocomplete="current-password"><label>Password</label></div>
      <button class="btn btn--primary btn--lg btn--block" data-act="admin.login" ${g.blocked ? 'disabled' : ''}>
        Sign in</button>
      <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="nav.home">← Back to SAAHAA</button>

      <p class="micro muted" style="margin-top:24px;line-height:1.7">
        Owner access only. If you have forgotten the password there is no reset
        from this screen — restore a backup or reinstall.
      </p>
    </div>
  </div>`;
}

export async function doLogin() {
  const u = (document.getElementById('adUser') || {}).value || '';
  const p = (document.getElementById('adPass') || {}).value || '';
  const cred = getState().admin;
  const r = await adminauth.login(u, p, cred);
  if (!r.ok) {
    toast(r.reason === 'locked' ? `Locked — wait ${Math.ceil(r.waitMs / 1000)}s`
        : r.reason === 'backoff' ? `Slow down — ${Math.ceil(r.waitMs / 1000)}s`
        : 'Wrong username or password', 'danger');
    ctx.render(); return;
  }
  toast('Signed in as the owner');
  ctx.render();
}

/* ══════════════ CONSOLE ══════════════ */
export function render() {
  if (!adminauth.isLoggedIn()) return renderLogin();
  adminauth.touch();
  const st = getState();

  /* The header carries the four things that decide whether the owner needs to
     act at all, so the answer is visible before any section is opened. */
  const h = checkHealth(st);
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal).length;
  const queued = V.ownerQueue().length;
  const openD = st.disputes.filter(d => d.status === 'OPEN' && !d.resolvedAt).length;
  const healthy = h.checks.filter(c => c.ok).length;

  /* The map is the only thing on this console that needs a live DOM node, so
     it is built one frame AFTER this string has been mounted. Never inside the
     render path, never blocking it, and never able to break it. */
  scheduleMap();

  return `
  <header class="hdr on-plum" style="border-radius:0 0 var(--r-2xl) var(--r-2xl)">
    <div class="wrap inner">
      ${mark(28, { glow: false })}
      <div class="grow">
        <span class="eyebrow">Admin console</span>
        <b class="h-display" style="display:block;line-height:1.15">SAAHAA</b>
        <span class="micro muted">v${VERSION} “${CODENAME}” · schema v${SCHEMA_VERSION} · ${BUILD_ID}</span>
      </div>
      <button class="btn btn--ghost btn--sm" data-act="admin.logout">Sign out</button>
    </div>
    <div class="wrap" style="margin-top:var(--sp-5)">
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${pill(`${liveOrders} orders in flight`, 'info', 'pill--live')}
        ${pill(`${queued} awaiting you`, queued ? 'warn' : 'soft')}
        ${pill(openD ? `${openD} open disputes` : 'no open disputes', openD ? 'bad' : 'soft')}
        ${pill(`Health ${healthy}/${h.checks.length}`, h.ok ? 'ok' : h.fatal ? 'bad' : 'warn')}
      </div>
    </div>
  </header>
  <main class="wrap">
    ${st.admin.isDemo ? `<div class="glass glass--gold rise" style="margin-top:var(--sp-6)">
      <div class="eyebrow" style="color:var(--warn);display:flex;align-items:center;gap:6px">${icon('warn', { size: 13 })} Bootstrap credential</div>
      <b class="tiny" style="color:var(--warn)">Set your own password before anyone else uses this.</b>
      <p class="tiny muted" style="margin-top:6px;color:var(--warn)">
        This device is still on a bootstrap credential. Set your own password in System &amp; audit
        before anyone else uses this.</p>
    </div>` : ''}

    <nav class="seg" role="tablist" aria-label="Admin sections" style="margin:var(--sp-6) 0">
      ${SECTIONS.map(([k, l]) => `<button class="seg__btn" role="tab"
        aria-pressed="${section === k ? 'true' : 'false'}"
        data-act="admin.sec" data-sec="${k}">${esc(l)}</button>`).join('')}
    </nav>

    ${section === 'dash' ? dash(st)
    : section === 'approvals' ? approvals(st)
    : section === 'escrow' ? escrow(st)
    : section === 'disputes' ? disputes(st)
    : section === 'people' ? people(st)
    : section === 'moderation' ? moderation(st)
    : section === 'finance' ? finance(st)
    : system(st)}
    <div style="height:72px"></div>
  </main>`;
}

/* ── 1. DASHBOARD ─────────────────────────────────────────── */
function dash(st) {
  const a = st.agg;
  const pending = st.users.filter(u => u.role !== 'customer' && u.tier <= 1).length;
  const openD = st.disputes.filter(d => d.status === 'OPEN' && !d.resolvedAt).length;
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal).length;
  return `
  ${note('every number on this screen, live from the ledger and the order registry',
         'nothing — this screen is read-only by design')}

  ${liveMap(st)}

  <div class="capsules">
    ${capsule('Users', st.users.length, `${st.users.filter(u => u.role === 'customer').length} customers`, 'soft', 1)}
    ${capsule('Partners', st.partners.length, `${st.shops.length} shops`, 'soft', 2)}
    ${capsule('Orders', st.orders.length, `${liveOrders} live`, 'info', 3)}
    ${capsule('Revenue', M.fmt(a.revenue), `GST ${M.fmt(a.gst)} collected`, 'gold', 4)}
    ${capsule('GMV', M.fmt(a.gmv), 'paid to pros & shops', 'ok', 5)}
    ${capsule('In escrow', M.fmt(a.escrow), 'locked, not revenue', 'info', 2)}
    ${capsule('Pending approvals', pending, 'partners awaiting tier', pending ? 'warn' : 'soft', 3)}
    ${capsule('Open disputes', openD, openD ? 'action needed' : 'all clear', openD ? 'bad' : 'ok', 4)}
    ${capsule('Customer savings', M.fmt(a.saved), 'vs commission apps', 'gold', 5)}
    ${capsule('Listings', st.products.length, 'products across all shops', 'soft', 5)}
  </div>

  ${moneyFlow(st)}

  <div class="workspace">
    <div class="sec">${secHead('Booking statistics')}
      <div class="glass">${byStage(st)}</div></div>
    <div class="sec">${secHead('Rating statistics')}
      <div class="glass">${ratingStats(st)}</div></div>
  </div>`;
}

/* ── THE LIVE MAP ─────────────────────────────────────────────
   A marketplace is a place before it is a table. Every non-terminal order sits
   at the customer's place, every online pro at theirs, every shop at its own —
   so "is anything actually happening in Kondapur tonight?" is a glance, not a
   query. Read-only: the map never writes, and a map that fails to load must
   never take the console down with it. */
const PIN_ORDER = '#E0B558', PIN_PARTNER = '#7C3AED', PIN_SHOP = '#14B8A6';

const legendDot = (c, label) => `<span class="chip--smart"><span aria-hidden="true"
  style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};margin-right:6px"></span>${esc(label)}</span>`;

function liveMap(st) {
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal);
  const online = st.partners.filter(p => p.online !== false && !p.suspended);
  return `
  <div class="sec">${secHead('Live map', `<button class="more" data-act="admin.map">Refresh</button>`)}
    <div class="glass glass--deep rise">
      <div id="adminMap" style="height:320px;border-radius:var(--r-lg);overflow:hidden;background:var(--border)"></div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:12px">
        ${legendDot(PIN_ORDER, `${liveOrders.length} order(s) in flight`)}
        ${legendDot(PIN_PARTNER, `${online.length} pro(s) online`)}
        ${legendDot(PIN_SHOP, `${st.shops.length} shop(s)`)}
      </div>
      <p class="tiny muted" style="margin-top:10px">
        Tiles from OpenStreetMap. Places come from each order, pro and shop — nothing about a
        customer is sent anywhere to draw this.</p>
    </div></div>`;
}

/* Two people in the same area share one coordinate, so without a deterministic
   nudge the second pin hides under the first for good. */
function jitter(seed, i) {
  let h = i * 2654435761;
  for (let k = 0; k < String(seed).length; k++) h = (h * 31 + String(seed).charCodeAt(k)) | 0;
  return [((h & 255) / 255 - 0.5) * 0.006, (((h >> 8) & 255) / 255 - 0.5) * 0.006];
}

function mapPoints(st) {
  const pts = [];
  const push = (place, seed, i, color, glyph, label) => {
    const g = geoOf(place);
    if (!g) return;
    const [dy, dx] = jitter(seed, i);
    pts.push({ lat: g.lat + dy, lng: g.lng + dx, color, glyph, label });
  };
  st.orders.filter(o => !stage(o.stage).terminal).slice(0, 120).forEach((o, i) =>
    push(o.customerLoc || o.customerArea, o.id, i, PIN_ORDER, o.kind === 'retail' ? 'S' : 'J',
      `${esc(o.customerName || 'Customer')} · ${esc(stage(o.stage).label || o.stage)} · ${M.fmt(o.customerPays)}`));
  st.partners.filter(p => p.online !== false && !p.suspended).slice(0, 120).forEach((p, i) =>
    push(p.loc || p.area, p.id, i, PIN_PARTNER, 'P',
      `${esc(p.name)} · ${esc(get('category', p.cat).name || '')} · ${esc(p.area || '')}`));
  st.shops.slice(0, 80).forEach((s, i) =>
    push(s.loc || s.area, s.id, i, PIN_SHOP, 'K', `${esc(s.name)} · ${esc(s.area || '')}`));
  return pts;
}

function scheduleMap() {
  try {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => { try { buildMap(); } catch (e) { /* never break admin */ } });
  } catch (e) {}
}

function mapFail(el, e) {
  try {
    mount(el, `<div class="empty--smart"><p class="tiny muted">Map unavailable — ${esc(
      (e && e.message) || 'could not load')}. Everything else on this console still works.</p></div>`);
  } catch (_) {}
  mapHandle = null;
}

function buildMap() {
  const el = typeof document !== 'undefined' ? document.getElementById('adminMap') : null;
  if (!el) { mapHandle = null; mapEl = null; return; }
  if (mapEl === el && mapHandle && !mapForce) return;
  if (mapEl !== el && mapHandle) { try { mapHandle.destroy(); } catch (e) {} mapHandle = null; }
  mapEl = el; mapForce = false;
  gmap.ready().then(() => {
    try {
      if (!document.body.contains(el)) return;
      if (!mapHandle) mapHandle = gmap.mapInto(el, { center: [17.4486, 78.3908], zoom: 12 });
      if (!mapHandle) return;
      drawMap(mapHandle);
    } catch (err) { mapFail(el, err); }
  }).catch(err => mapFail(el, err));
}

function drawMap(h) {
  const pts = mapPoints(getState());
  h.clear();
  pts.forEach(p => h.pin(p.lat, p.lng, { color: p.color, glyph: p.glyph, label: p.label }));
  if (pts.length) h.fit(pts.map(p => [p.lat, p.lng]));
  h.invalidate();
}

/* Where the money actually is, in the only shape that cannot lie: the ledger.
   Sums are taken by ACCOUNT PREFIX (ledger.js names every account), so each
   node is one kind of money and one kind only. Read-only derivation — nothing
   here is stored, cached or written back. */
function moneyFlow(st) {
  const led = st.ledger || [];
  const inTo  = pre => led.reduce((n, b) => n + (String(b.partyB || '').startsWith(pre) ? (b.amountPaise | 0) : 0), 0);
  const outOf = pre => led.reduce((n, b) => n + (String(b.partyA || '').startsWith(pre) ? (b.amountPaise | 0) : 0), 0);

  const lockedEver = inTo('ESCROW:');            // CUSTOMER → ESCROW, all time
  const toPartner  = inTo('PARTNER:');           // ESCROW → PARTNER
  const toShop     = inTo('SHOP:');              // ESCROW → SHOP
  const fee        = inTo('PLATFORM:fee');
  const gst        = inTo('PLATFORM:gst');
  const rider      = inTo('RIDER:');
  const holdback   = inTo('HOLDBACK:');
  const goodwill   = outOf('PLATFORM:goodwill'); // funded by us, never by escrow
  const refunded   = led.reduce((n, b) => n + (b.kind === 'REFUND' ? (b.amountPaise | 0) : 0), 0);

  const held = st.agg.escrow | 0;
  const released = toPartner + toShop;
  let pendingOut = 0, availableOut = 0;
  st.orders.forEach(o => {
    const amt = (o.workerPayout || o.shopPayout || 0) | 0;
    if (!o.settledAt || !amt) return;
    if (o.paidOut) availableOut += amt; else pendingOut += amt;
  });

  return `
  <div class="sec">${secHead('Money flow', `<span class="pill pill--live">live</span>`)}
    <div class="glass glass--deep rise">
      <div class="moneyflow">
        <div class="moneyflow__node">
          <div class="eyebrow">Customer</div>
          <div class="num num-xl">${M.fmt(lockedEver)}</div>
          <div class="meta">paid in, all time</div>
        </div>
        <div class="moneyflow__arrow" aria-hidden="true">→</div>
        <div class="moneyflow__node">
          <div class="eyebrow">Escrow</div>
          <div class="num num-xl">${M.fmt(held)}</div>
          <div class="meta">locked right now · not revenue</div>
        </div>
        <div class="moneyflow__arrow" aria-hidden="true">→</div>
        <div class="moneyflow__node">
          <div class="eyebrow">Partner</div>
          <div class="num num-xl">${M.fmt(toPartner)}</div>
          <div class="meta">released to pros</div>
        </div>
        <div class="moneyflow__node">
          <div class="eyebrow">Shop</div>
          <div class="num num-xl">${M.fmt(toShop)}</div>
          <div class="meta">released to shops</div>
        </div>
      </div>

      <div class="eyebrow" style="margin-top:var(--sp-7)">The split — six separate books</div>
      <div class="moneyflow__split">
        ${capsule('Platform fee', M.fmt(fee), 'revenue, net of GST', 'gold', 1)}
        ${capsule('GST', M.fmt(gst), 'owed to government', 'info', 2)}
        ${capsule('Rider pool', M.fmt(rider), 'delivery earnings', 'soft', 3)}
        ${capsule('Holdback', M.fmt(holdback), 'pro reliability stake', 'soft', 4)}
        ${capsule('Goodwill', M.fmt(goodwill), 'credits we fund ourselves', 'warn', 5)}
        ${capsule('Refunded', M.fmt(refunded), 'returned to customers', 'bad', 5)}
      </div>

      <div class="eyebrow" style="margin-top:var(--sp-7)">Where every rupee stands</div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:var(--sp-4)">
        <span class="state--held">Held · ${M.fmt(held)}</span>
        <span class="state--released">Released · ${M.fmt(released)}</span>
        <span class="state--pending">Pending payout · ${M.fmt(pendingOut)}</span>
        <span class="state--available">Available · ${M.fmt(availableOut)}</span>
      </div>
      <p class="tiny muted" style="margin-top:var(--sp-5)">
        Held is escrow this second. Released is what has already left escrow to a pro or a shop.
        Pending is settled but not yet paid out by hand. Available is settled and paid out.
        Four different numbers — never one.</p>
    </div>
  </div>`;
}

function byStage(st) {
  const counts = {};
  st.orders.forEach(o => { counts[o.stage] = (counts[o.stage] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return empty('No orders yet.');
  const max = rows[0][1];
  return rows.map(([s, n]) => `<div style="margin-bottom:10px">
    <div class="between"><span class="tiny">${esc(stage(s).label)}</span><b class="num tiny">${n}</b></div>
    <div style="height:6px;border-radius:3px;background:var(--border);margin-top:4px">
      <div style="height:100%;border-radius:3px;background:var(--gold-grad-soft);width:${(n / max) * 100}%"></div></div>
  </div>`).join('');
}

function ratingStats(st) {
  const all = st.partners.flatMap(p => p.ratings || []);
  if (!all.length) return empty('No ratings yet.');
  const avg = all.reduce((n, r) => n + r.stars, 0) / all.length;
  const dist = [5,4,3,2,1].map(s => [s, all.filter(r => r.stars === s).length]);
  return `<div class="between" style="margin-bottom:14px">
      <div><div class="eyebrow">Average</div><b class="num num-xl">${avg.toFixed(2)}</b></div>
      <span class="meta" style="text-align:right">${all.length} ratings<br>across ${st.partners.length} pros</span></div>
    ${dist.map(([s, n]) => `<div class="between" style="margin-bottom:6px">
      <span class="tiny">${s} ★</span>
      <div style="flex:1;height:6px;border-radius:3px;background:var(--border);margin:0 10px">
        <div style="height:100%;border-radius:3px;background:var(--gold-grad-soft);width:${(n / all.length) * 100}%"></div></div>
      <b class="num tiny" style="width:32px;text-align:right">${n}</b></div>`).join('')}`;
}

/* ── 2. APPROVALS ─────────────────────────────────────────── */
function approvals(st) {
  /* The owner sees ONLY what a machine cannot decide: a background check to
     confirm (tier 3) or a Certified badge to award (tier 4). Everything below
     tier 2 is the partner's own ladder and never lands here. */
  const queue = V.ownerQueue();
  const inProgress = st.partners.filter(p => !V.readiness(p).complete && !p.suspended);
  const shops = st.shops.filter(s => s.status === 'pending');
  return `
  ${note('queue ordering by risk, duplicate detection, price-outlier flags, ban-list prefilter',
         'approve or reject each partner, each shop, each tier upgrade — and every listing you choose to spot-check')}

  <div class="sec">${secHead(`Partner applications · ${queue.length}`)}
    ${queue.length ? queue.map((p, ix) => {
      const t = trustScore(p);
      const v = p.verification || {};
      const bg = v.background || {};
      const next = Math.min(4, (p.tier | 0) + 1);
      const e = V.certifiedEligible(p);
      const evidence = next === 3
        ? `<div class="eyebrow" style="margin-top:12px">Background check requested ${esc(timeAgo(bg.at))}</div>
           ${facts([
             `ID ${esc((v.idType || '').toUpperCase())} …${esc(v.idLast4 || '????')}`,
             `Reference ${esc(bg.refName || '—')} …${esc(bg.refPhone || '')}`,
             'Consent given',
           ])}
           <p class="tiny muted" style="margin-top:8px">Call the reference. Approve only after the call.</p>`
        : `<div class="eyebrow" style="margin-top:12px">Qualifies for Certified</div>
           ${facts([
             `${e.completed} jobs`,
             `rating ${e.avg.toFixed(1)}`,
             `${p.disputesUpheld || 0} upheld disputes`,
           ])}`;
      return cmd({
        i: ix + 1,
        tone: next === 3 ? '' : 'glass--gold',
        title: `${avatar(p.name)} ${esc(p.name)}`,
        sub: `${esc(get('category', p.cat).name)} · ${esc(p.area)} · ${esc(tier(p.tier).label)} · trust ${t.score}`,
        right: pill(t.band.label, t.band.tone),
        facts: evidence,
        actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.approve" data-id="${p.id}" data-tier="${next}">Approve → ${esc(tier(next).label)}</button>
          <button class="btn btn--ghost btn--sm" data-act="admin.suspend" data-id="${p.id}">Suspend</button>`,
      });
    }).join('') : empty('Nothing needs you. Partners verify themselves.')}</div>

  <div class="sec">${secHead(`Self-verifying now · ${inProgress.length}`)}
    ${inProgress.length ? inProgress.map(p => { const r = V.readiness(p); return `<div class="glass" style="padding:11px 14px;margin-bottom:8px">
      <div class="between"><span class="tiny">${avatar(p.name)} ${esc(p.name)} <span class="micro muted">· ${esc(get('category', p.cat).name)}</span></span>
        <span class="meta">${r.pct}% · next: ${esc(r.next ? r.next.title : '—')}</span></div></div>`; }).join('')
      : empty('Nobody mid-way.')}</div>

  <div class="sec">${secHead(`Shop applications · ${shops.length}`)}
    ${shops.length ? shops.map(s => `<div class="glass" style="padding:12px 14px;margin-bottom:8px">
      <div class="between"><span class="tiny">${avatar(s.name)} <b>${esc(s.name)}</b></span>
        ${pill(s.area, 'soft')}</div></div>`).join('')
      : empty('No shops waiting.')}</div>`;
}

/* ── 3. ESCROW ────────────────────────────────────────────── */
function escrow(st) {
  // Retail orders must NOT appear here: releasing one through the SERVICE path
  // posted a Rs.0 release to PARTNER:undefined, decremented escrow, and left
  // the order still settleable by the customer afterwards.
  const held = st.orders.filter(o => o.kind === 'service' && ['WORK_DONE','DISPUTED'].includes(o.stage));
  return `
  ${note('escrow state machine, release tiering (instant / 6h / 24h / hold), release timers, stuck-order detection',
         'force-release, partial release, refund, extend a hold, reassign a pro')}

  <div class="glass glass--gold rise" style="margin-bottom:var(--sp-6)">
    <div class="between">
      <div><div class="eyebrow">Locked in escrow</div>
        <b class="num num-xl">${M.fmt(st.agg.escrow)}</b></div>
      <span class="state--held">Held</span>
    </div>
    <p class="tiny muted" style="margin-top:8px">Customers' money, not revenue. Released only on confirmation or review.</p>
  </div>

  <div class="sec">${secHead(`Awaiting release · ${held.length}`)}
  ${held.length ? held.map((o, ix) => cmd({
    i: ix + 1,
    title: `${esc(o.kind === 'service' ? o.partnerName : o.shopName)} <span class="num">${M.fmt(o.customerPays)}</span>`,
    sub: `${esc(o.customerName)} · ${esc(stage(o.stage).label)} · ${esc(timeAgo(o.stageTs))}`,
    right: tierPill(o.escrowTier),
    facts: facts([
      `${(o.evidence || []).length} photo(s)`,
      o.otpVerified ? 'OTP verified' : 'no OTP',
      esc((ESCROW[o.escrowTier || 'STANDARD'] || {}).label || ''),
    ]),
    actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="1">Release 100%</button>
      <button class="btn btn--secondary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="0.6">Partial 60%</button>`,
  })).join('') : empty('Nothing awaiting release.')}</div>

  ${stuckRetail(st)}`;
}

/* Shop orders that stalled mid-fulfilment. They are deliberately NOT in the
   release list above — releasing one through the service path posted a Rs.0
   transfer to PARTNER:undefined — but leaving them out entirely meant a
   customer's money could be frozen with no way for anyone to free it. The
   only honest remedy when a shop goes dark is to give the money back. */
function stuckRetail(st) {
  const STALE_MS = 45 * 60e3;
  const now = Date.now();
  const stuck = st.orders.filter(o => o.kind === 'retail'
    && ['R_PLACED','R_ACCEPTED','R_PICKING','R_PACKED','R_OUT','R_REAUTH'].includes(o.stage));
  if (!stuck.length) return '';
  const stalled = stuck.filter(o => now - (o.stageTs || 0) > STALE_MS).length;
  return `<div class="sec">${secHead('Shop orders in flight',
      `<span class="pill pill--${stalled ? 'warn' : 'soft'}">${stalled} stalled</span>`)}
    ${stuck.map((o, ix) => {
      const stale = now - (o.stageTs || 0) > STALE_MS;
      return cmd({
        i: ix + 1,
        tone: stale ? 'glass--gold' : '',
        title: `${esc(o.shopName || 'Shop')} <span class="num">${M.fmt(o.customerPays)}</span>`,
        sub: `${esc(o.customerName)} · ${esc(stage(o.stage).label)} · ${esc(timeAgo(o.stageTs))}`,
        right: stale ? pill('stalled', 'warn') : pill('moving', 'soft'),
        facts: stale ? `<p class="tiny muted" style="margin-top:8px;color:var(--warn)">Stalled — the shop has not moved this on.</p>` : '',
        actions: `<button class="btn btn--secondary btn--sm btn--block"
          data-act="admin.refundretail" data-id="${o.id}">Refund the customer in full</button>`,
      });
    }).join('')}</div>`;
}

/* ── 4. DISPUTES ──────────────────────────────────────────── */
function disputes(st) {
  const open = st.disputes.filter(d => d.status === 'OPEN' && !d.resolvedAt);
  return `
  ${note('intake, SLA clock (red past 24h), auto-resolution rules, evidence bundling, auto-escalation at 72h',
         'read the evidence and pick one of three outcomes, with a written reason')}

  <div class="sec">${secHead(`Open disputes · ${open.length}`)}
  ${open.length ? open.map((d, ix) => {
    const o = st.orders.find(x => x.id === d.orderId) || {};
    const ageH = (Date.now() - d.openedAt) / 3600000;
    return cmd({
      i: ix + 1,
      tone: ageH > 24 ? 'glass--gold' : '',
      title: esc(d.reason),
      sub: `${esc(o.customerName || '')} vs ${esc(o.partnerName || o.shopName || '')} · ${esc(timeAgo(d.openedAt))}`,
      right: pill(`${Math.round(ageH)}h`, ageH > 24 ? 'bad' : 'warn'),
      facts: facts([
        `${(o.evidence || []).length} photo(s)`,
        o.otpVerified ? 'start code verified' : 'NO start code',
        o.customerPays != null ? `escrowed ${M.fmt(o.customerPays)}` : '',
      ]),
      actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="release">Release 100%</button>
        <button class="btn btn--secondary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="partial">Partial 60%</button>
        <button class="btn btn--ghost btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="refund">Full refund</button>`,
    });
  }).join('') : empty('No open disputes.')}</div>`;
}

/* ── 5. PEOPLE ────────────────────────────────────────────── */
function people(st) {
  const customers = st.users.filter(u => u.role === 'customer');
  return `
  ${note('trust scores, lifetime stats, earnings ledgers, risk flags, duplicate-account clusters',
         'suspend, ban, promote or demote a tier, waive a strike, adjust a wallet with a reason')}

  ${flowBlock(st)}

  <div class="sec">${secHead(`Pros · ${st.partners.length}`,
      `<span class="avatars">${st.partners.slice(0, 6).map(p => avatar(p.name)).join('')}</span>`)}
    ${st.partners.length ? st.partners.map(p => {
      const t = trustScore(p);
      return `<div class="glass" style="padding:12px 14px;margin-bottom:8px">
        <div class="between">
          ${avatar(p.name)}
          <div class="grow"><b class="tiny">${esc(p.name)}</b>
            <p class="tiny muted">${esc(get('category', p.cat).name)} · ${p.completed} jobs · ${esc(p.area)}</p></div>
          <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
            ${pill(tier(p.tier).label, tier(p.tier).tone)}
            ${pill(`${t.score} · ${t.band.label}`, t.band.tone)}
          </div>
        </div>
        <div class="row" style="margin-top:10px;gap:6px">
          <button class="btn btn--ghost btn--sm" data-act="admin.suspend" data-id="${p.id}">
            ${p.suspended ? 'Unsuspend' : 'Suspend'}</button>
          ${(p.tier | 0) >= 4 ? '<span class="pill pill--gold">Top tier</span>'
            : `<button class="btn btn--ghost btn--sm" data-act="admin.approve" data-id="${p.id}">Promote</button>`}
        </div></div>`;
    }).join('') : empty('No pros yet.')}</div>

  <div class="sec">${secHead(`Customers · ${customers.length}`)}
    ${customers.length ? customers.map(u => `<div class="glass" style="padding:10px 14px;margin-bottom:7px">
      <div class="between">${avatar(u.name)}
        <span class="grow tiny">${esc(u.name)} <span class="micro muted">· ${esc(u.mobile)}</span></span>
        ${pill(u.area, 'soft')}</div></div>`).join('')
      : empty('No customers yet.')}</div>`;
}

/* ── FLOW — track everyone's flow ─────────────────────────────
   The eight sections answer "what needs me?". This answers the other question
   the owner actually asks: "what is each person DOING right now?" One row per
   human — customer, pro, shop owner alike — with where they are, when they
   were last seen, which step they are standing on, and what they have spent or
   earned. Tapping a row unrolls their whole journey: the audit log for that
   actor merged with the stage history of their orders, newest first.

   Nothing here is stored. It is a join over state + the audit log, capped at
   60 rows and 40 events so a busy Saturday never makes the console crawl. */
const ROLE_CHIPS = [['all', 'Everyone'], ['customer', 'Customers'], ['partner', 'Pros'], ['shop', 'Shop owners']];
const ROLE_LABEL = { customer: 'Customer', partner: 'Pro', shop: 'Shop owner' };
const FLOW_ROWS = 60, FLOW_EVENTS = 40;

/* Who an in-flight order is waiting on, in the owner's words. The stage machine
   names an owner for every stage, so a stalled order is always stalled AT
   someone — and the money against it is the escrow it is sitting in. */
const HOLDER = { customer: 'the customer', worker: 'the pro', shop: 'the shop', rider: 'the rider',
                 system: 'SAAHAA (automatic)', admin: 'you (the owner)', either: 'either side' };
function holdOf(o) {
  const sg = stage(o.stage) || {};
  const who = HOLDER[sg.owner] || sg.owner || '—';
  const next = (sg.to || []).map(id => (stage(id) || {}).label || id).slice(0, 2);
  return { stage: sg.label || o.stage, who, money: o.customerPays | 0, next };
}

const detailOf = d => { try { return JSON.stringify(d || {}).slice(0, 80); } catch (e) { return ''; } };

function flowRows(st) {
  /* entries() comes back newest-first, so the first hit per actor is the last
     thing that person did. One pass, not one scan per row. */
  const lastSeen = new Map();
  audit.entries({ limit: 400 }).forEach(e => { if (!lastSeen.has(e.actor)) lastSeen.set(e.actor, e); });

  const byCustomer = new Map(), byPartner = new Map(), byShop = new Map();
  const put = (m, k, o) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(o); };
  st.orders.forEach(o => { put(byCustomer, o.customerKey, o); put(byPartner, o.partnerId, o); put(byShop, o.shopId, o); });

  return st.users
    .filter(u => flowRole === 'all' || u.role === flowRole)
    .map(u => {
      const p = u.role === 'partner' ? st.partners.find(x => x.userKey === u.key || x.id === u.partnerId) : null;
      const sh = u.role === 'shop' ? st.shops.find(x => x.ownerKey === u.key || x.id === u.shopId) : null;
      const mine = (u.role === 'partner' ? byPartner.get(p && p.id)
                  : u.role === 'shop'    ? byShop.get(sh && sh.id)
                  : byCustomer.get(u.key)) || [];
      const orders = mine.slice().sort((a, b) => (b.stageTs || b.createdAt || 0) - (a.stageTs || a.createdAt || 0));
      const latest = orders[0] || null;
      const aud = lastSeen.get(u.key) || null;
      const seen = Math.max(aud ? aud.ts : 0, latest ? (latest.stageTs || 0) : 0,
                            p ? (p.lastActiveTs || 0) : 0, u.createdAt || 0);

      /* The current step is whatever they are standing on: an order stage if
         they have one in flight, otherwise the verification step they stalled
         at, otherwise the last thing the audit log saw them do. */
      let step;
      if (latest) step = stage(latest.stage).label || latest.stage;
      else if (p) { const r = V.readiness(p); step = r.complete ? `Verified · ${tier(p.tier).label}` : (r.next ? r.next.title : 'Verifying'); }
      else if (sh) step = sh.status === 'active' ? 'Shop open' : `Shop ${sh.status}`;
      else step = aud ? aud.action : 'Signed up';

      const spend = orders.reduce((n, o) => n + (o.customerPays | 0), 0);
      const earned = orders.reduce((n, o) => n + (o.settledAt
        ? ((u.role === 'partner' ? o.workerPayout : o.shopPayout) | 0) : 0), 0);
      const place = (u.loc && u.loc.label) || (p && p.area) || (sh && sh.area) || u.area || '—';

      const counts = u.role === 'partner'
        ? `${(p && p.completed) || 0} jobs · earned ${M.fmt(earned)}`
        : u.role === 'shop'
        ? `${orders.length} order(s) · earned ${M.fmt(earned)}`
        : `${orders.length} order(s) · spent ${M.fmt(spend)}`;

      const live = !!(latest && !stage(latest.stage).terminal);
      return { key: u.key, name: u.name, role: u.role, place, step, seen, orders, counts, live, hold: live ? holdOf(latest) : null };
    })
    .sort((a, b) => b.seen - a.seen)
    .slice(0, FLOW_ROWS);
}

function flowTimeline(row) {
  const evs = [];
  audit.entries({ limit: 400 }).forEach(e => {
    if (e.actor === row.key) evs.push({ ts: e.ts, title: e.action, body: detailOf(e.detail) });
  });
  row.orders.forEach(o => (o.history || []).forEach(h => evs.push({
    ts: h.at,
    title: stage(h.stage).label || h.stage,
    body: `${o.kind === 'retail' ? (o.shopName || 'Shop') : (o.partnerName || 'Pro')} · ${M.fmt(o.customerPays)}`,
  })));
  evs.sort((a, b) => b.ts - a.ts);
  const list = evs.slice(0, FLOW_EVENTS);
  if (!list.length) return empty('Nothing recorded for this person yet.');
  return `<ol class="timeline">${list.map(e => `<li class="timeline__item">
    <span class="timeline__dot" aria-hidden="true"></span>
    <div class="timeline__body">
      <div class="between"><b class="micro">${esc(e.title)}</b>
        <span class="timeline__time meta">${esc(clockTime(e.ts))}</span></div>
      <p class="tiny muted">${esc(timeAgo(e.ts))}${e.body ? ' · ' + esc(e.body) : ''}</p>
    </div></li>`).join('')}</ol>
    <p class="micro muted" style="margin-top:8px">${evs.length > FLOW_EVENTS
      ? `Newest ${FLOW_EVENTS} of ${evs.length} events.` : `${evs.length} event(s), newest first.`}</p>`;
}

function flowRow(row, ix) {
  const open = flowPick === row.key;
  return `<div class="glass ${open ? 'glass--gold' : ''} ${riseOf(ix + 1)}" style="padding:0;margin-bottom:8px;overflow:hidden">
    <button class="tap" aria-expanded="${open ? 'true' : 'false'}"
      style="display:block;width:100%;text-align:left;padding:11px 14px;background:none;border:0;color:inherit;cursor:pointer"
      data-act="admin.flow.pick" data-key="${esc(row.key)}">
      <div class="between">
        ${avatar(row.name)}
        <div class="grow"><b class="tiny">${esc(row.name)}</b>
          ${row.live ? '<span class="pill pill--live pill--info">in flight</span>' : ''}
          <p class="tiny muted">${esc(ROLE_LABEL[row.role] || row.role)} · ${esc(row.place)} · ${esc(row.step)}</p>
          ${row.hold ? `<p class="micro" style="margin-top:4px">Held by <b>${esc(row.hold.who)}</b> · ${M.fmt(row.hold.money)} on this order ·
            waiting for ${esc(row.hold.who)}${row.hold.next.length ? ` → ${esc(row.hold.next.join(' / '))}` : ''}</p>` : ''}</div>
        <div style="text-align:right">
          <span class="meta">${esc(row.seen ? timeAgo(row.seen) : 'never')}</span>
          <div class="micro muted" style="margin-top:4px">${esc(row.counts)}</div>
        </div>
      </div>
    </button>
    ${open ? `<div style="padding:0 14px 14px">${flowTimeline(row)}</div>` : ''}
  </div>`;
}

function flowBlock(st) {
  const rows = flowRows(st);
  return `
  <div class="sec">${secHead(`Flow · ${rows.length}`, `<span class="pill pill--live">live</span>`)}
    <p class="tiny muted" style="margin-bottom:12px">
      Everyone on SAAHAA, most recently active first: where they are, what step they are on, and
      what they have spent or earned. Tap a row to unroll that person's whole journey.</p>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">
      ${ROLE_CHIPS.map(([k, l]) => `<button class="btn ${flowRole === k ? 'btn--primary' : 'btn--ghost'} btn--sm"
        aria-pressed="${flowRole === k ? 'true' : 'false'}"
        data-act="admin.flow.filter" data-role="${k}">${esc(l)}</button>`).join('')}
    </div>
    ${rows.length ? rows.map((r, ix) => flowRow(r, ix)).join('')
      : empty(flowRole === 'all' ? 'Nobody has signed up yet.' : 'Nobody in that role yet.')}
    ${rows.length >= FLOW_ROWS ? `<p class="micro muted">Showing the ${FLOW_ROWS} most recently active.</p>` : ''}
  </div>`;
}

/* ── 6. MODERATION ────────────────────────────────────────── */
function moderation(st) {
  const flagged = Object.entries(st.chats).flatMap(([oid, ms]) =>
    ms.filter(m => m.flagged).map(m => ({ ...m, oid })));
  return `
  ${note('profanity, phone-number and payment-ID detection in chat, fake-review burst detection, auto-quarantine',
         'remove or restore a review, action a flagged chat, edit a listing')}

  <div class="sec">${secHead(`Off-platform payment attempts · ${flagged.length}`,
      `<span class="pill pill--${flagged.length ? 'bad' : 'ok'}">${flagged.length ? 'leaking' : 'clean'}</span>`)}
    <p class="tiny muted" style="margin-bottom:12px">
      The single biggest revenue leak in a local marketplace: a pro asking to be paid in cash outside the app.
      Numbers and UPI handles are masked automatically; repeat offences cost trust points.</p>
    ${flagged.length ? flagged.map(m => `<div class="glass" style="padding:11px 14px;margin-bottom:7px">
      <div class="between">${avatar(m.name)}
        <span class="grow tiny">${esc(m.name)}</span>
        <span class="meta">${esc(clockTime(m.ts))}</span></div>
      <p class="tiny muted" style="margin-top:6px">${esc(m.text)}</p></div>`).join('')
      : empty('Nothing flagged.')}</div>

  <div class="sec">${secHead(`Reviews · ${st.reviews.length}`)}
    ${st.reviews.length ? st.reviews.slice(0, 20).map(r => `<div class="glass" style="padding:11px 14px;margin-bottom:7px">
      <div class="between">${avatar(r.byName || r.by || '?')}
        <span class="grow tiny"><b class="num">${r.stars}★</b> ${esc(r.byName || r.by || '')}</span>
        <button class="btn btn--ghost btn--sm" data-act="admin.hidereview" data-id="${r.id}">Hide</button></div></div>`).join('')
      : empty('No reviews yet.')}</div>`;
}

/* ── 7. FINANCE — including the reconciliation screen ─────── */
function finance(st) {
  const a = st.agg;
  const replay = replayLedger(st.ledger);
  const escrowLedger = Object.entries(replay).filter(([k]) => k.startsWith('ESCROW:'))
    .reduce((n, [, v]) => n + v, 0);
  const drift = escrowLedger !== a.escrow;
  return `
  ${note('revenue split per order, GST liability (18% of the fee), payout queue, unit economics',
         'mark a payout batch paid with its UTR, record a manual adjustment with a reason, export the GST report')}

  ${charges()}

  <div class="glass ${drift ? '' : 'glass--gold'} rise" style="${drift ? 'border-color:var(--danger)' : ''}">
    <div class="between">
      <div><div class="eyebrow">Reconciliation</div>
        <b class="h-sec">${drift ? 'Drift' : '✓ balanced'}</b></div>
      ${pill(drift ? 'do not trust this screen' : 'books agree', drift ? 'bad' : 'ok')}
    </div>
    <p class="tiny muted" style="margin:8px 0 12px">
      Escrow held, ledger replay and the aggregate must agree. If they ever don't, everything else on
      this screen is fiction — that is why this box sits at the top.</p>
    <div class="between" style="margin-bottom:6px"><span class="tiny">Aggregate escrow</span><b class="num tiny">${M.fmt(a.escrow)}</b></div>
    <div class="between" style="margin-bottom:6px"><span class="tiny">Ledger replay</span><b class="num tiny">${M.fmt(escrowLedger)}</b></div>
    <div class="between"><span class="tiny">Difference</span>
      <b class="num tiny" style="color:var(--${drift ? 'danger' : 'success'})">${M.fmt(Math.abs(escrowLedger - a.escrow))}</b></div>
  </div>

  <div class="capsules" style="margin-top:var(--sp-6)">
    ${capsule('Platform revenue', M.fmt(a.revenue), 'net of GST', 'gold', 1)}
    ${capsule('GST collected', M.fmt(a.gst), '18% of the fee, remitted', 'info', 2)}
    ${capsule('Refunds', M.fmt(a.refunds), 'returned to customers', 'bad', 3)}
    ${capsule('Ledger blocks', st.chain.length, 'hash-chained', 'soft', 4)}
  </div>

  <div class="sec">${secHead('Payout queue')}
    ${payoutQueue(st)}</div>

  <div class="sec">${secHead('Ledger',
      `<button class="more" data-act="admin.verifychain">Verify chain</button>`)}
    ${chainResult ? `<p class="tiny" style="color:var(--${chainResult.ok ? 'success' : 'danger'});margin-bottom:10px">
      ${chainResult.ok ? `✓ ${st.chain.length} blocks verified` : `✗ broken at block ${chainResult.at} (${chainResult.reason})`}</p>` : ''}
    <details class="expand">
      <summary>Last 30 blocks of ${st.ledger.length}</summary>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:var(--fs-micro)">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px" class="eyebrow">Block</th>
            <th style="text-align:left;padding:6px 8px" class="eyebrow">Kind</th>
            <th style="text-align:left;padding:6px 8px" class="eyebrow">From</th>
            <th style="text-align:left;padding:6px 8px" class="eyebrow">To</th>
            <th style="text-align:right;padding:6px 8px" class="eyebrow">Amount</th>
          </tr></thead>
          <tbody>
          ${st.ledger.slice(-30).reverse().map(b => `<tr style="border-top:1px solid var(--hairline)">
            <td class="num" style="padding:6px 8px">#${b.blockIdx}</td>
            <td style="padding:6px 8px">${esc(b.kind)}</td>
            <td class="muted" style="padding:6px 8px">${esc(b.partyA)}</td>
            <td class="muted" style="padding:6px 8px">${esc(b.partyB)}</td>
            <td class="num" style="padding:6px 8px;text-align:right">${M.fmt(b.amountPaise)}</td>
          </tr>`).join('') || `<tr><td colspan="5" style="padding:10px 8px" class="muted">Empty.</td></tr>`}
          </tbody>
        </table>
      </div>
    </details>
    <button class="btn btn--ghost btn--block" style="margin-top:10px" data-act="admin.exportledger">Export ledger CSV</button>
  </div>`;
}

/* ── CHARGES — the owner's dials ──────────────────────────────
   Three groups, one Push. Everything the company charges anyone lives here and
   nowhere else: the service markup laid on top of the worker's quote, the
   platform take on a shop basket, and the delivery bands. The engine
   (domain/pricing.js) already reads these live, so a push is felt by the very
   next quote — and by no quote already made, because an order snapshots its
   fees at booking. That last sentence is the whole safety property. */

const rup = paise => (Number(paise || 0) / 100);
const rupStr = paise => rup(paise).toFixed(2).replace(/\.00$/, '');

/** One dial: the input, its live value and the launch default beside it. */
const dial = (id, label, value, hint) => `
  <div class="field" style="margin-bottom:4px">
    <input id="${id}" type="number" step="any" inputmode="decimal" placeholder=" " value="${esc(String(value))}">
    <label>${esc(label)}</label>
  </div>
  <p class="micro muted" style="margin:0 0 12px">${hint}</p>`;

const dialHint = (live, def) => `now <b>${esc(live)}</b> · launch default ${esc(def)}`;

const dialGroup = (title, blurb, body) => `
  <div class="glass" style="margin-bottom:10px">
    <div class="eyebrow">${esc(title)}</div>
    <p class="tiny muted" style="margin:4px 0 12px">${esc(blurb)}</p>
    ${body}
  </div>`;

function charges() {
  const P = settings.getPricing();
  const D = settings.DEFAULT_PRICING;
  const bands = P.deliveryBands;
  const dbands = D.deliveryBands;

  /* The worked example is computed from the values that are LIVE right now —
     i.e. what the last Push did — so after the next Push it re-reads itself. */
  const ex = quoteService(100000);
  const exr = quoteRetail([{ qty: 1, unitPrice: 60000 }], { km: 3, mode: 'rider' });

  const bandRow = (i) => {
    const b = bands[i] || bands[bands.length - 1] || { maxKm: 999, fee: 0 };
    const d = dbands[i] || dbands[dbands.length - 1];
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${dial(`pxBand${i}Km`, `Band ${i + 1} · up to km`, b.maxKm, dialHint(`${b.maxKm} km`, `${d.maxKm} km`))}
      ${dial(`pxBand${i}Fee`, `Band ${i + 1} · fee ₹`, rup(b.fee), dialHint(`₹${rupStr(b.fee)}`, `₹${rupStr(d.fee)}`))}
    </div>`;
  };

  return `
  <div class="sec">${secHead('Charges', P.pushedAt
      ? `<span class="pill pill--ok">live since ${esc(timeAgo(P.pushedAt))}</span>`
      : `<span class="pill pill--soft">launch defaults</span>`)}
    <p class="tiny muted" style="margin-bottom:12px">
      Everything SAAHAA charges anybody, in one place. Change a number, press Push, and the very
      next quote uses it. These are the only dials — no other screen can move a rate.</p>

    ${dialGroup('Service', 'Laid on top of the worker’s quote and paid by the customer. The worker keeps 100% of what they quoted.', `
      ${dial('pxService', 'Standard markup %', P.serviceMarkupPct, dialHint(`${P.serviceMarkupPct}%`, `${D.serviceMarkupPct}%`))}
      ${dial('pxLoyalty', 'Certified (tier-4) markup %', P.loyaltyMarkupPct, dialHint(`${P.loyaltyMarkupPct}%`, `${D.loyaltyMarkupPct}%`))}
    `)}

    ${dialGroup('Platform (shops)', 'Taken out of the shop’s own margin, never added to the item price — MRP can never be exceeded.', `
      ${dial('pxRetail', 'Take %', P.retailTakePct, dialHint(`${P.retailTakePct}%`, `${D.retailTakePct}%`))}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${dial('pxRetailCap', 'Cap ₹ per order', rup(P.retailTakeCapPaise), dialHint(`₹${rupStr(P.retailTakeCapPaise)}`, `₹${rupStr(D.retailTakeCapPaise)}`))}
        ${dial('pxRetailFloor', 'Floor ₹ per order', rup(P.retailFeeFloorPaise), dialHint(`₹${rupStr(P.retailFeeFloorPaise)}`, `₹${rupStr(D.retailFeeFloorPaise)}`))}
      </div>
    `)}

    ${dialGroup('Delivery', 'Four distance bands, charged to the customer and paid to the rider, minus our dispatch cut.', `
      ${[0, 1, 2, 3].map(bandRow).join('')}
      ${dial('pxDispatch', 'Dispatch cut ₹ per delivery', rup(P.riderDispatchCutPaise), dialHint(`₹${rupStr(P.riderDispatchCutPaise)}`, `₹${rupStr(D.riderDispatchCutPaise)}`))}
    `)}

    <div class="glass glass--gold rise" style="margin-bottom:10px">
      <div class="eyebrow">Worked example · after push</div>
      <p class="tiny" style="margin-top:6px">
        A <b>₹1,000</b> job: the customer pays <b class="num">${M.fmt(ex.customerPays)}</b> —
        pro keeps ${M.fmt(ex.workerPayout)}, our fee ${M.fmt(ex.platformFee)}, GST ${M.fmt(ex.gst)}
        (markup ${ex.markupPct}%).</p>
      <p class="tiny" style="margin-top:6px">
        A <b>₹600</b> shop basket 3 km away: customer pays <b class="num">${M.fmt(exr.customerPays)}</b>
        (items ${M.fmt(exr.itemsTotal)} + delivery ${M.fmt(exr.deliveryFee)}) — shop keeps
        ${M.fmt(exr.shopPayout)}, rider ${M.fmt(exr.riderPayout)}, we keep
        ${M.fmt(exr.platformRevenue)}.</p>
      <p class="micro muted" style="margin-top:8px">
        These are the numbers as they stand this second. Edit the dials above and press Push to
        move them — the example redraws from whatever was actually pushed.</p>
    </div>

    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn btn--primary grow" data-act="admin.pricing.push">Push</button>
      <button class="btn btn--ghost" data-act="admin.pricing.reset">Reset to defaults</button>
    </div>

    <p class="tiny muted" style="margin-top:10px">
      Last pushed: ${P.pushedAt
        ? `<b>${esc(clockTime(P.pushedAt))}, ${esc(timeAgo(P.pushedAt))}</b> by <b>${esc(P.pushedBy || 'admin')}</b>`
        : '<b>never</b> — these are the launch defaults'}</p>

    <div class="glass" style="margin-top:10px;border-color:var(--warn)">
      <b class="tiny" style="color:var(--warn)">A push never re-prices money already taken.</b>
      <p class="tiny muted" style="margin-top:6px">
        Every order snapshots its own fee, GST, delivery and payout at the moment it is booked.
        Orders already placed — including everything sitting in escrow right now — keep the numbers
        they were booked at, whatever you do on this screen. Only quotes made from the push onwards
        use the new dials.</p>
    </div>
  </div>`;
}

function replayLedger(ledger) {
  const bal = {};
  ledger.forEach(b => {
    bal[b.partyA] = (bal[b.partyA] || 0) - b.amountPaise;
    bal[b.partyB] = (bal[b.partyB] || 0) + b.amountPaise;
  });
  return bal;
}

/* What is owed is decided by "escrow was released and we have not paid it
   out", NOT by the order's current stage. Filtering on stage === 'SETTLED'
   meant a rated job — which now moves on to RATED/CLOSED — silently dropped
   out of the payout queue still unpaid. And with no id on the button, Mark
   paid changed nothing and the row never left the list. */
function payoutQueue(st) {
  const owed = {};
  st.orders
    .filter(o => o.settledAt && !o.paidOut && (o.workerPayout || o.shopPayout))
    .forEach(o => {
      const k = o.kind === 'service' ? (o.partnerName || 'Unknown pro') : (o.shopName || 'Unknown shop');
      if (!owed[k]) owed[k] = { amt: 0, ids: [] };
      owed[k].amt += (o.workerPayout || o.shopPayout || 0);
      owed[k].ids.push(o.id);
    });
  const rows = Object.entries(owed);
  if (!rows.length) return empty('Nothing to pay out yet.');
  const total = rows.reduce((n, [, v]) => n + v.amt, 0);
  return `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="state--pending">Pending payout · ${M.fmt(total)}</span>
      ${pill(`${rows.length} payee(s)`, 'soft')}
    </div>
    ${rows.map(([who, v], ix) => cmd({
      i: ix + 1,
      title: `${avatar(who)} ${esc(who)} <span class="num">${M.fmt(v.amt)}</span>`,
      sub: `${v.ids.length} settled order(s), not yet paid out`,
      right: `<span class="state--pending">Pending</span>`,
      actions: `<button class="btn btn--secondary btn--sm btn--block" data-act="admin.markpaid"
          data-ids="${esc(v.ids.join(','))}">Mark paid</button>`,
    })).join('')}`;
}

/* ── 8. SYSTEM & AUDIT — the DevOps screen ────────────────── */
function system(st) {
  const h = checkHealth(st);
  const backups = migrate.listBackups();
  return `
  ${note('health checks, registry integrity, storage quota, migration history, the audit log',
         'change the admin password, flip feature flags, run the self-test, restore a backup, export everything')}

  <div class="glass glass--deep rise" style="margin-bottom:var(--sp-6)">
    <div class="between">
      <div><div class="eyebrow">Health</div>
        <b class="h-sec">${h.ok ? '✓ all clear' : h.fatal ? '✗ fatal' : 'Degraded'}</b></div>
      ${pill(`${h.checks.filter(c => c.ok).length}/${h.checks.length}`, h.ok ? 'ok' : h.fatal ? 'bad' : 'warn')}
    </div>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:12px">
      ${h.checks.map(c => `<span class="pill pill--${c.ok ? 'ok' : c.fatal ? 'bad' : 'warn'}"
        title="${esc(c.detail)}">${c.ok ? '✓' : '✗'} ${esc(c.id)}</span>`).join('')}
    </div>
    <div style="margin-top:12px">${h.checks.map(c => `<div class="between" style="margin-bottom:5px">
      <span class="micro">${esc(c.id)}</span>
      <span class="meta">${esc(c.detail)}</span></div>`).join('')}</div>
  </div>

  <div class="sec">${secHead('Self-test — this is our CI',
      `<button class="more" data-act="admin.runtests">Run ${selftest.caseCount()} tests</button>`)}
    ${testResult ? `<div class="glass" style="border-color:var(--${testResult.failed ? 'danger' : 'success'})">
      <div class="between">
        <b style="color:var(--${testResult.failed ? 'danger' : 'success'})">
          ${testResult.passed} passed · ${testResult.failed} failed · ${testResult.durationMs}ms</b>
        ${pill(testResult.failed ? 'does not ship' : 'green', testResult.failed ? 'bad' : 'ok')}
      </div>
      ${testResult.failures.length ? testResult.failures.map(f => `<p class="micro" style="margin-top:8px;color:var(--danger)">
        ${esc(f.suite)} › ${esc(f.case)}<br>${esc(f.message)}</p>`).join('')
        : '<p class="tiny muted" style="margin-top:6px">Money math, state transitions, migration idempotence and referential integrity all hold.</p>'}
      <div style="margin-top:12px">${testResult.suites.map(s => `<div class="between" style="margin-bottom:4px">
        <span class="micro">${esc(s.name)}</span>
        <span class="micro ${s.failed ? '' : 'muted'}" style="${s.failed ? 'color:var(--danger)' : ''}">${s.passed}/${s.passed + s.failed}</span>
      </div>`).join('')}</div>
    </div>` : empty('Not run yet this session. A release with any failure does not ship.')}
  </div>

  <div class="sec">${secHead('Feature flags')}
    <p class="tiny muted" style="margin-bottom:12px">
      Every new feature ships default-off for one release. These are the kill-switch and the canary.</p>
    ${flags.all().map(f => `<div class="glass" style="padding:11px 14px;margin-bottom:7px">
      <div class="between"><div class="grow"><b class="tiny">${esc(f.name)}</b>
        <p class="tiny muted">default ${String(f.default)} · source ${esc(f.source)}</p></div>
        <button class="btn ${f.value ? 'btn--primary' : 'btn--ghost'} btn--sm" role="switch"
          aria-checked="${f.value ? 'true' : 'false'}"
          data-act="admin.flag" data-name="${esc(f.name)}">${f.value ? 'ON' : 'OFF'}</button></div></div>`).join('')}
  </div>

  <div class="workspace">
    <div class="sec">${secHead('Registry')}
      <div class="glass">
        ${namespaces().map(ns => `<div class="between" style="margin-bottom:5px">
          <span class="tiny">${esc(ns)}</span><b class="num tiny">${count(ns)}</b></div>`).join('')}
        <p class="tiny muted" style="margin-top:10px">
          Every one of these is an extension point. Adding a category, an order stage, a reducer or a
          migration means registering one more entry — no existing file changes.</p>
      </div>
    </div>

    <div class="sec">${secHead('Backups & migration')}
      <div class="glass">
        <p class="tiny muted" style="margin-bottom:10px">
          A snapshot is written before any migration runs. If a migration throws, it rolls back to that snapshot.</p>
        ${backups.length ? backups.map(b => `<div class="between" style="margin-bottom:6px">
          <span class="micro">v${b.version} · ${esc(timeAgo(b.ts))} · ${(b.bytes / 1024).toFixed(0)} KB</span>
          <button class="btn btn--ghost btn--sm" data-act="admin.restore" data-key="${esc(b.key)}">Restore</button>
        </div>`).join('') : empty('No backups yet.')}
        <div class="row" style="margin-top:12px;gap:8px">
          <button class="btn btn--secondary btn--sm grow" data-act="admin.snapshot">Take snapshot</button>
          <button class="btn btn--secondary btn--sm grow" data-act="admin.export">Export JSON</button>
        </div>
        <p class="tiny muted" style="margin-top:10px">
          Storage used: ${(persist.usageBytes() / 1024).toFixed(0)} KB ·
          migrations registered: ${migrate.listMigrations().length}</p>
      </div>
    </div>
  </div>

  <div class="sec">${secHead('Change admin password')}
    <div class="glass">
      <div class="field"><input id="pwNew" type="password" placeholder=" "><label>New password</label></div>
      <button class="btn btn--primary btn--block" data-act="admin.changepw">Change password</button>
      <p class="tiny muted" style="margin-top:10px">
        Stored as PBKDF2-SHA256, 250,000 iterations, with a random salt. Read docs/SECURITY.md for
        what client-side auth can and cannot protect.</p>
    </div>
  </div>

  <div class="sec">${secHead(`Audit log · ${audit.count()}`,
      `<button class="more" data-act="admin.exportaudit">Export CSV</button>`)}
    <div class="glass" style="max-height:320px;overflow-y:auto">
      ${audit.entries({ limit: 60 }).length ? `<ol class="timeline">
        ${audit.entries({ limit: 60 }).map(e => `<li class="timeline__item">
          <span class="timeline__dot" aria-hidden="true"></span>
          <div class="timeline__body">
            <div class="between"><b class="micro">${esc(e.action)}</b>
              <span class="timeline__time meta">${esc(clockTime(e.ts))}</span></div>
            <p class="tiny muted">${esc(e.actor)} · ${esc(JSON.stringify(e.detail).slice(0, 90))}</p>
          </div></li>`).join('')}
      </ol>` : empty('Empty.')}
    </div>
  </div>`;
}

/* ── handlers ──────────────────────────────────────────────── */
export async function runTests() { testResult = await selftest.runAll(); toast(testResult.failed ? `${testResult.failed} test(s) failed` : 'All tests passed'); ctx.render(); }
export async function doVerifyChain() { chainResult = await verifyChain(getState().ledger); toast(chainResult.ok ? 'Ledger intact' : `Broken at block ${chainResult.at}`); ctx.render(); }
export function toggleFlag(name) { flags.set(name, !flags.get(name)); audit.record(audit.ACTIONS.FLAG_TOGGLE, { name, value: flags.get(name) }, 'admin'); ctx.render(); }
export function approve(id, target) {
  const p = getState().partners.find(x => x.id === id); if (!p) return;
  const t = target ? Number(target) : Math.min(4, (p.tier | 0) + 1);
  // goes through the gate: an admin cannot lift a partner past self-verification
  if (V.approveTier(p, t, 'admin')) toast(`${p.name} → ${tier(t).label}`);
  ctx.render();
}
export function suspend(id) {
  const p = getState().partners.find(x => x.id === id); if (!p) return;
  dispatch({ type: 'partner/patch', payload: { id, patch: { suspended: !p.suspended } } });
  audit.record(audit.ACTIONS.PARTNER_SUSPEND, { id, suspended: !p.suspended }, 'admin');
  toast(p.suspended ? 'Unsuspended' : 'Suspended'); ctx.render();
}
export async function release(id, pct) { await flow.confirmAndRelease(id, Number(pct)); ctx.render(); }
export async function refundRetail(id) { await flow.refundRetail(id); ctx.render(); }
export async function resolve(id, outcome) {
  const d = getState().disputes.find(x => x.id === id); if (!d) return;
  const ord = getState().orders.find(x => x.id === d.orderId);
  // the money moves first; the dispute is marked resolved by the release
  // itself (confirmAndRelease / refundRetail both close the linked dispute)
  // confirmAndRelease bails on a retail order AFTER the dispute has already
  // been flipped to RESOLVED, which is how a shop order ended up marked
  // settled with its money still locked.
  if (ord && ord.kind === 'retail') await flow.refundRetail(d.orderId, 'dispute upheld');
  else if (outcome === 'release') await flow.confirmAndRelease(d.orderId, 1);
  else if (outcome === 'partial') await flow.confirmAndRelease(d.orderId, 0.6);
  else await flow.confirmAndRelease(d.orderId, 0);
  audit.record('dispute.resolved', { id, outcome }, 'admin');
  toast('Dispute resolved'); ctx.render();
}
export function hideReview(id) { dispatch({ type: 'review/hide', payload: { id } }); audit.record(audit.ACTIONS.REVIEW_HIDE, { id }, 'admin'); ctx.render(); }
export function snapshot() { const k = migrate.snapshot(getState(), 'manual'); toast(k ? 'Snapshot saved' : 'Snapshot failed'); ctx.render(); }
export function restore(key) {
  const s = migrate.restore(key); if (!s) { toast('Could not read that backup', 'danger'); return; }
  ctx.store.replaceState(s, 'admin-restore');
  audit.record(audit.ACTIONS.BACKUP_RESTORE, { key }, 'admin');
  toast('Restored'); ctx.render();
}
export function exportJSON() { download('saahaa-backup.json', JSON.stringify(getState(), null, 2)); audit.record(audit.ACTIONS.DATA_EXPORT, { what: 'state' }, 'admin'); }
export function exportAudit() { download('saahaa-audit.csv', audit.toCSV()); }
export function exportLedger() {
  const rows = [['block','kind','from','to','paise','rupees','ts','hash']];
  getState().ledger.forEach(b => rows.push([b.blockIdx, b.kind, b.partyA, b.partyB, b.amountPaise,
    (b.amountPaise / 100).toFixed(2), new Date(b.ts).toISOString(), b.hash]));
  download('saahaa-ledger.csv', rows.map(r => r.join(',')).join('\n'));
}
export async function changePassword() {
  const pw = (document.getElementById('pwNew') || {}).value || '';
  const bad = adminauth.passwordProblem(pw);
  if (bad) { toast(bad, 'danger'); return; }
  const cred = await adminauth.makeCredential(pw);
  dispatch({ type: 'admin/set', payload: { ...cred, isDemo: false } });
  audit.record('admin.password.changed', {}, 'admin');
  toast('Password changed'); ctx.render();
}
/* ── the dials ─────────────────────────────────────────────── */
const fieldVal = id => { const el = typeof document !== 'undefined' ? document.getElementById(id) : null; return el ? String(el.value).trim() : ''; };
/** Rupees in the box, paise in the state. An empty box means "leave it alone". */
const fieldPaise = id => { const v = fieldVal(id); return v === '' ? '' : Math.round(Number(v) * 100); };

export function pushPricing() {
  const bands = [0, 1, 2, 3]
    .map(i => ({ maxKm: Number(fieldVal(`pxBand${i}Km`)), fee: Number(fieldPaise(`pxBand${i}Fee`)) }))
    .filter(b => Number.isFinite(b.maxKm) && b.maxKm > 0 && Number.isFinite(b.fee) && b.fee >= 0);

  const input = {
    serviceMarkupPct:      fieldVal('pxService'),
    loyaltyMarkupPct:      fieldVal('pxLoyalty'),
    retailTakePct:         fieldVal('pxRetail'),
    retailTakeCapPaise:    fieldPaise('pxRetailCap'),
    retailFeeFloorPaise:   fieldPaise('pxRetailFloor'),
    riderDispatchCutPaise: fieldPaise('pxDispatch'),
  };
  if (bands.length) input.deliveryBands = bands;

  const r = settings.pushPricing(input, 'admin');
  if (!r.ok) { toast(r.errors[0] || 'Those numbers do not add up', 'danger'); ctx.render(); return; }
  audit.record('pricing.push', r.clean, 'admin');
  toast('Pushed — every new quote uses these');
  ctx.render();
}

export function resetPricing() {
  const D = settings.DEFAULT_PRICING;
  const r = settings.pushPricing({
    serviceMarkupPct: D.serviceMarkupPct, loyaltyMarkupPct: D.loyaltyMarkupPct,
    retailTakePct: D.retailTakePct, retailTakeCapPaise: D.retailTakeCapPaise,
    retailFeeFloorPaise: D.retailFeeFloorPaise, riderDispatchCutPaise: D.riderDispatchCutPaise,
    deliveryBands: D.deliveryBands.map(b => ({ ...b })),
  }, 'admin');
  if (!r.ok) { toast(r.errors[0] || 'Could not reset', 'danger'); return; }
  audit.record('pricing.reset', r.clean, 'admin');
  toast('Back to the launch defaults');
  ctx.render();
}

/* ── the flow ──────────────────────────────────────────────── */
export function pickFlow(key) { flowPick = (flowPick && flowPick === key) ? null : (key || null); }
export function filterFlow(role) { flowRole = role || 'all'; flowPick = null; }

/* ── the map ───────────────────────────────────────────────── */
export function refreshMap() {
  mapForce = true;
  try { buildMap(); toast('Map refreshed'); }
  catch (e) { toast('Map unavailable', 'danger'); }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
