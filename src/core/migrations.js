/* SAAHAA · core/migrations.js — APPEND-ONLY migration chain.
   NEVER edit a released migration. Add a new one below and bump
   SCHEMA_VERSION in core/version.js.

   Every step must be IDEMPOTENT: migrate(migrate(x)) === migrate(x).
   The self-test suite asserts exactly that against fixtures. */

import { registerMigration } from './migrate.js';
import { defaultState } from '../domain/state.js';
import { toPaise } from './money.js';
import { depthRoster } from '../domain/seed.depth.js';
import { bootstrapCredential } from './adminauth.js';

/* v0 -> v6 : anything with no recognisable schema starts fresh but keeps
   any accounts we can salvage, so a returning user is not logged out. */
registerMigration({
  from: 0, to: 6, label: 'v0/unknown -> v6 (salvage accounts)',
  up(old) {
    const next = defaultState();
    next.createdAt = old.createdAt || Date.now();
    const src = Array.isArray(old.visitors) ? old.visitors : [];
    next.users = src.map(v => ({
      key: v.key, id: v.key, name: v.name, mobile: v.mobile,
      role: v.role === 'worker' ? 'partner' : (v.role || 'customer'),
      pass: v.pass, area: v.area || 'Madhapur',
      tier: v.role === 'worker' ? 1 : 0,
      createdAt: v.firstSeen || Date.now(),
    }));
    next.partners = src.filter(v => v.role === 'worker').map(v => ({
      id: v.key, userKey: v.key, name: v.name, cat: mapCat(v.wcat),
      ask: toPaise(v.wask || 500), area: v.area || 'Madhapur',
      tier: 1, online: true, completed: 0, ratings: [], lastActiveTs: Date.now(),
    }));
    return next;
  },
  verify: s => Array.isArray(s.users) && Array.isArray(s.orders),
});

/* v5 -> v6 : the v5 tree already had visitors/deals. Rupee floats become
   integer paise; 'worker' becomes 'partner'; deals become orders; the old
   12 category ids are remapped onto the v6 catalog. */
registerMigration({
  from: 5, to: 6, label: 'v5 -> v6 (paise, partners, unified orders)',
  up(old) {
    const next = defaultState();
    next.createdAt = old.createdAt || Date.now();

    const visitors = old.visitors || [];
    next.users = visitors.map(v => ({
      key: v.key, id: v.key, name: v.name, mobile: v.mobile,
      role: v.role === 'worker' ? 'partner' : (v.role === 'user' ? 'customer' : v.role || 'customer'),
      pass: v.pass, area: v.area || 'Madhapur',
      tier: v.role === 'worker' ? 1 : 0,
      createdAt: v.firstSeen || Date.now(),
    }));

    next.partners = visitors.filter(v => v.role === 'worker').map(v => ({
      id: v.key, userKey: v.key, name: v.name,
      cat: mapCat(v.wcat), ask: toPaise(v.wask || 500),
      area: v.area || 'Madhapur', tier: 1, online: true,
      completed: 0, starts: 0, onTimeStarts: 0, ratings: [], lastActiveTs: Date.now(),
    }));

    next.orders = (old.deals || []).slice(0, 200).map(d => ({
      id: String(d.id), kind: 'service',
      catId: mapCat(d.catId || d.cat), sub: null,
      customerKey: d.customer, customerArea: d.customerArea || 'Madhapur',
      partnerName: d.provider, partnerArea: d.area || 'Madhapur',
      deal: toPaise(d.deal || 0),
      // without this, `agg.escrow - o.customerPays` was NaN on the first
      // settle or cancel of a migrated order — and NaN is permanent
      customerPays: toPaise(d.deal || 0) + Math.round(toPaise(d.deal || 0) * 0.10),
      stage: mapStage(d.stage),
      stageTs: d.stageTs || d.ts || Date.now(),
      history: [{ stage: mapStage(d.stage), at: d.stageTs || Date.now() }],
      otp: d.otp, evidence: [], legacy: true,
    }));

    next.agg = {
      serviceOrders: (old.agg && old.agg.deals) || 0, retailOrders: 0,
      gmv: toPaise((old.agg && old.agg.vol) || 0),
      revenue: toPaise((old.agg && old.agg.profit) || 0),
      gst: toPaise((old.agg && old.agg.gst) || 0),
      refunds: toPaise((old.agg && old.agg.refunds) || 0),
      escrow: 0, saved: 0,
    };
    next.chats = old.chats || {};
    return next;
  },
  verify: s => Array.isArray(s.users) && Array.isArray(s.partners) && s.schemaVersion !== 5,
});

/* v6 -> v7 : market depth + the requests/bids slices.

   An existing install has one pro per category, so ask-and-bid can never open
   for it. Topping the roster up is a data fix, not a schema fix, but it has to
   ride a migration because seeding only ever runs on a fresh install.

   IDEMPOTENT because depthRoster derives its ids from (category, index): the
   filter below drops anything already present, so running it twice adds
   nothing the second time. */
registerMigration({
  from: 6, to: 7, label: 'v6 -> v7 (market depth, ask-and-bid slices)',
  up(old) {
    const next = { ...old, schemaVersion: 7 };
    next.requests = Array.isArray(old.requests) ? old.requests : [];
    next.bids     = Array.isArray(old.bids)     ? old.bids     : [];

    const users = Array.isArray(old.users) ? old.users.slice() : [];
    const partners = Array.isArray(old.partners) ? old.partners.slice() : [];
    // every seeded account shares one demo hash; reuse it so the new pros can log in
    const pass = (users.find(u => u.role === 'partner' && u.pass) || {}).pass || '';
    const roster = depthRoster(old.createdAt || Date.now(), pass);
    const haveP = new Set(partners.map(p => p.id));
    const haveU = new Set(users.map(u => u.key));
    next.partners = partners.concat(roster.partners.filter(p => !haveP.has(p.id)));
    next.users    = users.concat(roster.users.filter(u => !haveU.has(u.key)));
    return next;
  },
  verify: s => s.schemaVersion === 7 && Array.isArray(s.requests) && Array.isArray(s.bids)
            && s.partners.filter(p => p.cat === 'plumbing').length >= 6,
});

/* v7 -> v8 : the owner's dials + the owner's credential.
   Adds the settings slice (null = launch defaults) and replaces any demo or
   missing admin credential with the bootstrap hash from config. A device that
   already rotated its password (changedAt > 0, not demo) keeps its own. */
registerMigration({
  from: 7, to: 8, label: 'v7 -> v8 (settings dials, owner credential)',
  up(old) {
    const next = { ...old, schemaVersion: 8 };
    next.settings = old.settings && typeof old.settings === 'object' ? old.settings : { pricing: null };
    const a = old.admin || {};
    const boot = bootstrapCredential();
    if (boot && (!a.setupDone || a.isDemo || !a.hash)) next.admin = { ...a, ...boot };
    return next;
  },
  verify: s => s.schemaVersion === 8 && s.settings && 'pricing' in s.settings && !!(s.admin && s.admin.setupDone),
});

/* ── id remaps: retired ids must MAP, never disappear ─────────
   A category that vanishes leaves every old order rendering blank. */
const CAT_MAP = {
  plumber:'plumbing', electrician:'electrical', acrepair:'appliance',
  carpenter:'repair',  cleaning:'cleaning',     laundry:'laundry',
  salonw:'salon',      salonm:'salon',          painting:'repair',
  pest:'pest',         appliance:'appliance',   purifier:'appliance',
  grocery:'kirana',
};
const mapCat = id => CAT_MAP[id] || id || 'repair';

const STAGE_MAP = {
  REQUESTED:'MATCHING', ACCEPTED:'ASSIGNED', DECLINED:'CANCELLED',
  ENROUTE:'EN_ROUTE', OTP:'ARRIVED', WORKING:'IN_PROGRESS',
  REVIEW:'WORK_DONE', RELEASED:'SETTLED', PARTIAL:'PARTIAL',
  EXPIRED:'EXPIRED', CANCELLED:'CANCELLED',
};
/* CLOSED is terminal. Falling back to it silently KILLED any in-flight v5
   order whose stage we did not recognise, with its money still notionally
   held. DISPUTED is recoverable: it lands in the admin queue for a human. */
const mapStage = s => STAGE_MAP[s] || (s ? 'DISPUTED' : 'MATCHING');

export { mapCat, mapStage, CAT_MAP, STAGE_MAP };
