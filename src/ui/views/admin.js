/* SAAHAA · ui/views/admin.js — the admin COMMAND CENTRE, inside the website.
   Sign in with the owner's username (core/adminauth.js · ADMIN_USERNAME) and
   the owner's own password, or open #/admin. No credential is printed here,
   in the markup, or anywhere else in the shipped bundle.

   MODERNIST 8.0.  Same engine, rebuilt experience.

   The console is a desktop dashboard that folds to a phone: an ink header
   strip carrying the identity and the sign-out, the four numbers that decide
   whether the owner needs to act at all as stat blocks, the eight sections as
   one underlined tab row, and every list of things as a table — uppercase
   11px column heads, one-pixel row rules, scrolling inside its own box on a
   narrow screen. Cards carry a 2px top rule; the only red left rule on the
   console is the one on Fresh start.

   Each screen still separates what the ADMIN DOES BY HAND from what the
   SYSTEM COMPUTES — the distinction the owner asked for — and nothing on any
   screen is invented: every number is read straight off the ledger, the order
   registry, the aggregate or the health checks.

   The money rule, made visible rather than merely obeyed: customer money,
   escrow, pro payouts, shop payouts, platform fee, GST, rider pool, holdback
   and goodwill are EIGHT DIFFERENT THINGS and never share a number. The Money
   Flow panel on the dashboard exists so that separation is the first thing
   the owner sees, not a footnote. */

import { mount, esc, toast, timeAgo, clockTime, sheet, closeSheet, delegate, $ } from '../dom.js';
import { icon } from '../icons.js';
import { ctx, getState, dispatch } from '../../core/ctx.js';
import { get, namespaces, count } from '../../core/registry.js';
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
import * as treasury from '../../domain/treasury.js';
import * as recovery from '../../domain/recovery.js';
import * as autoverify from '../../domain/autoverify.js';
import * as fresh from '../../domain/fresh.js';
import * as gateway from '../../core/gateway.js';
import { paymentsConfig, setPaymentsConfig, clearPaymentsConfig } from '../../core/config.js';
import { quoteService, quoteRetail, GST_RATE } from '../../domain/pricing.js';
import { geoOf } from '../../domain/match.js';
import * as ID from '../../domain/identity.js';
import * as gmap from '../map.js';

let section = 'dash';
let testResult = null, chainResult = null;
/* FLOW: which role is being watched, and whose journey is open. */
let flowRole = 'all', flowPick = null;
/* FLOW SEARCH: a name, a mobile, an area — or the account code a caller reads
   out. Purely a filter over rows already computed; it writes nothing. */
let flowQuery = '';
/* MAP: the live Leaflet handle and the element it was built into. */
let mapHandle = null, mapEl = null, mapForce = false;
export const setSection = s => { section = s; };

const SECTIONS = [
  ['dash','Dashboard'], ['approvals','Approvals'], ['escrow','Bookings & escrow'],
  ['disputes','Disputes'], ['people','Users & partners'], ['moderation','Moderation'],
  ['finance','Finance'], ['system','System & audit'],
];

/* ══════════════ the console's own layout rules ══════════════
   Scoped to .ad, built only from the system's tokens. tokens.css owns every
   colour and component; this block only arranges them for a working screen:
   the ink strip, the tab row, the two-column dial grids, the map box. */
const ADMIN_CSS = `<style>
  /* the ink strip is tokens.css's .on-plum — the ONE dark treatment the
     working side uses. This block only gives it its padding, so the sign-out
     button, the muted type and any link inside inherit the strip's own rules
     instead of the light theme's (ink-on-ink was the bug). */
  .ad-hdr{padding:var(--sp-6) 0 var(--sp-5)}
  .ad-hdr .wrap{padding-bottom:0}
  .ad-brand{display:flex;align-items:center;gap:var(--sp-5);flex-wrap:wrap}
  .ad-wm{font:800 18px/1 var(--font-heading);letter-spacing:.02em;white-space:nowrap}
  .ad-wm .sep{color:var(--color-accent-text);margin:0 6px}
  .ad-ver{font-size:11px;letter-spacing:.04em;color:color-mix(in srgb,var(--color-bg) 70%,transparent)}
  .ad-tabs{display:flex;gap:var(--sp-7);overflow-x:auto;scrollbar-width:none;border-bottom:2px solid var(--color-divider);margin:var(--sp-6) 0 0}
  .ad-tabs::-webkit-scrollbar{display:none}
  .ad-tab{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0;font:600 12px/1 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);border-bottom:3px solid transparent;margin-bottom:-2px;white-space:nowrap}
  .ad-tab:hover{color:var(--ink-1)}
  .ad-tab[aria-selected="true"]{color:var(--color-accent-text);border-bottom-color:var(--color-accent)}
  .ad-tab .tag{padding:2px 6px;font-size:10px}
  .ad-note{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--sp-4) var(--sp-8);padding:var(--sp-5) 0;border-bottom:1px solid var(--color-divider)}
  .ad-g2{display:grid;grid-template-columns:minmax(0,1fr);gap:0 var(--sp-6)}
  .ad-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--sp-5);align-items:start}
  .ad-split{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--sp-6);align-items:start}
  @media (min-width:768px){
    .ad-note,.ad-g2,.ad-cards,.ad-split{grid-template-columns:repeat(2,minmax(0,1fr))}
    .ad-cards--3{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media (min-width:1280px){ .ad .wrap{max-width:1280px} }
  .ad .card{border-top:2px solid var(--color-text)}
  .ad .card--gold{border-top-color:var(--color-accent)}
  .ad .card--warn{border-top-color:var(--warn)} .ad .card--bad{border-top-color:var(--danger)} .ad .card--ok{border-top-color:var(--success)}
  .ad .card--red{border-left:3px solid var(--color-accent)}
  .ad .card > .tablewrap,.ad .tablewrap{min-width:0;max-width:100%}
  .ad .table{min-width:100%}
  .ad .table td{vertical-align:middle} .ad .table td.act{white-space:nowrap;text-align:right}
  .ad .table td.nowrap,.ad .table th.nowrap{white-space:nowrap}
  .ad .table .sub{display:block;font-size:11px;color:var(--ink-3);font-weight:400}
  .ad .table tr.on td{background:var(--color-accent-100)}
  :root[data-theme="dark"] .ad .table tr.on td{background:var(--brand-soft)}
  /* a money table's last line: the total, ruled off in ink like the mockup's
     .ad-kv.total was, so the figure that matters is the one you land on */
  .ad .table tr.tot td{border-top:2px solid var(--color-text);border-bottom:0;font-weight:800}
  .ad .table tr.tot:hover td{background:transparent}
  .ad .table tr.detail td{background:var(--surface-2);padding:var(--sp-5)}
  .ad .table tr.detail:hover td{background:var(--surface-2)}
  .ad-rowbtn{display:block;width:100%;text-align:left;padding:0;background:none;border:0;color:inherit;cursor:pointer;font:inherit;min-height:44px}
  .ad-rowbtn b{display:block}
  .ad-mapbox{border:2px solid var(--color-text);background:var(--surface-2)}
  #adminMap{height:320px}
  @media (min-width:1024px){ #adminMap{height:440px} }
  .ad-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;padding:var(--sp-4) var(--sp-5);border-top:2px solid var(--color-text)}
  .ad-dot{display:inline-block;width:10px;height:10px;margin-right:6px;vertical-align:-1px}
  .ad-bar{height:6px;background:var(--color-neutral-300);min-width:80px} .ad-bar i{display:block;height:100%;background:var(--color-accent)}
  .ad-kv{display:flex;justify-content:space-between;gap:var(--sp-5);padding:7px 0;border-bottom:1px solid var(--hairline);font-size:13px}
  .ad-kv.total{border-top:2px solid var(--color-text);border-bottom:0;font-weight:800;margin-top:4px}
  .ad-check{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--hairline);cursor:pointer}
  .ad-check input{width:22px;height:22px;flex:none;accent-color:var(--color-accent);margin:0}
  .ad-actions{display:flex;flex-wrap:wrap;gap:var(--sp-4)} .ad-actions .grow{flex:1 1 150px}
  /* the mockup's segmented switch, scrolling inside its own box on a phone
     rather than widening the page */
  .ad-segwrap{overflow-x:auto;scrollbar-width:none;margin-bottom:var(--sp-5)}
  .ad-segwrap::-webkit-scrollbar{display:none}
  /* tokens.css gives .seg__btn 40px; the console keeps the 44px touch target */
  .ad .seg__btn{min-height:44px}
  .ad-fields .field{margin-bottom:var(--sp-4)} .ad-hint{margin:-2px 0 var(--sp-5);font-size:11px;color:var(--ink-3)}
  .ad-facts{display:flex;flex-wrap:wrap;gap:6px}
  .ad-login{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg)}
  .ad-login .card{width:100%;max-width:400px;padding:var(--sp-8) var(--sp-7)}
  .ad-kpis{margin-top:calc(-1 * var(--sp-6))}
  .ad .hd{margin:var(--sp-7) 0 var(--sp-5)}
  .ad .sec + .sec{margin-top:var(--sp-5)}
  .ad .empty{padding:var(--sp-6)}
</style>`;

/* ══════════════ shared vocabulary ══════════════ */

const initials = n => (String(n || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0] || '').join('') || '?').toUpperCase();
const avatar = n => `<span class="avatar avatar--sm" aria-hidden="true">${esc(initials(n))}</span>`;

const pill = (text, tone = 'soft', extra = '') =>
  `<span class="pill pill--${tone}${extra ? ' ' + extra : ''}">${esc(text)}</span>`;

/** One computed fact. Big number, quiet label, a 2px rule on top. `v` is already-formatted. */
const capsule = (k, v, d, tone = 'soft') => `<div class="capsule capsule--${tone}">
  <div class="capsule__k">${esc(k)}</div>
  <div class="capsule__v num">${v}</div>
  ${d ? `<div class="capsule__d">${esc(d)}</div>` : ''}</div>`;

/** A thing that needs a decision: evidence first, then one primary action. */
const cmd = ({ title, sub = '', right = '', facts = '', actions = '', tone = '' }) => `
  <div class="card ${tone}">
    <div class="between" style="align-items:flex-start">
      <div class="grow">
        <div class="card-title">${title}</div>
        ${sub ? `<div class="card-meta">${sub}</div>` : ''}
      </div>
      ${right}
    </div>
    ${facts}
    ${actions ? `<div class="ad-actions">${actions}</div>` : ''}
  </div>`;

const facts = parts => `<div class="ad-facts">
  ${parts.filter(Boolean).map(p => `<span class="chip chip--smart">${p}</span>`).join('')}</div>`;

const empty = msg => `<div class="empty"><p class="tiny muted">${esc(msg)}</p></div>`;

/* ── the account code, on every row that names a person ────────
   C20262001 / P20262001 / S20262001 is what the caller reads out. It is not a
   secret, so it is printed whole; an account too old to carry one shows an
   em dash rather than an empty cell the owner has to interpret. */
const codeOf = u => (u && ID.isCode(u.code)) ? ID.normaliseCode(u.code) : '';
const codeCell = u => { const c = codeOf(u); return c ? `<b class="num">${esc(c)}</b>` : '<span class="muted">—</span>'; };
/** partner row -> the user account behind it */
const userOfPartner = (st, p) => st.users.find(u => u.key === p.userKey)
  || st.users.find(u => u.partnerId === p.id) || null;

const secHead = (title, right = '') =>
  `<div class="hd"><h2 class="h-sec">${esc(title)}</h2>${right}</div>`;

/** The table every list on this console is drawn as. `cols` are the heads
    (a string, or [label, 'num'] for a right-aligned column); `rows` are
    ready-made <tr>s. Scrolls inside .tablewrap on a narrow screen. */
const table = (cols, rows, emptyMsg = 'Nothing here.') => rows
  ? `<div class="tablewrap"><table class="table">
      <thead><tr>${cols.map(c => Array.isArray(c)
        ? `<th class="${c[1] || ''}">${esc(c[0])}</th>` : `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>`
  : empty(emptyMsg);

/** THE separation of powers, on every single screen. Never dropped. */
const note = (auto, manual) => `<div class="ad-note">
    <div>
      <div class="eyebrow">System computes</div>
      <p class="tiny muted">${esc(auto)}</p>
    </div>
    <div>
      <div class="eyebrow em">You do by hand</div>
      <p class="tiny muted">${esc(manual)}</p>
    </div>
  </div>`;

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
  return `${ADMIN_CSS}
  <div class="ad ad-login">
    <div class="card rise">
      <div class="wordmark" style="font-size:26px">SAAHAA</div>
      <div class="eyebrow em" style="margin-bottom:var(--sp-6)">Owner console</div>

      ${g.blocked ? `<div class="card card--bad" style="margin-bottom:var(--sp-5)">
        <b style="color:var(--danger)">${g.reason === 'locked' ? 'Locked' : 'Too many attempts'}</b>
        <p class="tiny muted">Try again in ${Math.ceil(g.waitMs / 1000)}s.</p></div>` : ''}

      <div class="field"><input id="adUser" placeholder=" " value="${esc(adminauth.ADMIN_USERNAME)}" autocomplete="username"><label>Username</label></div>
      <div class="field"><input id="adPass" type="password" placeholder=" " autocomplete="current-password"><label>Password</label></div>
      <button class="btn btn--primary btn--lg btn--block" data-act="admin.login" ${g.blocked ? 'disabled' : ''}>Sign in</button>
      <button class="btn btn--ghost btn--block" data-act="nav.home">Back to SAAHAA</button>

      <p class="micro muted" style="margin-top:var(--sp-5);line-height:1.7;border-top:1px solid var(--color-divider);padding-top:var(--sp-5)">
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
  const ours = treasury.treasury(st.ledger).feeEarned;
  const badge = { approvals: queued, disputes: openD, escrow: liveOrders };

  /* The map is the only thing on this console that needs a live DOM node, so
     it is built one frame AFTER this string has been mounted. Never inside the
     render path, never blocking it, and never able to break it. */
  scheduleMap();

  return `${ADMIN_CSS}
  <div class="ad">
  <header class="ad-hdr on-plum">
    <div class="wrap">
      <div class="ad-brand">
        <div class="grow">
          <div class="ad-wm">SAAHAA<span class="sep">·</span>ADMIN</div>
          <div class="ad-ver">v${VERSION} “${CODENAME}” · schema v${SCHEMA_VERSION} · ${BUILD_ID}</div>
        </div>
        <button class="btn btn--secondary btn--sm" data-act="admin.logout">${icon('signout', { size: 16 })} Sign out</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <div class="capsules ad-kpis">
      ${capsule('In flight', liveOrders, 'orders not yet settled', 'info')}
      ${capsule('Awaiting you', queued, 'approvals only you can give', queued ? 'warn' : 'soft')}
      ${capsule('Open disputes', openD, openD ? 'action needed' : 'all clear', openD ? 'bad' : 'ok')}
      ${capsule('Health', `${healthy}/${h.checks.length}`, h.ok ? 'every check holds' : h.fatal ? 'fatal' : 'degraded', h.ok ? 'ok' : h.fatal ? 'bad' : 'warn')}
      ${capsule('Ours', M.fmt(ours), 'fees earned, net of GST', ours > 0 ? 'gold' : 'soft')}
    </div>

    ${st.admin.isDemo ? `<div class="card card--warn" style="margin-top:var(--sp-6)">
      <div class="eyebrow" style="color:var(--warn);display:flex;align-items:center;gap:6px">${icon('warn', { size: 13 })} Bootstrap credential</div>
      <b class="tiny">Set your own password before anyone else uses this.</b>
      <p class="tiny muted">
        This device is still on a bootstrap credential. Set your own password in System &amp; audit
        before anyone else uses this.</p>
    </div>` : ''}

    <nav class="ad-tabs" role="tablist" aria-label="Admin sections">
      ${SECTIONS.map(([k, l]) => `<button class="ad-tab" role="tab"
        aria-selected="${section === k ? 'true' : 'false'}"
        data-act="admin.sec" data-sec="${k}">${esc(l)}${badge[k] ? `<span class="tag ${k === 'escrow' ? 'tag-neutral' : 'tag-accent'}">${badge[k]}</span>` : ''}</button>`).join('')}
    </nav>

    ${section === 'dash' ? dash(st)
    : section === 'approvals' ? approvals(st)
    : section === 'escrow' ? escrow(st)
    : section === 'disputes' ? disputes(st)
    : section === 'people' ? people(st)
    : section === 'moderation' ? moderation(st)
    : section === 'finance' ? finance(st)
    : system(st)}
    <div style="height:48px"></div>
  </main>
  </div>`;
}

/* ── 1. DASHBOARD ─────────────────────────────────────────── */
function dash(st) {
  const a = st.agg;
  const pending = st.users.filter(u => u.role !== 'customer' && u.tier <= 1).length;
  const openD = st.disputes.filter(d => d.status === 'OPEN' && !d.resolvedAt).length;
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal).length;
  const t = treasury.treasury(st.ledger);
  return `
  ${note('every number on this screen, live from the ledger and the order registry',
         'nothing — this screen is read-only by design')}

  ${liveMap(st)}

  <div class="sec">${secHead('The numbers')}
  <div class="capsules">
    ${capsule('Ours (fees earned)', M.fmt(t.feeEarned), `${M.fmt(t.withdrawn)} withdrawn so far`, 'gold')}
    ${capsule('Users', st.users.length, `${st.users.filter(u => u.role === 'customer').length} customers`, 'soft')}
    ${capsule('Partners', st.partners.length, `${st.shops.length} shops`, 'soft')}
    ${capsule('Orders', st.orders.length, `${liveOrders} live`, 'info')}
    ${capsule('Revenue', M.fmt(a.revenue), `GST ${M.fmt(a.gst)} collected`, 'gold')}
    ${capsule('GMV', M.fmt(a.gmv), 'paid to pros & shops', 'ok')}
    ${capsule('In escrow', M.fmt(a.escrow), 'locked, not revenue', 'info')}
    ${capsule('Pending approvals', pending, 'partners awaiting tier', pending ? 'warn' : 'soft')}
    ${capsule('Open disputes', openD, openD ? 'action needed' : 'all clear', openD ? 'bad' : 'ok')}
    ${capsule('Customer savings', M.fmt(a.saved), 'vs commission apps', 'gold')}
    ${capsule('Listings', st.products.length, 'products across all shops', 'soft')}
  </div></div>

  ${moneyFlow(st)}

  <div class="ad-split" style="margin-top:var(--sp-5)">
    <div class="sec">${secHead('Booking statistics')}
      ${byStage(st)}</div>
    <div class="sec" style="border-top:0">${secHead('Rating statistics')}
      ${ratingStats(st)}</div>
  </div>`;
}

/* ── THE LIVE MAP ─────────────────────────────────────────────
   A marketplace is a place before it is a table. Every non-terminal order sits
   at the customer's place, every online pro at theirs, every shop at its own —
   so "is anything actually happening in Kondapur tonight?" is a glance, not a
   query. Read-only: the map never writes, and a map that fails to load must
   never take the console down with it. The pins are the system's palette
   (ui/map.js · PINS): the accent for the order being watched, ink for a pro,
   neutral for a shop. */
const PIN_ORDER = gmap.PINS.accent, PIN_PARTNER = gmap.PINS.ink, PIN_SHOP = gmap.PINS.neutral;

/* `c` is a constant from gmap.PINS today. Whitelisting it costs nothing and
   means a future caller cannot put anything else into a style attribute. */
const legendDot = (c, label) => `<span><span class="ad-dot" aria-hidden="true" style="background:${
  /^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : 'currentColor'}"></span>${esc(label)}</span>`;

function liveMap(st) {
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal);
  const online = st.partners.filter(p => p.online !== false && !p.suspended);
  return `
  <div class="sec">${secHead('Live map', `<button class="more" data-act="admin.map">Refresh</button>`)}
    <div class="ad-mapbox">
      <div id="adminMap"></div>
      <div class="ad-legend">
        ${legendDot(PIN_ORDER, `${liveOrders.length} order${liveOrders.length === 1 ? '' : 's'} in flight`)}
        ${legendDot(PIN_PARTNER, `${online.length} pro${online.length === 1 ? '' : 's'} online`)}
        ${legendDot(PIN_SHOP, `${st.shops.length} shop${st.shops.length === 1 ? '' : 's'}`)}
      </div>
    </div>
    <p class="micro muted" style="margin-top:var(--sp-4)">
      Tiles from OpenStreetMap. Places come from each order, pro and shop — nothing about a
      customer is sent anywhere to draw this.</p>
  </div>`;
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
      /* ui/map.js escapes the label at the sink; escaping here too printed
                 "Ram &amp;amp; Co" in the popup. Pass the plain text. */
      `${o.customerName || 'Customer'} · ${stage(o.stage).label || o.stage} · ${M.fmt(o.customerPays)}`));
  st.partners.filter(p => p.online !== false && !p.suspended).slice(0, 120).forEach((p, i) =>
    push(p.loc || p.area, p.id, i, PIN_PARTNER, 'P',
      `${p.name} · ${get('category', p.cat).name || ''} · ${p.area || ''}`));
  st.shops.slice(0, 80).forEach((s, i) =>
    push(s.loc || s.area, s.id, i, PIN_SHOP, 'K', `${s.name} · ${s.area || ''}`));
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
    mount(el, `<div class="empty"><p class="tiny muted">Map unavailable — ${esc(
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

  const node = (k, v, d) => `<div class="moneyflow__node">
    <div class="eyebrow">${esc(k)}</div>
    <div class="num" style="font-size:var(--fs-lg)">${M.fmt(v)}</div>
    <div class="micro muted">${esc(d)}</div></div>`;

  return `
  <div class="sec">${secHead('Money flow', `<span class="pill pill--live">live</span>`)}
    <div class="tablewrap"><div class="moneyflow" style="min-width:560px">
      ${node('Customer', lockedEver, 'paid in, all time')}
      <div class="moneyflow__arrow" aria-hidden="true">${icon('chevron', { size: 14 })}</div>
      ${node('Escrow', held, 'locked right now · not revenue')}
      <div class="moneyflow__arrow" aria-hidden="true">${icon('chevron', { size: 14 })}</div>
      ${node('Partner', toPartner, 'released to pros')}
      ${node('Shop', toShop, 'released to shops')}
    </div></div>

    <div class="eyebrow" style="margin-top:var(--sp-6)">The split — six separate books</div>
    <div class="capsules" style="margin-top:var(--sp-4)">
      ${capsule('Platform fee', M.fmt(fee), 'revenue, net of GST', 'gold')}
      ${capsule('GST', M.fmt(gst), 'owed to government', 'info')}
      ${capsule('Rider pool', M.fmt(rider), 'delivery earnings', 'soft')}
      ${capsule('Holdback', M.fmt(holdback), 'pro reliability stake', 'soft')}
      ${capsule('Goodwill', M.fmt(goodwill), 'credits we fund ourselves', 'warn')}
      ${capsule('Refunded', M.fmt(refunded), 'returned to customers', 'bad')}
    </div>

    <div class="eyebrow" style="margin-top:var(--sp-6)">Where every rupee stands</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:var(--sp-4)">
      <span class="state state--held">Held · ${M.fmt(held)}</span>
      <span class="state state--released">Released · ${M.fmt(released)}</span>
      <span class="state state--pending">Pending payout · ${M.fmt(pendingOut)}</span>
      <span class="state state--available">Available · ${M.fmt(availableOut)}</span>
    </div>
    <p class="tiny muted" style="margin-top:var(--sp-5)">
      Held is escrow this second. Released is what has already left escrow to a pro or a shop.
      Pending is settled but not yet paid out by hand. Available is settled and paid out.
      Four different numbers — never one.</p>
  </div>`;
}

function byStage(st) {
  const counts = {};
  st.orders.forEach(o => { counts[o.stage] = (counts[o.stage] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return empty('No orders yet.');
  const max = rows[0][1];
  return table(['Stage', 'Share', ['Orders', 'num']], rows.map(([s, n]) => `<tr>
    <td>${esc(stage(s).label)}</td>
    <td><div class="ad-bar"><i style="width:${(n / max) * 100}%"></i></div></td>
    <td class="num">${n}</td></tr>`).join(''));
}

function ratingStats(st) {
  const all = st.partners.flatMap(p => p.ratings || []);
  if (!all.length) return empty('No ratings yet.');
  const avg = all.reduce((n, r) => n + r.stars, 0) / all.length;
  const dist = [5,4,3,2,1].map(s => [s, all.filter(r => r.stars === s).length]);
  return `<div class="capsules" style="margin-bottom:var(--sp-5)">
      ${capsule('Average', avg.toFixed(2), `${all.length} ratings across ${st.partners.length} pros`, 'gold')}
    </div>
    ${table(['Stars', 'Share', ['Count', 'num']], dist.map(([s, n]) => `<tr>
      <td class="nowrap">${s} ${icon('star', { size: 12 })}</td>
      <td><div class="ad-bar"><i style="width:${(n / all.length) * 100}%"></i></div></td>
      <td class="num">${n}</td></tr>`).join(''))}`;
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
  ${note('tier 3 and tier 4 promotions from the pipeline below, queue ordering by risk, duplicate detection, price-outlier flags, ban-list prefilter',
         'turn automation off, move the dials, suspend — and approve by hand when you want to override the machine')}

  <div class="sec">${secHead(`Partner applications · ${queue.length}`, pill('your override', 'soft'))}
    <div class="ad-cards">
    ${queue.length ? queue.map(p => {
      const t = trustScore(p);
      const v = p.verification || {};
      const bg = v.background || {};
      const next = Math.min(4, (p.tier | 0) + 1);
      const e = V.certifiedEligible(p);
      const evidence = next === 3
        ? `<div class="eyebrow">Background check requested ${esc(timeAgo(bg.at))}</div>
           ${facts([
             `ID ${esc((v.idType || '').toUpperCase())} …${esc(v.idLast4 || '????')}`,
             `Reference ${esc(bg.refName || '—')} …${esc(bg.refPhone || '')}`,
             'Consent given',
           ])}
           <p class="tiny muted">Call the reference. Approve only after the call.</p>`
        : `<div class="eyebrow">Qualifies for Certified</div>
           ${facts([
             `${e.completed} jobs`,
             `rating ${e.avg.toFixed(1)}`,
             `${p.disputesUpheld || 0} upheld disputes`,
           ])}`;
      return cmd({
        tone: next === 3 ? '' : 'card--gold',
        title: `${esc(p.name)}`,
        /* the code first: it is what the owner will say on the phone */
        sub: `${(u => u ? `<b class="num">${esc(u)}</b> · ` : '')(codeOf(userOfPartner(st, p)))}${esc(get('category', p.cat).name)} · ${esc(p.area)} · ${esc(tier(p.tier).label)} · trust ${t.score}`,
        right: pill(t.band.label, t.band.tone),
        facts: evidence,
        actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.approve" data-id="${p.id}" data-tier="${next}">Approve → ${esc(tier(next).label)}</button>
          <button class="btn btn--secondary btn--sm" data-act="admin.suspend" data-id="${p.id}">Suspend</button>`,
      });
    }).join('') : empty('Nothing needs you. Partners verify themselves.')}</div></div>

  ${automation(st)}

  <div class="ad-split">
  <div class="sec">${secHead(`Self-verifying now · ${inProgress.length}`)}
    ${table(['Pro', 'ID', 'Trade', ['Done', 'num'], 'Next step'], inProgress.map(p => { const r = V.readiness(p); return `<tr>
      <td class="nowrap"><b>${esc(p.name)}</b></td>
      <td class="nowrap">${codeCell(userOfPartner(st, p))}</td>
      <td>${esc(get('category', p.cat).name)}</td>
      <td class="num">${r.pct}%</td>
      <td>${esc(r.next ? r.next.title : '—')}</td></tr>`; }).join(''), 'Nobody mid-way.')}</div>

  <div class="sec" style="border-top:0">${secHead(`Shop applications · ${shops.length}`)}
    ${table(['Shop', 'Owner ID', 'Area', 'Status'], shops.map(s => `<tr>
      <td class="nowrap"><b>${esc(s.name)}</b></td>
      <td class="nowrap">${codeCell(st.users.find(u => u.key === s.ownerKey) || st.users.find(u => u.shopId === s.id))}</td>
      <td>${esc(s.area)}</td>
      <td>${pill(s.status, 'warn')}</td></tr>`).join(''), 'No shops waiting.')}</div>
  </div>`;
}

/* ── AUTOMATION — approvals that happen by themselves ─────────
   Tier 3 (Background Checked) and tier 4 (Certified) are earned by the
   network: settled jobs, ratings, vouches from people who can know, a
   reference confirmed by code, then tenure. domain/autoverify.js decides;
   this panel shows the dials, the pipeline and what the machine has done.
   Same shape as Charges: a dial, its live value, its launch default, one Push. */
const checkRow = (id, label, on, hint) => `
  <label class="ad-check">
    <span><b class="tiny">${esc(label)}</b><p class="micro muted" style="margin:2px 0 0">${hint}</p></span>
    <input id="${id}" type="checkbox" ${on ? 'checked' : ''}>
  </label>`;

function automation(st) {
  const A = settings.getAutomation();
  const D = settings.DEFAULT_AUTOMATION;
  const pipe = autoverify.pipeline();
  const recent = audit.entries({ action: 'verify.auto', limit: 20 });
  const nameOf = id => (st.partners.find(p => p.id === id) || {}).name || id;
  const onOff = v => v ? 'on' : 'off';
  return `
  <div class="sec">${secHead('Automation — approvals that happen by themselves',
      A.autoApprove ? pill('running', 'ok', 'pill--live') : pill('switched off', 'warn'))}
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      Background Checked and Certified are earned by the network itself — real jobs, ratings, vouches
      from people who can know, a reference who confirms by code, then time. Nobody waits for you.
      The switch below stops it; the dials say how much is enough.</p>

    <div class="ad-cards">
    ${dialGroup('The switch', 'Off means tiers 3 and 4 wait for you again. Suspension always wins either way.', `
      ${checkRow('atAuto', 'Promote by itself', A.autoApprove, dialHint(onOff(A.autoApprove), onOff(D.autoApprove)))}
    `)}

    ${dialGroup('Certified (tier 4)', 'The 25-job / 4.6-rating / zero-dispute rule is fixed. This dial is how long a pro must have been Background Checked first.', `
      ${dial('atCertDays', 'Days as Background Checked', A.certDays, dialHint(`${A.certDays} days`, `${D.certDays} days`))}
    `)}
    </div>

    <div style="margin-top:var(--sp-5)">
    ${dialGroup('Background Checked (tier 3)', 'Every line must hold before the network promotes a pro. Upheld disputes must be zero — that is not a dial.', `
      <div class="ad-g2">
      ${dial('atJobs', 'Real jobs settled cleanly (code + photo)', A.bgJobs, dialHint(`${A.bgJobs} jobs`, `${D.bgJobs} jobs`))}
      ${dial('atRating', 'Average rating over those jobs', A.bgRating, dialHint(`${A.bgRating}`, `${D.bgRating}`))}
      ${dial('atVouches', 'Vouches from customers or same-trade pros', A.bgVouches, dialHint(`${A.bgVouches}`, `${D.bgVouches}`))}
      </div>
      ${checkRow('atReference', 'The named reference must confirm by code', A.bgReference, dialHint(onOff(A.bgReference), onOff(D.bgReference)))}
    `)}
    </div>

    <div class="ad-actions" style="margin-top:var(--sp-5)">
      <button class="btn btn--primary grow" data-act="admin.automation.push">Push</button>
      <button class="btn btn--secondary" data-act="admin.automation.reset">Reset to defaults</button>
    </div>
    <p class="tiny muted" style="margin-top:var(--sp-4)">
      Last pushed: ${A.pushedAt
        ? `<b>${esc(clockTime(A.pushedAt))}, ${esc(timeAgo(A.pushedAt))}</b> by <b>${esc(A.pushedBy || 'admin')}</b>`
        : '<b>never</b> — these are the launch defaults'}</p>
  </div>

  <div class="sec">${secHead(`Pipeline · ${pipe.length}`, pill(`${pipe.filter(r => r.ready).length} ready`, pipe.some(r => r.ready) ? 'ok' : 'soft'))}
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      Every tier-2 and tier-3 pro, closest to promotion first, with what they are still missing.
      A ready row is promoted on the next sweep while the switch is on.</p>
    ${table(['Pro', 'Trade', 'Promotion', 'Still missing', 'Status'], pipe.map(r => `<tr class="${r.ready ? 'on' : ''}">
      <td class="nowrap"><b>${esc(r.name)}</b></td>
      <td>${esc(get('category', r.cat).name || r.cat)}</td>
      <td class="nowrap">${esc(tier(r.tier).label)} → ${esc(tier(r.next).label)}</td>
      <td>${r.ready ? 'everything holds — promoted on the next sweep' : esc(r.missing.join(' · '))}</td>
      <td class="nowrap">${r.ready ? pill('ready', 'ok') : pill(`${r.missing.length} to go`, 'soft')}</td></tr>`).join(''),
      'Nobody in the pipeline — no tier-2 or tier-3 pro yet.')}
  </div>

  <div class="sec">${secHead(`Promoted by the network · ${recent.length}`)}
    ${table(['When', 'Pro', 'To', 'Evidence'], recent.map(e => `<tr>
      <td class="nowrap">${esc(clockTime(e.ts))}<span class="sub">${esc(timeAgo(e.ts))}</span></td>
      <td class="nowrap"><b>${esc(nameOf((e.detail || {}).partner))}</b></td>
      <td class="nowrap">${esc(tier((e.detail || {}).tier | 0).label)}</td>
      <td class="tiny muted">${esc(Object.entries((e.detail || {}).evidence || {}).map(([k, v]) => `${k} ${v}`).join(' · '))}</td></tr>`).join(''),
      'No automatic promotion yet.')}
  </div>`;
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

  <div class="capsules" style="margin-top:var(--sp-5)">
    ${capsule('Locked in escrow', M.fmt(st.agg.escrow), "customers' money, not revenue", 'gold')}
    ${capsule('Awaiting release', held.length, 'service jobs done or disputed', held.length ? 'warn' : 'soft')}
  </div>

  <div class="sec">${secHead(`Awaiting release · ${held.length}`, `<span class="state state--held">Held</span>`)}
  <div class="ad-cards">
  ${held.length ? held.map(o => cmd({
    title: `${esc(o.kind === 'service' ? o.partnerName : o.shopName)} <span class="num">${M.fmt(o.customerPays)}</span>`,
    sub: `${esc(o.customerName)} · ${esc(stage(o.stage).label)} · ${esc(timeAgo(o.stageTs))}`,
    right: tierPill(o.escrowTier),
    facts: facts([
      `${(o.evidence || []).length} photo${(o.evidence || []).length === 1 ? '' : 's'}`,
      o.otpVerified ? 'code verified at the door' : 'no door code yet',
      esc((ESCROW[o.escrowTier || 'STANDARD'] || {}).label || ''),
    ]),
    actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="1">Release 100%</button>
      <button class="btn btn--secondary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="0.6">Partial 60%</button>`,
  })).join('') : empty('Nothing awaiting release. Released only on confirmation or review.')}</div></div>

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
    <div class="ad-cards">
    ${stuck.map(o => {
      const stale = now - (o.stageTs || 0) > STALE_MS;
      return cmd({
        tone: stale ? 'card--warn' : '',
        title: `${esc(o.shopName || 'Shop')} <span class="num">${M.fmt(o.customerPays)}</span>`,
        sub: `${esc(o.customerName)} · ${esc(stage(o.stage).label)} · ${esc(timeAgo(o.stageTs))}`,
        right: stale ? pill('stalled', 'warn') : pill('moving', 'soft'),
        facts: stale ? `<p class="tiny" style="color:var(--warn)">Stalled — the shop has not moved this on.</p>` : '',
        actions: `<button class="btn btn--secondary btn--sm btn--block"
          data-act="admin.refundretail" data-id="${o.id}">Refund the customer in full</button>`,
      });
    }).join('')}</div></div>`;
}

/* ── 4. DISPUTES ──────────────────────────────────────────── */
function disputes(st) {
  const open = st.disputes.filter(d => d.status === 'OPEN' && !d.resolvedAt);
  return `
  ${note('intake, SLA clock (red past 24h), auto-resolution rules, evidence bundling, auto-escalation at 72h',
         'read the evidence and pick one of three outcomes, with a written reason')}

  <div class="sec">${secHead(`Open disputes · ${open.length}`)}
  <div class="ad-cards">
  ${open.length ? open.map(d => {
    const o = st.orders.find(x => x.id === d.orderId) || {};
    const ageH = (Date.now() - d.openedAt) / 3600000;
    return cmd({
      tone: ageH > 24 ? 'card--bad' : '',
      title: esc(d.reason),
      sub: `${esc(o.customerName || '')} vs ${esc(o.partnerName || o.shopName || '')} · ${esc(timeAgo(d.openedAt))}`,
      right: pill(`${Math.round(ageH)}h`, ageH > 24 ? 'bad' : 'warn'),
      facts: facts([
        `${(o.evidence || []).length} photo${(o.evidence || []).length === 1 ? '' : 's'}`,
        o.otpVerified ? 'start code verified' : 'NO start code',
        o.customerPays != null ? `escrowed ${M.fmt(o.customerPays)}` : '',
      ]),
      actions: `<button class="btn btn--primary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="release">Release 100%</button>
        <button class="btn btn--secondary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="partial">Partial 60%</button>
        <button class="btn btn--ghost btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="refund">Full refund</button>`,
    });
  }).join('') : empty('No open disputes.')}</div></div>`;
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
    ${table(['Pro', 'ID', 'Trade', ['Jobs', 'num'], 'Area', 'Tier', 'Trust', ''], st.partners.map(p => {
      const t = trustScore(p);
      return `<tr>
        <td class="nowrap"><b>${esc(p.name)}</b>${p.suspended ? '<span class="sub">suspended</span>' : ''}</td>
        <td class="nowrap">${codeCell(userOfPartner(st, p))}</td>
        <td>${esc(get('category', p.cat).name)}<span class="sub">${(p.vouches || []).length} vouch${(p.vouches || []).length === 1 ? '' : 'es'}${(p.tier | 0) >= 3 && p.tier3At
          ? ` · checked ${esc(new Date(p.tier3At).toLocaleDateString('en-IN'))}` : ''}</span></td>
        <td class="num">${p.completed}</td>
        <td>${esc(p.area)}</td>
        <td class="nowrap">${pill(tier(p.tier).label, tier(p.tier).tone)}</td>
        <td class="nowrap">${pill(`${t.score} · ${t.band.label}`, t.band.tone)}</td>
        <td class="act">
          <button class="btn btn--ghost btn--sm" data-act="admin.reset" data-key="${esc(p.userKey || '')}">Reset password</button>
          <button class="btn btn--ghost btn--sm" data-act="admin.suspend" data-id="${p.id}">
            ${p.suspended ? 'Unsuspend' : 'Suspend'}</button>
          ${(p.tier | 0) >= 4 ? '<span class="pill pill--gold">Top tier</span>'
            : `<button class="btn btn--ghost btn--sm" data-act="admin.approve" data-id="${p.id}">Promote</button>`}
        </td></tr>`;
    }).join(''), 'No pros yet.')}</div>

  <div class="sec">${secHead(`Customers · ${customers.length}`)}
    ${table(['Customer', 'ID', 'Mobile', 'Area'], customers.map(u => `<tr>
      <td class="nowrap"><b>${esc(u.name)}</b></td>
      <td class="nowrap">${codeCell(u)}</td>
      <td class="nowrap muted">${esc(u.mobile)}</td>
      <td>${esc(u.area)}</td></tr>`).join(''), 'No customers yet.')}</div>`;
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

/* The flow search is a delegated listener, not a registered action: it filters
   rows that are already computed and writes nothing to the store. mount()
   keeps the caret where the owner left it. */
delegate('input', '#adFlowQ', (e, el) => { flowQuery = el.value; flowPick = null; ctx.render(); });

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

  /* "C2026 2001" typed with a space is the same code; a mobile is matched on
     its digits. Everything else is a plain case-insensitive substring. */
  const q = flowQuery.trim().toLowerCase();
  const qCode = ID.normaliseCode(flowQuery);
  const qDigits = flowQuery.replace(/\D/g, '');
  const hit = u => {
    if (!q) return true;
    const c = codeOf(u);
    if (c && qCode && c.includes(qCode)) return true;
    if (qDigits.length >= 3 && String(u.mobile || '').includes(qDigits)) return true;
    return `${u.name || ''} ${u.area || ''} ${(u.loc && u.loc.label) || ''} ${u.role || ''}`.toLowerCase().includes(q);
  };

  return st.users
    .filter(u => flowRole === 'all' || u.role === flowRole)
    .filter(hit)
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
        ? `${(p && p.completed) || 0} jobs · ${((p && p.vouches) || []).length} vouch${((p && p.vouches) || []).length === 1 ? '' : 'es'} · earned ${M.fmt(earned)}${
            p && (p.tier | 0) >= 3 && p.tier3At ? ` · checked ${new Date(p.tier3At).toLocaleDateString('en-IN')}` : ''}`
        : u.role === 'shop'
        ? `${orders.length} order${orders.length === 1 ? '' : 's'} · earned ${M.fmt(earned)}`
        : `${orders.length} order${orders.length === 1 ? '' : 's'} · spent ${M.fmt(spend)}`;

      const live = !!(latest && !stage(latest.stage).terminal);
      return { key: u.key, name: u.name, code: codeOf(u), role: u.role, place, step, seen, orders, counts, live, hold: live ? holdOf(latest) : null };
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
  return `<div class="eyebrow" style="margin-bottom:var(--sp-4)">${esc(row.name)}${row.code ? ' · ' + esc(row.code) : ''} — the whole journey</div>
    ${table(['When', 'Event', 'Detail'], list.map(e => `<tr>
      <td class="nowrap">${esc(clockTime(e.ts))}<span class="sub">${esc(timeAgo(e.ts))}</span></td>
      <td class="nowrap"><b>${esc(e.title)}</b></td>
      <td class="tiny muted">${e.body ? esc(e.body) : ''}</td></tr>`).join(''))}
    <p class="micro muted" style="margin-top:var(--sp-4)">${evs.length > FLOW_EVENTS
      ? `Newest ${FLOW_EVENTS} of ${evs.length} events.` : `${evs.length} ${evs.length === 1 ? 'event' : 'events'}, newest first.`}</p>`;
}

function flowRow(row) {
  const open = flowPick === row.key;
  return `<tr class="${open ? 'on' : ''}">
    <td><button class="ad-rowbtn" aria-expanded="${open ? 'true' : 'false'}"
        data-act="admin.flow.pick" data-key="${esc(row.key)}">
        <b>${esc(row.name)}</b><span class="sub">${esc(ROLE_LABEL[row.role] || row.role)}${row.code ? ' · ' + esc(row.code) : ''}</span></button></td>
    <td>${esc(row.place)}</td>
    <td>${esc(row.step)}${row.live ? ' <span class="pill pill--live">in flight</span>' : ''}
      ${row.hold ? `<span class="sub">Held by <b>${esc(row.hold.who)}</b> · ${M.fmt(row.hold.money)} on this order${row.hold.next.length ? ` → ${esc(row.hold.next.join(' / '))}` : ''}</span>` : ''}</td>
    <td class="nowrap">${esc(row.seen ? timeAgo(row.seen) : 'never')}</td>
    <td class="tiny muted">${esc(row.counts)}</td>
  </tr>${open ? `<tr class="detail"><td colspan="5">${flowTimeline(row)}</td></tr>` : ''}`;
}

function flowBlock(st) {
  const rows = flowRows(st);
  return `
  <div class="sec">${secHead(`Flow · ${rows.length}`, `<span class="pill pill--live">live</span>`)}
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      Everyone on SAAHAA, most recently active first: where they are, what step they are on, and
      what they have spent or earned. Tap a name to unroll that person's whole journey.</p>
    <div class="ad-segwrap">
      <div class="seg" role="group" aria-label="Filter the flow by role">
        ${ROLE_CHIPS.map(([k, l]) => `<button class="seg__btn"
          aria-pressed="${flowRole === k ? 'true' : 'false'}"
          data-act="admin.flow.filter" data-role="${k}">${esc(l)}</button>`).join('')}
      </div>
    </div>
    <div class="search" style="margin-bottom:var(--sp-5)">
      ${icon('search', { size: 16 })}
      <input id="adFlowQ" type="search" value="${esc(flowQuery)}" autocomplete="off"
        placeholder="Name, mobile, area — or the ID they read out (C20262001)"
        aria-label="Find a person by name, mobile, area or SAAHAA ID">
    </div>
    ${table(['Who', 'Where', 'Step', 'Seen', 'Spent / earned'], rows.map(r => flowRow(r)).join(''),
      flowQuery.trim() ? `Nobody matches “${flowQuery.trim()}”.`
        : flowRole === 'all' ? 'Nobody has signed up yet.' : 'Nobody in that role yet.')}
    ${rows.length >= FLOW_ROWS ? `<p class="micro muted" style="margin-top:var(--sp-4)">Showing the ${FLOW_ROWS} most recently active.</p>` : ''}
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
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      The single biggest revenue leak in a local marketplace: a pro asking to be paid in cash outside the app.
      Numbers and UPI handles are masked automatically; repeat offences cost trust points.</p>
    ${table(['When', 'Who', 'Message'], flagged.map(m => `<tr>
      <td class="nowrap">${esc(clockTime(m.ts))}</td>
      <td class="nowrap"><b>${esc(m.name)}</b></td>
      <td class="tiny">${esc(m.text)}</td></tr>`).join(''), 'Nothing flagged.')}</div>

  <div class="sec">${secHead(`Reviews · ${st.reviews.length}`)}
    ${table([['Stars', 'num'], 'By', ''], st.reviews.slice(0, 20).map(r => `<tr>
      <td class="num">${r.stars} ${icon('star', { size: 12 })}</td>
      <td>${esc(r.byName || r.by || '')}</td>
      <td class="act"><button class="btn btn--ghost btn--sm" data-act="admin.hidereview" data-id="${r.id}">Hide</button></td></tr>`).join(''),
      'No reviews yet.')}</div>`;
}

/* ── 7. FINANCE — including the reconciliation screen ─────── */
function finance(st) {
  const a = st.agg;
  const replay = replayLedger(st.ledger);
  const escrowLedger = Object.entries(replay).filter(([k]) => k.startsWith('ESCROW:'))
    .reduce((n, [, v]) => n + v, 0);
  const drift = escrowLedger !== a.escrow;
  return `
  ${note(`revenue split per order, GST liability (${gstPct()} of the fee), payout queue, unit economics`,
         'mark a payout batch paid with its UTR, record a manual adjustment with a reason, export the GST report')}

  <div class="ad-split" style="margin-top:var(--sp-5)">
    <div class="card ${drift ? 'card--bad' : 'card--ok'}">
      <div class="between">
        <div><div class="eyebrow">Reconciliation</div>
          <b class="h-sec">${drift ? 'Drift' : 'Balanced'}</b></div>
        ${pill(drift ? 'do not trust this screen' : 'books agree', drift ? 'bad' : 'ok')}
      </div>
      <p class="tiny muted">
        Escrow held, ledger replay and the aggregate must agree. If they ever don't, everything else on
        this screen is fiction — that is why this box sits at the top.</p>
      ${table(['Book', ['Escrow', 'num']], `
        <tr><td>Aggregate escrow</td><td class="num">${M.fmt(a.escrow)}</td></tr>
        <tr><td>Ledger replay</td><td class="num">${M.fmt(escrowLedger)}</td></tr>
        <tr class="tot"><td>Difference</td>
          <td class="num" style="color:var(--${drift ? 'danger' : 'success'})"><b>${M.fmt(Math.abs(escrowLedger - a.escrow))}</b></td></tr>`)}
    </div>
    <div class="capsules">
      ${capsule('Platform revenue', M.fmt(a.revenue), 'net of GST', 'gold')}
      ${capsule('GST collected', M.fmt(a.gst), `${gstPct()} of the fee, remitted`, 'info')}
      ${capsule('Refunds', M.fmt(a.refunds), 'returned to customers', 'bad')}
      ${capsule('Ledger blocks', st.chain.length, 'hash-chained', 'soft')}
    </div>
  </div>

  ${treasuryBlock(st)}

  ${charges()}

  <div class="sec">${secHead('Payout queue')}
    ${payoutQueue(st)}</div>

  <div class="sec">${secHead('Ledger',
      `<button class="more" data-act="admin.verifychain">Verify chain</button>`)}
    ${chainResult ? `<p class="tiny" style="color:var(--${chainResult.ok ? 'success' : 'danger'});margin-bottom:var(--sp-4)">
      ${chainResult.ok ? `${st.chain.length} blocks verified` : `Broken at block ${chainResult.at} (${chainResult.reason})`}</p>` : ''}
    <p class="micro muted" style="margin-bottom:var(--sp-4)">Last 30 blocks of ${st.ledger.length}, newest first.</p>
    ${table([['Block', 'num'], 'Kind', 'From', 'To', ['Amount', 'num']], st.ledger.slice(-30).reverse().map(b => `<tr>
        <td class="num">#${b.blockIdx}</td>
        <td class="nowrap">${esc(b.kind)}</td>
        <td class="muted tiny">${esc(b.partyA)}</td>
        <td class="muted tiny">${esc(b.partyB)}</td>
        <td class="num">${M.fmt(b.amountPaise)}</td></tr>`).join(''), 'Empty.')}
    <button class="btn btn--secondary btn--block" style="margin-top:var(--sp-5)" data-act="admin.exportledger">Export ledger CSV</button>
  </div>`;
}

/* ── TREASURY — the company's wallet ──────────────────────────
   Everyone pays SAAHAA; SAAHAA pays everyone. What is OURS is the platform
   fee, and only that. Everything else the books hold — escrow, wallets,
   stakes, holdbacks, the rider pool — is other people's money, and the
   liabilities table says so in those words. domain/treasury.js replays the
   hash-chained ledger for every figure here; nothing is typed in. */
const trRow = (k, v, strong = false) => `<tr class="${strong ? 'tot' : ''}">
  <td>${esc(k)}</td><td class="num">${strong ? `<b>${M.fmt(v)}</b>` : M.fmt(v)}</td></tr>`;

function treasuryBlock(st) {
  const t = treasury.treasury(st.ledger);
  const settled = st.orders.filter(o => o.settledAt)
    .sort((a, b) => (b.settledAt | 0) - (a.settledAt | 0)).slice(0, 20);
  const bigWithdraw = M.fmt(adminauth.STEPUP_THRESHOLD);
  return `
  <div class="sec">${secHead('Treasury — the company’s wallet',
      t.reconciles ? pill('Books reconcile', 'ok') : pill('DO NOT RECONCILE', 'bad'))}
    <div class="capsules">
      ${capsule('Our earnings held', M.fmt(t.feeEarned), 'platform fee, net of GST, still in the system', 'gold')}
      ${capsule('Withdrawable', M.fmt(t.withdrawable), 'to the company bank', 'ok')}
      ${capsule('GST held for the government', M.fmt(t.gstPayable), `${M.fmt(t.gstDue)} due`, 'info')}
      ${capsule('Money in', M.fmt(t.moneyIn), 'everything that ever entered', 'soft')}
      ${capsule('Withdrawn so far', M.fmt(t.withdrawn), 'to the company bank', 'gold')}
      ${capsule('GST remitted so far', M.fmt(t.remitted), 'paid to the government', 'ok')}
      ${capsule('Goodwill', M.fmt(t.goodwill), 'credits we fund ourselves', t.goodwill < 0 ? 'warn' : 'soft')}
    </div>
    <p class="micro muted" style="margin:var(--sp-4) 0 var(--sp-6);display:flex;align-items:center;gap:6px">
      ${icon('coin', { size: 12 })} ${esc(gateway.label())}</p>

    <div class="ad-split">
      <div class="card">
        <div class="eyebrow">Liabilities — other people’s money</div>
        <p class="tiny muted">
          These are held by SAAHAA but are never ours: they belong to customers, pros, shops and riders,
          and they leave the books only to those people.</p>
        ${table(['Held for', ['Amount', 'num']], [
          trRow('Escrow in flight', t.escrow),
          trRow('Customer wallets', t.customerWallets),
          trRow('Worker wallets', t.partnerWallets),
          trRow('Shop wallets', t.shopWallets),
          trRow('Stakes', t.stakes),
          trRow('Holdbacks', t.holdbacks),
          trRow('Rider pool', t.riderPool),
          trRow('Total held for others', t.liabilities, true),
        ].join(''))}
        <p class="micro muted">
          Money in must equal liabilities + ours + GST + goodwill + withdrawn + remitted.
          ${t.reconciles ? 'It does.' : 'It does not — stop and check the ledger before moving anything.'}</p>
      </div>

      <div class="stack" style="gap:var(--sp-5)">
        <div class="card card--gold ad-fields">
          <div class="eyebrow">Withdraw our earnings</div>
          <p class="tiny muted">PLATFORM:fee to the company bank. Never more than earned; above ${esc(bigWithdraw)} you re-type your password.</p>
          <div class="field">
            <input id="trAmt" type="number" step="any" inputmode="decimal" min="1" placeholder=" " value="${esc(rupStr(t.withdrawable))}">
            <label>Amount ₹</label></div>
          <button class="btn btn--primary btn--block" data-act="admin.treasury.withdraw" ${t.withdrawable >= 100 ? '' : 'disabled'}>Withdraw</button>
        </div>
        <div class="card ad-fields">
          <div class="eyebrow">Remit GST</div>
          <p class="tiny muted">PLATFORM:gst to the GST portal. Never more than held; above ${esc(bigWithdraw)} you re-type your password.</p>
          <div class="field">
            <input id="trGst" type="number" step="any" inputmode="decimal" min="1" placeholder=" " value="${esc(rupStr(t.gstDue))}">
            <label>Amount ₹</label></div>
          <button class="btn btn--secondary btn--block" data-act="admin.treasury.remit" ${t.gstDue >= 100 ? '' : 'disabled'}>Remit</button>
        </div>
      </div>
    </div>

    <div style="margin-top:var(--sp-6)">
      <div class="eyebrow">Our part, per order</div>
      <p class="tiny muted" style="margin:4px 0 var(--sp-4)">The last ${settled.length} settled orders, as booked — an order keeps the fee it was priced at.</p>
      ${table(['Order', ['Customer paid', 'num'], ['Fee', 'num'], ['GST', 'num'], ['Dispatch', 'num'], ['Ours', 'num']],
        settled.map(o => { const p = treasury.ourPartOf(o); return `<tr>
          <td class="nowrap">${esc(o.kind === 'retail' ? (o.shopName || 'Shop') : (o.partnerName || 'Pro'))}
            <span class="sub">${esc(o.customerName || '')} · ${esc(timeAgo(o.settledAt))}</span></td>
          <td class="num">${M.fmt(p.customerPays)}</td>
          <td class="num">${M.fmt(p.fee)}</td>
          <td class="num muted">${M.fmt(p.gst)}</td>
          <td class="num muted">${M.fmt(p.dispatchCut)}</td>
          <td class="num"><b>${M.fmt(p.ours)}</b></td></tr>`; }).join(''),
        'No settled order yet — our part appears the moment a job or a basket settles.')}
    </div>
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
/* The statutory GST rate is domain/pricing.js's to state, not this screen's —
   a view that types "18%" is a defect the day the rate moves. */
const gstPct = () => `${+(GST_RATE * 100).toFixed(2)}%`;
/* The worked example's premise, in paise, so the sentence and the sum below it
   can never drift apart. */
const EXAMPLE_JOB = 100000, EXAMPLE_BASKET = 60000, EXAMPLE_KM = 3;

/** One dial: a stacked field row — the input, its live value and the launch default beneath. */
const dial = (id, label, value, hint) => `
  <div>
    <div class="field" style="margin-bottom:4px">
      <input id="${id}" type="number" step="any" inputmode="decimal" placeholder=" " value="${esc(String(value))}">
      <label>${esc(label)}</label>
    </div>
    <p class="ad-hint">${hint}</p>
  </div>`;

const dialHint = (live, def) => `now <b>${esc(live)}</b> · launch default ${esc(def)}`;

const dialGroup = (title, blurb, body) => `
  <div class="card">
    <div class="eyebrow">${esc(title)}</div>
    <p class="tiny muted">${esc(blurb)}</p>
    <div>${body}</div>
  </div>`;

function charges() {
  const P = settings.getPricing();
  const D = settings.DEFAULT_PRICING;
  const bands = P.deliveryBands;
  const dbands = D.deliveryBands;

  /* The worked example is computed from the values that are LIVE right now —
     i.e. what the last Push did — so after the next Push it re-reads itself. */
  const ex = quoteService(EXAMPLE_JOB);
  const exr = quoteRetail([{ qty: 1, unitPrice: EXAMPLE_BASKET }], { km: EXAMPLE_KM, mode: 'rider' });

  const bandRow = (i) => {
    const b = bands[i] || bands[bands.length - 1] || { maxKm: 999, fee: 0 };
    const d = dbands[i] || dbands[dbands.length - 1];
    return `<div class="ad-g2">
      ${dial(`pxBand${i}Km`, `Band ${i + 1} · up to km`, b.maxKm, dialHint(`${b.maxKm} km`, `${d.maxKm} km`))}
      ${dial(`pxBand${i}Fee`, `Band ${i + 1} · fee ₹`, rup(b.fee), dialHint(`₹${rupStr(b.fee)}`, `₹${rupStr(d.fee)}`))}
    </div>`;
  };

  return `
  <div class="sec">${secHead('Charges', P.pushedAt
      ? `<span class="pill pill--ok">live since ${esc(timeAgo(P.pushedAt))}</span>`
      : `<span class="pill pill--soft">launch defaults</span>`)}
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      Everything SAAHAA charges anybody, in one place. Change a number, press Push, and the very
      next quote uses it. These are the only dials — no other screen can move a rate.</p>

    <div class="ad-cards">
    ${dialGroup('Service', 'Laid on top of the worker’s quote and paid by the customer. The worker keeps 100% of what they quoted.', `
      <div class="ad-g2">
      ${dial('pxService', 'Standard markup %', P.serviceMarkupPct, dialHint(`${P.serviceMarkupPct}%`, `${D.serviceMarkupPct}%`))}
      ${dial('pxLoyalty', 'Certified (tier-4) markup %', P.loyaltyMarkupPct, dialHint(`${P.loyaltyMarkupPct}%`, `${D.loyaltyMarkupPct}%`))}
      </div>
    `)}

    ${dialGroup('Platform (shops)', 'Taken out of the shop’s own margin, never added to the item price — MRP can never be exceeded.', `
      ${dial('pxRetail', 'Take %', P.retailTakePct, dialHint(`${P.retailTakePct}%`, `${D.retailTakePct}%`))}
      <div class="ad-g2">
        ${dial('pxRetailCap', 'Cap ₹ per order', rup(P.retailTakeCapPaise), dialHint(`₹${rupStr(P.retailTakeCapPaise)}`, `₹${rupStr(D.retailTakeCapPaise)}`))}
        ${dial('pxRetailFloor', 'Floor ₹ per order', rup(P.retailFeeFloorPaise), dialHint(`₹${rupStr(P.retailFeeFloorPaise)}`, `₹${rupStr(D.retailFeeFloorPaise)}`))}
      </div>
    `)}
    </div>

    <div style="margin-top:var(--sp-5)">
    ${dialGroup('Delivery', 'Four distance bands, charged to the customer and paid to the rider, minus our dispatch cut.', `
      ${[0, 1, 2, 3].map(bandRow).join('')}
      <div class="ad-g2">
      ${dial('pxDispatch', 'Dispatch cut ₹ per delivery', rup(P.riderDispatchCutPaise), dialHint(`₹${rupStr(P.riderDispatchCutPaise)}`, `₹${rupStr(D.riderDispatchCutPaise)}`))}
      </div>
    `)}
    </div>

    <div class="ad-split" style="margin-top:var(--sp-5)">
      <div class="card card--gold">
        <div class="eyebrow">Worked example · after push</div>
        <p class="tiny">
          A <b>${M.fmt(EXAMPLE_JOB)}</b> job: the customer pays <b class="num">${M.fmt(ex.customerPays)}</b> —
          pro keeps ${M.fmt(ex.workerPayout)}, our fee ${M.fmt(ex.platformFee)}, GST ${M.fmt(ex.gst)}
          (markup ${ex.markupPct}%).</p>
        <p class="tiny">
          A <b>${M.fmt(EXAMPLE_BASKET)}</b> shop basket ${EXAMPLE_KM} km away: customer pays <b class="num">${M.fmt(exr.customerPays)}</b>
          (items ${M.fmt(exr.itemsTotal)} + delivery ${M.fmt(exr.deliveryFee)}) — shop keeps
          ${M.fmt(exr.shopPayout)}, rider ${M.fmt(exr.riderPayout)}, we keep
          ${M.fmt(exr.platformRevenue)}.</p>
        <p class="micro muted">
          These are the numbers as they stand this second. Edit the dials above and press Push to
          move them — the example redraws from whatever was actually pushed.</p>
      </div>
      <div class="card card--warn">
        <b class="tiny">A push never re-prices money already taken.</b>
        <p class="tiny muted">
          Every order snapshots its own fee, GST, delivery and payout at the moment it is booked.
          Orders already placed — including everything sitting in escrow right now — keep the numbers
          they were booked at, whatever you do on this screen. Only quotes made from the push onwards
          use the new dials.</p>
      </div>
    </div>

    <div class="ad-actions" style="margin-top:var(--sp-5)">
      <button class="btn btn--primary grow" data-act="admin.pricing.push">Push</button>
      <button class="btn btn--secondary" data-act="admin.pricing.reset">Reset to defaults</button>
    </div>

    <p class="tiny muted" style="margin-top:var(--sp-4)">
      Last pushed: ${P.pushedAt
        ? `<b>${esc(clockTime(P.pushedAt))}, ${esc(timeAgo(P.pushedAt))}</b> by <b>${esc(P.pushedBy || 'admin')}</b>`
        : '<b>never</b> — these are the launch defaults'}</p>
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
  return `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:var(--sp-5)">
      <span class="state state--pending">Pending payout · ${M.fmt(total)}</span>
      ${pill(`${rows.length} payee${rows.length === 1 ? '' : 's'}`, 'soft')}
    </div>
    ${table(['Payee', ['Orders', 'num'], ['Owed', 'num'], 'Status', ''], rows.map(([who, v]) => `<tr>
      <td class="nowrap"><b>${esc(who)}</b></td>
      <td class="num">${v.ids.length}</td>
      <td class="num"><b>${M.fmt(v.amt)}</b></td>
      <td class="nowrap"><span class="state state--pending">Pending</span></td>
      <td class="act"><button class="btn btn--secondary btn--sm" data-act="admin.markpaid"
          data-ids="${esc(v.ids.join(','))}">Mark paid</button></td></tr>`).join(''))}`;
}

/* ── 8. SYSTEM & AUDIT — the DevOps screen ────────────────── */
function system(st) {
  const h = checkHealth(st);
  const backups = migrate.listBackups();
  return `
  ${note('health checks, registry integrity, storage quota, migration history, the audit log',
         'change the admin password, flip feature flags, run the self-test, restore a backup, export everything')}

  <div class="ad-split" style="margin-top:var(--sp-5)">
    <div class="card ${h.ok ? 'card--ok' : h.fatal ? 'card--bad' : 'card--warn'}">
      <div class="between">
        <div><div class="eyebrow">Health</div>
          <b class="h-sec">${h.ok ? 'All clear' : h.fatal ? 'Fatal' : 'Degraded'}</b></div>
        ${pill(`${h.checks.filter(c => c.ok).length}/${h.checks.length}`, h.ok ? 'ok' : h.fatal ? 'bad' : 'warn')}
      </div>
      ${table(['Check', 'Detail', ''], h.checks.map(c => `<tr>
        <td class="nowrap"><b class="tiny">${esc(c.id)}</b></td>
        <td class="tiny muted">${esc(c.detail)}</td>
        <td class="act">${pill(c.ok ? 'ok' : c.fatal ? 'fatal' : 'warn', c.ok ? 'ok' : c.fatal ? 'bad' : 'warn')}</td></tr>`).join(''))}
    </div>

    <div class="card">
      <div class="between">
        <div><div class="eyebrow">Self-test — this is our CI</div>
          <b class="h-sec">${testResult ? `${testResult.passed} passed · ${testResult.failed} failed` : 'Not run this session'}</b></div>
        <button class="btn btn--secondary btn--sm" data-act="admin.runtests">Run ${selftest.caseCount()} tests</button>
      </div>
      ${testResult ? `
        <div class="between">
          <span class="tiny muted">${testResult.durationMs}ms</span>
          ${pill(testResult.failed ? 'does not ship' : 'green', testResult.failed ? 'bad' : 'ok')}
        </div>
        ${testResult.failures.length ? testResult.failures.map(f => `<p class="micro" style="color:var(--danger)">
          ${esc(f.suite)} › ${esc(f.case)}<br>${esc(f.message)}</p>`).join('')
          : '<p class="tiny muted">Money math, state transitions, migration idempotence and referential integrity all hold.</p>'}
        ${table(['Suite', ['Passed', 'num']], testResult.suites.map(s => `<tr>
          <td class="tiny">${esc(s.name)}</td>
          <td class="num ${s.failed ? '' : 'muted'}" style="${s.failed ? 'color:var(--danger)' : ''}">${s.passed}/${s.passed + s.failed}</td></tr>`).join(''))}`
        : '<p class="tiny muted">A release with any failure does not ship.</p>'}
    </div>
  </div>

  <div class="sec">${secHead('Feature flags')}
    <p class="tiny muted" style="margin-bottom:var(--sp-5)">
      Every new feature ships default-off for one release. These are the kill-switch and the canary.</p>
    ${table(['Flag', 'Default', 'Source', ''], flags.all().map(f => `<tr>
      <td class="nowrap"><b>${esc(f.name)}</b></td>
      <td class="nowrap tiny muted">${String(f.default)}</td>
      <td class="nowrap tiny muted">${esc(f.source)}</td>
      <td class="act"><button class="btn ${f.value ? 'btn--primary' : 'btn--secondary'} btn--sm" role="switch"
          aria-checked="${f.value ? 'true' : 'false'}"
          data-act="admin.flag" data-name="${esc(f.name)}">${f.value ? 'ON' : 'OFF'}</button></td></tr>`).join(''))}
  </div>

  <div class="ad-split">
    <div class="sec">${secHead('Registry')}
      ${table(['Namespace', ['Entries', 'num']], namespaces().map(ns => `<tr>
        <td class="nowrap">${esc(ns)}</td><td class="num">${count(ns)}</td></tr>`).join(''))}
      <p class="tiny muted" style="margin-top:var(--sp-4)">
        Every one of these is an extension point. Adding a category, an order stage, a reducer or a
        migration means registering one more entry — no existing file changes.</p>
    </div>

    <div class="sec" style="border-top:0">${secHead('Backups & migration')}
      <p class="tiny muted" style="margin-bottom:var(--sp-4)">
        A snapshot is written before any migration runs. If a migration throws, it rolls back to that snapshot.</p>
      ${table(['Snapshot', ['Size', 'num'], ''], backups.map(b => `<tr>
        <td class="nowrap">v${b.version}<span class="sub">${esc(timeAgo(b.ts))}</span></td>
        <td class="num">${(b.bytes / 1024).toFixed(0)} KB</td>
        <td class="act"><button class="btn btn--ghost btn--sm" data-act="admin.restore" data-key="${esc(b.key)}">Restore</button></td></tr>`).join(''),
        'No backups yet.')}
      <div class="ad-actions" style="margin-top:var(--sp-5)">
        <button class="btn btn--secondary btn--sm grow" data-act="admin.snapshot">Take snapshot</button>
        <button class="btn btn--secondary btn--sm grow" data-act="admin.export">Export JSON</button>
      </div>
      <p class="tiny muted" style="margin-top:var(--sp-4)">
        Storage used: ${(persist.usageBytes() / 1024).toFixed(0)} KB ·
        migrations registered: ${migrate.listMigrations().length}</p>
    </div>
  </div>

  ${freshCard(st)}

  <div class="sec">${secHead('Change admin password')}
    <div class="card ad-fields" style="max-width:520px">
      <div class="field"><input id="pwNew" type="password" placeholder=" "><label>New password</label></div>
      <button class="btn btn--primary btn--block" data-act="admin.changepw">Change password</button>
      <p class="tiny muted">
        Stored as PBKDF2-SHA256, 250,000 iterations, with a random salt. Read docs/SECURITY.md for
        what client-side auth can and cannot protect.</p>
    </div>
  </div>

  <div class="sec">${secHead(`Audit log · ${audit.count()}`,
      `<button class="more" data-act="admin.exportaudit">Export CSV</button>`)}
    <div style="max-height:420px;overflow-y:auto;border-bottom:2px solid var(--color-divider)">
      ${table(['When', 'Action', 'Actor', 'Detail'], audit.entries({ limit: 60 }).map(e => `<tr>
        <td class="nowrap">${esc(clockTime(e.ts))}</td>
        <td class="nowrap"><b>${esc(e.action)}</b></td>
        <td class="nowrap tiny muted">${esc(e.actor)}</td>
        <td class="tiny muted">${esc(JSON.stringify(e.detail).slice(0, 90))}</td></tr>`).join(''), 'Empty.')}
    </div>
  </div>`;
}

/* ── FRESH START — a clean slate, on purpose and on record ────
   Wipes every account, order and ledger entry. Keeps the owner's credential
   and the dials. Takes a snapshot first (restorable above), is audited with
   the counts, and needs the word FRESH plus the owner's password. */
function freshCard(st) {
  const c = fresh.counts(st);
  const residue = fresh.demoResidue(st).total;
  return `
  ${paymentsCard()}

  <div class="sec">${secHead('Fresh start', pill('irreversible without the snapshot', 'warn'))}
    <div class="card card--red ad-fields">
      <div class="eyebrow em" style="display:flex;align-items:center;gap:6px">${icon('trash', { size: 13 })} Wipe to a clean slate</div>
      <p class="tiny muted">
        Removes every account, every order and every ledger entry on this device. Keeps your
        credential and every dial on this console. A snapshot is taken first and the wipe is written
        to the audit log with the counts.</p>
      ${facts([
        `${c.users} users`, `${c.partners} pros`, `${c.shops} shops`,
        `${c.products} listings`, `${c.orders} orders`, `${c.ledger} ledger entries`,
      ])}
      ${residue > 0 ? `<p class="tiny" style="color:var(--warn)">
        ${residue} example record${residue === 1 ? '' : 's'} from the demo roster are on this device. They will be removed on the
        next boot without <span class="num">?demo=1</span> whether or not you press this.</p>` : ''}
      <div class="ad-g2" style="align-items:end;margin-top:var(--sp-4)">
        <div class="field" style="margin:0">
          <input id="freshWord" type="text" autocomplete="off" autocapitalize="characters" placeholder=" ">
          <label>Type FRESH to confirm</label></div>
        <button class="btn btn--danger btn--block" data-act="admin.fresh" style="margin-top:var(--sp-4)">Fresh start</button>
      </div>
      <p class="micro muted">You will be asked for your password. Your session stays open afterwards.</p>
    </div>
  </div>`;
}

/* ── the rail: sim until the Razorpay account exists ─────────── */
function paymentsCard() {
  const c = paymentsConfig();
  const live = c.mode === 'razorpay';
  return `
  <div class="sec">${secHead('Payments rail', pill(live ? 'Razorpay' : 'sandbox', live ? 'ok' : 'soft'))}
    <div class="card ad-fields">
      <p class="tiny muted">${esc(gateway.label())}. The public key id may sit here; the
        secret key never does — it lives in the Edge Functions' secrets (supabase/README.md). Switching to Razorpay with a
        missing key or URL fails closed: nothing is collected, nothing pretends to be.</p>
      <div class="ad-g2">
        <div class="field"><select id="payMode"><option value="sim"${live ? '' : ' selected'}>Sandbox — no real money</option><option value="razorpay"${live ? ' selected' : ''}>Razorpay — live rail</option></select><label>Mode</label></div>
        <div class="field"><input id="payKey" type="text" autocomplete="off" placeholder=" " value="${esc(c.keyId)}"><label>Razorpay key id (public)</label></div>
      </div>
      <div class="field"><input id="payFn" type="url" autocomplete="off" placeholder=" " value="${esc(c.functionsUrl)}"><label>Edge Functions URL</label></div>
      <div class="ad-actions">
        <button class="btn btn--primary" data-act="admin.payments.save">Save on this device</button>
        <button class="btn btn--secondary" data-act="admin.payments.clear">Back to sandbox</button>
      </div>
      <p class="micro muted">Saved on this device only. To ship it to every device, bake it into PAYMENTS in src/core/config.js.</p>
    </div>
  </div>`;
}

/* ── handlers ──────────────────────────────────────────────── */
export async function runTests() { testResult = await selftest.runAll(); toast(testResult.failed ? `${testResult.failed} test${testResult.failed === 1 ? '' : 's'} failed` : 'All tests passed'); ctx.render(); }
export async function doVerifyChain() { chainResult = await verifyChain(getState().ledger); toast(chainResult.ok ? 'Ledger intact' : `Broken at block ${chainResult.at}`); ctx.render(); }
export function toggleFlag(name) { flags.set(name, !flags.get(name)); audit.record(audit.ACTIONS.FLAG_TOGGLE, { name, value: flags.get(name) }, 'admin'); ctx.render(); }
export function approve(id, target) {
  const p = getState().partners.find(x => x.id === id); if (!p) return;
  const t = target ? Number(target) : Math.min(4, (p.tier | 0) + 1);
  // goes through the gate: an admin cannot lift a partner past self-verification
  if (V.approveTier(p, t, 'admin')) toast(`${p.name} → ${tier(t).label}`);
  ctx.render();
}
/* A person rings because they cannot get in. The owner checks who they are and
   reads out this code; it lasts half an hour and works once. The app shows it
   here and never again — only its hash is stored (domain/recovery.js). */
export async function resetPassword(key) {
  if (!key) { toast('That account has no sign-in to reset', 'warn'); return; }
  const r = await recovery.issue(key, 'admin');
  if (!r.ok) { toast(r.reason || 'Could not issue a reset', 'danger'); return; }
  sheet('Read this code out', `
    <p class="tiny muted" style="margin-bottom:12px">For ${esc(r.account.name)}${r.account.code ? ' · ' + esc(r.account.code) : ''}.
      Check it is really them before you read it out.</p>
    <div class="card" style="text-align:center;padding:18px">
      <div class="m-cap" style="margin:0 0 6px">One-time code</div>
      <b style="font:800 34px/1 var(--font-heading);letter-spacing:.14em">${esc(r.code)}</b>
    </div>
    <p class="tiny muted" style="margin-top:12px">It works once and expires in ${recovery.TTL_MS / 60000} minutes.
      They enter it on the sign-in screen under &ldquo;Forgotten it?&rdquo; with the new password they want.
      This code is not shown again — issue another if it is missed.</p>
    <button class="btn btn--block" style="margin-top:12px" data-act="sheet.close">Done</button>`);
  ctx.render();
}

export function suspend(id) {
  const p = getState().partners.find(x => x.id === id); if (!p) return;
  dispatch({ type: 'partner/patch', payload: { id, patch: { suspended: !p.suspended } } });
  audit.record(audit.ACTIONS.PARTNER_SUSPEND, { id, suspended: !p.suspended }, 'admin');
  toast(p.suspended ? 'Unsuspended' : 'Suspended'); ctx.render();
}
/* Money the owner moves by hand above STEPUP_THRESHOLD (₹5,000) re-asks for
   the owner password first — the promise in core/adminauth.js, kept here. */
const orderAmount = id => { const o = getState().orders.find(x => x.id === id) || {}; return balanceOf(getState().ledger, acct.escrow(o.id)) || o.customerPays || 0; };
const guardMoney = (id, why, fn) => (orderAmount(id) > adminauth.STEPUP_THRESHOLD ? stepUpThen(why, fn) : fn());
export async function release(id, pct) {
  return guardMoney(id, `Releasing ${M.fmt(orderAmount(id))} from escrow.`, async () => { await flow.confirmAndRelease(id, Number(pct)); ctx.render(); });
}
export async function refundRetail(id) {
  return guardMoney(id, `Refunding ${M.fmt(orderAmount(id))} to the customer.`, async () => { await flow.refundRetail(id); ctx.render(); });
}
/* THE CONSOLE PROMISED "three outcomes, with a written reason" AND STORED NONE.
   The signature took no reason and the dispute row kept none, so the pro on the
   other end got a number with no explanation — and the screen that was supposed
   to show him "the outcome and the reason" had nothing to show. */
export async function resolve(id, outcome, reason) {
  const d = getState().disputes.find(x => x.id === id); if (!d) return;
  const why = String(reason == null ? '' : reason).trim();
  if (!why) { toast('Write a line saying why — both sides are told what you decided', 'warn'); return; }
  const ord = getState().orders.find(x => x.id === d.orderId);
  /* This used to run BEFORE the money moved, stamping `resolvedAt` — and the
     "close it where the money actually moved" guards in flow.js both test
     `!d.resolvedAt`, so they never fired and the record kept `status: 'OPEN'`
     for ever. The note is recorded first because the outcome needs it; the
     status is settled after, by whichever path actually moved the money. */
  dispatch({ type: 'dispute/note', payload: { id, patch: { decidedNote: why, outcome } } });
  // the money moves first; the dispute is marked resolved by the release
  // itself (confirmAndRelease / refundRetail both close the linked dispute)
  // confirmAndRelease bails on a retail order AFTER the dispute has already
  // been flipped to RESOLVED, which is how a shop order ended up marked
  // settled with its money still locked.
  /* THE RETAIL BRANCH RAN BEFORE THE OUTCOME WAS CONSULTED, so every retail
     dispute was a full refund whatever the owner decided — the shop could never
     win one, and the three Resolve buttons were theatre. That is a fraud lane:
     order, receive, dispute, keep the goods and the money. */
  if (ord && ord.kind === 'retail') {
    /* AND ON A CLOSED ORDER BOTH BRANCHES WERE DEAD ENDS. Once she can complain
       after settlement (`flow.complaintWindow`), the queue receives disputes on
       orders whose escrow is already at zero: `settleRetail` has nothing left
       to distribute and `refundRetail` refuses outright with "Already closed",
       so the owner had three buttons and no remedy. The money is gone from
       escrow, so the remedy is SAAHAA's own — nothing is clawed back out of a
       shop that has been paid and has spent it. */
    if (['R_SETTLED', 'R_CLOSED'].includes(ord.stage)) {
      if (outcome === 'release') {
        ctx.store.dispatch({ type: 'dispute/resolve', payload: { id,
          patch: { status: 'RESOLVED', outcome: 'released', resolvedBy: 'admin', resolvedAt: Date.now() } } });
      } else {
        await flow.goodwillRefund(d.orderId,
          outcome === 'partial' ? Math.round((ord.customerPays | 0) * 0.6) : (ord.customerPays | 0), why);
      }
    }
    else if (outcome === 'release') await flow.settleRetail(d.orderId);
    else await flow.refundRetail(d.orderId, why);
  }
  else if (outcome === 'release') await flow.confirmAndRelease(d.orderId, 1);
  else if (outcome === 'partial') await flow.confirmAndRelease(d.orderId, 0.6);
  else await flow.confirmAndRelease(d.orderId, 0);
  ctx.store.dispatch({ type: 'order/patch', payload: { id: d.orderId, patch: { disputeDecidedNote: why, disputeOutcome: outcome } } });
  audit.record('dispute.resolved', { id, outcome, reason: why }, 'admin');
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

/* ── step-up: re-type the password before real money or a wipe ──
   adminauth.stepUp does the PBKDF2 compare; this is only the sheet around
   it. The button is wired directly (no new data-act — app.js is the one
   file that registers actions), the password never leaves the input. */
function stepUpThen(why, fn) {
  const el = sheet('Confirm it is you', `
    <p class="tiny muted" style="margin-bottom:12px">${esc(why)} Re-type the owner password to continue.</p>
    <div class="field"><input id="suPass" type="password" placeholder=" " autocomplete="current-password"><label>Owner password</label></div>
    <button class="btn btn--primary btn--block" id="suGo">Confirm</button>
    <p class="micro muted" style="margin-top:10px">Every step-up, right or wrong, is written to the audit log.</p>`);
  const input = $('#suPass', el), go = $('#suGo', el);
  let busy = false;
  const attempt = async () => {
    if (busy) return; busy = true;
    const pw = input ? input.value : '';
    const ok = pw && await adminauth.stepUp(pw, getState().admin);
    busy = false;
    if (!ok) { toast('That password is not right', 'danger'); if (input) input.value = ''; return; }
    closeSheet();
    await fn();
  };
  if (go) go.addEventListener('click', attempt);
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
}

/* ── the treasury ──────────────────────────────────────────── */
function paiseIn(id) {
  const v = fieldVal(id);
  const n = Number(v);
  return v === '' || !Number.isFinite(n) ? NaN : M.toPaise(n);
}

export async function treasuryWithdraw(d) {
  const amt = paiseIn('trAmt');
  if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount in rupees', 'danger'); return; }
  const run = async () => {
    const r = await treasury.withdrawFees(amt, 'admin');
    toast(r.ok ? `Withdrew ${M.fmt(r.amt)} to the company bank` : (r.reason || 'Could not withdraw'), r.ok ? '' : 'danger');
    ctx.render();
  };
  if (amt > adminauth.STEPUP_THRESHOLD) stepUpThen(`You are moving ${M.fmt(amt)} of our earnings to the bank.`, run);
  else await run();
}

export async function treasuryRemit(d) {
  const amt = paiseIn('trGst');
  if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount in rupees', 'danger'); return; }
  const run = async () => {
    const r = await treasury.remitGst(amt, 'admin');
    toast(r.ok ? `Remitted ${M.fmt(r.amt)} of GST` : (r.reason || 'Could not remit'), r.ok ? '' : 'danger');
    ctx.render();
  };
  if (amt > adminauth.STEPUP_THRESHOLD) stepUpThen(`You are remitting ${M.fmt(amt)} of GST to the government.`, run);
  else await run();
}

/* ── the automation dials ──────────────────────────────────── */
const fieldOn = id => { const el = typeof document !== 'undefined' ? document.getElementById(id) : null; return el ? !!el.checked : null; };

export function pushAutomation() {
  const input = {
    autoApprove: fieldOn('atAuto'),
    bgJobs:      fieldVal('atJobs'),
    bgRating:    fieldVal('atRating'),
    bgVouches:   fieldVal('atVouches'),
    bgReference: fieldOn('atReference'),
    certDays:    fieldVal('atCertDays'),
  };
  const r = settings.pushAutomation(input, 'admin');
  if (!r.ok) { toast(r.errors.join(' · ') || 'Those numbers do not add up', 'danger'); ctx.render(); return; }
  audit.record('automation.push', r.clean, 'admin');
  toast(r.clean.autoApprove ? 'Pushed — the network promotes by itself' : 'Pushed — automation is off, tiers 3 and 4 wait for you');
  ctx.render();
}

export function resetAutomation() {
  const D = settings.DEFAULT_AUTOMATION;
  const r = settings.pushAutomation({
    autoApprove: D.autoApprove, bgJobs: D.bgJobs, bgRating: D.bgRating,
    bgVouches: D.bgVouches, bgReference: D.bgReference, certDays: D.certDays,
  }, 'admin');
  if (!r.ok) { toast(r.errors.join(' · ') || 'Could not reset', 'danger'); return; }
  audit.record('automation.reset', r.clean, 'admin');
  toast('Back to the launch defaults');
  ctx.render();
}

/* ── fresh start ───────────────────────────────────────────── */
export function savePayments() {
  const mode = fieldVal('payMode') || 'sim', keyId = fieldVal('payKey').trim(), functionsUrl = fieldVal('payFn').trim();
  if (mode === 'razorpay' && (!/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId) || !/^https:\/\//.test(functionsUrl))) {
    toast('Razorpay mode needs a public key id (rzp_test_… / rzp_live_…) and an https Functions URL', 'danger'); return;
  }
  const next = setPaymentsConfig({ mode, keyId, functionsUrl });
  audit.record('payments.config', { mode: next.mode, keyId: next.keyId.slice(0, 12), functionsUrl: next.functionsUrl }, 'admin');
  toast(next.mode === 'razorpay' ? 'Razorpay rail set on this device' : 'Back to the sandbox rail'); ctx.render();
}
export function clearPayments() { clearPaymentsConfig(); audit.record('payments.config', { mode: 'sim' }, 'admin'); toast('Back to the sandbox rail'); ctx.render(); }

export function freshStart() {
  if (fieldVal('freshWord').toUpperCase() !== 'FRESH') { toast('Type FRESH in the box to confirm', 'danger'); return; }
  stepUpThen('This wipes every account, order and ledger entry on this device.', () => {
    const b = fresh.freshStart('admin');
    toast(`Fresh start — removed ${b.users} users, ${b.partners} pros, ${b.shops} shops, ${b.orders} orders, ${b.ledger} ledger entries. Snapshot kept.`);
    section = 'system';
    ctx.render();
  });
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
