/* SAAHAA · ui/views/auth.js — one account spine, three partner branches.
   Panel V2-B1 (confidence 5): a single "Partner" signup that branches to
   Worker / Shop / Professional keeps one auth + wallet + rating spine, and
   lets a kirana owner who also does delivery hold both roles on one number.

   TWO THINGS THAT DO NOT CHANGE

   1. SIGN IN IS MOBILE + PASSWORD. A name is not an identifier — two Ramesh
      Kumars on one street could not both sign in, and nobody remembers whether
      they typed "Ramesh" or "Ramesh Kumar" six weeks ago. The number is the
      identity everywhere else in this app (the door code, payouts, the shop's own
      board), so it is the identity here too. The internal `key` is unchanged,
      so every record that points at it still resolves.

   2. YOU CAN ENROL ANYWHERE ON EARTH. Signup takes a PLACE: search it, drop on
      it, or let the device say where you are — and the Hyderabad areas remain
      as one-tap chips for the people who prefer them. We store
      `loc {lat, lng, label}` AND `area = label`, so every existing read of
      `area` keeps working while every distance can now be a real one.

   MODERNIST 8.0 — the mockup's WHICH SIDE ARE YOU ON is the sign-up entry:
   an accent block with the wordmark and "Together, we elevate life", three
   big choice rows, and the honest cost lines (₹0 to list · what an order
   costs · what an aggregator takes). The numbers are the engine's
   (pricing.liveMarkup, settings.getPricing, pricing.AGG_COMMISSION). Then
   the same forms, in .field language. A shop's form IS the mockup's SHOP
   SETUP screen: name, what you sell, where it is, then "Next — add your
   stock", which drops the owner into the console with the ready list.

   OPEN A SHOP (8.1) — "so that everyone can list their products". The shop
   branch is now a journey, not a form: the eight retail categories are a
   picker with each category's own accent, its icon, its aisle count and the
   fee IT charges; the shop's front is photographed here, before the shop row
   exists, and optionally — skipping it blocks nothing; and somebody who is
   already signed in is told in one line that this is a SECOND account on
   their number, not a replacement for the one they have. It ends on
   views/onboard.js's "you're live", which shows them what they made. */

import { mount, esc, toast, sheet, delegate } from '../dom.js';
import * as ID from '../../domain/identity.js';
import { liveMarkup, AGG_COMMISSION } from '../../domain/pricing.js';
import { getPricing } from '../../domain/settings.js';
import { icon, hasIcon } from '../icons.js';
import { ctx, getState, dispatch, saveSession, me } from '../../core/ctx.js';
import * as photoUI from '../photo.js';
import { sha256 } from '../../core/crypto.js';
import { nid } from '../../core/id.js';
import { toPaise } from '../../core/money.js';
import * as M from '../../core/money.js';
import { live } from '../../core/registry.js';
import { AREA_NAMES, AREA_GEO } from '../../domain/match.js';
import { mark, pillarRow } from '../logo.js';
import * as gmap from '../map.js';
import { passwordProblem, normaliseMobile, loginGate, noteLoginFail, noteLoginOk }
  from '../../core/security.js';
import * as audit from '../../core/audit.js';

let tab = 'login';        // login | signup
let role = 'customer';    // customer | partner | shop
export const setAuthTab = t => { tab = t; };
export const setAuthRole = r => { role = r; };

const svcCats = () => live('category').filter(c => c.kind === 'service');
const retCats = () => live('category').filter(c => c.kind === 'retail');

/* ── the place step's own state ────────────────────────────────
   Deliberately NOT in the store: an unsubmitted signup is not application
   state, and re-rendering the whole auth screen on every keystroke of a place
   search would wipe the name and password the user already typed. Everything
   here paints itself into the DOM directly. */
let suPlace = null;       // {lat, lng, label} — the chosen place
let suHits = [];          // last geocode results
let mapH = null, mapEl = null;
const HYD = { lat: 17.4486, lng: 78.3908 };

/* OPEN A SHOP — the same reasoning, for the two things a shop needs and a
   customer does not: WHAT IT SELLS and WHAT ITS FRONT LOOKS LIKE.

   `suCatId` is the chosen retail category. It used to be a bare <select> that
   a person had to know to look at; it is now a picker of the eight categories
   the product actually has, each carrying its own accent, its icon and the
   fee it charges — because the category is not a form field, it is the
   decision that shapes the aisles, the ready-made product list and the money.
   The hidden #suCat carries the answer, exactly the way #suArea carries the
   place, so every existing read of val('suCat') is unchanged.

   `suPhoto` is a photo id from core/photos.js, taken BEFORE the shop row
   exists — so it cannot go through data-act="photo.shop", which needs a shop
   id. It is stored the moment it is chosen and written onto the shop in
   doSignup(). It is optional and never blocks anything. */
let suCatId = '';
let suPhoto = '';

const chosenCat = () => retCats().find(c => c.id === suCatId) || null;

/* What a shop actually pays. The engine charges the CATEGORY's own rate and
   cap (domain/pricing.js quoteRetail), falling back to the dials — so this
   reads both, and never a typed number. */
function shopFee() {
  const P = getPricing(), c = chosenCat();
  return { pct: (c && c.takePct != null) ? c.takePct : P.retailTakePct,
           cap: (c && c.takeCapPaise != null) ? c.takeCapPaise : P.retailTakeCapPaise };
}

/* a registry accent is code, not user input — but it lands in a style
   attribute, so only a colour is ever let through */
const safeAccent = v => (/^#[0-9a-fA-F]{3,8}$/.test(String(v || '')) ? String(v) : 'var(--color-accent)');

const authCSS = `<style>
  .au{max-width:560px}
  .au__hdr.apphdr{padding-left:var(--gutter);padding-right:var(--gutter)}
  .au__hero{background:var(--color-accent);color:var(--accent-on-fill);padding:26px var(--gutter) 22px}
  .au__hero .wm{color:inherit;font:800 11px/1 var(--font-heading);letter-spacing:.2em;opacity:.85}
  .au__hero h1{font:800 32px/1.06 var(--font-heading);margin:14px 0 8px;letter-spacing:-.02em}
  .au__hero p{font-size:13px;opacity:.92;max-width:28ch}
  .au__side{display:block;width:100%;text-align:left;padding:16px 14px 16px 12px;border-bottom:1px solid var(--color-divider);border-left:4px solid transparent;color:inherit}
  .au__side[aria-pressed="true"]{background:var(--color-neutral-100);border-left-color:var(--color-accent)}
  :root[data-theme="dark"] .au__side[aria-pressed="true"]{background:var(--surface-2)}
  .au__side b{font:800 18px/1.15 var(--font-heading);display:block} .au__side span{font-size:12.5px;color:var(--ink-3);display:block;margin-top:5px}
  .au__cost{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:8px 0;border-bottom:1px solid var(--color-divider)}
  .au__cost:last-child{border-bottom:0}
  .au__form{padding:16px 0} .au__form .field{margin-bottom:14px}
  .au__step{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:14px 0 6px;border-top:2px solid var(--color-divider)}
  .au__step b{font:800 17px/1.2 var(--font-heading)} .au__step span{font:600 11px/1 var(--font-body);color:var(--ink-3)}
  .au__map{height:160px;border:2px solid var(--color-text);overflow:hidden;background:var(--surface-3);margin-top:8px}
  .au__foot{padding:12px 0;border-top:2px solid var(--color-divider);margin-top:8px}
  .au__foot .btn-primary{width:100%;justify-content:flex-start}
  .au__links{font-size:12px;color:var(--ink-3);display:flex;flex-wrap:wrap;gap:6px 14px;padding:16px 0}
  .au__links a{color:inherit;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}
  .au__cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;margin-top:2px}
  .au__cat{display:block;width:100%;min-width:0;text-align:left;padding:11px 12px;min-height:44px;
    border:1px solid var(--color-divider);border-left:4px solid var(--cat,var(--color-accent));background:var(--surface);color:inherit}
  .au__cat:hover{border-color:var(--color-text);border-left-color:var(--cat,var(--color-accent))}
  .au__cat .ic{display:block;color:var(--cat,var(--color-accent))}
  .au__cat b{display:block;font:800 14px/1.2 var(--font-heading);margin-top:7px;overflow-wrap:anywhere}
  .au__cat span{display:block;font-size:11.5px;line-height:1.35;color:var(--ink-3);margin-top:3px}
  .au__cat[aria-pressed="true"]{background:var(--color-accent);color:var(--accent-on-fill);border-color:var(--color-accent);border-left-color:var(--color-text)}
  .au__cat[aria-pressed="true"] .ic,.au__cat[aria-pressed="true"] span{color:inherit;opacity:.92}
  .au__shotpv img{display:block;width:100%;height:150px;object-fit:cover;border:2px solid var(--color-text);background:var(--surface-3)}
  .au__shotbox .btn{width:100%;justify-content:flex-start}
  @media (min-width:768px){ .au__hdr.apphdr{padding-left:var(--sp-8);padding-right:var(--sp-8)} .au__hero{padding-left:var(--sp-8);padding-right:var(--sp-8)} }
  @media (min-width:1024px){ .au__hdr.apphdr{padding-left:var(--sp-10);padding-right:var(--sp-10)} .au__hero{padding-left:var(--sp-10);padding-right:var(--sp-10)}
    .au{max-width:1100px} .au__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sp-10);align-items:start} }
</style>`;

export function render() {
  const html = `${authCSS}
  <header class="apphdr au__hdr">
    <button class="btn btn-ghost tap" style="min-width:44px" data-act="nav.home" aria-label="Back">${icon('back', { size: 18 })}</button>
    <div class="grow"><span class="wordmark">SAAHAA</span></div>
    <button class="btn btn-ghost" data-act="auth.tab" data-tab="${tab === 'login' ? 'signup' : 'login'}">${tab === 'login' ? 'Create account' : 'Sign in'}</button>
  </header>

  ${tab === 'signup' ? `<div class="au__hero">
    <span class="wm">SAAHAA</span>
    <h1>Together,<br>we elevate life</h1>
    <p>One circle for every service and every shop in your neighbourhood.</p>
  </div>` : ''}

  <main class="wrap au" style="padding-top:0">
    ${tab === 'login' ? loginForm() : signupForm()}

    <div class="au__links">
      <button class="btn btn-ghost btn--sm" style="padding:0" data-act="nav.admin">Owner? Admin console</button>
      <a href="#/legal/terms">Terms</a>
      <a href="#/legal/privacy">Privacy</a>
      <a href="#/legal/refunds">Refunds</a>
      <a href="#/legal/contact">Contact</a>
      <a href="#/legal/about">About</a>
    </div>
    <div style="height:40px"></div>
  </main>`;
  // the map lives in the markup we just built, so it can only be created once
  // the shell has mounted it
  scheduleMap();
  return html;
}

function loginForm() {
  return `
  <div class="au__step" style="border-top:0"><b>Sign in</b><span>Your number, or your SAAHAA ID</span></div>
  <div class="au__form">
    <div class="field"><input id="lgMobile" inputmode="text" maxlength="12" placeholder=" " autocomplete="username" autocapitalize="characters"><label>Mobile number or SAAHAA ID</label></div>
    <p class="micro muted" style="margin:-8px 0 14px">A SAAHAA ID — <b class="num">C20262001</b>, <b class="num">P20262001</b>, <b class="num">S20262001</b> —
      opens the account it names. Your mobile number works just as well; if it carries two accounts we ask which one.</p>
    <div class="field"><input id="lgPass" type="password" placeholder=" " autocomplete="current-password"><label>Password</label></div>
    <!-- Sign-in is mobile + password. This field is retired, not renamed: the id
         stays so the UI contract guard can see it was not silently dropped. -->
  </div>
  <div class="au__foot"><button class="btn btn-primary btn--lg" data-act="auth.login">Sign in</button>
    <p class="micro muted" style="margin-top:10px">Nothing else to remember. New here? <button class="more" data-act="auth.tab" data-tab="signup">Create an account</button></p>
    <p class="micro muted" style="margin-top:2px">Forgotten it? <button class="more" data-act="auth.forgot">Get back into your account</button></p></div>`;
}

/* ── which side are you on ────────────────────────────────────
   Three rows, one honest line each, then the cost lines. Every number is
   read from the engine, never typed here. */
function sideRows() {
  const pct = Math.round(liveMarkup() * 100);
  const F = shopFee();
  const rows = [
    ['customer', 'I need something done', 'Find pros and shops near you. Always free — no markup on their prices.'],
    ['partner',  'I offer a service',     `Quote jobs, keep 100% of your price. SAAHAA's ${pct}% is added on top and paid by the customer.`],
    ['shop',     'I run a shop',          `A storefront with your stock, live today. ${F.pct}% an order, capped at ${M.fmt(F.cap)}. No yearly plan.`],
  ];
  return `<div>
    ${rows.map(([r, t, s]) => `<button class="au__side tap" type="button" aria-pressed="${role === r ? 'true' : 'false'}" data-act="auth.role" data-role="${r}"><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join('')}
    <div style="padding:10px 0 4px">
      <div class="au__cost"><span class="muted">Cost to list</span><strong>₹0</strong></div>
      <div class="au__cost"><span class="muted">Cost per order</span><strong id="suCostLine">${costLine()}</strong></div>
      <div class="au__cost"><span class="muted">Typical aggregator</span><strong class="em">${Math.round(AGG_COMMISSION * 100)}%</strong></div>
    </div>
  </div>`;
}

/* ── the place step ────────────────────────────────────────────
   Search anywhere · use my location · drag the pin · or one of the twelve
   Hyderabad areas, which are chips like any other place because they now carry
   real coordinates (match.AREA_GEO). */
function placeStep() {
  return `
  <div class="field">
    <div>
      <div class="search" style="margin-top:2px">
        ${icon('search', { size: 18 })}
        <input id="suPlaceQ" type="search" placeholder="Search a place — area, town or city"
               aria-label="Search for your place">
        <button class="btn btn-secondary btn--sm" data-act="auth.geocode">Search</button>
      </div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn--sm" style="padding-left:0" data-act="auth.locate">${icon('pin', { size: 14 })} Use my location</button>
      </div>
      <div id="suMap" class="au__map"></div>
      <p class="micro muted" style="margin-top:6px">Drag the pin, or tap the map, to fix your exact spot. We use it to show you to people nearby — it is never shown as an address.</p>
      <div id="suResults" class="chiprow" style="flex-wrap:wrap;gap:8px;margin-top:10px">${resultChips()}</div>
      <p class="tiny" id="suPlaceLabel" style="margin-top:10px">${placeLine()}</p>
      <span class="eyebrow" style="display:block;margin-top:12px">Or a Hyderabad area</span>
      <div class="chiprow" style="flex-wrap:wrap;gap:6px;margin-top:6px">
        ${AREA_NAMES.map(a => quickChip(a)).join('')}
      </div>
      <!-- the chosen place's short label, so every existing read of "area"
           (search copy, matcher fallbacks, the pro's public page) still works -->
      <input id="suArea" type="hidden" value="${esc(suPlace ? suPlace.label : '')}">
    </div>
    <label>Where ${role === 'shop' ? 'the shop is' : 'you are based'}</label>
  </div>`;
}

function quickChip(name) {
  const g = AREA_GEO[name];
  if (!g) return '';
  const on = suPlace && suPlace.label === name;
  return `<button class="chip${on ? ' on' : ''}" data-act="auth.place"
    data-lat="${g[0]}" data-lng="${g[1]}" data-label="${esc(name)}">${esc(name)}</button>`;
}

function resultChips() {
  if (!suHits.length) return '';
  return suHits.map(h => `<button class="chip chip--smart" data-act="auth.place"
    data-lat="${h.lat}" data-lng="${h.lng}" data-label="${esc(h.label)}">${esc(h.label)}</button>`).join('');
}

function placeLine() {
  if (!suPlace) return '<span class="muted">No place chosen yet.</span>';
  return `<b>${esc(suPlace.label)}</b> <span class="muted">· ${suPlace.lat.toFixed(4)}, ${suPlace.lng.toFixed(4)}</span>`;
}

/* ── open a shop: the category step ────────────────────────────
   Eight cards, not a dropdown. Each one is the category's own name, its own
   icon and its own accent, and choosing one immediately says what SAAHAA will
   take on an order in that category — which is the only number that matters
   to somebody deciding whether to open a shop at all. */
function catStep() {
  return `
  <div class="field">
    <div>
      <div class="au__cats" id="suCatGrid" role="group" aria-label="What your shop sells">${catCards()}</div>
      <p class="tiny" id="suCatLine" style="margin-top:10px">${catLine()}</p>
      <!-- the answer, in the field every existing read already looks at -->
      <input id="suCat" type="hidden" value="${esc(suCatId)}">
    </div>
    <label>What your shop sells</label>
  </div>`;
}

function catCards() {
  return retCats().map(c => `<button type="button" class="au__cat tap" data-cat="${esc(c.id)}"
      aria-pressed="${suCatId === c.id ? 'true' : 'false'}" style="--cat:${safeAccent(c.accent)}">
      <span class="ic" aria-hidden="true">${icon(hasIcon(c.id) ? c.id : 'groupShops', { size: 20 })}</span>
      <b>${esc(c.name)}</b>
      <span>${esc(c.blurb || '')}</span>
    </button>`).join('');
}

function catLine() {
  const c = chosenCat();
  if (!c) return '<span class="muted">Pick one — it sets your aisles, the ready-made list you build your stock from, and what an order costs.</span>';
  const f = shopFee(), n = (c.aisles || []).length;
  return `<b>${esc(c.name)}</b> <span class="muted">· ${n} aisle${n === 1 ? '' : 's'} ready
    · SAAHAA takes ${f.pct}% of an order, never more than ${M.fmt(f.cap)}</span>`;
}

/* ── open a shop: the picture ──────────────────────────────────
   Optional, and said so out loud. The shop row does not exist yet, so this
   cannot use data-act="photo.shop" (which needs a shop id): the picture is
   shrunk and stored now, and its id is written onto the shop the moment the
   shop is created. */
function shotStep() {
  return `
  <div class="field">
    <div>
      <div id="suShot" class="au__shotbox">${shotInner()}</div>
      <p class="micro muted" style="margin-top:6px">Optional — your shop opens without it. A photo of the front is what somebody
        recognises from the street; you can add or change it any time from your console.</p>
    </div>
    <label>A photo of your shop</label>
  </div>`;
}

function shotInner() {
  const u = photoUI.url(suPhoto);
  if (!u) return `<button type="button" class="au__shot tap btn btn-secondary">
    ${icon('camera', { size: 18 })} Add a photo of your shop</button>`;
  return `<div class="au__shotpv">
    <img src="${u}" alt="The photo you chose of your shop front">
    <div class="row" style="gap:8px;margin-top:8px">
      <button type="button" class="au__shot tap btn btn-secondary btn--sm grow">Change photo</button>
      <button type="button" class="au__shotx tap btn btn-secondary btn--sm grow">Remove</button>
    </div>
  </div>`;
}

/* PAINT, NEVER RE-RENDER — the same rule the place step follows: a full
   render() here would wipe the shop name, mobile and password already typed.
   The cards toggle their own aria-pressed so the keyboard focus stays where
   the person put it. */
function paintCat() {
  document.querySelectorAll('.au__cat').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.cat === suCatId ? 'true' : 'false'));
  const hidden = document.getElementById('suCat');
  if (hidden) hidden.value = suCatId;
  const line = document.getElementById('suCatLine');
  if (line) mount(line, catLine());
  const cost = document.getElementById('suCostLine');
  if (cost) mount(cost, costLine());
}

function paintShot() {
  const box = document.getElementById('suShot');
  if (box) mount(box, shotInner());
}

/* Two delegated listeners, registered once with the module — the `idcopy`
   pattern in views/account.js. No new registered action exists, because none
   is needed: nothing here is dispatched and nothing here navigates. */
delegate('click', '.au__cat', (e, el) => {
  const id = el.dataset.cat || '';
  suCatId = suCatId === id ? '' : id;
  paintCat();
});

delegate('click', '.au__shot', async () => {
  const r = await photoUI.pick({ maxEdge: 900 });
  if (r && r.ok) { suPhoto = r.id; paintShot(); toast('Photo added'); }
  else if (r && !r.cancelled && r.reason) toast(r.reason, 'warn');
});

delegate('click', '.au__shotx', () => { suPhoto = ''; paintShot(); toast('Photo removed'); });

/* the one honest number on the "which side are you on" block, kept in step
   with whichever category is chosen */
function costLine() {
  const pct = Math.round(liveMarkup() * 100);
  if (role === 'shop') { const f = shopFee(); return `${f.pct}%, capped ${M.fmt(f.cap)}`; }
  return role === 'partner' ? `₹0 — the customer pays ${pct}% on top` : '₹0';
}

/* ── already inside? then this is a SECOND account, not an error ──
   A customer or a pro opening a shop keeps everything they have. Said in one
   line, before they wonder whether they are about to lose it. */
function secondAccountLine() {
  const s = me();
  if (!s || s.role === role) return '';
  const word = (ID.ROLE_LABEL[s.role] || 'account').toLowerCase();
  const code = ID.normaliseCode(s.code || '');
  const opening = role === 'shop' ? 'Opening a shop' : role === 'partner' ? 'Joining as a pro' : 'Opening a customer account';
  return `<p class="tiny" style="margin:0 0 14px;padding:10px 12px;border-left:4px solid var(--color-accent);background:var(--color-accent-100);color:var(--ink-1)">
    Signed in as <b>${esc(s.name)}</b>${ID.isCode(code) ? ` · <b class="num">${esc(code)}</b>` : ''} — your ${esc(word)} account.
    ${esc(opening)} adds a <b>second account on the same number</b>, with its own password, wallet and history.
    Your ${esc(word)} account is untouched; you can sign back into it any time.</p>`;
}

function signupForm() {
  const pct = Math.round(liveMarkup() * 100);
  const F = shopFee();
  const s = me();
  const title = role === 'shop' ? 'Open your shop' : role === 'partner' ? 'Your trade' : 'Your account';
  const step = role === 'shop' ? 'Name it · photograph it · then list your stock' : role === 'partner' ? 'Setup · then 7 verification steps' : 'One step';
  return `
  <div class="au__two">
    ${sideRows()}
    <div>
      <div class="au__step"><b>${title}</b><span>${step}</span></div>
      <div class="au__form">
        ${secondAccountLine()}
        <div class="field"><input id="suName" placeholder=" " autocomplete="name"><label>${role === 'shop' ? 'Shop name — what the board outside says' : 'Full name'}</label></div>
        <div class="field"><input id="suMobile" inputmode="numeric" maxlength="10" placeholder=" " autocomplete="tel" value="${esc(s ? String(s.mobile || '') : '')}"><label>10-digit mobile</label></div>
        <div class="field"><input id="suPass" type="password" placeholder=" " autocomplete="new-password"><label>${s && s.role !== role ? 'A password for this new account (8+ characters)' : 'Create a password (8+ characters)'}</label></div>

        ${role === 'partner' ? `
          <div class="field">
            <select id="suCat">${svcCats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
            <label>What do you do?</label>
          </div>
          <div class="field"><input id="suAsk" inputmode="numeric" placeholder=" "><label>Your typical price (₹)</label></div>
          <p class="micro muted" style="margin:-6px 0 14px">You keep <b>100%</b> of this. SAAHAA's ${pct}% is added on top of it, paid by the customer.</p>` : ''}

        ${role === 'shop' ? `
          ${catStep()}
          ${shotStep()}
          <p class="micro muted" style="margin:-6px 0 14px">Then you pick your stock from our ready list — about six seconds an item, with a price you set.
            SAAHAA takes ${F.pct}% an order, capped at ${M.fmt(F.cap)}, never ${Math.round(AGG_COMMISSION * 100)}%.</p>` : ''}

        ${placeStep()}
      </div>
      <div class="au__foot">
        <button class="btn btn-primary btn--lg" data-act="auth.signup">
          ${role === 'shop' ? 'Open my shop' : role === 'partner' ? 'Next — get verified' : 'Create my account'}</button>
        <p class="micro muted" style="margin-top:10px">One ${esc((ID.ROLE_LABEL[role] || 'account').toLowerCase())} account per mobile number —
          the same number can hold a customer account <i>and</i> a pro account, each with its own password, wallet and history.
          You get a SAAHAA ID (${role === 'shop' ? 'S' : role === 'partner' ? 'P' : 'C'}2026&hellip;) the moment this is done. ₹0 to join, ever.</p>
      </div>
    </div>
  </div>`;
}

/* ── the map, wired through ui/map.js and nothing else ────────── */
function scheduleMap() { setTimeout(mountMap, 0); }

async function mountMap() {
  const el = document.getElementById('suMap');
  if (!el) {                                  // we left the signup tab
    if (mapH) { mapH.destroy(); mapH = null; mapEl = null; }
    return;
  }
  if (el === mapEl && mapH) { paintMap(); return; }
  try { await gmap.ready(); }
  catch (e) {
    mount(el, '<p class="micro muted" style="padding:12px">Map unavailable — search or ' +
      '&ldquo;use my location&rdquo; still works.</p>');
    return;
  }
  const cur = document.getElementById('suMap');
  if (!cur) return;
  if (mapH) { mapH.destroy(); mapH = null; }
  mapEl = cur;
  const c = suPlace || HYD;
  mapH = gmap.mapInto(cur, { center: [c.lat, c.lng], zoom: suPlace ? 15 : 11 });
  if (mapH) mapH.on('click', p => setPlaceFrom(p));
  paintMap();
}

function paintMap() {
  if (!mapH) return;
  mapH.clear();
  if (!suPlace) return;
  mapH.pin(suPlace.lat, suPlace.lng, {
    color: '#ec3013', label: suPlace.label, draggable: true,
    onMove: p => setPlaceFrom(p),
  });
  mapH.fit([[suPlace.lat, suPlace.lng]]);
  mapH.invalidate();
}

/* a point on the map becomes a NAMED place — a pin with no name is a number
   the user cannot check */
async function setPlaceFrom(p) {
  setPlace({ lat: p.lat, lng: p.lng, label: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` });
  try {
    const r = await gmap.reverse(p.lat, p.lng);
    if (r && r.label) setPlace({ lat: p.lat, lng: p.lng, label: r.label });
  } catch (e) { /* offline or the geocoder is busy: the coordinates still stand */ }
}

/* paint, never re-render: a full render() here would wipe the name, mobile and
   password the user has already typed */
function setPlace(place) {
  suPlace = place;
  const lab = document.getElementById('suPlaceLabel');
  if (lab) mount(lab, placeLine());
  const hidden = document.getElementById('suArea');
  if (hidden) hidden.value = place ? place.label : '';
  paintMap();
}

/* ── the three actions app.js registered for this screen ─────── */
export async function useMyLocation() {
  toast('Asking your device where you are…');
  try {
    const p = await gmap.locate();
    await setPlaceFrom(p);
    toast('Got it — drag the pin if it is slightly off');
  } catch (e) {
    toast(e.message || 'Could not get your location — search for it instead', 'warn');
  }
}

export async function searchPlace() {
  const el = document.getElementById('suPlaceQ');
  const q = el ? el.value.trim() : '';
  if (q.length < 3) { toast('Type at least three letters', 'warn'); return; }
  const box = document.getElementById('suResults');
  if (box) mount(box, '<span class="micro muted">Searching…</span>');
  try {
    suHits = await gmap.geocode(q, { limit: 6 });
  } catch (e) {
    suHits = [];
    if (box) mount(box, '<span class="micro muted">Search is unavailable right now — drop the pin instead.</span>');
    return;
  }
  if (box) mount(box, suHits.length ? resultChips()
    : `<span class="micro muted">Nothing matched &ldquo;${esc(q)}&rdquo;.</span>`);
}

export function choosePlace(d) {
  if (!d || d.lat == null) return;
  setPlace({ lat: +d.lat, lng: +d.lng, label: String(d.label || 'Your place') });
}

/* ── handlers ──────────────────────────────────────────────── */
const val = id => (document.getElementById(id) || {}).value || '';

export async function doLogin(pickedKey = null) {
  const typed = val('lgMobile').trim(), pw = val('lgPass');
  if (!typed) { toast('Enter your mobile number or your SAAHAA ID', 'danger'); return; }

  /* A code names ONE account; a number may now carry several — a plumber who
     also buys groceries holds a C... and a P.... Both resolve here. */
  const r = ID.resolve(typed, getState().users);
  if (r.kind === 'unknown') { toast('That is not a 10-digit number or a SAAHAA ID', 'danger'); return; }

  /* Unlimited guesses against a 4-digit-thinking population is not a login
     form, it is a doorway. core/security.js keeps the count, against the
     NUMBER behind whatever was typed, so a code cannot be used to dodge it. */
  const gateKey = r.mobile || (r.matches[0] && normaliseMobile(r.matches[0].mobile)) || typed;
  const gate = loginGate(gateKey);
  if (gate.blocked) {
    toast(`Too many attempts — try again in ${Math.ceil(gate.waitMs / 1000)}s`, 'danger'); return;
  }

  if (!r.matches.length) {
    noteLoginFail(gateKey);
    toast(r.kind === 'code' ? 'No account with that ID' : 'No account on that number — create one first', 'danger');
    return;
  }
  /* Two accounts on one number: ask which, rather than guessing. The password
     is checked after the choice, so this reveals only what the person typing
     already knows — that this number is here. */
  if (r.matches.length > 1 && !pickedKey) { pickAccount(r.matches); return; }
  const u = pickedKey ? r.matches.find(x => x.key === pickedKey) : r.matches[0];
  if (!u) { toast('Pick which account to open', 'warn'); return; }
  const mobile = normaliseMobile(u.mobile);
  const h = await sha256(pw);
  if (u.pass && u.pass !== h) {
    const f = noteLoginFail(mobile);
    toast(f.blocked ? `Wrong password — locked for ${Math.ceil(f.waitMs / 1000)}s` : 'Wrong password', 'danger');
    return;
  }
  noteLoginOk(mobile);
  saveSession({ ...u });          // survives a refresh and a PWA relaunch
  audit.record('user.login', { key: u.key, code: u.code || null, role: u.role }, u.key);
  toast(`Welcome back, ${u.name.split(' ')[0]}`);
  ctx.go(u.role === 'partner' ? 'partner' : u.role === 'shop' ? 'shopadmin' : 'home');
}

/* One number, more than one account. A sheet, so the password typed
   underneath survives the choice — picking is not re-typing. */
export function pickAccount(matches) {
  sheet('Which account?', `
    <p class="tiny muted" style="margin-bottom:12px">This number has ${matches.length} accounts on it. They keep separate wallets,
      separate histories and separate passwords &mdash; the password you typed opens whichever you pick.</p>
    ${matches.map(u => `
      <button class="m-row" style="width:100%;text-align:left" data-act="auth.pick" data-key="${esc(u.key)}">
        <span class="thumb m-thumb" aria-hidden="true">${icon(u.role === 'partner' ? 'navEarn' : u.role === 'shop' ? 'groupShops' : 'person', { size: 18 })}</span>
        <span class="grow" style="min-width:0">
          <b style="display:block">${esc(ID.ROLE_LABEL[u.role] || 'Account')}${u.name ? ' \u00b7 ' + esc(u.name) : ''}</b>
          <small class="num" style="letter-spacing:.08em">${esc(ID.normaliseCode(u.code || ''))}</small>
        </span>
        <span aria-hidden="true">&rarr;</span>
      </button>`).join('')}`);
}

/* \u2500\u2500 the one moment they will write it down \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Sign-up is finished and the person is already inside; this sheet rides on
   top of the destination and says, plainly, what their account is called. The
   code is NOT a secret \u2014 printed whole, never masked. Nothing here changes
   what doSignup did: the account is announced, not created.

   The Copy button carries the class `idcopy`; ui/views/account.js registers
   the single delegated listener for it, so no new registered action exists. */
/* The line under the ID that tells a person what else this number holds. If a
   second account already exists it is NAMED, with its code, rather than
   offered as a possibility — the sheet must never invite someone to open an
   account they already have. */
function siblingLine(user) {
  const others = ID.accountsOn(user && user.mobile, getState().users)
    .filter(u => u.key !== user.key && ID.isCode(u.code));
  if (others.length) {
    const list = others.map(u => `a ${esc((ID.ROLE_LABEL[u.role] || 'Account').toLowerCase())} account (<b class="num">${esc(ID.normaliseCode(u.code))}</b>)`).join(' and ');
    return `This number also holds ${list} &mdash; separate account, separate password, separate wallet and history. They never mix.`;
  }
  const could = user.role === 'customer'
    ? 'a pro account, if you want to work as well as book'
    : 'a customer account, for when you are the one buying';
  return `This number can also hold ${could} &mdash; a separate account, with its own password, wallet and history.`;
}

export function announceNewId(user) {
  const code = ID.normaliseCode((user && user.code) || '');
  if (!ID.isCode(code)) return;
  const word = (ID.ROLE_LABEL[user.role] || 'Account').toLowerCase();
  const first = String(user.name || '').split(' ')[0];
  sheet('Your SAAHAA ID', `
    <p class="tiny muted" style="margin-bottom:14px">Welcome${first ? ', ' + esc(first) : ''}. This is what your ${esc(word)} account is called.</p>
    <div style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid var(--color-text);background:var(--color-surface)">
      <span style="flex:1;min-width:0">
        <span class="meta" style="display:block">Your ${esc(word)} ID</span>
        <b class="num" style="display:block;margin-top:2px;font:800 24px/1.1 var(--font-heading);letter-spacing:.1em;-webkit-user-select:all;user-select:all">${esc(code)}</b>
      </span>
      <button type="button" class="btn btn-secondary btn--sm idcopy tap" data-code="${esc(code)}"
        style="flex:none" aria-label="Copy your ${esc(word)} ID, ${esc(code)}">Copy</button>
    </div>
    <p class="micro muted" style="margin-top:12px">Write it down. Sign in with it or with your mobile number &mdash; either works.
      It is a name, not a secret: it says who you are, your password proves it.</p>
    <p class="micro muted" style="margin-top:8px">${siblingLine(user)}</p>
    <button class="btn btn-primary btn--block" style="margin-top:16px" data-act="sheet.close">Got it</button>`);
}

export async function doSignup() {
  const name = val('suName').trim(), mobile = normaliseMobile(val('suMobile')), pw = val('suPass');
  if (!name || !mobile) { toast('Name and a 10-digit mobile, please', 'danger'); return; }
  const pwErr = passwordProblem(pw, mobile);
  if (pwErr) { toast(pwErr, 'danger'); return; }
  if (role === 'shop' && !chosenCat()) {
    toast('Pick what your shop sells — tap one of the eight', 'danger');
    const g = document.getElementById('suCatGrid');
    if (g && g.scrollIntoView) g.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!suPlace) { toast(role === 'shop' ? 'Pick where the shop is — search it, use your location, or tap an area' : 'Pick where you are — search it, use your location, or tap an area', 'danger'); return; }

  const loc = { lat: suPlace.lat, lng: suPlace.lng, label: suPlace.label };
  const area = suPlace.label;
  /* One account per number PER ROLE. The same person may hold a customer
     account and a pro account on one number; what they may not hold is two of
     the same kind. The code is the key for accounts opened from here on —
     name+mobile was the old key, and it collided the moment one person
     wanted both. */
  const clash = ID.accountsOn(mobile, getState().users).find(u => u.role === role);
  if (clash) {
    toast(`This number already has a ${(ID.ROLE_LABEL[role] || role).toLowerCase()} account (${clash.code || 'existing'}) \u2014 sign in instead`, 'danger');
    return;
  }
  const key = ID.nextCode(role, getState().users);
  const code = key;

  const pass = await sha256(pw);
  const id = nid('u');
  const user = { key, code, id, name, mobile, role, pass, area, loc, tier: 1, createdAt: Date.now() };

  if (role === 'partner') {
    const pid = nid('p');
    user.partnerId = pid;
    /* Tier 0, offline. Signing up used to create a tier-1 pro who was online
       and bookable with no check of any kind between "typed a name" and
       "inside a customer's home". The ladder (domain/verification.js) is
       what moves them to tier 2 — automatically, in about ten minutes. */
    user.tier = 0;
    dispatch({ type: 'partner/add', payload: {
      id: pid, userKey: key, name, mobile, cat: val('suCat') || 'repair',
      ask: toPaise(Number(val('suAsk')) || 500), area, loc, tier: 0, online: false,
      completed: 0, starts: 0, onTimeStarts: 0, ratings: [], lastActiveTs: Date.now(),
      verification: { steps: {}, attempts: {} } } });
  }
  if (role === 'shop') {
    const sid = nid('s');
    user.shopId = sid;
    dispatch({ type: 'shop/add', payload: {
      id: sid, ownerKey: key, name, catId: val('suCat') || 'kirana', area, loc, mobile,
      /* the front, photographed during signup and already stored: the row
         carries the id, never the bytes (core/photos.js) */
      photo: suPhoto || '',
      prepMins: 20, radiusKm: 3, status: 'active', isOpen: true,
      minOrder: toPaise(149), freeDeliveryAbove: toPaise(499), deliveryMode: 'both',
      selfDeliveryFee: toPaise(25), fillRate: 100, ratingAvg: 0, ratingCount: 0,
      ordersCompleted: 0, badges: [], fssai: '', drugLicence: '', onboardedAt: Date.now() } });
  }

  dispatch({ type: 'user/add', payload: user });
  audit.record('user.signup', { key, role }, key);
  /* "Account created — now sign in" was a second form standing between a new
     partner and their first step. Sign them in and put them on the ladder. */
  saveSession({ ...user });
  audit.record('user.login', { key, role }, key);
  tab = 'login';
  /* the signup screen's own scratch state is finished with — a second shop
     opened later must start from a blank picker, not from this one's */
  suCatId = ''; suPhoto = '';
  if (role === 'partner') { toast(`Welcome, ${name.split(' ')[0]}. Ten minutes and you are earning.`); ctx.go('onboard'); }
  /* A shop goes to the same "you are live" screen a pro gets, because the
     moment is the same one: they typed a name and now they have a shop. It
     shows them what they made, then sends them to the console to list. */
  else if (role === 'shop') { toast(`${name} is live — now add what you sell`); ctx.go('onboard'); }
  else { toast(`Welcome, ${name.split(' ')[0]}`); ctx.go('home'); }
  /* AFTER the navigation, never before: go() closes any open sheet, so the
     announcement has to ride on top of the screen they landed on. */
  announceNewId(user);
}

export function logout() {
  saveSession(null);
  toast('Signed out');
  ctx.go('home');
}
