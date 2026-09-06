/* SAAHAA · ui/views/onboard.js — the partner's chronology, one step per screen.

   The whole tab is a track. Seven dots, the current one open, everything above
   it ticked. A tradesperson on a ₹6,000 Android should never have to wonder
   "what now" — the screen answers it before they ask. Each step is one action:
   type a code, type a number, tap a photo, tap an answer, tap Agree.

   THE ACTIVATION MOMENT is step 7. The screen that follows it is the single
   most important one in the partner's life on SAAHAA: "You are verified" plus
   their own storefront, already built, already live. That is what "locally,
   professionally" means — they walked in with a phone number and walked out
   with a professional page and a badge, having built nothing.

   OPEN CIRCLE · LIVING GLASS: the ladder is unchanged — same seven steps,
   same ids, same actions. What changed is the surface: the track is a
   timeline, each open step is a glass panel, and the one thing to do next is
   the only thing that looks tappable. */

import { esc, toast, closeSheet } from '../dom.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState } from '../../core/ctx.js';
import { get } from '../../core/registry.js';
import { header } from './shops.js';
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

export function render() {
  const p = V.myPartner();
  if (!p) return `${header('Become a partner', '')}<main class="wrap">
    <div class="empty empty--smart"><h3>Sign in as a partner first</h3>
      <button class="btn btn--primary" data-act="earn.start">Join as a partner</button></div></main>`;
  const r = V.readiness(p);
  const cat = get('category', p.cat);

  if (r.complete) return verified(p, r, cat);

  return `
  ${header('Getting you verified', `${esc(cat.name)} · ${r.pct}% done`)}
  <main class="wrap" style="padding-bottom:40px;max-width:760px">
    <div class="glass glass--deep sheen rise" style="margin-top:var(--sp-6);padding:16px;border-radius:var(--r-lg)">
      <div class="between" style="align-items:flex-start">
        <div class="grow"><span class="eyebrow">Verification</span>
          <b class="h-display" style="display:block">Step ${r.next.n} of ${V.STEPS.length}</b></div>
        <span class="pill pill--gold">${esc(r.tier.label)}</span></div>
      <div style="height:6px;border-radius:99px;background:rgba(255,255,255,.18);margin-top:12px;overflow:hidden">
        <i style="display:block;height:100%;width:${r.pct}%;background:var(--gold-grad-soft)"></i></div>
      <p class="micro muted" style="margin-top:8px">About ${V.STEPS.filter(s => !r.done.includes(s.id)).reduce((n, s) => n + s.mins, 0)} minutes left. Jobs open the moment you finish.</p>
    </div>

    ${r.done.includes('phone') ? draftPage(p, cat) : ''}

    <div class="sec">
      <ol class="track">
        ${V.STEPS.map((s, i) => {
          const done = r.done.includes(s.id);
          const cur = r.next && r.next.id === s.id;
          return `<li class="${done ? 'done' : cur ? 'cur' : 'pend'}">
            <span class="node"><span class="dot">${done ? '✓' : s.n}</span>
              ${i < V.STEPS.length - 1 ? '<span class="bar"></span>' : ''}</span>
            <span class="body"><b>${esc(s.title)}</b>
              ${cur ? `<span>${esc(s.sub)}</span>${stepPanel(p, s.id, cat)}` : done ? '' : `<span>${esc(s.sub)}</span>`}
            </span></li>`;
        }).join('')}
      </ol>
    </div>
  </main>`;
}

/* The aha before the ask. A professional page with their name on it, shown
   BEFORE the ID and quiz steps — because those are where every Indian
   onboarding funnel loses half its people, and a page they can already see
   is the reason to push through. */
function draftPage(p, cat) {
  return `<div class="sec">
    <div class="hd"><div><span class="eyebrow">The aha</span><h2 class="h-sec">Your page — draft</h2></div></div>
    <div class="card glass glass--gold sheen" style="position:relative;overflow:hidden">
      <span class="pill pill--soft" style="position:absolute;right:12px;top:12px">Goes live at step 7</span>
      <div class="row">
        <span class="avatar avatar--md" style="width:46px;height:46px;border-radius:50%;background:var(--accent-fill);color:var(--accent-on-fill);display:grid;place-items:center;font-weight:800;font-size:19px">${esc(p.name[0])}</span>
        <div class="grow"><b>${esc(p.name)}</b>
          <p class="tiny muted">${esc(cat.name)} · ${esc(p.area)} · from ${M.fmt(p.ask)}</p></div>
      </div>
      <p class="micro muted" style="margin-top:10px">saahaa.app/pro/${esc(p.id.slice(-6))} · ratings, badges and reviews fill in by themselves. You never build or maintain it.</p>
    </div></div>`;
}

/* ── the step panels ───────────────────────────────────────── */
function stepPanel(p, id, cat) {
  const F = (inner) => `<div class="card glass" style="margin-top:10px;padding:14px">${inner}</div>`;
  switch (id) {
    case 'phone': return F(`
      ${shownCode ? `<p class="tiny" style="margin-bottom:8px">Your code: <b class="num" style="font-size:20px;letter-spacing:.15em">${esc(shownCode)}</b>
          <span class="micro muted">Type it below to confirm this is your number.</span></p>
        <div class="row" style="flex-wrap:wrap"><input id="obPhone" class="grow" style="min-width:140px" inputmode="numeric" maxlength="4" placeholder="4-digit code"
          style="height:46px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);font-size:18px;letter-spacing:.2em">
          <button class="btn btn--primary" data-act="ob.confirmphone">Confirm</button></div>`
        : `<button class="btn btn--primary btn--block" data-act="ob.sendcode">Send code to …${esc(String(p.mobile || '').slice(-4) || 'my number')}</button>`}`);

    case 'identity': return F(`
      <div class="chiprow" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        ${Object.entries(V.ID_TYPES).map(([k, t]) => `<button class="chip chip--smart ${idType === k ? 'on' : ''}"
          aria-pressed="${idType === k ? 'true' : 'false'}"
          data-act="ob.idtype" data-type="${k}"><span class="chip__ic" aria-hidden="true">${icon('idcard', { size: 14 })}</span>${esc(t.label)}</button>`).join('')}
      </div>
      <input id="obId" placeholder="${esc(V.ID_TYPES[idType].hint)}" autocomplete="off"
        style="width:100%;height:46px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);font-size:16px">
      <p class="micro muted" style="margin:8px 0 10px">We keep only a scrambled fingerprint and the last 4 digits. The number itself is never stored.</p>
      <button class="btn btn--primary btn--block" data-act="ob.submitid">Save ID</button>`);

    case 'selfie': return F(`
      <div style="width:96px;height:96px;border-radius:50%;margin:0 auto 10px;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent)">${icon('camera', { size: 44 })}</div>
      <p class="tiny muted" style="text-align:center;margin-bottom:10px">Face straight, good light, no cap or glasses. This is what the customer sees at the door.</p>
      <button class="btn btn--primary btn--block" data-act="ob.selfie">Take my photo</button>`);

    case 'trade': return quizPanel(p, 'trade', `${esc(cat.name)} — five questions`);
    case 'conduct': return quizPanel(p, 'conduct', 'How SAAHAA works — six questions');

    case 'payout': return F(`
      <input id="obUpi" placeholder="yourname@upi" autocomplete="off" inputmode="email"
        style="width:100%;height:46px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);font-size:16px">
      <p class="micro muted" style="margin:8px 0 10px">PhonePe, GPay, Paytm — any UPI id. Your money lands here after each job is confirmed.</p>
      <button class="btn btn--primary btn--block" data-act="ob.payout">Save UPI</button>`);

    case 'agreement': return F(`
      <ul style="margin:0 0 12px 18px;padding:0">${V.TERMS.map(t => `<li class="tiny" style="margin-bottom:6px">${esc(t)}</li>`).join('')}</ul>
      <button class="btn btn--primary btn--lg btn--block" data-act="ob.agree">I agree — make me a SAAHAA pro</button>`);
  }
  return '';
}

function quizPanel(p, kind, title) {
  const st = V.quizStateFor(p, kind);
  if (st.locked) {
    const mins = Math.ceil((st.lockedUntil - Date.now()) / 60000);
    return `<div class="card glass" style="margin-top:10px;padding:14px;border-color:var(--warn)">
      <b>Three tries used.</b>
      <p class="tiny muted" style="margin-top:6px">Come back in ${mins > 60 ? Math.ceil(mins / 60) + ' hours' : mins + ' minutes'} and try again. Read the questions slowly — there is no trick.</p></div>`;
  }
  const bank = V.quizFor(p, kind);
  const mine = answers[kind] || [];
  const answered = bank.filter((_, i) => Number.isInteger(mine[i])).length;
  return `<div class="card glass" style="margin-top:10px;padding:14px">
    <div class="between" style="margin-bottom:8px"><b class="tiny">${title}</b>
      <span class="pill pill--soft">need ${PASS[kind]} of ${bank.length}${Number.isFinite(st.left) ? ` · ${st.left} ${st.left === 1 ? 'try' : 'tries'} left` : ''}</span></div>
    ${kind === 'conduct' && lastWrong.length ? `<div class="card" style="padding:10px 12px;background:var(--surface-2);margin-bottom:6px">
      <b class="micro">The rules you missed:</b>
      ${lastWrong.map(w => `<p class="micro" style="margin-top:4px">• ${esc(w.right)}</p>`).join('')}</div>` : ''}
    ${bank.map((item, qi) => `<div style="margin:12px 0 6px"><b class="tiny" style="display:block;margin-bottom:6px">${qi + 1}. ${esc(item.q)}</b>
      ${item.o.map((opt, oi) => `<button class="btn btn--block btn--sm ${mine[qi] === oi ? 'btn--primary' : 'btn--ghost'}"
        style="text-align:left;margin-bottom:4px;justify-content:flex-start;white-space:normal;height:auto;padding:8px 12px"
        data-act="ob.pick" data-kind="${kind}" data-q="${qi}" data-o="${oi}">${esc(opt)}</button>`).join('')}
    </div>`).join('')}
    <button class="btn btn--primary btn--block" style="margin-top:8px" data-act="ob.quiz" data-kind="${kind}"
      ${answered < bank.length ? 'disabled style="margin-top:8px;opacity:.5"' : ''}>
      ${answered < bank.length ? `Answer all ${bank.length}` : 'Check my answers'}</button>
  </div>`;
}

/* ── the moment ────────────────────────────────────────────── */
function verified(p, r, cat) {
  const bg = V.backgroundStatus(p);
  const t = tier(p.tier);
  const canBg = (p.tier | 0) === 2 && bg !== 'pending';
  return `
  ${header('You are verified', `${esc(cat.name)} · ${esc(t.label)}`)}
  <main class="wrap" style="padding-bottom:40px">
    <div class="glass glass--deep sheen rise" style="margin-top:var(--sp-6);text-align:center;padding:26px 18px;border-radius:var(--r-lg)">
      <div style="font-size:44px">✓</div>
      <h1 class="display" style="font-size:var(--fs-xl);margin:8px 0 6px">${esc(p.name.split(' ')[0])}, you are a SAAHAA pro.</h1>
      <p class="tiny muted">Jobs near ${esc(p.area)} can reach you now.</p>
      <div class="row" style="justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap">
        <span class="pill pill--ok">✓ ${esc(t.badge)}</span>
        <span class="pill pill--gold">Locally, professionally</span>
      </div>
    </div>

    <div class="sec"><div class="hd"><div><span class="eyebrow">Public</span><h2 class="h-sec">Your page is live</h2></div></div>
      <button class="cmd" style="width:100%;text-align:left" data-act="pro.open" data-id="${p.id}">
        <div class="row">
          <span class="avatar avatar--md" style="width:46px;height:46px;border-radius:50%;background:var(--accent-fill);color:var(--accent-on-fill);display:grid;place-items:center;font-weight:800;font-size:19px">${esc(p.name[0])}</span>
          <div class="grow"><span class="cmd__title">${esc(p.name)}</span>
            <span class="cmd__sub">${esc(cat.name)} · ${esc(p.area)} · saahaa.app/pro/${esc(p.id.slice(-6))}</span></div>
          <span class="cmd__action">View →</span>
        </div>
      </button>
      <p class="micro muted" style="margin-top:8px">Your ratings, badges and photos update on it by themselves. You never build or maintain anything. Share the link on WhatsApp — it is your professional card.</p>
    </div>

    <div class="sec"><div class="hd"><div><span class="eyebrow">Starting out</span><h2 class="h-sec">Your first ${PROVISIONAL_JOBS} jobs</h2></div></div>
      <div class="card glass"><p class="tiny">Your first jobs are up to <b>${M.fmt(PROVISIONAL_CAP)}</b>. This is not about trusting you — every new pro starts here, and it is how we can pay you before anyone knows your name. Finish <b>${PROVISIONAL_JOBS} jobs with no complaint</b> and it becomes ${M.fmt(tier(2).capPaise)} by itself. Those first payouts are also looked at by SAAHAA before release, usually within a day.</p></div>
    </div>

    <div class="sec"><div class="hd"><div><span class="eyebrow">Ladder</span><h2 class="h-sec">Go further</h2></div></div>
      <div class="card glass">
        <b class="tiny">Next: ${esc(tier(Math.min(4, (p.tier | 0) + 1)).label)}</b>
        <p class="tiny muted" style="margin:4px 0 10px">${esc(tier(Math.min(4, (p.tier | 0) + 1)).unlocks)}</p>
        ${bg === 'pending' ? `<span class="pill pill--info">Background check in progress</span>
            <p class="micro muted" style="margin-top:6px">SAAHAA is calling your reference. Usually 2 working days.</p>`
          : canBg ? `
            <input id="obRefName" placeholder="A reference (past customer or employer)" style="width:100%;height:44px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);margin-bottom:8px">
            <input id="obRefPhone" placeholder="Their 10-digit number" inputmode="numeric" maxlength="10" style="width:100%;height:44px;padding:0 14px;border:1.5px solid var(--border);border-radius:var(--r-pill);background:var(--surface-2);color:var(--ink-1);margin-bottom:8px">
            <label class="tiny" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px">
              <input type="checkbox" id="obConsent" style="margin-top:3px"> I consent to SAAHAA verifying my background, including police verification where required for in-home work.</label>
            <button class="btn btn--secondary btn--block" data-act="ob.bg">Request background check</button>`
          : (p.tier | 0) >= 3 ? certifiedCard(p) : ''}
      </div>
    </div>

    <button class="btn btn--primary btn--lg btn--block" style="margin-top:var(--sp-6)" data-act="nav.tab" data-tab="earn">Go to my jobs</button>
  </main>`;
}

function certifiedCard(p) {
  const e = V.certifiedEligible(p);
  const row = (ok, label) => `<div class="row" style="gap:8px;margin-bottom:4px"><span>${ok ? '✓' : '○'}</span><span class="tiny ${ok ? '' : 'muted'}">${label}</span></div>`;
  return `${row(e.jobs, `${e.completed} of ${V.CERTIFIED_RULE.jobs} jobs done`)}
    ${row(e.rating, `Rating ${e.avg.toFixed(1)} (need ${V.CERTIFIED_RULE.rating})`)}
    ${row(e.disputes, 'No upheld disputes')}
    <p class="micro muted" style="margin-top:6px">${e.jobs && e.rating && e.disputes ? 'You qualify — SAAHAA confirms Certified status within 2 working days.' : 'Earned automatically from your work. Nothing to submit.'}</p>`;
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
    case 'ob.selfie':       V.submitSelfie(p); toast('Photo saved'); break;
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
  return `<button class="cmd glass glass--deep sheen" style="width:100%;text-align:left"
      data-act="nav.onboard">
    <div class="between"><div class="grow">
      <span class="eyebrow">Not live yet</span>
      <span class="cmd__title">Finish verification to start earning</span>
      <span class="cmd__sub">Step ${r.next.n} of ${V.STEPS.length}: ${esc(r.next.title)} · ${r.pct}% done</span></div>
      <span class="pill pill--gold">${r.pct}%</span></div>
    <div style="height:5px;border-radius:99px;background:rgba(255,255,255,.18);margin-top:10px;overflow:hidden">
      <i style="display:block;height:100%;width:${r.pct}%;background:var(--gold-grad-soft)"></i></div>
    <span class="cmd__action">Continue</span>
  </button>`;
}
