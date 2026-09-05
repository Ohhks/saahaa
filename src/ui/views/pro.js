/* SAAHAA · ui/views/pro.js — the partner's public storefront.

   "LOCALLY, PROFESSIONALLY." A plumber in Kukatpally with a WhatsApp number
   has no page, no ratings anyone can check, no badge, and no way to be found
   by someone two streets away who does not already know him. This page is
   all of that, generated from his work, maintained by SAAHAA, and his to
   share. He edits three fields. Everything else — rating, jobs done, badges,
   reviews, price, availability — updates by itself as he works.

   It is public: a guest can open it from a shared link and book from it.
   That is the growth loop — every pro sharing a card that says SAAHAA. */

import { esc, ratingStars, timeAgo, sheet, toast } from '../dom.js';
import { ctx, getState, me } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import * as M from '../../core/money.js';
import { trustScore, tier } from '../../domain/trust.js';
import { kmBetween, etaMins } from '../../domain/match.js';
import { myArea, dispatch } from '../../core/ctx.js';
import { header } from './shops.js';
import { readiness } from '../../domain/verification.js';

const avg = p => { const r = p.ratings || []; return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 0; };

export function render(id) {
  const p = getState().partners.find(x => x.id === id);
  if (!p) return `${header('Pro', '')}<main class="wrap"><div class="empty"><h3>This page is not live</h3>
    <p>The pro may have left SAAHAA.</p><button class="btn btn--primary" data-act="nav.home">Home</button></div></main>`;
  const cat = get('category', p.cat);
  const t = tier(p.tier);
  const ts = trustScore(p);
  const s = me();
  const mine = !!(s && s.key === p.userKey);
  const km = kmBetween(myArea(), p.area);
  const reviews = getState().reviews.filter(r => r.partnerId === p.id && !r.hidden).slice(0, 8);
  const a = avg(p);
  const prof = p.profile || {};
  const r = readiness(p);
  const hidden = !r.complete && !mine;

  if (hidden) return `${header(p.name, '')}<main class="wrap"><div class="empty"><h3>Not yet verified</h3>
    <p>This pro is completing SAAHAA verification. Check back soon.</p></div></main>`;

  return `
  ${header(p.name, `${esc(cat.name)} · ${esc(p.area)}`)}
  <main class="wrap" style="padding-bottom:110px">
    <div class="card on-plum" style="margin-top:var(--sp-6);border:0;text-align:center;padding:24px 16px">
      <span style="width:84px;height:84px;border-radius:50%;margin:0 auto 10px;background:var(--accent-fill);color:var(--accent-on-fill);
        display:grid;place-items:center;font-weight:800;font-size:34px">${esc(p.name[0])}</span>
      <h1 style="font-size:22px;margin:0">${esc(p.name)}</h1>
      <p class="tiny muted" style="margin-top:4px">${esc(prof.tagline || `${cat.name} in ${p.area}`)}</p>
      <div class="row" style="justify-content:center;gap:6px;margin-top:12px;flex-wrap:wrap">
        ${t.badge ? `<span class="badge badge--ok">✓ ${esc(t.badge)}</span>` : ''}
        <span class="badge badge--gold">${esc(ts.band.label)}</span>
        ${p.online === false ? '<span class="badge badge--soft">Offline now</span>' : '<span class="badge badge--info">Available</span>'}
      </div>
    </div>

    <div class="saves" style="margin-top:var(--sp-6)">
      <div><div class="k">Rating</div><div class="v num">${a ? a.toFixed(1) : 'New'}</div></div>
      <div><div class="k">Jobs done</div><div class="v num">${p.completed || 0}</div></div>
      <div class="good"><div class="k">From</div><div class="v num">${M.fmt(p.ask)}</div></div>
    </div>
    <p class="micro muted" style="margin:-4px 0 0">${a ? ratingStars(a) + ' ' : ''}${(p.ratings || []).length} ratings · ${km} km from you · ~${etaMins(km)} min</p>

    <div class="sec"><div class="hd"><h2>About</h2>${mine ? '<button class="more" data-act="pro.edit">Edit</button>' : ''}</div>
      <div class="card">
        <div class="grid2">
          <div><span class="micro muted">Experience</span><b class="tiny" style="display:block">${prof.years ? esc(String(prof.years)) + ' years' : 'Not stated'}</b></div>
          <div><span class="micro muted">Languages</span><b class="tiny" style="display:block">${esc(prof.langs || 'Telugu, Hindi')}</b></div>
          <div><span class="micro muted">Area</span><b class="tiny" style="display:block">${esc(p.area)}</b></div>
          <div><span class="micro muted">Verified</span><b class="tiny" style="display:block">${p.verifiedAt ? timeAgo(p.verifiedAt) : t.badge ? 'Yes' : 'Pending'}</b></div>
        </div>
        ${(cat.subs || []).length ? `<div class="rule" style="margin:12px 0"></div>
          <span class="micro muted">Does</span>
          <div class="chiprow" style="flex-wrap:wrap;gap:6px;margin-top:6px">${cat.subs.slice(0, 8).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>
    </div>

    <div class="sec"><div class="hd"><h2>What customers say</h2></div>
      ${reviews.length ? reviews.map(rv => `<div class="card" style="margin-bottom:8px;padding:12px 14px">
          <div class="between"><b class="tiny">${esc(rv.byName || 'Customer')}</b><span class="micro muted">${timeAgo(rv.ts)}</span></div>
          <p class="micro">${ratingStars(rv.stars)}${rv.text ? ' ' + esc(rv.text) : ''}</p></div>`).join('')
        : `<div class="card"><p class="tiny muted">${(p.ratings || []).length ? 'Ratings so far are from before reviews were written.' : 'No reviews yet — every pro starts here.'}</p></div>`}
    </div>

    <div class="sec">
      <div class="card" style="border-color:var(--accent-border)">
        <b class="tiny">Why book through SAAHAA</b>
        <p class="micro muted" style="margin-top:4px">Price locked before booking · a code at the door · money held until you confirm the work · ${esc(p.name.split(' ')[0])} keeps 100% of the quote.</p>
      </div>
    </div>

    <div style="position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px);padding-top:8px;
      background:linear-gradient(transparent,var(--bg) 40%);display:flex;gap:8px">
      ${mine ? `<button class="btn btn--primary btn--lg grow" data-act="pro.share" data-id="${p.id}">Share my page</button>`
             : `<button class="btn btn--primary btn--lg grow" data-act="cat.open" data-id="${p.cat}">Book ${esc(p.name.split(' ')[0])} · ${esc(cat.name)}</button>
                <button class="btn btn--secondary" data-act="pro.share" data-id="${p.id}" aria-label="Share">↗</button>`}
    </div>
  </main>`;
}

/* three fields, nothing else — the rest is SAAHAA's job to keep current */
export function openEdit() {
  const s = me(); if (!s) return;
  const p = getState().partners.find(x => x.userKey === s.key); if (!p) return;
  const prof = p.profile || {};
  const inp = (id, ph, v, extra = '') => `<input id="${id}" placeholder="${esc(ph)}" value="${esc(v || '')}" ${extra}
    style="width:100%;height:44px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);margin-bottom:8px">`;
  sheet('Your page', `
    <p class="tiny muted" style="margin-bottom:12px">Three things only. Ratings, jobs, badges and reviews update by themselves.</p>
    ${inp('prTag', 'One line about your work (e.g. "AC service, 12 years, same-day")', prof.tagline, 'maxlength="80"')}
    ${inp('prYears', 'Years of experience', prof.years, 'inputmode="numeric" maxlength="2"')}
    ${inp('prLangs', 'Languages (e.g. Telugu, Hindi, English)', prof.langs, 'maxlength="60"')}
    <button class="btn btn--primary btn--block" style="margin-top:6px" data-act="pro.save">Save</button>`);
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
