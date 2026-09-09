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
   the pro's own rate, and SAAHAA's 8% laid on top for the customer.

   PICTURES (8.1). A pro's page now carries what a shop's carries: his own
   portrait in the band, and a strip of photographs of finished work. He adds
   and removes them himself; a visitor only looks. Every picture is drawn from
   photo.url(), which returns '' for anything the store cannot vouch for, and
   every box is sized in CSS — a page with no photographs at all is still a
   complete page, laid out exactly the same. */

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
import { MAX_WORK_PHOTOS } from '../../domain/flow.js';
import * as photo from '../photo.js';

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

/* A pro's work, photographed. This is the whole point of the release: a shop
   has a front and a shelf, and until now a pro had a paragraph. The strip is
   what a customer looks through; the add and remove controls appear only for
   the person whose page it is. The cap is the engine's (flow.MAX_WORK_PHOTOS)
   and is stated in plain words, so nobody discovers it by being refused. */
function workBlock(p, mine, first) {
  const held = (p.work || []).length;
  const shots = (p.work || []).filter(id => photo.url(id));
  const left = Math.max(0, MAX_WORK_PHOTOS - held);
  if (!shots.length && !mine) return '';               // a visitor sees no empty frame
  return `<div class="pro__sec">
    <div class="between" style="align-items:baseline">
      <span class="eyebrow">Work</span>
      ${shots.length ? `<span class="tag tag-neutral">${shots.length} photo${shots.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    ${shots.length || (mine && left) ? `<div class="pro__gal">
      ${shots.map((pid, i) => `<div class="pro__shot">
        <img src="${photo.url(pid)}" alt="Work by ${esc(p.name)}, photo ${i + 1}" loading="lazy" decoding="async">
        ${mine ? `<button class="pro__x tap" data-act="photo.workdrop" data-id="${esc(p.id)}" data-photo="${esc(pid)}"
          aria-label="Remove photo ${i + 1}">${icon('trash', { size: 15 })}</button>` : ''}
      </div>`).join('')}
      ${mine && left ? `<button class="pro__shot pro__add tap" data-act="photo.work" data-id="${esc(p.id)}">
        ${icon('plus', { size: 20 })}<span>Add photo</span></button>` : ''}
    </div>` : ''}
    ${mine
      ? `<p class="micro muted" style="margin-top:8px">${left
          ? `${held} of ${MAX_WORK_PHOTOS} used — ${left} more to add. Photograph a finished job: it is what wins the next one.`
          : `Your page holds ${MAX_WORK_PHOTOS} photos. Remove one to add another.`}</p>`
      : `<p class="micro muted" style="margin-top:8px">Jobs ${esc(first)} has finished.</p>`}
  </div>`;
}

const proCSS = `<style>
  .pro__hdr.apphdr{padding-left:var(--gutter);padding-right:var(--gutter)}
  .pro__hdr .t{font:800 15px/1.2 var(--font-heading);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* THE PORTRAIT. The band is sized by CSS, never by the picture, so the page
     is laid out identically with a photograph, with the drawn initial, or
     while the picture is still decoding. */
  .pro__photo{position:relative;height:150px;background:var(--color-neutral-300);border-bottom:2px solid var(--color-divider);display:grid;place-items:center;color:var(--color-neutral-700);overflow:hidden}
  .pro__photo b{font:800 56px/1 var(--font-heading)}
  .pro__photo img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}
  .pro__cam{position:absolute;right:var(--gutter);bottom:10px;gap:6px;min-height:44px;background:var(--bg);color:var(--ink-1)}
  /* THE WORK. A strip a customer can push through, fixed tiles so nothing
     reflows, and the whole scroll lives inside the strip — the page never
     scrolls sideways. */
  .pro__gal{display:flex;gap:8px;overflow-x:auto;padding:10px 0 4px}
  .pro__shot{position:relative;flex:none;width:150px;height:112px;background:var(--color-neutral-300);border:1px solid var(--color-divider);overflow:hidden}
  .pro__shot img{display:block;width:100%;height:100%;object-fit:cover}
  .pro__x{position:absolute;top:0;right:0;min-width:44px;min-height:44px;display:grid;place-items:center;
    background:var(--bg);color:var(--ink-1);border-left:1px solid var(--color-divider);border-bottom:1px solid var(--color-divider)}
  .pro__add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:none;
    border:2px solid var(--color-divider);color:var(--ink-3);font:800 11px/1 var(--font-heading);cursor:pointer}
  .pro__add:hover,.pro__add:focus-visible{border-color:var(--color-accent);color:var(--color-accent)}
  /* THE PORTRAIT OFFER. Only the owner of the page ever sees it, only while
     the page has no public photo and a private selfie exists, and the word
     "public" is in the sentence and in the button — a private picture must
     never become public by accident. */
  .pro__use{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px var(--gutter);
    border-bottom:2px solid var(--color-divider);background:var(--color-surface)}
  .pro__use img{width:52px;height:52px;object-fit:cover;flex:none;border:2px solid var(--color-text)}
  .pro__use b{font:800 13.5px/1.2 var(--font-heading)}
  .pro__use p{font-size:11.5px;color:var(--ink-3);margin:4px 0 0}
  @media (min-width:768px){ .pro__use{padding-left:var(--sp-8);padding-right:var(--sp-8)} }
  @media (min-width:1024px){ .pro__use{padding-left:var(--sp-10);padding-right:var(--sp-10)} }
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
  @media (min-width:768px){ .pro__hdr.apphdr{padding-left:var(--sp-8);padding-right:var(--sp-8)} .pro__bar{bottom:0} .pro__photo{height:200px} .pro__cam{right:var(--sp-8)} }
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
  <div class="pro__photo">
    ${photo.url(p.photo)
      ? `<img src="${photo.url(p.photo)}" alt="${esc(p.name)}" decoding="async">`
      : `<b aria-hidden="true">${esc(p.name[0])}</b>`}
    ${mine ? `<button class="btn btn-secondary pro__cam tap" data-act="photo.pro" data-id="${esc(p.id)}">
      ${icon('camera', { size: 16 })}<span>${photo.url(p.photo) ? 'Change photo' : 'Add your photo'}</span></button>` : ''}
  </div>
  ${mine && !photo.url(p.photo) && photo.url(p.selfie) ? `<div class="pro__use">
    <img src="${photo.url(p.selfie)}" alt="The photo you took for verification">
    <div class="grow" style="min-width:0">
      <b>Use your verification photo here?</b>
      <p>That photo is private today — only SAAHAA has seen it. Putting it here makes it <b>public</b>: anyone with your link sees it.</p>
    </div>
    <button class="btn btn-primary tap" style="flex:none" data-act="photo.publish" data-id="${esc(p.id)}">Make it public</button>
  </div>` : ''}
  <main class="wrap" style="padding-top:0">

    <div class="pro__id">
      <div class="pro__name">${esc(p.name)}</div>
      <div class="pro__line">${esc(prof.tagline || subs.slice(0, 3).join(' · ') || cat.name)} · ${esc(p.area)}, ${km} km</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <span class="tag tag-accent">${a ? `${a.toFixed(1)} ★ ` : ''}${p.completed ? `${p.completed} jobs` : 'New on SAAHAA'}</span>
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
        ${workBlock(p, mine, first)}
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
