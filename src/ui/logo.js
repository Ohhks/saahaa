/* SAAHAA · ui/logo.js — the brand mark, as inline SVG.

   A faithful rebuild of the supplied SAHA artwork's central emblem: a ring of
   stylised human figures joined hand-to-hand in gold, on deep plum. Vector
   rather than a raster so it stays crisp from a 28px header chip to a 240px
   splash, themes correctly, and needs no external asset (the CSP forbids one).

   Two variants, because 12 figures at 28px collapses into noise:
     detail (12 figures)  >= 64px   splash, receipts, empty states
     simple  (8 figures)  <= 48px   header, tab bar

   If you later drop a real logo.png next to index.html, setLogoImage() swaps
   it in everywhere with no other change — progressive enhancement, and an
   example of the open/closed rule this codebase follows. */

let IMAGE_SRC = null;
export function setLogoImage(src) { IMAGE_SRC = src; }
export function hasLogoImage() { return !!IMAGE_SRC; }

/* ── gradient + symbol defs: injected once, referenced everywhere ── */
export function defs() {
  return `
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
 <defs>
  <linearGradient id="gGold" x1="8%" y1="0%" x2="92%" y2="100%">
    <stop offset="0"   stop-color="#F7E4A8"/>
    <stop offset=".22" stop-color="#E9C87A"/>
    <stop offset=".46" stop-color="#D4A24A"/>
    <stop offset=".58" stop-color="#FBEFC6"/>
    <stop offset=".74" stop-color="#C08F3C"/>
    <stop offset="1"   stop-color="#8A6124"/>
  </linearGradient>
  <radialGradient id="gGlow" cx="50%" cy="42%" r="60%">
    <stop offset="0"  stop-color="#FFE9B0" stop-opacity=".38"/>
    <stop offset=".7" stop-color="#D4A24A" stop-opacity=".08"/>
    <stop offset="1"  stop-color="#D4A24A" stop-opacity="0"/>
  </radialGradient>
  <g id="figD">
    <circle cx="0" cy="-14" r="6.4"/>
    <path d="M-10.6 4.4C-10.6-5.4-6-8.6 0-8.6S10.6-5.4 10.6 4.4Z"/>
  </g>
  <g id="figS">
    <circle cx="0" cy="-18" r="9"/>
    <path d="M-15-.4C-15-14.3-8.5-18.9 0-18.9S15-14.3 15-.4Z" transform="translate(0 6)"/>
  </g>
 </defs>
</svg>`;
}

const RING_R = 64;

function figures(n, symbolId) {
  let out = '';
  for (let k = 0; k < n; k++) {
    const deg = (k * 360) / n;
    out += `<g transform="rotate(${deg.toFixed(2)} 100 100) translate(100 ${100 - RING_R})">`
         + `<g class="figw"><use href="#${symbolId}"/></g></g>`;
  }
  return out;
}

/**
 * @param {number} size px
 * @param {object} o  { detail:boolean, glow:boolean, animate:boolean, core:boolean, cls:string }
 */
export function mark(size = 40, o = {}) {
  if (IMAGE_SRC) {
    return `<img src="${IMAGE_SRC}" width="${size}" height="${size}" alt="SAAHAA"
             style="border-radius:50%;object-fit:cover;display:block" class="${o.cls || ''}">`;
  }
  const detail = o.detail ?? size >= 64;
  const n = detail ? 12 : 8;
  const sym = detail ? 'figD' : 'figS';
  const bandW = detail ? 5 : 7;
  const showCore = o.core ?? size >= 40;
  const flat = size <= 32;                    // small: flatten the gradient or it greys out
  const fill = flat ? '#EBC97C' : 'url(#gGold)';
  const circumference = 2 * Math.PI * RING_R; // 402.12
  const dash = detail ? `stroke-dasharray="${(circumference / n - 2).toFixed(1)} 2" stroke-dashoffset="-1"` : '';

  return `
<svg class="mk ${o.cls || ''} ${o.animate ? 'mk--anim' : ''}" width="${size}" height="${size}"
     viewBox="0 0 200 200" role="img" shape-rendering="geometricPrecision" style="display:block">
  <title>SAAHAA</title>
  ${o.glow !== false && size >= 48 ? '<circle cx="100" cy="100" r="86" fill="url(#gGlow)" class="mk-glow"/>' : ''}
  <circle class="mk-band" cx="100" cy="100" r="${RING_R}" fill="none" stroke="${fill}"
          stroke-width="${bandW}" stroke-linecap="round" ${dash}
          style="--circ:${circumference.toFixed(1)}"/>
  <g class="mk-figs" fill="${fill}">${figures(n, sym)}</g>
  ${showCore ? `<g class="mk-core">
    <circle cx="100" cy="100" r="21" fill="none" stroke="${fill}" stroke-width="2.5" opacity=".55"/>
    <circle cx="100" cy="100" r="7" fill="${fill}"/>
  </g>` : ''}
</svg>`;
}

/* ── the five pillars from the artwork ─────────────────────── */
export const PILLARS = [
  { id:'care',    label:'CARE',    d:'M12 21s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 8.6 4.5 4.5 0 0 1 19.5 11c0 5.3-7.5 10-7.5 10Z' },
  { id:'protect', label:'PROTECT', d:'M12 3l7 3v6c0 4.6-3 8.4-7 9.6C8 20.4 5 16.6 5 12V6l7-3Z' },
  { id:'serve',   label:'SERVE',   d:'M3 13.5l3.6-3.2a2 2 0 0 1 2.6 0L12 12.6l2.8-2.3a2 2 0 0 1 2.6 0L21 13.5M3 13.5v2.2c0 .6.4 1 1 1h16c.6 0 1-.4 1-1v-2.2' },
  { id:'build',   label:'BUILD',   d:'M4 20V13h4v7M10 20V8h4v12M16 20V4h4v16' },
  { id:'elevate', label:'ELEVATE', d:'M12 3.5c2.6 2.4 4 5 4 7.5a4 4 0 1 1-8 0c0-2.5 1.4-5.1 4-7.5ZM6 20h12' },
];

export function pillarIcon(p, size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
     stroke="url(#gGold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" style="display:block"><path d="${p.d}"/></svg>`;
}

export function pillarRow({ compact = false } = {}) {
  return `<div class="pillars ${compact ? 'pillars--c' : ''}">${PILLARS.map(p => `
    <div class="pill" data-pillar="${p.id}">
      <span class="pico">${pillarIcon(p, compact ? 20 : 26)}</span>
      <span class="plbl">${p.label}</span>
    </div>`).join('')}</div>`;
}

/* ── lockup: mark + wordmark ───────────────────────────────── */
export function lockup(size = 28, { tagline = false } = {}) {
  return `<span class="brandline">
    ${mark(size, { glow: false })}
    <span class="stack">
      <span class="wordmark wm">SAAHAA</span>
      ${tagline ? '<span class="micro muted" style="letter-spacing:.14em">TOGETHER, WE ELEVATE LIFE</span>' : ''}
    </span>
  </span>`;
}
