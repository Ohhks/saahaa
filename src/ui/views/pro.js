/* SAAHAA · ui/views/pro.js — the partner's public storefront.

   "LOCALLY, PROFESSIONALLY." A plumber in Kukatpally with a WhatsApp number
   has no page, no ratings anyone can check, no badge, and no way to be found
   by someone two streets away who does not already know him. This page is
   all of that, generated from his work, maintained by SAAHAA, and his to
   share. He edits three fields. Everything else — rating, jobs done, badges,
   reviews, price, availability — updates by itself as he works.

   It is public: a guest can open it from a shared link and book from it.
   That is the growth loop — every pro sharing a card that says SAAHAA.

   MODERNIST 8.0 — the mockup's SERVICE DETAIL: a photo band, the name, the
   trades · place · distance line, the rating and jobs tags, a row of stat
   blocks from real fields, the RATE CARD, the reviews as rows, and one
   booking bar that never leaves the screen. Every number is the engine's:
   the pro's own rate, and SAAHAA's 8% laid on top for the customer. */

import { esc, ratingStars, timeAgo, sheet, toast } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { trustScore, tier } from '../../domain/trust.js';
import { kmBetween, etaMins } from '../../domain/match.js';
import { myArea, dispatch } from '../../core/ctx.js';
import { myPlace } from './home.js';
import { header } from './shops.js';
import { readiness } from '../../domain/verification.js';
import { canVouch } from '../../domain/autoverify.js';
import { quoteService } from '../../domain/pricing.js';

/* Peer-to-peer verification. A customer whose job with this pro settled, or
   a Background-Checked pro in the same trade, can vouch once. Everyone else
   sees the one-line reason, not a dead button. */
function vouchBlock(p, s) {
  const n = (p.vouches || []).length;
  const c = canVouch(s, p);
  return `<div class="pro__sec">
    <div class="between" style="gap:8px;align-items:baseline"><span class="eyebrow">Vouched for</span><span class="tag tag-neutral">${n} vouch${n === 1 ? '' : 'es'}</span></div>
    <p class="micro muted" style="margin-top:6px">People who have seen the work say so here. It counts toward Background Checked.</p>
    ${c.ok
      ? `<button class="btn btn-secondary btn-block" style="margin-top:10px;justify-content:flex-start" data-act="vouch.give" data-id="${esc(p.id)}">Vouch for ${esc(p.name.split(' ')[0])}</button>`
      : `<p class="micro muted" style="margin-top:6px">${esc(s ? c.reason : 'Sign in to vouch')}</p>`}
  </div>`;
}

const avg = p => { const r = p.ratings || []; return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 0; };

const proCSS = `<style>
  .pro__hdr.apphdr{padding-left:var(--gutter);padding-right:var(--gutter)}
  .pro__hdr .t{font:800 15px/1.2 var(--font-heading);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pro__photo{height:150px;background:var(--color-neutral-300);border-bottom:2px solid var(--color-divider);display:grid;place-items:center;color:var(--color-neutral-700)}
  .pro__photo b{font:800 56px/1 var(--font-heading)}
  .pro__id{padding:12px 0;border-bottom:2px solid var(--color-divider)}
  .pro__name{font:800 22px/1.1 var(--font-heading);letter-spacing:-.01em}
  .pro__line{font-size:12px;color:var(--ink-3);margin:5px 0 9px}
  .pro__stats{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:2px solid var(--color-divider)}
  .pro__stats > div{padding:10px 12px;border-right:1px solid var(--color-divider);min-width:0}
  .pro__stats > div:last-child{border-right:0}
  .pro__stats b{font:800 16px/1.1 var(--font-heading);display:block;font-variant-numeric:tabular-nums;word-break:break-word}
  .pro__stats span{font:600 10px/1.3 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
  .pro__sec{padding:12px 0;border-bottom:2px solid var(--color-divider)}
  .pro__rate{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:6px 0}
  .pro__rv{padding:10px 0;border-bottom:1px solid var(--color-divider)}
  .pro__rv:last-child{border-bottom:0}
  .pro__bar{position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom));display:flex;gap:8px;padding:12px 0;border-top:2px solid var(--color-divider);background:var(--bg);z-index:var(--z-sticky)}
  .pro__bar .btn-primary{flex:1;justify-content:flex-start}
  @media (min-width:768px){ .pro__hdr.apphdr{padding-left:var(--sp-8);padding-right:var(--sp-8)} .pro__bar{bottom:0} .pro__photo{height:200px} }
  @media (min-width:1024px){ .pro__hdr.apphdr{padding-left:var(--sp-10);padding-right:var(--sp-10)}
    .prosplit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sp-9);align-items:start} .prosplit .pro__sec:last-child{border-bottom:2px solid var(--color-divider)} }
</style>`;

export function render(id) {
  const p = getState().partners.find(x => x.id === id);
  if (!p) return `${header('Pro', '')}<main class="wrap"><div class="empty empty--smart"><h3>This page is not live</h3>
    <p>The pro may have left SAAHAA.</p><button class="btn btn--primary" data-act="nav.home">Home</button></div></main>`;
  const cat = get('category', p.cat);
  const t = tier(p.tier);
  const ts = trustScore(p);
  const s = me();
  const mine = !!(s && s.key === p.userKey);
  /* Coordinates on both ends where we have them, names where we do not.
     "4 km from you" printed off a twelve-word table was a guess with a decimal
     point on it; myPlace() and p.loc make it a measurement. */
  const km = kmBetween(myPlace(), p.loc || p.area);
  const reviews = getState().reviews.filter(r => r.partnerId === p.id && !r.hidden).slice(0, 8);
  const a = avg(p);
  const prof = p.profile || {};
  const r = readiness(p);
  const hidden = !r.complete && !mine;
  const q = quoteService(p.ask);
  const first = p.name.split(' ')[0];
  const years = prof.years ? `${prof.years} yr${prof.years == 1 ? '' : 's'}` : p.verifiedAt ? `since ${new Date(p.verifiedAt).getFullYear()}` : 'New';
  const subs = (cat.subs || []).slice(0, 8);

  if (hidden) return `${header(p.name, '')}<main class="wrap"><div class="empty empty--smart"><h3>Not yet verified</h3>
    <p>This pro is completing SAAHAA verification. Check back soon.</p></div></main>`;

  return `${proCSS}
  <header class="apphdr pro__hdr">
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="nav.back" aria-label="Back">${icon('back', { size: 18 })}</button>
    <div class="grow t" style="min-width:0">${esc(p.name)}</div>
    ${mine ? '<button class="btn btn-ghost" data-act="pro.edit">Edit</button>' : ''}
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="pro.share" data-id="${p.id}" aria-label="Share">${icon('share', { size: 18 })}</button>
  </header>
  <div class="pro__photo" aria-hidden="true"><b>${esc(p.name[0])}</b></div>
  <main class="wrap" style="padding-top:0">

    <div class="pro__id">
      <div class="pro__name">${esc(p.name)}</div>
      <div class="pro__line">${esc(prof.tagline || subs.slice(0, 3).join(' · ') || cat.name)} · ${esc(p.area)}, ${km} km</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <span class="tag tag-accent">${a ? `${a.toFixed(1)} ★ ` : ''}${p.completed || 0} jobs</span>
        ${t.badge ? `<span class="tag tag-neutral">${esc(t.badge)}</span>` : ''}
        <span class="tag tag-neutral">${esc(ts.band.label)}</span>
        ${p.online === false ? '<span class="tag tag-outline">Offline now</span>' : '<span class="tag tag-outline">Available</span>'}
      </div>
    </div>

    <div class="pro__stats">
      <div><b>~${etaMins(km)} min</b><span>Response</span></div>
      <div><b>${M.fmt(p.ask)}</b><span>From</span></div>
      <div><b>${esc(years)}</b><span>Trading</span></div>
      <div><b>${ts.score}<span style="font-size:10px">/100</span></b><span>Trust</span></div>
    </div>

    <div class="prosplit">
      <div>
        <div class="pro__sec">
          <span class="eyebrow">Rate card</span>
          <div class="pro__rate" style="margin-top:6px"><span>${esc(cat.name)} · typical job</span><strong>${M.fmt(p.ask)}</strong></div>
          ${subs.map(x => `<div class="pro__rate"><span>${esc(x)}</span><span class="muted">On quote</span></div>`).join('')}
          <div class="pro__rate" style="border-top:1px solid var(--color-divider);margin-top:6px;padding-top:10px"><span>Customer pays on a ${M.fmt(q.deal)} job</span><strong>${M.fmt(q.customerPays)}</strong></div>
          <p class="micro muted" style="margin-top:6px">${esc(first)} sets these prices. SAAHAA adds ${q.markupPct}% on top for the customer — nothing comes out of ${esc(first)}'s price. Price locked before booking, money held until you confirm the work.</p>
        </div>

        <div class="pro__sec">
          <div class="between" style="align-items:baseline"><span class="eyebrow">About</span>${mine ? '<button class="more" data-act="pro.edit">Edit</button>' : ''}</div>
          <div class="grid2" style="margin-top:8px">
            <div><span class="meta">Experience</span><b class="tiny" style="display:block">${prof.years ? esc(String(prof.years)) + ' years' : 'Not stated'}</b></div>
            <div><span class="meta">Languages</span><b class="tiny" style="display:block">${esc(prof.langs || 'Telugu, Hindi')}</b></div>
            <div><span class="meta">Area</span><b class="tiny" style="display:block">${esc(p.area)}</b></div>
            <div><span class="meta">Verified</span><b class="tiny" style="display:block">${p.verifiedAt ? timeAgo(p.verifiedAt) : t.badge ? 'Yes' : 'Pending'}</b></div>
          </div>
          <p class="micro muted" style="margin-top:10px">${(p.ratings || []).length} ratings · ${(p.vouches || []).length} vouch${(p.vouches || []).length === 1 ? '' : 'es'} · ${km} km from you</p>
        </div>

        ${vouchBlock(p, s)}
      </div>

      <div>
        <div class="pro__sec">
          <div class="between" style="align-items:baseline"><span class="eyebrow">Recent reviews</span>${reviews.length ? `<span class="tag tag-neutral">${reviews.length}</span>` : ''}</div>
          ${reviews.length ? reviews.map(rv => `<div class="pro__rv">
              <div style="font-size:12.5px;line-height:1.5">${rv.text ? `“${esc(rv.text)}”` : `<span class="muted">Rated ${rv.stars} of 5, no words.</span>`}</div>
              <div class="micro muted" style="margin-top:4px">${esc(rv.byName || 'Customer')} · ${timeAgo(rv.ts)} · ${rv.stars} ★</div>
            </div>`).join('')
            : `<p class="tiny muted" style="margin-top:6px">${(p.ratings || []).length ? 'Ratings so far are from before reviews were written.' : 'No reviews yet — every pro starts here.'}</p>`}
        </div>
      </div>
    </div>

    <div class="pro__bar">
      ${mine ? `<button class="btn btn-primary btn--lg" data-act="pro.share" data-id="${p.id}">Share my page</button>`
             : `<button class="btn btn-secondary" style="flex:none" data-act="pro.share" data-id="${p.id}" aria-label="Share">${icon('share', { size: 18 })}</button>
                <button class="btn btn-primary btn--lg" data-act="cat.open" data-id="${p.cat}" data-pid="${p.id}">Book ${esc(first)} · ${esc(cat.name)}</button>`}
    </div>
  </main>`;
}

/* three fields, nothing else — the rest is SAAHAA's job to keep current */
export function openEdit() {
  const s = me(); if (!s) return;
  const p = getState().partners.find(x => x.userKey === s.key); if (!p) return;
  const prof = p.profile || {};
  const inp = (id, label, v, extra = '') => `<div class="field"><input id="${id}" placeholder=" " value="${esc(v || '')}" ${extra}><label>${esc(label)}</label></div>`;
  sheet('Your page', `
    <p class="tiny muted" style="margin-bottom:12px">Three things only. Ratings, jobs, badges and reviews update by themselves.</p>
    ${inp('prTag', 'One line about your work (e.g. "AC service, 12 years, same-day")', prof.tagline, 'maxlength="80"')}
    ${inp('prYears', 'Years of experience', prof.years, 'inputmode="numeric" maxlength="2"')}
    ${inp('prLangs', 'Languages (e.g. Telugu, Hindi, English)', prof.langs, 'maxlength="60"')}
    <button class="btn btn-primary btn-block" style="margin-top:6px" data-act="pro.save">Save</button>`);
}
export function saveEdit() {
  const s = me(); if (!s) return;
  const p = getState().partners.find(x => x.userKey === s.key); if (!p) return;
  const v = id => (document.getElementById(id) || {}).value || '';
  const profile = { tagline: v('prTag').trim().slice(0, 80), years: Math.max(0, Math.min(60, Number(v('prYears')) || 0)) || '', langs: v('prLangs').trim().slice(0, 60) };
  dispatch({ type: 'partner/patch', payload: { id: p.id, patch: { profile } } });
  toast('Saved. Your page is updated.');
}
export function share(id) {
  const url = `${location.origin}${location.pathname}#/pro/${id}`;
  const done = () => toast('Link copied — paste it on WhatsApp');
  if (navigator.share) navigator.share({ title: 'My SAAHAA page', url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => toast(url));
  else toast(url);
}
