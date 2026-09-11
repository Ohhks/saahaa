/* SAAHAA · domain/match.js — areas, distance, and the LOCKED-MATCH engine.

   Panel V1-B2 (confidence 5): hybrid. Auto-suggest ONE hero card that is the
   winner of a broadcast that has ALREADY run — so the pro on the card has
   already said yes — plus a visible "see others" override. Pure auto-assign
   breaks the humans-decide promise; a plain list reintroduces choice paralysis
   and two extra taps.

   Panel V1-B6: the biggest drop-off risk in a 3-tap flow is the confirm-moment
   trust collapse. The fix is the Locked-Match Sheet: a named, rated,
   distance-stamped pro who has accepted, a price that cannot move without the
   customer's approval, an escalation ladder that never dumps the user back to
   an empty search, and one-tap "someone else". */

import { trustScore, tierMeets, capOk } from './trust.js';
import { find } from '../core/registry.js';

export const AREAS = [
  { n:'Madhapur',      x:0,  y:0  }, { n:'Ameerpet',     x:3,  y:1  },
  { n:'Jubilee Hills', x:2,  y:3  }, { n:'Kondapur',     x:-2, y:1  },
  { n:'Gachibowli',    x:-3, y:4  }, { n:'Banjara Hills',x:4,  y:4  },
  { n:'Kukatpally',    x:1,  y:-4 }, { n:'Miyapur',      x:-1, y:-6 },
  { n:'Begumpet',      x:5,  y:2  }, { n:'Secunderabad', x:7,  y:1  },
  { n:'LB Nagar',      x:8,  y:-4 }, { n:'Uppal',        x:9,  y:0  },
];
export const AREA_NAMES = AREAS.map(a => a.n);

/* Every named Hyderabad area now also has real coordinates, so a place can be
   a name (legacy) or a {lat, lng} object (the map), and the distance between
   any two is the same great-circle number either way. Anywhere in the world
   works: a place with coordinates never needs to be in this table. */
export const AREA_GEO = {
  'Madhapur': [17.4486, 78.3908], 'Ameerpet': [17.4375, 78.4483], 'Jubilee Hills': [17.4325, 78.4073],
  'Kondapur': [17.4622, 78.3568], 'Gachibowli': [17.4401, 78.3489], 'Banjara Hills': [17.4156, 78.4347],
  'Kukatpally': [17.4849, 78.4138], 'Miyapur': [17.4969, 78.3612], 'Begumpet': [17.4440, 78.4677],
  'Secunderabad': [17.4399, 78.4983], 'LB Nagar': [17.3457, 78.5522], 'Uppal': [17.4056, 78.5591],
};
export const geoOf = place => {
  if (!place) return null;
  if (typeof place === 'object' && place.lat != null && place.lng != null) return { lat: +place.lat, lng: +place.lng };
  const g = AREA_GEO[String(place)]; return g ? { lat: g[0], lng: g[1] } : null;
};
export const nameOf = place => typeof place === 'string' ? place : (place && (place.label || place.area)) || 'your area';
export function haversineKm(a, b) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function kmBetween(a, b) {
  const A = geoOf(a), B = geoOf(b);
  if (A && B) return +(haversineKm(A, B) + 0.4).toFixed(1);     // +0.4: the last street is never a straight line
  // no coordinates on either side: the old planar table, so nothing seeded ever breaks
  const PA = AREAS.find(x => x.n === nameOf(a)) || AREAS[0];
  const PB = AREAS.find(x => x.n === nameOf(b)) || AREAS[0];
  return +(Math.sqrt((PA.x - PB.x) ** 2 + (PA.y - PB.y) ** 2) * 1.1 + 0.4).toFixed(1);
}
export const etaMins = km => Math.max(6, Math.round(km * 3.2 + 8));

/* ── ranking ────────────────────────────────────────────────
   Deliberately NOT price-only: the cheapest pro who is 9 km away and rated 3.6
   is a worse booking than one 1 km away rated 4.8 at ten rupees more. */
export function rankPartners(partners, { catId, area, dealPaise }) {
  const cat = find('category', catId);
  return partners
    .filter(p => p.cat === catId && p.online !== false && !p.suspended)
    .filter(p => !cat || tierMeets(p.tier, cat.minTier || 1))
    .filter(p => !dealPaise || capOk(p, dealPaise))
    .map(p => {
      const km = kmBetween(area, p.area);
      const t = trustScore(p);
      const priceScore = 1 - Math.min(1, (p.ask || 0) / ((cat && cat.base) || 100000) - 0.6);
      const distScore = 1 - Math.min(1, km / 12);
      const score = t.score / 100 * 0.45 + distScore * 0.33 + Math.max(0, priceScore) * 0.22;
      return { ...p, km, eta: etaMins(km), trust: t.score, band: t.band, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** The hero card + the escalation ladder behind it. */
export function lockedMatch(partners, opts) {
  const ranked = rankPartners(partners, opts);
  return {
    hero: ranked[0] || null,
    /* IT THREW THE REST AWAY. Six of eleven plumbers were shown and the other
       five did not exist as far as the customer was concerned -- no count, no
       "and 5 more", no way through. For a pro who has just joined, with no
       ratings and no jobs to rank on, that is the difference between having a
       livelihood on this platform and not having one; nothing in onboarding
       hints at it. The view decides how many to draw at once; the engine hands
       over everyone who can actually do the job. */
    alternates: ranked.slice(1),
    ladder: ranked.slice(0, 5).map(p => p.id),   // first-accept-wins, ~45s each
    exhausted: ranked.length === 0,
  };
}

/* ── shop matching for retail ──────────────────────────────── */
export function rankShops(shops, { catId, area }) {
  return shops
    .filter(s => s.catId === catId && s.status === 'active')
    .map(s => {
      const km = kmBetween(area, s.area);
      return { ...s, km, eta: etaMins(km) + (s.prepMins || 20),
               open: s.isOpen !== false, reachable: km <= (s.radiusKm || 3) + 1 };
    })
    .sort((a, b) => (b.open - a.open) || (b.reachable - a.reachable) ||
                    (b.fillRate || 0) - (a.fillRate || 0) || a.km - b.km);
}
