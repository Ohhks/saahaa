/* SAAHAA · tools/admin-test.mjs — the owner console is not the customers' door.
 *
 * The console used to be a route in the customer app. Anyone could type
 * #/admin and be shown a sign-in box with the owner's username already filled
 * in, and a broken-ledger banner actively told customers and plumbers to "Open
 * Admin → Finance". Both are invitations to try a door that is not theirs.
 *
 * This checks the three things that keep it shut, and it checks them on the
 * BUILT files as well as the source, because the bundle is what ships.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = f => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');

let pass = 0; const fails = [];
const say = (ok, what, detail = '') => ok ? pass++ : fails.push(what + (detail ? '  — ' + detail : ''));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

/* 1 · two doors, one bundle */
say(!read('dist/index.html').includes('data-admin-host="1"'),
    'the customer bundle carries no admin-host marker');
say(!read('dist/404.html').includes('data-admin-host="1"'),
    'nor does the deep-link fallback the router boots on a hard refresh');
say(read('dist/admin.html').includes('<html lang="en" data-admin-host="1">'),
    'the owner console is its own document');
say(read('admin.html').includes('data-admin-host="1"') && read('index.html').indexOf('data-admin-host') === -1,
    'and the same is true of the sources they are built from');

/* 2 · the route does not exist without that marker */
const app = read('src/app.js');
say(/ADMIN_HOST \? \{ admin:/.test(app),
    'the admin view is only in the route table on the owner page');
say(/view === 'admin' && !ADMIN_HOST/.test(app),
    "and go('admin') lands on home anywhere else");

/* 3 · nobody is invited */
for (const f of ['src/ui/views/auth.js', 'src/ui/views/account.js']) {
  /* the guard is a ternary that may open a line or two above the row it wraps,
     so read a window rather than the single line — the first version of this
     check called a correctly guarded file a failure. */
  const all = strip(read(f)).split('\n');
  const idx = all.map((l, i) => [l, i]).filter(([l]) => /nav\.admin/.test(l));
  const bad = idx.filter(([, i]) => !/isLoggedIn\(\)/.test(all.slice(Math.max(0, i - 3), i + 2).join('\n')));
  say(idx.length > 0 && bad.length === 0,
      `${f.split('/').pop()} offers the console only to a signed-in owner`,
      bad.map(([l]) => l.trim()).join(' | ').slice(0, 80));
}

/* 4 · and no screen sends a customer or a pro there */
const SCREENS = ['src/app.js', 'src/ui/views/orders.js', 'src/ui/views/partner.js',
                 'src/ui/views/account.js', 'src/ui/views/earn.js', 'src/ui/views/home.js',
                 'src/ui/views/shops.js', 'src/ui/i18n.js'];
const told = [];
for (const f of SCREENS) {
  const hits = (strip(read(f)).match(/(?:Open|see|contact|visit|go to)\s+(?:the\s+)?Admin\b[^\n'"`]{0,40}/gi) || []);
  hits.forEach(h => told.push(`${f.split('/').pop()}: ${h.trim()}`));
}
say(told.length === 0, 'no screen tells a customer or a pro to open the admin console', told.slice(0, 3).join(' · '));

/* 5 · what they are told instead */
const i18n = read('src/ui/i18n.js');
say(/sys\.payoutsHeld'/.test(i18n) && /nothing for you to do/i.test(i18n),
    'they are told to wait, and that there is nothing for them to do');
for (const lang of ['hi', 'te']) {
  const n = (i18n.match(/'sys\.payoutsHeld':/g) || []).length;
  say(n >= 3, `the wait message exists in en/hi/te (${n} tables)`);
  break;
}

console.log(`\n  admin door: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok the console is the owner’s door and nobody else is shown it\n');
