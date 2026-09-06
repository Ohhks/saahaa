/* SAAHAA · core/flags.js — runtime feature flags = the kill-switch and the
   canary for an app with no backend.
   Precedence: URL ?ff.NAME=1  >  localStorage SAAHAA_FLAGS  >  DEFAULTS
   Every new feature ships default-false for one release. */
import * as persist from './persist.js';
import { emit } from './bus.js';

export const DEFAULTS = {
  SPLASH:            true,   // Welcome to SAAHAA screen
  RETAIL:            true,   // shops + product listings + cart
  SHOP_SELF_LISTING: true,   // merchants add their own SKUs
  QUICK_BOOK:        true,   // 3-tap locked-match booking
  SAVINGS_STRIP:     true,   // you pay / typical app price / you save
  CHAT:              true,
  MESH:              true,   // cross-tab BroadcastChannel sync
  SIM_MARKET:        false,  // simulated demand/supply: ON only for demos (?demo=1 turns it on)
  SUBSCRIPTIONS:     true,   // recurring orders
  ASK_RATES:         true,   // the P2P ask-and-bid flow
  ASK_NIGHT_GUARD:   false,  // real rule, off in the prototype so it can be demoed at any hour
  RIDER_POOL:        false,  // canary — SAAHAA-managed delivery riders
  VOICE_SEARCH:      false,  // canary
  DEV_PANEL:         false,
};

let overrides = persist.read(persist.KEYS.flags, {}) || {};
const urlOverrides = (() => {
  const o = {};
  try {
    new URLSearchParams(location.search).forEach((v, k) => {
      if (k.startsWith('ff.')) o[k.slice(3)] = v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : v;
    });
  } catch (e) {}
  return o;
})();

export function get(name) {
  if (name in urlOverrides) return urlOverrides[name];
  if (name in overrides) return overrides[name];
  return DEFAULTS[name];
}
export const isOn = name => get(name) === true;
export function set(name, value, { persist: doPersist = true } = {}) {
  overrides[name] = value;
  if (doPersist) persist.write(persist.KEYS.flags, overrides);
  emit('flags:changed', { name, value });
  return value;
}
export function reset(name) {
  if (name) delete overrides[name]; else overrides = {};
  persist.write(persist.KEYS.flags, overrides);
  emit('flags:changed', { name: name || '*', value: name ? DEFAULTS[name] : null });
}
export function all() {
  return Object.keys(DEFAULTS).map(name => ({
    name,
    value: get(name),
    default: DEFAULTS[name],
    source: name in urlOverrides ? 'url' : name in overrides ? 'local' : 'default',
  }));
}
/** Safe mode: every flag off except the shell. */
export function safeMode() { Object.keys(DEFAULTS).forEach(k => { overrides[k] = false; }); overrides.SPLASH = false; persist.write(persist.KEYS.flags, overrides); }
