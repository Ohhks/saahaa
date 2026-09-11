/* SAAHAA · tools/lint-dead.mjs — code that exists and never runs.

   This repo's characteristic failure is not bad code. It is UNEXECUTED code,
   and a confident comment sitting on top of it.

     · `checkInvariants` knows the book must balance and no account may go
       negative. It had zero callers, and sat there through four audits while
       two separate bugs drove escrow negative and let a shop be paid more than
       the customer ever paid.
     · `R_REAUTH` — "Final bill — approve", owner: customer — is a declared
       order stage that nothing has ever advanced to, under a comment promising
       the customer approves anything over her estimate.
     · `CANCEL_RULES.WORKER_NO_SHOW` was published on the public refunds page
       for six versions with nothing in the app able to reach it.
     · `.rail` was styled `display:none` while a view still rendered it.

   Every one of those was invisible: no error, no blank screen, no failing test.
   Only a person reading the source ever found them, one audit at a time. This
   is the machine that finds them instead.

   Run: node tools/lint-dead.mjs        (wired into tools/preflight.sh)
   Exits non-zero on a finding. An intentional exception is declared inline in
   the source with a `dead-ok:` comment, so the reason lives next to the code
   rather than in a list here. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const walk = d => {
  let out = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
  }
  return out;
};

const files = walk(SRC).filter(f => f.endsWith('.js'));
const text = new Map(files.map(f => [relative(ROOT, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
const all = [...text.values()].join('\n');
/* everything except the self-test suites — a test is not a caller */
const app = [...text.entries()].filter(([f]) => !/selftests?\./.test(f)).map(([, s]) => s).join('\n');

const findings = [];
const say = (kind, what, where, why) => findings.push({ kind, what, where, why });

/* An exception is declared where the thing lives: `dead-ok: reason`. */
const cssText = ['src/ui/tokens.css', 'src/ui/brand.css']
  .map(f => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
/* the exemption may live in a stylesheet comment too — a hidden class's reason
   belongs next to the rule that hides it, not in a JS file across the repo */
const searchable = all + '\n' + cssText;
const excused = name => new RegExp('dead-ok:[^\\n]*\\b' + name + '\\b').test(searchable)
  || new RegExp('\\b' + name + '\\b[^\\n]*dead-ok:').test(searchable);

/* ── 1 · an exported function nothing outside the tests ever calls ── */
const EXPORTED = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
for (const [file, src] of text) {
  if (/selftests?\./.test(file)) continue;
  for (const m of src.matchAll(EXPORTED)) {
    const name = m[1] || m[2];
    if (!name || excused(name)) continue;
    /* Count EVERY mention of the name across the app. A name that appears
       exactly once — its own declaration — is the `checkInvariants` shape: not
       called, not imported, not referenced as a namespace property, unable to
       run whatever its comment claims.

       Anything less strict than "appears exactly once" produced 44 findings,
       most of them constants and adapters legitimately staged for a rail that
       is not switched on. A lint nobody can trust is ignored, which is the same
       failure as a lint that lies. */
    /* NOTE the lookbehind excludes `$` and word chars but NOT `.` — a call
       through a namespace (`audit.toCSV(…)`) is a use, and excluding the dot
       made every one of those invisible and produced 143 false findings. */
    const mentions = (app.match(new RegExp('(?<![\\w$])' + name + '(?![\\w$])', 'g')) || []).length;
    if (mentions <= 1) {
      say('export', name, file, 'appears exactly once in the whole app — nothing can ever run it');
    }
  }
}

/* ── 2 · an order stage nothing can ever reach ────────────────── */
const orders = text.get('src/domain/orders.js') || '';
const stages = [...orders.matchAll(/\{\s*id:\s*'([A-Z_]+)'/g)].map(m => m[1]);
for (const st of stages) {
  if (excused(st)) continue;
  const reachable = new RegExp("to:\\s*\\[[^\\]]*'" + st + "'").test(orders);   // some stage lists it
  const advanced = new RegExp("advance\\([^)]*'" + st + "'").test(app)
    || new RegExp("'" + st + "'").test(app.replace(orders, ''));                // or a view drives it
  if (!reachable && !advanced) say('stage', st, 'src/domain/orders.js', 'declared and nothing advances to it');
}

/* ── 3 · a class the stylesheet hides while a view still renders it ── */
const css = ['src/ui/tokens.css', 'src/ui/brand.css']
  .map(f => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
const hidden = new Set();
for (const m of css.matchAll(/([.#][\w-]+(?:\s*,\s*[.#][\w-]+)*)\s*\{([^}]*)\}/g)) {
  if (!/display\s*:\s*none/.test(m[2])) continue;
  /* a rule scoped to a parent (`.sheet .grab`) or to print is deliberate */
  if (/@media\s+print/.test(css.slice(Math.max(0, m.index - 400), m.index))) continue;
  for (const sel of m[1].split(',')) {
    const s = sel.trim();
    if (s.startsWith('.') && !s.includes(' ')) hidden.add(s.slice(1));
  }
}
for (const cls of hidden) {
  if (excused(cls)) continue;
  if (!new RegExp('class="[^"]*\\b' + cls + '\\b').test(app)) continue;
  /* A class hidden at one width and shown at another is responsive design, not
     dead code — `.topbar` and `.nav` are each display:none on exactly the width
     where the other one is the navigation. Only a class that is never given a
     display back anywhere has the `.rail` shape, which is the one that silently
     removed a feature. */
  const shownAgain = new RegExp('[.#]' + cls + '[^{}]*\\{[^}]*display\\s*:\\s*(?!none)[\\w-]+').test(css);
  if (!shownAgain) {
    say('css', '.' + cls, 'tokens.css/brand.css', 'display:none everywhere, yet a view still renders it');
  }
}

/* ── 4 · a counter that gates money, written on the wrong path ──
   `ordersCompleted` decides whether a shop is still inside its thirty free
   orders, so it decides whether SAAHAA charges commission at all. It was read
   in three places and written in none — every real shop stayed on order zero
   for ever. The fix for that then went into `refundRetail`, the RETURN path,
   so it ticked when an order came BACK and still never when one was delivered:
   a live settled order left the shop on 78. Both generations passed every test
   and every audit, because `?demo=1` seeds shops at 60-560 orders and a real
   install starts at 0, so each mode only ever exercised the branch the other
   one got wrong.

   A counter that gates money has to be incremented by the function that closes
   a SUCCESSFUL order, and by no other. That is checkable, so it is checked. */
const MONEY_COUNTERS = [
  { field: 'ordersCompleted', inside: 'settleRetail', notInside: 'refundRetail',
    why: 'gates the free-first-30 and therefore whether commission is charged' },
];
const bodyOf = (src, fn) => {
  const m = new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + fn + '\\s*\\(').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
};
for (const c of MONEY_COUNTERS) {
  if (excused(c.field)) continue;
  const src = text.get('src/domain/flow.js') || '';
  const writes = b => !!b && new RegExp(c.field + '\\s*:\\s*\\(\\(').test(b);
  const good = bodyOf(src, c.inside), bad = bodyOf(src, c.notInside);
  if (!good) say('counter', c.field, 'src/domain/flow.js',
    'the success function ' + c.inside + '() no longer exists — rewire the counter');
  else if (!writes(good)) say('counter', c.field, 'src/domain/flow.js',
    c.inside + '() does not increment it — ' + c.why);
  if (bad && writes(bad)) say('counter', c.field, 'src/domain/flow.js',
    c.notInside + '() increments it, and a returned order is not a completed one');
}

/* ── 5 · a stage handled twice in one role's branch ────────────
   `actionPanel` is a ladder of `if (s === 'X') return …`, one branch per role.
   Put the same stage twice in one branch and the SECOND one is unreachable —
   silently, with no error and no failing test.

   It happened, and it took out the last step of the retail half: the shop's
   "Handed over — waiting on the customer" panel was pasted into the CUSTOMER's
   branch, above her own `R_DELIVERED` panel. She lost Confirm delivery and
   "Something was wrong — return this order" and got the shop's copy, written
   in the third person about her. Her money was then released only by a timer
   she had no button for. A second `R_RETURN` was dead the same way.

   Every other gate was green. Only opening the screen as a customer found it,
   which is exactly the failure this repo keeps repeating. */
{
  const src = text.get('src/ui/views/orders.js') || '';
  const ROLE = /if\s*\(\s*r\.(is\w+)\s*\)\s*\{/g;
  const marks = [...src.matchAll(ROLE)].map(m => ({ role: m[1], at: m.index }));
  const dupes = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at;
    const to = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const seen = new Map();
    for (const m of src.slice(from, to).matchAll(/if\s*\(\s*s\s*===\s*'([A-Z_]+)'\s*\)/g)) {
      const line = src.slice(0, from + m.index).split('\n').length;
      if (seen.has(m[1])) dupes.push(`${marks[i].role}: '${m[1]}' handled again at line ${line} (first at ${seen.get(m[1])}) — the second can never run`);
      else seen.set(m[1], line);
    }
  }
  for (const d of dupes) say('branch', d.split(':')[1].trim().split(' ')[0], 'src/ui/views/orders.js', d);
}

/* ── 6 · a total printed beside components that were rounded apart ──
   THIS ONE WAS FIXED THREE TIMES AND LEFT A NEW PANEL BEHIND EACH TIME.
   `M.fmt` rounds to whole rupees, and rounding is not distributive, so a panel
   that formats its lines independently and then formats their total prints
   arithmetic that does not work:

     ₹685 + ₹46 + ₹8   under   "You pay ₹740"
     ₹43 + ₹159 + ₹28 + ₹137 + ₹99 + ₹19   under   "Total ₹486"
     "₹10 from wallet · ₹729 by UPI"   under   ₹740
     "Sri Lakshmi receives ₹471"   beside   "items ₹485" and "fee ₹15"

   Every one was invisible to every other gate: the paise underneath were exact,
   the tests passed, the book balanced. Only a person adding up a column found
   them — which is what a customer does at a kirana counter, and what the
   product's whole pitch invites her to do.

   `core/money.js roundParts` is the fix, and remembering to call it is not.
   A block that prints a TOTAL (`m-kv--total`, `feeline` with a `Yours`, or a
   `kv(..., 'm-kv--total')`) may not also print bare `M.fmt(...)` lines above
   it: the components must come from `roundParts`/`fmtParts`.

   Declared exceptions use `money-ok: <why>` on the line, for the panels where
   a figure genuinely stands alone rather than summing into anything. */
{
  const TOTAL = /m-kv--total|feeline[^\n]*m-kv--total|--total/;
  const findings = [];
  for (const [file, src] of text) {
    if (!/\/views\//.test(file)) continue;
    const lines = src.split('\n');
    /* Resolve every `<name>Row = <name>Parts.map(...)` to whether <name>Parts
       was actually built by roundParts/fmtParts. Names prove nothing. */
    const guardedRows = new Set();
    for (const m of src.matchAll(/const\s+(\w*Row)\s*=\s*(.+)/g)) {
      /* assigned straight from the reconciler -- `M.fmtParts([a, b], total)` */
      if (/roundParts|fmtParts/.test(m[2])) { guardedRows.add(m[1]); continue; }
      /* or mapped over a parts array that was itself reconciled */
      const via = m[2].match(/(\w+)\s*\.map/);
      if (!via) continue;
      const at = src.indexOf('const ' + via[1]);
      if (at >= 0 && /roundParts|fmtParts/.test(src.slice(at, at + 400))) guardedRows.add(m[1]);
    }
    for (let i = 0; i < lines.length; i++) {
      if (!TOTAL.test(lines[i])) continue;
      if (/money-ok:/.test(lines[i])) continue;
      /* look back over the block this total closes */
      let bare = 0, guarded = false;
      for (let j = Math.max(0, i - 14); j < i; j++) {
        if (/money-ok:/.test(lines[j])) { guarded = true; break; }
        if (/roundParts|fmtParts/.test(lines[j])) { guarded = true; break; }
        /* AND THIS GATE CERTIFIED THE WORST RECEIPT IN THE APP. It accepted the
           NAMES `Row[`, `billRow` and `retailRow` as proof that the column had
           been reconciled. `billRow` had been: it comes from `roundParts`.
           `retailRow` had not — it is `retailParts.map(v => M.fmt(v))`, every
           line rounded on its own — and the gate written to catch exactly that
           waved it through because of what the variable was called.

           A customer adding up her own grocery receipt got
           28 + 279 + 142 + 344 + 42 = 835 beside a total of 836.76.

           This is the same mistake as the i18n stem hatch and it is the mistake
           this whole file exists to stop: trusting a name instead of resolving
           what produced it. An alias is guarded only if its own definition
           traces back to roundParts/fmtParts. */
        const alias = lines[j].match(/(\w*Row)\s*\[/);
        if (alias && guardedRows.has(alias[1])) { guarded = true; break; }
        /* an alias that did NOT come from roundParts is evidence, not silence:
           the receipt prints `retailRow[li]` and no bare M.fmt at all, so a
           check that only counted M.fmt saw an empty column above the total */
        if (alias) { bare++; continue; }
        if (/M\.fmt\(/.test(lines[j]) && /m-kv|feeline|kv\(/.test(lines[j])) bare++;
      }
      if (!guarded && bare >= 2) {
        findings.push(`${file}:${i + 1} — ${bare} bare M.fmt lines above a total`);
      }
    }
  }
  for (const f of findings) say('money', f.split(' — ')[0], f.split(':')[0], f);
}

/* ── 8 · a sum off the ledger set against a sum over an order list ──
   THREE TIMES IN ONE VERSION, THE SAME DEFECT: an arithmetic relationship
   asserted between two totals that do not describe the same set of orders.

     "YOU KEPT ₹752 — from ₹540 quoted · you keep 100%"
        `kept` came off the ledger (every credit, including a cancellation
        compensation); `quoted` summed `o.deal` over SETTLED orders, which that
        cancelled job is not. 139%, printed beside the words "you keep 100%".

     roundParts: parts sum to 53109 but were given a total of 53767
        `yours` summed every SHOP_PAYOUT and RIDER credit in the book, all time;
        `gross` summed `customerPays` over `done`. ₹6.58 off, falling back
        silently in production.

   Both were invisible to every other gate. Each figure was individually
   correct, each was computed from a real source, and the book balanced —
   the two simply counted different things and were then subtracted.

   A total read off the LEDGER may only be set against a total summed over an
   ORDER LIST when it has been restricted to that same list. In practice that
   means the ledger side is filtered through a Set of the ids on the other side,
   which is what `.has(` here is looking for.

   Declared exceptions: `population-ok: <why>` on the assignment. */
{
  /* one word-boundary test, defined once. Written four times inline it was
     written four times WRONG: a shell heredoc ate a backslash level and
     `new RegExp('\b' + v + '\b')` is a backspace character, not a boundary, so
     the propagation below silently matched nothing and the check passed a
     deliberately poisoned tree. */
  /* A NAME AFTER A DOT IS A PROPERTY, NOT THE VARIABLE. `\b` matched `max`
     inside `Math.max(`, so any line doing `Math.max(0, agg - fee)` was reported
     as a ledger total set against an order-list one the moment some other
     function in the file happened to declare `const max`. The check is
     file-scoped by design; that makes it collide with ordinary property names
     unless it refuses them. */
  const word = (v, str) => new RegExp('(?<![.\\w$])' + v + '\\b').test(str);
  const LEDGER = /=\s*[\w.]*(?:legsFor|creditsByKind|balanceOf)\s*\(|=\s*credits\./;
  const OVER_LIST = /=\s*sum\s*\(\s*\w+|=\s*\w+\s*\.reduce\s*\(/;
  for (const [file, src] of text) {
    if (!/\/views\//.test(file)) continue;
    /* `.split('\n')` leaves a '\r' on every line of a CRLF file, and '\r' is a
       LINE TERMINATOR in a JS regex -- so `(.*)$` below could never match and
       the propagation loop found nothing, on every file, silently. The
       classification loop has no `$` anchor, which is the only reason half of
       this check appeared to work. */
    const lines = src.split(/\r?\n/);
    const ledgerVars = new Map();     // name -> line index of its assignment
    const listVars = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/const\s+(\w+)\s*=/);
      if (!m) continue;
      if (LEDGER.test(lines[i])) ledgerVars.set(m[1], i);
      else if (OVER_LIST.test(lines[i])) listVars.add(m[1]);
    }
    /* A ledger total that has been RESTRICTED to the order list's own ids is
       fine -- that is the fix, not the defect. In practice the restriction is a
       Set of those ids, so the assignment (which may wrap over a few lines)
       runs its legs through `.has(`. Scoping travels with provenance: a total
       derived from a scoped total is itself scoped. */
    const scoped = new Set();
    const restricted = i => /\.has\(|population-ok:/.test(lines.slice(i, i + 7).join('\n'));
    for (const [name, at] of ledgerVars) if (restricted(at)) scoped.add(name);
    /* AND THE FIRST VERSION OF THIS CHECK WAS INERT. The defect it was written
       for reads `const yours = (credits.SHOP_PAYOUT || 0) + (credits.RIDER||0)`
       -- so the ledger call lands on `credits` and the ARITHMETIC uses `yours`,
       a name the check had never heard of. It passed the poisoned tree happily.
       Provenance has to travel: a total derived from a ledger total is itself a
       ledger total, and the same for one summed off an order list. */
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/const\s+(\w+)\s*=(.*)$/);
        if (!m || ledgerVars.has(m[1])) continue;
        const rhs = m[2];
        const fromLedger = [...ledgerVars.keys()].some(v => word(v, rhs));
        const fromList = [...listVars].some(v => v !== m[1] && word(v, rhs));
        /* PROVENANCE BEATS SHAPE. `OVER_LIST` calls any `X.reduce(` an
           order-list total and it is applied first, so `sentOut =
           outLegs.reduce(...)` -- nothing but the sum of some LEDGER rows -- was
           filed as a list total and then flagged against the very rows it adds
           up. A total summed over ledger legs is a ledger total, whatever the
           shape of the expression that sums it. */
        if (listVars.has(m[1])) {
          if (fromLedger && !fromList) { listVars.delete(m[1]); ledgerVars.set(m[1], i); }
          continue;
        }
        if (fromLedger && !fromList) {
          /* ITS OWN line, not the line of the total it came from. Storing the
             source's index made the guard look for the restriction eight lines
             from `shopLegs` instead of where the filtering actually happens,
             and the check fired on the very code that fixes the defect. */
          ledgerVars.set(m[1], i);
          const src0 = [...ledgerVars.keys()].find(v => v !== m[1] && word(v, rhs));
          if (restricted(i) || (src0 && scoped.has(src0))) scoped.add(m[1]);
        } else if (fromList && !fromLedger) listVars.add(m[1]);
      }
    }
    if (!ledgerVars.size || !listVars.size) continue;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/population-ok:/.test(ln)) continue;
      /* only where the two are actually related by ARITHMETIC. This check is
         file-scoped, not function-scoped, so every name in the file is in play
         at once -- and the shop's aggregator line,

             `at 25% of ${M.fmt(gross)}. SAAHAA took … — you kept …`

         matched `gross` (a real variable) against `kept` (a variable in a
         different function, appearing here only as the English word "kept").
         A sentence is not arithmetic. Rendered prose carries `${` or a
         backtick; the two real defects this check exists for are plain
         expressions -- `Math.max(0, gross - yours - feeRaw - dispatchRaw)` and
         a `roundParts` total -- and neither is inside a template. */
      if (ln.includes('${') || ln.includes('`')) continue;
      if (!/[-/]/.test(ln)) continue;
      const lv = [...ledgerVars.keys()].find(v => word(v, ln));
      const ov = [...listVars].find(v => word(v, ln));
      if (!lv || !ov) continue;
      /* guarded when the ledger side was restricted to the other side's ids:
         the assignment, or the few lines above it, run every leg through a Set */
      if (scoped.has(lv)) continue;
      say('population', `${lv} (ledger) set against ${ov} (order list)`, file,
        `${file}:${i + 1} — these two do not have to describe the same orders`);
    }
  }
}

/* ── 7 · a module namespace used and never imported ────────────
   `flags.isOn('RIDER_POOL')` was added to `src/ui/views/partner.js`, which does
   not import `flags`. Every gate passed: the module PARSES — a free variable is
   legal JavaScript until it runs — the tests pass, the bundle builds and boots,
   the journeys settle. The line only executes once a shop has a live retail
   order, so the screen it took down was the Payouts tab: the only screen with
   the withdraw control, broken on exactly the days a kirana is trading.

   A general free-variable checker needs a real scope analysis, and the regex
   version of it produced 38 findings, almost all false — which is the failure
   this file already warns about twice. So this checks ONE precise thing: a name
   that this repo uses as a module namespace somewhere (`import * as flags`)
   being dot-called in a file that does not import it. That is the shape that
   bit, it has no false positives by construction, and it is cheap. */
{
  const NAMESPACES = new Set();
  for (const src of text.values()) {
    for (const m of src.matchAll(/import\s+\*\s+as\s+([\w$]+)\s+from/g)) NAMESPACES.add(m[1]);
  }
  for (const [file, raw] of text) {
    if (/selftests?\./.test(file)) continue;
    /* a namespace named in a comment is documentation, not a call — this file's
       own JSDoc mentioning `gateway.useOpener()` was the last false positive */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const imported = new Set();
    for (const m of src.matchAll(/import\s+\*\s+as\s+([\w$]+)\s+from/g)) imported.add(m[1]);
    /* a local binding of the same name legitimately shadows the module */
    /* A LOCAL OF THE SAME NAME IS NOT A BUG, IT IS A SHADOW, and chasing every
       binding form with regexes kept calling shadows findings — a multi-name
       `const a = [], shops = []`, a destructured `for (const [.., flags] of)`.
       Each miss is a false positive, and a lint with false positives is one
       nobody reads, which is the failure this file warns about twice already.

       So the test is not "can I find its declaration" but the far simpler
       "does this name ever appear here as anything OTHER than the object of a
       dot-call". A local is written to, passed, returned or destructured at
       least once; an un-imported module namespace is only ever dotted. */
    const bareUse = name =>
      new RegExp('(?<![.\\w$])' + name + '(?![\\w$]|\\s*\\.)').test(src);
    const seen = new Set();
    for (const m of src.matchAll(/(?<![.\w$])([\w$]+)\s*\.\s*[a-zA-Z_$][\w$]*\s*\(/g)) {
      const name = m[1];
      if (!NAMESPACES.has(name) || imported.has(name) || seen.has(name) || bareUse(name)) continue;
      seen.add(name);
      const line = src.slice(0, m.index).split('\n').length;
      say('freevar', name, file,
        `${name}.…() at ${file}:${line} — this repo imports ${name} as a module namespace, and this file does not`);
    }
  }
}

/* ── 8 · an HTML comment inside a tag ──────────────────────────
   A NOTE EXPLAINING A FIX SAT BETWEEN `style="…"` AND `data-act="…"`:

       <button class="btn btn--danger" style="margin-top:16px"
         <!-- why this figure is the rounded one -->
         data-act="cancel.confirm" data-id="…">Yes, cancel · ₹273 back</button>

   The HTML parser ends the tag at the first `>` it finds — the one closing the
   comment — so `data-act`, `data-id` and `data-rule` were swallowed and the
   REST of the button rendered on screen as visible text. An audit screenshotted
   raw `data-act="cancel.confirm" data-id="ord_…"` sitting in the sheet, clicked
   it, and nothing happened: every service cancellation in that build was dead,
   and the failure looked to a customer like the app had been hacked.

   Nothing else can see it. The template literal is a perfectly good string, so
   the module parses and the bundle builds. `render-views.mjs` builds the sheet
   without throwing, because malformed markup is still markup. Only the parser
   knows, and only once it is on a screen.

   Comments belong above the tag. */
for (const [file, raw] of text) {
  for (const m of raw.matchAll(/<[a-zA-Z][^>]*?<!--/g)) {
    const line = raw.slice(0, m.index).split('\n').length;
    const tag = (m[0].match(/^<([a-zA-Z][\w-]*)/) || [, '?'])[1];
    say('markup', `${file}:${line}`, file,
      `an HTML comment opens inside a <${tag}> tag at ${file}:${line} — the parser ends the tag `
      + 'at the comment\'s own ">", drops every attribute after it, and prints the rest as text');
  }
}

/* ── report ───────────────────────────────────────────────────── */
console.log('  dead-code: ' + files.length + ' files scanned, ' + findings.length + ' finding(s)');
if (!findings.length) {
  console.log('  ok nothing is declared-and-unreachable');
  process.exit(0);
}
const byKind = { export: 'EXPORTED AND NEVER CALLED', stage: 'STAGE NOTHING CAN REACH', css: 'RENDERED BUT HIDDEN',
                 counter: 'MONEY COUNTER ON THE WRONG PATH',
                 branch: 'A STAGE HANDLED TWICE IN ONE BRANCH',
                 money: 'A TOTAL THAT ITS OWN LINES DO NOT SUM TO',
                 freevar: 'A NAMESPACE USED AND NEVER IMPORTED',
                 population: 'TWO TOTALS THAT NEED NOT COUNT THE SAME ORDERS' };
for (const kind of ['freevar', 'money', 'population', 'branch', 'counter', 'stage', 'css', 'export']) {
  const rows = findings.filter(f => f.kind === kind);
  if (!rows.length) continue;
  console.log('\n  x ' + byKind[kind] + ' (' + rows.length + '):');
  rows.forEach(f => console.log('      ' + f.what + '  —  ' + f.where + '\n        ' + f.why));
}
console.log('\n    Wire it up, delete it, or write `dead-ok: <name> — why` next to it.');
console.log('    A promise the code cannot keep is worse than a missing feature.');

/* WHICH FINDINGS STOP A RELEASE.
   Stages and hidden classes are precise: an unreachable stage and a rendered
   class with no display are each a feature the product claims and cannot
   deliver, and both have already cost real bugs (R_REAUTH, `.rail`).

   The orphaned-export check has real signal — it is what would have caught
   `checkInvariants` sitting uncalled through four audits — but it also lists a
   long tail of small utilities and debug helpers that are deliberately kept.
   Failing the build on those would train everybody to ignore the whole lint,
   which is exactly how the last measurement problem started. So it reports and
   does not block, under a budget that may shrink and never grow. */
const BLOCKING = findings.filter(f => f.kind !== 'export');
const ORPHAN_BUDGET = 28;
const orphans = findings.length - BLOCKING.length;
if (orphans > ORPHAN_BUDGET) {
  console.log('\n  x ' + orphans + ' orphaned exports, over the budget of ' + ORPHAN_BUDGET + '.');
  console.log('    Each new one must be wired, deleted or excused — the tail shrinks, it does not grow.');
}
process.exit(BLOCKING.length || orphans > ORPHAN_BUDGET ? 1 : 0);
