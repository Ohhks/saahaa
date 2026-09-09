/* SAAHAA · ui/views/partner.js — the two partner consoles.

   1. Pro console  — leads, jobs, earnings, the public page, the ladder.
   2. Shop console — today, items (the catalog manager with the ready-list
      picker), orders, money.

   MODERNIST 8.0 — the engine below this line is untouched: every figure is
   the same computation the previous screen ran, every control keeps its
   data-act, every input its id and data-role. What changed is the surface:
   the dark ink strip that says "SAAHAA · PRO" / "SAAHAA · SHOP", a row of
   stat blocks under it, underline tabs, list rows, 2px rules, zero radius.

   The pro's money is never blended: the worker keeps 100% of the quote and
   SAAHAA's 8% is laid ON TOP and paid by the customer (pricing.quoteService).
   The shop pays 3% capped at ₹25 from its side (pricing.quoteRetail). Both
   numbers are read from the engine, never typed here.

   ONE REGISTERED ACTION DRIVES BOTH CONSOLES' TABS. app.js routes "shop.tab"
   to setShopTab(); a tab value prefixed "pro." belongs to the pro console.
   No new action, no app.js change. */

import { $, esc, sheet, updateSheet, sheetOpen, closeSheet, toast, ratingStars, timeAgo } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import * as ID from '../../domain/identity.js';
import { ctx, getState, dispatch, me, myPartner, myShop, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { stage } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { trustScore, tier, TIERS } from '../../domain/trust.js';
import { searchStarter, aislesOf } from '../../domain/starter-catalog.js';
import { header, emptyBlock } from './shops.js';
import { quoteRetail, liveMarkup, AGG_COMMISSION } from '../../domain/pricing.js';
import * as auction from '../../domain/auction.js';
import { progressCard } from './onboard.js';
import { readiness, blocker, backgroundRecord } from '../../domain/verification.js';
import * as W from '../../domain/wallet.js';
import * as autoverify from '../../domain/autoverify.js';
import { acct, balanceOf, HOLDBACK_PCT, HOLDBACK_CAP, HOLDBACK_DAYS } from '../../domain/ledger.js';
import * as gateway from '../../core/gateway.js';
/* pictures: core/photos.js keeps the bytes and the device budget, ui/photo.js
   asks for the file and shrinks it. This console only draws and offers taps —
   every write goes through the registered photo.product / photo.shop action. */
import * as photos from '../../core/photos.js';
import { url as photoSrc } from '../photo.js';

let pickerQuery = '', catalogQuery = '', shopTab = 'today', proTab = 'leads';
export const setPickerQuery = v => { pickerQuery = v; };
export const setCatalogQuery = v => { catalogQuery = v; };
export const setShopTab = v => {
  const s = String(v || '');
  if (s.startsWith('pro.')) proTab = s.slice(4); else shopTab = s;
};

/* ══════════════ the console vocabulary ══════════════
   Everything below is the mockup's own markup (.apphdr .row .thumb .tag
   .table .field) plus the few classes a media query needs. Colours are
   tokens only. */

const consoleCSS = `<style>
  .con__hdr{gap:12px}
  .con__hdr.on-plum{background:var(--color-text);color:var(--color-bg);border-bottom-color:var(--color-text)}
  .con__hdr .brandline{opacity:.72;display:block}
  .con__hdr .name{font:800 17px/1.1 var(--font-heading);display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .con__hdr .sub{font-size:11px;opacity:.75;display:block;margin-top:3px}
  /* the account's own name on the strip: a label and a code, quiet, never a badge */
  .con__id{display:flex;align-items:baseline;gap:6px;margin-top:4px}
  .con__id .meta{color:inherit;opacity:.68}
  .con__id b{font:800 12px/1 var(--font-heading);letter-spacing:.1em}
  .con__hdr .btn-outline{border:1px solid currentColor;color:inherit;min-height:44px;padding:6px 10px;font:800 10px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase}
  @media (min-width:768px){ .con__hdr{padding-left:var(--sp-8);padding-right:var(--sp-8)} }
  @media (min-width:1024px){ .con__hdr{padding-left:var(--sp-10);padding-right:var(--sp-10)} }
  /* .workspace zeroes .wrap's side padding, so a .bleed child pulled by the
     gutter escaped the viewport by 12px on each side and the console scrolled
     sideways at 375. Give the console back the gutter it is bleeding out of. */
  .con.workspace{padding-left:var(--gutter);padding-right:var(--gutter)}
  @media (max-width:767px){ .bleed{margin-left:calc(-1 * var(--gutter));margin-right:calc(-1 * var(--gutter))} }
  @media (min-width:768px){ .con.workspace{padding-left:var(--sp-8);padding-right:var(--sp-8)} }
  @media (min-width:1024px){ .con.workspace{padding-left:var(--sp-10);padding-right:var(--sp-10)} }
  .sw{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 4px;color:inherit;font:600 10px/1 var(--font-body);letter-spacing:.08em;text-transform:uppercase;flex:none}
  .sw__k{width:38px;height:20px;background:var(--color-neutral-500);position:relative;flex:none}
  .sw__k::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:var(--color-bg)}
  .sw[aria-pressed="true"] .sw__k{background:var(--color-accent)} .sw[aria-pressed="true"] .sw__k::after{left:auto;right:2px}
  .stat3{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:2px solid var(--color-divider)}
  .stat3.stat2{grid-template-columns:repeat(2,1fr)}
  .stat3 .capsule{border:0;border-right:1px solid var(--color-divider);background:transparent;padding:11px var(--gutter)}
  .stat3 .capsule:last-child{border-right:0}
  .utabs{display:flex;border-bottom:2px solid var(--color-divider);overflow-x:auto;scrollbar-width:none} .utabs::-webkit-scrollbar{display:none}
  .utabs button{flex:1 0 auto;min-height:44px;padding:0 12px;font:600 11px/1 var(--font-body);letter-spacing:.07em;text-transform:uppercase;color:var(--color-neutral-600);border-bottom:3px solid transparent;margin-bottom:-2px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
  .utabs button[aria-selected="true"]{color:var(--color-accent);border-bottom-color:var(--color-accent)}
  .utabs .n{font-size:10px;padding:2px 5px;background:var(--color-neutral-200);color:var(--color-neutral-800)}
  .subtabs{display:flex;gap:6px;padding:10px 0;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--color-divider)} .subtabs::-webkit-scrollbar{display:none}
  .subtabs button{padding:6px 10px;font:600 11px/1 var(--font-body);white-space:nowrap;border:1px solid var(--color-divider);min-height:44px}
  .subtabs button[aria-selected="true"]{background:var(--color-accent);color:var(--accent-on-fill);border-color:var(--color-accent)}
  .lrow{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--color-divider);align-items:flex-start;width:100%;text-align:left;color:inherit}
  .lrow--c{align-items:center} .lrow--col{flex-direction:column;gap:0}
  .lrow__t{font:800 14px/1.2 var(--font-heading)} .lrow__m{font-size:11.5px;color:var(--ink-3);margin-top:3px}
  .lrow__bar{width:4px;align-self:stretch;flex:none;background:var(--color-neutral-400)} .lrow__bar.hot{background:var(--color-accent)}
  .kick{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:16px 0 4px}
  .bars{display:flex;align-items:flex-end;gap:5px;height:74px;margin-top:14px} .bars i{flex:1;background:var(--color-neutral-400);min-height:2px} .bars i.on{background:var(--color-accent)}
  .barlbl{display:flex;font:600 9.5px/1 var(--font-body);color:var(--ink-3);margin-top:5px} .barlbl span{flex:1;text-align:center}
  .big{font:800 40px/1 var(--font-heading);letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:7px 0 5px;word-break:break-word}
  .payline{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;background:var(--accent-soft);color:var(--brand-text);border-bottom:2px solid var(--color-divider);margin-top:14px;flex-wrap:wrap}
  .con2{display:grid;gap:var(--sp-6)} @media (min-width:1024px){ .con2{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:var(--sp-9);align-items:start} }
  .feeline{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-divider);font-size:13px}
  .aggblock{padding:14px 12px;background:var(--color-accent);color:var(--accent-on-fill);margin:14px 0}
  .numin{width:82px;min-height:44px;padding:0 8px;font-size:15px;background:var(--surface-2);border:1px solid var(--color-divider);color:var(--ink-1);text-align:right;font-variant-numeric:tabular-nums}
  .numin:focus-visible{border-color:var(--color-accent);outline:none}
  .prodgrid{display:grid} @media (min-width:1024px){ .prodgrid--2{grid-template-columns:1fr 1fr;column-gap:var(--sp-9)} }
  .stdline{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--hairline)}
  .liveblock{border:2px solid var(--color-text);padding:14px;margin-top:16px}
  .pickbox{padding:14px 12px;border-top:2px solid var(--color-divider);border-bottom:2px solid var(--color-divider);background:var(--color-neutral-100);margin-top:16px}
  :root[data-theme="dark"] .pickbox{background:var(--surface-2)}
  .con .field{margin-bottom:0}
  /* PICTURES. .thumb is the design's grey placeholder block; .pthumb turns it
     into a 44px+ button that draws the stored picture when there is one and
     the drawn camera glyph when there is not — never a broken image. */
  .pthumb{position:relative;overflow:hidden;padding:0;flex:none;background:var(--color-neutral-300);border:1px solid var(--color-divider)}
  .pthumb img{width:100%;height:100%;object-fit:cover}
  .pthumb__ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--color-neutral-700)}
  .pthumb__ph b{font:800 12px/1 var(--font-heading)}
  .pthumb__edit{position:absolute;left:0;right:0;bottom:0;background:var(--color-accent);color:var(--accent-on-fill);font:700 8px/13px var(--font-body);letter-spacing:.06em;text-transform:uppercase;text-align:center}
  .addpic{display:inline-flex;align-items:center;gap:6px;min-height:44px;font:600 11px/1 var(--font-body);letter-spacing:.05em;text-transform:uppercase;color:var(--color-accent)}
  .budget{border-top:2px solid var(--color-divider);padding:12px 0 4px;margin-top:18px}
  .budget__bar{height:6px;background:var(--color-neutral-300);margin:8px 0 6px}
  .budget__bar i{display:block;height:100%;background:var(--color-accent)}
  .cform{display:grid;gap:10px}
  .cform .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .justadd{display:flex;gap:10px;align-items:center;border:2px solid var(--color-accent);padding:10px;margin-bottom:14px}
</style>`;

/** A stat block. k/v/d are trusted markup — callers escape their own values. */
const capsule = (k, v, d = '', tone = '') =>
  `<div class="capsule${tone ? ` capsule--${tone}` : ''}">
    <span class="capsule__k">${k}</span>
    <span class="capsule__v num">${v}</span>
    ${d ? `<span class="capsule__d">${d}</span>` : ''}
  </div>`;

/** A money state chip. Escrow, released and paid-to-bank never share a row. */
const money = (state, label) => `<span class="pill state--${state}">${esc(label)}</span>`;

/* The signed-in account's code — C/P/S + year + sequence. The session is a
   copy taken at sign-in, so the live row wins; an account without one (a very
   old store, before the backfill) simply shows nothing. */
function codeOfMe() {
  const s = me();
  if (!s) return '';
  const row = (getState().users || []).find(u => u.key === s.key) || s;
  return ID.isCode(row.code) ? ID.normaliseCode(row.code) : '';
}

const kick = (title, right = '') => `<div class="kick"><span class="eyebrow">${esc(title)}</span>${right}</div>`;

const sectionHead = (eyebrow, title, right = '') =>
  `<div class="hd"><div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
    <h2 class="h-sec">${esc(title)}</h2></div>${right}</div>`;

const empty = (title, body) => `<div class="empty" style="margin-top:12px"><b style="display:block;color:var(--ink-1)">${esc(title)}</b><span class="tiny">${esc(body)}</span></div>`;

const ymOf = ts => { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); };
const monthName = (d, long = false) => d.toLocaleString('en-IN', { month: long ? 'long' : 'short' }).toUpperCase();
const isToday = ts => { const a = new Date(ts), b = new Date(); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };

/* ══════════════ PRO CONSOLE ══════════════ */
const ACTIVE = ['MATCHING','ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS','WORK_DONE'];
const PRO_TABS = [['leads', 'Leads'], ['jobs', 'Jobs'], ['earnings', 'Earnings'], ['page', 'My page']];

/* Jobs out for rates. He sees the public band, the COUNT of workers asked,
   and nothing else — no rival's price, no name, not even whether anyone has
   replied. That is what "sealed" means, and it is the only reason a worker
   can quote against the fair price instead of against a rival. */
function leadRow(r, p) {
  const c = get('category', r.catId);
  const left = Math.max(0, Math.round((r.closesAt - Date.now()) / 60000));
  return `<div class="lrow lrow--col">
    <div class="between" style="align-items:flex-start;width:100%">
      <div class="grow" style="min-width:0">
        <div class="lrow__t">${esc(r.sub || c.name)}</div>
        <div class="lrow__m">${esc(r.area)} · ${r.bidCount} pros asked · fair price ${M.fmt(r.target)}</div>
      </div>
      <span class="tag ${left <= 15 ? 'tag-accent' : 'tag-neutral'}" style="flex:none">${left} min</span>
    </div>
    <div class="row" style="gap:8px;margin-top:10px;width:100%">
      <button class="btn btn-primary grow" style="justify-content:flex-start" data-act="bid.open" data-id="${r.id}" data-pid="${p.id}">Quote — send my rate</button>
    </div>
  </div>`;
}

/* The post-auction coaching loop. A pro who loses is told WHY — "your price
   was not the problem" is the line that stops undercutting. */
function myRates(p) {
  const mine = getState().bids.filter(b => b.partnerId === p.id).slice(-6).reverse();
  if (!mine.length) return '';
  const label = { submitted: ['Waiting', 'tag-neutral'], accepted: ['Won', 'tag-accent'], rejected: ['Lost', 'tag-outline'],
                  countered: ['Counter asked', 'tag-accent-2'], shortlisted: ['Shortlisted', 'tag-neutral'] };
  return `${kick('Your sealed rates')}
    ${mine.map(b => { const r = getState().requests.find(x => x.id === b.requestId) || {};
      const c = r.catId ? get('category', r.catId) : { name: 'Job' };
      const [txt, cls] = label[b.status] || [b.status, 'tag-neutral'];
      return `<button class="lrow lrow--c" data-act="bid.result" data-id="${b.id}" ${b.status === 'rejected' ? '' : 'disabled'}>
        <div class="grow" style="min-width:0"><div class="lrow__t">${esc(c.name)} · ${esc(r.area || '')}</div>
          <div class="lrow__m">You sent ${M.fmt(b.amount)} · ${timeAgo(b.submittedAt)}${b.status === 'rejected' ? ' · tap to see why' : ''}</div></div>
        <span class="tag ${cls}">${esc(txt)}</span></button>`; }).join('')}`;
}

/* THE FIRST-JOB BLOCK (8.2). A verified pro with no leads used to get one grey
   box saying "stay online" and six hundred pixels of nothing — the app's
   answer to "how do I get work?" was "wait". That is the exact moment the
   plumber in docs/PROBLEM.md gives up on it, and it is also the moment the
   product's real promise applies: he now HAS a page, and the whole growth loop
   is him sending it to the forty households already in his head. So the empty
   list offers the three things that actually produce a first booking, in the
   order they pay off, using controls that already exist. It disappears the
   moment there is a lead to look at instead. */
function firstJobBlock(p) {
  const shots = (p.work || []).length;
  /* Only the PUBLIC portrait counts. The verification selfie is private and a
     page carrying one still shows a letter to every customer. */
  const hasFace = !!photoSrc(p.photo);
  const canPublish = !hasFace && !!photoSrc(p.selfie);
  const row = (done, title, body, btn) => `<div class="lrow" style="align-items:flex-start">
      <span class="lrow__bar ${done ? '' : 'hot'}"></span>
      <div class="grow" style="min-width:0">
        <div class="lrow__t">${esc(title)}</div>
        <div class="lrow__m">${esc(body)}</div>
        <div style="margin-top:8px">${btn}</div>
      </div>
      <span class="tag ${done ? 'tag-neutral' : 'tag-accent'}" style="flex:none">${done ? 'done' : 'do this'}</span>
    </div>`;
  return `${kick('How the first job arrives')}
    <p class="micro muted" style="padding:2px 0 6px">Nobody has searched for you yet. The forty people who already know your work are the fastest way to change that — your page is built, and it is yours to send.</p>
    ${row(false, 'Send your page to people who know you',
      'One link on WhatsApp. They book, they pay through SAAHAA, and the job counts on your record.',
      `<button class="btn btn-primary" style="justify-content:flex-start" data-act="pro.share" data-id="${esc(p.id)}">Copy my link / share</button>`)}
    ${row(hasFace, 'Put your face on the page',
      hasFace ? 'Your page has a photo. A stranger can see who is coming.'
        : canPublish ? 'Your page still shows a letter. The photo you took to verify yourself is private — one tap makes that same photo public on your page.'
        : 'A page with a letter instead of a face is the one people scroll past.',
      canPublish
        ? `<button class="btn btn-primary" style="justify-content:flex-start" data-act="photo.publish" data-id="${esc(p.id)}">Show my verification photo publicly</button>`
        : `<button class="btn btn-secondary" style="justify-content:flex-start" data-act="pro.open" data-id="${esc(p.id)}">Open my page</button>`)}
    ${row(shots > 0, 'Photograph one finished job',
      shots > 0 ? `${shots} photo${shots === 1 ? '' : 's'} of your work are on your page.` : 'Pictures of work you have already done are what win the next one — an old job counts.',
      `<button class="btn btn-secondary" style="justify-content:flex-start" data-act="photo.work" data-id="${esc(p.id)}">Add a work photo</button>`)}`;
}

function proLeads(p, open, gate) {
  const r = readiness(p);
  return `${progressCard(p)}
    ${gate && r.complete ? `<div class="card" style="border-color:var(--warn);margin-top:12px"><b class="tiny">${esc(gate)}</b></div>` : ''}
    ${kick('Open requests near you', open.length ? `<span class="tag tag-accent">${open.length} near you</span>` : '')}
    ${open.length ? open.map(x => leadRow(x, p)).join('')
      + '<p class="micro muted" style="padding:10px 0">Sending less than the fair price lowers your chance. It does not raise it.</p>'
      : empty('No open requests right now', r.canWork && p.online !== false
          ? `You are online. Requests near ${p.area} land here the moment they are posted — nothing to watch for.`
          : p.online === false ? 'You are offline, so nothing will reach this phone. Turn the switch at the top back on.'
          : 'Go online once you are verified, and requests near you land here.')}
    ${!open.length && r.canWork ? firstJobBlock(p) : ''}
    ${myRates(p)}`;
}

function jobRow(o) {
  const st = stage(o.stage);
  return `<button class="lrow lrow--c" data-act="order.open" data-id="${o.id}">
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(o.customerName)}</div>
      <div class="lrow__m">${esc(o.sub || (get('category', o.catId) || {}).name || 'Job')} · ${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</div>
    </div>
    <div style="text-align:right;flex:none">
      <span class="tag ${['ARRIVED','IN_PROGRESS','WORK_DONE'].includes(o.stage) ? 'tag-accent' : 'tag-neutral'}">${esc(st.short)}</span>
      <b class="num" style="display:block;margin-top:6px">${M.fmt(o.deal)}</b>
    </div>
  </button>`;
}

function proJobs(inbox) {
  return `${kick('Your jobs', `<span class="tag ${inbox.length ? 'tag-accent' : 'tag-neutral'}">${inbox.length} active</span>`)}
    ${inbox.length ? inbox.map(jobRow).join('')
      + '<p class="micro muted" style="padding:10px 0">Chat with the customer, the arrival code and the finished-work photo all live inside the job.</p>'
      : empty('No live jobs', 'Stay online — accepted requests land here.')}`;
}

/* The worker's wallet: four states, never blended. AVAILABLE is theirs to
   take; LOCKED is committed to a job in progress and returns in full when it
   is finished; PENDING is the 7-day holdback; RELEASED is everything ever
   paid. The stake is what makes a check-in a commitment. */
function walletCard(p) {
  const w = W.walletOf(getState().ledger, p.id, p);
  const live = getState().orders.filter(o => o.partnerId === p.id && o.stake && !o.stake.returned && !o.stake.forfeited);
  return `${kick('Wallet', `<span class="tag tag-neutral">min stake ${M.fmt(W.MIN_STAKE)}</span>`)}
    <div class="capsules" style="grid-template-columns:repeat(2,1fr)">
      <div class="capsule capsule--ok"><span class="capsule__k">Available</span><span class="capsule__v num">${M.fmt(w.available)}</span><span class="state state--available">yours to withdraw</span></div>
      <div class="capsule capsule--info"><span class="capsule__k">Locked</span><span class="capsule__v num">${M.fmt(w.locked)}</span><span class="state state--held">${live.length ? `${live.length} job${live.length > 1 ? 's' : ''} in progress` : 'returns when done'}</span></div>
      <div class="capsule capsule--warn"><span class="capsule__k">Pending</span><span class="capsule__v num">${M.fmt(w.pending)}</span><span class="state state--pending">7-day holdback</span></div>
      <div class="capsule capsule--gold"><span class="capsule__k">Released</span><span class="capsule__v num">${M.fmt(w.released)}</span><span class="state state--released">lifetime</span></div>
    </div>
    ${w.debt ? `<p class="tiny" style="margin-top:8px;color:var(--warn)">${M.fmt(w.debt)} owed from a job you left — recovered from your next payout.</p>` : ''}
    <p class="micro muted" style="margin-top:8px">${esc(gateway.label())}</p>
    <p class="micro muted" style="margin-top:6px">When a job starts, ${M.fmt(W.MIN_STAKE)} (or ${W.STAKE_PCT}% of the job, up to ${M.fmt(W.MAX_STAKE)}) locks from Available. Finish the job and every rupee of it comes back with your full payout. Walk out and it goes to the customer.</p>
    <p class="micro muted" style="margin-top:6px">If Available is empty, the stake is taken from the job's own payout instead — you are never asked for money you do not have, and you never pay to start.</p>
    <p class="micro muted" style="margin-top:6px"><b>Pending</b> is your ${HOLDBACK_PCT}% holdback: ${HOLDBACK_PCT} paise in every rupee paid to you waits ${HOLDBACK_DAYS} days and then moves to Available by itself. It never grows past ${M.fmt(HOLDBACK_CAP)} in total, it is not a fee, and nobody has to approve it.</p>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn-secondary grow" data-act="wallet.topup" data-id="${p.id}">Add money</button>
      <button class="btn btn-ghost grow" data-act="wallet.withdraw" data-id="${p.id}" data-amt="${w.available}" ${w.available < 100000 ? 'disabled' : ''}>Withdraw${w.available >= 100000 ? ' ' + M.fmt(w.available) : ''}</button>
    </div>`;
}

/* seven months of what was KEPT, drawn with divs off the settled orders */
function monthBars(paid) {
  const now = new Date();
  const months = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ ym: d.getFullYear() * 12 + d.getMonth(), label: monthName(d), kept: 0 });
  }
  paid.forEach(o => { const m = months.find(x => x.ym === ymOf(o.settledAt)); if (m) m.kept += o.workerPayout || 0; });
  const max = Math.max(1, ...months.map(m => m.kept));
  const cur = months[months.length - 1].ym;
  return `<div class="bars" aria-hidden="true">${months.map(m =>
      `<i class="${m.ym === cur ? 'on' : ''}" style="height:${Math.max(2, Math.round(m.kept / max * 100))}%" title="${m.label} ${M.fmt(m.kept)}"></i>`).join('')}</div>
    <div class="barlbl">${months.map(m => `<span>${m.label}</span>`).join('')}</div>`;
}

function proEarnings(p, orders, paid, earned, held, paidOut) {
  const now = new Date();
  const thisMonth = paid.filter(o => ymOf(o.settledAt) === now.getFullYear() * 12 + now.getMonth());
  const kept = thisMonth.reduce((n, o) => n + (o.workerPayout || 0), 0);
  const quoted = thisMonth.reduce((n, o) => n + (o.deal || 0), 0);
  const w = W.walletOf(getState().ledger, p.id, p);
  const recent = paid.slice().sort((a, b) => b.settledAt - a.settledAt).slice(0, 8);
  const pct = Math.round(liveMarkup() * 100);
  return `
    <div style="padding:14px 0;border-bottom:2px solid var(--color-divider)">
      <span class="eyebrow">${monthName(now, true)} · you kept</span>
      <div class="big">${M.fmt(kept)}</div>
      <p class="tiny muted">from ${M.fmt(quoted)} quoted · you keep 100%. SAAHAA's ${pct}% is paid on top by the customer.</p>
      ${paid.length ? monthBars(paid) : '<p class="micro muted" style="margin-top:10px">Your first settled job draws the first bar here.</p>'}
    </div>

    <div class="payline">
      <div class="grow" style="min-width:0">
        <b style="font:800 15px var(--font-heading);display:block">${M.fmt(w.available)} payable now</b>
        <span class="micro" style="opacity:.85">${p.verification && p.verification.upi ? esc(p.verification.upi) : 'your UPI'} · ${esc(gateway.label())}</span>
      </div>
      <button class="btn btn-secondary" style="border-color:currentColor;color:inherit" data-act="wallet.withdraw" data-id="${p.id}" data-amt="${w.available}" ${w.available < 100000 ? 'disabled' : ''}>Withdraw</button>
    </div>
    ${w.available < 100000 ? '<p class="micro muted" style="margin-top:6px">Withdrawals start at ₹1,000.</p>' : ''}

    <div class="con2">
      <div>
        ${kick('Recent jobs')}
        ${recent.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>Job</th><th class="num">Quoted</th><th class="num">Kept</th></tr></thead><tbody>
          ${recent.map(o => `<tr><td>${esc(o.sub || (get('category', o.catId) || {}).name || 'Job')} · ${esc(o.customerName)}<span class="micro muted" style="display:block">${timeAgo(o.settledAt)}</span></td>
            <td class="num">${M.fmt(o.deal)}</td><td class="num">${M.fmt(o.workerPayout)}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="micro muted" style="margin-top:8px">Kept equals quoted on every line: nothing comes out of your price.</p>`
          : empty('No settled jobs yet', 'Every job you finish and the customer confirms lands here.')}

        ${kick('Where the money is')}
        <div class="capsules">
          ${capsule('Paid out', M.fmt(earned), money('released', 'Released to you'), 'ok')}
          ${capsule('In escrow', M.fmt(held), money('held', 'Held until confirmed'), 'info')}
          ${capsule('Sent to UPI', M.fmt(paidOut), money('available', 'Landed in your account'), 'soft')}
        </div>
        <p class="micro muted" style="margin-top:8px">Escrow, released and sent are three different things. A job only moves left to right — it never counts twice.</p>
      </div>
      <div>${walletCard(p)}</div>
    </div>`;
}

/* ══════════════ STANDING — approvals that happen by themselves ══════════
   Tier 3 (Background Checked) and tier 4 (Certified) are earned mechanically:
   jobs + rating + vouches + a reference who confirms by code. Every line is
   have/need with a check or a cross, and nobody has to approve anything.
   Nothing here is texted to anybody, in sandbox or in production. The code the
   reference quotes is the pro's own permanent SAAHAA code — the pro passes it
   on themselves, which is why this product needs no SMS rail at all. */

let shownRefCode = '';
/** Called by app.js after autoverify.sendReferenceCode — shows the code. */
export function showReferenceCode(code) {
  shownRefCode = code ? String(code) : '';
  if (!code) { toast('Name a reference first', 'warn'); return; }
  toast(`Give ${code} to your reference — it is your own SAAHAA code`);
}

const okIcon  = ok => `<span aria-hidden="true" style="display:inline-flex;color:${ok ? 'var(--success)' : 'var(--danger)'}">${icon(ok ? 'check' : 'cross', { size: 14 })}</span>`;

const standingLine = (l, right = '') => `<div class="stdline">
    <span class="row" style="gap:8px;min-width:0">${okIcon(l.ok)}<span class="tiny ${l.ok ? '' : 'muted'}">${esc(l.label)}</span></span>
    <span class="micro num" style="flex:0 0 auto;color:${l.ok ? 'var(--success)' : 'var(--ink-2)'}">${right || `${l.have} / ${l.need}`}</span>
  </div>`;

/* The reference line has three states: not named → the form; named → show the
   pro their own code to pass on; passed on → type back what the reference read
   out. Confirmed is just a green line.

   NOTHING IS TEXTED. The code the reference quotes is the pro's own permanent
   SAAHAA code — see domain/autoverify.js. */
function referenceBlock(p, line) {
  const bg = backgroundRecord(p) || {};
  if (bg.refConfirmed) return standingLine(line, `confirmed${bg.refName ? ` · ${esc(bg.refName)}` : ''}`);
  if (!bg.refName) return `${standingLine(line, 'not yet')}
    <div style="margin-top:12px">
      <p class="micro muted" style="margin-bottom:10px">Someone who has seen your work — a past customer or an employer. You give them your SAAHAA code; when we ring them they read it back, and you type it in here.</p>
      <div class="field"><input id="obRefName" placeholder=" "><label>A reference (past customer or employer)</label></div>
      <div class="field" style="margin-top:10px"><input id="obRefPhone" placeholder=" " inputmode="numeric" maxlength="10"><label>Their 10-digit number</label></div>
      <label class="tiny" style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
        <input type="checkbox" id="obConsent" style="margin-top:3px"> I consent to SAAHAA verifying my background, including police verification where required for in-home work.</label>
      <button class="btn btn-secondary btn-block" data-act="ob.bg">Save my reference</button>
    </div>`;
  if (!bg.refCode) return `${standingLine(line, `${esc(bg.refName)} · not passed on yet`)}
    <button class="btn btn-secondary btn-block" style="margin-top:10px" data-act="ref.send">Show me the code to give ${esc(bg.refName)}</button>`;
  return `${standingLine(line, `${esc(bg.refName)} · waiting on them`)}
    <div style="margin-top:12px">
      <p class="tiny" style="margin-bottom:8px">Give ${esc(bg.refName)} this code: <b class="num" style="font-size:20px;letter-spacing:.12em">${esc(shownRefCode || bg.refCode)}</b>
        <span class="micro muted" style="display:block">It is your own SAAHAA code — nothing is texted to anybody. When we ring them, they read it back; type what they said below.</span></p>
      <div class="row" style="flex-wrap:wrap;gap:8px;align-items:stretch">
        <div class="field grow" style="min-width:160px"><input id="refCode" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12" placeholder=" " style="letter-spacing:.1em;text-transform:uppercase"><label>What your reference read back</label></div>
        <button class="btn btn-primary" style="align-self:flex-end" data-act="ref.confirm">Confirm</button>
      </div>
    </div>`;
}

function vouchList(p) {
  const vs = (p.vouches || []).slice().sort((a, b) => b.at - a.at);
  if (!vs.length) return '<p class="micro muted" style="margin-top:8px">No vouches yet. A customer whose job with you settled, or a Background-Checked pro in your trade, can vouch from your public page.</p>';
  return `<div style="margin-top:4px">
    ${vs.slice(0, 8).map(v => `<div class="lrow lrow--c" style="padding:8px 0">
      <span class="avatar avatar--sm">${esc((v.byName || '?')[0])}</span>
      <span class="grow tiny" style="min-width:0">${esc(v.byName || 'Someone')}
        <span class="micro muted">· ${v.role === 'pro' ? 'same-trade pro' : 'customer'} · ${timeAgo(v.at)}</span></span>
    </div>`).join('')}
  </div>`;
}

function standingBlock(p) {
  const t = p.tier | 0;
  if (t !== 2 && t !== 3) return '';
  const pr = t === 2 ? autoverify.progress(p) : autoverify.certifiedProgress(p);
  const lines = pr.lines;
  const green = Object.values(lines).filter(l => l.ok).length, total = Object.keys(lines).length;
  const next = t === 2 ? 'Background Checked' : 'SAAHAA Certified';
  const bg = backgroundRecord(p) || {};
  if (bg.refConfirmed && shownRefCode) shownRefCode = '';
  return `${kick(`Standing · next: ${next}`, `<span class="tag ${green === total ? 'tag-accent' : 'tag-neutral'}">${green} / ${total} green</span>`)}
    <div>
      ${t === 2 ? `
        ${standingLine(lines.ladder)}
        ${standingLine(lines.jobs)}
        ${standingLine(lines.rating, `${lines.rating.have.toFixed(1)} / ${lines.rating.need}${lines.jobs.ok ? '' : ` after ${lines.jobs.need} jobs`}`)}
        ${standingLine(lines.disputes)}
        ${standingLine(lines.vouches)}
        ${referenceBlock(p, lines.reference)}`
      : `
        ${standingLine(lines.jobs)}
        ${standingLine(lines.rating, `${lines.rating.have.toFixed(1)} / ${lines.rating.need}`)}
        ${standingLine(lines.disputes)}
        ${standingLine(lines.tenure, `${lines.tenure.have} / ${lines.tenure.need} days`)}
        ${standingLine(lines.open)}`}
      <p class="micro muted" style="margin-top:10px">${t === 2
        ? 'Background Checked is granted automatically when every line is green — no one has to approve you.'
        : 'SAAHAA Certified is granted automatically when every line is green — no one has to approve you.'}
        ${pr.automation === false ? ' Automatic promotion is paused by SAAHAA right now.' : ''}
        ${pr.suspended ? ' Your account is paused, so nothing moves until that is lifted.' : ''}</p>
    </div>
    ${kick('Vouches', `<span class="tag tag-neutral">${(p.vouches || []).length}</span>`)}
    ${vouchList(p)}`;
}

function proPage(p, t, a, cat) {
  const nextTier = TIERS[Math.min(4, (p.tier | 0) + 1)];
  const r = readiness(p);
  return `<div class="con2">
    <div>
      ${kick('Rating and trust', `<span class="tag tag-accent">${esc(t.band.label)}</span>`)}
      <div class="capsules" style="grid-template-columns:repeat(2,1fr)">
        ${capsule('Rating', avgLabel(a), a == null ? '<span class="meta">no ratings yet</span>' : ratingStars(a), 'gold')}
        ${capsule('Jobs done', String(p.completed), '', 'soft')}
        ${capsule('Trust', `${t.score}<span class="meta">/100</span>`, esc(t.band.label), 'info')}
        ${capsule('Your rate', M.fmt(p.ask), 'you keep 100%', 'ok')}
      </div>
      <p class="micro muted" style="margin-top:8px">You keep <b>100%</b> of your rate. A ${Math.round(AGG_COMMISSION * 100)}%-commission app would pay you about ${M.fmt(Math.round(p.ask * (1 - AGG_COMMISSION)))} for the same job.</p>

      ${kick('Your public page')}
      <button class="lrow lrow--c" data-act="pro.open" data-id="${p.id}">
        <span class="avatar">${esc(p.name[0])}</span>
        <div class="grow" style="min-width:0">
          <div class="lrow__t">${esc(p.name)}</div>
          <div class="lrow__m">${esc(cat.name)} · ${esc(p.area)} · ratings, badges and reviews kept current by SAAHAA</div>
        </div>
        <span class="more">Open</span>
      </button>

      ${kick('Verification ladder')}
      <div class="lrow lrow--col">
        <b>${esc(tier(p.tier).label)}</b>
        <p class="tiny muted" style="margin-top:4px">${esc(tier(p.tier).unlocks)}</p>
        ${(p.tier | 0) < 4 ? `<div class="hr" style="margin:12px 0;width:100%"></div>
          <b class="tiny">Next: ${esc(nextTier.label)}</b>
          <p class="tiny muted" style="margin-top:4px">${esc(nextTier.unlocks)}</p>
          <button class="btn btn-secondary btn-block" style="margin-top:12px" data-act="partner.upgrade">${r.complete ? 'Go further' : 'Continue verification'}</button>` : ''}
      </div>
    </div>
    <div>${standingBlock(p)}</div>
  </div>`;
}

export function renderPartner() {
  const p = myPartner();
  if (!p) return `${header('Partner', '')}<main class="wrap">
    ${emptyBlock('Not a partner account', 'Sign in with a partner login.')}</main>`;
  const cat = get('category', p.cat);
  const t = trustScore(p);
  const orders = myOrders();
  const inbox = orders.filter(o => ACTIVE.includes(o.stage));
  // by SETTLEMENT, never by stage: a rated job moves on to CLOSED, and
  // filtering on SETTLED made a pro's lifetime earnings snap to Rs.0 the
  // moment a customer said thank you
  const paid = orders.filter(o => o.settledAt && (o.workerPayout || 0) > 0);
  const earned = paid.reduce((n, o) => n + (o.workerPayout || 0), 0);
  const paidOut = paid.filter(o => o.paidOut).reduce((n, o) => n + (o.workerPayout || 0), 0);
  const held = orders.filter(o => o.stage === 'WORK_DONE').reduce((n, o) => n + o.deal, 0);
  const a = avg(p);
  const open = auction.openRequestsForPartner(p);
  const bids = getState().bids.filter(b => b.partnerId === p.id);
  const won = bids.filter(b => b.status === 'accepted').length, lost = bids.filter(b => b.status === 'rejected').length;
  const winRate = won + lost ? Math.round(won / (won + lost) * 100) : null;
  const offline = p.online === false;
  const ready = readiness(p).canWork;
  const gate = blocker(p);
  const counts = { leads: open.length, jobs: inbox.length };
  /* The pro's own account code (P2026….). Read from the live user row, not
     the partner row: the code belongs to the account, not to the trade. */
  const proCode = codeOfMe();

  const body =
      proTab === 'jobs'     ? proJobs(inbox)
    : proTab === 'earnings' ? proEarnings(p, orders, paid, earned, held, paidOut)
    : proTab === 'page'     ? proPage(p, t, a, cat)
    :                         proLeads(p, open, gate);

  return `${consoleCSS}
  <header class="apphdr on-plum con__hdr">
    <div class="grow" style="min-width:0">
      <span class="brandline">SAAHAA · PRO</span>
      <b class="name">${esc(p.name)}</b>
      ${proCode ? `<span class="con__id"><span class="meta">Pro ID</span><b>${esc(proCode)}</b></span>` : ''}
      <span class="sub">${offline ? 'Not accepting jobs · requests will not reach this phone'
        : ready ? `Accepting jobs · ${auction.waveRadiusKm(0)}–${auction.waveRadiusKm(2)} km radius · ${esc(p.area)}`
        : `${esc(cat.name)} · verification pending`}</span>
    </div>
    ${ready ? `<button class="sw" type="button" data-act="partner.online" aria-pressed="${offline ? 'false' : 'true'}"
        aria-label="${offline ? 'Go online' : 'Go offline'}"><span>${offline ? 'Offline' : 'Online'}</span><span class="sw__k"></span></button>`
      : '<span class="tag tag-outline" style="flex:none">Verify to go online</span>'}
  </header>
  <main class="wrap workspace con" style="padding-top:0">
    <div class="stat3 bleed">
      ${capsule('New leads', String(open.length), '', '')}
      ${capsule("Today's jobs", String(inbox.length), '', '')}
      ${winRate == null ? capsule('Rating', avgLabel(a), a == null ? '<span class="meta">not rated yet</span>' : '', '') : capsule('Win rate', `<span class="em">${winRate}%</span>`, '', '')}
    </div>
    <div class="utabs bleed" role="tablist" aria-label="Pro console">
      ${PRO_TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${proTab === k ? 'true' : 'false'}"
        data-act="shop.tab" data-tab="pro.${k}">${esc(l)}${counts[k] ? `<span class="n">${counts[k]}</span>` : ''}</button>`).join('')}
    </div>
    ${body}
    <div style="height:40px"></div>
  </main>`;
}

/* NO INVENTED RATING (8.2). This returned 4.5 when a pro had no ratings at
   all, so a plumber who had never been booked opened his own console and read
   "Rating 4.5 ★★★★★". A number nobody gave him is a lie on the one screen he
   trusts, and the public page (views/pro.js) has always shown 0 for the same
   pro — the two disagreed. null means "nobody has rated you yet", and every
   caller says that in words. */
const avg = p => { const r = p.ratings || []; return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : null; };
const avgLabel = a => a == null ? '—' : a.toFixed(1);

/* ══════════════ SHOP CONSOLE ══════════════ */
/* Four tabs a shopkeeper thinks in — TODAY · ITEMS · ORDERS · MONEY — with
   the nine sections of the previous console grouped under them as sub-tabs.
   Same state, same writes, same tab keys. Customers, Payouts and Analytics
   are derived from orders that already exist; no new store, no new field. */

const SHOP_TABS = [
  ['today',     'Today'],
  ['orders',    'Orders'],
  ['catalog',   'Products'],
  ['stock',     'Inventory'],
  ['pricing',   'Pricing'],
  ['money',     'Sales'],
  ['customers', 'Customers'],
  ['payouts',   'Payouts'],
  ['analytics', 'Analytics'],
  ['setup',     'Shop profile'],
];
const SHOP_GROUPS = [
  ['today',  'Today',  ['today', 'analytics', 'setup']],
  ['items',  'Items',  ['catalog', 'stock', 'pricing']],
  ['orders', 'Orders', ['orders', 'customers']],
  ['money',  'Money',  ['money', 'payouts']],
];
const labelOf = k => (SHOP_TABS.find(t => t[0] === k) || [k, k])[1];
const LIVE_RETAIL = o => !o.settledAt && !['R_CLOSED', 'R_CANCELLED'].includes(o.stage);

export function renderShopAdmin() {
  const s = myShop();
  if (!s) return `${header('Shop', '')}<main class="wrap">
    ${emptyBlock('Not a shop account', 'Sign in with a shop login.')}</main>`;
  const cat = get('category', s.catId);
  const items = getState().products.filter(p => p.shopId === s.id);
  const orders = myOrders();
  const live = orders.filter(LIVE_RETAIL);
  const liveItems = items.filter(p => p.active !== false && (!p.trackStock || p.stockQty > 0)).length;
  const group = SHOP_GROUPS.find(g => g[2].includes(shopTab)) || SHOP_GROUPS[0];
  if (!group[2].includes(shopTab)) shopTab = 'today';
  syncAddSheet(s);

  const body =
      shopTab === 'orders'    ? shopOrders(orders)
    : shopTab === 'catalog'   ? shopCatalog(s, items)
    : shopTab === 'stock'     ? shopStock(s, items)
    : shopTab === 'pricing'   ? shopPricing(s, items)
    : shopTab === 'money'     ? shopMoney(s, orders)
    : shopTab === 'customers' ? shopCustomers(orders)
    : shopTab === 'payouts'   ? shopPayouts(s, orders)
    : shopTab === 'analytics' ? shopAnalytics(s, orders, items)
    : shopTab === 'setup'     ? shopSetup(s)
    :                           shopToday(s, orders, items, cat);

  const modeWord = s.deliveryMode === 'pickup_only' ? 'pickup only' : 'delivering';
  /* the shop OWNER's account code (S2026….) — the person, not the storefront */
  const shopCode = codeOfMe();
  return `${consoleCSS}
  <header class="apphdr on-plum con__hdr">
    <div class="grow" style="min-width:0">
      <span class="brandline">SAAHAA · SHOP</span>
      <b class="name">${esc(s.name)}</b>
      ${shopCode ? `<span class="con__id"><span class="meta">Shop ID</span><b>${esc(shopCode)}</b></span>` : ''}
      <span class="sub">${s.isOpen ? `Open · ${modeWord} · ${liveItems} item${liveItems === 1 ? '' : 's'} live` : `Closed · customers cannot order · ${items.length} items listed`}</span>
    </div>
    <button class="btn-outline tap" type="button" data-act="shop.toggle">${s.isOpen ? 'Close' : 'Open'}</button>
  </header>
  <main class="wrap workspace con" style="padding-top:0">
    <div class="utabs bleed" role="tablist" aria-label="Shop console">
      ${SHOP_GROUPS.map(([k, l, keys]) => `<button type="button" role="tab" aria-selected="${group[0] === k ? 'true' : 'false'}"
        data-act="shop.tab" data-tab="${keys[0]}">${esc(l)}${k === 'orders' && live.length ? `<span class="n">${live.length}</span>` : ''}</button>`).join('')}
    </div>
    <div class="subtabs" role="tablist" aria-label="${esc(group[1])} sections">
      ${group[2].map(k => `<button type="button" role="tab" aria-selected="${shopTab === k ? 'true' : 'false'}"
        data-act="shop.tab" data-tab="${k}">${esc(labelOf(k))}</button>`).join('')}
    </div>
    ${body}
    <div style="height:60px"></div>
  </main>`;
}

/* ── TODAY: what wants the shopkeeper right now ── */
function shopToday(s, orders, items, cat) {
  const today = orders.filter(o => isToday(o.createdAt) && o.stage !== 'R_CANCELLED');
  const sales = today.reduce((n, o) => n + (o.itemsTotal || 0), 0);
  const fees = today.reduce((n, o) => n + (o.platformFee || 0), 0);
  const needing = orders.filter(LIVE_RETAIL);
  const out = items.filter(p => p.trackStock && p.stockQty <= 0);
  const low = items.filter(p => p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt);
  const fresh = !items.length && !orders.length;
  return `
    <div class="stat3 stat2 bleed">
      ${capsule('Sales today', M.fmt(sales), `${today.length} order${today.length === 1 ? '' : 's'}`)}
      ${capsule(`Fees today (${cat.takePct}%)`, M.fmt(fees), `capped ${M.fmt(cat.takeCapPaise)} an order`)}
    </div>

    ${fresh ? liveBlock(s) : ''}

    <div class="con2">
      <div>
        ${kick('Orders needing you', needing.length ? `<span class="tag tag-accent">${needing.length} open</span>` : '')}
        ${needing.length ? needing.map(orderRow).join('')
          : empty('Nothing waiting', s.isOpen ? 'New orders appear here with a 60-second accept timer.' : 'Open the shop to start receiving orders.')}
      </div>
      <div>
        ${kick('Wants attention', out.length || low.length ? `<span class="tag tag-neutral">${out.length + low.length}</span>` : '')}
        ${out.length || low.length ? out.map(p => attentionRow(p, true)).concat(low.map(p => attentionRow(p, false))).join('')
          : empty('Stock looks fine', items.length ? 'Nothing is low or out.' : 'Add your first items from the ready list.')}
        ${!fresh ? `<div class="pickbox">
          <span class="eyebrow" style="display:block;margin-bottom:8px">Add without typing</span>
          <button class="btn btn-secondary btn-block" style="justify-content:flex-start" data-act="cat.picker">${icon('plus', { size: 16 })} Pick from the ready list</button>
          <p class="micro muted" style="margin-top:8px">Tap an item, change the price, set stock. About six seconds each.</p>
        </div>` : ''}
      </div>
    </div>`;
}

/* the moment a fresh shop opens its console: it is already live */
function liveBlock(s) {
  const link = `${location.host}${location.pathname}#/shop/${s.id}`;
  return `<div class="liveblock">
    <div style="width:44px;height:44px;background:var(--color-accent);color:var(--accent-on-fill);display:grid;place-items:center">${icon('check', { size: 24 })}</div>
    <div style="font:800 24px/1.1 var(--font-heading);margin-top:12px">${esc(s.name)}<br>is live in ${esc(s.area)}</div>
    <p class="tiny muted" style="margin-top:8px">Customers nearby can find you now. Add your stock and the first order can land today.</p>
    <span class="eyebrow" style="display:block;margin:14px 0 6px">Your public storefront</span>
    <div style="font:600 12.5px var(--font-body);word-break:break-all">${esc(link)}</div>
    <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-secondary grow" style="justify-content:flex-start" data-act="shop.open" data-id="${s.id}">Open storefront</button>
      <button class="btn btn-primary grow" style="justify-content:flex-start" data-act="cat.picker">Add your stock</button>
    </div>
    <div class="between" style="font-size:12px;padding-top:12px;margin-top:12px;border-top:1px solid var(--color-divider)"><span class="muted">You paid to get here</span><b>₹0</b></div>
  </div>`;
}

/* WHAT SHE KEEPS, BEFORE SHE ACCEPTS (8.2). The row showed only what the
   CUSTOMER pays — basket plus delivery plus fee — so a kirana owner deciding
   in sixty seconds read a number that was never hers, and the fee first
   appeared days later on the Money screen. `shopPayout` and `platformFee` are
   written when the order is placed (domain/flow.js:512), so the honest number
   is available at exactly the moment the decision is made. */
function orderRow(o) {
  const st = stage(o.stage);
  const placed = o.stage === 'R_PLACED';
  const yours = o.shopPayout | 0;
  const fee = o.platformFee | 0;
  return `<div class="lrow lrow--c">
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(o.customerName)} · ${yours ? `${M.fmt(yours)} to you` : M.fmt(o.customerPays)}</div>
      <div class="lrow__m">${o.lines.length} item${o.lines.length === 1 ? '' : 's'} · ${o.mode === 'pickup' ? 'pickup' : 'delivery'} · ${esc(o.customerArea)}, ${o.km} km · ${placed ? timeAgo(o.createdAt) : esc(st.short)}</div>
      ${yours ? `<div class="lrow__m">Customer pays ${M.fmt(o.customerPays)} · SAAHAA fee ${M.fmt(fee)} already taken off</div>` : ''}
    </div>
    ${placed ? `<button class="btn btn-primary" style="flex:none" data-act="stage.accept" data-id="${o.id}">Accept</button>` : ''}
    <button class="btn ${placed ? 'btn-ghost' : 'btn-secondary'}" style="flex:none" data-act="order.open" data-id="${o.id}">${placed ? 'Open' : 'Track'}</button>
  </div>`;
}

function attentionRow(p, out) {
  return `<div class="lrow lrow--c">
    <span class="lrow__bar ${out ? 'hot' : ''}"></span>
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(p.name)} — ${out ? 'out of stock' : `${p.stockQty} left`}</div>
      <div class="lrow__m">${out ? 'Hidden from customers until restocked' : `${esc(p.aisle)} · low-stock line at ${p.lowStockAt}`}</div>
    </div>
    <button class="btn btn-ghost" style="flex:none" data-act="stock.refill" data-id="${p.id}">Restock</button>
  </div>`;
}

/* EVERYONE PAYS SAAHAA, SAAHAA PAYS EVERYONE. The shop's balance is the
   ledger account SHOP:<id> — settlements land in it, payouts leave it. Read
   off the book every render, never stored, so it cannot drift. */
const SHOP_LEG = { SETTLE_RETAIL: 'Order settled', ESCROW_RELEASE: 'Order settled', SHOP_PAYOUT: 'Order settled', WITHDRAW: 'Sent to your UPI',
                   TOPUP: 'Paid in', PAYOUT: 'Sent to your UPI', COMPENSATION: 'Compensation' };
function shopDelta(e, account) {
  if (Array.isArray(e.legs)) return e.legs.filter(l => l.account === account).reduce((n, l) => n + (l.delta | 0), 0);
  if (e.partyA === account) return -(e.amountPaise | 0);
  if (e.partyB === account) return e.amountPaise | 0;
  return 0;
}
const shopLegs = s => {
  const account = acct.shop(s.id);
  return getState().ledger.map(e => ({ e, d: shopDelta(e, account) })).filter(x => x.d !== 0).reverse();
};
function shopWalletLine(s) {
  const bal = balanceOf(getState().ledger, acct.shop(s.id));
  const legs = shopLegs(s).slice(0, 5);
  return `${kick('Shop wallet', money('available', 'yours after settlement'))}
    <div class="between" style="gap:8px;padding-bottom:8px;border-bottom:1px solid var(--color-divider)">
      <b class="num" style="font-size:24px">${M.fmt(Math.max(0, bal))}</b>
      <span class="micro muted" style="text-align:right">${esc(gateway.label())}</span>
    </div>
    ${legs.length ? legs.map(({ e, d }) => `<div class="feeline">
        <span class="muted" style="min-width:0">${esc(SHOP_LEG[e.kind] || e.kind)} · ${timeAgo(e.ts)}</span>
        <b class="num" style="flex:0 0 auto;color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt(Math.abs(d))}</b></div>`).join('')
      : '<p class="micro muted" style="margin-top:8px">Nothing has landed yet. Every settled order posts here.</p>'}`;
}

function shopOrders(orders) {
  const live = orders.filter(LIVE_RETAIL);
  if (!live.length) return empty('No orders right now', 'New orders appear here with a 60-second accept timer.');
  return `${kick('Live orders', `<span class="tag tag-accent">${live.length} open</span>`)}
    ${live.map(orderRow).join('')}`;
}

/* ── CATALOG MANAGER — inline-editable rows + the starter picker ── */
function catalogSearch(items) {
  return `<div class="search" style="margin:12px 0">
    <span aria-hidden="true">${icon('search', { size: 16 })}</span>
    <input id="catq" type="search" placeholder="Search your ${items.length} items"
           value="${esc(catalogQuery)}" data-role="catalogsearch">
  </div>`;
}

const shownItems = items => {
  const q = catalogQuery.trim().toLowerCase();
  return q ? items.filter(p => p.name.toLowerCase().includes(q) || p.aisle.toLowerCase().includes(q)) : items;
};

/** The picker is the whole point of the console — it gets a block at the top
    AND a floating button that follows the list. */
function pickerCall(items) {
  return `
  <div class="pickbox" style="margin-top:12px">
    <span class="eyebrow" style="display:block;margin-bottom:8px">Add without typing</span>
    <button class="btn btn-secondary btn-block" style="justify-content:flex-start" data-act="cat.picker">${icon('plus', { size: 16 })} Pick from the ready list</button>
    <p class="micro muted" style="margin-top:8px">Tap an item and it is on your storefront straight away, at the suggested price with 10 in stock — change either on the row below. Set stock to 0 and it hides itself until you have it again. Anything the ready list does not have, you add yourself — picture, name, price.</p>
  </div>
  <button class="fab" data-act="cat.picker" aria-label="Add items from the ready list">${icon('plus', { size: 22 })}
    <span class="fab__count">${items.length}</span></button>`;
}

function shopCatalog(s, items) {
  const shown = shownItems(items);
  const aisles = [...new Set(shown.map(p => p.aisle))];
  return `
  ${items.length ? `
    ${catalogSearch(items)}
    ${aisles.map(a => `${kick(a, `<span class="tag tag-neutral">${shown.filter(p => p.aisle === a).length}</span>`)}
      <div class="prodgrid prodgrid--2">${shown.filter(p => p.aisle === a).map(catalogRow).join('')}</div>`).join('')}
    <p class="micro muted" style="padding:10px 0">Tap any picture to take a new one — the old one is thrown away, so re-photographing costs this phone nothing.</p>
    ${photoBudget()}`
  : empty('No items listed yet', 'Add your first ten items — it takes about two minutes.')}
  ${pickerCall(items)}`;
}

/* Same rows, price first: the question here is "what am I charging", so the
   price sits at the head of the row and the MRP guard rail next to it. */
function shopPricing(s, items) {
  const shown = shownItems(items);
  if (!items.length) return `${empty('Nothing to price yet', 'Add items from the ready list first — prices come pre-filled.')}${pickerCall(items)}`;
  return `
  ${kick('What you charge', `<span class="tag tag-neutral">${items.length} items</span>`)}
  ${catalogSearch(items)}
  <div class="prodgrid prodgrid--2">${shown.map(p => priceRow(p)).join('')}</div>
  <p class="micro muted" style="padding:10px 0">A price above MRP is refused as you type it — that is what keeps the “MRP parity” badge on your shop.</p>
  ${pickerCall(items)}`;
}

const stockWord = p => !p.trackStock ? 'stock not tracked' : p.stockQty <= 0 ? 'out of stock' : p.stockQty <= p.lowStockAt ? `only ${p.stockQty} left` : `${p.stockQty} in stock`;

/* ══════════════ PICTURES ══════════════
   A listing stops being a spreadsheet row the moment it has a photograph.
   Everything hard about that already exists: ui/photo.js asks for the file and
   shrinks it, core/photos.js keeps it and refuses politely when the device is
   full, flow.setProductPhoto writes the id and frees the one it replaces. The
   console's whole job is to draw what is there and put the tap within reach.

   photoSrc() returns '' when there is no picture, so the placeholder branch is
   the honest one — an <img> is never built from anything else. */

/** A product's picture as a tappable block. Tapping it again replaces it. */
function prodThumb(p, size = 52) {
  const src = photoSrc(p.photo);
  return `<button type="button" class="thumb pthumb tap" style="width:${size}px;height:${size}px"
      data-act="photo.product" data-id="${p.id}"
      aria-label="${src ? 'Replace the picture of' : 'Add a picture of'} ${esc(p.name)}">
      ${src ? `<img src="${src}" alt=""><span class="pthumb__edit">Change</span>`
            : `<span class="pthumb__ph">${icon('camera', { size: 16 })}<b>${esc(p.name[0])}</b></span>`}
    </button>`;
}

/** Taking a picture back off. Only offered when there is one to remove; the
    engine frees the bytes, so the device gets the room back. */
const dropPhotoLink = (id, kind = 'product', name = '') =>
  `<button type="button" class="addpic tap" data-act="photo.drop" data-kind="${kind}" data-id="${id}"
     aria-label="Remove the picture of ${esc(name)}">${icon('trash', { size: 14 })} Remove picture</button>`;

/** The words next to a picture-less row. Nothing when there is a picture. */
const addPhotoLink = p => photoSrc(p.photo) ? dropPhotoLink(p.id, 'product', p.name)
  : `<button type="button" class="addpic tap" data-act="photo.product" data-id="${p.id}"
      aria-label="Add a picture of ${esc(p.name)}">${icon('camera', { size: 14 })} Add photo</button>`;

/** The shop's own front. Same gesture, the shop's own registered action. */
function shopThumb(s, size = 72) {
  const src = photoSrc(s.photo);
  return `<button type="button" class="thumb pthumb tap" style="width:${size}px;height:${size}px"
      data-act="photo.shop" data-id="${s.id}"
      aria-label="${src ? 'Replace the photo of your shop front' : 'Add a photo of your shop front'}">
      ${src ? `<img src="${src}" alt=""><span class="pthumb__edit">Change</span>`
            : `<span class="pthumb__ph">${icon('camera', { size: 20 })}<b>${esc(s.name[0])}</b></span>`}
    </button>`;
}

/** What the pictures are costing this phone, said in words a shopkeeper uses.
    A refusal should never be the first time anyone hears about the limit. */
function photoBudget() {
  const u = photos.usage();
  /* KB under a megabyte: "0.0 MB of 3.0 MB" tells a shopkeeper nothing. */
  const size = b => b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
  /* How many more will fit, at what the pictures already here actually weigh —
     never smaller than 40KB, so the number cannot flatter itself. */
  const each = Math.max(40 * 1024, u.count ? u.bytes / u.count : 0);
  const room = Math.floor(u.freeBytes / each);
  const tight = u.pct >= 80;
  return `<div class="budget">
    <span class="eyebrow" style="display:block">Pictures on this phone</span>
    <div class="between" style="gap:10px;margin-top:6px">
      <b style="font:800 15px var(--font-heading)">${u.count} picture${u.count === 1 ? '' : 's'}</b>
      <span class="micro muted num">${size(u.bytes)} of ${size(u.maxBytes)} used</span>
    </div>
    <div class="budget__bar" aria-hidden="true"><i style="width:${Math.max(2, u.pct)}%"></i></div>
    <p class="micro ${tight ? 'em' : 'muted'}">${tight
      ? `Nearly full — about ${room} more will fit. Replace a picture instead of adding one, or remove an item you no longer sell.`
      : `About ${room} more will fit at the size these are. Every picture is shrunk before it is kept, so one never costs more than ${Math.round(photos.MAX_ONE / 1024)}KB.`}</p>
  </div>`;
}

function priceRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  return `<div class="lrow lrow--c" style="flex-wrap:wrap">
    ${prodThumb(p, 44)}
    <div class="grow" style="min-width:140px">
      <div class="lrow__t">${esc(p.name)}</div>
      <div class="lrow__m">${esc(p.unit)}${p.mrp ? ` · MRP ${M.fmt(p.mrp)}` : ''}${p.variableWeight ? ' · by weight' : ''}${p.rxRequired ? ' · Rx' : ''} · ${out ? '<span class="em">hidden</span>' : 'listed'}</div>
    </div>
    <label class="row" style="gap:6px;flex:none"><span class="micro muted">₹</span>
      <input class="numin" type="number" value="${(p.price / 100).toFixed(0)}" data-role="price" data-id="${p.id}" aria-label="Price"></label>
    <label class="row" style="gap:6px;flex:none"><span class="micro muted">Stock</span>
      <input class="numin" type="number" value="${p.stockQty}" data-role="stock" data-id="${p.id}" aria-label="Stock"></label>
  </div>`;
}

function catalogRow(p) {
  const out = p.trackStock && p.stockQty <= 0;
  const low = p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt;
  return `<div class="lrow lrow--c" style="flex-wrap:wrap">
    ${prodThumb(p)}
    <div class="grow" style="min-width:120px">
      <div class="lrow__t">${esc(p.name)}</div>
      <div class="lrow__m ${out || low ? 'em' : ''}">${M.fmt(p.price)} · ${stockWord(p)}${p.mrp ? ` · MRP ${M.fmt(p.mrp)}` : ''}</div>
      ${addPhotoLink(p)}
    </div>
    <label class="row" style="gap:6px;flex:none"><span class="micro muted">₹</span>
      <input class="numin" type="number" value="${(p.price / 100).toFixed(0)}" data-role="price" data-id="${p.id}" aria-label="Price"></label>
    <label class="row" style="gap:6px;flex:none"><span class="micro muted">Stock</span>
      <input class="numin" type="number" value="${p.stockQty}" data-role="stock" data-id="${p.id}" aria-label="Stock"></label>
    <button class="btn btn-ghost btn-icon tap" style="min-height:44px;width:44px" data-act="prod.remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${icon('trash', { size: 16 })}</button>
    ${out ? '<p class="micro em" style="width:100%">Hidden from customers — set stock above 0.</p>' : ''}
  </div>`;
}

/* ── ADDING AN ITEM ───────────────────────────────────────────
   app.js routes exactly two actions here: `cat.picker` opens the sheet and
   `pick.add` adds the ready-list row whose refId it carries. Two reserved
   refIds ride the same action rather than asking for a new one: one opens the
   own-item form, one saves it. No new registered action, no app.js change. */
const CUSTOM_OPEN = '__custom', CUSTOM_SAVE = '__save';

/* The item created a second ago. Its whole reason to exist is that the
   photograph step needs something to belong to: a picture is written onto a
   product id, so the item has to be listed before it can be photographed. */
let justAdded = '';

function justAddedStrip() {
  if (!justAdded) return '';
  const p = getState().products.find(x => x.id === justAdded);
  if (!p) return '';
  const done = !!photoSrc(p.photo);
  return `<div class="justadd">
    ${prodThumb(p, 52)}
    <div class="grow" style="min-width:0">
      <b style="font:800 14px/1.2 var(--font-heading);display:block">${esc(p.name)} is listed</b>
      <span class="micro muted">${M.fmt(p.price)} · ${stockWord(p)}</span>
      ${done ? '<span class="micro" style="display:block;color:var(--success)">Picture added — it is on your storefront now.</span>'
             : addPhotoLink(p)}
    </div>
  </div>`;
}

/** The own-item form. Name, price, stock — then the picture, on the same
    screen, the moment there is an item for it to belong to.
    `keep` re-reads whatever is already typed, so redrawing the sheet after a
    photograph never costs anybody a half-filled form. */
function customForm(s, keep = false) {
  const live = id => { const el = $('#' + id); return el ? String(el.value) : null; };
  const v = (id, dflt) => { const x = keep ? live(id) : null; return x == null ? dflt : x; };
  const aisles = aislesOf(s.catId);
  const aisle = v('cpAisle', aisles[0] || '');
  return `${justAddedStrip()}
    <p class="tiny muted" style="margin-bottom:12px">Anything the ready list does not have. Name it, price it, save — then photograph it. It is on your storefront the moment you save.</p>
    <div class="cform">
      <div class="field"><input id="cpName" placeholder=" " autocomplete="off" value="${esc(v('cpName', ''))}"><label>What do you call it?</label></div>
      <div class="two">
        <div class="field"><input id="cpPrice" type="number" inputmode="numeric" min="1" step="1" placeholder=" " value="${esc(v('cpPrice', ''))}"><label>Your price ₹</label></div>
        <div class="field"><input id="cpStock" type="number" inputmode="numeric" min="0" step="1" placeholder=" " value="${esc(v('cpStock', '10'))}"><label>How many you have</label></div>
      </div>
      <div class="two">
        <div class="field"><input id="cpUnit" placeholder=" " autocomplete="off" value="${esc(v('cpUnit', 'each'))}"><label>Sold as (1 kg, 500 ml…)</label></div>
        <div class="field"><input id="cpMrp" type="number" inputmode="numeric" min="0" step="1" placeholder=" " value="${esc(v('cpMrp', ''))}"><label>Printed MRP ₹ (if any)</label></div>
      </div>
      ${aisles.length ? `<div class="field"><select id="cpAisle">${aisles.map(a =>
        `<option value="${esc(a)}"${a === aisle ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select><label>Which shelf</label></div>` : ''}
      <button class="btn btn-primary btn-block" data-act="pick.add" data-ref="${CUSTOM_SAVE}">Save it and start the next one</button>
      <p class="micro muted">Selling above a printed MRP is illegal, so a price over the MRP you type is refused here and on every later edit.</p>
    </div>
    ${photoBudget()}`;
}

function openCustom() {
  const s = myShop(); if (!s) return;
  openAddSheet = 'custom';
  stripPhoto = '';
  sheet('Add your own item', customForm(s), { noFocus: true });
  focusName(340);
}
const focusName = (ms = 0) => setTimeout(() => { const el = $('#cpName'); if (el) el.focus({ preventScroll: true }); }, ms);

/** Save, then leave the form empty and waiting — forty of these in a sitting
    is the whole point, so nothing here closes or navigates. */
function saveCustom(s) {
  const val = id => { const el = $('#' + id); return el ? String(el.value).trim() : ''; };
  const name = val('cpName');
  if (!name) { toast('Give it a name first', 'warn'); focusName(); return; }
  const price = M.toPaise(val('cpPrice'));
  if (!Number.isFinite(price) || price <= 0) { toast('Put a price on it', 'warn'); return; }
  const mrpTyped = val('cpMrp');
  const mrp = mrpTyped ? M.toPaise(mrpTyped) : null;
  if (mrp && price > mrp) { toast(`You cannot sell above the MRP you typed (${M.fmt(mrp)}) — it is illegal under Legal Metrology.`, 'danger'); return; }
  const el = $('#cpAisle');
  const p = flow.addCustomProduct(s.id, s.catId, {
    name, price, mrp,
    aisle: (el && el.value) || 'Everything else',
    unit: val('cpUnit') || 'each',
    stockQty: Math.max(0, Number(val('cpStock')) | 0),
  });
  justAdded = p ? p.id : '';
  stripPhoto = '';
  toast(`${name} is listed — now add its picture`);
  updateSheet(customForm(s));
  focusName();
  ctx.render();
}

function pickerBody(s) {
  const owned = new Set(getState().products.filter(p => p.shopId === s.id).map(p => p.refId));
  const list = searchStarter(s.catId, pickerQuery).filter(sc => !owned.has(sc.refId));
  return `
    ${justAddedStrip()}
    <button class="btn btn-secondary btn-block" style="justify-content:flex-start;margin-bottom:var(--sp-6)"
            data-act="pick.add" data-ref="${CUSTOM_OPEN}">${icon('camera', { size: 16 })} Add your own item — name, price, picture</button>
    <div class="search" style="margin-bottom:var(--sp-6)">
      <span aria-hidden="true">${icon('search', { size: 16 })}</span>
      <input id="pickq" type="search" placeholder="Search e.g. atta, tomato, milk"
             value="${esc(pickerQuery)}" data-role="pickersearch" autocomplete="off">
    </div>
    <p class="tiny muted" style="margin-bottom:4px">${list.length} items you don't stock yet</p>
    ${list.slice(0, 60).map(sc => `
      <div class="row" style="gap:10px;padding:10px 0;border-bottom:1px solid var(--color-divider)">
        <div class="grow" style="min-width:0"><b style="font:800 14px/1.2 var(--font-heading)">${esc(sc.name)}</b>
          <p class="micro muted">${esc(sc.aisle)} · ${esc(sc.unit)}${sc.mrp ? ` · MRP ${M.fmt(sc.mrp)}` : ''}</p></div>
        <b class="num tiny" style="flex:none">${M.fmt(sc.price)}</b>
        <button class="btn btn-primary btn--sm" style="flex:none;min-height:44px" data-act="pick.add" data-ref="${sc.refId}">Add</button>
      </div>`).join('') || '<p class="muted tiny">Nothing left to add here.</p>'}`;
}

export function openPicker() {
  const s = myShop(); if (!s) return;
  openAddSheet = 'picker';
  stripPhoto = (getState().products.find(x => x.id === justAdded) || {}).photo || '';
  sheet('Pick from the ready list', pickerBody(s), { noFocus: true });
}

/* Taking a picture is a registered action that re-renders the SCREEN — the
   sheet on top of it is not part of that render, so an open add-sheet would go
   on saying "Add photo" over a photograph that already exists. Every render of
   this console puts the sheet back in step, and only when the picture actually
   changed, so nothing flickers and nothing already typed is lost. */
let openAddSheet = '', stripPhoto = '';
function syncAddSheet(s) {
  if (!openAddSheet) return;
  if (!sheetOpen()) { openAddSheet = ''; return; }
  const p = justAdded ? getState().products.find(x => x.id === justAdded) : null;
  const now = (p && p.photo) || '';
  if (now === stripPhoto) return;
  stripPhoto = now;
  updateSheet(openAddSheet === 'custom' ? customForm(s, true) : pickerBody(s));
}

function shopStock(s, items) {
  const out = items.filter(p => p.trackStock && p.stockQty <= 0);
  const low = items.filter(p => p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt);
  const exp = items.filter(p => p.perishable && p.mfgDate && Date.now() - p.mfgDate > 2 * 86400000);
  const block = (title, list, hot) => `${kick(title, `<span class="tag ${list.length ? (hot ? 'tag-accent' : 'tag-accent-2') : 'tag-neutral'}">${list.length}</span>`)}
    ${list.length ? list.map(p => `<div class="lrow lrow--c">
      <span class="lrow__bar ${hot ? 'hot' : ''}"></span>
      <div class="grow" style="min-width:0"><div class="lrow__t">${esc(p.name)}</div>
        <div class="lrow__m">${esc(p.aisle)} · stock ${p.stockQty}</div></div>
      <button class="btn btn-secondary" style="flex:none" data-act="stock.refill" data-id="${p.id}">Restock 20</button>
    </div>`).join('') : '<p class="tiny muted" style="padding:6px 0">Nothing here — good.</p>'}`;
  return `
    <div class="stat3 stat2 bleed">
      ${capsule('Fill rate', `${s.fillRate}<span class="meta">%</span>`, 'stay above 85% for the “Reliable stock” badge')}
      ${capsule('Items buyable now', `${items.filter(p => p.active !== false && (!p.trackStock || p.stockQty > 0)).length}<span class="meta">/${items.length}</span>`, '')}
    </div>
    ${block('Out of stock (hidden from buyers)', out, true)}
    ${block('Running low', low, false)}
    ${block('Ageing perishables', exp, false)}`;
}

/* MONEY: settled to you, the fee lines, what an aggregator would have taken */
function shopMoney(s, orders) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);   // by settlement, not by stage
  const now = new Date();
  const month = done.filter(o => ymOf(o.settledAt) === now.getFullYear() * 12 + now.getMonth());
  const sum = (list, f) => list.reduce((n, o) => n + (o[f] || 0), 0);
  const gross = sum(done, 'itemsTotal'), fee = sum(done, 'platformFee'), rider = sum(done, 'riderPayout'), net = sum(done, 'shopPayout');
  const mNet = sum(month, 'shopPayout'), mGross = sum(month, 'itemsTotal');
  const cat = get('category', s.catId);
  const agg = Math.round(gross * AGG_COMMISSION);
  return `
    <div style="padding:14px 0;border-bottom:2px solid var(--color-divider)">
      <span class="eyebrow">${monthName(now, true)} · settled to you</span>
      <div class="big">${M.fmt(mNet)}</div>
      <p class="tiny muted">on ${M.fmt(mGross)} of orders this month · ${M.fmt(net)} on ${M.fmt(gross)} all time</p>
    </div>
    <div class="con2">
      <div>
        <div class="feeline"><span>Orders (${done.length} settled)</span><b class="num">${M.fmt(gross)}</b></div>
        <div class="feeline"><span>SAAHAA fee · ${cat.takePct}%, capped ${M.fmt(cat.takeCapPaise)}</span><b class="num">− ${M.fmt(fee)}</b></div>
        <div class="feeline"><span>Rider fees</span><b class="num">− ${M.fmt(rider)}</b></div>
        <div class="feeline"><span>Listing fee</span><b class="num">₹0</b></div>
        <div class="feeline"><span>Yearly plan</span><b class="num">₹0</b></div>
        <div class="feeline" style="border-bottom:2px solid var(--color-divider);font:800 15px var(--font-heading)"><span>Yours</span><span class="num good">${M.fmt(net)}</span></div>
        <div class="aggblock">
          <span class="brandline" style="opacity:.85">What an aggregator would have taken</span>
          <div style="font:800 30px/1 var(--font-heading);margin:8px 0 6px;font-variant-numeric:tabular-nums">${M.fmt(agg)}</div>
          <p style="font-size:12px;opacity:.92">at ${Math.round(AGG_COMMISSION * 100)}% of ${M.fmt(gross)}. SAAHAA took ${M.fmt(fee)} — you kept ${M.fmt(Math.max(0, agg - fee))} more.</p>
        </div>
        <p class="micro muted">SAAHAA takes ${cat.takePct}% because a kirana's own margin on staples is only 3–6% — a bigger cut would cost you more than the item earns.</p>
      </div>
      <div>
        ${shopWalletLine(s)}
        ${kick('Settled orders')}
        ${done.length ? done.slice(0, 12).map(o => `<div class="feeline"><span class="muted">${esc(o.customerName)} · ${timeAgo(o.settledAt || o.createdAt)}</span><b class="num">${M.fmt(o.shopPayout)}</b></div>`).join('')
          : '<p class="tiny muted" style="padding:6px 0">No settled orders yet.</p>'}
      </div>
    </div>`;
}

/* Derived, read-only: the same orders this console already shows, grouped by
   the name the customer ordered under. No new store, no new field. */
function shopCustomers(orders) {
  const byName = new Map();
  orders.forEach(o => {
    const k = o.customerName || 'Customer';
    const e = byName.get(k) || { name: k, n: 0, last: 0, area: o.customerArea || '' };
    e.n += 1;
    e.last = Math.max(e.last, o.createdAt || 0);
    if (o.customerArea) e.area = o.customerArea;
    byName.set(k, e);
  });
  const list = [...byName.values()].sort((a, b) => b.n - a.n || b.last - a.last);
  const repeat = list.filter(c => c.n > 1).length;
  if (!list.length) return empty('No customers yet', 'Every order you take adds the buyer here.');
  return `
    <div class="stat3 bleed">
      ${capsule('Customers', String(list.length), '')}
      ${capsule('Came back', String(repeat), 'ordered more than once')}
      ${capsule('Orders', String(orders.length), '')}
    </div>
    ${kick('Who buys')}
    ${list.map(c => `<div class="lrow lrow--c">
        <span class="avatar avatar--sm">${esc(c.name[0])}</span>
        <div class="grow" style="min-width:0"><div class="lrow__t">${esc(c.name)}</div>
          <div class="lrow__m">${esc(c.area)}${c.last ? ` · last ${timeAgo(c.last)}` : ''}</div></div>
        <span class="tag ${c.n > 1 ? 'tag-accent' : 'tag-neutral'}">${c.n} ${c.n === 1 ? 'order' : 'orders'}</span>
      </div>`).join('')}
    <p class="micro muted" style="padding:10px 0">Read only. SAAHAA never hands you a customer's number — the chat inside each order is the way to reach them.</p>`;
}

/* paidOut vs pending, from the fields the payout run already writes, and the
   payouts table straight off the ledger */
function shopPayouts(s, orders) {
  const settled = orders.filter(o => o.settledAt && o.shopPayout);
  const sent = settled.filter(o => o.paidOut);
  const waiting = settled.filter(o => !o.paidOut);
  const inEscrow = orders.filter(LIVE_RETAIL);
  const sum = list => list.reduce((n, o) => n + (o.shopPayout || 0), 0);
  const legs = shopLegs(s);
  const day = ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `
    <div class="stat3 bleed">
      ${capsule('Sent to bank', M.fmt(sum(sent)), `${sent.length} paid`, 'ok')}
      ${capsule('Awaiting payout', M.fmt(sum(waiting)), `${waiting.length} settled`, 'warn')}
      ${capsule('In escrow', M.fmt(sum(inEscrow)), `${inEscrow.length} live`, 'info')}
    </div>
    <p class="micro muted" style="padding:10px 0">These three never add up into one number. Escrow becomes awaiting the moment an order settles; awaiting becomes sent when the payout run clears.</p>
    <div class="con2">
      <div>
        ${kick('Payouts', `<span class="tag tag-neutral">${legs.length}</span>`)}
        ${legs.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead><tbody>
          ${legs.slice(0, 20).map(({ e, d }) => `<tr><td>${day(e.ts)}</td><td>${esc(SHOP_LEG[e.kind] || e.kind)}</td><td class="num" style="color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt(Math.abs(d))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="tiny muted" style="padding:6px 0">No entry on the book yet. Every settled order posts here.</p>'}
      </div>
      <div>
        ${kick('Awaiting payout')}
        ${waiting.length ? waiting.slice(0, 20).map(o => `<div class="feeline"><span class="muted">${esc(o.customerName)} · settled ${timeAgo(o.settledAt)}</span><b class="num">${M.fmt(o.shopPayout || 0)}</b></div>`).join('')
          : '<p class="tiny muted" style="padding:6px 0">Nothing waiting.</p>'}
        ${kick('Paid out')}
        ${sent.length ? sent.slice(0, 20).map(o => `<div class="feeline"><span class="muted">${esc(o.customerName)} · ${timeAgo(o.settledAt)}</span><b class="num">${M.fmt(o.shopPayout || 0)}</b></div>`).join('')
          : '<p class="tiny muted" style="padding:6px 0">No payout has cleared yet.</p>'}
      </div>
    </div>`;
}

/* Every figure below is read off orders and products that already exist. */
function shopAnalytics(s, orders, items) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);
  const gross = done.reduce((n, o) => n + o.itemsTotal, 0);
  const avgOrder = done.length ? Math.round(gross / done.length) : 0;
  const cancelled = orders.filter(o => o.stage === 'R_CANCELLED').length;
  const listed = items.filter(p => p.active !== false && (!p.trackStock || p.stockQty > 0)).length;
  return `
    <div class="stat3 bleed">
      ${capsule('Fill rate', `${s.fillRate}<span class="meta">%</span>`, 'found in stock')}
      ${capsule('Orders', String(orders.length), `${done.length} settled`)}
      ${capsule('Average order', M.fmt(avgOrder), 'settled orders')}
    </div>
    <div class="stat3 bleed" style="border-top:0">
      ${capsule('Buyable now', `${listed}<span class="meta">/${items.length}</span>`, '')}
      ${capsule('Cancelled', String(cancelled), '')}
      ${capsule('Min order', M.fmt(s.minOrder), '')}
    </div>
    <p class="micro muted" style="padding:12px 0">Fill rate is the number a buyer feels: how often what they tapped was actually on your shelf. It drives the “Reliable stock” badge and your place in the list.</p>`;
}

function shopSetup(s) {
  const cat = get('category', s.catId);
  const line = (k, v) => `<div class="feeline"><span class="muted">${k}</span>${v}</div>`;
  return `
    ${kick('Your shop')}
    <div class="lrow lrow--c" style="border-bottom:2px solid var(--color-divider);flex-wrap:wrap">
      ${shopThumb(s)}
      <div class="grow" style="min-width:150px"><div class="lrow__t" style="font-size:17px">${esc(s.name)}</div>
        <div class="lrow__m">${esc(cat.name)} · ${esc(s.area)} · ${esc(s.mobile)}</div>
        ${photoSrc(s.photo) ? '<div class="lrow__m">Tap the photo to take a new one.</div>'
          : `<button type="button" class="addpic tap" data-act="photo.shop" data-id="${s.id}"
               aria-label="Add a photo of your shop front">${icon('camera', { size: 14 })} Add your shop photo</button>`}
      </div>
    </div>
    <p class="micro muted" style="padding:8px 0">One photograph of your shutter or your counter. A customer scrolling a list stops at the shop they recognise from the street.</p>
    ${line('Minimum order', `<b class="num">${M.fmt(s.minOrder)}</b>`)}
    ${line('Free delivery above', `<b class="num">${M.fmt(s.freeDeliveryAbove)}</b>`)}
    ${line('Prep time', `<b>${s.prepMins} min</b>`)}
    ${line('Delivery radius', `<b>${s.radiusKm} km</b>`)}
    ${line('SAAHAA fee', `<b>${cat.takePct}% · capped ${M.fmt(cat.takeCapPaise)} an order</b>`)}
    ${s.fssai ? line('FSSAI', `<b class="tiny">${esc(s.fssai)}</b>`) : ''}
    ${s.drugLicence ? line('Drug licence', `<b class="tiny">${esc(s.drugLicence)}</b>`) : ''}

    ${kick('Delivery mode')}
    <div class="seg seg--block" role="group" aria-label="Delivery mode" style="overflow-x:auto;scrollbar-width:none">
      ${[['self','I deliver'],['rider','SAAHAA rider'],['both','Either'],['pickup_only','Pickup only']]
        .map(([k, l]) => `<button class="seg__btn" type="button"
          aria-pressed="${s.deliveryMode === k ? 'true' : 'false'}"
          data-act="shop.mode" data-mode="${k}">${esc(l)}</button>`).join('')}
    </div>
    <p class="micro muted" style="padding:10px 0">Pickup only hides the delivery fee from your customers entirely.</p>

    ${kick('Your public storefront')}
    <button class="lrow lrow--c" data-act="shop.open" data-id="${s.id}">
      <div class="grow" style="min-width:0"><div class="lrow__t" style="word-break:break-all">${esc(`${location.host}${location.pathname}#/shop/${s.id}`)}</div>
        <div class="lrow__m">What customers see. Share it on WhatsApp.</div></div>
      <span class="more">Open</span>
    </button>
    ${photoBudget()}`;
}

/* ── handlers ──────────────────────────────────────────────── */
export function addFromPicker(refId) {
  const s = myShop(); if (!s) return;
  if (refId === CUSTOM_OPEN) { openCustom(); return; }
  if (refId === CUSTOM_SAVE) { saveCustom(s); return; }
  const sc = searchStarter(s.catId, '').find(x => x.refId === refId);
  if (!sc) return;
  const p = flow.addProductFromStarter(s.id, sc);
  justAdded = p ? p.id : '';
  toast(`${sc.name} listed — now add its picture`);
  openPicker();
  ctx.render();
}
export function refill(productId) {
  dispatch({ type: 'product/stock', payload: { id: productId, qty: 20 } });
  toast('Restocked');
  ctx.render();
}
export function removeProduct(productId) {
  if (justAdded === productId) justAdded = '';
  dispatch({ type: 'product/remove', payload: { id: productId } });
  toast('Removed from your catalog');
  ctx.render();
}
export function priceEdit(productId, rupees) {
  const r = flow.setProductPrice(productId, Math.round(Number(rupees) * 100));
  if (!r.ok && r.reason) toast(r.reason, 'danger');
}
export function stockEdit(productId, qty) {
  dispatch({ type: 'product/stock', payload: { id: productId, qty: Math.max(0, Number(qty) | 0) } });
}
