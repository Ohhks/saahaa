/* SAAHAA · core/money.js — the ONLY module allowed to do currency arithmetic.
   ALL money is stored as INTEGER PAISE. Floats never touch a rupee value.
   Invariant enforced by tests: sum of parts === total, always. */
export const PAISE = 100;

/* `x | 0` truncates to int32, so any amount past 2,147,483,647 paise
   (₹2,14,74,836) silently went NEGATIVE. agg.gmv and agg.escrow are
   cumulative, so a working app reaches that — and the admin dashboard would
   have started showing negative rupees with no other symptom.
   int() keeps full precision and still coerces junk to 0. */
export const int = x => Math.trunc(Number(x) || 0);

export const rupees = p => p / PAISE;
export const toPaise = r => Math.round(Number(r) * PAISE);
export const add = (...xs) => xs.reduce((a, b) => a + int(b), 0);
export const sub = (a, b) => int(a) - int(b);
/** percentage of a paise amount, half-up rounded to whole paise */
export const pct = (amount, percent) => Math.round(int(amount) * (percent / 100));
export const mul = (amount, factor) => Math.round(int(amount) * factor);
export const clampMin = (a, min) => (a < min ? min : a);
export const clampMax = (a, max) => (a > max ? max : a);

export function fmt(paiseAmount, { decimals = false } = {}) {
  const r = int(paiseAmount) / PAISE;
  return '₹' + r.toLocaleString('en-IN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}
export const fmt2 = p => fmt(p, { decimals: true });

/* A CEILING THE READER MAY TYPE BACK IN. `fmt` rounds half-up, so a balance of
   ₹154.55 printed as "₹155" — the tile offered ₹155, the button said "All of
   it — ₹155", and typing 155 was refused with "You can withdraw up to ₹155".
   The app offered a number, refused that number, and named that number as the
   limit, while nothing on any screen revealed the ₹154.55 that would work. Both
   audits found it independently and neither could get their money out.

   Any figure a person is invited to re-enter prints exactly: whole rupees when
   it is whole, paise when there are paise. Never rounded up, because a rounded-
   up maximum is a number the validator will reject. */
export const fmtMax = p => ((p | 0) % 100 ? fmt2(p) : fmt(p));

/* ── ROUND ONCE, AT THE EDGE ───────────────────────────────────
   THE BILLS DID NOT ADD UP, AND THE LEDGER PAGE DID NOT EITHER.
   Every figure on a screen went through `fmt` independently, and no total was
   ever reconciled against the components printed beside it. So a real order
   showed, in one panel:

       ₹685 + ₹46 + ₹8              and, underneath, "You pay ₹740"
       "the fee and its GST are ₹55"  over two lines summing ₹54
       "₹10 from wallet · ₹729 by UPI"  under a total of ₹740

   and her wallet passbook — the one this product labels "hash-chained: it can
   be verified, never edited" — listed +515, −515, +10, +729, −740, summing to
   MINUS ONE against a printed balance of zero. The paise underneath were exact
   every time. Only the display was wrong, which is the worst version of this
   bug: a correct ledger failing its own published audit claim, in front of
   somebody who does this arithmetic in her head at a kirana counter.

   Rounding is not distributive. ⌊a⌋+⌊b⌋ is not ⌊a+b⌋, and no amount of care at
   each call site fixes that — the components have to be derived FROM the
   rounded total, once. `split` already does exactly this for paise; this is the
   same idea one unit up. */

/** Round `parts` (paise) to whole rupees such that they sum EXACTLY to the
    rounded whole-rupee total of `total` (default: their own sum). Returns
    integer paise, each a whole number of rupees, ready for `fmt`. */
export function roundParts(parts, total, opts) {
  /* AND HANDING IT A TOTAL THE PARTS DO NOT BELONG TO MADE IT INVENT MONEY.
     The cart called `roundParts([shopPayout, platformFee], itemsTotal)` — but
     the rider's ₹14 and SAAHAA's ₹5 dispatch sit between those two and the
     basket, so this function found a ₹19 discrepancy, assumed it was rounding
     drift, and spread it across the two lines: SAAHAA's ₹20.31 fee printed as
     **₹29**, on a screen where the product promises "never more than ₹25".

     A display helper silently disagreeing with the engine by ₹9 is worse than
     the misalignment it was written to fix. Its contract is redistributing at
     most a rupee or two of rounding; anything larger is a caller error, and it
     says so rather than papering over it. */
  const raw = parts.reduce((a, b) => a + int(b), 0);
  if (total != null && Math.abs(int(total) - raw) > parts.length * PAISE) {
    const msg = `roundParts: parts sum to ${raw} but were given a total of ${int(total)} — `
      + 'that is not rounding drift, it is a different set of numbers';
    /* AND NOBODY WAS LISTENING. An audit drove one ordinary shopping session and
       tripped this guard FIVE times, on five different screens, while 301 tests
       and the textual money lint all passed. The only check in the product that
       actually looks at the numbers had become load-bearing: the screens read
       correctly because the fallback rescued them, not because their callers
       were right. A safety net holding the floor up is not a safety net.

       Under `__SAAHAA_STRICT` — set by the test runner, the journeys and the
       browser self-tests — it throws, so a mismatched caller fails the build
       instead of being quietly repaired at render time. In production it still
       falls back, because a fabricated figure on a customer's bill is worse
       than a misaligned one. */
    if (typeof globalThis !== 'undefined' && globalThis.__SAAHAA_STRICT) throw new Error(msg);
    if (typeof console !== 'undefined') console.error('[saahaa] ' + msg);
    total = raw;
  }
  const want = Math.round(int(total == null ? raw : total) / PAISE);
  const each = parts.map(p => Math.round(int(p) / PAISE));
  let drift = want - each.reduce((a, b) => a + b, 0);
  /* give or take the odd rupee where it shows least: the largest part. Never
     the smallest — moving ₹1 on a ₹8 GST line is a 12% error on screen, and
     moving it on a ₹685 line is invisible and still true to the paise.

     EXCEPT WHERE THE LARGEST LINE IS A PROMISE. On a job bill the largest line
     is the worker's own quote, so "where it shows least" quietly took SAAHAA's
     rounding out of his price -- and because the booking sheet splits the bill
     in two ([deal, uplift]) while the order screen splits it in three
     ([deal, fee, gst]), the drift landed differently and the SAME job read

         ₹540  on the booking sheet        ₹539  on the order screen

     with "You keep the whole ₹540" printed two paragraphs below the ₹539. Both
     screens were internally consistent, which is why every gate passed.

     A caller may nominate the line that absorbs the drift. SAAHAA's own fee
     absorbs it; the worker's quote never does. That is not a display
     preference -- "the pro keeps the whole of their price" is the product. */
  const absorb = opts && Number.isInteger(opts.absorb) ? opts.absorb : -1;
  const order = each.map((v, i) => i).sort((a, b) => each[b] - each[a]);
  if (absorb >= 0 && absorb < each.length) order.unshift(absorb);
  for (let k = 0; drift !== 0; k = (k + 1) % order.length) {
    const i = order[k];
    if (drift > 0) { each[i]++; drift--; }
    else if (each[i] > 0) { each[i]--; drift++; }
    else if (order.every(j => each[j] === 0)) break;
  }
  return each.map(r => r * PAISE);
}

/** The common case: format a bill whose lines must visibly sum to its total. */
export function fmtParts(parts, total, opts) {
  return roundParts(parts, total, opts).map(p => fmt(p));
}

/** Split an amount into n parts that always sum back exactly (no lost paise). */
export function split(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  // all-zero weights used to silently DESTROY the amount, breaking this
  // module's own contract that the parts always sum back to the whole
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const parts = weights.map(w => Math.floor((amount * w) / total));
  let rem = amount - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rem > 0; i = (i + 1) % parts.length) { parts[i]++; rem--; }
  return parts;
}
