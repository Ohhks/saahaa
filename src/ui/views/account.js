/* SAAHAA · ui/views/account.js — "My SAAHAA", the customer's own hub.

   Lifted out of app.js unchanged in behaviour: every control it had is still
   here, under the same data-act names (nav.orders, area.pick, splash.replay,
   theme.toggle, nav.admin, selftest.run, auth.logout). What it gains is
   context — each card now shows the real thing behind it instead of a label
   with nothing under it.

   NOTHING IS INVENTED. Where there is no data there is a smart empty state
   that offers a real next step, never a placeholder row that looks like a
   record. And money never mixes: what the customer paid, what sits in escrow,
   what came back as a refund and what was a goodwill credit are four separate
   things, chipped as four separate states. */

import { esc, ratingStars, timeAgo, clockTime } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { mark } from '../logo.js';
import { VERSION, SCHEMA_VERSION, BUILD_ID } from '../../core/version.js';
import { stage, isTerminal, trackerFor, trackerIndex } from '../../domain/orders.js';
import { header, emptyBlock } from './shops.js';
import * as auth from './auth.js';

const TONE_PILL = { ok:'pill--ok', info:'pill--info', warn:'pill--warn', bad:'pill--bad', soft:'pill--soft' };

/* one card shape for the whole hub, so the grid reads as one object */
function card(title, eyebrow, body, opts = {}) {
  const act = opts.act
    ? ` data-act="${opts.act}"${opts.id ? ` data-id="${esc(opts.id)}"` : ''}` : '';
  const tag = opts.act ? 'button' : 'div';
  return `<${tag} class="cmd glass${opts.gold ? ' glass--gold' : ''} acct-card"${act}
      ${opts.act ? 'style="width:100%;text-align:left"' : ''}>
    <div class="between">
      <div class="grow">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <b class="cmd__title">${esc(title)}</b>
      </div>
      ${opts.right || ''}
    </div>
    ${body}
  </${tag}>`;
}

const smartEmpty = (line, cta) =>
  `<div class="empty empty--smart" style="padding:18px 6px">
     <p class="sentence">${esc(line)}</p>${cta || ''}</div>`;

/* ── money: four separate states, never one blur ───────────── */
function walletCard(key) {
  const legs = getState().ledger.filter(e => e.partyA === 'CUSTOMER:' + key || e.partyB === 'CUSTOMER:' + key);
  if (!legs.length) return card('Wallet & payments', 'Money', smartEmpty(
    'Nothing has moved yet. SAAHAA never charges before the work is done — the money you commit sits in escrow and is released by you.',
    '<button class="btn btn--secondary btn--sm" style="margin-top:10px" data-act="nav.orders">See your orders</button>'));

  /* out = you paid it into escrow · in = it came back to you.
     Escrow, refunds and goodwill are DIFFERENT money and are never summed. */
  const paid     = legs.filter(e => e.partyA === 'CUSTOMER:' + key)
                       .reduce((n, e) => n + (e.amountPaise || 0), 0);
  const refunded = legs.filter(e => e.partyB === 'CUSTOMER:' + key && e.kind === 'REFUND')
                       .reduce((n, e) => n + (e.amountPaise || 0), 0);
  const goodwill = legs.filter(e => e.partyB === 'CUSTOMER:' + key && e.kind === 'GOODWILL')
                       .reduce((n, e) => n + (e.amountPaise || 0), 0);
  const inEscrow = myOrders().filter(o => !isTerminal(o.stage) &&
    !['SETTLED','R_SETTLED','RATED','PARTIAL','REFUNDED','R_REFUNDED'].includes(o.stage))
    .reduce((n, o) => n + (o.customerPays || 0), 0);

  const row = (label, amount, state, note) => `<div class="between moneyflow__row" style="margin-bottom:8px">
    <span class="tiny muted">${esc(label)}${state ? ` <span class="${state}">${esc(note)}</span>` : ''}</span>
    <b class="num">${M.fmt(amount)}</b></div>`;

  return card('Wallet & payments', 'Money', `
    <div class="moneyflow" style="margin-top:12px">
      ${row('Paid in, all time', paid, '', '')}
      ${inEscrow ? row('Sitting in escrow', inEscrow, 'state--held', 'you release it') : ''}
      ${refunded ? row('Refunded to you', refunded, 'state--available', 'back with you') : ''}
      ${goodwill ? row('Goodwill credit', goodwill, 'state--available', 'from SAAHAA') : ''}
    </div>
    <details class="expand" style="margin-top:10px">
      <summary class="tiny" style="cursor:pointer;color:var(--accent);font-weight:700">
        ${legs.length} entr${legs.length === 1 ? 'y' : 'ies'} on your ledger ▾</summary>
      <div style="margin-top:10px;max-height:220px;overflow-y:auto">
        ${legs.slice().reverse().slice(0, 25).map(e => {
          const out = e.partyA === 'CUSTOMER:' + key;
          return `<div class="between" style="margin-bottom:7px">
            <span class="micro muted">${esc(e.kind)} · ${timeAgo(e.ts)}
              <span class="${out ? 'state--held' : 'state--available'}">${out ? 'into escrow' : 'back to you'}</span></span>
            <b class="num" style="font-size:13px">${out ? '−' : '+'}${M.fmt(e.amountPaise)}</b></div>`;
        }).join('')}
      </div>
      <p class="micro muted" style="margin-top:8px">
        Read-only. Every line is hash-chained — it can be verified, never edited.</p>
    </details>`, { gold: true });
}

/* ── the screen ────────────────────────────────────────────── */
export function render() {
  const s = me();
  if (!s) return auth.render();

  const st = getState();
  const orders = myOrders();
  const liveList = orders.filter(o => !isTerminal(o.stage));
  const needsYou = liveList.filter(o => stage(o.stage).owner === 'customer');
  const reviews = (st.reviews || []).filter(r => r.byKey === s.key && !r.hidden);
  const subs = orders.filter(o => o.kind === 'service' && (o.recurring || get('category', o.catId).recurring));
  const chatThreads = orders
    .map(o => ({ o, msgs: st.chats[o.id] || [] }))
    .filter(x => x.msgs.length)
    .sort((a, b) => b.msgs[b.msgs.length - 1].ts - a.msgs[a.msgs.length - 1].ts)
    .slice(0, 3);

  return `
  ${header('My SAAHAA', s.mobile || '')}
  <main class="wrap">

    <div class="cmd glass glass--deep rise" style="margin-top:var(--sp-6)">
      <div class="row">
        <span class="avatar avatar--lg">${esc((s.name || '?')[0])}</span>
        <div class="grow">
          <b class="cmd__title h-display" style="display:block">${esc(s.name)}</b>
          <p class="cmd__sub">${esc(s.role)} · ${esc(s.area || myArea())} · ${esc(s.mobile || '')}</p>
        </div>
        ${liveList.length ? `<span class="pill pill--live">${liveList.length} live</span>` : ''}
      </div>
      <div class="capsules" style="margin-top:12px">
        <span class="capsule capsule--gold"><span class="capsule__k">Orders</span>
          <span class="capsule__v">${orders.length}</span></span>
        <span class="capsule capsule--info"><span class="capsule__k">Area</span>
          <span class="capsule__v">${esc(s.area || myArea())}</span></span>
        <span class="capsule capsule--soft"><span class="capsule__k">Reviews written</span>
          <span class="capsule__v">${reviews.length}</span></span>
      </div>
    </div>

    <div class="acct-grid rise rise-2">

      ${card('Bookings & orders', 'Everything you asked for',
        liveList.length ? `<div class="mini-track" aria-hidden="true">${(() => {
            const o = liveList[0]; const t = trackerFor(o.kind); const i = trackerIndex(o);
            return t.map((_, k) => `<i class="${k < i ? 'on' : k === i ? 'on cur' : ''}"></i>`).join('');
          })()}</div>
          <p class="cmd__sub">${esc(stage(liveList[0].stage).label)} ·
            ${esc(liveList[0].kind === 'service' ? liveList[0].partnerName : liveList[0].shopName)}</p>`
          : orders.length ? `<p class="cmd__sub">Last one ${timeAgo(orders[0].createdAt)}.</p>`
          : smartEmpty('No orders yet. Your first pro is two taps away.'),
        { act: 'nav.orders',
          right: `<span class="pill pill--soft">${orders.length}</span>` })}

      ${card('Needs you', 'Notifications',
        needsYou.length
          ? needsYou.slice(0, 3).map(o => `<div class="between" style="margin-top:8px">
              <span class="tiny">${esc(stage(o.stage).label)}</span>
              <span class="pill ${TONE_PILL[stage(o.stage).tone] || 'pill--soft'}">${esc(stage(o.stage).short)}</span>
            </div>`).join('')
          : smartEmpty('Nothing is waiting on you. We only interrupt when a decision is actually yours.'),
        { act: 'nav.orders',
          right: needsYou.length ? `<span class="pill pill--live">${needsYou.length}</span>` : '' })}

      ${card('Saved services & shops', 'Your shortlist',
        smartEmpty('Nothing saved yet. Open a service or a shop and it becomes one tap away next time.',
          `<div class="chiprow" style="justify-content:center;margin-top:10px;flex-wrap:wrap">
             <button class="chip chip--smart" data-act="nav.home">Browse services</button>
             <button class="chip chip--smart" data-act="nav.shops">Browse shops</button>
           </div>`))}

      ${card('Addresses', 'Where we come to you', `
        <div class="capsules" style="margin-top:10px">
          <span class="capsule capsule--ok"><span class="capsule__k">Serving</span>
            <span class="capsule__v">${esc(myArea())}</span>
            <span class="capsule__d">tap to change</span></span>
        </div>`, { act: 'area.pick' })}

      ${walletCard(s.key)}

      ${card('Subscriptions', 'Repeating work',
        subs.length
          ? subs.slice(0, 3).map(o => `<div class="between" style="margin-top:8px">
              <span class="tiny">${esc(get('category', o.catId).name)} · ${esc(o.partnerName || '')}</span>
              <b class="num" style="font-size:13px">${M.fmt(o.customerPays)}</b></div>`).join('')
          : smartEmpty('No repeating work yet. Maids, cooks, tutors and laundry can run monthly instead of one job at a time.',
            '<button class="btn btn--secondary btn--sm" style="margin-top:10px" data-act="nav.home">Find one</button>'),
        { right: subs.length ? `<span class="pill pill--soft">${subs.length}</span>` : '' })}

      ${card('Chat', 'Your conversations',
        chatThreads.length
          ? chatThreads.map(({ o, msgs }) => {
              const last = msgs[msgs.length - 1];
              return `<button class="between" data-act="order.open" data-id="${esc(o.id)}"
                  style="width:100%;text-align:left;background:none;border:0;padding:8px 0;cursor:pointer">
                <span class="grow"><b class="tiny">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}</b>
                  <span class="meta" style="display:block">${esc(last.text)}</span></span>
                <span class="micro muted">${clockTime(last.ts)}</span></button>`;
            }).join('')
          : smartEmpty('No messages yet. Chat opens on every order — contact details stay hidden, payments stay in SAAHAA.'),
        { right: chatThreads.length ? `<span class="pill pill--soft">${chatThreads.length}</span>` : '' })}

      ${card('Reviews', 'What you told us',
        reviews.length
          ? reviews.slice(0, 3).map(r => `<div style="margin-top:10px">
              <div class="between"><b class="tiny">${esc(r.partnerName || '')}</b>
                <span class="micro muted">${timeAgo(r.ts)}</span></div>
              <p class="tiny muted">${ratingStars(r.stars)} ${r.stars}.0${r.text ? ` · ${esc(r.text)}` : ''}</p>
            </div>`).join('')
          : smartEmpty('You have not rated anyone yet. Your rating is what decides who gets recommended next.'),
        { right: reviews.length ? `<span class="pill pill--soft">${reviews.length}</span>` : '' })}

      <div class="cmd glass acct-card">
        <p class="eyebrow">Settings</p>
        <b class="cmd__title">This app</b>
        <div class="acct-set" style="margin-top:12px">
          ${[['theme.toggle', icon('theme', { size: 16 }), 'Light / dark'],
             ['splash.replay', icon('star', { size: 16 }), 'Replay the welcome screen'],
             ['selftest.run', icon('flask', { size: 16 }), 'Run self-test'],
             ['nav.admin', icon('shield', { size: 16 }), 'Admin console']]
            .map(([a, ic, l]) => `<button class="chip chip--smart" data-act="${a}">
              <span class="chip__ic" aria-hidden="true">${ic}</span>${esc(l)}</button>`).join('')}
        </div>
        <button class="btn btn--ghost btn--block" style="margin-top:14px;color:var(--danger)"
          data-act="auth.logout">Sign out</button>
      </div>

    </div>

    <div class="credo"><div class="cmark">${mark(150, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:8px">v${VERSION} · schema v${SCHEMA_VERSION} · ${BUILD_ID}</p></div>
    <div style="height:40px"></div>
  </main>
  <style>
    .acct-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:var(--sp-6,18px)}
    .acct-card{margin:0}
    .acct-set{display:flex;flex-wrap:wrap;gap:8px}
    @media (min-width:768px){ .acct-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
    @media (min-width:1280px){ .acct-grid{grid-template-columns:repeat(3,minmax(0,1fr))} }
  </style>`;
}

/* re-exported so a caller that only has this module can still draw the shell */
export { header, emptyBlock };
