/* SAAHAA · core/money.js — the ONLY module allowed to do currency arithmetic.
   ALL money is stored as INTEGER PAISE. Floats never touch a rupee value.
   Invariant enforced by tests: sum of parts === total, always. */
export const PAISE = 100;

export const rupees = p => p / PAISE;
export const toPaise = r => Math.round(Number(r) * PAISE);
export const add = (...xs) => xs.reduce((a, b) => a + (b | 0), 0);
export const sub = (a, b) => (a | 0) - (b | 0);
/** percentage of a paise amount, half-up rounded to whole paise */
export const pct = (amount, percent) => Math.round((amount | 0) * (percent / 100));
export const mul = (amount, factor) => Math.round((amount | 0) * factor);
export const clampMin = (a, min) => (a < min ? min : a);
export const clampMax = (a, max) => (a > max ? max : a);

export function fmt(paiseAmount, { decimals = false } = {}) {
  const r = (paiseAmount | 0) / PAISE;
  return '₹' + r.toLocaleString('en-IN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}
export const fmt2 = p => fmt(p, { decimals: true });

/** Split an amount into n parts that always sum back exactly (no lost paise). */
export function split(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const parts = weights.map(w => Math.floor((amount * w) / total));
  let rem = amount - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rem > 0; i = (i + 1) % parts.length) { parts[i]++; rem--; }
  return parts;
}
