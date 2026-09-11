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
import { subKey } from '../../domain/catalog.services.js';
import * as i18n from '../i18n.js';
import { icon, hasIcon } from '../icons.js';
import * as ID from '../../domain/identity.js';
import { getState, me, myArea, myPartner, myShop } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { mark } from '../logo.js';
import { VERSION, SCHEMA_VERSION, BUILD_ID } from '../../core/version.js';
import { stage, isTerminal, isDone, trackerFor, trackerIndex } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as W from '../../domain/wallet.js';
import { acct } from '../../domain/ledger.js';
import * as gateway from '../../core/gateway.js';
import { header, emptyBlock, SYS_CSS } from './shops.js';
import * as auth from './auth.js';
import { myPlace } from './home.js';
import * as adminauth from '../../core/adminauth.js';

/* ── money: the customer's wallet ───────────────────────────────
   EVERYONE PAYS SAAHAA. Money lands in CUSTOMER:<key> first and only then
   moves into an order's escrow; a refund comes back to the same account.
   The balance is read off the ledger (flow.customerWallet), never stored. */

/* EVERY ROW OF HER PASSBOOK WAS ENGLISH on a Telugu account screen — "Held for
   order · 1m ago", "Refund", "Paid in" — under a heading that had been
   translated and a sentence promising the book is hers to audit. A ledger she
   cannot read is not one she can check. */
const LEG_KEY = {
  PAYMENT_IN: 'cleg.paidIn', TOPUP: 'cleg.paidIn', ESCROW_IN: 'cleg.heldForOrder',
  ESCROW_LOCK: 'cleg.heldForOrder', REFUND: 'cleg.refund', CANCEL: 'cleg.refund',
  RELEASE: 'cleg.refund', WITHDRAW: 'cleg.takenOut', GOODWILL: 'cleg.goodwill',
};
/* A kind nobody has named yet must not reach a customer as ESCROW_RELEASE.
   The machine's word, turned back into words: "Escrow release". */
const legWord = kind => (LEG_KEY[kind] ? i18n.t(LEG_KEY[kind])
  : String(kind || 'Movement').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));

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

/* A PAID, SETTLED, STEP-7-OF-7 JOB SAT UNDER "STILL OPEN". `SETTLED` carries no
   `terminal` flag, so `!isTerminal` counted a job whose money has already moved
   and whose only outstanding act is an optional rating. She had no way to clear
   it except to rate somebody. Settled is settled. */
const liveOf = orders => orders.filter(o => !isDone(o.stage));
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

  /* A PLUMBER WITH ₹936 WAS SHOWN "BALANCE ₹0". This is the CUSTOMER wallet --
     money the person spends on SAAHAA -- and it is the right thing on this
     page. But a pro or a shop opening "You", under a header reading YOUR PRO
     ID, met a zero balance, "₹0 FEES YOU PAID", "No orders yet" and "Where
     refunds and take-outs go — Not set", while their earnings sat in another
     console with a UPI id already saved. Two audits in a row called this
     disqualifying, and the second was right to: a person checking their money
     in the obvious place must not be told they have none.
     The customer wallet keeps its own name, and the earnings say where they are. */
  const earn = (() => {
    const p0 = myPartner();
    if (p0) return { amount: W.walletOf(getState().ledger, p0.id, p0).available | 0, word: 'Earnings' };
    const s0 = myShop();
    if (s0) return { amount: flow.shopWallet(s0.id).balance | 0, word: 'Shop takings' };
    return null;
  })();

  return `<div class="sec" id="cwallet">
    ${earn ? `<div class="m-note" style="margin-bottom:10px">
      <b>${esc(earn.word)}: ${M.fmt2(earn.amount)}</b> — what you have <b>earned</b> is kept in your own console,
      not here. The wallet below is what you <b>spend</b> on SAAHAA as a customer.
      <button class="btn btn--ghost btn--sm" style="margin-top:6px" data-act="nav.tab" data-tab="earn">${esc(i18n.t('acct.openIt'))}</button>
    </div>` : ''}
    <p class="m-cap">${earn ? 'Wallet you spend from' : 'Wallet'}</p>
    <div class="capsules">
      <!-- AND THE CAPSULE ITSELF WAS STILL ROUNDING. The toast was made exact
           and this was not, so the screen still showed her "₹19" for ₹18.70 and
           still refused 19. A balance is the one number on this page she may
           type back in; it prints to the paisa. -->
      <span class="capsule capsule--gold"><span class="capsule__k">${esc(i18n.t('acct.balance'))}</span>
        <span class="capsule__v num">${legs.length ? M.fmt2(w.balance) : (w.balance % 100 ? M.fmt2(w.balance) : M.fmt(w.balance))}</span>
        <span class="capsule__d">yours to spend or take out</span></span>
      <span class="capsule"><span class="capsule__k">${esc(i18n.t('acct.heldForOrders'))}</span>
        <span class="capsule__v num">${M.fmt(inEscrow)}</span>
        <span class="capsule__d">released when you confirm</span></span>
    </div>
    <p class="micro muted" style="margin-top:8px">${esc(gateway.label())}</p>

    <div class="cw-form" style="margin-top:12px">
      <div class="search" style="border:2px solid var(--color-text);height:48px">
        <span class="tiny muted" aria-hidden="true">₹</span>
        <!-- inputmode="numeric" gives an Android keypad with NO decimal point,
             so a balance of ₹18.70 could not be typed at all even once the
             screen admitted to it. "decimal" is the mode that has one. -->
        <input id="cwAmt" type="number" inputmode="decimal" min="10" step="0.01"
          placeholder="Amount in rupees" aria-label="Amount in rupees">
      </div>
      <div class="chiprow" style="flex-wrap:wrap;gap:6px;margin-top:8px">
        ${[100, 200, 500, 1000].map(r => `<button class="chip" data-act="cwallet.topup" data-amt="${r * 100}">+ ₹${r}</button>`).join('')}
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button id="cwAdd" class="btn btn--primary grow" style="justify-content:flex-start" data-act="cwallet.topup">${esc(i18n.t('acct.addMoney'))}</button>
        <!-- THE BUTTON WAS DEAD ON EVERY BALANCE THAT MATTERED. A refund lands
             on odd paise, so a wallet sits at things like ₹32.86 — under the
             ₹10 floor it is not, but the floor is waived when she empties it,
             and this greyed out anyway on anything under ₹10. Worse, typing the
             balance the screen showed her ("₹33") was refused, because the
             capsule rounded and the wallet did not. Exact figures print exact,
             and one tap takes all of it. -->
        <button id="cwOut" class="btn btn--secondary" data-act="cwallet.withdraw" ${w.balance <= 0 ? 'disabled' : ''}>${esc(i18n.t('acct.takeOut'))}</button>
      </div>
      <!-- AND THE ESCAPE HATCH ONLY APPEARED BELOW ₹10, which is the one range
           where it was least needed. Any balance carrying paise is one she
           cannot type exactly; every one of them gets the button. -->
      <!-- AND IT PRINTED HER BALANCE ON A BUTTON THAT WOULD REFUSE IT. With no
           UPI id saved, "Take out everything — ₹790.64" answered with "Add the
           UPI id you want to be paid into first" and went nowhere: the row that
           sets one is twenty lines further down, under a heading about refunds.
           A control that cannot do the thing it names should say what it needs
           and take her there. -->
      ${w.balance > 0
        ? (me() && me().upi
            ? `<button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
                 data-act="cwallet.withdrawAll">${esc(i18n.t('acct.takeAll', { amount: M.fmt2(w.balance) }))}</button>`
            : `<button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px"
                 data-act="cwallet.upi">${esc(i18n.t('acct.addUpiToTakeOut'))}</button>`)
        : ''}
      <p class="micro muted" style="margin-top:8px">Minimum ₹10 either way. Taking out sends it to your UPI. You pay SAAHAA for every order;
        the money is held here until you confirm the work — or, if you do not, until the wait on that job runs out. Only then is the pro or shop paid.</p>
    </div>

    <!-- THE ONE PANEL THAT PUBLISHES AN AUDIT CLAIM WAS THE ONE THAT FAILED AN
         AUDIT. "BALANCE ₹18.58" sat six lines above "+₹504 · −₹504 · +₹19",
         which sums to ₹19 — under a sentence promising every line is
         hash-chained and can be verified. The legs were exact in paise and each
         was rounded on its own, so the column and the balance told different
         stories, intermittently, by a rupee. Nothing is more corrosive on a
         page that invites you to check it.

         The legs are shown to the paisa, because that is what they are, and
         the balance beside them is shown the same way. A passbook that rounds
         is not a passbook. -->
    ${legs.length ? `<p class="m-cap" style="margin-top:14px">${esc(i18n.t('acct.recent'))}</p>
      ${legs.map(({ e, d }) => `<div class="m-kv" style="border-bottom:1px solid var(--color-divider)">
          <span class="tiny muted">${esc(legWord(e.kind))} · ${timeAgo(e.ts)}</span>
          <b class="num" style="font-size:13px;color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt2(Math.abs(d))}</b></div>`).join('')}
      <p class="micro muted" style="margin-top:6px">${esc(i18n.t('acct.ledgerNote'))}</p>`
    : `<p class="micro muted" style="margin-top:10px">Nothing has moved yet. Money you commit sits with SAAHAA and is released by you.
       <button class="btn btn--ghost btn--sm" style="margin-top:6px" data-act="nav.orders">${esc(i18n.t('acct.seeOrders'))}</button></p>`}
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
  /* THIS SCREEN IS THE CUSTOMER'S, AND IT WAS BEING HANDED THE WORKER'S JOBS.
     `myOrders()` is role-aware: for a pro it returns the orders he WORKED, for
     a shop the orders it FILLED. Every figure on this page reads them as things
     the reader bought -- so a plumber's account told him "MY REGULARS: Ramesh
     Yadav · 3 orders" (himself), and "FEES YOU PAID ₹43", which is the fee his
     CUSTOMER paid on his own job, on a platform whose promise to him is that he
     pays nothing. A shop was likewise its own best customer.

     One person holds one code and may be both. What this page is about is what
     they bought, so it asks for exactly that and never for their work. Their
     earnings have their own console, with its own wallet and its own passbook. */
  const orders = getState().orders.filter(o => o.customerKey === s.key);
  const liveList = liveOf(orders);
  /* THIS WAS HARDCODED TO 'customer', so a pro with three jobs waiting on him
     read "Needs you: 0" — on the list the Contact page tells everyone with a
     problem to check. Partner-owned stages are owner:'worker' and shop-owned
     are owner:'shop'. */
  const mineOwner = s.role === 'partner' ? 'worker' : s.role === 'shop' ? 'shop' : 'customer';
  const needsYou = liveList.filter(o => stage(o.stage).owner === mineOwner);
  const reviews = (st.reviews || []).filter(r => r.byKey === s.key && !r.hidden);
  const subs = orders.filter(o => o.kind === 'service' && (o.recurring || get('category', o.catId).recurring));
  const chatThreads = orders
    .map(o => ({ o, msgs: st.chats[o.id] || [] }))
    .filter(x => x.msgs.length)
    .sort((a, b) => b.msgs[b.msgs.length - 1].ts - a.msgs[a.msgs.length - 1].ts)
    .slice(0, 3);
  /* what the ledger can prove: SAAHAA's charge on every service order that
     settled in full (a partial release shrinks the charge, so it is left out) */
  /* THIS SAID "₹0" TO SOMEBODY WHO HAD PAID ₹24.63, on the screen whose entire
     job is fee honesty. It excluded retail commission altogether — so a
     grocery-only customer saw ₹0 for ever — and required a SETTLED stamp, which
     a job resolved to PARTIAL never gets. The comment above it said "what the
     ledger can prove" and it never touched the ledger. Now it does: what she
     actually paid in fee and GST, on every kind of order that reached an end. */
  const CLOSED = ['SETTLED', 'PARTIAL', 'RATED', 'CLOSED', 'R_SETTLED', 'R_CLOSED'];
  /* AND THEN IT COUNTED FEES SHE WAS EXPLICITLY TOLD SHE DID NOT PAY. The cart
     promises, in so many words: "SAAHAA's charge of ₹13 (3% of the basket)
     comes out of the shop's side, not your bill." It is deducted from the
     shop's payout and never added to hers. Summing it here put ₹15 under
     "FEES PAID" on the one screen built to be honest about fees, contradicting
     the checkout line on the same person's own money.
     On a SERVICE the markup genuinely is hers — it is added on top and she
     pays it. On a RETAIL order it is not. Only the first is counted. */
  const closed = o => CLOSED.includes(o.stage) || (o.history || []).some(h => CLOSED.includes(h.stage));
  /* AND IT SAID "₹0 FEES YOU PAID" WHILE TWO LIVE ORDERS CARRIED ₹70 OF FEE
     SHE HAD BEEN SHOWN LINE BY LINE. Counting only CLOSED orders is true of
     settled work and false of her money: the fee leaves her wallet into escrow
     when she books, not when the job ends. A cancelled job gives it back, so
     those are the ones that do not count. */
  const gaveItBack = o => ['CANCELLED', 'REFUNDED', 'R_CANCELLED', 'R_REFUNDED'].includes(o.stage);
  const feesPaid = orders
    .filter(o => !gaveItBack(o) && o.kind !== 'retail')
    .reduce((n, o) => n + ((o.platformFee | 0) + (o.gst | 0)), 0);
  /* what the shops paid on her behalf — real, and hers to see, but on its own
     line and never added to what she paid */
  /* fee only, because that is the number every other screen prints: the cart
     says "SAAHAA's charge of ₹15", the shop console says "fees today ₹15", and
     this said ₹17 by quietly adding the GST on top of it */
  const feesShopsPaid = orders
    .filter(o => closed(o) && o.kind === 'retail')
    .reduce((n, o) => n + (o.platformFee | 0), 0);
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
        aria-label="Copy your ${esc(roleWord)} ID, ${esc(myCode)}">${esc(i18n.t('acct.copy'))}</button>
    </div>
    <!-- This code does TWO jobs and people only ever discover the first one.
         Saying both here is why nobody in this product ever waits for a code. -->
    <!-- AND A PRO WAS TOLD THE CUSTOMER'S HALF OF IT. This paragraph explained
         his own ID as "the code you read out at your door, so the pro can prove
         they turned up" -- customer copy, over a P2026… heading, to the man who
         is the pro. His code's second job is the opposite one: it is what
         customers see on his page, and at a door he ENTERS theirs. Getting this
         backwards on the ID screen is how an audit came away unsure which of
         the two mechanics onboarding had actually taught him. -->
    <p class="micro muted" style="margin-top:6px">Two things this does. It signs you in — this ID or
      your mobile number, either one works. ${s.role === 'customer'
        ? 'And it is the code you read out at your door, so the pro can prove they turned up.'
        : 'And it is the code printed on your public page, so a customer knows they have the right person — at a door you enter <b>their</b> code, never this one.'}
      It is the same code every time, so nothing is ever texted to you.
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
        <div class="m-row__t">${esc(o.kind === 'service' ? `${i18n.catName(cat)}${o.sub ? ' · ' + i18n.subName(o.sub, subKey(o.sub)) : ''}` : `${o.lines.length} item${o.lines.length === 1 ? '' : 's'} from ${o.shopName}`)}</div>
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

    <!-- WHAT IS ACTUALLY IN HERE. My SAAHAA stacks twelve sections in one long
         scroll: wallet, regulars, live orders, repeating work, messages,
         reviews, shortlist, settings. Nothing was ever removed from it — but a
         person who does not scroll to the bottom never learns those exist,
         which is indistinguishable from their having been taken away.
         This row is the index: it lists only what has something in it, says
         how much, and jumps straight there. -->
    ${(() => {
      const jumps = [
        ['cwallet',    'Wallet',     ''],
        ['acNeeds',    'Needs you',  needsYou.length],   // first, because it is the only urgent one
        ['acOpen',     'Still open', liveList.length],
        ['acRepeat',   'Repeating',  subs.length],
        ['acRegulars', 'Regulars',   regulars.length],
        ['acMsgs',     'Messages',   chatThreads.length],
        ['acReviews',  'Reviews',    reviews.length],
        ['acList',     'Shortlist',  reviews.length ? 0 : ''],   // that block renders only when reviews do not
        ['acSettings', 'Settings',   ''],
      ].filter(([, , n]) => n === '' || n > 0);
      return jumps.length > 2 ? `<div class="chiprow acjump" role="navigation" aria-label="Jump to a section">
        ${jumps.map(([id, label, n]) => `<button class="chip" data-act="nav.jump" data-to="${id}">${esc(label)}${
          n === '' ? '' : `<span class="micro" style="opacity:.65;margin-left:5px">${n}</span>`}</button>`).join('')}
      </div>` : '';
    })()}

    <div class="capsules" style="grid-template-columns:repeat(3,1fr);gap:0;border-bottom:2px solid var(--color-divider)">
      <button class="capsule" style="border:0;border-right:1px solid var(--color-divider);text-align:left;padding:11px 12px" data-act="nav.orders">
        <span class="capsule__v" style="font-size:17px">${orders.length}</span><span class="capsule__k">${esc(i18n.t('acct.orders'))}</span></button>
      <span class="capsule" style="border:0;border-right:1px solid var(--color-divider);padding:11px 12px">
        <span class="capsule__v" style="font-size:17px">${regulars.length}</span><span class="capsule__k">${esc(i18n.t('acct.regulars'))}</span></span>
      <span class="capsule" style="border:0;padding:11px 12px">
        <span class="capsule__v num" style="font-size:17px">${M.fmt(feesPaid)}</span><span class="capsule__k">${esc(i18n.t('acct.feesYouPaid'))}</span></span>
    </div>
    ${feesShopsPaid ? `<p class="micro muted" style="padding:0 var(--gutter) 10px">Shops paid ${M.fmt(feesShopsPaid)} of SAAHAA's charge on your orders — out of their side, never added to your bill.</p>` : ''}

    ${regulars.length ? `<div class="sec" id="acRegulars" style="border-bottom:2px solid var(--color-divider)">
      <p class="m-cap">${esc(i18n.t('acct.myRegulars'))}</p>
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
    ${needsYou.length ? `<div class="sec" id="acNeeds">
      <p class="m-cap">${esc(i18n.t('acct.needsYou'))}</p>
      ${needsYou.slice(0, 3).map(orderRow).join('')}
    </div>` : ''}

    ${liveList.length ? `<div class="sec" id="acOpen">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">${esc(i18n.t('acct.stillOpen'))}</p>
        <button class="more tap" data-act="nav.orders" style="min-height:44px;padding-inline:2px">All ${orders.length} →</button></div>
      ${liveList.filter(o => !needsYou.includes(o)).slice(0, 3).map(orderRow).join('')}
    </div>` : `<div class="sec" id="acOrders">
      <p class="m-cap">${esc(i18n.t('acct.orders'))}</p>
      ${orders.length ? `<p class="tiny muted">Last one ${timeAgo(orders[0].createdAt)}. <button class="more tap" data-act="nav.orders" style="min-height:44px;padding-inline:2px">See all ${orders.length} →</button></p>`
        : emptyBlock('No orders yet', 'Your first pro is two taps away.',
          `<button class="btn btn--secondary btn--sm" data-act="nav.home">${esc(i18n.t('acct.browseServices'))}</button>`)}
    </div>`}

    ${walletSection(s.key, orders)}

    ${subs.length ? `<div class="sec" id="acRepeat">
      <p class="m-cap">${esc(i18n.t('acct.repeatingWork'))}</p>
      ${subs.slice(0, 3).map(o => `<div class="m-kv"><span class="tiny">${esc(get('category', o.catId).name)} · ${esc(o.partnerName || '')}</span>
        <b class="num" style="font-size:13px">${M.fmt(o.customerPays)}</b></div>`).join('')}
    </div>` : ''}
    </div>

    <div>
    <div class="sec" id="acSettings">
      <!-- THE APP WAS ENGLISH-ONLY while a pro's own page defaults their
           languages to "Telugu, Hindi". The picker is here, and it says
           plainly that nobody whose first language this is has checked the
           translation yet — an app should not imply a review it has not had. -->
      <div style="padding:10px 0;border-bottom:1px solid var(--color-divider)">
        <div class="m-cap" style="margin:0 0 6px">${esc(i18n.t('lang.pick'))}</div>
        <div class="chiprow" style="flex-wrap:wrap">
          ${i18n.LANGS.map(l => `<button class="chip${i18n.lang() === l.id ? ' on' : ''}"
            data-act="lang.set" data-lang="${l.id}" lang="${l.id}">${esc(l.native)}</button>`).join('')}
        </div>
        ${i18n.unreviewed() ? `<p class="micro muted" style="margin-top:6px">${esc(i18n.t('lang.unreviewed'))}</p>` : ''}
      </div>
      <p class="m-cap">${esc(i18n.t('acct.settings'))}</p>
      ${setRow('area.pick', i18n.t('set.addresses'), pinned ? `${esc(myArea())} · ${esc(i18n.t('set.pinned'))}` : esc(myArea()))}
      <!-- THIS WAS AN infoRow — a line of text, not a control — so there was no
           way anywhere in the app for a customer to say where her money should
           go, while "Take out to your UPI" sent it to an empty string. -->
      ${setRow('cwallet.upi', 'Where refunds and take-outs go',
        s.upi ? esc(s.upi) : 'Not set — needed before you can take money out')}
      ${setRow('nav.orders', i18n.t('set.notifications'), needsYou.length ? esc(i18n.t('set.waitingOnYou', { n: needsYou.length })) : esc(i18n.t('set.onlyDecisions')))}
      ${setRow('theme.toggle', i18n.t('set.appearance'), theme)}
      ${setRow('splash.replay', 'Welcome screen', 'Replay')}
      ${setRow('partner.join', 'List my shop or service', '', { em: true })}
      ${setRow('shop.start', 'Open a shop', 'A second account, on this number')}
    </div>

    ${chatThreads.length ? `<div class="sec" id="acMsgs">
      <p class="m-cap">${esc(i18n.t('acct.messages'))}</p>
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

    ${reviews.length ? `<div class="sec" id="acReviews">
      <div class="between" style="margin-bottom:4px"><p class="m-cap" style="margin:0">${esc(i18n.t('acct.yourReviews'))}</p>
        <span class="meta">${reviews.length}</span></div>
      ${reviews.slice(0, 3).map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">
        <div class="between"><b class="tiny">${esc(r.partnerName || '')}</b><span class="micro muted">${timeAgo(r.ts)}</span></div>
        <p class="tiny muted">${ratingStars(r.stars)} ${r.stars}.0${r.text ? ` · ${esc(r.text)}` : ''}</p>
      </div>`).join('')}
    </div>` : `<div class="sec" id="acList">
      <p class="m-cap">${esc(i18n.t('acct.yourShortlist'))}</p>
      <p class="tiny muted">Open a service or a shop and it is one tap away next time.</p>
      <div class="chiprow" style="margin-top:10px;flex-wrap:wrap">
        <button class="chip" data-act="nav.home">${esc(i18n.t('acct.browseServices'))}</button>
        <button class="chip" data-act="nav.shops">${esc(i18n.t('acct.browseShops'))}</button>
      </div>
    </div>`}

    <div class="sec">
      <p class="m-cap">${esc(i18n.t('acct.thisApp'))}</p>
      <!-- A CUSTOMER'S "YOU" TAB OFFERED HER THE ADMIN CONSOLE. It sat one row
           above Sign out, next to Run self-test, on the account screen of every
           person who has ever used this app. The console asks for a password,
           so nothing was open — but a row reading "Admin console" on a
           shopper's own settings tells her this is somebody else's software,
           and "Run self-test" tells her it might be broken. Neither belongs on
           her screen. They appear for a signed-in owner, and nobody else. -->
      ${adminauth.isLoggedIn() ? `${setRow('selftest.run', 'Run self-test', '')}
      ${setRow('nav.admin', 'Admin console', '')}` : ''}
      <button class="btn btn--ghost btn--block" style="margin-top:12px;justify-content:flex-start;color:var(--danger)"
        data-act="auth.logout">${icon('signout', { size: 16 })} ${esc(i18n.t('set.signOut'))}</button>
      <!-- The privacy page promises a person can have their data removed, so the
           promise has somewhere to be kept. The sheet shows exactly what goes,
           what is emptied but kept because someone else's record points at it,
           and what stays because the books must balance. -->
      <button class="btn btn--ghost btn--block" style="margin-top:6px;justify-content:flex-start;color:var(--danger)"
        data-act="account.erase">${icon('trash', { size: 16 })} ${esc(i18n.t('set.erase'))}</button>
    </div>
    </div>
    </div>

    <div class="credo"><div class="cmark">${mark(150, { detail: true, glow: false })}</div>
      <div class="cw">One circle. One purpose.</div>
      <p class="micro muted" style="margin-top:8px">v${VERSION} · schema v${SCHEMA_VERSION} · ${BUILD_ID}</p>
      <p class="micro muted" style="margin-top:8px;position:relative;z-index:1">
        <a class="micro muted" href="#/legal/terms">${esc(i18n.t('legal.terms'))}</a> ·
        <a class="micro muted" href="#/legal/privacy">${esc(i18n.t('legal.privacy'))}</a> ·
        <a class="micro muted" href="#/legal/refunds">${esc(i18n.t('legal.refunds'))}</a> ·
        <a class="micro muted" href="#/legal/contact">${esc(i18n.t('legal.contact'))}</a> ·
        <a class="micro muted" href="#/legal/about">${esc(i18n.t('legal.about'))}</a>
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
    .capsules button.capsule{cursor:pointer} .capsules button.capsule:hover .capsule__v{color:var(--color-accent-text)}
    .m-regs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
    .m-reg{flex:none;width:64px;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer;min-height:44px}
    .m-reg .m-thumb{display:grid;place-items:center}
    .m-reg__n{display:block;font:600 9.5px/1.3 var(--font-body);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .m-reg__c{display:block;font:400 9.5px/1.3 var(--font-body);color:var(--ink-3)}
    .m-reg:hover .m-reg__n{color:var(--color-accent-text)}
  </style>`;
}

/* re-exported so a caller that only has this module can still draw the shell */
export { header, emptyBlock };
