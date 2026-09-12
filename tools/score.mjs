/* SAAHAA · tools/score.mjs — the product, scored by machine, for free.
 *
 * WHY THIS EXISTS. Every round of this project has been scored by a language
 * model reading screens, which costs real money and returns a different list
 * each time. Most of what those audits found was not subtle: a total its own
 * lines do not sum to, an English sentence on a Telugu money screen, a raw
 * translation key, an irreversible button with no confirmation. Those are
 * MECHANICAL, and a machine can check them a thousand times for nothing.
 *
 * So this scores what can be counted, and leaves judgement to whoever is doing
 * the judging. It is deliberately harsh and deliberately stable: the same tree
 * scores the same number every run, so the number means something when it
 * moves.
 *
 * WHAT IT CANNOT DO, stated plainly: it cannot tell you "cheapest here" is on
 * the dearest quote, or that a stale snapshot wipes a verification record.
 * Those needed reasoning. This catches the eighty per cent that does not, so
 * the expensive reader is spent on the twenty that does.
 *
 * Run: node tools/score.mjs            (add --json for a machine-readable line)
 */

const U = p => new URL('../' + p, import.meta.url).href;

/* ── the same Node shim the render gate uses ──────────────── */
class Mem { #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); } clear() { this.#m.clear(); }
  key(i) { return [...this.#m.keys()][i] ?? null; } get length() { return this.#m.size; } }
globalThis.__SAAHAA_STRICT = true;
globalThis.localStorage = new Mem(); globalThis.sessionStorage = new Mem();
globalThis.window = { location: { hash: '', search: '', pathname: '/', href: 'http://localhost/' },
  addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.location = globalThis.window.location;
Object.defineProperty(globalThis, 'navigator',
  { value: { languages: ['en'], language: 'en', onLine: true }, configurable: true });
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {},
  addEventListener() {}, removeEventListener() {}, focus() {}, remove() {}, blur() {},
  scrollIntoView() {}, querySelector: () => null, querySelectorAll: () => [],
  closest: () => null, contains: () => false, insertAdjacentHTML() {},
  value: '', textContent: '', innerHTML: '', dataset: {}, children: [] });
globalThis.document = { documentElement: { getAttribute: () => null, setAttribute() {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => null, createElement: el,
  body: { appendChild() {}, classList: { add() {}, remove() {} } } };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const ctx   = await import(U('src/core/ctx.js'));
const store = await import(U('src/core/store.js'));
const flags = await import(U('src/core/flags.js'));
await import(U('src/domain/catalog.services.js'));
await import(U('src/domain/catalog.retail.js'));
const { defaultState } = await import(U('src/domain/state.js'));
const { buildSeed } = await import(U('src/domain/seed.js'));
const i18n = await import(U('src/ui/i18n.js'));
const F = await import(U('src/domain/flow.js'));
const A = await import(U('src/domain/auction.js'));

async function world() {
  const s = store.createStore(store.combineFromRegistry(), defaultState());
  ctx.ctx.store = s; ctx.ctx.render = () => {}; ctx.ctx.go = () => {};
  const seed = await buildSeed();
  flags.set('SIM_MARKET', false);
  ['users', 'partners', 'shops', 'products'].forEach(k => s.dispatch({ type: 'seed/' + k, payload: seed[k] }));
  s.dispatch({ type: 'seed/done' });
  return s;
}
const S = await world();
const st = ctx.getState();
const pro = st.partners[0];
const shop = st.shops.find(x => x.deliveryMode !== 'pickup_only') || st.shops[0];
const cust = st.users.find(u => u.role === 'customer');
ctx.saveSession({ ...cust, address: '302, Sai Nilayam, Road No 4' });

const orders  = await import(U('src/ui/views/orders.js'));
const shops   = await import(U('src/ui/views/shops.js'));
const home    = await import(U('src/ui/views/home.js'));
const account = await import(U('src/ui/views/account.js'));
const partner = await import(U('src/ui/views/partner.js'));
const auth    = await import(U('src/ui/views/auth.js'));

const job = await F.bookService({ catId: pro.cat, partner: pro, sub: null });

/* Every screen worth scoring, and whether money is decided on it. */
function screens() {
  const out = [];
  const add = (name, money, fn) => { try { out.push({ name, money, html: String(fn() || '') }); }
    catch (e) { out.push({ name, money, html: '', threw: e.message }); } };
  add('home', false, () => home.render());
  add('shops list', false, () => shops.renderList());
  add('shop page', true, () => shops.renderShop(shop.id));
  add('cart', true, () => shops.renderCart());
  add('orders list', false, () => orders.renderList());
  add('order detail', true, () => orders.renderDetail(job && job.id));
  add('account', true, () => account.render());
  add('sign in', false, () => { auth.setAuthTab('signin'); auth.setAuthRole('customer'); return auth.render(); });
  add('sign up · pro', true, () => { auth.setAuthTab('signup'); auth.setAuthRole('partner'); return auth.render(); });
  add('sign up · shop', true, () => { auth.setAuthTab('signup'); auth.setAuthRole('shop'); return auth.render(); });
  ctx.saveSession({ key: pro.userKey || 'P1', name: pro.name, role: 'partner', code: 'P20260001' });
  add('pro console', true, () => partner.renderPartner());
  ctx.saveSession({ key: shop.ownerKey || 'S1', name: shop.name, role: 'shop', code: 'S20260001', shopId: shop.id });
  add('shop console', true, () => partner.renderShopAdmin());
  ctx.saveSession({ ...cust, address: '302, Sai Nilayam' });
  return out;
}

/* visible text only — script and style are not what a person reads */
const textOf = html => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

const LATIN = /[A-Za-z]{3,}/g;
const INDIC = /[ऀ-ॿఀ-౿]/g;

/* Words that are not translation failures: brands, units, codes. */
const EXEMPT = /^(SAAHAA|UPI|GST|FSSAI|MRP|OTP|PBKDF2|km|kg|ml|pack|btl|can|bag|Rs|INR|id|UTR|API|SMS|PAN|Aadhaar)$/i;

const checks = [];
const fail = (id, weight, what, detail = '') => checks.push({ id, weight, ok: false, what, detail });
const pass = (id, weight, what) => checks.push({ id, weight, ok: true, what });

const all = screens();

/* ── 1 · every screen builds ─────────────────────────────── */
all.forEach(s => s.threw
  ? fail('builds:' + s.name, 10, `${s.name} builds`, s.threw)
  : pass('builds:' + s.name, 10, `${s.name} builds`));

/* ── 2 · no raw translation key reaches a person ──────────── */
all.forEach(s => {
  const raw = (textOf(s.html).match(/\b[a-z]{2,10}\.[a-zA-Z]{3,20}\b/g) || [])
    .filter(k => i18n.t(k) === k && /^(pay|order|shop|earn|job|ask|cart|auth|money|bill|ret|leg)\./.test(k));
  raw.length ? fail('keys:' + s.name, 6, `${s.name} shows no raw key`, raw.slice(0, 3).join(', '))
             : pass('keys:' + s.name, 6, `${s.name} shows no raw key`);
});

/* ── 3 · Telugu coverage, weighted hardest where money is ─── */
i18n.setLang && i18n.setLang('te');
const te = screens();
te.forEach(s => {
  const txt = textOf(s.html);
  const latin = (txt.match(LATIN) || []).filter(w => !EXEMPT.test(w));
  const indic = (txt.match(INDIC) || []).length;
  const total = latin.length + indic;
  const pct = total ? Math.round((indic / total) * 100) : 100;
  const need = s.money ? 60 : 40;           // money screens are held to a higher bar
  const w = s.money ? 8 : 4;
  pct >= need
    ? pass('te:' + s.name, w, `${s.name} is ${pct}% Telugu (needs ${need}%)`)
    : fail('te:' + s.name, w, `${s.name} is only ${pct}% Telugu (needs ${need}%)`,
           latin.slice(0, 6).join(' '));
});
i18n.setLang && i18n.setLang('en');

/* ── 4 · money columns add up to the total beside them ────── */
{
  const M = await import(U('src/core/money.js'));
  const rows = [];
  const scan = html => {
    /* every m-kv row: label + a number; the one marked --total must equal the
       sum of the plain ones above it in the same block */
    const kv = [...html.matchAll(/<div class="m-kv([^"]*)"[^>]*>[\s\S]*?<span class="num[^"]*">\s*[−-]?\s*₹?([\d,]+(?:\.\d{2})?)/g)];
    let sum = 0, total = null;
    kv.forEach(m => {
      const v = Math.round(parseFloat(m[2].replace(/,/g, '')) * 100);
      if (/--total/.test(m[1])) total = v; else sum += v;
    });
    if (total != null && kv.length > 2) rows.push({ sum, total });
  };
  all.filter(s => s.money).forEach(s => scan(s.html));
  const bad = rows.filter(r => Math.abs(r.sum - r.total) > rows.length * 100);
  bad.length
    ? fail('sums', 12, 'every money column sums to its own total',
           bad.slice(0, 2).map(b => `${M.fmt2(b.sum)} vs ${M.fmt2(b.total)}`).join('; '))
    : pass('sums', 12, `every money column sums to its own total (${rows.length} checked)`);
}

/* ── 5 · irreversible actions confirm first ───────────────── */
{
  const IRREVERSIBLE = ['cancel.confirm', 'dispute.send', 'wallet.withdraw.do', 'shop.withdraw.do', 'noshow.confirm'];
  const appjs = await (await import('node:fs/promises')).readFile(new URL(U('src/app.js')), 'utf8');
  const missing = IRREVERSIBLE.filter(a => !appjs.includes(`'${a}'`));
  missing.length
    ? fail('confirm', 8, 'every irreversible action has a confirmed variant', missing.join(', '))
    : pass('confirm', 8, 'every irreversible action has a confirmed variant');
}

/* ── 6 · the gates themselves ─────────────────────────────── */
{
  const { execSync } = await import('node:child_process');
  const gates = [
    ['parse', 'node --experimental-vm-modules tools/lint-parse.mjs'],
    ['i18n', 'node tools/lint-i18n.mjs'],
    ['tests', 'node tools/test-node.mjs'],
    ['journeys', 'node tools/journey.mjs'],
    ['payments', 'node tools/pay-journey.mjs'],
    ['worker', 'node tools/worker-test.mjs'],
    ['images', 'node tools/img-test.mjs'],
    ['views', 'node tools/render-views.mjs'],
  ];
  gates.forEach(([name, cmd]) => {
    try { execSync(cmd, { stdio: 'pipe', cwd: new URL('../', import.meta.url).pathname.replace(/^\//, '') });
      pass('gate:' + name, 10, `gate ${name} passes`); }
    catch (e) { fail('gate:' + name, 10, `gate ${name} passes`, 'exit ' + e.status); }
  });
}

/* ── the number ──────────────────────────────────────────── */
const got = checks.filter(c => c.ok).reduce((n, c) => n + c.weight, 0);
const max = checks.reduce((n, c) => n + c.weight, 0);
const score = Math.round((got / max) * 1000) / 10;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ score, got, max,
    failed: checks.filter(c => !c.ok).map(c => ({ id: c.id, what: c.what, detail: c.detail })) }));
} else {
  console.log('\n  SAAHAA · machine score\n');
  checks.filter(c => !c.ok).forEach(c =>
    console.log(`      x [${String(c.weight).padStart(2)}] ${c.what}${c.detail ? '  — ' + c.detail : ''}`));
  const bar = n => '█'.repeat(Math.round(n / 2.5)) + '░'.repeat(40 - Math.round(n / 2.5));
  console.log(`\n  ${bar(score)}  ${score}/100   (${got} of ${max} weighted points)`);
  console.log(`  ${checks.filter(c => c.ok).length} of ${checks.length} checks pass\n`);
}
process.exit(0);
