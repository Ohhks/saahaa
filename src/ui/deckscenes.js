/* SAAHAA · ui/deckscenes.js — presentation scenes for headless capture.

   Loaded ONLY when the page is opened with ?shot=<scene>. The capture URL is
   always `?shot=<scene>&demo=1`: production boots with an empty store, and
   these scenes need the example roster to walk through. (`shot` alone already
   implies demo in app.js; the flag is written out so the URL says what it
   does.)

   Each scene builds its state through the real domain functions — nothing is
   mocked, nothing is painted on — signs in as the right person, and walks to
   the screen. tools/shots.py then photographs it with headless Chrome, so the
   deck shows the running product rather than a mock-up of it. */

import { ctx, getState, dispatch, saveSession } from '../core/ctx.js';
import { nid } from '../core/id.js';
import { sha256 } from '../core/crypto.js';
import * as flow from '../domain/flow.js';
import * as auction from '../domain/auction.js';
import * as V from '../domain/verification.js';
import * as home from './views/home.js';
import * as ask from './views/ask.js';
import * as auth from './views/auth.js';
import * as admin from './views/admin.js';
import * as partner from './views/partner.js';
import * as orders from './views/orders.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const byMobile = m => getState().users.find(u => u.mobile === m);
function login(mobile) { const u = byMobile(mobile); if (!u) throw new Error('no user ' + mobile); saveSession({ ...u }); return u; }
function loginPartner(pid) { const u = getState().users.find(x => x.partnerId === pid); if (!u) throw new Error('no user for partner ' + pid); saveSession({ ...u }); return u; }
const CUSTOMER = '9000000001', SHOP_OWNER = '9200000001';

function dismissSplash() {
  const s = document.querySelector('.splash');
  if (!s) return;
  const b = s.querySelector('button'); if (b) b.click();
  setTimeout(() => document.querySelector('.splash')?.remove(), 50);
}
async function boot() {
  // wait for seed + first render; the splash is dismissed like a guest would
  for (let i = 0; i < 60 && !(getState().partners || []).length; i++) await sleep(100);
  dismissSplash(); await sleep(150); dismissSplash();
}

/* a brand-new partner, exactly as doSignup creates one */
async function newPartner(cat = 'plumbing') {
  const name = 'Ravi Kumar', mobile = '9876500001';
  const key = (name + '|' + mobile).toLowerCase();
  if (getState().users.some(u => u.key === key)) { saveSession({ ...byMobile(mobile) }); return V.myPartner(); }
  const pass = await sha256('123'); const id = nid('u'); const pid = nid('p');
  dispatch({ type: 'partner/add', payload: { id: pid, userKey: key, name, mobile, cat, ask: 55000, area: 'Madhapur', tier: 0,
    online: false, completed: 0, starts: 0, onTimeStarts: 0, ratings: [], lastActiveTs: Date.now(), verification: { steps: {}, attempts: {} } } });
  const user = { key, id, name, mobile, role: 'partner', pass, area: 'Madhapur', tier: 0, partnerId: pid, createdAt: Date.now() };
  dispatch({ type: 'user/add', payload: user });
  saveSession({ ...user });
  return V.myPartner();
}
async function ladder(upTo) {                    // walk the seven steps up to (not including) `upTo`
  let p = await newPartner();
  const steps = ['phone', 'identity', 'selfie', 'trade', 'conduct', 'payout', 'agreement'];
  for (const st of steps) {
    if (st === upTo) break;
    p = V.myPartner();
    /* 8.4.0 removed the fake SMS: there is no code to send and confirmPhone now
       takes the number the account was opened with, not four digits. This line
       still called the deleted sendPhoneCode, and because app.js swallows a
       scene error into console.error, every scene that walks the ladder came
       out as a blank screenshot instead of failing loudly. */
    if (st === 'phone')     { const u = (getState().users || []).find(x => x.key === p.userKey) || {};
                              V.confirmPhone(V.myPartner(), u.mobile || p.mobile || ''); }
    if (st === 'identity')  await V.submitIdentity(p, 'aadhaar', '234567894821');
    if (st === 'selfie')    V.submitSelfie(p);
    if (st === 'trade' || st === 'conduct') { const bank = V.quizFor(p, st); V.submitQuiz(p, st, bank.map(b => b.a)); }
    if (st === 'payout')    V.submitPayout(p, 'ravi@ybl');
    if (st === 'agreement') V.acceptAgreement(p);
  }
  return V.myPartner();
}
async function bookWithHero(catId) {
  login(CUSTOMER);
  const m = flow.findMatch(catId);
  const o = await flow.bookService({ catId, partner: m.hero });
  await sleep(1300);                              // the 900ms auto-accept
  return { o, partner: m.hero };
}
async function retailOrder() {
  login(CUSTOMER);
  const shop = getState().shops.find(s => s.name === 'Sri Lakshmi Kirana') || getState().shops[0];
  const prods = getState().products.filter(p => p.shopId === shop.id && p.active).slice(0, 3);
  prods.forEach(p => flow.addToCart(p, 1));
  const o = await flow.placeRetailOrder('rider');
  await sleep(1400);
  return o;
}
async function adminAt(section) {
  /* adminauth.login runs PBKDF2, which is real CPU time — headless Chrome's
     virtual-time budget can expire before it resolves and photograph the wrong
     screen. So the capture writes the session adminauth itself would write:
     same shape, same idle/absolute expiry checks apply. No password is used
     or held anywhere in this file. */
  const sess = { t: 'shot', start: Date.now(), touched: Date.now() };
  try { sessionStorage.setItem('SAAHAA_ADMIN_SESS', JSON.stringify(sess)); }
  catch (e) { console.warn('[shot] could not open an admin session', e); }
  admin.setSection(section);
  ctx.go('admin');
}
async function startAsk(catId) {
  login(CUSTOMER);
  const m = flow.findMatch(catId);
  const held = flow.previewBooking(catId, m.hero).quote.deal;
  ask.startAsk(catId, m.hero.id, held);
  return auction.myRequests()[0];
}

/* Bring a deep target into the frame WITHOUT scrolling: headless Chrome's
   --screenshot paints a blank frame when the window is scrolled more than
   about one viewport under virtual time. Translating the app root paints the
   same pixels a scrolled viewport would show, reliably. Capture-only. */
const scrollTo = sel => { const el = document.querySelector(sel); if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - Math.max(0, (window.innerHeight - el.offsetHeight) / 2);
  const app = document.getElementById('app');
  if (app) { app.style.transform = `translateY(-${Math.max(0, Math.round(y))}px)`; app.style.willChange = 'transform'; } };
/* Frame a block by its heading text (h2/h3/.eyebrow), heading ~90px from the top. */
const scrollToHeading = txt => {
  const el = [...document.querySelectorAll('h2, h3, .eyebrow, b, .cmd__title')].find(e => e.textContent.trim().toLowerCase().startsWith(txt.toLowerCase()));
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 90;
  const app = document.getElementById('app');
  if (app) { app.style.transform = `translateY(-${Math.max(0, Math.round(y))}px)`; app.style.willChange = 'transform'; } };

const SCENES = {
  /* ── customer ─────────────────────────────────────────────── */
  async 'c01-home'()  { ctx.go('home'); },
  async 'c02-search'(){ ctx.go('home'); home.setSearch('plumb'); ctx.render(); },
  async 'c03-repairs-match'() { login(CUSTOMER); ctx.go('home'); home.openCategory('repair'); },
  async 'c04-care-match'()    { login(CUSTOMER); ctx.go('home'); home.openCategory('salon'); },
  async 'c05-life-match'()    { login(CUSTOMER); ctx.go('home'); home.openCategory('tutor'); },
  async 'c06-ask-waiting'()   { await startAsk('appliance'); await sleep(9500); ctx.render(); },
  async 'c07-ask-choose'()    { const r = await startAsk('appliance'); await sleep(9000);
    dispatch({ type: 'request/patch', payload: { id: r.id, patch: { closesAt: Date.now() - 1 } } }); ctx.render(); },
  async 'c08-receipt'()       { const r = await startAsk('pest'); await sleep(9000);
    dispatch({ type: 'request/patch', payload: { id: r.id, patch: { closesAt: Date.now() - 1 } } }); ctx.render();
    const ranked = auction.ranked(r.id); const o = await auction.acceptBid(r.id, ranked.hero.id);
    ctx.go('order', o.id); ask.showReceipt(auction.requestById(r.id), ranked.hero.amount, ranked.hero.partnerName); },
  async 'c09-shops'()  { ctx.go('shops'); },
  async 'c10-cart'()   { login(CUSTOMER); const shop = getState().shops[0];
    getState().products.filter(p => p.shopId === shop.id && p.active).slice(0, 3).forEach(p => flow.addToCart(p, 1)); ctx.go('cart'); },
  async 'c11-tracker'(){ const { o } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE'); ctx.go('order', o.id); },
  async 'c12-account'(){ login(CUSTOMER); ctx.go('account'); },
  async 'c00-login'()  { auth.setAuthTab('login'); auth.setAuthRole('customer'); ctx.go('auth'); },
  async 'c13-track-map'(){ const { o } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE'); ctx.go('order', o.id);
    await sleep(300); orders.toggleMap(o.id); await sleep(2500); scrollTo('#orderMap'); },
  async 'c15-wallet'() { login(CUSTOMER); await flow.customerTopUp(50000); ctx.go('account'); await sleep(400); scrollTo('[data-act="cwallet.topup"]'); },
  async 'c16-nearby'() { login(CUSTOMER); ctx.go('nearby'); await sleep(2600); },
  async 'c17-chat'()   { const { o, partner: pr } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE');
    flow.sendChat(o.id, 'On my way — about 10 minutes.'); await sleep(200);
    login(CUSTOMER); flow.sendChat(o.id, 'Thanks. Gate code is 4471.'); ctx.go('chat', o.id); await sleep(600); },
  async 'c14-place'()  { login(CUSTOMER); ctx.go('home'); await sleep(300); home.openPlacePicker(); await sleep(2500); },

  /* ── partner ──────────────────────────────────────────────── */
  async 'p01-earn'()   { ctx.go('earn'); },
  async 'p02-signup'() { auth.setAuthTab('signup'); auth.setAuthRole('partner'); ctx.go('auth'); },
  async 'p03-phone'()  { await ladder('phone'); ctx.go('onboard'); },   // the step shows the pro's own code; nothing to remember
  async 'p04-id'()     { await ladder('identity'); ctx.go('onboard'); },
  async 'p05-quiz'()   { await ladder('trade'); ctx.go('onboard'); },
  async 'p06-conduct'(){ await ladder('conduct'); ctx.go('onboard'); },
  async 'p07-verified'(){ await ladder(null); ctx.go('onboard'); },
  async 'p08-propage'(){ const p = await ladder(null); ctx.go('pro', p.id); },
  async 'p09-console'(){ const { partner: pr } = await bookWithHero('repair'); loginPartner(pr.id); ctx.go('partner'); },
  async 'p10-bid'()    { login(CUSTOMER); const m = flow.findMatch('repair');
    const req = auction.postRequest({ catId: 'repair', slotType: 'now', held: { partnerId: m.hero.id, partnerName: m.hero.name, amount: 60000 } });
    await sleep(7000);
    const bidders = new Set(auction.bidsFor(req.id).map(b => b.partnerId));
    const pr = getState().partners.find(p => p.cat === 'repair' && p.id !== m.hero.id && !bidders.has(p.id) && (p.tier | 0) >= 2);
    loginPartner(pr.id); ctx.go('partner'); await sleep(300); ask.bidSheet(req.id, pr); },
  async 'p11-job'()    { const { o, partner: pr } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    loginPartner(pr.id); ctx.go('order', o.id); },
  async 'p12-shop'()   { login(SHOP_OWNER); partner.setShopTab('catalog'); ctx.go('shopadmin'); },
  async 'p14-standing'() { const { o, partner: pr } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    loginPartner(pr.id); ctx.go('partner'); await sleep(400); scrollTo('#refCode, #refName, #atJobs'); },
  async 'p13-place'()  { auth.setAuthTab('signup'); auth.setAuthRole('partner'); ctx.go('auth'); await sleep(2500); scrollTo('#suMap'); },

  /* ── admin ────────────────────────────────────────────────── */
  async 'a01-dashboard'() { await bookWithHero('plumbing'); await adminAt('dash'); },
  async 'a02-approvals'() { const p = await ladder(null); V.requestBackground(p, { refName: 'Suresh Contractor', refPhone: '9000012345', consent: true }); await adminAt('approvals'); },
  async 'a03-escrow'()    { const { o } = await bookWithHero('electrical'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    dispatch({ type: 'order/patch', payload: { id: o.id, patch: { otpVerified: true } } }); flow.advance(o.id, 'IN_PROGRESS');
    flow.addEvidence(o.id, 'After'); flow.markDone(o.id); await retailOrder(); await adminAt('escrow'); },
  async 'a04-disputes'()  { const { o } = await bookWithHero('cleaning'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    flow.raiseDispute(o.id, 'Late / No-show', ''); await adminAt('disputes'); },
  async 'a05-people'()    { await adminAt('people'); },
  async 'a06-moderation'(){ const { o } = await bookWithHero('plumbing'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    dispatch({ type: 'order/patch', payload: { id: o.id, patch: { otpVerified: true } } }); flow.advance(o.id, 'IN_PROGRESS');
    flow.addEvidence(o.id, 'After'); flow.markDone(o.id); await flow.confirmAndRelease(o.id, 1); flow.rateOrder(o.id, 5, 'Neat work, on time.');
    await adminAt('moderation'); },
  async 'a07-finance'()   { const { o } = await bookWithHero('appliance'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    dispatch({ type: 'order/patch', payload: { id: o.id, patch: { otpVerified: true } } }); flow.advance(o.id, 'IN_PROGRESS');
    flow.addEvidence(o.id, 'After'); flow.markDone(o.id); await flow.confirmAndRelease(o.id, 1); await adminAt('finance'); },
  async 'a08-system'()    { await adminAt('system'); },
  async 'a11-treasury'()   { const { o } = await bookWithHero('electrical'); flow.advance(o.id, 'EN_ROUTE'); flow.advance(o.id, 'ARRIVED');
    flow.verifyOtp(o.id, o.otp); flow.addEvidence(o.id, 'after'); flow.markDone(o.id); await flow.confirmAndRelease(o.id, 1);
    await adminAt('finance'); await sleep(400); scrollToHeading('Treasury'); },
  async 'a12-automation'() { await bookWithHero('plumbing'); await adminAt('approvals'); await sleep(400); scrollToHeading('Automation'); },
  async 'a09-charges'()   { await adminAt('finance'); await sleep(400); scrollToHeading('Charges'); },
  async 'a10-flow'()      { await bookWithHero('plumbing'); await adminAt('people'); await sleep(400); scrollTo('[data-act="admin.flow.pick"]'); },
};

export async function run(id) {
  document.documentElement.setAttribute('data-shot', 'loading');
  await boot();
  const fn = SCENES[id];
  if (!fn) { console.warn('[shot] unknown scene', id); return; }
  try { await fn(); } catch (e) { console.error('[shot] scene failed', id, e); }
  await sleep(400);
  document.documentElement.setAttribute('data-shot', id);   // the capture script waits for this
}
