/* SAAHAA · core/audit.js — append-only audit log of privileged actions.
   Every admin action and every money movement MUST be logged. */
import * as persist from './persist.js';
import { nid, deviceId } from './id.js';

const MAX = 500;
let log = persist.read(persist.KEYS.audit, []) || [];

export const ACTIONS = {
  ADMIN_LOGIN: 'admin.login', ADMIN_LOGIN_FAIL: 'admin.login.fail', ADMIN_LOGOUT: 'admin.logout',
  PARTNER_APPROVE: 'partner.approve', PARTNER_REJECT: 'partner.reject', PARTNER_SUSPEND: 'partner.suspend',
  LISTING_APPROVE: 'listing.approve', LISTING_REJECT: 'listing.reject',
  ESCROW_RELEASE: 'escrow.release', ESCROW_PARTIAL: 'escrow.partial', REFUND: 'refund.issue',
  REVIEW_HIDE: 'review.hide', USER_SUSPEND: 'user.suspend',
  FLAG_TOGGLE: 'flag.toggle', BACKUP_RESTORE: 'backup.restore', MIGRATION: 'migration.run',
  DATA_EXPORT: 'data.export', SAFE_MODE: 'safe.mode',
};

export function record(action, detail = {}, actor = 'system') {
  const entry = { id: nid('aud'), action, actor, device: deviceId(), ts: Date.now(), detail };
  log.push(entry);
  if (log.length > MAX) log = log.slice(-MAX);
  persist.write(persist.KEYS.audit, log);
  return entry;
}
export function entries({ action, since, limit = 200 } = {}) {
  return log.filter(e => (!action || e.action === action) && (!since || e.ts >= since)).slice(-limit).reverse();
}
export function toCSV() {
  const rows = [['ts', 'iso', 'actor', 'action', 'detail']];
  log.forEach(e => rows.push([e.ts, new Date(e.ts).toISOString(), e.actor, e.action, JSON.stringify(e.detail).replace(/"/g, "'")]));
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
export function clear() { log = []; persist.write(persist.KEYS.audit, log); }
export function count() { return log.length; }
