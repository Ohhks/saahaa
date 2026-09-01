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

export function kmBetween(a, b) {
  const A = AREAS.find(x => x.n === a) || AREAS[0];
  const B = AREAS.find(x => x.n === b) || AREAS[0];
  return +(Math.sqrt((A.x - B.x) ** 2 + (A.y - B.y) ** 2) * 1.1 + 0.4).toFixed(1);
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
    alternates: ranked.slice(1, 6),
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
