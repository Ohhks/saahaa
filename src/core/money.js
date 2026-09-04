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
