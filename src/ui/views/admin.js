/* SAAHAA · ui/views/admin.js — the admin COMMAND CENTRE, inside the website.
   Sign in on the normal login screen with the name "admin", or open #/admin.

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

import { esc, toast, timeAgo, clockTime } from '../dom.js';
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
import { mark } from '../logo.js';

let section = 'dash';
let testResult = null, chainResult = null;
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

      <div class="field"><input id="adUser" placeholder=" " value="admin" autocomplete="username"><label>Username</label></div>
      <div class="field"><input id="adPass" type="password" placeholder=" " autocomplete="current-password"><label>Password</label></div>
      <button class="btn btn--primary btn--lg btn--block" data-act="admin.login" ${g.blocked ? 'disabled' : ''}>
        Sign in</button>
      <button class="btn btn--ghost btn--block" style="margin-top:8px" data-act="nav.home">← Back to SAAHAA</button>

      <p class="micro muted" style="margin-top:24px;line-height:1.7">
        Prototype credential: <b>admin</b> / <b>saahaa123</b><br>
        Change it in System once you're in.
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
  toast('Signed in as admin');
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
      <div class="eyebrow" style="color:var(--warn);display:flex;align-items:center;gap:6px">${icon('warn', { size: 13 })} Prototype mode</div>
      <b class="tiny" style="color:var(--warn)">Simulated escrow, no real funds.</b>
      <p class="tiny muted" style="margin-top:6px;color:var(--warn)">
        You are on the shipped demo password. Change it in System &amp; audit before anyone else uses this.</p>
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
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
