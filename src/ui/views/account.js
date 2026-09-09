/* SAAHAA · ui/views/account.js — "You", the customer's own hub.

   MODERNIST. The mockup's 1d "Profile / settings": the avatar block, three
   stat capsules, what is still open, the wallet, and the settings rows with
   a › — addresses, payment, notifications, appearance, "List my shop or
   service". Every control the hub had is still here under the same data-act
   names (nav.orders, area.pick, splash.replay, theme.toggle, nav.admin,
   selftest.run, auth.logout, cwallet.*) and the same ids (cwAmt, cwAdd, cwOut).

   NOTHING IS INVENTED. The engine keeps no "regulars" list, so the strip and
   its capsule are derived from the order book — the pros and shops this
   customer has been back to, twice or more — and the third capsule is what
   the ledger can prove: the SAAHAA charges actually paid. Money never mixes:
   balance, held for orders, refunds and goodwill credits are four separate
   things. */

import { esc, ratingStars, timeAgo, clockTime, delegate, toast } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import * as ID from '../../domain/identity.js';
import { getState, me, myArea, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { mark } from '../logo.js';
import { VERSION, SCHEMA_VERSION, BUILD_ID } from '../../core/version.js';
import { stage, isTerminal, trackerFor, trackerIndex } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import { acct } from '../../domain/ledger.js';
import * as gateway from '../../core/gateway.js';
import { header, emptyBlock, SYS_CSS } from './shops.js';
import * as auth from './auth.js';
import { myPlace } from './home.js';

/* ── money: the customer's wallet ───────────────────────────────
   EVERYONE PAYS SAAHAA. Money lands in CUSTOMER:<key> first and only then
   moves into an order's escrow; a refund comes back to the same account.
   The balance is read off the ledger (flow.customerWallet), never stored. */

const LEG_LABEL = {
  PAYMENT_IN: 'Paid in', TOPUP: 'Paid in', ESCROW_IN: 'Held for order', ESCROW_LOCK: 'Held for order',
  REFUND: 'Refund', CANCEL: 'Refund', RELEASE: 'Refund', WITHDRAW: 'Taken out', GOODWILL: 'Goodwill credit',
};
/* A kind nobody has named yet must not reach a customer as ESCROW_RELEASE.
   The machine's word, turned back into words: "Escrow release". */
const legWord = kind => LEG_LABEL[kind] ||
  String(kind || 'Movement').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Signed movement of `account` in one ledger entry — both shapes the book has used. */
function deltaFor(e, account) {
  if (Array.isArray(e.legs)) return e.legs.filter(l => l.account === account).reduce((n, l) => n + (l.delta | 0), 0);
  if (e.partyA === account) return -(e.amountPaise | 0);
  if (e.partyB === account) return e.amountPaise | 0;
  return 0;
}

/* The typed rupees are mirrored, in paise, onto the two wallet buttons:
   app.js reads data-amt first and the field second, and the engine counts
   in paise. One delegated listener, registered once. */
delegate('input', '#cwAmt', (e, el) => {
  const paise = Math.round((Number(el.value) || 0) * 100);
  ['cwAdd', 'cwOut'].forEach(id => { const b = document.getElementById(id); if (b) b.dataset.amt = paise > 0 ? String(paise) : ''; });
});

/* ── the account's own name ─────────────────────────────────────
   `user.code` (C20262001 / P20262001 / S20262001) is what a person reads out
   on the phone. It is NOT a secret — it identifies, the password
   authenticates — so it is printed in full, never masked.

   Copying it needs no new registered action: app.js routes [data-act], and
   this is a plain delegated listener in the UI layer, the same way
   home.js listens on #nearbyQ. Nothing is written, nothing is dispatched. */
delegate('click', '.idcopy', async (e, el) => {
  const code = el.dataset.code || '';
  if (!code) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
    else throw new Error('no clipboard');
    toast(`${code} copied`);
  } catch (err) {
    /* a browser that refuses the clipboard still lets a person read it: select
       the code so one keystroke takes it */
    const t = el.closest('.m-id') && el.closest('.m-id').querySelector('.m-id__c');
    if (t && window.getSelection) {
      const r = document.createRange(); r.selectNodeContents(t);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    toast('Select and copy — your browser blocked the clipboard', 'warn');
  }
});

/* Switching accounts goes through the ordinary sign-in screen (auth.open),
   because the other account has its own password. The tab is nudged to
   "login" first so the person lands on the form they need. */
delegate('click', '.idswitch', () => { auth.setAuthTab('login'); });

const liveOf = orders => orders.filter(o => !isTerminal(o.stage));
const heldOf = orders => orders.filter(o => !isTerminal(o.stage) &&
  !['SETTLED','R_SETTLED','RATED','PARTIAL','REFUNDED','R_REFUNDED'].includes(o.stage))
  .reduce((n, o) => n + (o.customerPays || 0), 0);

function walletSection(key, orders) {
  const account = acct.customer(key);
  const w = flow.customerWallet(key);
  const legs = getState().ledger
    .map(e => ({ e, d: deltaFor(e, account) }))
    .filter(x => x.d !== 0)
    .reverse()
    .slice(0, 8);
  const inEscrow = heldOf(orders);

  return `<div class="sec" id="cwallet">
    <p class="m-cap">Wallet</p>
    <div class="capsules">
      <span class="capsule capsule--gold"><span class="capsule__k">Balance</span>
        <span class="capsule__v num">${M.fmt(w.balance)}</span>
        <span class="capsule__d">yours to spend or take out</span></span>
      <span class="capsule"><span class="capsule__k">Held for orders</span>
        <span class="capsule__v num">${M.fmt(inEscrow)}</span>
        <span class="capsule__d">released when you confirm</span></span>
    </div>
    <p class="micro muted" style="margin-top:8px">${esc(gateway.label())}</p>

    <div class="cw-form" style="margin-top:12px">
      <div class="search" style="border:2px solid var(--color-text);height:48px">
        <span class="tiny muted" aria-hidden="true">₹</span>
        <input id="cwAmt" type="number" inputmode="numeric" min="10" step="1"
          placeholder="Amount in rupees" aria-label="Amount in rupees">
      </div>
      <div class="chiprow" style="flex-wrap:wrap;gap:6px;margin-top:8px">
        ${[100, 200, 500, 1000].map(r => `<button class="chip" data-act="cwallet.topup" data-amt="${r * 100}">+ ₹${r}</button>`).join('')}
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button id="cwAdd" class="btn btn--primary grow" style="justify-content:flex-start" data-act="cwallet.topup">Add money</button>
        <button id="cwOut" class="btn btn--secondary" data-act="cwallet.withdraw" ${w.balance < 1000 ? 'disabled' : ''}>Take out</button>
      </div>
      <p class="micro muted" style="margin-top:8px">Minimum ₹10 either way. Taking out sends it to your UPI. You pay SAAHAA for every order;
        the money is held here until you confirm the work, then the pro or shop is paid.</p>
    </div>

    ${legs.length ? `<p class="m-cap" style="margin-top:14px">Recent</p>
      ${legs.map(({ e, d }) => `<div class="m-kv" style="border-bottom:1px solid var(--color-divider)">
          <span class="tiny muted">${esc(legWord(e.kind))} · ${timeAgo(e.ts)}</span>
          <b class="num" style="font-size:13px;color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt(Math.abs(d))}</b></div>`).join('')}
      <p class="micro muted" style="margin-top:6px">Read-only. Every line is hash-chained — it can be verified, never edited.</p>`
    : `<p class="micro muted" style="margin-top:10px">Nothing has moved yet. Money you commit sits with SAAHAA and is released by you.
       <button class="btn btn--ghost btn--sm" style="margin-top:6px" data-act="nav.orders">See your orders</button></p>`}
  </div>`;
}

/* a settings row: label on the left, value and › on the right */
const setRow = (act, label, value, opts = {}) =>
  `<button class="m-set${opts.em ? ' m-set--em' : ''}" data-act="${act}"${opts.id ? ` data-id="${esc(opts.id)}"` : ''}>
    <span>${esc(label)}</span><span class="m-set__v">${value}${icon('chevron', { size: 14, cls: 'm-chev' })}</span></button>`;
const infoRow = (label, value) =>
  `<div class="m-set"><span>${esc(label)}</span><span class="m-set__v">${value}</span></div>`;

/* ── the screen ────────────────────────────────────────────── */
export function render() {
  const s = me();
  if (!s) return auth.render();

  const st = getState();
  const orders = myOrders();
  const liveList = liveOf(orders);
  const needsYou = liveList.filter(o => stage(o.stage).owner === 'customer');
  const reviews = (st.reviews || []).filter(r => r.byKey === s.key && !r.hidden);
  const subs = orders.filter(o => o.kind === 'service' && (o.recurring || get('category', o.catId).recurring));
  const chatThreads = orders
    .map(o => ({ o, msgs: st.chats[o.id] || [] }))
    .filter(x => x.msgs.length)
    .sort((a, b) => b.msgs[b.msgs.length - 1].ts - a.msgs[a.msgs.length - 1].ts)
    .slice(0, 3);
  /* what the ledger can prove: SAAHAA's charge on every service order that
     settled in full (a partial release shrinks the charge, so it is left out) */
  const feesPaid = orders.filter(o => o.kind === 'service' && (o.history || []).some(h => h.stage === 'SETTLED'))
    .reduce((n, o) => n + ((o.platformFee | 0) + (o.gst | 0)), 0);
  /* 13 "My regulars". Not a stored list — nothing in the engine keeps one —
     but a real one: the pros and shops this customer has been back to. Booked
     twice is the whole definition, so the number cannot flatter anybody. */
  const regulars = (() => {
    const seen = new Map();
    for (const o of orders) {
      const id = o.kind === 'service' ? o.partnerId : o.shopId;
      const name = o.kind === 'service' ? o.partnerName : o.shopName;
      if (!id || !name) continue;
      const r = seen.get(id) || { id, name, kind: o.kind, catId: o.catId, n: 0, last: 0 };
      r.n++; r.last = Math.max(r.last, o.createdAt || 0);
      seen.set(id, r);
    }
    return [...seen.values()].filter(r => r.n > 1).sort((a, b) => b.n - a.n || b.last - a.last);
  })();
  const place = myPlace();
  const pinned = typeof place === 'object' && place.lat != null;
  const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Dark' : 'Light';
  const mobile = String(s.mobile || '');
  const maskedMobile = mobile.length >= 4 ? `${mobile.slice(0, 2)}··· ··${mobile.slice(-3)}` : mobile;

  /* WHO THIS ACCOUNT IS. The session is a copy taken at sign-in, so the live
     row wins: an account that was given its code by the backfill still shows
     it here without a re-login. */
  const users = st.users || [];
  const meRow = users.find(u => u.key === s.key) || s;
  const myCode = ID.isCode(meRow.code) ? ID.normaliseCode(meRow.code) : '';
  const roleWord = (ID.ROLE_LABEL[meRow.role || s.role] || 'Account').toLowerCase();
  /* The same number may carry a second account — one person, a customer side
     and a pro side, never mixed. */
  const others = ID.accountsOn(s.mobile, users).filter(u => u.key !== s.key && ID.isCode(u.code));

  const idBlock = myCode ? `
    <div class="m-id">
      <span class="grow" style="min-width:0">
        <span class="meta" style="display:block">Your ${esc(roleWord)} ID</span>
        <b class="m-id__c num">${esc(myCode)}</b>
      </span>
      <button type="button" class="btn btn--secondary btn--sm idcopy tap" data-code="${esc(myCode)}"
        aria-label="Copy your ${esc(roleWord)} ID, ${esc(myCode)}">Copy</button>
    </div>
    <p class="micro muted" style="margin-top:6px">Sign in with this ID or with your mobile number — either one works.
      It is a name, not a secret: your password is the secret.</p>` : '';

  const otherBlock = others.length ? `
    <div class="m-alt">
      <p class="tiny" style="margin:0">You also have ${others.map(u =>
        `a ${esc(ID.ROLE_LABEL[u.role] || 'Account')} account (<b class="num">${esc(u.code)}</b>)`).join(' and ')} on this number.</p>
      <p class="micro muted" style="margin:6px 0 10px">Separate wallet, separate history, separate password — signing in to it asks for that account's own password.</p>
      <button type="button" class="btn btn--secondary btn--sm idswitch tap" data-act="auth.open">Switch account ${icon('forward', { size: 14 })}</button>
    </div>` : '';

  const orderRow = o => {
    const stg = stage(o.stage);
    const cat = get('category', o.catId);
    const live = !isTerminal(o.stage);
    const track = trackerFor(o.kind); const idx = trackerIndex(o);
    return `<button class="m-row" data-act="order.open" data-id="${esc(o.id)}">
      <span class="m-lead${live ? '' : ' m-lead--dim'}" aria-hidden="true"></span>
      <div class="grow" style="min-width:0">
        <div class="m-row__t">${esc(o.kind === 'service' ? `${cat.name}${o.sub ? ' · ' + o.sub : ''}` : `${o.lines.length} item${o.lines.length === 1 ? '' : 's'} from ${o.shopName}`)}</div>
        <div class="m-row__m" style="margin-bottom:0">${esc(o.kind === 'service' ? o.partnerName : o.shopName)} · ${esc(stg.label.toLowerCase())}${live ? ` · step ${idx + 1} of ${track.length}` : ''}</div>
      </div>
      <span class="m-row__go" aria-hidden="true">→</span>
    </button>`;
  };

  return `
  ${header('You', s.mobile || '')}
  <main class="wrap">

    <div style="padding:16px 0;border-bottom:2px solid var(--color-divider)">
      <div class="row" style="gap:12px">
        <span class="avatar" style="width:52px;height:52px;font-size:18px">${esc((s.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
        <div class="grow" style="min-width:0">
          <div style="font:800 18px/1.15 var(--font-heading)">${esc(s.name)}</div>
          <div style="font-size:11.5px;color:var(--ink-3);margin-top:3px">${maskedMobile ? `${esc(maskedMobile)} · ` : ''}${esc(s.area || myArea())}</div>
        </div>
        ${liveList.length ? `<span class="tag tag-accent">${liveList.length} live</span>` : ''}
      </div>
      ${idBlock}
      ${otherBlock}
    </div>

    <div class="capsules" style="grid-template-columns:repeat(3,1fr);gap:0;border-bottom:2px solid var(--color-divider)">
      <button class="capsule" style="border:0;border-right:1px solid var(--color-divider);text-align:left;padding:11px 12px" data-act="nav.orders">
        <span class="capsule__v" style="font-size:17px">${orders.length}</span><span class="capsule__k">Orders</span></button>
      <span class="capsule" style="border:0;border-right:1px solid var(--color-divider);padding:11px 12px">
        <span class="capsule__v" style="font-size:17px">${regulars.length}</span><span class="capsule__k">Regulars</span></span>
      <span class="capsule" style="border:0;padding:11px 12px">
        <span class="capsule__v num" style="font-size:17px">${M.fmt(feesPaid)}</span><span class="capsule__k">Fees paid</span></span>
    </div>

    ${regulars.length ? `<div class="sec" style="border-bottom:2px solid var(--color-divider)">
      <p class="m-cap">My regulars</p>
      <div class="m-regs">
        ${regulars.slice(0, 8).map(r => `<button class="m-reg" data-act="${r.kind === 'service' ? 'pro.open' : 'shop.open'}" data-id="${esc(r.id)}">
          <span class="thumb m-thumb" style="width:56px;height:56px" aria-hidden="true">${hasIcon(r.catId) ? icon(r.catId, { size: 22 }) : icon('person', { size: 22 })}</span>
          <span class="m-reg__n">${esc(r.name)}</span>
          <span class="m-reg__c">${r.n} orders</span>
        </button>`).join('')}
      </div>
    </div>` : ''}

    <div class="m-two">
    <div>
    ${needsYou.length ? `<div class="sec">
      <p class="m-cap">Needs you</p>
      ${needsYou.slice(0, 3).map(orderRow).join('')}
    </div>` : ''}

    ${liveList.length ? `<div class="sec">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">Still open</p>
        <button class="more tap" data-act="nav.orders" style="min-height:44px;padding-inline:2px">All ${orders.length} →</button></div>
      ${liveList.filter(o => !needsYou.includes(o)).slice(0, 3).map(orderRow).join('')}
    </div>` : `<div class="sec">
      <p class="m-cap">Orders</p>
      ${orders.length ? `<p class="tiny muted">Last one ${timeAgo(orders[0].createdAt)}. <button class="more tap" data-act="nav.orders" style="min-height:44px;padding-inline:2px">See all ${orders.length} →</button></p>`
        : emptyBlock('No orders yet', 'Your first pro is two taps away.',
          '<button class="btn btn--secondary btn--sm" data-act="nav.home">Browse services</button>')}
    </div>`}

    ${walletSection(s.key, orders)}

    ${subs.length ? `<div class="sec">
      <p class="m-cap">Repeating work</p>
      ${subs.slice(0, 3).map(o => `<div class="m-kv"><span class="tiny">${esc(get('category', o.catId).name)} · ${esc(o.partnerName || '')}</span>
        <b class="num" style="font-size:13px">${M.fmt(o.customerPays)}</b></div>`).join('')}
    </div>` : ''}
    </div>

    <div>
    <div class="sec">
      <p class="m-cap">Settings</p>
      ${setRow('area.pick', 'Addresses', pinned ? `${esc(myArea())} · pinned` : esc(myArea()))}
      ${infoRow('Payment methods', `Wallet · ${esc(gateway.label().split(' — ')[0])}`)}
      ${setRow('nav.orders', 'Notifications', needsYou.length ? `${needsYou.length} waiting on you` : 'Only when a decision is yours')}
      ${setRow('theme.toggle', 'Appearance', theme)}
      ${setRow('splash.replay', 'Welcome screen', 'Replay')}
      ${setRow('partner.join', 'List my shop or service', '', { em: true })}
      ${setRow('shop.start', 'Open a shop', 'A second account, on this number')}
    </div>

    ${chatThreads.length ? `<div class="sec">
      <p class="m-cap">Messages</p>
      ${chatThreads.map(({ o, msgs }) => {
        const last = msgs[msgs.length - 1];
        return `<button class="m-row" data-act="nav.chat" data-id="${esc(o.id)}">
          <span class="thumb m-thumb" style="width:40px;height:40px" aria-hidden="true">${hasIcon(o.catId) ? icon(o.catId, { size: 18 }) : icon('chat', { size: 18 })}</span>
          <div class="grow" style="min-width:0">
            <div class="m-row__t">${esc(o.kind === 'service' ? o.partnerName : o.shopName)}</div>
            <div class="m-row__m" style="margin-bottom:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(last.text)}</div></div>
          <span class="micro muted" style="align-self:center">${clockTime(last.ts)}</span>
        </button>`;
      }).join('')}
    </div>` : ''}

    ${reviews.length ? `<div class="sec">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">Your reviews</p>
        <span class="meta">${reviews.length}</span></div>
      ${reviews.slice(0, 3).map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">
        <div class="between"><b class="tiny">${esc(r.partnerName || '')}</b><span class="micro muted">${timeAgo(r.ts)}</span></div>
        <p class="tiny muted">${ratingStars(r.stars)} ${r.stars}.0${r.text ? ` · ${esc(r.text)}` : ''}</p>
      </div>`).join('')}
    </div>` : `<div class="sec">
      <p class="m-cap">Your shortlist</p>
      <p class="tiny muted">Open a service or a shop and it is one tap away next time.</p>
      <div class="chiprow" style="margin-top:10px;flex-wrap:wrap">
        <button class="chip" data-act="nav.home">Browse services</button>
        <button class="chip" data-act="nav.shops">Browse shops</button>
      </div>
    </div>`}

    <div class="sec">
      <p class="m-cap">This app</p>
      ${setRow('selftest.run', 'Run self-test', '')}
      ${setRow('nav.admin', 'Admin console', '')}
      <button class="btn btn--ghost btn--block" style="margin-top:12px;justify-content:flex-start;color:var(--danger)"
        data-act="auth.logout">${icon('signout', { size: 16 })} Sign out</button>
      <!-- The privacy page promises a person can have their data removed, so the
           promise has somewhere to be kept. The sheet shows exactly what goes,
           what is emptied but kept because someone else's record points at it,
           and what stays because the books must balance. -->
      <button class="btn btn--ghost btn--block" style="margin-top:6px;justify-content:flex-start;color:var(--danger)"
        data-act="account.erase">${icon('trash', { size: 16 })} Remove my account</button>
    </div>
    </div>
    </div>

    <div class="credo"><div class="cmark">${mark(150, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:8px">v${VERSION} · schema v${SCHEMA_VERSION} · ${BUILD_ID}</p>
      <p class="micro muted" style="margin-top:8px;position:relative;z-index:1">
        <a class="micro muted" href="#/legal/terms">Terms</a> ·
        <a class="micro muted" href="#/legal/privacy">Privacy</a> ·
        <a class="micro muted" href="#/legal/refunds">Refunds</a> ·
        <a class="micro muted" href="#/legal/contact">Contact</a> ·
        <a class="micro muted" href="#/legal/about">About</a>
      </p></div>
    <div style="height:40px"></div>
  </main>
  ${SYS_CSS}
  <style>
    .m-chev{transform:rotate(-90deg)}
    /* the account's own name — printed, never masked, never shouted */
    .m-id{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;
      border:2px solid var(--color-text);background:var(--color-surface)}
    .m-id__c{display:block;margin-top:2px;font:800 19px/1.1 var(--font-heading);letter-spacing:.08em;
      overflow:hidden;text-overflow:ellipsis;-webkit-user-select:all;user-select:all}
    .m-id .btn{flex:none}
    .m-alt{margin-top:12px;padding:10px 12px;background:var(--surface-2);border-left:4px solid var(--color-accent)}
    .capsules button.capsule{cursor:pointer} .capsules button.capsule:hover .capsule__v{color:var(--color-accent)}
    .m-regs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
    .m-reg{flex:none;width:64px;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer;min-height:44px}
    .m-reg .m-thumb{display:grid;place-items:center}
    .m-reg__n{display:block;font:600 9.5px/1.3 var(--font-body);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .m-reg__c{display:block;font:400 9.5px/1.3 var(--font-body);color:var(--ink-3)}
    .m-reg:hover .m-reg__n{color:var(--color-accent)}
  </style>`;
}

/* re-exported so a caller that only has this module can still draw the shell */
export { header, emptyBlock };
