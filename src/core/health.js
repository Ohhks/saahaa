/* SAAHAA · core/health.js — boot invariants. On fatal, the app degrades to
   Safe Mode instead of white-screening. */
import { SCHEMA_VERSION, BUILD_ID } from './version.js';
import * as persist from './persist.js';
import * as registry from './registry.js';

export function checkHealth(state) {
  const checks = [];
  const ck = (id, ok, detail, fatal = false) => checks.push({ id, ok: !!ok, detail, fatal });

  ck('storage', persist.isAvailable(), persist.isAvailable() ? 'localStorage OK' : 'localStorage blocked — session-only mode');
  const bytes = persist.usageBytes();
  ck('quota', bytes < 4_000_000, `${(bytes / 1024).toFixed(0)} KB used`);
  ck('state', state && typeof state === 'object', 'state tree present', true);
  ck('schema', state && state.schemaVersion === SCHEMA_VERSION, `schema v${state && state.schemaVersion} vs app v${SCHEMA_VERSION}`, true);
  ck('registry.category', registry.count('category') > 0, `${registry.count('category')} categories`, true);
  ck('registry.stage', registry.count('orderStage') > 0, `${registry.count('orderStage')} order stages`, true);
  ck('build', typeof BUILD_ID === 'string', `build ${BUILD_ID}`);

  // referential integrity — no persisted record may point at an unregistered id
  if (state && Array.isArray(state.orders)) {
    const bad = state.orders.filter(o => o.catId && !registry.has('category', o.catId));
    ck('orders.category-refs', bad.length === 0, bad.length ? `${bad.length} orders reference retired categories (rendered as legacy chips)` : 'all order category refs valid');
    const badStage = state.orders.filter(o => o.stage && !registry.has('orderStage', o.stage));
    ck('orders.stage-refs', badStage.length === 0, badStage.length ? `${badStage.length} orders in unregistered stages` : 'all order stages valid');
  }
  if (state && Array.isArray(state.products) && Array.isArray(state.shops)) {
    const shopIds = new Set(state.shops.map(s => s.id));
    const orphans = state.products.filter(p => !shopIds.has(p.shopId));
    ck('products.shop-refs', orphans.length === 0, orphans.length ? `${orphans.length} orphan products` : 'no orphan products');
  }

  const fatal = checks.some(c => !c.ok && c.fatal);
  return { ok: checks.every(c => c.ok), fatal, checks };
}
