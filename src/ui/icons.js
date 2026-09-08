/* SAAHAA · ui/icons.js — the category icon set, drawn rather than borrowed.

   WHY NOT EMOJI. The IA review found this is a real bug on the exact phones
   our users hold, not a style preference:
     · 👩‍🍳 is a ZWJ sequence. On Android 8 and 9 it FRAGMENTS into two glyphs
       (a woman, then a fire). A large share of a ₹8-15k phone base is on those.
     · 🪳 🪷 🧺 are Unicode 12-14 and render as empty tofu boxes on the same
       devices.
     · Every emoji looks different on Samsung, Xiaomi, Vivo and stock Android,
       so we cannot know what the user is actually seeing.

   So: 24 flat icons, drawn here, identical everywhere.

   THE LEGIBILITY RULE. At 22px on a daylight LCD only three things survive:
   the outer silhouette, the dominant colour, and whether it is an object or a
   person. Any two icons sharing all three ARE the same icon. So every
   person-shaped glyph is gone (💇 and 💆 were indistinguishable), and every
   icon gets a colour chip as a second, independent discriminator. */

const SW = 1.9;   // stroke width that still reads at 22px without going muddy

/* Each entry: d = path data, and optionally f = a filled path drawn under it.
   viewBox is 0 0 24 24 throughout. */
const P = {
  /* ── services ─────────────────────────────────────────── */
  // hammer, not a wrench: a wrench says "mechanic or plumber", never carpenter
  repair:     'M14.5 5.5 18 2l4 4-3.5 3.5-1.5-1.5-3 3-2.5-2.5 3-3zM12.5 9.5 3 19v2h2l9.5-9.5',
  // a bulb is what people actually call an electrician about; ⚡ read as "fast"
  electrical: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V16h6v-1.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3z',
  // the pipe wrench IS the plumber's sign in India; freed up now repair has the hammer
  plumbing:   'M16.5 3.5a3.5 3.5 0 0 0-3 5.3L4 18.3V21h2.7l9.5-9.5a3.5 3.5 0 1 0 .3-8zM6 19.5l-1.5-1.5',
  // no emoji carries "AC repair": a wall unit with airflow beneath it
  appliance:  'M3 5h18v6H3zM6 8h9M6 15c1.5 0 1.5 2 3 2s1.5-2 3-2 1.5 2 3 2 1.5-2 3-2M6 19c1.5 0 1.5 2 3 2s1.5-2 3-2',
  // broom = jhaadu, culturally exact. 🧼 is banned from the set: same pale slab
  cleaning:   'M14 3 9 14M17 5l-5 11M8.5 13.5h9L21 21H12zM12 21l-1.5-4M16 21l-1-4',
  // cockroach is the pest people mean here; the ring turns "pest" into "pest CONTROL"
  pest:       'M12 8a3 5 0 0 1 3 5 3 5 0 0 1-3 5 3 5 0 0 1-3-5 3 5 0 0 1 3-5zM12 8V6M10.5 5 9 3.5M13.5 5 15 3.5M9 11 6 9M9 14l-3 1M15 11l3-2M15 14l3 1M3 3l18 18',
  // 🏍️ alone reads as bike-taxi; the spanner makes it "servicing"
  vehicle:    'M6 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 13.5 11 7h3M14 7l2 4M11 7l4 4M17.5 12.5l1.8-1.8a2 2 0 1 1 2.5 2.5l-1.8 1.8 1 1-2 2-1-1-1.8 1.8a2 2 0 1 1-2.5-2.5z',
  // a pot of food says cook/maid instantly, and is not a person-shape
  help:       'M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM3 10h18M9 7c0-1.5 1.5-1.5 1.5-3M13 7c0-1.5 1.5-1.5 1.5-3M4 13H2.5M20 13h1.5',
  // scissors: haircut, threading, shaving — the whole category, as an OBJECT
  salon:      'M6 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.2 9.4 20 19M8.2 14.6 20 5',
  // lotus reads spa / ayurveda / massage across all three languages
  wellness:   'M12 4c2 2.2 3 4.2 3 6a3 3 0 0 1-6 0c0-1.8 1-3.8 3-6zM9.5 12.5C7.8 11 5.9 10.4 4 10.5c.6 3.4 3 5.5 6 5.5M14.5 12.5c1.7-1.5 3.6-2.1 5.5-2-.6 3.4-3 5.5-6 5.5M4 19h16',
  // the stethoscope emoji is a thin grey squiggle; drawn bold it survives 22px.
  // deliberately NOT a red cross (Geneva-protected) and NOT a hospital
  health:     'M6 3v5a4 4 0 0 0 8 0V3M4.5 3h3M12.5 3h3M10 12v2a5 5 0 0 0 5 5 3 3 0 0 0 3-3v-2M18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pet:        'M6.5 9a1.8 2.2 0 1 0 0-4.4 1.8 2.2 0 0 0 0 4.4zM17.5 9a1.8 2.2 0 1 0 0-4.4 1.8 2.2 0 0 0 0 4.4zM3.5 14a1.6 2 0 1 0 0-4 1.6 2 0 0 0 0 4zM20.5 14a1.6 2 0 1 0 0-4 1.6 2 0 0 0 0 4zM12 11c2.8 0 5 2.4 5 4.8 0 2-1.6 3.2-3.4 3.2h-3.2C8.6 19 7 17.8 7 15.8 7 13.4 9.2 11 12 11z',
  // 📚 and ✏️ both said "school"; a blackboard says a TEACHER comes
  tutor:      'M3 4h18v12H3zM7 8h4M7 11h7M17 19v2M17 16v3',
  moving:     'M2 7h11v9H2zM13 10h4.5l3.5 3.5V16h-5M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  // a circus tent means nothing for a shaadi or a housewarming; this is a mandap
  events:     'M4 20V11a8 8 0 0 1 16 0v9M4 20h16M8 20v-5a4 4 0 0 1 8 0v5M12 3V1.5M9.5 11c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6',
  // a plain shirt reads "buy clothes here"; a basket reads "give and get back"
  laundry:    'M4 10h16l-1.4 9a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7zM3 10h18M9 10V6.5A3 3 0 0 1 15 6.5V10M8 14l1 4M12 14v4M16 14l-1 4',

  /* ── shops ────────────────────────────────────────────── */
  // 🛒 collided with the Shops tab AND every cart button; a shopfront is a kirana
  kirana:     'M4 9h16v11H4zM3 9l1.5-4h15L21 9M9 20v-6h6v6M3 9h18',
  // tomato: the highest-contrast produce glyph, and the archetypal kooragaya
  veg:        'M12 8a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 8V6M12 6c0-1.5 1.5-2 3-2M12 6c0-1.5-1.5-2-3-2M9.5 6.5 12 6l2.5.5',
  // a cooked drumstick read "restaurant"; a rooster reads natu kodi, fresh cut
  meat:       'M9 20c-2 0-3.5-1.6-3.5-3.6 0-3 2.5-5.4 5.5-5.4h2.5a4 4 0 0 1 4 4v5zM11 11V8a3 3 0 0 1 3-3M14 5V3.5M14 5l2 1M12.5 5h-2M17.5 20l2.5-4',
  // a white glass on a white card is invisible, and nobody buys milk in a glass
  dairy:      'M7 8h10l1 12H6zM8 8V4h8v4M9.5 12h5M6 20h12',
  pharmacy:   'M12 3a4.5 4.5 0 0 1 4.5 4.5V9h1.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1.5V7.5A4.5 4.5 0 0 1 12 3zM9.5 9h5V7.5a2.5 2.5 0 0 0-5 0zM12 12v6M9 15h6',
  // a droplet is abstract and twins ⚡; this is the 20L can and the LPG cylinder
  water:      'M4 9h7v12H4zM5.5 9V6.5h4V9M5.5 6.5 6 4.5h3l.5 2M14 21V10a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v11zM16 7V5h3v2M14 21h7',
  // a pencil is a thin diagonal line at 22px and duplicated the tutor icon
  stationery: 'M6 8h12v13H6zM9 8V5a3 3 0 0 1 6 0v3M9 5H7.5M15 5h1.5M9.5 14h5',
  petshop:    'M7 10.5a3 3 0 0 0-3 3c0 1.4 1.1 2.5 2.5 2.5.6 0 1 .4 1 1a2 2 0 0 0 4 0M17 10.5a3 3 0 0 1 3 3c0 1.4-1.1 2.5-2.5 2.5-.6 0-1 .4-1 1a2 2 0 0 1-4 0M7 10.5h10',

  /* ── navigation ───────────────────────────────────────── */
  navHome:    'M3 10.5 12 3l9 7.5V21H3zM9.5 21v-6h5v6',
  navShops:   'M4 9h16v11H4zM3 9l1.5-4h15L21 9M9 20v-6h6v6',
  navOrders:  'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  // a coin with a rupee sign. NOT a moneybag — that reads "my wallet"
  navEarn:    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 8h5M9.5 10.5h5M13 8c1.4 0 2 .9 2 2s-.9 2.2-2.6 2.2H9.5L14 16.5',
  navYou:     'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 21a7.5 7.5 0 0 1 15 0',
  cart:       'M3 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6M10 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  search:     'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM17 17l4 4',
  mic:        'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6',
  /* ── UI glyphs: the same hand, the same stroke, so a bell and a broom read
     as one family. Every emoji the views used to lean on has a drawn
     replacement here, for the same reason the categories do: an emoji is a
     different picture on every phone, and some of them are tofu. */
  bell:       'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  theme:      'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  basket:     'M3 10h18l-1.6 9a2 2 0 0 1-2 1.6H6.6a2 2 0 0 1-2-1.6zM8 10l3-6M16 10l-3-6M9 14v3M12 14v3M15 14v3',
  siren:      'M6 18V12a6 6 0 0 1 12 0v6zM4 18h16v3H4zM12 3v2M5 6l1.5 1.5M19 6l-1.5 1.5',
  pin:        'M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  refresh:    'M4 12a8 8 0 0 1 14-5.3L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-14 5.3L4 15.5M4 20v-4.5h4.5',
  shield:     'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4',
  lock:       'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v3',
  coin:       'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 8h5M9.5 10.5h5M13 8c1.4 0 2 .9 2 2s-.9 2.2-2.6 2.2H9.5L14 16.5',
  camera:     'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  idcard:     'M3 6h18v12H3zM6.5 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4.5 16c.5-1.5 1.2-2 2-2s1.5.5 2 2M13 9.5h5M13 12.5h5M13 15.5h3',
  share:      'M15 8l-8 4M15 16l-8-4M18 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 23a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  trash:      'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  calendar:   'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3M13 14h3',
  plus:       'M12 5v14M5 12h14',
  warn:       'M12 3 2.5 20h19zM12 9v5M12 17v.5',
  star:       'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z',
  scale:      'M12 3v18M6 21h12M4 8h16M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z',
  phone:      'M7 2h10v20H7zM10 5h4M12 18v.5',
  trend:      'M3 17l6-6 4 4 8-8M15 7h6v6',
  box:        'M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9',
  cold:       'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2',
  rx:         'M6 3h9v18H6zM9 7h3M9 10h3M9 13h3M15 12l4 6M19 12l-4 6',
  flask:      'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7 15h10',
  signout:    'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  signin:     'M14 4h5v16h-5M10 8l4 4-4 4M14 12H3',
  chevron:    'M6 9l6 6 6-6',
  back:       'M15 5l-7 7 7 7',
  // drawn in the same hand as `back`, so a "go on" arrow on a button is the
  // same family as the chevron beside it — &rarr; is a different typeface's
  // idea of an arrow and changes shape with the font stack
  forward:    'M4 12h14M12 6l6 6-6 6',
  person:     'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 21a7.5 7.5 0 0 1 15 0',
  check:      'M5 12.5l4.5 4.5L19 7',
  cross:      'M6 6l12 12M18 6 6 18',
  circle:     'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  clock:      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  wallet:     'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7V5a2 2 0 0 1 2-2h11v4M15 13h6v4h-6a2 2 0 0 1 0-4z',
  chat:       'M4 5h16v11H9l-5 4z',
  /* group heads: the four sections of the neighbourhood */
  groupHome:  'M3 10.5 12 3l9 7.5V21H3zM9.5 21v-6h5v6',
  groupCare:  'M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z',
  groupLife:  'M12 3c3 3 4 7 4 10a4 4 0 0 1-8 0c0-3 1-7 4-10zM12 21v-4M8 13l-3 3 3 1M16 13l3 3-3 1',
  groupShops: 'M4 9h16v11H4zM3 9l1.5-4h15L21 9M9 20v-6h6v6',
};

/* Colour is the second discriminator, so two icons of similar mass never sit
   next to each other in the same hue. */
export const CHIP = {
  repair:'#E0A030', electrical:'#E8C020', plumbing:'#3B82F6', appliance:'#06B6D4',
  cleaning:'#14B8A6', pest:'#EF4444', vehicle:'#64748B', help:'#F97316',
  salon:'#EC4899', wellness:'#8B5CF6', health:'#DC2626', pet:'#22C55E',
  tutor:'#6366F1', moving:'#A16207', events:'#D946A6', laundry:'#0EA5E9',
  kirana:'#B45309', veg:'#EF4444', meat:'#9F1239', dairy:'#2563EB',
  pharmacy:'#15803D', water:'#1D4ED8', stationery:'#7C3AED', petshop:'#65A30D',
};

export const hasIcon = id => Object.prototype.hasOwnProperty.call(P, id);

/**
 * @param {string} id   category id, or navHome/navShops/navOrders/navEarn/navYou/cart/search/mic
 * @param {object} o    { size, stroke, cls, title }
 */
export function icon(id, o = {}) {
  const d = P[id];
  const size = o.size || 24;
  if (!d) {
    // an unknown id must never render an empty box — draw a legible placeholder
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"
      style="display:block"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/></svg>`;
  }
  return `<svg class="${o.cls || ''}" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="${o.stroke || 'currentColor'}" stroke-width="${o.sw || SW}"
    stroke-linecap="round" stroke-linejoin="round" style="display:block"
    ${o.title ? `role="img" aria-label="${o.title}"` : 'aria-hidden="true"'}
    shape-rendering="geometricPrecision"><path d="${d}"/></svg>`;
}

/** The 44px coloured medallion a category tile uses. */
export function medallion(id, size = 44) {
  const c = CHIP[id] || 'currentColor';
  return `<span class="med" style="width:${size}px;height:${size}px;color:${c};
    background:color-mix(in srgb, ${c} 15%, transparent)">${icon(id, { size: Math.round(size * 0.52) })}</span>`;
}
