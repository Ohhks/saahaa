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

   MODERNIST 8.0 — this screen is the public sibling of the mockup's WHICH
   SIDE ARE YOU ON: the accent block with the wordmark and "Together, we
   elevate life", the two working-side choices as full-bleed rows, the honest
   cost lines, then the worked example, who joins, the four steps and the
   reasons — all in the system's own vocabulary (2px rules, zero radius,
   Archivo, one red). No decoration that is not a rule or a number.

   EVERY FIGURE IS READ FROM THE ENGINE. SAAHAA lays its percentage ON TOP of
   the worker's quote and the customer pays it, so the worker keeps 100% —
   getPricing()/liveMarkup() say what the percentage is today, and a shop's
   own rate and cap come from the same dials. Nothing here is typed. */

import { esc } from '../dom.js';
import { liveMarkup, AGG_COMMISSION } from '../../domain/pricing.js';
import { getPricing } from '../../domain/settings.js';
import { icon } from '../icons.js';
import { me } from '../../core/ctx.js';
import { live } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { header } from './shops.js';
import { renderPartner, renderShopAdmin } from './partner.js';

/* A worked example beats an adjective. Same job, same pro, two platforms. */
const EXAMPLE_DEAL = 100000;            // ₹1,000 quote

const earnCSS = `<style>
  .ern{max-width:640px}
  .ern__hero{background:var(--color-accent);color:var(--accent-on-fill);padding:26px var(--gutter) 22px}
  .ern__hero .wm{color:inherit;font:800 11px/1 var(--font-heading);letter-spacing:.2em;opacity:.85;display:block}
  .ern__hero h1{font:800 32px/1.06 var(--font-heading);letter-spacing:-.02em;margin:14px 0 8px}
  .ern__hero p{font-size:13px;opacity:.92;max-width:30ch;margin:0}
  .ern__side{display:block;width:100%;text-align:left;padding:16px 14px 16px 12px;color:inherit;
    border-bottom:1px solid var(--color-divider);border-left:4px solid var(--color-accent)}
  .ern__side + .ern__side{border-left-color:transparent}
  .ern__side b{font:800 18px/1.15 var(--font-heading);display:block}
  .ern__side span{display:block;font-size:12.5px;color:var(--ink-3);margin-top:5px}
  .ern__side:hover{background:var(--color-neutral-100)}
  :root[data-theme="dark"] .ern__side:hover{background:var(--surface-2)}
  .ern__note{padding:14px 12px;border-bottom:2px solid var(--color-divider);font-size:12.5px;color:var(--ink-3)}
  .ern__cost{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:9px 0;border-bottom:1px solid var(--color-divider)}
  .ern__cost:last-child{border-bottom:0}
  .ern__nums{display:grid;grid-template-columns:1fr 1fr;border-top:2px solid var(--color-divider);border-bottom:2px solid var(--color-divider)}
  .ern__num{padding:14px 12px} .ern__num + .ern__num{border-left:1px solid var(--color-divider);background:var(--color-accent-100)}
  :root[data-theme="dark"] .ern__num + .ern__num{background:#3a201c}
  .ern__num .k{font:600 10px/1.3 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
  .ern__num .v{font:800 30px/1 var(--font-heading);letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:7px 0 5px;word-break:break-word}
  .ern__num .d{font-size:11.5px;color:var(--ink-3)}
  .ern__num.on .v{color:var(--color-accent)}
  .ern__row{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--color-divider)}
  .ern__row .ic{width:36px;height:36px;flex:none;display:grid;place-items:center;background:var(--color-accent-100);color:var(--color-accent)}
  :root[data-theme="dark"] .ern__row .ic{background:var(--surface-3)}
  .ern__row b{font:800 14.5px/1.2 var(--font-heading);display:block}
  .ern__row p{font-size:11.5px;color:var(--ink-3);margin:3px 0 0}
  .ern__n{width:24px;height:24px;flex:none;display:grid;place-items:center;background:var(--color-text);color:var(--color-bg);font:800 11px/1 var(--font-heading)}
  .ern__foot{position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));z-index:var(--z-sticky);
    background:var(--bg);border-top:2px solid var(--color-divider);padding:12px 0 14px;margin-top:var(--sp-8)}
  .ern__foot .btn-primary{width:100%;justify-content:flex-start}
  @media (min-width:768px){
    .ern{max-width:1100px} .ern__hero{padding-left:var(--sp-8);padding-right:var(--sp-8)}
    .ern__foot{bottom:0}
  }
  @media (min-width:1024px){
    .ern__hero{padding-left:var(--sp-10);padding-right:var(--sp-10)}
    .ern__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sp-10);align-items:start}
  }
</style>`;

const WHO = [
  { ico: 'repair', t: 'You do a trade', s: 'Plumbing, electrical, AC, carpentry, painting, pest control' },
  { ico: 'cleaning', t: 'You clean or cook', s: 'Home cleaning, maid work, cooking, laundry, ironing' },
  { ico: 'kirana', t: 'You run a shop', s: 'Kirana, vegetables, meat, dairy, chemist, water cans, stationery' },
  { ico: 'salon', t: 'You have a skill', s: 'Salon, beauty, massage, tuition, music, pet grooming' },
  { ico: 'moving', t: 'You have a vehicle', s: 'Shifting, tempo, deliveries, parcels' },
];

const HOW = [
  { n: '1', t: 'Tell us what you do', s: 'Your trade, your area, your usual price. Two minutes.' },
  { n: '2', t: 'Verify yourself — 10 min', s: 'Phone code, your ID (we keep only the last 4 digits), one photo, five trade questions, six rules. No waiting for anyone.' },
  { n: '3', t: 'Your page goes live', s: 'A professional page with your badge, ratings and reviews — built and kept current by SAAHAA. Share it on WhatsApp.' },
  { n: '4', t: 'Start getting jobs', s: 'Jobs near you arrive on your phone. Money is locked before you start. You keep 100% of your quote.' },
];

const WHY = [
  { ic: 'lock', t: 'Money locked before you start', s: `The customer's payment is held the moment they book. You never do a job hoping to be paid.` },
  { ic: 'phone', t: 'A code at the door', s: 'The customer reads you a 4-digit code when you arrive. It proves you were there, so nobody can claim you never came.' },
  { ic: 'scale', t: 'Fair when there is a dispute', s: 'Your arrival code and your finished-work photo settle most complaints in your favour, automatically.' },
  { ic: 'trend', t: 'Your price, your call', s: 'Set your own rate. When several pros are free, you bid — and bidding fairly wins more often than bidding cheapest.' },
];

/* The two working sides, worded from the live dials. A service partner keeps
   every rupee they quote; a shop pays a small per-order fee out of its own
   price, capped, and never a yearly plan.

   EACH ROW OPENS ITS OWN SIGN-UP (8.2). Both used to carry `earn.start`,
   which sets the role to *partner* — so "I run a shop" landed a shopkeeper on
   the trade form and left them to notice the picker and correct it. `shop.start`
   has existed since 8.2 for exactly this; the row that says shop now uses it. */
function sideRows(pct, P) {
  const rows = [
    ['earn.start', 'I offer a service', `Quote jobs and keep 100% of your price. SAAHAA's ${pct}% is added on top and paid by the customer.`],
    ['shop.start', 'I run a shop', `A storefront with your stock, live today. ${P.retailTakePct}% an order, capped at ${M.fmt(P.retailTakeCapPaise)}. No yearly plan.`],
  ];
  return rows.map(([a, t, s]) => `<button class="ern__side tap" type="button" data-act="${a}">
      <b>${esc(t)}</b><span>${esc(s)}</span></button>`).join('');
}

/* The one number a tradesperson checks first, on a real job. */
function worked(pct) {
  const theirs = Math.round(EXAMPLE_DEAL * (1 - AGG_COMMISSION));
  return `<div class="ern__nums">
      <div class="ern__num"><div class="k">On a commission app</div>
        <div class="v">${M.fmt(theirs)}</div><div class="d">they keep the rest</div></div>
      <div class="ern__num on"><div class="k">On SAAHAA</div>
        <div class="v">${M.fmt(EXAMPLE_DEAL)}</div><div class="d">your whole quote</div></div>
    </div>
    <p class="micro muted" style="padding:10px 0 0">
      On a ${M.fmt(EXAMPLE_DEAL)} job. A ${Math.round(AGG_COMMISSION * 100)}%-commission app keeps
      ${M.fmt(EXAMPLE_DEAL - theirs)} of it. SAAHAA keeps none of your quote — our ${pct}% is added on
      top of it and paid by the customer, so what you quote is what you are paid.</p>`;
}

/* ── the invitation (guest and customer) ───────────────────── */
function invite() {
  const s = me();
  const cats = live('category');
  const services = cats.filter(c => c.kind === 'service').length;
  const shops = cats.filter(c => c.kind === 'retail').length;
  const pct = Math.round(liveMarkup() * 100);
  const P = getPricing();

  return `
  ${header('Earn with SAAHAA', s ? `Hello ${esc(s.name.split(' ')[0])}` : 'Open to everyone')}
  ${earnCSS}

  <div class="ern__hero">
    <span class="wm">SAAHAA</span>
    <h1>Your trade.<br>Your price.<br>All of it yours.</h1>
    <p>One circle for every service and every shop in your neighbourhood.</p>
  </div>

  <div>${sideRows(pct, P)}</div>
  <p class="ern__note">Each opens its own sign-up, and the choice is the first thing on it either way — so changing your mind costs one tap.
    Already need something done instead? That is the Home tab: always free, and no markup on anyone's prices.</p>

  <main class="wrap ern" style="padding-top:0">

    <div style="padding:14px 0 4px">
      <div class="ern__cost"><span class="muted">Cost to list</span><strong>₹0</strong></div>
      <div class="ern__cost"><span class="muted">Cost per order — a service</span><strong>₹0 · the customer pays ${pct}% on top</strong></div>
      <div class="ern__cost"><span class="muted">Cost per order — a shop</span><strong>${P.retailTakePct}%, capped ${M.fmt(P.retailTakeCapPaise)}</strong></div>
      <div class="ern__cost"><span class="muted">Typical aggregator</span><strong class="em">${Math.round(AGG_COMMISSION * 100)}%</strong></div>
    </div>

    <div style="margin-top:var(--sp-6)">${worked(pct)}</div>

    <div class="ern__two">
      <div>
        <div class="hd"><div><span class="eyebrow">Who joins</span><h2 class="h-sec">Is this you?</h2></div></div>
        <div>
          ${WHO.map(w => `<div class="ern__row">
            <span class="ic" aria-hidden="true">${icon(w.ico, { size: 20 })}</span>
            <div class="grow" style="min-width:0"><b>${esc(w.t)}</b><p>${esc(w.s)}</p></div>
          </div>`).join('')}
        </div>
        <p class="micro muted" style="padding:10px 0">
          ${services} kinds of service and ${shops} kinds of shop are open to partners right now.
        </p>
      </div>

      <div>
        <div class="hd"><div><span class="eyebrow">Four steps</span><h2 class="h-sec">How it works</h2></div>
          <span class="tag tag-neutral">about 15 min</span></div>
        <div>
          ${HOW.map(h => `<div class="ern__row">
            <span class="ern__n" aria-hidden="true">${h.n}</span>
            <div class="grow" style="min-width:0"><b>${esc(h.t)}</b><p>${esc(h.s)}</p></div>
          </div>`).join('')}
        </div>

        <div class="hd"><div><span class="eyebrow">The reason</span><h2 class="h-sec">Why pros stay</h2></div></div>
        <div>
          ${WHY.map(w => `<div class="ern__row">
            <span class="ic" aria-hidden="true">${icon(w.ic, { size: 18 })}</span>
            <div class="grow" style="min-width:0"><b>${esc(w.t)}</b><p>${esc(w.s)}</p></div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="ern__foot">
      <button class="btn btn-primary btn--lg" data-act="earn.start">
        Join as a partner — it's free
      </button>
      <p class="micro muted" style="margin-top:10px">
        No joining fee, ever. No monthly charge. You are paid after every job.
      </p>
    </div>
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
