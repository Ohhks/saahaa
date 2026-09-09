/* SAAHAA · ui/views/onboard.js — the partner's chronology, one step per screen.

   Seven steps, the current one open, everything above it ticked. A
   tradesperson on a ₹6,000 Android should never have to wonder "what now" —
   the screen answers it before they ask. Each step is one action: type a
   code, type a number, tap a photo, tap an answer, tap Agree.

   THE ACTIVATION MOMENT is step 7. The screen that follows it is the single
   most important one in the partner's life on SAAHAA: "You are live" plus
   their own page, already built, already public. They walked in with a
   phone number and walked out with a professional page and a badge, having
   built nothing.

   MODERNIST 8.0: the ladder is unchanged — same seven steps, same ids, same
   actions. The surface is the mockup's form language: a 2px-ruled header
   that says "Step n of 7", a 3px progress rule, stacked .field labels, chips
   for choices, Back on the left and the step's own action on the right.

   8.1 — A SHOP LANDS HERE TOO. A shop has no ladder: it is live the moment it
   is named, so it gets the "you're live" half of this screen and none of the
   steps. It shows the thing they just made — the name, the category in that
   category's accent, the photograph, the S… ID — says what an order costs
   (read from the engine, never typed), and hands them one button into the
   console to start listing. */

import { esc, toast, closeSheet } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, me, myShop } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { header } from './shops.js';
import * as ID from '../../domain/identity.js';
import { getPricing } from '../../domain/settings.js';
import * as photoUI from '../photo.js';
import * as flow from '../../domain/flow.js';
import * as V from '../../domain/verification.js';
import { PASS, MAX_ATTEMPTS } from '../../domain/quiz.js';
import { tier, PROVISIONAL_CAP, PROVISIONAL_JOBS } from '../../domain/trust.js';
import * as M from '../../core/money.js';

/* per-attempt UI state: chosen answers and the chosen id type */
let answers = { trade: [], conduct: [] };
let idType = 'aadhaar';
let shownCode = '';
let lastWrong = [];      // the rules a pro got wrong on the conduct quiz, shown back to them
export const setIdType = t => { idType = t; };
export function pick(kind, q, o) { answers[kind] = answers[kind].slice(); answers[kind][Number(q)] = Number(o); }
export const resetAnswers = kind => { answers[kind] = []; };
export const rememberCode = c => { shownCode = c; };

const obCSS = `<style>
  .ob{max-width:640px}
  .ob__hdr .t{font:800 15px/1.2 var(--font-heading)} .ob__hdr .n{font:600 11px/1 var(--font-body);color:var(--ink-3);flex:none}
  .ob__bar{height:3px;background:var(--color-neutral-300)} .ob__bar i{display:block;height:3px;background:var(--color-accent)}
  .ob__step{padding:16px 0;border-bottom:2px solid var(--color-divider)}
  .ob__title{font:800 22px/1.1 var(--font-heading);letter-spacing:-.01em} .ob__sub{font-size:13px;color:var(--ink-3);margin-top:6px}
  .ob__form{padding:16px 0;display:flex;flex-direction:column;gap:14px}
  .ob__form .field{margin:0}
  .ob__foot{display:flex;gap:8px;padding:12px 0;border-top:2px solid var(--color-divider);margin-top:8px}
  .ob__foot .btn-primary{flex:1;justify-content:flex-start}
  .obl{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--color-divider)}
  .obl__n{width:22px;height:22px;flex:none;display:grid;place-items:center;font:800 11px/1 var(--font-heading);border:2px solid var(--color-text)}
  .obl.done .obl__n{background:var(--color-text);color:var(--color-bg)} .obl.cur .obl__n{border-color:var(--color-accent);background:var(--color-accent);color:var(--accent-on-fill)}
  .obl.pend{color:var(--ink-3)} .obl.pend .obl__n{border-color:var(--color-neutral-400)}
  .ob__chips{display:flex;flex-wrap:wrap;gap:7px}
  .ob__opt{display:block;width:100%;text-align:left;padding:10px 12px;min-height:44px;font-size:14px;border:1px solid var(--color-divider);margin-bottom:6px;white-space:normal;background:var(--surface)}
  .ob__opt[aria-pressed="true"]{background:var(--color-accent);color:var(--accent-on-fill);border-color:var(--color-accent)}
  .ob__q{font:800 14px/1.3 var(--font-heading);margin:14px 0 8px}
  .ob__check{width:56px;height:56px;background:var(--color-accent);color:var(--accent-on-fill);display:grid;place-items:center}
  .ob__live{font:800 30px/1.06 var(--font-heading);letter-spacing:-.02em;margin-top:18px}
  .ob__box{border:2px solid var(--color-text);padding:14px;margin-top:18px}
  .ob__kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:12px 0 0;margin-top:12px;border-top:1px solid var(--color-divider)}
  .ob__fee{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-divider);font-size:13px}
  .ob__hdr.apphdr{padding-left:var(--gutter);padding-right:var(--gutter)}
  .ob__shot{display:block;width:100%;height:170px;object-fit:cover;border:2px solid var(--color-text);background:var(--surface-3);margin-top:8px}
  .ob__shotempty{height:170px;margin-top:8px;border:2px dashed var(--color-divider);background:var(--surface-3);
    display:grid;place-items:center;gap:6px;color:var(--ink-3);text-align:center;padding:10px}
  .ob__id{display:flex;align-items:center;gap:10px;padding:12px;border:2px solid var(--color-text);background:var(--color-surface);margin-top:8px}
  .ob__id b{display:block;font:800 22px/1.1 var(--font-heading);letter-spacing:.1em;margin-top:2px;-webkit-user-select:all;user-select:all;overflow-wrap:anywhere}
  @media (min-width:768px){ .ob__hdr.apphdr{padding-left:var(--sp-8);padding-right:var(--sp-8)} }
  @media (min-width:1024px){ .ob__hdr.apphdr{padding-left:var(--sp-10);padding-right:var(--sp-10)} .ob__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sp-9);align-items:start} }
</style>`;

const stepHeader = (title, right) => `<header class="apphdr ob__hdr">
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="nav.back" aria-label="Back">${icon('back', { size: 18 })}</button>
    <div class="grow t" style="min-width:0">${esc(title)}</div>
    ${right ? `<span class="n">${esc(right)}</span>` : ''}
  </header>`;

export function render() {
  /* A SHOP OWNER LANDS HERE TOO. The seven-step ladder is a pro's chronology
     and a shop has none — a shop is live the moment it is named. So the same
     screen, at the same moment, shows them the thing they just made: the
     name, the category, the photograph, the S… ID, what an order costs, and
     one button into the console to start listing. */
  const s = me();
  if (s && s.role === 'shop') return shopLive(s);

  const p = V.myPartner();
  if (!p) return `${header('Become a partner', '')}<main class="wrap">
    <div class="empty empty--smart"><h3>Sign in as a partner first</h3>
      <button class="btn btn--primary" data-act="earn.start">Join as a partner</button></div></main>`;
  const r = V.readiness(p);
  const cat = get('category', p.cat);

  if (r.complete) return verified(p, r, cat);

  const cur = r.next;
  const minsLeft = V.STEPS.filter(s => !r.done.includes(s.id)).reduce((n, s) => n + s.mins, 0);
  return `${obCSS}
  ${stepHeader('Getting you verified', `Step ${cur.n} of ${V.STEPS.length}`)}
  <div class="ob__bar" aria-hidden="true"><i style="width:${Math.max(4, r.pct)}%"></i></div>
  <main class="wrap ob" style="padding-bottom:40px">
    <div class="ob__step">
      <span class="eyebrow">${esc(cat.name)} · ${esc(r.tier.label)} · about ${minsLeft} min left</span>
      <div class="ob__title" style="margin-top:6px">${esc(cur.title)}</div>
      <div class="ob__sub">${esc(cur.sub)}</div>
    </div>

    <div class="ob__two">
      <div>
        ${stepPanel(p, cur.id, cat)}
      </div>
      <div>
        ${r.done.includes('phone') ? draftPage(p, cat) : ''}
        <div style="padding-top:16px">
          <span class="eyebrow">The seven steps</span>
          <div style="margin-top:6px">
          ${V.STEPS.map(s => {
            const done = r.done.includes(s.id);
            const isCur = cur.id === s.id;
            return `<div class="obl ${done ? 'done' : isCur ? 'cur' : 'pend'}">
              <span class="obl__n">${done ? icon('check', { size: 12 }) : s.n}</span>
              <span class="grow tiny" style="min-width:0"><b>${esc(s.title)}</b>${isCur ? `<span class="micro muted" style="display:block">${esc(s.sub)}</span>` : ''}</span>
              <span class="micro muted" style="flex:none">${done ? 'done' : `${s.mins} min`}</span>
            </div>`;
          }).join('')}
          </div>
          <p class="micro muted" style="margin-top:10px">Jobs open the moment step 7 is done. Nobody has to approve you.</p>
        </div>
      </div>
    </div>
  </main>`;
}

/* ── "you're live" · the shop ──────────────────────────────────
   Everything on this screen is the shop's own: its name, its category with
   that category's accent, the photo they took a minute ago, the S… ID they
   will write down. The fee is read from the engine (the category's own rate,
   falling back to the pushed dials) and never typed here. */
function shopLive(user) {
  const sh = myShop();
  if (!sh) return `${obCSS}${header('Open a shop', '')}<main class="wrap ob">
    <div class="empty empty--smart"><h3>No shop on this account yet</h3>
      <p class="tiny muted">This account is a shop account, but its storefront is missing. Opening one takes a name, a category and a place.</p>
      <button class="btn btn--primary" data-act="auth.open">Open a shop</button></div></main>`;

  const cat = get('category', sh.catId) || { name: 'Shop', accent: '', takePct: null, takeCapPaise: null };
  const P = getPricing();
  const pct = cat.takePct != null ? cat.takePct : P.retailTakePct;
  const cap = cat.takeCapPaise != null ? cat.takeCapPaise : P.retailTakeCapPaise;
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(cat.accent || '')) ? String(cat.accent) : 'var(--color-accent)';
  const shot = photoUI.url(sh.photo);
  const code = ID.normaliseCode((user && user.code) || '');
  const aisles = (cat.aisles || []).length;

  return `${obCSS}
  ${stepHeader('You are live', cat.name)}
  <div class="ob__bar" aria-hidden="true"><i style="width:100%"></i></div>
  <main class="wrap ob" style="padding-bottom:40px">
    <div class="ob__two">
      <div>
        <div style="padding:20px 0 0">
          <div class="ob__check">${icon('check', { size: 28 })}</div>
          <div class="ob__live">${esc(sh.name)}<br>is open in ${esc(sh.area || 'your area')}</div>
          <p class="tiny muted" style="margin-top:10px;line-height:1.6">Nobody has to approve you. Your storefront exists now —
            it just has nothing on the shelves yet.</p>
          <div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
            <span class="tag" style="border-color:${accent};color:${accent}">
              <span aria-hidden="true">${icon(hasIcon(sh.catId) ? sh.catId : 'groupShops', { size: 13 })}</span>${esc(cat.name)}</span>
            <span class="tag tag-neutral">${esc(sh.area || 'Your area')}</span>
            <span class="tag tag-accent">Open</span>
          </div>
        </div>

        <div class="ob__box">
          <span class="eyebrow">Your shop front</span>
          ${shot ? `<img class="ob__shot" src="${shot}" alt="${esc(sh.name)} — the photo of your shop front">`
                 : `<div class="ob__shotempty">${icon('camera', { size: 32 })}
                      <span class="tiny">No photo yet — a shop with a picture is the one people recognise.</span></div>`}
          <button class="btn btn-secondary btn-block" style="margin-top:10px" data-act="photo.shop" data-id="${esc(sh.id)}">
            ${shot ? 'Change the photo' : 'Add a photo of your shop'}</button>
          <p class="micro muted" style="margin-top:8px">Optional, and changeable any time. Kept on this device and shrunk to a few tens of KB.</p>
        </div>
      </div>

      <div>
        <div style="padding-top:20px">
          <span class="eyebrow">Your shop ID</span>
          <div class="ob__id">
            <span style="flex:1;min-width:0">
              <span class="meta" style="display:block">Sign in with this, or with your number</span>
              <b class="num">${esc(code || '—')}</b>
            </span>
            ${ID.isCode(code) ? `<button type="button" class="btn btn-secondary btn--sm idcopy tap" data-code="${esc(code)}"
              style="flex:none" aria-label="Copy your shop ID, ${esc(code)}">Copy</button>` : ''}
          </div>
          <p class="micro muted" style="margin-top:8px">A name, not a secret. Your password is the secret.</p>
        </div>

        <div style="padding-top:20px">
          <span class="eyebrow">What it costs</span>
          <div class="ob__fee" style="margin-top:6px"><span class="muted">To open, and to stay open</span><b>₹0</b></div>
          <div class="ob__fee"><span class="muted">Per order</span><b>${pct}% of the basket, never more than ${M.fmt(cap)}</b></div>
          <div class="ob__fee"><span class="muted">Yearly plan</span><b>None</b></div>
          <p class="micro muted" style="margin-top:8px">Your prices are yours — SAAHAA never marks them up, and the fee comes out of the order, not out of a subscription.</p>
        </div>

        <div style="padding-top:20px">
          <span class="eyebrow">Next · put something on the shelves</span>
          <p class="tiny" style="margin-top:6px">Your console opens on a ready-made list for ${esc(cat.name)}${aisles ? ` — ${aisles} aisle${aisles === 1 ? '' : 's'}` : ''}.
            Tap an item, set your price, and it is on your storefront. About six seconds each.</p>
        </div>
      </div>
    </div>

    <div class="ob__foot" style="margin-top:20px">
      <button class="btn btn-primary btn--lg" data-act="nav.tab" data-tab="earn">Add my first products</button>
    </div>
  </main>`;
}

/* The aha before the ask. A professional page with their name on it, shown
   BEFORE the ID and quiz steps — because those are where every Indian
   onboarding funnel loses half its people, and a page they can already see
   is the reason to push through. */
function draftPage(p, cat) {
  return `<div style="padding-top:16px">
    <span class="eyebrow">Your page — draft</span>
    <div class="ob__box" style="margin-top:6px">
      <div class="row" style="gap:12px">
        <span class="avatar avatar--md">${esc(p.name[0])}</span>
        <div class="grow" style="min-width:0"><b style="font:800 15px/1.2 var(--font-heading)">${esc(p.name)}</b>
          <p class="tiny muted">${esc(cat.name)} · ${esc(p.area)} · from ${M.fmt(p.ask)}</p></div>
        <span class="tag tag-neutral" style="flex:none">Live at step 7</span>
      </div>
      <p class="micro muted" style="margin-top:10px">Ratings, badges and reviews fill in by themselves. You never build or maintain it.</p>
    </div></div>`;
}

/* ── the step panels: the form, then Back on the left and the step's own
      action on the right ── */
const foot = (primary) => `<div class="ob__foot">
    <button class="btn btn-secondary" style="flex:none" data-act="nav.back">Back</button>${primary}</div>`;

function stepPanel(p, id, cat) {
  switch (id) {
    case 'phone': return `<div class="ob__form">
      ${shownCode ? `<p class="tiny">Your code: <b class="num" style="font-size:22px;letter-spacing:.15em">${esc(shownCode)}</b>
          <span class="micro muted" style="display:block">Sandbox: shown here because the SMS rail is not wired yet. Type it below to confirm this is your number.</span></p>
        <div class="field"><input id="obPhone" inputmode="numeric" maxlength="4" placeholder=" " autocomplete="one-time-code"><label>4-digit code</label></div>`
        : `<p class="tiny muted">We send a 4-digit code to …${esc(String(p.mobile || '').slice(-4) || 'your number')}. Nothing else is needed for this step.</p>`}
      </div>
      ${foot(shownCode ? '<button class="btn btn-primary" data-act="ob.confirmphone">Confirm</button>'
                       : `<button class="btn btn-primary" data-act="ob.sendcode">Send code to …${esc(String(p.mobile || '').slice(-4) || 'my number')}</button>`)}`;

    case 'identity': return `<div class="ob__form">
      <div class="field"><div class="ob__chips">
        ${Object.entries(V.ID_TYPES).map(([k, t]) => `<button class="chip" type="button"
          aria-pressed="${idType === k ? 'true' : 'false'}"
          data-act="ob.idtype" data-type="${k}"><span class="chip__ic" aria-hidden="true">${icon('idcard', { size: 14 })}</span>${esc(t.label)}</button>`).join('')}
        </div><label>Which ID</label></div>
      <div class="field"><input id="obId" placeholder=" " autocomplete="off"><label>${esc(V.ID_TYPES[idType].hint)}</label></div>
      <p class="micro muted">We keep only a scrambled fingerprint and the last 4 digits. The number itself is never stored.</p>
      </div>
      ${foot('<button class="btn btn-primary" data-act="ob.submitid">Save ID</button>')}`;

    /* STEP 3 KEEPS THE PICTURE (8.2). The step said "customers see this face at
       the door" and then stored nothing — the ladder marked itself done and the
       pro's page went live with a letter where the face should be. It is the
       same portrait `photo.pro` writes on My page, taken here instead, so a pro
       who finishes the ladder is already photographed. The step still completes
       if the camera is cancelled or the device is out of room: verification is
       not held hostage by a picture, and My page can add one later. */
    case 'selfie': {
      const shot = photoUI.url(p.photo);
      return `<div class="ob__form">
      <div class="row" style="gap:14px">
        <div class="thumb" style="width:96px;height:96px;display:grid;place-items:center;overflow:hidden;color:var(--color-neutral-700)">${
          shot ? `<img src="${shot}" alt="The photo you took of yourself" style="display:block;width:100%;height:100%;object-fit:cover">`
               : icon('camera', { size: 40 })}</div>
        <p class="tiny muted">Face straight, good light, no cap or glasses. This is what the customer sees at the door.</p>
      </div>
      </div>
      ${foot(`<button class="btn btn-primary" data-act="ob.selfie">${shot ? 'Use this photo' : 'Take my photo'}</button>`)}`;
    }

    case 'trade': return quizPanel(p, 'trade', `${esc(cat.name)} — five questions`);
    case 'conduct': return quizPanel(p, 'conduct', 'How SAAHAA works — six questions');

    case 'payout': return `<div class="ob__form">
      <div class="field"><input id="obUpi" placeholder=" " autocomplete="off" inputmode="email"><label>Your UPI id (yourname@upi)</label></div>
      <p class="micro muted">PhonePe, GPay, Paytm — any UPI id. Your money lands here after each job is confirmed. You keep 100% of every quote.</p>
      </div>
      ${foot('<button class="btn btn-primary" data-act="ob.payout">Save UPI</button>')}`;

    case 'agreement': return `<div class="ob__form">
      <div>${V.TERMS.map(t => `<div class="obl" style="align-items:flex-start"><span class="obl__n" style="border-color:var(--color-neutral-400)">${icon('check', { size: 11 })}</span><span class="tiny grow">${esc(t)}</span></div>`).join('')}</div>
      </div>
      ${foot('<button class="btn btn-primary btn--lg" data-act="ob.agree">I agree — make me a SAAHAA pro</button>')}`;
  }
  return '';
}

function quizPanel(p, kind, title) {
  const st = V.quizStateFor(p, kind);
  if (st.locked) {
    const mins = Math.ceil((st.lockedUntil - Date.now()) / 60000);
    return `<div class="ob__form"><div class="card" style="border-color:var(--warn)">
      <b>Three tries used.</b>
      <p class="tiny muted" style="margin-top:6px">Come back in ${mins > 60 ? Math.ceil(mins / 60) + ' hours' : mins + ' minutes'} and try again. Read the questions slowly — there is no trick.</p></div></div>
      ${foot('')}`;
  }
  const bank = V.quizFor(p, kind);
  const mine = answers[kind] || [];
  const answered = bank.filter((_, i) => Number.isInteger(mine[i])).length;
  return `<div class="ob__form" style="gap:0">
    <div class="between" style="gap:8px"><b class="tiny">${title}</b>
      <span class="tag tag-neutral" style="flex:none">need ${PASS[kind]} of ${bank.length}${Number.isFinite(st.left) ? ` · ${st.left} ${st.left === 1 ? 'try' : 'tries'} left` : ''}</span></div>
    ${kind === 'conduct' && lastWrong.length ? `<div class="card" style="margin-top:10px;border-left:3px solid var(--color-accent)">
      <b class="micro">The rules you missed:</b>
      ${lastWrong.map(w => `<p class="micro" style="margin-top:4px">${esc(w.right)}</p>`).join('')}</div>` : ''}
    ${bank.map((item, qi) => `<div><div class="ob__q">${qi + 1}. ${esc(item.q)}</div>
      ${item.o.map((opt, oi) => `<button class="ob__opt" type="button" aria-pressed="${mine[qi] === oi ? 'true' : 'false'}"
        data-act="ob.pick" data-kind="${kind}" data-q="${qi}" data-o="${oi}">${esc(opt)}</button>`).join('')}
    </div>`).join('')}
    <p class="micro muted" style="margin-top:8px">${answered} of ${bank.length} answered.</p>
  </div>
  ${foot(`<button class="btn btn-primary" data-act="ob.quiz" data-kind="${kind}" ${answered < bank.length ? 'disabled' : ''}>
      ${answered < bank.length ? `Answer all ${bank.length}` : 'Check my answers'}</button>`)}`;
}

/* ── the moment ────────────────────────────────────────────── */
function verified(p, r, cat) {
  const bg = V.backgroundStatus(p);
  const t = tier(p.tier);
  const canBg = (p.tier | 0) === 2 && bg !== 'pending';
  const link = `${location.host}${location.pathname}#/pro/${p.id}`;
  const next = tier(Math.min(4, (p.tier | 0) + 1));
  return `${obCSS}
  ${stepHeader('You are live', `${cat.name} · ${t.label}`)}
  <main class="wrap ob" style="padding-bottom:40px">
    <div class="ob__two">
      <div>
        <div style="padding:20px 0 0">
          <div class="ob__check">${icon('check', { size: 28 })}</div>
          <div class="ob__live">${esc(p.name)}<br>is live in ${esc(p.area)}</div>
          <p class="tiny muted" style="margin-top:10px;line-height:1.6">Jobs near ${esc(p.area)} can reach you now. Your page, your badge and your ratings are built and kept current by SAAHAA — you never maintain anything.</p>
          <div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
            <span class="tag tag-accent">${esc(t.badge)}</span>
            <span class="tag tag-neutral">Locally, professionally</span>
          </div>
        </div>

        <div class="ob__box">
          <span class="eyebrow">Your public page</span>
          <div style="font:600 12.5px var(--font-body);word-break:break-all;margin-top:8px">${esc(link)}</div>
          <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-secondary grow" style="justify-content:flex-start" data-act="pro.share" data-id="${p.id}">Copy link / share</button>
            <button class="btn btn-secondary grow" style="justify-content:flex-start" data-act="pro.open" data-id="${p.id}">View page</button>
          </div>
        </div>
        <div class="ob__kv"><span class="muted">You paid to get here</span><b>₹0</b></div>
        <div class="ob__kv" style="border-top:0;padding-top:4px"><span class="muted">You keep of every quote</span><b>100%</b></div>
      </div>

      <div>
        <div style="padding-top:20px">
          <span class="eyebrow">Your first ${PROVISIONAL_JOBS} jobs</span>
          <p class="tiny" style="margin-top:6px">Your first jobs are up to <b>${M.fmt(PROVISIONAL_CAP)}</b>. This is not about trusting you — every new pro starts here, and it is how we can pay you before anyone knows your name. Finish <b>${PROVISIONAL_JOBS} jobs with no complaint</b> and it becomes ${M.fmt(tier(2).capPaise)} by itself. Those first payouts are also looked at by SAAHAA before release, usually within a day.</p>
        </div>

        <div style="padding-top:20px">
          <span class="eyebrow">Go further · next: ${esc(next.label)}</span>
          <p class="tiny muted" style="margin:4px 0 10px">${esc(next.unlocks)}</p>
          ${bg === 'pending' ? `<span class="tag tag-neutral">Background check in progress</span>
              <p class="micro muted" style="margin-top:6px">SAAHAA is calling your reference. Usually 2 working days.</p>`
            : canBg ? `
              <div class="field"><input id="obRefName" placeholder=" "><label>A reference (past customer or employer)</label></div>
              <div class="field"><input id="obRefPhone" placeholder=" " inputmode="numeric" maxlength="10"><label>Their 10-digit number</label></div>
              <label class="tiny" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px">
                <input type="checkbox" id="obConsent" style="margin-top:3px"> I consent to SAAHAA verifying my background, including police verification where required for in-home work.</label>
              <button class="btn btn-secondary btn-block" data-act="ob.bg">Request background check</button>`
            : (p.tier | 0) >= 3 ? certifiedCard(p) : ''}
        </div>
      </div>
    </div>

    <div class="ob__foot" style="margin-top:20px">
      <button class="btn btn-primary btn--lg" data-act="nav.tab" data-tab="earn">Open my dashboard</button>
    </div>
  </main>`;
}

function certifiedCard(p) {
  const e = V.certifiedEligible(p);
  const row = (ok, label) => `<div class="obl ${ok ? 'done' : 'pend'}" style="padding:6px 0"><span class="obl__n">${ok ? icon('check', { size: 12 }) : ''}</span><span class="tiny">${label}</span></div>`;
  return `${row(e.jobs, `${e.completed} of ${V.CERTIFIED_RULE.jobs} jobs done`)}
    ${row(e.rating, `Rating ${e.avg.toFixed(1)} (need ${V.CERTIFIED_RULE.rating})`)}
    ${row(e.disputes, 'No upheld disputes')}
    <p class="micro muted" style="margin-top:6px">${e.jobs && e.rating && e.disputes ? 'You qualify — SAAHAA confirms Certified status within 2 working days.' : 'Earned automatically from your work. Nothing to submit.'}</p>`;
}

/* Step 3, done properly: ask for the picture, keep it on the pro's own record
   through the same domain call `photo.pro` uses, then mark the step done. A
   cancel or a full device still finishes the step — the ladder is about who
   somebody is, and it is not the place to strand a pro over storage. */
async function takeSelfie(p) {
  if (photoUI.url(p.photo)) { V.submitSelfie(p); toast('Photo saved'); ctx.render(); return; }
  const r = await photoUI.pick({ maxEdge: 560 });
  if (r && r.ok) { flow.setPartnerPhoto(p.id, r.id); toast('Photo saved'); }
  else if (r && !r.cancelled && r.reason) toast(`${r.reason} — the step is done; add a photo later from My page`, 'warn');
  else toast('No photo yet — the step is done; add one later from My page');
  V.submitSelfie(p);
  ctx.render();
}

/* ── actions, called from app.js ───────────────────────────── */
export function act(name, d) {
  const p = V.myPartner(); if (!p) return;
  const val = id => (document.getElementById(id) || {}).value || '';
  switch (name) {
    case 'ob.sendcode':     rememberCode(V.sendPhoneCode(p)); toast('Code sent'); break;
    case 'ob.confirmphone': if (V.confirmPhone(p, val('obPhone'))) { shownCode = ''; toast('Number confirmed'); } break;
    case 'ob.idtype':       setIdType(d.type); break;
    case 'ob.submitid':     return V.submitIdentity(p, idType, val('obId')).then(ok => { if (ok) toast('ID saved — only the last 4 digits kept'); ctx.render(); });
    case 'ob.selfie':       return takeSelfie(p);
    case 'ob.pick':         pick(d.kind, d.q, d.o); break;
    case 'ob.quiz': {
      const res = V.submitQuiz(p, d.kind, answers[d.kind] || []);
      resetAnswers(d.kind);
      lastWrong = res.ok ? [] : (res.wrong || []);
      if (res.ok) toast(`${res.right} of ${res.total} — passed`);
      else if (res.locked) toast(`${res.right} of ${res.total}. Three tries used — come back tomorrow.`, 'warn');
      else if (res.teaching) toast(`${res.right} of ${res.total} — read the rules you missed and try again.`, 'warn');
      else toast(`${res.right} of ${res.total} — need ${res.need}. ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left.`, 'warn');
      break;
    }
    case 'ob.payout':       V.submitPayout(p, val('obUpi')); break;
    case 'ob.agree':        V.acceptAgreement(p); closeSheet(); break;
    case 'ob.bg':           V.requestBackground(p, { refName: val('obRefName'), refPhone: val('obRefPhone'),
                              consent: !!(document.getElementById('obConsent') || {}).checked }); break;
  }
  ctx.render();
}

/** The card the partner console shows until verification is complete. */
export function progressCard(p) {
  const r = V.readiness(p);
  if (r.complete) return '';
  return `<button class="card card--tap" style="width:100%;text-align:left;margin-top:12px;border-left:3px solid var(--color-accent);gap:6px"
      data-act="nav.onboard">
    <div class="between" style="gap:8px"><span class="eyebrow em">Not live yet</span><span class="tag tag-accent">${r.pct}%</span></div>
    <b style="font:800 17px/1.2 var(--font-heading)">Finish verification to start earning</b>
    <span class="tiny muted">Step ${r.next.n} of ${V.STEPS.length}: ${esc(r.next.title)} · ${r.pct}% done</span>
    <div style="height:3px;background:var(--color-neutral-300);margin-top:4px"><i style="display:block;height:100%;width:${r.pct}%;background:var(--color-accent)"></i></div>
    <span class="more">Continue</span>
  </button>`;
}
