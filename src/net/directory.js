/* SAAHAA · net/directory.js — the pros and shops every device can see.

   THE BUG THIS CLOSES, AND WHY IT SURVIVED THE LAST ROUND. Accounts were made
   global and that looked like the whole job: a plumber signed up, the server
   named him, the owner console listed him. But every screen that LISTS a
   plumber — the category counts, the neighbourhood map, search, booking —
   reads the PARTNER row, and that was still in the localStorage of the phone
   he signed up on. He existed and no customer could see him. An account is
   not a listing.

   WHAT IS PUBLISHED IS A WHITELIST, NOT A ROW. The partner record carries a
   mobile number, and a shop record carries a UPI id and a licence number. None
   of those belong in a directory any visitor can read, so the fields are named
   here one by one rather than deleted from a copy — a record gains fields over
   time, and a delete-list starts leaking the day somebody adds one.

   LOCAL WINS OVER REMOTE, ALWAYS. On the pro's own phone his partner row is
   the live one — it has his verification progress, his stake, his history. The
   copy in the directory is a summary for other people. Merging is therefore
   skip-if-present, keyed on the account code, and never the other way round. */

import * as rail from './rail.js';
import { getState, dispatch } from '../core/ctx.js';

/* What a customer may see of a pro. NOT: mobile, verification, stake. */
const PARTNER_PUBLIC = ['name', 'cat', 'ask', 'area', 'loc', 'tier', 'online',
  'completed', 'starts', 'onTimeStarts', 'ratings', 'suspended', 'lastActiveTs',
  'vouches', 'tier3At'];

/* What a customer may see of a shop. NOT: mobile, upi, fssai, drugLicence. */
const SHOP_PUBLIC = ['name', 'catId', 'area', 'loc', 'status', 'isOpen', 'photo',
  'prepMins', 'radiusKm', 'minOrder', 'freeDeliveryAbove', 'deliveryMode',
  'selfDeliveryFee', 'fillRate', 'ratingAvg', 'ratingCount', 'ordersCompleted',
  'badges', 'onboardedAt'];

const pick = (row, fields) => {
  const out = {};
  for (const f of fields) if (row && row[f] !== undefined) out[f] = row[f];
  return out;
};

/** Put this device's own pro or shop into the directory. Never throws: a
    listing that could not be published must not lose somebody their signup. */
export async function publish({ kind, token, row }) {
  if (!rail.isConfigured() || !token || !row) return false;
  try {
    await rail.publishListing({
      token, kind,
      area: row.area || '',
      payload: pick(row, kind === 'partner' ? PARTNER_PUBLIC : SHOP_PUBLIC),
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Read the directory and merge what this device does not already have.
 * Returns how many rows were taken on, so a caller can decide to repaint.
 */
export async function refresh() {
  if (!rail.isConfigured()) return 0;
  const rows = await rail.listings();
  if (!rows.length) return 0;

  const st = getState();
  let taken = 0;

  for (const l of rows) {
    if (!l || !l.code || !l.payload) continue;

    if (l.kind === 'partner') {
      /* His own phone already holds the real row — userKey is the account
         code for every account opened since identity moved to the server. */
      if (st.partners.some(p => p.userKey === l.code)) continue;
      dispatch({ type: 'partner/add', payload: {
        /* A STABLE ID, DERIVED FROM THE CODE. partner/add upserts on id, so a
           refresh every boot updates the same row instead of growing a new one
           each time — which is what a random id would have done. */
        id: 'r_' + l.code, userKey: l.code, area: l.area || '',
        cat: 'repair', ask: 0, tier: 0, online: false,
        completed: 0, starts: 0, onTimeStarts: 0, ratings: [],
        lastActiveTs: Date.now(), verification: { steps: {}, attempts: {} },
        ...l.payload, remote: true } });
      taken++;
    } else if (l.kind === 'shop') {
      if (st.shops.some(x => x.ownerKey === l.code)) continue;
      dispatch({ type: 'shop/add', payload: {
        id: 'r_' + l.code, ownerKey: l.code, area: l.area || '',
        catId: 'kirana', status: 'active', isOpen: true, photo: '',
        prepMins: 20, radiusKm: 3, minOrder: 0, freeDeliveryAbove: 0,
        deliveryMode: 'both', selfDeliveryFee: 0, fillRate: 100,
        ratingAvg: 0, ratingCount: 0, ordersCompleted: 0, badges: [],
        ...l.payload, remote: true } });
      taken++;
    }
  }
  return taken;
}
