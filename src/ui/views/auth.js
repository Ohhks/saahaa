/* SAAHAA · ui/views/auth.js — one account spine, three partner branches.
   Panel V2-B1 (confidence 5): a single "Partner" signup that branches to
   Worker / Shop / Professional keeps one auth + wallet + rating spine, and
   lets a kirana owner who also does delivery hold both roles on one number. */

import { esc, toast } from '../dom.js';
import { ctx, getState, dispatch, saveSession } from '../../core/ctx.js';
import { sha256 } from '../../core/crypto.js';
import { nid } from '../../core/id.js';
import { toPaise } from '../../core/money.js';
import { live } from '../../core/registry.js';
import { AREA_NAMES } from '../../domain/match.js';
import { mark, pillarRow } from '../logo.js';
import { SEED_LOGIN_HINT } from '../../domain/seed.js';
import * as audit from '../../core/audit.js';

let tab = 'login';        // login | signup
let role = 'customer';    // customer | partner | shop
export const setAuthTab = t => { tab = t; };
export const setAuthRole = r => { role = r; };

const svcCats = () => live('category').filter(c => c.kind === 'service');
const retCats = () => live('category').filter(c => c.kind === 'retail');

export function render() {
  return `
  <header class="hdr on-plum" style="border-radius:0 0 var(--r-xl) var(--r-xl)">
    <div class="wrap inner">
      <button class="btn btn--ghost tap" data-act="nav.home" aria-label="Back">←</button>
      <div class="grow" style="text-align:center">${mark(34, { glow: false })}</div>
      <span style="width:44px"></span>
    </div>
    <div class="wrap" style="text-align:center;padding-bottom:8px">
      <div class="wordmark" style="font-size:22px">SAAHAA</div>
      <p class="micro muted" style="letter-spacing:.14em;margin-top:4px">TOGETHER, WE ELEVATE LIFE</p>
    </div>
  </header>

  <main class="wrap">
    <div class="chiprow" style="margin:var(--sp-7) 0">
      <button class="chip ${tab === 'login' ? 'on' : ''}" data-act="auth.tab" data-tab="login">Sign in</button>
      <button class="chip ${tab === 'signup' ? 'on' : ''}" data-act="auth.tab" data-tab="signup">Create account</button>
    </div>

    ${tab === 'login' ? loginForm() : signupForm()}

    <div class="card" style="margin-top:var(--sp-8);background:var(--surface-2)">
      <b class="tiny">Demo accounts — password <code>123</code></b>
      <p class="micro muted" style="margin-top:8px;line-height:1.7">
        Customer · ${esc(SEED_LOGIN_HINT.customer)}<br>
        Partner &nbsp;· ${esc(SEED_LOGIN_HINT.partner)}<br>
        Shop &nbsp;&nbsp;&nbsp;&nbsp;· ${esc(SEED_LOGIN_HINT.shop)}<br>
        Admin &nbsp;&nbsp;· ${esc(SEED_LOGIN_HINT.admin)} → sign in as <b>admin</b> below
      </p>
    </div>
    <div style="height:60px"></div>
  </main>`;
}

function loginForm() {
  return `
  <div class="field"><input id="lgName" placeholder=" " autocomplete="name"><label>Your name (or "admin")</label></div>
  <div class="field"><input id="lgMobile" inputmode="numeric" maxlength="10" placeholder=" " autocomplete="tel"><label>10-digit mobile</label></div>
  <div class="field"><input id="lgPass" type="password" placeholder=" " autocomplete="current-password"><label>Password</label></div>
  <button class="btn btn--primary btn--lg btn--block" data-act="auth.login">Sign in</button>
  <p class="micro muted" style="text-align:center;margin-top:12px">
    Signing in as <b>admin</b> opens the admin console right here in the site.</p>`;
}

function signupForm() {
  return `
  <div class="chiprow" style="margin-bottom:var(--sp-6)">
    ${[['customer','🙋 I need services'],['partner','🔧 I do a trade'],['shop','🏪 I run a shop']]
      .map(([r, l]) => `<button class="chip ${role === r ? 'on' : ''}" data-act="auth.role" data-role="${r}">${l}</button>`).join('')}
  </div>

  <div class="field"><input id="suName" placeholder=" " autocomplete="name"><label>${role === 'shop' ? 'Shop name' : 'Full name'}</label></div>
  <div class="field"><input id="suMobile" inputmode="numeric" maxlength="10" placeholder=" " autocomplete="tel"><label>10-digit mobile</label></div>
  <div class="field"><input id="suPass" type="password" placeholder=" " autocomplete="new-password"><label>Create a password</label></div>
  <div class="field">
    <select id="suArea">${AREA_NAMES.map(a => `<option>${esc(a)}</option>`).join('')}</select>
    <label>Your area</label>
  </div>

  ${role === 'partner' ? `
    <div class="field">
      <select id="suCat">${svcCats().map(c => `<option value="${c.id}">${c.ico} ${esc(c.name)}</option>`).join('')}</select>
      <label>What do you do?</label>
    </div>
    <div class="field"><input id="suAsk" inputmode="numeric" placeholder=" "><label>Your typical price (₹)</label></div>
    <p class="tiny muted" style="margin:-4px 0 16px">
      You keep <b>100%</b> of this. SAAHAA's fee is added on top of it, paid by the customer.</p>` : ''}

  ${role === 'shop' ? `
    <div class="field">
      <select id="suCat">${retCats().map(c => `<option value="${c.id}">${c.ico} ${esc(c.name)}</option>`).join('')}</select>
      <label>Shop type</label>
    </div>
    <p class="tiny muted" style="margin:-4px 0 16px">
      Next you'll add products by tapping them from our ready-made list — about six seconds each.
      SAAHAA takes 3–5%, not 25%.</p>` : ''}

  <button class="btn btn--primary btn--lg btn--block" data-act="auth.signup">
    Create ${role === 'shop' ? 'shop' : role} account</button>
  <p class="micro muted" style="text-align:center;margin-top:12px">
    Creating an account does not give access on its own — sign in afterwards.</p>`;
}

/* ── handlers ──────────────────────────────────────────────── */
const val = id => (document.getElementById(id) || {}).value || '';

export async function doLogin() {
  const name = val('lgName').trim(), mobile = val('lgMobile').trim(), pw = val('lgPass');
  if (name.toLowerCase() === 'admin') { ctx.go('admin'); return; }
  if (!name || !/^\d{10}$/.test(mobile)) { toast('Name and a 10-digit mobile, please', 'danger'); return; }
  const key = (name + '|' + mobile).toLowerCase();
  const u = getState().users.find(x => x.key === key);
  if (!u) { toast('No account with those details — create one first', 'danger'); return; }
  const h = await sha256(pw);
  if (u.pass && u.pass !== h) { toast('Wrong password', 'danger'); return; }
  saveSession({ ...u });          // survives a refresh and a PWA relaunch
  audit.record('user.login', { key, role: u.role }, key);
  toast(`Welcome back, ${u.name.split(' ')[0]}`);
  ctx.go(u.role === 'partner' ? 'partner' : u.role === 'shop' ? 'shopadmin' : 'home');
}

export async function doSignup() {
  const name = val('suName').trim(), mobile = val('suMobile').trim(), pw = val('suPass');
  const area = val('suArea') || 'Madhapur';
  if (!name || !/^\d{10}$/.test(mobile)) { toast('Name and a 10-digit mobile, please', 'danger'); return; }
  if (pw.length < 3) { toast('Pick a password of at least 3 characters', 'danger'); return; }
  const key = (name + '|' + mobile).toLowerCase();
  if (getState().users.some(u => u.key === key)) { toast('That account already exists — sign in', 'danger'); return; }

  const pass = await sha256(pw);
  const id = nid('u');
  const user = { key, id, name, mobile, role, pass, area, tier: role === 'customer' ? 1 : 1, createdAt: Date.now() };

  if (role === 'partner') {
    const pid = nid('p');
    user.partnerId = pid;
    dispatch({ type: 'partner/add', payload: {
      id: pid, userKey: key, name, cat: val('suCat') || 'repair',
      ask: toPaise(Number(val('suAsk')) || 500), area, tier: 1, online: true,
      completed: 0, starts: 0, onTimeStarts: 0, ratings: [], lastActiveTs: Date.now() } });
  }
  if (role === 'shop') {
    const sid = nid('s');
    user.shopId = sid;
    dispatch({ type: 'shop/add', payload: {
      id: sid, ownerKey: key, name, catId: val('suCat') || 'kirana', area, mobile,
      prepMins: 20, radiusKm: 3, status: 'active', isOpen: true,
      minOrder: toPaise(149), freeDeliveryAbove: toPaise(499), deliveryMode: 'both',
      selfDeliveryFee: toPaise(25), fillRate: 100, ratingAvg: 0, ratingCount: 0,
      ordersCompleted: 0, badges: [], fssai: '', drugLicence: '', onboardedAt: Date.now() } });
  }

  dispatch({ type: 'user/add', payload: user });
  audit.record('user.signup', { key, role }, key);
  toast('Account created — now sign in');
  tab = 'login';
  ctx.render();
}

export function logout() {
  saveSession(null);
  toast('Signed out');
  ctx.go('home');
}
