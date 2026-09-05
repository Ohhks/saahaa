/* SAAHAA · ui/views/admin.js — the admin console, INSIDE the website.
   Sign in on the normal login screen with the name "admin", or open #/admin.

   Eight sections, no more: an admin console with twenty nav items is an
   unused admin console. Each screen separates what the ADMIN DOES BY HAND
   from what the SYSTEM COMPUTES — the distinction the owner asked for. */

import { esc, toast, timeAgo, clockTime } from '../dom.js';
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
import { trustScore, tier } from '../../domain/trust.js';
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

/* ══════════════ LOGIN ══════════════ */
export function renderLogin() {
  const g = adminauth.gateStatus();
  return `
  <div class="on-plum" style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div style="width:100%;max-width:360px;text-align:center">
      <div style="display:flex;justify-content:center;margin-bottom:20px">${mark(96, { detail: true })}</div>
      <div class="wordmark" style="font-size:26px">SAAHAA</div>
      <p class="micro muted" style="letter-spacing:.14em;margin:6px 0 28px">ADMIN CONSOLE</p>

      ${g.blocked ? `<div class="card" style="border-color:var(--danger);margin-bottom:16px">
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

  return `
  <header class="hdr on-plum" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      ${mark(28, { glow: false })}
      <div class="grow"><b style="display:block">Admin console</b>
        <span class="micro muted">v${VERSION} “${CODENAME}” · schema v${SCHEMA_VERSION} · ${BUILD_ID}</span></div>
      <button class="btn btn--ghost btn--sm" data-act="admin.logout">Sign out</button>
    </div>
  </header>
  <main class="wrap">
    ${st.admin.isDemo ? `<div class="card" style="border-color:var(--warn);background:var(--warn-soft);margin-top:var(--sp-6)">
      <b class="tiny" style="color:var(--warn)">⚠ Prototype mode — simulated escrow, no real funds.</b>
      <p class="micro" style="margin-top:6px;color:var(--warn)">
        You are on the shipped demo password. Change it in System &amp; audit before anyone else uses this.</p>
    </div>` : ''}

    <div class="chiprow" style="margin:var(--sp-6) 0">
      ${SECTIONS.map(([k, l]) => `<button class="chip ${section === k ? 'on' : ''}"
        data-act="admin.sec" data-sec="${k}">${esc(l)}</button>`).join('')}
    </div>

    ${section === 'dash' ? dash(st)
    : section === 'approvals' ? approvals(st)
    : section === 'escrow' ? escrow(st)
    : section === 'disputes' ? disputes(st)
    : section === 'people' ? people(st)
    : section === 'moderation' ? moderation(st)
    : section === 'finance' ? finance(st)
    : system(st)}
    <div style="height:60px"></div>
  </main>`;
}

const kpi = (k, v, sub) => `<div class="card" style="padding:14px">
  <div class="k tiny muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">${k}</div>
  <div class="num" style="font-size:23px;font-weight:800;margin-top:4px">${v}</div>
  ${sub ? `<div class="micro muted" style="margin-top:2px">${sub}</div>` : ''}</div>`;

const note = (auto, manual) => `<div class="card" style="background:var(--surface-2);margin-bottom:var(--sp-6)">
  <p class="micro"><b>System computes:</b> <span class="muted">${esc(auto)}</span></p>
  <p class="micro" style="margin-top:6px"><b>You do by hand:</b> <span class="muted">${esc(manual)}</span></p></div>`;

/* ── 1. DASHBOARD ─────────────────────────────────────────── */
function dash(st) {
  const a = st.agg;
  const pending = st.users.filter(u => u.role !== 'customer' && u.tier <= 1).length;
  const openD = st.disputes.filter(d => d.status === 'OPEN').length;
  const liveOrders = st.orders.filter(o => !stage(o.stage).terminal).length;
  return `
  ${note('every number on this screen, live from the ledger and the order registry',
         'nothing — this screen is read-only by design')}
  <div class="grid2">
    ${kpi('Users', st.users.length, `${st.users.filter(u => u.role === 'customer').length} customers`)}
    ${kpi('Partners', st.partners.length, `${st.shops.length} shops`)}
    ${kpi('Orders', st.orders.length, `${liveOrders} live`)}
    ${kpi('Revenue', M.fmt(a.revenue), `GST ${M.fmt(a.gst)} collected`)}
    ${kpi('GMV', M.fmt(a.gmv), 'paid to pros & shops')}
    ${kpi('In escrow', M.fmt(a.escrow), 'locked, not revenue')}
    ${kpi('Pending approvals', pending, 'partners awaiting tier')}
    ${kpi('Open disputes', openD, openD ? 'action needed' : 'all clear')}
    ${kpi('Customer savings', M.fmt(a.saved), 'vs commission apps')}
    ${kpi('Listings', st.products.length, 'products across all shops')}
  </div>
  <div class="sec"><div class="hd"><h2>Booking statistics</h2></div>
    <div class="card">${byStage(st)}</div></div>
  <div class="sec"><div class="hd"><h2>Rating statistics</h2></div>
    <div class="card">${ratingStats(st)}</div></div>`;
}
function byStage(st) {
  const counts = {};
  st.orders.forEach(o => { counts[o.stage] = (counts[o.stage] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="tiny muted">No orders yet.</p>';
  const max = rows[0][1];
  return rows.map(([s, n]) => `<div style="margin-bottom:8px">
    <div class="between"><span class="tiny">${esc(stage(s).label)}</span><b class="num tiny">${n}</b></div>
    <div style="height:5px;border-radius:3px;background:var(--border);margin-top:3px">
      <div style="height:100%;border-radius:3px;background:var(--gold-grad-soft);width:${(n / max) * 100}%"></div></div>
  </div>`).join('');
}
function ratingStats(st) {
  const all = st.partners.flatMap(p => p.ratings || []);
  if (!all.length) return '<p class="tiny muted">No ratings yet.</p>';
  const avg = all.reduce((n, r) => n + r.stars, 0) / all.length;
  const dist = [5,4,3,2,1].map(s => [s, all.filter(r => r.stars === s).length]);
  return `<div class="between" style="margin-bottom:12px">
      <b class="num" style="font-size:26px">${avg.toFixed(2)}</b>
      <span class="tiny muted">${all.length} ratings across ${st.partners.length} pros</span></div>
    ${dist.map(([s, n]) => `<div class="between" style="margin-bottom:5px">
      <span class="tiny">${s} ★</span>
      <div style="flex:1;height:5px;border-radius:3px;background:var(--border);margin:0 10px">
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
  <div class="sec"><div class="hd"><h2>Partner applications · ${queue.length}</h2></div>
    ${queue.length ? queue.map(p => {
      const t = trustScore(p);
      const v = p.verification || {};
      const bg = v.background || {};
      const next = Math.min(4, (p.tier | 0) + 1);
      const e = V.certifiedEligible(p);
      return `<div class="card" style="margin-bottom:10px">
        <div class="between"><div class="grow"><b>${esc(p.name)}</b>
          <p class="tiny muted">${esc(get('category', p.cat).name)} · ${esc(p.area)} ·
            ${esc(tier(p.tier).label)} · trust ${t.score}</p></div>
          <span class="badge badge--${t.band.tone === 'gold' ? 'gold' : t.band.tone === 'ok' ? 'ok' : 'warn'}">${t.band.label}</span></div>
        <div class="card" style="margin-top:10px;padding:10px 12px;background:var(--surface-2)">
          ${next === 3 ? `<b class="tiny">Background check requested ${timeAgo(bg.at)}</b>
            <p class="micro muted">ID ${esc((v.idType || '').toUpperCase())} …${esc(v.idLast4 || '????')} · reference: ${esc(bg.refName || '—')} (…${esc(bg.refPhone || '')}) · consent given</p>
            <p class="micro muted">Call the reference. Approve only after the call.</p>`
          : `<b class="tiny">Qualifies for Certified</b>
            <p class="micro muted">${e.completed} jobs · rating ${e.avg.toFixed(1)} · ${p.disputesUpheld || 0} upheld disputes</p>`}
        </div>
        <div class="row" style="margin-top:12px;gap:8px">
          <button class="btn btn--primary btn--sm grow" data-act="admin.approve" data-id="${p.id}" data-tier="${next}">Approve → ${esc(tier(next).label)}</button>
          <button class="btn btn--ghost btn--sm" data-act="admin.suspend" data-id="${p.id}">Suspend</button>
        </div></div>`;
    }).join('') : '<p class="tiny muted">Nothing needs you. Partners verify themselves.</p>'}</div>
  <div class="sec"><div class="hd"><h2>Self-verifying now · ${inProgress.length}</h2></div>
    ${inProgress.length ? inProgress.map(p => { const r = V.readiness(p); return `<div class="card" style="margin-bottom:8px;padding:11px 14px">
      <div class="between"><span class="tiny">${esc(p.name)} <span class="micro muted">· ${esc(get('category', p.cat).name)}</span></span>
        <span class="micro muted">${r.pct}% · next: ${esc(r.next ? r.next.title : '—')}</span></div></div>`; }).join('')
      : '<p class="tiny muted">Nobody mid-way.</p>'}</div>
  <div class="sec"><div class="hd"><h2>Shop applications · ${shops.length}</h2></div>
    ${shops.length ? shops.map(s => `<div class="card" style="margin-bottom:10px">
      <b>${esc(s.name)}</b><p class="tiny muted">${esc(s.area)}</p></div>`).join('')
      : '<p class="tiny muted">No shops waiting.</p>'}</div>`;
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
  <div class="card card--gold" style="margin-bottom:var(--sp-6)">
    <div class="between"><b>Locked in escrow</b>
      <b class="num" style="font-size:22px">${M.fmt(st.agg.escrow)}</b></div>
    <p class="micro muted" style="margin-top:6px">Customers' money, not revenue. Released only on confirmation or review.</p>
  </div>
  ${held.length ? held.map(o => `<div class="card" style="margin-bottom:10px">
    <div class="between"><div class="grow">
      <b>${esc(o.kind === 'service' ? o.partnerName : o.shopName)}</b>
      <p class="tiny muted">${esc(o.customerName)} · ${esc(stage(o.stage).label)} ·
        ${o.escrowTier || 'STANDARD'} · ${timeAgo(o.stageTs)}</p>
      <p class="micro muted">${(o.evidence || []).length} photo(s) · ${o.otpVerified ? 'OTP verified' : 'no OTP'}</p>
    </div><b class="num">${M.fmt(o.customerPays)}</b></div>
    <div class="row" style="margin-top:12px;gap:8px">
      <button class="btn btn--primary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="1">Release 100%</button>
      <button class="btn btn--secondary btn--sm grow" data-act="admin.release" data-id="${o.id}" data-pct="0.6">Partial 60%</button>
    </div></div>`).join('') : '<p class="tiny muted">Nothing awaiting release.</p>'}

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
  return `<div class="sec"><div class="hd"><h2>Shop orders in flight</h2>
      <span class="tiny muted">${stuck.filter(o => now - (o.stageTs || 0) > STALE_MS).length} stalled</span></div>
    ${stuck.map(o => {
      const stale = now - (o.stageTs || 0) > STALE_MS;
      return `<div class="card" style="margin-bottom:10px;${stale ? 'border-color:var(--warn)' : ''}">
        <div class="between"><div class="grow">
          <b>${esc(o.shopName || 'Shop')}</b>
          <p class="tiny muted">${esc(o.customerName)} · ${esc(stage(o.stage).label)} · ${timeAgo(o.stageTs)}</p>
          ${stale ? '<p class="micro" style="color:var(--warn)">Stalled — the shop has not moved this on.</p>' : ''}
        </div><b class="num">${M.fmt(o.customerPays)}</b></div>
        <button class="btn btn--secondary btn--sm btn--block" style="margin-top:10px"
          data-act="admin.refundretail" data-id="${o.id}">Refund the customer in full</button>
      </div>`;
    }).join('')}</div>`;
}

/* ── 4. DISPUTES ──────────────────────────────────────────── */
function disputes(st) {
  const open = st.disputes.filter(d => d.status === 'OPEN');
  return `
  ${note('intake, SLA clock (red past 24h), auto-resolution rules, evidence bundling, auto-escalation at 72h',
         'read the evidence and pick one of three outcomes, with a written reason')}
  ${open.length ? open.map(d => {
    const o = st.orders.find(x => x.id === d.orderId) || {};
    const ageH = (Date.now() - d.openedAt) / 3600000;
    return `<div class="card" style="margin-bottom:10px;${ageH > 24 ? 'border-color:var(--danger)' : ''}">
      <div class="between"><div class="grow"><b>${esc(d.reason)}</b>
        <p class="tiny muted">${esc(o.customerName || '')} vs ${esc(o.partnerName || o.shopName || '')} · ${timeAgo(d.openedAt)}</p>
        <p class="micro muted">${(o.evidence || []).length} photo(s) · ${o.otpVerified ? 'start code verified' : 'NO start code'}</p></div>
        <span class="badge ${ageH > 24 ? 'badge--bad' : 'badge--warn'}">${Math.round(ageH)}h</span></div>
      <div class="row" style="margin-top:12px;gap:6px">
        <button class="btn btn--primary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="release">Release 100%</button>
        <button class="btn btn--secondary btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="partial">Partial 60%</button>
        <button class="btn btn--ghost btn--sm grow" data-act="admin.resolve" data-id="${d.id}" data-out="refund">Full refund</button>
      </div></div>`;
  }).join('') : '<p class="tiny muted">No open disputes.</p>'}`;
}

/* ── 5. PEOPLE ────────────────────────────────────────────── */
function people(st) {
  return `
  ${note('trust scores, lifetime stats, earnings ledgers, risk flags, duplicate-account clusters',
         'suspend, ban, promote or demote a tier, waive a strike, adjust a wallet with a reason')}
  <div class="sec"><div class="hd"><h2>Pros · ${st.partners.length}</h2></div>
    ${st.partners.map(p => {
      const t = trustScore(p);
      return `<div class="card" style="padding:12px;margin-bottom:8px">
        <div class="between"><div class="grow"><b class="tiny">${esc(p.name)}</b>
          <p class="micro muted">${esc(get('category', p.cat).name)} · ${p.completed} jobs ·
            ${esc(tier(p.tier).label)} · ${esc(p.area)}</p></div>
          <div style="text-align:right"><b class="num tiny">${t.score}</b>
            <p class="micro muted">${t.band.label}</p></div></div>
        <div class="row" style="margin-top:8px;gap:6px">
          <button class="btn btn--ghost btn--sm" data-act="admin.suspend" data-id="${p.id}">
            ${p.suspended ? 'Unsuspend' : 'Suspend'}</button>
          ${(p.tier | 0) >= 4 ? '<span class="badge badge--gold">Top tier</span>'
            : `<button class="btn btn--ghost btn--sm" data-act="admin.approve" data-id="${p.id}">Promote</button>`}
        </div></div>`;
    }).join('')}</div>
  <div class="sec"><div class="hd"><h2>Customers · ${st.users.filter(u => u.role === 'customer').length}</h2></div>
    ${st.users.filter(u => u.role === 'customer').map(u => `<div class="card" style="padding:11px;margin-bottom:7px">
      <div class="between"><span class="tiny">${esc(u.name)} · ${esc(u.mobile)}</span>
        <span class="badge badge--soft">${esc(u.area)}</span></div></div>`).join('')}</div>`;
}

/* ── 6. MODERATION ────────────────────────────────────────── */
function moderation(st) {
  const flagged = Object.entries(st.chats).flatMap(([oid, ms]) =>
    ms.filter(m => m.flagged).map(m => ({ ...m, oid })));
  return `
  ${note('profanity, phone-number and payment-ID detection in chat, fake-review burst detection, auto-quarantine',
         'remove or restore a review, action a flagged chat, edit a listing')}
  <div class="sec"><div class="hd"><h2>Off-platform payment attempts · ${flagged.length}</h2></div>
    <p class="tiny muted" style="margin-bottom:12px">
      The single biggest revenue leak in a local marketplace: a pro asking to be paid in cash outside the app.
      Numbers and UPI handles are masked automatically; repeat offences cost trust points.</p>
    ${flagged.length ? flagged.map(m => `<div class="card" style="padding:11px;margin-bottom:7px">
      <div class="between"><span class="tiny">${esc(m.name)}</span>
        <span class="micro muted">${clockTime(m.ts)}</span></div>
      <p class="tiny muted" style="margin-top:4px">${esc(m.text)}</p></div>`).join('')
      : '<p class="tiny muted">Nothing flagged.</p>'}</div>
  <div class="sec"><div class="hd"><h2>Reviews · ${st.reviews.length}</h2></div>
    ${st.reviews.length ? st.reviews.slice(0, 20).map(r => `<div class="card" style="padding:11px;margin-bottom:7px">
      <div class="between"><span class="tiny">${r.stars}★ ${esc(r.byName || r.by || '')}</span>
        <button class="btn btn--ghost btn--sm" data-act="admin.hidereview" data-id="${r.id}">Hide</button></div></div>`).join('')
      : '<p class="tiny muted">No reviews yet.</p>'}</div>`;
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

  <div class="card ${drift ? '' : 'card--gold'}" style="${drift ? 'border-color:var(--danger)' : ''}">
    <b>Reconciliation ${drift ? '⚠ DRIFT' : '✓ balanced'}</b>
    <p class="micro muted" style="margin:8px 0 12px">
      Escrow held, ledger replay and the aggregate must agree. If they ever don't, everything else on
      this screen is fiction — that is why this box sits at the top.</p>
    <div class="between" style="margin-bottom:6px"><span class="tiny">Aggregate escrow</span><b class="num tiny">${M.fmt(a.escrow)}</b></div>
    <div class="between" style="margin-bottom:6px"><span class="tiny">Ledger replay</span><b class="num tiny">${M.fmt(escrowLedger)}</b></div>
    <div class="between"><span class="tiny">Difference</span>
      <b class="num tiny" style="color:var(--${drift ? 'danger' : 'success'})">${M.fmt(Math.abs(escrowLedger - a.escrow))}</b></div>
  </div>

  <div class="grid2" style="margin-top:var(--sp-6)">
    ${kpi('Platform revenue', M.fmt(a.revenue), 'net of GST')}
    ${kpi('GST collected', M.fmt(a.gst), '18% of the fee, remitted')}
    ${kpi('Refunds', M.fmt(a.refunds), 'returned to customers')}
    ${kpi('Ledger blocks', st.chain.length, 'hash-chained')}
  </div>

  <div class="sec"><div class="hd"><h2>Payout queue</h2></div>
    ${payoutQueue(st)}</div>

  <div class="sec"><div class="hd"><h2>Ledger</h2>
    <button class="more" data-act="admin.verifychain">Verify chain</button></div>
    ${chainResult ? `<p class="tiny" style="color:var(--${chainResult.ok ? 'success' : 'danger'});margin-bottom:10px">
      ${chainResult.ok ? `✓ ${st.chain.length} blocks verified` : `✗ broken at block ${chainResult.at} (${chainResult.reason})`}</p>` : ''}
    <div class="card" style="max-height:260px;overflow-y:auto">
      ${st.ledger.slice(-30).reverse().map(b => `<div class="between" style="margin-bottom:7px">
        <span class="micro">#${b.blockIdx} ${esc(b.kind)} <span class="muted">${esc(b.partyA)} → ${esc(b.partyB)}</span></span>
        <b class="num micro">${M.fmt(b.amountPaise)}</b></div>`).join('') || '<p class="tiny muted">Empty.</p>'}
    </div>
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
  if (!rows.length) return '<p class="tiny muted">Nothing to pay out yet.</p>';
  return rows.map(([who, v]) => `<div class="card" style="padding:11px;margin-bottom:7px">
    <div class="between"><span class="tiny">${esc(who)}<span class="micro muted"> · ${v.ids.length} order(s)</span></span>
      <div class="row" style="gap:8px"><b class="num tiny">${M.fmt(v.amt)}</b>
        <button class="btn btn--secondary btn--sm" data-act="admin.markpaid"
          data-ids="${esc(v.ids.join(','))}">Mark paid</button></div></div></div>`).join('');
}

/* ── 8. SYSTEM & AUDIT — the DevOps screen ────────────────── */
function system(st) {
  const h = checkHealth(st);
  const backups = migrate.listBackups();
  return `
  ${note('health checks, registry integrity, storage quota, migration history, the audit log',
         'change the admin password, flip feature flags, run the self-test, restore a backup, export everything')}

  <div class="card" style="margin-bottom:var(--sp-6)">
    <div class="between"><b>Health ${h.ok ? '✓' : h.fatal ? '✗ fatal' : '⚠'}</b>
      <span class="badge badge--${h.ok ? 'ok' : h.fatal ? 'bad' : 'warn'}">${h.checks.filter(c => c.ok).length}/${h.checks.length}</span></div>
    <div style="margin-top:10px">${h.checks.map(c => `<div class="between" style="margin-bottom:5px">
      <span class="micro">${c.ok ? '✓' : '✗'} ${esc(c.id)}</span>
      <span class="micro muted">${esc(c.detail)}</span></div>`).join('')}</div>
  </div>

  <div class="sec"><div class="hd"><h2>Self-test — this is our CI</h2>
    <button class="more" data-act="admin.runtests">Run ${selftest.caseCount()} tests</button></div>
    ${testResult ? `<div class="card" style="border-color:var(--${testResult.failed ? 'danger' : 'success'})">
      <b style="color:var(--${testResult.failed ? 'danger' : 'success'})">
        ${testResult.passed} passed · ${testResult.failed} failed · ${testResult.durationMs}ms</b>
      ${testResult.failures.length ? testResult.failures.map(f => `<p class="micro" style="margin-top:8px;color:var(--danger)">
        ${esc(f.suite)} › ${esc(f.case)}<br>${esc(f.message)}</p>`).join('')
        : '<p class="micro muted" style="margin-top:6px">Money math, state transitions, migration idempotence and referential integrity all hold.</p>'}
      <div style="margin-top:10px">${testResult.suites.map(s => `<div class="between" style="margin-bottom:4px">
        <span class="micro">${esc(s.name)}</span>
        <span class="micro ${s.failed ? '' : 'muted'}" style="${s.failed ? 'color:var(--danger)' : ''}">${s.passed}/${s.passed + s.failed}</span>
      </div>`).join('')}</div>
    </div>` : '<p class="tiny muted">Not run yet this session. A release with any failure does not ship.</p>'}
  </div>

  <div class="sec"><div class="hd"><h2>Feature flags</h2></div>
    <p class="tiny muted" style="margin-bottom:12px">
      Every new feature ships default-off for one release. These are the kill-switch and the canary.</p>
    ${flags.all().map(f => `<div class="card" style="padding:11px;margin-bottom:7px">
      <div class="between"><div class="grow"><b class="tiny">${esc(f.name)}</b>
        <p class="micro muted">default ${String(f.default)} · source ${esc(f.source)}</p></div>
        <button class="btn ${f.value ? 'btn--primary' : 'btn--ghost'} btn--sm"
          data-act="admin.flag" data-name="${esc(f.name)}">${f.value ? 'ON' : 'OFF'}</button></div></div>`).join('')}
  </div>

  <div class="sec"><div class="hd"><h2>Registry</h2></div>
    <div class="card">
      ${namespaces().map(ns => `<div class="between" style="margin-bottom:5px">
        <span class="tiny">${esc(ns)}</span><b class="num tiny">${count(ns)}</b></div>`).join('')}
      <p class="micro muted" style="margin-top:10px">
        Every one of these is an extension point. Adding a category, an order stage, a reducer or a
        migration means registering one more entry — no existing file changes.</p>
    </div>
  </div>

  <div class="sec"><div class="hd"><h2>Backups &amp; migration</h2></div>
    <div class="card">
      <p class="tiny muted" style="margin-bottom:10px">
        A snapshot is written before any migration runs. If a migration throws, it rolls back to that snapshot.</p>
      ${backups.length ? backups.map(b => `<div class="between" style="margin-bottom:6px">
        <span class="micro">v${b.version} · ${timeAgo(b.ts)} · ${(b.bytes / 1024).toFixed(0)} KB</span>
        <button class="btn btn--ghost btn--sm" data-act="admin.restore" data-key="${esc(b.key)}">Restore</button>
      </div>`).join('') : '<p class="tiny muted">No backups yet.</p>'}
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn btn--secondary btn--sm grow" data-act="admin.snapshot">Take snapshot</button>
        <button class="btn btn--secondary btn--sm grow" data-act="admin.export">Export JSON</button>
      </div>
      <p class="micro muted" style="margin-top:10px">
        Storage used: ${(persist.usageBytes() / 1024).toFixed(0)} KB ·
        migrations registered: ${migrate.listMigrations().length}</p>
    </div>
  </div>

  <div class="sec"><div class="hd"><h2>Change admin password</h2></div>
    <div class="card">
      <div class="field"><input id="pwNew" type="password" placeholder=" "><label>New password</label></div>
      <button class="btn btn--primary btn--block" data-act="admin.changepw">Change password</button>
      <p class="micro muted" style="margin-top:10px">
        Stored as PBKDF2-SHA256, 250,000 iterations, with a random salt. Read docs/SECURITY.md for
        what client-side auth can and cannot protect.</p>
    </div>
  </div>

  <div class="sec"><div class="hd"><h2>Audit log · ${audit.count()}</h2>
    <button class="more" data-act="admin.exportaudit">Export CSV</button></div>
    <div class="card" style="max-height:280px;overflow-y:auto">
      ${audit.entries({ limit: 60 }).map(e => `<div style="margin-bottom:8px">
        <div class="between"><b class="micro">${esc(e.action)}</b>
          <span class="micro muted">${clockTime(e.ts)}</span></div>
        <p class="micro muted">${esc(e.actor)} · ${esc(JSON.stringify(e.detail).slice(0, 90))}</p></div>`).join('')
        || '<p class="tiny muted">Empty.</p>'}
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
