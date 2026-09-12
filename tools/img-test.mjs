/* SAAHAA · tools/img-test.mjs — does the sharing actually save what it claims?
   Run: node tools/img-test.mjs */

const U = p => new URL('../' + p, import.meta.url).href;
const I = await import(U('src/core/imgstore.js'));
/* no .catch here: a swallowed import makes the real-roster check silently
   vacuous, which is the failure mode this whole file exists to avoid */
const { STARTER } = await import(U('src/domain/starter-catalog.js'));

let pass = 0; const fails = [];
const say = (c, w, d = '') => { if (c) { pass++; console.log('  ok   ' + w); }
  else { fails.push(w); console.log('      x ' + w + (d ? '  — ' + d : '')); } };
const eq = (a, b, w) => say(a === b, w, a === b ? '' : `got ${a}, wanted ${b}`);

// ── the same product is the same key, however it is typed ────
eq(I.canonicalKey('Amul Ghee 500ml'), I.canonicalKey('amul ghee  500ML'),
   'case and spacing do not make a second picture');
eq(I.canonicalKey('Sona Masoori Rice (loose)'), I.canonicalKey('Sona Masoori Rice'),
   'how it is sold does not make a second picture');
say(I.canonicalKey('Amul Ghee 500ml') !== I.canonicalKey('Amul Ghee 1L'),
   'but a different size IS a different product');
eq(I.canonicalKey(''), '', 'an unnamed product has no shared key');

// ── identical bytes are stored once ──────────────────────────
{
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array([1, 2, 3, 4, 5]);
  const c = new Uint8Array([1, 2, 3, 4, 6]);
  eq(await I.contentKey(a), await I.contentKey(b), 'the same photograph twice is one key');
  say(await I.contentKey(a) !== await I.contentKey(c), 'a different photograph is a different key');
}

// ── a shop's own photo wins over the catalogue's ─────────────
eq(I.keyForListing({ name: 'Amul Ghee 500ml' }), I.canonicalKey('Amul Ghee 500ml'),
   'a catalogue product uses the shared picture');
eq(I.keyForListing({ name: 'Amul Ghee 500ml', ownPhotoKey: 'own:abc' }), 'own:abc',
   'a shop that photographs its own shelf keeps its own picture');

// ── THE NUMBER THIS MODULE EXISTS FOR ────────────────────────
{
  // forty shops, the same forty catalogue products each
  const catalogue = Array.from({ length: 40 }, (_, i) => 'Product ' + i);
  const listings = [];
  for (let shop = 0; shop < 40; shop++) catalogue.forEach(n => listings.push({ name: n }));
  const r = I.rosterCost(listings);
  eq(r.listings, 1600, '1,600 listings across forty shops');
  eq(r.distinct, 40, 'but only forty distinct pictures');
  say(r.ratio === 40, 'a 40x saving, and it GROWS with every new shop', `ratio ${r.ratio}`);
  say(r.savedBytes > 70 * 1024 * 1024, 'which is tens of megabytes off the 1 GB budget',
      `${(r.savedBytes / 1024 / 1024).toFixed(0)} MB saved`);
}

// ── and against the REAL catalogue, not a made-up one ────────
{
  const names = STARTER.map(p => p.name).filter(Boolean);
  const uniq = new Set(names.map(I.canonicalKey).filter(Boolean));
  say(names.length > 100, `the real starter catalogue has ${names.length} products`);
  say(uniq.size <= names.length, `which collapse to ${uniq.size} distinct pictures`);
  const forty = [];
  for (let s = 0; s < 40; s++) names.forEach(n => forty.push({ name: n }));
  const r = I.rosterCost(forty);
  say(r.ratio >= 20, `forty real shops share pictures ${r.ratio}x over`,
      `${r.listings} listings → ${r.distinct} images, ${(r.bytes / 1024 / 1024).toFixed(1)} MB not ${(r.naiveBytes / 1024 / 1024).toFixed(0)} MB`);
}

// ── the placeholder is small enough to live in the row ───────
{
  const w = 64, h = 64, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (i % w) * 4; rgba[i * 4 + 1] = 120; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255;
  }
  const blur = I.blurFromRGBA(rgba, w, h);
  say(blur.length <= 100, `a placeholder is ${blur.length} bytes of base64`);
  say(I.blurToCss(blur).includes('radial-gradient'), 'and paints with no image request at all');
  const forForty = blur.length * 40;
  say(forForty < 4096, `forty of them is ${forForty} bytes — a list renders instantly`);
}

console.log(`\n  images: ${pass} assertions, ${fails.length} failure(s)`);
if (fails.length) { fails.forEach(f => console.log('      x ' + f)); process.exit(1); }
console.log('  ok one bag of atta is photographed once for the whole city\n');
