/* SAAHAA · ui/views/earn.js — the Work tab's real destination.

   THE BUG THIS FIXES: the "Work" tab had no route of its own. Tapping it ran a
   redirect — a guest was thrown to the sign-in screen (which hides the nav
   bar entirely, so the tab appeared to vanish) and a customer was silently
   sent to Account, lighting up the "You" tab instead. Both read as "the
   button does nothing".

   Now every user type has a real screen here:
     guest / customer  → the invitation to earn
     partner           → their job console
     shop owner        → their shop console

   This is also where "ask everyone to join as Partner" lives. The pitch leads
   with the only number that matters to a tradesperson: they keep 100% of what
   they quote, against roughly 75% on a commission app. */

import { esc } from '../dom.js';
import { me } from '../../core/ctx.js';
import { live } from '../../core/registry.js';
import { mark, pillarIcon, PILLARS } from '../logo.js';
import * as M from '../../core/money.js';
import { header } from './shops.js';
import { renderPartner, renderShopAdmin } from './partner.js';

/* A worked example beats an adjective. Same job, same pro, two platforms. */
const EXAMPLE_DEAL = 100000;            // ₹1,000 quote
const AGG_COMMISSION = 0.25;

function earningsStrip() {
  const theirs = Math.round(EXAMPLE_DEAL * (1 - AGG_COMMISSION));
  return `
  <div class="saves">
    <div class="old"><div class="k">On a commission app</div>
      <div class="v num">${M.fmt(theirs)}</div></div>
    <div class="good"><div class="k">On SAAHAA</div>
      <div class="v num">${M.fmt(EXAMPLE_DEAL)}</div></div>
    <div><div class="k">You keep</div>
      <div class="v num" style="color:var(--success)">+${M.fmt(EXAMPLE_DEAL - theirs)}</div></div>
  </div>
  <p class="micro muted" style="margin:-4px 0 0">
    On a ₹1,000 job. A 25%-commission app keeps ₹250 of it. SAAHAA keeps none of your
    quote — our fee is added on top and paid by the customer.
  </p>`;
}

const WHO = [
  { ico: '🔧', t: 'You do a trade',      s: 'Plumbing, electrical, AC, carpentry, painting, pest control' },
  { ico: '🧹', t: 'You clean or cook',   s: 'Home cleaning, maid work, cooking, laundry, ironing' },
  { ico: '🏪', t: 'You run a shop',      s: 'Kirana, vegetables, meat, dairy, chemist, water cans, stationery' },
  { ico: '💇', t: 'You have a skill',    s: 'Salon, beauty, massage, tuition, music, pet grooming' },
  { ico: '🚚', t: 'You have a vehicle',  s: 'Shifting, tempo, deliveries, parcels' },
];

const HOW = [
  { n: '1', t: 'Tell us what you do',    s: 'Your trade, your area, your usual price. Two minutes.' },
  { n: '2', t: 'Verify yourself — 10 min', s: 'Phone code, your ID (we keep only the last 4 digits), one photo, five trade questions, six rules. No waiting for anyone.' },
  { n: '3', t: 'Your page goes live',    s: 'A professional page with your badge, ratings and reviews — built and kept current by SAAHAA. Share it on WhatsApp.' },
  { n: '4', t: 'Start getting jobs',     s: 'Jobs near you arrive on your phone. Money is locked before you start. You keep 100% of your quote.' },
];

/* ── the invitation (guest and customer) ───────────────────── */
function invite() {
  const s = me();
  const cats = live('category');
  const services = cats.filter(c => c.kind === 'service').length;
  const shops = cats.filter(c => c.kind === 'retail').length;

  return `
  ${header('Earn with SAAHAA', s ? `Hello ${esc(s.name.split(' ')[0])}` : 'Open to everyone')}
  <main class="wrap">

    <div class="card on-plum" style="margin-top:var(--sp-6);border:0;position:relative;overflow:hidden">
      <div style="position:absolute;right:-26px;top:-22px;opacity:.10;pointer-events:none">
        ${mark(150, { detail: true, glow: false })}
      </div>
      <div style="position:relative">
        <span class="badge badge--gold">Locally, professionally</span>
        <h1 style="font-size:var(--fs-xl);line-height:var(--lh-xl);margin:10px 0 6px;max-width:16ch">
          Your trade. Your price. Your own page.</h1>
        <p class="tiny muted" style="max-width:34ch">
          SAAHAA never takes a cut of your quote — and it runs your professional presence for you:
          a page, a badge, ratings, bookings. You do the work; we do the rest.</p>
      </div>
    </div>

    ${earningsStrip()}

    <div class="sec">
      <div class="hd"><h2>Is this you?</h2></div>
      ${WHO.map(w => `
        <div class="card" style="padding:13px;margin-bottom:8px">
          <div class="row">
            <span class="med" style="width:42px;height:42px;border-radius:50%;background:var(--accent-soft);
              display:grid;place-items:center;font-size:20px;flex:0 0 auto">${w.ico}</span>
            <div class="grow"><b style="font-size:15px">${esc(w.t)}</b>
              <p class="micro muted" style="margin-top:2px">${esc(w.s)}</p></div>
          </div>
        </div>`).join('')}
      <p class="tiny muted" style="margin-top:10px">
        ${services} kinds of service and ${shops} kinds of shop are open to partners right now.
      </p>
    </div>

    <div class="sec">
      <div class="hd"><h2>How it works</h2></div>
      <ol class="track" style="margin-top:4px">
        ${HOW.map((h, i) => `<li class="done">
          <span class="node"><span class="dot">${h.n}</span>
            ${i < HOW.length - 1 ? '<span class="bar"></span>' : ''}</span>
          <span class="body"><b>${esc(h.t)}</b><span>${esc(h.s)}</span></span>
        </li>`).join('')}
      </ol>
    </div>

    <div class="sec">
      <div class="hd"><h2>Why pros stay</h2></div>
      <div class="grid2">
        <div class="card"><h4 style="font-size:14px">🔒 Money locked before you start</h4>
          <p class="micro muted">The customer's payment is held the moment they book. You never
            do a job hoping to be paid.</p></div>
        <div class="card"><h4 style="font-size:14px">📱 A code at the door</h4>
          <p class="micro muted">The customer reads you a 4-digit code when you arrive. It proves
            you were there, so nobody can claim you never came.</p></div>
        <div class="card"><h4 style="font-size:14px">⚖️ Fair when there is a dispute</h4>
          <p class="micro muted">Your arrival code and your finished-work photo settle most
            complaints in your favour, automatically.</p></div>
        <div class="card"><h4 style="font-size:14px">📈 Your price, your call</h4>
          <p class="micro muted">Set your own rate. When several pros are free, you bid — and
            bidding fairly wins more often than bidding cheapest.</p></div>
      </div>
    </div>

    <div class="sec">
      ${PILLARS.length ? `<div class="pillars pillars--c">${PILLARS.map(p => `
        <div class="pill"><span class="pico">${pillarIcon(p, 20)}</span>
        <span class="plbl">${p.label}</span></div>`).join('')}</div>` : ''}
    </div>

    <div style="position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px);
                padding-top:var(--sp-8);z-index:var(--z-sticky)">
      <button class="btn btn--primary btn--lg btn--block" data-act="earn.start">
        Join as a partner — it's free
      </button>
      <p class="micro muted" style="text-align:center;margin-top:10px">
        No joining fee, ever. No monthly charge. You are paid after every job.
      </p>
    </div>
    <div style="height:30px"></div>
  </main>`;
}

/* ── router for the tab ────────────────────────────────────── */
export function render() {
  // Must ALWAYS return markup. Returning null here rendered the literal string
  // "null" on the page, because app.js concatenates the body with the nav bar
  // and `null + "<nav>"` is a string — so it never threw and the error card
  // never fired. Reaching #/earn directly (back button, deep link) did this.
  const s = me();
  if (s && s.role === 'partner') return renderPartner();
  if (s && s.role === 'shop')    return renderShopAdmin();
  return invite();
}

export const wantsConsole = () => {
  const s = me();
  return !!(s && (s.role === 'partner' || s.role === 'shop'));
};
export const consoleRoute = () => {
  const s = me();
  return s && s.role === 'shop' ? 'shopadmin' : 'partner';
};
