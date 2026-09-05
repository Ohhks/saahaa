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
   they quote, against roughly 75% on a commission app.

   OPEN CIRCLE · LIVING GLASS: this screen is an invitation, not a console —
   so it opens on deep plum and gold, keeps one promise per block, and ends
   on a single sticky action. Every string's meaning is the one it had. */

import { esc } from '../dom.js';
import { SERVICE_MARKUP } from '../../domain/pricing.js';
import { icon, hasIcon } from '../icons.js';
import { me } from '../../core/ctx.js';
import { live } from '../../core/registry.js';
import { mark, pillarIcon, PILLARS } from '../logo.js';
import * as M from '../../core/money.js';
import { header } from './shops.js';
import { renderPartner, renderShopAdmin } from './partner.js';

/* A worked example beats an adjective. Same job, same pro, two platforms. */
const EXAMPLE_DEAL = 100000;            // ₹1,000 quote
const AGG_COMMISSION = 0.25;

const earnCSS = `<style>
  .earnwho{display:grid;gap:10px}
  @media (min-width:1024px){
    .earnwho{grid-template-columns:1fr 1fr}
    .earnwhy{grid-template-columns:repeat(2,1fr)}
  }
</style>`;

const capsule = (k, v, d = '', tone = '') =>
  `<div class="capsule${tone ? ` capsule--${tone}` : ''}">
    <span class="capsule__k">${k}</span>
    <span class="capsule__v num">${v}</span>
    ${d ? `<span class="capsule__d">${d}</span>` : ''}
  </div>`;

function earningsStrip() {
  const theirs = Math.round(EXAMPLE_DEAL * (1 - AGG_COMMISSION));
  return `
  <div class="capsules metricrow">
    ${capsule('On a commission app', M.fmt(theirs), 'they keep the rest', 'bad')}
    ${capsule('On SAAHAA', M.fmt(EXAMPLE_DEAL), 'your whole quote', 'gold')}
    ${capsule('You keep', `+${M.fmt(EXAMPLE_DEAL - theirs)}`, 'every ₹1,000 job', 'ok')}
  </div>
  <p class="micro muted">
    On a ₹1,000 job. A 25%-commission app keeps ₹250 of it. SAAHAA keeps none of your
    quote — our ${Math.round(SERVICE_MARKUP * 100)}% is added on top and paid by the customer.
  </p>`;
}

const WHO = [
  { ico: 'repair', t: 'You do a trade',      s: 'Plumbing, electrical, AC, carpentry, painting, pest control' },
  { ico: 'cleaning', t: 'You clean or cook',   s: 'Home cleaning, maid work, cooking, laundry, ironing' },
  { ico: 'kirana', t: 'You run a shop',      s: 'Kirana, vegetables, meat, dairy, chemist, water cans, stationery' },
  { ico: 'salon', t: 'You have a skill',    s: 'Salon, beauty, massage, tuition, music, pet grooming' },
  { ico: 'moving', t: 'You have a vehicle',  s: 'Shifting, tempo, deliveries, parcels' },
];

const HOW = [
  { n: '1', t: 'Tell us what you do',    s: 'Your trade, your area, your usual price. Two minutes.' },
  { n: '2', t: 'Verify yourself — 10 min', s: 'Phone code, your ID (we keep only the last 4 digits), one photo, five trade questions, six rules. No waiting for anyone.' },
  { n: '3', t: 'Your page goes live',    s: 'A professional page with your badge, ratings and reviews — built and kept current by SAAHAA. Share it on WhatsApp.' },
  { n: '4', t: 'Start getting jobs',     s: 'Jobs near you arrive on your phone. Money is locked before you start. You keep 100% of your quote.' },
];

const WHY = [
  { ic: 'lock', t: 'Money locked before you start', s: `The customer's payment is held the moment they book. You never do a job hoping to be paid.` },
  { ic: 'phone', t: 'A code at the door', s: 'The customer reads you a 4-digit code when you arrive. It proves you were there, so nobody can claim you never came.' },
  { ic: 'scale', t: 'Fair when there is a dispute', s: 'Your arrival code and your finished-work photo settle most complaints in your favour, automatically.' },
  { ic: 'trend', t: 'Your price, your call', s: 'Set your own rate. When several pros are free, you bid — and bidding fairly wins more often than bidding cheapest.' },
];

/* ── the invitation (guest and customer) ───────────────────── */
function invite() {
  const s = me();
  const cats = live('category');
  const services = cats.filter(c => c.kind === 'service').length;
  const shops = cats.filter(c => c.kind === 'retail').length;

  return `
  ${header('Earn with SAAHAA', s ? `Hello ${esc(s.name.split(' ')[0])}` : 'Open to everyone')}
  ${earnCSS}
  <main class="wrap">

    <div class="hero glass glass--deep sheen rise" style="margin-top:var(--sp-6);position:relative;overflow:hidden;
         padding:22px 18px;border-radius:var(--r-lg)">
      <div style="position:absolute;right:-26px;top:-22px;opacity:.10;pointer-events:none">
        ${mark(150, { detail: true, glow: false })}
      </div>
      <div style="position:relative">
        <span class="pill pill--gold">Locally, professionally</span>
        <h1 class="display" style="font-size:var(--fs-xl);line-height:var(--lh-xl);margin:10px 0 6px;max-width:16ch">
          Your trade. Your price. Your own page.</h1>
        <p class="tiny muted" style="max-width:34ch">
          SAAHAA never takes a cut of your quote — and it runs your professional presence for you:
          a page, a badge, ratings, bookings. You do the work; we do the rest.</p>
      </div>
    </div>

    <div style="margin-top:var(--sp-6)">${earningsStrip()}</div>

    <div class="sec">
      <div class="hd"><div><span class="eyebrow">Who joins</span><h2 class="h-sec">Is this you?</h2></div></div>
      <div class="earnwho">
        ${WHO.map((w, i) => `
          <div class="tile--wide card glass rise${i ? ` rise-${Math.min(5, i + 1)}` : ''}" style="padding:13px">
            <div class="row">
              <span class="chip__ic med" style="width:42px;height:42px;border-radius:50%;background:var(--accent-soft);
                display:grid;place-items:center;flex:0 0 auto">${icon(w.ico, { size: 22 })}</span>
              <div class="grow"><b style="font-size:15px">${esc(w.t)}</b>
                <p class="micro muted" style="margin-top:2px">${esc(w.s)}</p></div>
            </div>
          </div>`).join('')}
      </div>
      <p class="tiny muted" style="margin-top:10px">
        ${services} kinds of service and ${shops} kinds of shop are open to partners right now.
      </p>
    </div>

    <div class="sec">
      <div class="hd"><div><span class="eyebrow">Four steps</span><h2 class="h-sec">How it works</h2></div>
        <span class="pill pill--soft">about 15 min</span></div>
      <ol class="track timeline" style="margin-top:4px">
        ${HOW.map((h, i) => `<li class="done timeline__item">
          <span class="node timeline__node"><span class="dot timeline__dot">${h.n}</span>
            ${i < HOW.length - 1 ? '<span class="bar timeline__bar"></span>' : ''}</span>
          <span class="body timeline__body"><b>${esc(h.t)}</b><span>${esc(h.s)}</span></span>
        </li>`).join('')}
      </ol>
    </div>

    <div class="sec">
      <div class="hd"><div><span class="eyebrow">The reason</span><h2 class="h-sec">Why pros stay</h2></div></div>
      <div class="grid2 earnwhy">
        ${WHY.map(w => `<div class="card glass">
          <h4 style="font-size:14px"><span style="display:inline-flex;align-items:center;gap:8px">${icon(w.ic, { size: 16 })} ${esc(w.t)}</span></h4>
          <p class="micro muted">${esc(w.s)}</p></div>`).join('')}
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
