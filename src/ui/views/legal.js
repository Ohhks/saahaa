/* SAAHAA · ui/views/legal.js — Terms · Privacy · Refunds & cancellation ·
   Contact · About. Routed as #/legal/<page>.

   These pages are what a payment gateway reads before it activates a
   merchant, and what a customer reads before they trust us with a rupee. So
   every number on them is READ from the engine, never typed here: the refund
   table is CANCEL_RULES, the charges are getPricing(), the company details
   are CONTACT, and the sandbox banner is gateway.isSandbox(). If the owner
   pushes a new dial, the page changes with it; the page cannot lie.

   MODERNIST. A reading column in the system: the segmented page nav as
   .seg, 2px rules between sections, h2 section heads, the table in .table. */

import { esc } from '../dom.js';
import { header, SYS_CSS } from './shops.js';
import * as gateway from '../../core/gateway.js';
import { CONTACT } from '../../core/config.js';
import { CANCEL_RULES } from '../../domain/pricing.js';
import { getPricing } from '../../domain/settings.js';
import { MIN_STAKE, MAX_STAKE, STAKE_PCT } from '../../domain/wallet.js';
import { HOLDBACK_DAYS } from '../../domain/ledger.js';
import * as M from '../../core/money.js';

export const PAGES = ['terms', 'privacy', 'refunds', 'contact', 'about'];
export const UPDATED = '7 September 2026';

const TITLES = {
  terms:   'Terms & Conditions',
  privacy: 'Privacy Policy',
  refunds: 'Refunds & Cancellation',
  contact: 'Contact',
  about:   'About SAAHAA',
};
const SHORT = { terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds', contact: 'Contact', about: 'About' };

/* ── small helpers ─────────────────────────────────────────── */
const pctOf = f => `${Math.round(f * 100)}%`;
const km = b => (b.maxKm >= 999 ? 'beyond that' : `up to ${b.maxKm} km`);
const value = (v, empty = 'not yet set') => (v ? esc(v) : `<span class="muted">${empty}</span>`);
const sec = (title, body) => `<section class="lg-sec"><h2>${esc(title)}</h2>${body}</section>`;
const p = html => `<p class="tiny">${html}</p>`;
const ul = items => `<ul class="tiny lg-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

/* the segmented nav: plain hash links, so it works with no JS at all */
function nav(page) {
  return `<nav class="seg seg--block lg-nav" aria-label="Legal pages">
    ${PAGES.map(id => `<a class="seg__btn${id === page ? ' on' : ''}" href="#/legal/${id}"
        ${id === page ? 'aria-current="page" aria-selected="true"' : ''}>${esc(SHORT[id])}</a>`).join('')}
  </nav>`;
}

/* the honest banner: shown only while the rail is the sandbox */
function banner() {
  if (!gateway.isSandbox()) return '';
  return `<p id="legalBanner" class="m-note lg-banner" role="status">
    <b>Payments are in sandbox:</b> no real money moves yet. (${esc(gateway.label())})
  </p>`;
}

/* ── TERMS ────────────────────────────────────────────────── */
function terms() {
  const P = getPricing();
  const bands = P.deliveryBands.map(b => `${km(b)} ${M.fmt(b.fee)}`).join(' · ');
  return [
    sec('What SAAHAA is', p(`SAAHAA is a marketplace connecting customers with independent local
      professionals and local shops. The professional or the shop does the work or sells the goods;
      SAAHAA is not the service provider and not the seller. It is where you find each other, agree
      a price, and where the money is held until the work is confirmed. Using SAAHAA means you
      accept these terms.`)),
    sec('Your account', ul([
      'You sign in with your mobile number and a password. One number is one account.',
      'You must be 18 or older to book, sell or take work. Anyone 13 or older may browse.',
      'Keep your password to yourself; what is done from your account counts as done by you.',
    ])),
    sec('How a booking works', ul([
      'The professional quotes a price. It is locked before you confirm.',
      'Your payment is held by SAAHAA while the work is done.',
      'You get a 4-digit code; the professional enters it on arrival, which proves the right person came.',
      'At least one photo of the finished work is required; without it the money is never released automatically.',
      'You confirm the work and the money goes to the professional. If you do nothing, most jobs release by themselves after 6 or 24 hours; higher-risk jobs wait for the owner.',
    ])),
    sec('What SAAHAA charges', p(`On a service the professional keeps 100% of the price they quoted.
      SAAHAA’s charge is <b>${esc(P.serviceMarkupPct)}%</b> laid on top of that quote and paid by
      you; GST on that charge is remitted, not kept. A SAAHAA Certified professional carries
      <b>${esc(P.loyaltyMarkupPct)}%</b>. On a shop order SAAHAA takes <b>${esc(P.retailTakePct)}%</b>
      of the basket from the shop’s side, never more than ${M.fmt(P.retailTakeCapPaise)} an order
      and never less than ${M.fmt(P.retailFeeFloorPaise)} (a shop’s first 30 orders are free of it).
      Item prices never exceed MRP. Delivery is a separate, visible fee by distance:
      ${esc(bands)}; ${M.fmt(P.riderDispatchCutPaise)} of each delivery fee is SAAHAA’s dispatch
      cut and the rest is the rider’s. These are today’s values; an order keeps the numbers it
      was booked with.`)),
    sec('If you are a partner', ul([
      'Verification is a ladder: Phone Verified, ID Verified, Background Checked, SAAHAA Certified. Each rung raises what you can take on.',
      `You stake ${STAKE_PCT}% of the job (${M.fmt(MIN_STAKE)} to ${M.fmt(MAX_STAKE)}) when work starts. It comes back in full when the job settles cleanly and is forfeited on an upheld dispute.`,
      `Part of each payout is held for ${HOLDBACK_DAYS} days against returns and disputes, then released by itself.`,
      'Never ask a customer to pay you outside SAAHAA, and never share a phone number or UPI id in chat to do so. This one rule ends an account immediately.',
    ])),
    sec('What you may not do', ul([
      'Hold more than one account, or book, bid or list under a false name, trade or identity.',
      'Arrange anything illegal or unsafe, or post reviews, vouches or ratings that are not your own honest experience.',
      'Interfere with the service, other users’ data or the ledger.',
    ])),
    sec('Disputes and suspension', p(`Raise a problem within 48 hours of the job from the order
      screen (You → Needs you). The owner reads both sides and decides: a full release, a
      full refund, or a partial refund with the professional paid for the part that was done;
      SAAHAA’s own charge shrinks in the same proportion. An account that breaks these terms or is
      reasonably believed to be used for fraud may be suspended or removed; money already held for
      a job is settled under these rules, not kept.`)),
    sec('What SAAHAA is responsible for, and what it is not', ul([
      'SAAHAA holds your money and releases it only under these rules.',
      'SAAHAA verifies identity and trade to the level shown on the badge. It does not guarantee the quality of any work or product, and is not liable for the acts of a professional or shop beyond the amount held for that order.',
      'The service is provided as it is; we do not promise it is never down.',
    ])),
    sec('Law and changes', p(`These terms are governed by the laws of India; disputes go to the
      courts of Hyderabad, Telangana. We may change these terms; the date at the top moves when we
      do, and continuing to use SAAHAA after a change means you accept it.`)),
  ].join('');
}

/* ── PRIVACY ──────────────────────────────────────────────── */
function privacy() {
  return [
    sec('What we store', ul([
      'For everyone: your name, mobile number, the place you set, your orders, the ratings you give and receive, and every money movement on your account (the ledger).',
      'For partners, in addition: a hash of your ID document plus its last 4 digits (never the number itself), a selfie, your UPI id, and the name and last 4 digits of the phone number of the person you gave as a reference.',
      'For shops: the shop name, address and product list you publish.',
      'Order photos and chat messages, because they are the evidence a dispute is decided on.',
    ])),
    sec('Where it lives', p(`Today the app keeps this data on your own device, in the browser’s
      local storage. When the backend is switched on it will be kept in a Supabase database
      (hosted in the cloud, protected by row-level security so each account can only read its own
      rows). Both are true right now: your device holds the data, and the backend is being wired.
      This page will say so when that changes.`)),
    sec('Who sees what', ul([
      'A customer sees a professional’s name, badge, rating, jobs done and public page. Never their ID, selfie, UPI id or reference.',
      'A professional sees the customer’s name and place only for a job they have been booked on, and only while the job is open.',
      'The owner of SAAHAA can see accounts, orders, disputes and the ledger, to run the service and settle disputes. Every such action is written to an audit log.',
      'Nobody buys your data. It is not sold, rented or shared for advertising, and there are no third-party trackers or analytics scripts on this site.',
    ])),
    sec('Third parties that necessarily receive something', ul([
      'Map tiles come from OpenStreetMap and place search from Nominatim. When you search a place, the text you typed and the coordinates you look at are sent to them. No order id or account detail goes with it.',
      'When the Razorpay rail is live, Razorpay receives what it needs to take a payment: the amount, an order reference, and whatever you type into its checkout. Until then, payments are a sandbox and nothing leaves this site.',
      'The typeface is served from this site; no font server sees your visit.',
    ])),
    sec('How long, and how to delete', p(`We keep account and order data for as long as the account
      exists, and ledger entries for as long as the law requires a business to keep its books.
      You can ask for your account to be removed (see Contact); we delete what we can and keep only
      what accounts and tax law oblige us to keep. The owner’s Fresh start wipes a whole device
      clean and is itself audited.`)),
    sec('Cookies', p(`None. The site uses the browser’s local storage to keep you signed in and
      to hold your data, and nothing else. There is no advertising cookie and no cross-site
      tracking.`)),
    sec('Children', p(`You may browse SAAHAA from 13. You must be 18 to book, sell or take work. We
      do not knowingly hold an account for anyone under 18; if you believe we do, write to us and
      it will be removed.`)),
    sec('Privacy requests', p(`Write to the email on the Contact page to see what we hold about you,
      correct it, or have it deleted. Requests are answered by the owner within 30 days.`)),
  ].join('');
}

/* ── REFUNDS & CANCELLATION ───────────────────────────────── */
function refunds() {
  const rows = Object.entries(CANCEL_RULES).map(([id, r]) => {
    const extra = [
      r.credit ? `+ ${M.fmt(r.credit)} credit to you` : '',
      r.workerFee ? `${M.fmt(r.workerFee)} charged to the pro` : '',
    ].filter(Boolean).join(' · ');
    return `<tr data-rule="${esc(id)}">
      <td>${esc(r.label)}</td>
      <td class="num">${pctOf(r.refundPct)}</td>
      <td class="num">${pctOf(r.workerPct)}</td>
      <td class="muted">${esc(extra) || '—'}</td>
    </tr>`;
  }).join('');
  return [
    sec('Cancelling a service booking', p(`What comes back depends on when you cancel. The refund is a
      share of what you paid; the professional’s share is a share of their quote. Whatever is left
      stays with SAAHAA as the cancellation charge. These rows are read from the same rules the
      app uses; they cannot differ from what you are actually refunded.`) +
      `<div class="lg-tablewrap tablewrap">
      <table id="refundTable" class="table tiny" style="min-width:420px">
        <thead><tr>
          <th>When</th>
          <th class="num">Refund to you</th>
          <th class="num">Pro keeps</th>
          <th>Also</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`),
    sec('Shop orders', ul([
      'An item the shop could not supply is simply not charged: the order is settled on what was actually picked, and the difference is refunded in full.',
      'A return the shop accepts is refunded in full.',
      'An order that was never delivered, or a shop that stopped responding, is refunded in full including the delivery fee.',
      'Delivery fees on a completed order are not refunded, because the rider was paid.',
    ])),
    sec('Where a refund lands', p(`A refund goes to your SAAHAA wallet at once. From the wallet you can
      take it out to your UPI id whenever you like. When the Razorpay rail is live, a refund of a
      card or net-banking payment is sent back to the original payment method and normally shows
      within 5–7 working days; UPI refunds are usually faster. While payments are in sandbox,
      no real money has moved, so nothing real is refunded.`)),
    sec('Problems with finished work', p(`If the work was done badly or not at all, do not confirm
      it. Raise a dispute from the order within 48 hours (You → Needs you). The owner
      reads both sides and decides on a full or partial refund. A partial refund pays the
      professional only for the part that was done, and SAAHAA’s own charge shrinks in the same
      proportion.`)),
    sec('Goodwill credits', p(`A credit shown in the table is money SAAHAA adds to your wallet from
      its own pocket, on top of your refund, when a professional let you down. It is spendable on
      any order.`)),
  ].join('');
}

/* ── CONTACT ──────────────────────────────────────────────── */
function contact() {
  const row = (k, v) => `<div class="between lg-kv"><span class="muted">${esc(k)}</span><span id="ct-${k.toLowerCase().replace(/[^a-z]+/g, '-')}" style="text-align:right">${v}</span></div>`;
  return [
    sec('The company', `<div class="lg-card">
      ${row('Legal name', value(CONTACT.legalName))}
      ${row('Email', CONTACT.email ? `<a href="mailto:${esc(CONTACT.email)}">${esc(CONTACT.email)}</a>` : value(''))}
      ${row('Phone', CONTACT.phone ? `<a href="tel:${esc(CONTACT.phone)}">${esc(CONTACT.phone)}</a>` : value(''))}
      ${row('Address', value(CONTACT.address))}
      ${row('GSTIN', value(CONTACT.gstin))}
      ${row('City', value(CONTACT.city))}
    </div>` + p(`<span class="muted">A field marked “not yet set” is filled the day the entity is
      registered. We never print a placeholder value.</span>`)),
    sec('A problem with an order', p(`Sign in and open <b>You → Needs you</b>. Every open
      order, dispute and refund is there, and that is where the owner sees it first. It is faster
      than email because it carries the order, the photos and the chat with it, so nothing has to
      be explained twice. Use it for a wrong charge, a professional who did not arrive, a shop that
      substituted an item, or a refund that has not landed in your wallet.`)),
    sec('Writing to us', p(`For anything that is not tied to one order, email is the channel. Put
      the mobile number your account is under in the first line, and the order id if there is one;
      the owner answers from Hyderabad, in English, Telugu or Hindi, normally within one working
      day. There is no call centre and no chatbot: the person who replies is the person who can
      fix it. Please do not send passwords, full ID numbers or card details by email; we never ask
      for them.`)),
    sec('Grievance officer', p(`Under India’s IT rules a platform names a grievance officer. For
      SAAHAA that is the owner, reachable at the email above; the name and email are published here
      the day they are set. A grievance is acknowledged within 24 hours and resolved within 15
      days.`)),
    sec('Privacy and account removal', p(`Write to the same email from the number your account is
      under, or from the email you gave us if you gave one. We confirm what we hold, correct what
      is wrong, and remove the account within 30 days, keeping only what accounts and tax law
      oblige a business to keep. See the Privacy page for the full list.`)),
    sec('Security', p(`If you have found a way to get at money or data that you should not be able to,
      please tell us by email before telling anyone else. The security model is published honestly
      in the repository (docs/SECURITY.md).`)),
  ].join('');
}

/* ── ABOUT ────────────────────────────────────────────────── */
function about() {
  return [
    sec('The problem', p(`A plumber in Kukatpally has no digital existence. He has a phone number and a
      reputation that lives in the heads of forty households; when a family moves away he loses
      them, and when a new one arrives two streets over they open an app and pay a stranger. He
      cannot build a website, and every solution sold to him puts the maintenance back on the one
      person with no time for it. The apps that do bring him customers take 20–30% of his price,
      so he pads the quote and the customer overpays. The kirana owner has the same problem with a
      different face: quick-commerce apps take 25% of a basket where her margin is 3–6%, so every
      listing is a loss. One problem, three faces: local professionals and shops have no way to be
      found, trusted and paid digitally without either building technology themselves or
      surrendering a quarter of their income to someone who does.`)),
    sec('Locally, professionally', ul([
      'A public page for every verified partner, generated from their work and kept current by the platform. They edit three fields.',
      'The professional keeps 100% of their quote. SAAHAA’s charge sits on top and is paid by the customer.',
      'Shops list from a ready-made product list in minutes and pay a small capped fee, nothing on their first 30 orders.',
      'Trust is mechanical: verification, a locked price, money held until the work is confirmed, a 4-digit arrival code, a photo before payout, a stake from the worker, and a hash-chained ledger that reconciles to zero.',
      'When more than one pro is free, the customer can ask for sealed rates, scored on trust and distance as much as price.',
    ])),
    sec('Who runs it', p(`SAAHAA is built and run by one owner in Hyderabad, starting with one pincode:
      ten pros, three shops, fifty households, then the next pincode. The unit is a neighbourhood,
      because that is where trust already exists and simply has no digital form.`)),
    sec('Open source', p(`The whole product, including the pricing engine and this page, is public at
      <a href="https://github.com/Ohhks/saahaa" rel="noopener">github.com/Ohhks/saahaa</a>. You can read
      exactly how every rupee is split, and check that the app you are using does what these pages
      say.`)),
  ].join('');
}

const BODY = { terms, privacy, refunds, contact, about };

/* ── the page ─────────────────────────────────────────────────
   Returns markup; app.js mounts it inside the shell (every view does). */
export function render(page = 'terms') {
  const id = PAGES.includes(page) ? page : 'terms';
  return `
  ${header(TITLES[id], 'SAAHAA · locally, professionally')}
  <main class="wrap lg-page" id="legalPage" data-page="${id}">
    ${banner()}
    ${nav(id)}
    <p class="card-kicker" style="margin-top:var(--sp-8)">Last updated ${esc(UPDATED)}</p>
    <h1 class="lg-h1">${esc(TITLES[id])}</h1>
    ${BODY[id]()}
    <p class="micro muted lg-foot">
      ${PAGES.map(x => `<a class="micro muted" href="#/legal/${x}">${esc(SHORT[x])}</a>`).join(' · ')}
    </p>
    <div style="height:80px"></div>
  </main>
  ${SYS_CSS}
  <style>
    .lg-page{padding-bottom:var(--sp-9);max-width:760px}
    .lg-banner{margin:var(--sp-6) 0 0}
    .lg-nav{display:flex;margin:var(--sp-6) 0 0;width:100%}
    .lg-nav .seg__btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;color:inherit;flex:1;padding:9px 6px}
    .lg-nav .seg__btn.on{color:#fff}
    .lg-h1{font:800 var(--fs-2xl)/var(--lh-2xl) var(--font-heading);letter-spacing:-.015em;margin:4px 0 var(--sp-4)}
    .lg-sec{margin-top:var(--sp-6);padding-top:var(--sp-6);border-top:2px solid var(--color-divider)}
    .lg-sec h2{font:800 var(--fs-lg)/var(--lh-lg) var(--font-heading);margin-bottom:var(--sp-4)}
    .lg-sec p,.lg-list li{color:var(--ink-2);overflow-wrap:anywhere;font-size:14px;line-height:1.55}
    .lg-sec p + p{margin-top:var(--sp-4)}
    .lg-list{margin:0;padding-left:1.2em}
    .lg-list li{margin:0 0 var(--sp-3)}
    .lg-tablewrap{margin-top:var(--sp-5)}
    .lg-card{border-top:2px solid var(--color-divider);border-bottom:2px solid var(--color-divider);padding:var(--sp-3) 0}
    .lg-kv{gap:var(--sp-5);padding:8px 0;font-size:13px;overflow-wrap:anywhere}
    .lg-kv + .lg-kv{border-top:1px solid var(--color-divider)}
    .lg-foot{margin-top:var(--sp-9)}
    .lg-foot a,.lg-sec a{color:var(--brand-text)}
  </style>`;
}
