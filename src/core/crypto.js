/* SAAHAA · core/crypto.js — hashing + the tamper-evident ledger chain.
   NOTE: client-side hashing proves nothing to a server. See docs/SECURITY.md
   — this is integrity-evidence for a demo, not authentication for real money. */
export async function sha256(str) {
  if (globalThis.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return fallbackHash(str);           // http:// on some browsers has no subtle
}
function fallbackHash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + str.charCodeAt(i) * (i + 1), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4).slice(0, 64);
}

/** Deterministic block payload — order matters and must never change for
    already-written blocks, or historical verification breaks. */
export function blockPayload(idx, prevHash, rec) {
  return [idx, prevHash, rec.id, rec.kind, rec.amountPaise, rec.partyA, rec.partyB, rec.ts].join('|');
}
export async function appendBlock(chain, rec) {
  const idx = chain.length;
  const prev = chain.lastHash || 'GENESIS';
  const hash = await sha256(blockPayload(idx, prev, rec));
  return { ...rec, blockIdx: idx, prevHash: prev, hash };
}
export async function verifyChain(blocks) {
  let prev = 'GENESIS';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.blockIdx !== i || b.prevHash !== prev) return { ok: false, at: i, reason: 'link' };
    const h = await sha256(blockPayload(i, prev, b));
    if (h !== b.hash) return { ok: false, at: i, reason: 'hash' };
    prev = b.hash;
  }
  return { ok: true, at: blocks.length, reason: null };
}
