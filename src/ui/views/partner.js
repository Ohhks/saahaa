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
import * as qr from '../../core/qr.js';
import * as proView from './pro.js';
import { subKey } from '../../domain/catalog.services.js';
import { t, catName, subName, langPicker } from '../i18n.js';
import { icon, hasIcon } from '../icons.js';
import * as ID from '../../domain/identity.js';
import { ctx, getState, dispatch, me, myPartner, myShop, myOrders } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { subSize } from '../../domain/catalog.services.js';
import * as IMG from '../../core/imgstore.js';
import { stage } from '../../domain/orders.js';
import * as flow from '../../domain/flow.js';
import * as M from '../../core/money.js';
import { trustScore, tier, TIERS, markupFor } from '../../domain/trust.js';
import { searchStarter, aislesOf } from '../../domain/starter-catalog.js';
import { header, emptyBlock } from './shops.js';
import { quoteRetail, AGG_COMMISSION, RIDER_DISPATCH_CUT } from '../../domain/pricing.js';
import * as auction from '../../domain/auction.js';
import { progressCard } from './onboard.js';
import { readiness, blocker, backgroundRecord } from '../../domain/verification.js';
import * as W from '../../domain/wallet.js';
import * as autoverify from '../../domain/autoverify.js';
import { acct, balanceOf, HOLDBACK_PCT, HOLDBACK_CAP, HOLDBACK_DAYS } from '../../domain/ledger.js';
import * as L from '../../domain/ledger.js';
import * as flags from '../../core/flags.js';
import { getPricing } from '../../domain/settings.js';
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
  .con__hdr .sub{font-size:12px;opacity:.75;display:block;margin-top:3px}
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
  .utabs button[aria-selected="true"]{color:var(--color-accent-text);border-bottom-color:var(--color-accent)}
  .utabs .n{font-size:12px;padding:2px 5px;background:var(--color-neutral-200);color:var(--color-neutral-800)}
  .subtabs{display:flex;gap:6px;padding:10px 0;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--color-divider)} .subtabs::-webkit-scrollbar{display:none}
  .subtabs button{padding:6px 10px;font:600 11px/1 var(--font-body);white-space:nowrap;border:1px solid var(--color-divider);min-height:44px}
  .subtabs button[aria-selected="true"]{background:var(--color-accent);color:var(--accent-on-fill);border-color:var(--color-accent)}
  .lrow{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--color-divider);align-items:flex-start;width:100%;text-align:left;color:inherit}
  .lrow--c{align-items:center} .lrow--col{flex-direction:column;gap:0}
  .lrow__t{font:800 14px/1.2 var(--font-heading)} .lrow__m{font-size:12px;color:var(--ink-3);margin-top:3px}
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
  .addpic{display:inline-flex;align-items:center;gap:6px;min-height:44px;font:600 11px/1 var(--font-body);letter-spacing:.05em;text-transform:uppercase;color:var(--color-accent-text)}
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
/* Every way SAAHAA takes money back out of a partner's wallet. A new one added
   to the engine and forgotten here silently inflates what his screen says he
   kept — which is exactly what `CANCEL_FEE` did. */
/* AND THIS WAS STILL A WHITELIST, three lines under a comment explaining why
   whitelists fail. `wallet.js` had already been turned into a denylist and this
   had not, so the two files disagreed about what counts as money taken — and
   the next kind the engine grows would be invisible here again. A debit from
   his wallet that is not a withdrawal, a stake lock or a holdback is money
   SAAHAA took; that is the rule, and it needs no list to maintain. */
const NOT_TAKEN = ['WITHDRAW', 'STAKE_LOCK', 'HOLDBACK', 'ESCROW_IN'];
const takenByUs = kind => !NOT_TAKEN.includes(kind);
const monthName = (d, long = false) => d.toLocaleString('en-IN', { month: long ? 'long' : 'short' }).toUpperCase();
const isToday = ts => { const a = new Date(ts), b = new Date(); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };

/* ══════════════ PRO CONSOLE ══════════════ */
const ACTIVE = ['MATCHING','ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS','WORK_DONE'];
/* the tab strip is on every earning screen, so leaving it English left a
   Latin band across the top of a console that was otherwise in his language */
const PRO_TABS = () => [['leads', t('earn.tabLeads')], ['jobs', t('earn.tabJobs')],
                        ['earnings', t('earn.tabEarnings')], ['page', t('earn.tabPage')]];

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
        <div class="lrow__m">${esc(r.area)} · ${esc(t('earn.haveQuoted', { n: r.bidCount | 0 }))} · ${esc(t('earn.fairPrice', { amount: M.fmt(r.target) }))}</div>
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
        <div class="grow" style="min-width:0"><div class="lrow__t">${esc(catName(c))} · ${esc(r.area || '')}</div>
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

function proLeads(p, open, gate, sent = []) {
  const r = readiness(p);
  return `${progressCard(p)}
    <!-- A QUOTE HE SENT WAS VISIBLE NOWHERE IN HIS OWN APP. The open-leads list
         drops a request the moment he bids on it -- correctly, it lists work he
         has NOT answered -- and nothing picked it up afterwards. So he sent a
         rate and it vanished: Leads 0, Jobs 0, no "awaiting reply" anywhere. He
         could not tell whether he had bid, and when a customer accepted and the
         booking failed he could not tell that either. It stays until it
         resolves, with what he asked and when. -->
    ${sent.length ? kick(t('earn.sentQuotes'), `<span class="tag tag-neutral">${sent.length}</span>`)
      + sent.map(({ bid, req }) => `<div class="lrow">
          <div class="grow" style="min-width:0">
            <b class="lrow__t">${esc(subName(req.sub, subKey(req.sub)) || (get('category', req.catId) || {}).name || '')}</b>
            <div class="lrow__m">${esc(t('earn.quoteWaiting', { when: timeAgo(bid.submittedAt) }))}</div>
          </div>
          <b class="num">${M.fmt(bid.amount)}</b>
        </div>`).join('') : ''}
    ${gate && r.complete ? `<div class="card" style="border-color:var(--warn);margin-top:12px"><b class="tiny">${esc(gate)}</b></div>` : ''}
    ${kick(t('earn.openNear'), open.length ? `<span class="tag tag-accent">${esc(t('earn.nearYou', { n: open.length }))}</span>` : '')}
    ${open.length ? open.map(x => leadRow(x, p)).join('')
      + `<p class="micro muted" style="padding:10px 0">${esc(t('earn.underFair'))}</p>`
      : empty(t('earn.noOpen'), r.canWork && p.online !== false
          ? t('earn.onlineWaiting', { area: p.area })
          : p.online === false ? t('earn.offline')
          : t('earn.goOnline'))}
    ${!open.length && r.canWork ? firstJobBlock(p) : ''}
    ${myRates(p)}`;
}

function jobRow(o) {
  const st = stage(o.stage);
  return `<button class="lrow lrow--c" data-act="order.open" data-id="${o.id}">
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(o.customerName)}</div>
      <div class="lrow__m">${esc(o.sub ? subName(o.sub, subKey(o.sub)) : (get('category', o.catId) || {}).name || 'Job')} · ${esc(o.customerArea)} · ${o.km} km · ${timeAgo(o.createdAt)}</div>
    </div>
    <div style="text-align:right;flex:none">
      <span class="tag ${['ARRIVED','IN_PROGRESS','WORK_DONE'].includes(o.stage) ? 'tag-accent' : 'tag-neutral'}">${esc(st.short)}</span>
      <b class="num" style="display:block;margin-top:6px">${M.fmt(o.deal)}</b>
    </div>
  </button>`;
}

function proJobs(inbox) {
  return `${kick(t('earn.yourJobs'), `<span class="tag ${inbox.length ? 'tag-accent' : 'tag-neutral'}">${esc(t('earn.nActive', { n: inbox.length }))}</span>`)}
    ${inbox.length ? inbox.map(jobRow).join('')
      + `<p class="micro muted" style="padding:10px 0">${esc(t('earn.jobsLiveInside'))}</p>`
      : empty(t('earn.noLive'), t('earn.noLiveSub'))}`;
}

/* The worker's wallet: four states, never blended. AVAILABLE is theirs to
   take; LOCKED is committed to a job in progress and returns in full when it
   is finished; PENDING is the 7-day holdback; RELEASED is everything ever
   paid. The stake is what makes a check-in a commitment. */
function walletCard(p) {
  const w = W.walletOf(getState().ledger, p.id, p);
  const live = getState().orders.filter(o => o.partnerId === p.id && o.stake && !o.stake.returned && !o.stake.forfeited);
  return `${kick(t('earn.wallet'), `<span class="tag tag-neutral">${esc(t('earn.minStake', { amount: M.fmt(W.MIN_STAKE) }))}</span>`)}
    <div class="capsules" style="grid-template-columns:repeat(2,1fr)">
      <div class="capsule capsule--ok"><span class="capsule__k">${esc(t('money.available'))}</span><span class="capsule__v num">${M.fmtMax(w.available)}</span><span class="state state--available">${esc(t('money.availableSub'))}</span></div>
      <div class="capsule capsule--info"><span class="capsule__k">${esc(t('money.locked'))}</span><span class="capsule__v num">${M.fmt(w.locked)}</span><span class="state state--held">${esc(live.length ? t('earn.inProgress', { n: live.length }) : t('earn.returnsWhenDone'))}</span></div>
      <div class="capsule capsule--warn"><span class="capsule__k">${esc(t('money.pending'))}</span><span class="capsule__v num">${M.fmt(w.pending)}</span><span class="state state--pending">${esc(t('earn.holdbackDays', { days: HOLDBACK_DAYS }))}</span></div>
      <div class="capsule capsule--gold"><span class="capsule__k">${esc(t('money.released'))}</span><span class="capsule__v num">${M.fmt(w.released)}</span><span class="state state--released">${esc(t('earn.lifetime'))}</span></div>
    </div>
    ${w.debt ? `<p class="tiny" style="margin-top:8px;color:var(--warn)">${esc(t('earn.debtOwed', { amount: M.fmt(w.debt) }))}</p>` : ''}
    <p class="micro muted" style="margin-top:8px">${esc(gateway.label())}</p>
    <p class="micro muted" style="margin-top:6px">${esc(t('earn.stakeHow', { min: M.fmt(W.MIN_STAKE), pct: W.STAKE_PCT, max: M.fmt(W.MAX_STAKE) }))}</p>
    <p class="micro muted" style="margin-top:6px">${esc(t('earn.stakeEmpty'))}</p>
    <p class="micro muted" style="margin-top:6px">${esc(t('earn.pendingHow', { pct: HOLDBACK_PCT, days: HOLDBACK_DAYS, cap: M.fmt(HOLDBACK_CAP) }))}</p>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn-secondary grow" data-act="wallet.topup" data-id="${p.id}">${esc(t('money.add'))}</button>
      <button class="btn btn-ghost grow" data-act="wallet.withdraw" data-id="${p.id}" data-amt="${w.available}" ${(!upiOf(p) || w.available < flow.MIN_WITHDRAW) ? 'disabled' : ''}>${esc(t('money.withdraw'))}${w.available >= flow.MIN_WITHDRAW ? ' ' + M.fmtMax(w.available) : ''}</button>
    </div>`;
}

const upiOf = p => ((p && p.verification) || {}).upi || '';

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

/* ── THE PRO'S PASSBOOK ────────────────────────────────────────
   THE CUSTOMER GOT A HASH-CHAINED LEDGER AND THE WORKER GOT FOUR TILES. Her
   wallet lists every leg to the paisa under "it can be verified, never edited".
   His screen asserted the same money in prose: a ₹100 stake, a 10% holdback, a
   ₹40 cancellation fee and ₹111 SAAHAA kept on a job he was never shown -- four
   charges, none of them itemised anywhere he could look. An audit put it
   plainly: "every rupee taken from me is asserted, never itemised", and scored
   the platform 5/10 on exactly that.

   The engine could always do this. `legsFor` was added rounds ago and the DEBT
   account earlier in this same version; nothing was missing except the screen.

   His money lives in four pockets, so all four are read: the wallet itself, the
   holdback that waits seven days, the stake locked against a live job, and the
   debt account a cancellation fee posts to when his wallet is empty. A passbook
   that showed only the wallet would hide the three that hurt. */
const POCKET = { HOLDBACK: 'earn.pocketHold', STAKE: 'earn.pocketStake', DEBT: 'earn.pocketOwed' };
const legWordPro = kind => {
  /* a kind with no word yet falls back to its readable English rather than to
     a blank or a raw SCREAMING_CASE constant */
  const k = String(kind || '');
  const got = t('leg.' + k);
  return got === 'leg.' + k
    ? (k || 'Movement').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
    : got;
};

/* Which job a passbook line is about, in the words the pro would use for it:
   the sub-job and the customer's first name. */
function jobOf(r) {
  const id = r && r.meta && r.meta.orderId;
  if (!id) return '';
  const o = (getState().orders || []).find(x => x.id === id);
  if (!o) return '';
  const what = o.sub ? subName(o.sub, subKey(o.sub)) : (get('category', o.catId) || {}).name || '';
  const who = String(o.customerName || '').split(' ')[0];
  return [what, who].filter(Boolean).join(' · ');
}

/* THE SHOP HAD NO PASSBOOK. The pro's is the best screen in the product --
   hash-chained, paisa-exact, every line naming its job. The shop, which is the
   party carrying inventory risk, weight risk and return risk, had a two-line
   list of ARRIVALS with no deductions in it at all: an audit watched ₹188
   become ₹104.40 and could find nothing anywhere that said where ₹83.60 went.

   The deductions are real but they never touch the shop's own ledger account --
   SAAHAA's fee, the dispatch cut and a customer refund all come out of ESCROW
   before the shop is paid, so a screen that reads only `SHOP:<id>` legs can
   never show them. That is why this reads the ORDER, which is where the whole
   split is recorded, and states it the way a shopkeeper checks a day: what she
   paid, what was taken, what came back, what reached the till. The last line is
   the arrival that IS on the ledger, so the book and the screen agree. */
function shopPassbook(s) {
  const led = getState().ledger || [];
  const mine = (getState().orders || [])
    .filter(o => o.kind === 'retail' && o.shopId === s.id && (o.settledAt || o.refundedAt))
    .sort((a, b) => (b.settledAt || b.refundedAt || 0) - (a.settledAt || a.refundedAt || 0))
    .slice(0, 12);
  if (!mine.length) return `<p class="micro muted" style="margin-top:10px">${esc(t('shop.bookEmpty'))}</p>`;

  const row = (label, amount, sign) => !amount ? '' :
    `<div class="m-kv"><span class="tiny muted">${esc(label)}</span>
      <b class="num" style="font-size:13px;color:${sign < 0 ? 'var(--ink-2)' : 'var(--success)'}">${
        sign < 0 ? '\u2212' : '+'}${M.fmt2(Math.abs(amount))}</b></div>`;

  return mine.map(o => {
    const paidIn = L.legsFor(led, acctShop(s.id))
      .filter(r => r.meta && r.meta.orderId === o.id)
      .reduce((n, r) => n + (r.delta | 0), 0);
    const saahaa = o.platformFee | 0;      // GST-inclusive; `o.gst` is inside it
    return `<div class="card" style="padding:10px 12px;margin-top:8px">
      <div class="between" style="align-items:baseline">
        <b class="tiny">${esc(o.customerName || t('shop.aCustomer'))}</b>
        <span class="micro muted">${timeAgo(o.settledAt || o.refundedAt)}</span>
      </div>
      ${row(t('shop.shePaid'), (o.customerPays | 0) + (o.returnedValue | 0), 1)}
      ${row(t('shop.returnedToHer'), o.returnedValue | 0, -1)}
      ${row(t('shop.saahaaFee'), saahaa, -1)}
      ${row(t('shop.dispatchShort'), o.dispatchCut | 0, -1)}
      <div class="m-kv m-kv--total"><span>${esc(t('shop.reachedYou'))}</span>
        <b class="num good">${M.fmt2(paidIn)}</b></div>
    </div>`;
  }).join('');
}

function proPassbook(p) {
  const led = getState().ledger || [];
  /* the list lives in the engine (domain/ledger.js partnerAccounts) so a pocket
     added there can never quietly go missing from the screen that owes him it */
  let rows = [];
  for (const account of L.partnerAccounts(p.id)) {
    const pocket = L.typeOf(account) === 'PARTNER' ? '' : L.typeOf(account);
    for (const r of L.legsFor(led, account)) rows.push({ ...r, pocket });
  }
  /* ONE ₹100 STAKE PRINTED FOUR LINES, TWO OF THEM CONTRADICTING THE OTHER TWO:

         Stake returned              +₹100.00
         Stake returned · stake      −₹100.00
         Stake locked on a job       −₹100.00
         Stake locked on a job · stake +₹100.00

     The passbook deliberately reads all four of his pockets, so a movement
     BETWEEN two of them — wallet into stake, wallet into holdback — is a real
     double entry and shows up twice, correctly signed and completely
     unreadable. An audit put it near the top of what stops it trusting the app
     with a week's earnings, and it is right to: a person checking whether they
     were charged twice cannot tell from this.

     Money that only moved from one of his pockets to another has not left him,
     so it is ONE line saying so, and it contributes zero to the column — which
     is what it contributes to his total, because both halves are his. Money
     that genuinely arrived or genuinely left still prints exactly as before. */
  const byEntry = new Map();
  for (const r of rows) {
    const key = r.at;                       // the entry's own place in the book
    if (!byEntry.has(key)) byEntry.set(key, []);
    byEntry.get(key).push(r);
  }
  const merged = [];
  for (const group of byEntry.values()) {
    if (group.length === 2 && (group[0].delta | 0) === -(group[1].delta | 0)) {
      const to = group.find(r => (r.delta | 0) > 0) || group[0];
      const from = group.find(r => (r.delta | 0) < 0) || group[1];
      merged.push({ ...to, delta: 0, internal: true,
        moved: Math.abs(from.delta | 0), fromPocket: from.pocket, toPocket: to.pocket });
    } else {
      group.forEach(r => merged.push(r));
    }
  }
  rows = merged;
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (!rows.length) return `<p class="micro muted" style="margin-top:10px">${esc(t('earn.passbookEmpty'))}</p>`;

  /* AND THE PASSBOOK I ADDED LAST ROUND ASSERTED A TOTAL ITS OWN LINES DO NOT
     SUM TO. The footer said "In your wallet now: ₹936.00" under a column adding
     up to ₹1,048 -- the difference being the holdback, which is one of the four
     pockets these lines deliberately cover. An audit reconciled it by hand and
     found every reading off by exactly the pending balance.

     That is the same defect this version has now built three gates for, in the
     screen I built to fix a different one. A column of four pockets sums to
     four pockets: it says what it adds up to, and then names the split. */
  const w = W.walletOf(led, p.id, p);
  const columnSum = rows.reduce((n, r) => n + (r.delta | 0), 0);
  return `<p class="m-cap" style="margin-top:14px">${esc(t('earn.passbook'))}</p>
    ${rows.slice(0, 40).map(r => r.internal
      ? `<div class="m-kv" style="border-bottom:1px solid var(--color-divider)">
        <!-- AND AN UNSIGNED ₹100.00 IN A COLUMN OF SIGNED ONES STILL DID NOT ADD
             UP BY EYE: reading top to bottom gave ₹700 where the total said
             ₹560. This row changes his balance by nothing, so the column shows
             nothing and the amount goes in the sentence, where it belongs. -->
        <!-- "STILL YOURS, SO NOTHING LEFT YOUR BALANCE" ON A ₹40 THAT LEFT FOR
             GOOD. The sentence is true of a stake and of a holdback -- both come
             back -- and it was printed on the cancellation fee too, which is the
             one movement on this screen that is gone. An audit called it the
             only wording on the money screens that misinforms in the platform's
             favour, and it was right. A debt is owed, not held. -->
        <span class="tiny muted">${esc(t(r.toPocket === 'DEBT' ? 'earn.movedOwed' : 'earn.movedPocket', {
          amount: M.fmt2(r.moved),
          from: r.fromPocket ? t(POCKET[r.fromPocket]) : t('earn.yourWallet'),
          to: r.toPocket ? t(POCKET[r.toPocket]) : t('earn.yourWallet') }))} · ${timeAgo(r.ts)}</span>
        <b class="num muted" style="font-size:13px">—</b></div>`
      : `<div class="m-kv" style="border-bottom:1px solid var(--color-divider)">
        <!-- "CANCELLATION FEE −₹33.90" AND NOTHING ELSE. No line named its job or
             its customer, and a cancelled job never appears in Recent Jobs, so
             the one question a pro actually asks the passbook — which job was
             that? — had no answer anywhere in the app. Every leg already carries
             its order id; it was simply never printed. -->
        <span class="tiny muted">${esc(legWordPro(r.kind))}${r.pocket ? ` · ${esc(t(POCKET[r.pocket]))}` : ''}${
          jobOf(r) ? ` · ${esc(jobOf(r))}` : ''} · ${timeAgo(r.ts)}</span>
        <b class="num" style="font-size:13px;color:${r.delta < 0 ? 'var(--ink-2)' : 'var(--success)'}">${
          r.delta < 0 ? '\u2212' : '+'}${M.fmt2(Math.abs(r.delta))}</b></div>`).join('')}
    <!-- "ADD UP TO ₹236.00 — ₹234.00 IN YOUR WALLET AND ₹42.00 HELD BACK".
         234 + 42 = 276. The column covers FOUR pockets and the sentence named
         two, so it stopped decomposing the moment a stake was locked or a debt
         was carried — and the screen that says "to the paisa" was the screen not
         adding up. It names every pocket that is not empty. -->
    <p class="micro muted" style="margin-top:6px">${esc(t('earn.passbookAdds', { total: M.fmt2(columnSum) }))} ${
      esc([[w.available | 0, 'earn.potWallet'],
           [w.pending | 0, 'earn.potHeld'],
           [L.balanceOf(led, 'STAKE:' + p.id) | 0, 'earn.potStake'],
           [L.balanceOf(led, L.acct.debt(p.id)) | 0, 'earn.potOwed']]
        /* AND THE POCKETS WERE JOINED WITH DOTS, SO NOBODY COULD ADD THEM UP.
           A debt is a NEGATIVE pocket printed through Math.abs, so the line read
           "243.00 in your wallet · 63.00 still held back · 40.00 you owe" under
           a total of 266 -- and 243 + 63 is 306, while 243 + 63 + 40 is 346. An
           audit worked it by hand, could not close it either way, and called it
           the thing that would stop him trusting the screen. The arithmetic was
           right all along; it was simply never shown. Signs, not dots. */
        .filter(([v]) => v !== 0)
        .map(([v, k], i) => (i === 0 ? '' : v < 0 ? ' \u2212 ' : ' + ')
              + t(k, { amount: M.fmt2(Math.abs(v)) }))
        .join(''))}</p>`;
}

function proEarnings(p, orders, paid, earned, held, paidOut) {
  const now = new Date();
  /* AND THEN IT DIVIDED ONE POPULATION BY ANOTHER AND CALLED IT 100%.
     `kept` is read off the ledger -- every credit that reached him, including
     the compensation for a job the customer cancelled en route. `quoted` summed
     `o.deal` over SETTLED orders only, which that cancelled job is not. So the
     header read

         YOU KEPT ₹752 — from ₹540 quoted · you keep 100%

     i.e. 139%, printed beside the words "you keep 100%". Earlier in the same
     session it read ₹500 from ₹540 -- 93% -- beside the same words. A ratio
     between two different sets of jobs is not a ratio.

     "You keep 100%" is a claim about the FEE MODEL: SAAHAA's percentage is
     added on top and never deducted from his rate. It is true, and it does not
     need a fraction to say it. What the header owes him instead is the two
     numbers his own total is made of, which is also the thing he has been
     asking for: what came in, and what went back out. */
  const w = W.walletOf(getState().ledger, p.id, p);
  /* HE WAS TOLD HE KEPT ₹428 ON A LEDGER THAT PAID HIM ₹388. `kept` summed
     `o.workerPayout` — the gross release — and a ₹40 cancellation debt is
     recovered out of that payout the moment it lands, so the difference never
     appeared on any screen he has. Worse, the `debt` warning line disappears
     the instant the debt is collected, so the charge he had been warned about
     became invisible at exactly the moment it was taken.

     What a person kept is what reached their account. It comes off the ledger,
     and anything taken back out of it is named on its own line. */
  const legs = L.legsFor(getState().ledger || [], acct.partner(p.id));
  const inMonth = r => ymOf(r.ts) === now.getFullYear() * 12 + now.getMonth();
  const CREDIT = ['ESCROW_RELEASE', 'COMPENSATION', 'HOLDBACK_RELEASE'];
  const grossMonth = legs.filter(r => inMonth(r) && r.delta > 0 && CREDIT.includes(r.kind))
                         .reduce((n, r) => n + r.delta, 0);
  /* AND WHITELISTING ONE KIND MISSED THE NEXT ONE. This counted only
     `DEBT_RECOVERY`, so a `CANCEL_FEE` of ₹40 posted cleanly to the ledger and
     appeared on no screen belonging to the man it was taken from — his headline
     still read ₹1,200 over a wallet holding ₹1,160, under a caption saying "we
     take nothing out of your rate". A whitelist of kinds has to be extended
     every time the engine grows one, and it will not be. What matters is not
     the name of the entry: it is that money left his account and went to
     SAAHAA. That is what is counted. */
  const takenMonth = legs.filter(r => inMonth(r) && r.delta < 0 && takenByUs(r.kind))
                         .reduce((n, r) => n - r.delta, 0);
  const kept = Math.max(0, grossMonth - takenMonth);
  const recent = paid.slice().sort((a, b) => b.settledAt - a.settledAt).slice(0, 8);
  /* his OWN rate, not the standard one — a tier-4 partner pays 6% and this
     line told him 8%, so the rebate he had earned never appeared anywhere he
     could see it */
  const pct = Math.round(markupFor(p) * 100);
  return `
    <div style="padding:14px 0;border-bottom:2px solid var(--color-divider)">
      <span class="eyebrow">${monthName(now, true)} · ${esc(t('earn.youKept'))}</span>
      <div class="big">${M.fmt(kept)}</div>
      <!-- "YOU KEPT ₹1,248" directly above "₹1,288 reached your wallet". The
           ₹1,288 is what came IN; ₹1,248 is what stayed after a ₹40 cancellation
           fee, and the headline above already says so. Money that came in and
           was partly taken back did not "reach your wallet". -->
      <p class="tiny muted">${esc(t('earn.cameIn', { amount: M.fmt(grossMonth), pct }))}</p>
      ${takenMonth ? `<p class="tiny" style="margin-top:6px;color:var(--warn)">${esc(t('earn.recovered', { amount: M.fmt(takenMonth) }))}</p>` : ''}
      ${paid.length ? monthBars(paid) : `<p class="micro muted" style="margin-top:10px">${esc(t('earn.firstBar'))}</p>`}
      ${proPassbook(p)}
    </div>

    <div class="payline">
      <div class="grow" style="min-width:0">
        <b style="font:800 15px var(--font-heading);display:block">${esc(t('earn.payableNow', { amount: M.fmtMax(w.available) }))}</b>
        <span class="micro" style="opacity:.85">${upiOf(p)
          ? esc(upiOf(p)) : esc(t('earn.noUpi'))} · ${esc(gateway.label())}</span>
      </div>
      <!-- THE PRO HAD NO WAY TO SET HIS OWN UPI ANYWHERE IN THE APP. Onboarding
           step 6 collects it once and is unreachable afterwards, so a pro whose
           bank changed was stuck for ever — and this button stayed enabled and
           then refused with "add a UPI id first" on a screen with no way to add
           one. The shop's payout screen, further down this same file, has done
           it correctly the whole time. -->
      <button class="btn btn-secondary" style="border-color:currentColor;color:inherit"
        data-act="pro.upi" data-id="${p.id}">${esc(upiOf(p) ? t('earn.changeUpi') : t('earn.addUpi'))}</button>
      <button class="btn btn-secondary" style="border-color:currentColor;color:inherit" data-act="wallet.withdraw" data-id="${p.id}" data-amt="${w.available}" ${(!upiOf(p) || w.available < flow.MIN_WITHDRAW) ? 'disabled' : ''}>${esc(t('earn.withdraw'))}</button>
    </div>
    <!-- THIS SAID "Withdrawals start at Rs.1,000" AND GREYED THE BUTTON, beside a
         figure the same screen labelled "yours to withdraw". The engine has
         always allowed Rs.10 — the floor existed only here, written as a raw
         100000 in three places, and it locked a plumber's first Rs.520 job
         behind a second one. -->
    ${w.available < flow.MIN_WITHDRAW ? `<p class="micro muted" style="margin-top:6px">${esc(t('money.minWithdraw', { amount: M.fmt(flow.MIN_WITHDRAW) }))}</p>` : ''}

    <div class="con2">
      <div>
        ${kick(t('earn.recentJobs'))}
        ${recent.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>${esc(t('earn.colJob'))}</th><th class="num">${esc(t('earn.colQuoted'))}</th><th class="num">${esc(t('earn.colKept'))}</th></tr></thead><tbody>
          ${recent.map(o => `<tr><td>${esc(o.sub ? subName(o.sub, subKey(o.sub)) : (get('category', o.catId) || {}).name || 'Job')} · ${esc(o.customerName)}<span class="micro muted" style="display:block">${timeAgo(o.settledAt)}</span></td>
            <td class="num">${M.fmt(o.deal)}</td><td class="num">${M.fmt(o.workerPayout)}</td></tr>`).join('')}
          </tbody></table></div>
          <!-- printed unconditionally, directly under a row reading "₹600 quoted,
               ₹360 kept" — telling him in writing that the ₹240 he had just
               lost to an upheld complaint could not have happened -->
          <p class="micro muted" style="margin-top:8px">${paid.some(o => o.releasedPct != null && o.releasedPct < 1)
            || w.recovered
            ? esc(t('earn.keptExcept'))
            : esc(t('earn.keptEquals'))}</p>`
          : empty(t('earn.noSettled'), t('earn.noSettledSub'))}

        ${kick(t('earn.whereMoney'))}
        <div class="capsules">
          ${capsule(t('earn.paidOut'), M.fmt(w.released), money('released', t('earn.releasedToYou')), 'ok')}
          ${capsule(t('earn.inEscrow'), M.fmt(held), money('held', t('earn.heldUntil')), 'info')}
          ${capsule(t('earn.sentToUpi'), M.fmt(paidOut), money('available', t('earn.landed')), 'soft')}
        </div>
        <p class="micro muted" style="margin-top:8px">${esc(t('earn.threeThings'))}</p>
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
  const tierNo = p.tier | 0;
  if (tierNo !== 2 && tierNo !== 3) return '';
  const pr = tierNo === 2 ? autoverify.progress(p) : autoverify.certifiedProgress(p);
  const lines = pr.lines;
  const green = Object.values(lines).filter(l => l.ok).length, total = Object.keys(lines).length;
  const next = tierNo === 2 ? 'Background Checked' : 'SAAHAA Certified';
  const bg = backgroundRecord(p) || {};
  if (bg.refConfirmed && shownRefCode) shownRefCode = '';
  return `${kick(`Standing · next: ${next}`, `<span class="tag ${green === total ? 'tag-accent' : 'tag-neutral'}">${green} / ${total} green</span>`)}
    <div>
      ${tierNo === 2 ? `
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
      <p class="micro muted" style="margin-top:10px">${tierNo === 2
        ? 'Background Checked is granted automatically when every line is green — no one has to approve you.'
        : 'SAAHAA Certified is granted automatically when every line is green — no one has to approve you.'}
        ${pr.automation === false ? ' Automatic promotion is paused by SAAHAA right now.' : ''}
        ${pr.suspended ? ' Your account is paused, so nothing moves until that is lifted.' : ''}</p>
    </div>
    ${kick('Vouches', `<span class="tag tag-neutral">${(p.vouches || []).length}</span>`)}
    ${vouchList(p)}`;
}

/* `t` was the parameter name here too, shadowing the translator for this
   whole function. It is the trust score; it is called that now. */

/* ── the QR every earner gets ───────────────────────────────────
   A pro or a shopkeeper does not have a website, a domain or a way to be
   found. What they do have is a shutter, a visiting card, a WhatsApp status
   and an auto-rickshaw. A code that opens their own page turns any of those
   into a place a customer can book from, and it costs them nothing to print.
   Same builder as the copied link (views/pro.js · profileUrl), so the code and
   the link can never point at different pages. */
function qrCard(id, kind, name) {
  const url = proView.profileUrl(id, kind);
  let code = '';
  try { code = qr.svgFor(url, { size: 156, label: `${name || 'SAAHAA'} on SAAHAA` }); }
  catch (e) { code = ''; }                      /* a broken code shows nothing, never a broken box */
  return `${kick(t('qr.title'))}
    <div class="m-sec" style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      ${code ? `<div style="flex:none;background:#fff;padding:8px;border-radius:12px;line-height:0">${code}</div>` : ''}
      <div style="flex:1;min-width:190px">
        <p class="tiny" style="margin:0 0 8px">${esc(t('qr.blurb'))}</p>
        <p class="micro muted" style="word-break:break-all;margin:0 0 10px">${esc(url)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn--sm" data-act="pro.share" data-id="${esc(id)}" data-kind="${esc(kind)}">${esc(t('qr.share'))}</button>
          <button class="btn btn--ghost btn--sm" data-act="pro.qr.save" data-id="${esc(id)}" data-kind="${esc(kind)}" data-name="${esc(name || '')}">${esc(t('qr.save'))}</button>
        </div>
      </div>
    </div>`;
}

function proPage(p, ts, a, cat) {
  const nextTier = TIERS[Math.min(4, (p.tier | 0) + 1)];
  const r = readiness(p);
  return `<div class="con2">
    <div>
      ${qrCard(p.id, 'pro', p.name)}
      <!-- THE PICKER LIVED ONLY ON THE CUSTOMER ACCOUNT SCREEN, so a Telugu-only
           plumber could not reach it from anywhere on his side of the app. This
           is his own page; it is where he would look. -->
      ${langPicker()}
      ${kick('Rating and trust', `<span class="tag tag-accent">${esc(ts.band.label)}</span>`)}
      <div class="capsules" style="grid-template-columns:repeat(2,1fr)">
        ${capsule('Rating', avgLabel(a), a == null ? '<span class="meta">no ratings yet</span>' : ratingStars(a), 'gold')}
        ${capsule('Jobs done', String(p.completed), '', 'soft')}
        ${capsule('Trust', `${ts.score}<span class="meta">/100</span>`, esc(ts.band.label), 'info')}
        ${capsule('Your rate', M.fmt(p.ask), 'you keep 100%', 'ok')}
      </div>
      <!-- HE COULD NOT CHANGE HIS OWN PRICE. EVER. This capsule was read-only
           and no control anywhere in the console edited it, so a rate typed once
           during signup was permanent -- for a trade whose material costs move
           every month. An audit called it disqualifying on its own, and it sits
           under a heading that tells him he keeps 100% of a number he cannot
           set. It is his price; he sets it. -->
      <button class="btn btn--ghost btn--block btn--sm" style="margin-top:8px"
        data-act="pro.rate" data-id="${esc(p.id)}">${esc(t('pro.changeRate'))}</button>
      <p class="micro muted" style="margin-top:8px">You keep <b>100%</b> of your rate. A ${Math.round(AGG_COMMISSION * 100)}%-commission app would pay you about ${M.fmt(Math.round(p.ask * (1 - AGG_COMMISSION)))} for the same job.</p>

      ${kick('Your public page')}
      <button class="lrow lrow--c" data-act="pro.open" data-id="${p.id}">
        <span class="avatar">${esc(p.name[0])}</span>
        <div class="grow" style="min-width:0">
          <div class="lrow__t">${esc(p.name)}</div>
          <div class="lrow__m">${esc(catName(cat))} · ${esc(p.area)} · ratings, badges and reviews kept current by SAAHAA</div>
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
  const ts = trustScore(p);   /* NOT `t` — that is the translator, imported at the top of this file. Shadowing it made every t('earn.…') on this screen throw "t is not a function" and painted the error page instead of the console. */
  const orders = myOrders();
  const inbox = orders.filter(o => ACTIVE.includes(o.stage));
  // by SETTLEMENT, never by stage: a rated job moves on to CLOSED, and
  // filtering on SETTLED made a pro's lifetime earnings snap to Rs.0 the
  // moment a customer said thank you
  const paid = orders.filter(o => o.settledAt && (o.workerPayout || 0) > 0);
  const earned = paid.reduce((n, o) => n + (o.workerPayout || 0), 0);
  /* THIS COUNTED THE OWNER'S MANUAL FLAG, NOT WHAT LEFT. A pro who had actually
     withdrawn ₹468 still read "Sent to UPI ₹0", and an order the owner ticked
     read as landed when nothing was sent — so the panel's own promise that "a
     job only moves left to right, it never counts twice" was false in both
     directions. The ledger knows what left; ask it. */
  const paidOut = W.walletOf(getState().ledger, p.id, p).withdrawn | 0;
  const held = orders.filter(o => o.stage === 'WORK_DONE').reduce((n, o) => n + o.deal, 0);
  const a = avg(p);
  const open = auction.openRequestsForPartner(p);
  /* and the ones he has already answered, which the list above drops by design */
  const sent = auction.sentQuotesFor(p);
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
    : proTab === 'page'     ? proPage(p, ts, a, cat)
    :                         proLeads(p, open, gate, sent);

  return `${consoleCSS}
  <header class="apphdr on-plum con__hdr">
    <div class="grow" style="min-width:0">
      <span class="brandline">SAAHAA · PRO</span>
      <b class="name">${esc(p.name)}</b>
      ${proCode ? `<span class="con__id"><span class="meta">Pro ID</span><b>${esc(proCode)}</b></span>` : ''}
      <span class="sub">${offline ? 'Not accepting jobs · requests will not reach this phone'
        : ready ? `Accepting jobs · ${auction.waveRadiusKm(0)}–${auction.waveRadiusKm(2)} km radius · ${esc(p.area)}`
        : `${esc(catName(cat))} · verification pending`}</span>
    </div>
    ${ready ? `<button class="sw" type="button" data-act="partner.online" aria-pressed="${offline ? 'false' : 'true'}"
        aria-label="${offline ? 'Go online' : 'Go offline'}"><span>${offline ? 'Offline' : 'Online'}</span><span class="sw__k"></span></button>`
      : '<span class="tag tag-outline" style="flex:none">Verify to go online</span>'}
  </header>
  <main class="wrap workspace con" style="padding-top:0">
    <div class="stat3 bleed">
      ${capsule(t('earn.newLeads'), String(open.length), '', '')}
      ${capsule(t('earn.todaysJobs'), String(inbox.length), '', '')}
      ${winRate == null ? capsule(t('earn.rating'), avgLabel(a), a == null ? `<span class="meta">${esc(t('earn.notRated'))}</span>` : '', '') : capsule(t('earn.winRate'), `<span class="em">${winRate}%</span>`, '', '')}
    </div>
    <div class="utabs bleed" role="tablist" aria-label="Pro console">
      ${PRO_TABS().map(([k, l]) => `<button type="button" role="tab" aria-selected="${proTab === k ? 'true' : 'false'}"
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

/* a function, not a constant: the labels are the shop owner's language and are
   read at render time, exactly like the pro's tab strip above */
const SHOP_TABS_OF = () => [
  ['today',     t('shop.today')],
  ['orders',    t('shop.orders')],
  ['catalog',   t('shop.products')],
  ['stock',     t('shop.inventory')],
  ['pricing',   t('shop.pricing')],
  ['money',     t('shop.sales')],
  ['customers', t('shop.customers')],
  ['payouts',   t('shop.payouts')],
  ['analytics', t('shop.analytics')],
  ['setup',     t('shop.profile')],
];
/* the strip a kirana owner actually taps — it sat above the translated one and
   stayed English, so the console read TODAY / ITEMS / ORDERS / MONEY over a
   body that was in his language */
const SHOP_GROUPS_OF = () => [
  ['today',  t('shop.today'),     ['today', 'analytics', 'setup']],
  ['items',  t('shop.items'),     ['catalog', 'stock', 'pricing']],
  ['orders', t('shop.orders'),    ['orders', 'customers']],
  /* MONEY LANDED ON "SALES" AND THE WITHDRAW CONTROL SAT ONE TAB OVER. An
     audit ran a shop to ₹1,065 of settled takings and reported that the money
     had no exit at all -- the balance, the UPI field and the Take out button
     are all real, and all on the tab he never reached. When a kirana owner taps
     MONEY the question is "where is mine and how do I get it", not "how did the
     month go". Payouts leads; Sales is the analytics beside it. */
  ['money',  t('shop.money'),     ['payouts', 'money']],
];
const labelOf = k => (SHOP_TABS_OF().find(r => r[0] === k) || [k, k])[1];
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
  const group = SHOP_GROUPS_OF().find(g => g[2].includes(shopTab)) || SHOP_GROUPS_OF()[0];
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
    /* A SHOPKEEPER EARNS HERE TOO, so she gets the same code. Her page is
       #/shop/<id>; everything else about the card is identical. */
    :                           qrCard(s.id, 'shop', s.name) + shopToday(s, orders, items, cat);

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
      ${SHOP_GROUPS_OF().map(([k, l, keys]) => `<button type="button" role="tab" aria-selected="${group[0] === k ? 'true' : 'false'}"
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
  /* "SALES TODAY ₹1,371 · 2 orders" ON A DAY THE SHOP TOOK ₹855. One of the two
     had been returned in full and refunded from escrow -- the shop was never
     paid for it and its own ledger correctly shows nothing -- yet the dashboard
     headline still counted it as a sale. `R_CANCELLED` was excluded here and the
     RETURN stages were not, which is the same distinction the money screens
     below already make. A sale that came back is not a sale. */
  /* AND THEN PARTIAL RETURNS ARRIVED AND IT EXCLUDED THE WHOLE ORDER. Accepting
     a return of one item stamps `refundedAt`, so a basket that came back by ₹340
     and settled ₹426 into the shop's till vanished from the headline entirely:
     "SALES TODAY ₹0 · 0 orders" on a day the same console's Sales tab said
     ₹426. A sale that came back in full is not a sale; one that came back in
     part is still a sale for the part that stayed. */
  const RETURNED = ['R_CANCELLED', 'R_REFUNDED', 'R_CLOSED'];
  /* AND THE FIX FOR THAT SUBTRACTED THE RETURN TWICE. `acceptReturn` rewrites
     `itemsTotal` to a fresh quote over the lines that STAYED, and also records
     `returnedValue`; taking one from the other removed the returned goods
     again. Today read ₹70 where the shop had sold ₹98 and both money screens
     said ₹98. What stayed is what the order now says it is. */
  /* AND `itemsTotal` IS THE WEIGHED VALUE, NOT WHAT SHE PAID. On an over-weighed
     basket those differ, so TODAY read ₹322 for goods the customer paid ₹230
     for -- a third figure, in one console, beside MONEY's gross ₹1,110 and
     SALES's net ₹230. What a shopkeeper judges his day on is what customers
     actually paid him for goods: the total, less the delivery that is not his
     margin. It agrees with SALES by construction now. */
  const keptOf = o => Math.max(0, (o.customerPays | 0) - (o.deliveryFee | 0));
  const today = orders.filter(o => isToday(o.createdAt)
    && !(RETURNED.includes(o.stage) && (o.refundedAt || o.cancelledAt) && keptOf(o) <= 0));
  const sales = today.reduce((n, o) => n + keptOf(o), 0);
  const fees = today.reduce((n, o) => n + (o.platformFee || 0), 0);
  const dispatchToday = today.reduce((n, o) => n + (o.dispatchCut || 0), 0);
  const needing = orders.filter(LIVE_RETAIL);
  const out = items.filter(p => p.trackStock && p.stockQty <= 0);
  const low = items.filter(p => p.trackStock && p.stockQty > 0 && p.stockQty <= p.lowStockAt);
  const fresh = !items.length && !orders.length;
  return `
    <div class="stat3 stat2 bleed">
      ${capsule(t('shop.salesToday'), M.fmt(sales), `${today.length} order${today.length === 1 ? '' : 's'}`)}
      ${(() => { const left = flow.freeOrdersLeft(s);
        return left
          /* AND THE FREE-ORDERS BRANCH HARDCODED ₹0 while the ₹5 dispatch cut was
             still being taken — Sales and Payouts both showed it, and the tile a
             shopkeeper judges his day on said SAAHAA had taken nothing. Free
             means no percentage and no minimum; it has never meant no dispatch. */
          ? capsule(t('shop.feesToday'), M.fmt(dispatchToday),
              dispatchToday ? esc(t('shop.freeButDispatch', { n: left })) : `${left} free order${left === 1 ? '' : 's'} left`, 'ok')
          /* "FEES TODAY (3%) ₹6" omitted the ₹5 dispatch cut, so the shop's own
             summary understated SAAHAA's take by the same amount the Sales tab
             had already been corrected for. One number, everywhere. */
          /* "FEES TODAY ₹30" under "capped ₹25 an order" — self-contradicting on
             its own line, because the figure merged the fee with the ₹5 dispatch
             and kept the fee-only caption. On any capped rider order it breaches
             by construction, and it disagreed with the same order's detail panel
             saying ₹25. The caption names both, or it names neither. */
          : capsule(t('shop.feesToday'), M.fmt(fees + dispatchToday),
              `${esc(t('shop.feePlusDispatch', { cap: M.fmt(cat.takeCapPaise), dispatch: M.fmt(RIDER_DISPATCH_CUT) }))}`); })()}
    </div>

    ${fresh ? liveBlock(s) : ''}

    <div class="con2">
      <div>
        ${kick(t('shop.needsYou'), needing.length ? `<span class="tag tag-accent">${needing.length} open</span>` : '')}
        ${needing.length ? needing.map(orderRow).join('')
          : empty(t('shop.nothingWaiting'), s.isOpen ? t('shop.newOrdersHere') : t('shop.openToReceive'))}
      </div>
      <div>
        ${kick(t('shop.wantsAttention'), out.length || low.length ? `<span class="tag tag-neutral">${out.length + low.length}</span>` : '')}
        ${out.length || low.length ? out.map(p => attentionRow(p, true)).concat(low.map(p => attentionRow(p, false))).join('')
          : empty('Stock looks fine', items.length ? 'Nothing is low or out.' : 'Add your first items from the ready list.')}
        ${!fresh ? `<div class="pickbox">
          <span class="eyebrow" style="display:block;margin-bottom:8px">Add without typing</span>
          <button class="btn btn-secondary btn-block" style="justify-content:flex-start" data-act="cat.picker">${icon('plus', { size: 16 })} ${esc(t('shop.readyList'))}</button>
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
  /* the same omission on the row he taps to accept: two numbers for one
     order, one tap apart */
  const yours = (o.shopPayout | 0) + (flags.isOn('RIDER_POOL') ? 0 : (o.riderPayout | 0));
  const fee = o.platformFee | 0;
  return `<div class="lrow lrow--c">
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(o.customerName)} · ${yours ? `${M.fmt(yours)} to you` : M.fmt(o.customerPays)}</div>
      <div class="lrow__m">${o.lines.length} item${o.lines.length === 1 ? '' : 's'} · ${o.mode === 'pickup' ? 'pickup' : 'delivery'} · ${esc(o.customerArea)}, ${o.km} km · ${placed ? timeAgo(o.createdAt) : esc(st.short)}</div>
      <!-- THREE NUMBERS THAT CONTRADICTED EACH OTHER ON ONE ROW. "Customer pays
           ₹244 · SAAHAA fee ₹7 already taken off" beside "₹232 to you": she does
           the subtraction, gets ₹237, and is shown ₹232. The missing ₹5 is the
           dispatch cut this row never named — and the panel one tap away DOES
           reconcile, so she learns the row lies rather than the panel. The row
           states the basket it comes out of, or it states nothing. -->
      ${yours ? `<div class="lrow__m">${esc(t('shop.basket'))} ${M.fmt(o.itemsTotal)} · ${esc(t('shop.saahaaFee'))} ${M.fmt(fee + (o.dispatchCut | 0))}</div>` : ''}
    </div>
    ${placed ? `<button class="btn btn-primary" style="flex:none" data-act="stage.accept" data-id="${o.id}">Accept</button>` : ''}
    <button class="btn ${placed ? 'btn-ghost' : 'btn-secondary'}" style="flex:none" data-act="order.open" data-id="${o.id}">${placed ? 'Open' : 'Track'}</button>
  </div>`;
}

function attentionRow(p, out) {
  return `<div class="lrow lrow--c">
    <span class="lrow__bar ${out ? 'hot' : ''}"></span>
    <div class="grow" style="min-width:0">
      <div class="lrow__t">${esc(p.name)} — ${out ? esc(t('shop.outOfStock')) : `${p.stockQty} left`}</div>
      <div class="lrow__m">${out ? esc(t('shop.hiddenUntil')) : `${esc(p.aisle)} · ${esc(t('shop.lowLineAt', { n: p.lowStockAt }))}`}</div>
    </div>
    <button class="btn btn-ghost" style="flex:none" data-act="stock.refill" data-id="${p.id}">${esc(t('shop.restock'))}</button>
  </div>`;
}

/* EVERYONE PAYS SAAHAA, SAAHAA PAYS EVERYONE. The shop's balance is the
   ledger account SHOP:<id> — settlements land in it, payouts leave it. Read
   off the book every render, never stored, so it cannot drift. */
/* ONE LEDGER KIND, ONE NAME. `RIDER` was missing here, so the Payouts table
   printed the raw enum "RIDER" four lines of scroll from the Sales tab calling
   the very same entry "Delivery you made". */
/* THE SHOP'S LEDGER WAS AN ENGLISH TABLE ON A TELUGU SCREEN, for the same
   reason the pro's passbook was: the words for the money that moved lived in a
   constant instead of the translator. One family, leg.<KIND>, serves both
   consoles -- they were already sharing this map under two different names. */
const shopLegWord = kind => {
  const k = String(kind || '');
  const got = t('leg.' + k);
  return got === 'leg.' + k
    ? (k || 'Movement').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
    : got;
};
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

/* ₹1,100 OF STOCK WENT OUT, CAME BACK, AND HER BOOK SAID SHE HAD NEVER TRADED.
   A return is refunded out of ESCROW, before settlement — so no money ever
   reaches the shop and double-entry has, correctly, nothing to post. The book
   was therefore empty, under the words "No entry on the book yet", after a real
   order had been packed, delivered and returned.

   The accounting is right and the screen is still wrong. Inventing a ledger leg
   to fill the gap would be far worse: it would put money in a book that says it
   can be verified and never edited. So these are shown as what they are —
   events on her order history that moved no money, marked ₹0 and visually
   distinct from a real movement, so the book records that something happened.

   `returnedRows` is not part of the balance and is never summed into it. */
const RETURNED_STAGES = ['R_REFUNDED', 'R_CLOSED', 'R_CANCELLED'];
const returnedRows = s => (getState().orders || [])
  .filter(o => o.kind === 'retail' && o.shopId === s.id
    && RETURNED_STAGES.includes(o.stage) && (o.refund | 0) > 0)
  .map(o => ({ o, ts: o.refundedAt || o.cancelledAt || o.closedAt || o.createdAt || 0 }))
  .sort((a, b) => b.ts - a.ts);
function shopWalletLine(s) {
  const bal = balanceOf(getState().ledger, acct.shop(s.id));
  const legs = shopLegs(s).slice(0, 5);
  return `${kick(t('shop.wallet'), money('available', 'yours after settlement'))}
    <div class="between" style="gap:8px;padding-bottom:8px;border-bottom:1px solid var(--color-divider)">
      <b class="num" style="font-size:24px">${M.fmt(Math.max(0, bal))}</b>
      <span class="micro muted" style="text-align:right">${esc(gateway.label())}</span>
    </div>
    ${legs.length ? legs.map(({ e, d }) => `<div class="feeline">
        <span class="muted" style="min-width:0">${esc(shopLegWord(e.kind))} · ${timeAgo(e.ts)}</span>
        <b class="num" style="flex:0 0 auto;color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt2(Math.abs(d))}</b></div>`).join('')
      : '<p class="micro muted" style="margin-top:8px">Nothing has landed yet. Every settled order posts here.</p>'}`;
}

function shopOrders(orders) {
  const live = orders.filter(LIVE_RETAIL);
  if (!live.length) return empty('No orders right now', 'New orders appear here the moment they are placed.');
  return `${kick(t('shop.liveOrders'), `<span class="tag tag-accent">${live.length} open</span>`)}
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
  /* WHAT HIS PICTURES COST, BEFORE HE TAKES THEM. A shopkeeper adding forty
     photographs has no idea whether that is free or ruinous. The catalogue's
     pictures are shared with every other shop in the city and cost him nothing;
     only one he photographs himself is new bytes. See core/imgstore.js. */
  const picCost = IMG.rosterCost(items);
  const aisles = [...new Set(shown.map(p => p.aisle))];
  return `
  ${items.length ? `
    <p class="micro muted" style="margin:0 0 10px">${esc(t('shop.picCost', {
      items: picCost.listings, pics: picCost.distinct,
      saved: Math.max(1, Math.round(picCost.savedBytes / 1024 / 1024)) }))}</p>
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
  sheet(t('shop.readyList'), pickerBody(s), { noFocus: true });
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
      ${capsule(t('shop.fillRate'), `${s.fillRate}<span class="meta">%</span>`, 'stay above 85% for the “Reliable stock” badge')}
      ${capsule('Items buyable now', `${items.filter(p => p.active !== false && (!p.trackStock || p.stockQty > 0)).length}<span class="meta">/${items.length}</span>`, '')}
    </div>
    ${block('Out of stock (hidden from buyers)', out, true)}
    ${block('Running low', low, false)}
    ${block('Ageing perishables', exp, false)}`;
}

/* MONEY: settled to you, the fee lines, what an aggregator would have taken */
const acctShop = id => 'SHOP:' + id;

/* What a ledger `kind` is called on a shop's own statement. A person reading
   their money should see the event, not our enum. */
/* the Sales tab used its own copy of this and the two drifted apart at once —
   there is one table, and both tables are it */

function shopMoney(s, orders) {
  const done = orders.filter(o => o.settledAt && o.shopPayout);   // by settlement, not by stage
  const now = new Date();
  const month = done.filter(o => ymOf(o.settledAt) === now.getFullYear() * 12 + now.getMonth());
  const sum = (list, f) => list.reduce((n, o) => n + (o[f] || 0), 0);
  /* THIS PANEL PRINTED "₹193 − ₹0 − ₹9 = ₹193" DIRECTLY BENEATH A COMMENT OF
     MINE SAYING THAT GROSS MINUS DEDUCTIONS DISAGREEING WITH NET IS THE ONE
     THING A MONEY SCREEN MUST NEVER DO. It summed order FIELDS and subtracted
     lines that had never come out of the shop's share: on an ordinary rider
     order the CUSTOMER pays the delivery, so the rider line was displayed as a
     deduction and not applied.

     A statement that reconciles by construction cannot drift. `net` is what the
     ledger actually paid this shop; every deduction shown is one that genuinely
     left its share, and the arithmetic on screen is the arithmetic that
     happened. */
  /* AND IT STILL DID NOT RECONCILE, BECAUSE THE FILTER MATCHED NOTHING.
     `e.type`, `e.partyA`, `e.partyB`, `e.amountPaise` — an entry has never had
     any of those fields; it is `{ kind, legs, meta }`. So `paidToShop` was
     always 0, `net` fell through to summing an order field, and this panel told
     a shop it had earned ₹556 eight centimetres from its own wallet reading
     ₹570. The comment above promised a statement that "cannot drift". It had
     drifted before it was ever read.

     Every figure below now comes from `domain/ledger.js creditsByKind` — the
     one reader — and the deliveries this shop drove itself are a CREDIT, which
     is what they are. They were being shown as a deduction and never applied. */
  const shopLegs = L.legsFor(getState().ledger || [], acctShop(s.id));
  /* AND MY OWN VERSION OF THE COLUMN STILL DID NOT ADD UP. I made "deliveries
     you made yourself" a CREDIT line — which it is — and left it inside `net`
     as well, so the screen printed ₹220 − ₹6 + ₹14 − ₹5 over a total of ₹209.
     The same defect the customer's bill had, on the other side of the product,
     introduced while fixing it.

     One number is measured and one is derived, and never both. `yours` is what
     the ledger paid this shop — the only figure here that is a fact. `gross` is
     what customers actually paid, which is a real, nameable total rather than a
     sum of components. Everything between them is a deduction, and the
     deductions are DEFINED as the difference, so the column cannot disagree
     with itself however the engine changes underneath. */
  /* AND THE TWO SIDES COUNTED DIFFERENT ORDERS. `yours` summed every
     SHOP_PAYOUT and RIDER credit in the book, all time; `gross` summed
     `customerPays` over `done` -- settled orders carrying a payout. Whenever
     the ledger held a credit for an order `done` excludes, the deductions came
     out NEGATIVE, `Math.max(0, ...)` swallowed the excess, and the column
     quietly stopped summing to its own total. `roundParts` caught it in a live
     browser -- "parts sum to 53109 but were given a total of 53767" -- ₹6.58
     off, on the shop's money screen, in production falling back silently.

     This is the same defect as the pro's "YOU KEPT ₹752 from ₹540 quoted"
     header fixed above: a ratio, or a difference, between two populations that
     are not the same set. `yours` is still read off the ledger, because it is
     the one measured figure here -- but only for the orders this column is
     about. */
  const doneIds = new Set(done.map(o => o.id));
  const inThisColumn = r => doneIds.has(r.meta && r.meta.orderId);
  /* the "includes ₹x you delivered yourself" note sits under this same column,
     so it counts the same orders -- an all-time figure there reintroduces the
     mismatch one line below the fix for it */
  const riderHere = shopLegs.filter(r => r.delta > 0 && r.kind === 'RIDER' && inThisColumn(r))
                            .reduce((n, r) => n + r.delta, 0);
  const yours = shopLegs
    .filter(r => r.delta > 0 && (r.kind === 'SHOP_PAYOUT' || r.kind === 'RIDER')
              && doneIds.has(r.meta && r.meta.orderId))
    .reduce((n, r) => n + r.delta, 0);
  const gross = sum(done, 'customerPays');
  const feeRaw = sum(done, 'platformFee');
  /* SAAHAA's ₹5 a rider order. `const dispatch = 0` meant it appeared on no
     screen at all, so a shop reading "3% of the basket" funded 4.1%. */
  const dispatchRaw = sum(done, 'dispatchCut');
  /* what it gave up so she saw "free delivery" — whatever is left of the gap */
  const absorbedRaw = Math.max(0, gross - yours - feeRaw - dispatchRaw);
  /* rounded together, so the printed lines sum to the printed total — the
     identical fix core/money.js made for her bill */
  /* AND ROUNDING THE TOTAL WITH THE LINES PUT IT A RUPEE OFF THE LEDGER. The
     column read "₹235 − ₹6 − ₹5 = ₹224" two inches above a wallet reading ₹223,
     because `yours` — the one figure here that is a MEASUREMENT — was rounded
     to make the arithmetic work. A screen may round what it derives; it may
     never round away what it measured. The deductions absorb the drift. */
  const rYours = Math.round(yours / 100) * 100;
  const [rFee, rDispatch, rAbsorbed] =
    M.roundParts([feeRaw, dispatchRaw, absorbedRaw], Math.round(gross / 100) * 100 - rYours);
  const net = yours;
  const fee = rFee, dispatch = rDispatch, absorbed = rAbsorbed;
  /* THE LAST PASS FIXED THE LINE UNDER THE HEADLINE AND LEFT THE HEADLINE.
     One scroll showed "SETTLED TO YOU ₹442", then "Yours ₹456", then "SHOP
     WALLET ₹456" — three figures for one sum of money, because this one still
     summed an order field. It comes off the ledger, inside the month. */
  const inMonth = ts => ymOf(ts) === now.getFullYear() * 12 + now.getMonth();
  const mNet = shopLegs.filter(r => r.delta > 0 && inMonth(r.ts)
                              && (r.kind === 'SHOP_PAYOUT' || r.kind === 'RIDER'))
                       .reduce((n, r) => n + r.delta, 0);
  const mGrossPaid = sum(month, 'customerPays');
  const cat = get('category', s.catId);
  const agg = Math.round(gross * AGG_COMMISSION);
  /* the aggregator sentence's numbers, worked out here rather than inside the
     markup. All four come from `gross` and the same fee -- and `yours` is already
     restricted to `doneIds` -- so they describe one population.
     The key is `youKept`, not `kept`, because `const kept` exists in another
     function in this file and the money-column gate is file-scoped: an object
     key of that name reads to it as a ledger total set against an order-list
     total. Renaming the key is the fix; loosening the gate is not. */
  const aggWords = { pct: Math.round(AGG_COMMISSION * 100), gross: M.fmt(gross),
    took: M.fmt(rFee + rDispatch), youKept: M.fmt(Math.max(0, agg - rFee - rDispatch)) };
  return `
    <!-- the shop side needs it too: a shopkeeper never visits the
         customer account screen where this used to be the only copy -->
    ${langPicker({ tight: true })}
    <div style="padding:14px 0;border-bottom:2px solid var(--color-divider)">
      <span class="eyebrow">${monthName(now, true)} · ${esc(t('shop.settledToYou'))}</span>
      <div class="big">${M.fmt(mNet)}</div>
      <!-- "₹328 settled on ₹324 of orders this month" — he was told he was paid
           more than his orders were worth, because mGross summed itemsTotal
           and gross summed customerPays. One basis, named. -->
      <p class="tiny muted">on ${M.fmt(mGrossPaid)} customers paid this month · ${M.fmt(net)} on ${M.fmt(gross)} all time</p>
    </div>
    <div class="con2">
      <div>
        <div class="feeline"><span>${esc(t('shop.whatCustomersPaid', { n: done.length }))}</span><b class="num">${M.fmt(gross)}</b></div>
        <!-- SIX SCREENS TOLD A SHOP IT PAID 3% WHILE IT PAID NOTHING. The free
             thirty is the best thing on offer to a kirana and only one screen
             counted it down. -->
        <div class="feeline"><span>${esc(t('shop.saahaaFee'))} · ${flow.freeOrdersLeft(s)
          ? `free for your next ${flow.freeOrdersLeft(s)} order${flow.freeOrdersLeft(s) === 1 ? '' : 's'}`
          : `${cat.takePct}%, ${esc(t('shop.floorAndCap', { floor: M.fmt(getPricing().retailFeeFloorPaise), cap: M.fmt(cat.takeCapPaise) }))}`}</span><b class="num">− ${M.fmt(fee)}</b></div>
        ${dispatch ? `<div class="feeline"><span>${esc(t('shop.dispatch', { amount: M.fmt(RIDER_DISPATCH_CUT) }))}</span><b class="num">− ${M.fmt(dispatch)}</b></div>` : ''}
        ${absorbed ? `<div class="feeline"><span>${esc(t('shop.freeDelivery'))}</span><b class="num">− ${M.fmt(absorbed)}</b></div>` : ''}
        <div class="feeline"><span>${esc(t('shop.listingFee'))}</span><b class="num">₹0</b></div>
        <div class="feeline"><span>${esc(t('shop.yearlyPlan'))}</span><b class="num">₹0</b></div>
        <div class="feeline" style="border-bottom:2px solid var(--color-divider);font:800 15px var(--font-heading)"><span>${esc(t('shop.yours'))}</span><span class="num good">${M.fmt(rYours)}</span></div>
        ${riderHere ? `<p class="micro muted" style="padding:4px 0 0">${esc(t('shop.includesRider', { amount: M.fmt(riderHere) }))}</p>` : ''}
        <div class="aggblock">
          <!-- THE BLOCK THE AUDIT CALLED "the sentence that matters most", at 31%
               translated: a Telugu shopkeeper read Telugu column headings over an
               English explanation of what SAAHAA charges him and why. -->
          <span class="brandline" style="opacity:.85">${esc(t('shop.aggWouldTake'))}</span>
          <div style="font:800 30px/1 var(--font-heading);margin:8px 0 6px;font-variant-numeric:tabular-nums">${M.fmt(agg)}</div>
          <p style="font-size:12px;opacity:.92">${esc(t('shop.aggAt', aggWords))}</p>
        </div>
        <p class="micro muted">${flow.freeOrdersLeft(s)
          ? esc(t('shop.firstFree', { n: flow.FREE_FIRST_ORDERS })) + ' '
          : ''}${esc(t('shop.whyThisPct', { pct: cat.takePct }))}</p>
      </div>
      <div>
        ${shopWalletLine(s)}
        ${kick(t('shop.settledOrders'))}
        <!-- the ledger's own legs, not the order's copy of them: a row here and
             the wallet beside it can no longer say different numbers -->
        ${shopLegs.length ? shopLegs.slice(0, 12).map(r => `<div class="feeline"><span class="muted">${esc(shopLegWord(r.kind))} · ${timeAgo(r.ts)}</span><b class="num${r.delta > 0 ? ' good' : ''}">${r.delta > 0 ? '+ ' : '− '}${M.fmt2(Math.abs(r.delta))}</b></div>`).join('')
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
      ${capsule(t('shop.cameBack'), String(repeat), 'ordered more than once')}
      ${capsule(t('shop.ordersCap'), String(orders.length), '')}
    </div>
    ${kick(t('shop.whoBuys'))}
    ${list.map(c => `<div class="lrow lrow--c">
        <span class="avatar avatar--sm">${esc(c.name[0])}</span>
        <div class="grow" style="min-width:0"><div class="lrow__t">${esc(catName(c))}</div>
          <div class="lrow__m">${esc(c.area)}${c.last ? ` · last ${timeAgo(c.last)}` : ''}</div></div>
        <span class="tag ${c.n > 1 ? 'tag-accent' : 'tag-neutral'}">${c.n} ${c.n === 1 ? 'order' : 'orders'}</span>
      </div>`).join('')}
    <p class="micro muted" style="padding:10px 0">Read only. SAAHAA never hands you a customer's number — the chat inside each order is the way to reach them.</p>`;
}

/* paidOut vs pending, from the fields the payout run already writes, and the
   payouts table straight off the ledger */
function shopPayouts(s, orders) {
  const settled = orders.filter(o => o.settledAt && o.shopPayout);
  const waiting = settled.filter(o => !o.paidOut);
  const inEscrow = orders.filter(LIVE_RETAIL);
  /* THE LIST DID NOT SUM TO ITS OWN HEADING. Each row counted `shopPayout`
     and dropped the RIDER leg the shop earns for driving the order itself, so
     ₹209 of rows sat under a heading of ₹223. What the shop is owed for an
     order is every leg of it. */
  const ownDelivery = o => flags.isOn('RIDER_POOL') ? 0 : (o.riderPayout || 0);
  const sum = list => list.reduce((n, o) => n + (o.shopPayout || 0) + ownDelivery(o), 0);
  const legs = shopLegs(s);
  /* `shopLegs` here is the module-level helper, which yields { e, d } -- NOT
     the { kind, delta } rows `L.legsFor` gives elsewhere in this file. Two
     shapes, one name, four hundred lines apart: reading the wrong one matches
     nothing and reports a confident zero, which is the bug being fixed. */
  const outLegs = legs.filter(({ e, d }) => d < 0 && String(e.kind) === 'WITHDRAW');
  const back = returnedRows(s);
  const sentOut = outLegs.reduce((n, { d }) => n - d, 0);
  const sentCount = outLegs.length;
  const day = ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `
    <div class="stat3 bleed">
      <!-- "SENT TO BANK ₹0 · 0 paid" AND "No payout has cleared yet" sat two
           inches above a ledger line reading "Sent to your UPI −₹300". This
           counted ORDERS carrying a paidOut flag; a withdrawal is not an
           order, and a PARTIAL one cannot mark a whole order paid at all. What
           has been sent to a bank is what the ledger sent to a bank. -->
      ${capsule(t('shop.sentToBank'), M.fmt(sentOut), esc(t('shop.nPaid', { n: sentCount })), 'ok')}
      <!-- "AWAITING PAYOUT ₹442" SAT DIRECTLY ABOVE "YOURS TO TAKE OUT ₹456"
           WITH A LIVE BUTTON FOR ₹456. Both describe the same money; only one
           of them was the ledger's. What is awaiting payout is what the wallet
           holds and has not been sent — nothing else can be true. -->
      ${capsule(t('shop.awaitingPayout'), M.fmt(flow.shopWallet(s.id).balance), `${waiting.length} ${esc(t('shop.settledWord'))}`, 'warn')}
      ${capsule(t('shop.inEscrow'), M.fmt(sum(inEscrow)), esc(t('shop.nLive', { n: inEscrow.length })), 'info')}
    </div>
    <p class="micro muted" style="padding:10px 0">These three never add up into one number. Escrow becomes awaiting the moment an order settles; awaiting becomes sent when you take it out.</p>

    <!-- UNTIL 8.6.0 THIS SHOP'S MONEY HAD NO EXIT. Signup never asked for a UPI
         id and there was no withdraw control anywhere, so settled takings sat
         in SHOP:<id> for ever with no account to send them to. -->
    ${(() => {
      const w = flow.shopWallet(s.id);
      return `<div class="con2" style="padding:12px 0;border-top:2px solid var(--color-divider)">
        <div>
          <span class="eyebrow">${esc(t('shop.yoursToTake'))}</span>
          <div class="big">${M.fmt(w.balance)}</div>
          <p class="micro muted" style="margin-top:4px">${s.upi
            ? `Goes to <b>${esc(s.upi)}</b> · ${esc(gateway.label())}`
            : esc(t('shop.addUpiFirst'))}</p>
        </div>
        <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" data-act="shop.upi" data-id="${esc(s.id)}">${s.upi ? 'Change UPI id' : 'Add UPI id'}</button>
          <button class="btn btn-primary" data-act="shop.withdraw" data-id="${esc(s.id)}" data-amt="${w.balance}"
            ${(!s.upi || w.balance < flow.MIN_WITHDRAW) ? 'disabled' : ''}>${esc(t('shop.takeOut', { amount: M.fmtMax(w.balance) }))}</button>
        </div>
      </div>
      ${w.balance && w.balance < flow.MIN_WITHDRAW ? `<p class="micro muted">The smallest withdrawal is ${M.fmt(flow.MIN_WITHDRAW)}.</p>` : ''}`;
    })()}
    <div class="con2">
      <div>
        ${kick(t('shop.book'))}
        ${shopPassbook(s)}
        <p class="micro muted" style="margin-top:6px">${esc(t('shop.bookNote'))}</p>
        ${kick(t('shop.payouts'), `<span class="tag tag-neutral">${legs.length}</span>`)}
        ${(legs.length || back.length) ? `<div class="tablewrap"><table class="table"><thead><tr><th>${esc(t('shop.colDate'))}</th><th>${esc(t('shop.colWhat'))}</th><th class="num">${esc(t('shop.colAmount'))}</th></tr></thead><tbody>
          ${legs.slice(0, 20).map(({ e, d }) => `<tr><td>${day(e.ts)}</td><td>${esc(shopLegWord(e.kind))}</td><td class="num" style="color:${d < 0 ? 'var(--ink-2)' : 'var(--success)'}">${d < 0 ? '−' : '+'}${M.fmt2(Math.abs(d))}</td></tr>`).join('')}
          ${back.slice(0, 10).map(({ o, ts }) => `<tr><td>${day(ts)}</td><td class="muted">${esc(t('shop.orderReturned', { amount: M.fmt(o.refund | 0) }))}</td><td class="num muted">${M.fmt(0)}</td></tr>`).join('')}
          </tbody></table></div>
          ${back.length ? `<p class="micro muted" style="margin-top:6px">${esc(t('shop.returnedNote'))}</p>` : ''}`
          : `<p class="tiny muted" style="padding:6px 0">${esc(t('shop.noEntryYet'))}</p>`}
      </div>
      <div>
        <!-- AND THE TILE SAID ₹555 WHILE THIS LIST SAID ₹855. The tile is the
             wallet -- what the ledger says is takeable now -- and these rows are
             the settled ORDERS that money came from. After a ₹300 withdrawal the
             two cannot match, because a withdrawal is not an order and cannot be
             subtracted from one. Neither figure was wrong; they were answers to
             different questions printed under one heading. The rows say what they
             are, and the money already taken out is named. -->
        ${kick(t('shop.settledOrders'))}
        ${sentOut ? `<p class="micro muted" style="padding:0 0 6px">${esc(t('shop.alreadyTaken', { amount: M.fmt(sentOut) }))}</p>` : ''}
        <!-- ₹314 of rows under a ₹328 heading: each row counted shopPayout and
             dropped the delivery leg the shop earns for driving the order, which
             the capsule above had already been corrected to include. -->
        ${waiting.length ? waiting.slice(0, 20).map(o => `<div class="feeline"><span class="muted">${esc(o.customerName)} · settled ${timeAgo(o.settledAt)}</span><b class="num">${M.fmt((o.shopPayout || 0) + ownDelivery(o))}</b></div>`).join('')
          : `<p class="tiny muted" style="padding:6px 0">${esc(t('shop.nothingWaitingP'))}</p>`}
        ${kick(t('shop.paidOut'))}
        <!-- and this listed ORDERS carrying a paidOut flag, which is why a real
             ₹300 withdrawal showed as "No payout has cleared yet". A payout is
             a withdrawal; it is listed as one. -->
        ${outLegs.length ? outLegs.slice(0, 20).map(({ e, d }) => `<div class="feeline"><span class="muted">${esc(t('shop.sentToUpi'))} · ${timeAgo(e.ts)}</span><b class="num">${M.fmt2(Math.abs(d))}</b></div>`).join('')
          : `<p class="tiny muted" style="padding:6px 0">${esc(t('shop.noPayoutYet'))}</p>`}
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
      ${capsule(t('shop.avgOrder'), M.fmt(avgOrder), 'settled orders')}
    </div>
    <div class="stat3 bleed" style="border-top:0">
      ${capsule(t('shop.buyableNow'), `${listed}<span class="meta">/${items.length}</span>`, '')}
      ${capsule(t('shop.cancelled'), String(cancelled), '')}
      ${capsule(t('shop.minOrder'), M.fmt(s.minOrder), '')}
    </div>
    <p class="micro muted" style="padding:12px 0">Fill rate is the number a buyer feels: how often what they tapped was actually on your shelf. It drives the “Reliable stock” badge and your place in the list.</p>`;
}

function shopSetup(s) {
  const cat = get('category', s.catId);
  const line = (k, v) => `<div class="feeline"><span class="muted">${k}</span>${v}</div>`;
  return `
    ${kick(t('shop.yourShop'))}
    <div class="lrow lrow--c" style="border-bottom:2px solid var(--color-divider);flex-wrap:wrap">
      ${shopThumb(s)}
      <div class="grow" style="min-width:150px"><div class="lrow__t" style="font-size:17px">${esc(s.name)}</div>
        <div class="lrow__m">${esc(catName(cat))} · ${esc(s.area)} · ${esc(s.mobile)}</div>
        ${photoSrc(s.photo) ? '<div class="lrow__m">Tap the photo to take a new one.</div>'
          : `<button type="button" class="addpic tap" data-act="photo.shop" data-id="${s.id}"
               aria-label="Add a photo of your shop front">${icon('camera', { size: 14 })} Add your shop photo</button>`}
      </div>
    </div>
    <p class="micro muted" style="padding:8px 0">One photograph of your shutter or your counter. A customer scrolling a list stops at the shop they recognise from the street.</p>
    <!-- SIGNUP COMMITTED THIS SHOP TO AN OFFER IT NEVER MADE. minOrder ₹149 and
         freeDeliveryAbove ₹499 were written silently at sign-up, and both were
         rendered here as read-only text — so a kirana absorbed the whole rider
         cost on every basket over ₹499 under a rule nobody explained and it
         could not withdraw. They are its own dials now. -->
    ${line('Minimum order', `<input class="input" style="width:110px;text-align:right" type="number" min="0" step="10"
      inputmode="numeric" data-role="shopmin" data-id="${esc(s.id)}" value="${Math.round((s.minOrder || 0) / 100)}">`)}
    ${line('Free delivery above', `<input class="input" style="width:110px;text-align:right" type="number" min="0" step="50"
      inputmode="numeric" data-role="shopfree" data-id="${esc(s.id)}" value="${Math.round((s.freeDeliveryAbove || 0) / 100)}">`)}
    <p class="micro muted" style="padding:6px 0 0">Above that basket size <b>you</b> pay the delivery, out of your
      margin — that is what makes it free for the customer. Set it to 0 to switch the offer off entirely.</p>
    ${line('Prep time', `<b>${s.prepMins} min</b>`)}
    ${line('Delivery radius', `<b>${s.radiusKm} km</b>`)}
    ${line('SAAHAA fee', `<b>${flow.freeOrdersLeft(s)
      ? `₹0 — ${flow.freeOrdersLeft(s)} free order${flow.freeOrdersLeft(s) === 1 ? '' : 's'} left, then ${cat.takePct}%`
      : `${cat.takePct}% · capped ${M.fmt(cat.takeCapPaise)} an order`}</b>`)}
    ${s.fssai ? line('FSSAI', `<b class="tiny">${esc(s.fssai)}</b>`) : ''}
    ${s.drugLicence ? line('Drug licence', `<b class="tiny">${esc(s.drugLicence)}</b>`) : ''}

    ${kick(t('shop.deliveryMode'))}
    <div class="seg seg--block" role="group" aria-label="Delivery mode" style="overflow-x:auto;scrollbar-width:none">
      <!-- "SAAHAA RIDER" WAS AN OPTION WITH NOTHING BEHIND IT. RIDER_POOL is a
           canary and it is OFF: there is no rider, no rider identity and no
           hand-off step. A shop that picked it still drove the order itself,
           still earned the delivery leg, and still typed the customer's code at
           the door -- the setting changed nothing at all. An audit set it,
           placed an order, and listed it among the reasons it would not trust
           the platform. Do not offer what the build cannot do: while the pool
           is off the choice is shown as coming, and cannot be selected. -->
      ${[['self','I deliver'],['rider','SAAHAA rider'],['both','Either'],['pickup_only','Pickup only']]
        .map(([k, l]) => { const soon = (k === 'rider' || k === 'both') && !flags.isOn('RIDER_POOL');
          return `<button class="seg__btn" type="button"
          aria-pressed="${s.deliveryMode === k ? 'true' : 'false'}" ${soon ? 'disabled' : ''}
          data-act="shop.mode" data-mode="${k}">${esc(l)}${soon ? ' ·&nbsp;soon' : ''}</button>`; }).join('')}
    </div>
    <p class="micro muted" style="padding:10px 0">${flags.isOn('RIDER_POOL') ? ''
      : 'SAAHAA riders are not running yet, so for now every delivery is one you make — and you are paid for it. '}Pickup only hides the delivery fee from your customers entirely.</p>

    ${kick(t('shop.storefront'))}
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
/* His rate, and what it means for the two jobs at either end of his own list,
   so the number is not abstract when he changes it. */
export function openRateSheet(partnerId) {
  const p = getState().partners.find(x => x.id === partnerId);
  if (!p) return;
  /* `subs` IS A LIST OF STRINGS, and I wrote this as though it were a list of
     objects: `span[0].name` and `.x` were both undefined, so the sheet rendered
     "At this rate, undefined prices at ₹800 and undefined at ₹800" — the same
     figure twice, on the screen where he sets his own price. The multiplier for
     a sub-job lives in `subSize`, which is what every other pricing path uses. */
  const cat = get('category', p.cat);
  const subs = ((cat && cat.subs) || []).map(name => ({ name, x: (subSize(p.cat, name) || {}).x || 1 }));
  const span = [...subs].sort((a, b) => a.x - b.x);
  const at = (x, ask) => M.fmt(Math.round((ask != null ? ask : p.ask) * (x || 1)));
  const spanText = ask => span.length ? t('pro.rateSpan', {
    low: span[0].name, lowAmt: at(span[0].x, ask),
    high: span[span.length - 1].name, highAmt: at(span[span.length - 1].x, ask) }) : '';
  sheet(t('pro.changeRate'), `
    <p class="tiny">${esc(t('pro.rateWhat'))}</p>
    <div class="field" style="margin:14px 0 8px">
      <input id="proAsk" type="number" inputmode="decimal" min="50" step="1"
        value="${(p.ask / 100).toFixed(0)}" placeholder=" ">
      <label>${esc(t('pro.rateLabel'))}</label>
    </div>
    ${span.length ? `<p class="micro muted" id="rateSpan">${esc(spanText())}</p>` : ''}
    <p class="micro muted" style="margin-top:6px">${esc(t('pro.rateKeep'))}</p>
    <button class="btn btn-primary btn--block" style="margin-top:14px"
      data-act="pro.rate.save" data-id="${esc(p.id)}">${esc(t('pro.rateSave'))}</button>
    <button class="btn btn--ghost btn--block btn--sm" style="margin-top:6px" data-act="sheet.close">${esc(t('pay.notNow'))}</button>`);

  /* AND IT SHOWED HIM THE OLD RATE WHILE HE TYPED THE NEW ONE. With ₹900 in the
     box the line still read "Tap & mixer repair prices at ₹420 and Pipeline
     replacement at ₹1,320" — the figures for the ₹600 he was replacing. The
     whole point of the line is to make the number concrete BEFORE he commits,
     and it was answering a question he had already moved on from. The bid
     slider on the other side of the app repaints as he drags; so does this. */
  const box = document.getElementById('proAsk');
  const line = document.getElementById('rateSpan');
  if (box && line) {
    box.addEventListener('input', () => {
      const typed = Math.round(Number(box.value || 0) * 100);
      line.textContent = spanText(typed >= 5000 ? typed : p.ask);
    });
  }
}

export function saveRate(partnerId) {
  const el = document.getElementById('proAsk');
  const paise = Math.round(Number((el && el.value) || 0) * 100);
  /* A RATE OF ZERO IS NOT A DISCOUNT, IT IS A BROKEN LISTING: every job in his
     trade would price at nothing and the 8% on top of nothing is nothing. */
  if (!(paise >= 5000)) { toast(t('pro.rateTooLow'), 'danger'); return; }
  dispatch({ type: 'partner/patch', payload: { id: partnerId, patch: { ask: paise } } });
  closeSheet();
  toast(t('pro.rateSaved', { amount: M.fmt(paise) }));
}

export function priceEdit(productId, rupees) {
  const r = flow.setProductPrice(productId, Math.round(Number(rupees) * 100));
  if (!r.ok && r.reason) toast(r.reason, 'danger');
}
export function stockEdit(productId, qty) {
  dispatch({ type: 'product/stock', payload: { id: productId, qty: Math.max(0, Number(qty) | 0) } });
}
