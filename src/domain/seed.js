/* SAAHAA · domain/seed.js — demo data so the app is never an empty shell.
   Idempotent: runs once, guarded by state.seeded. Every seeded account uses
   the password 123 (this is a prototype; see docs/SECURITY.md). */

import { sha256 } from '../core/crypto.js';
import { nid } from '../core/id.js';
import { toPaise } from '../core/money.js';
import { makeCredential, DEMO_PASSWORD } from '../core/adminauth.js';
import { byCategory } from './starter-catalog.js';

const CUSTOMERS = [
  ['Anoosh Kumar',  '9000000001', 'Madhapur'],
  ['Priya Sharma',  '9000000002', 'Ameerpet'],
  ['Rahul Verma',   '9000000003', 'Kondapur'],
  ['Sneha Reddy',   '9000000004', 'Gachibowli'],
  ['Farhan Ali',    '9000000005', 'Kukatpally'],
];

/* name, mobile, category, ask (rupees), area, tier, completed, avg stars */
const PARTNERS = [
  ['Amit Verma',       '9100000001', 'plumbing',   520,  'Jubilee Hills', 3, 128, 4.8],
  ['Vikram Volts',     '9100000002', 'electrical', 480,  'Ameerpet',      3,  96, 4.7],
  ['CoolCare Ravi',    '9100000003', 'appliance',  750,  'Madhapur',      4, 210, 4.9],
  ['SparkleTeam Devi', '9100000004', 'cleaning',   400,  'Kondapur',      3, 172, 4.6],
  ['Press Express',    '9100000005', 'laundry',    180,  'Kukatpally',    2,  64, 4.5],
  ['Kumar Woodworks',  '9100000006', 'repair',     600,  'Gachibowli',    3,  81, 4.7],
  ['Glam Studio Sana', '9100000007', 'salon',      900,  'Banjara Hills', 3, 143, 4.8],
  ['Nurse Lakshmi',    '9100000008', 'health',     700,  'Begumpet',      4,  58, 4.9],
  ['BugsAway Team',    '9100000009', 'pest',      1100,  'Miyapur',       2,  37, 4.4],
  ['Shifters Naidu',   '9100000010', 'moving',    2500,  'LB Nagar',      2,  45, 4.3],
  ['Guru Tuitions',    '9100000011', 'tutor',      500,  'Ameerpet',      3,  92, 4.8],
  ['PawPerfect Zoya',  '9100000012', 'pet',        600,  'Jubilee Hills', 3,  61, 4.7],
];

/* name, categoryId, area, owner mobile, prep mins, radius km */
const SHOPS = [
  ['Sri Lakshmi Kirana',   'kirana',     'Madhapur',      '9200000001', 20, 3],
  ['Balaji Super Market',  'kirana',     'Kukatpally',    '9200000002', 25, 4],
  ['Fresh Basket Veggies', 'veg',        'Ameerpet',      '9200000003', 15, 3],
  ['Green Cart Organics',  'veg',        'Gachibowli',    '9200000004', 18, 3],
  ['Al-Barkat Meat Shop',  'meat',       'Banjara Hills', '9200000005', 30, 3],
  ['Sagar Fish Point',     'meat',       'Secunderabad',  '9200000006', 30, 4],
  ['Heritage Milk Parlour','dairy',      'Kondapur',      '9200000007', 12, 2],
  ['Osmania Bakers',       'dairy',      'Begumpet',      '9200000008', 15, 3],
  ['Apollo Corner Pharma', 'pharmacy',   'Madhapur',      '9200000009', 18, 4],
  ['Bharat Water & Gas',   'water',      'Miyapur',       '9200000010', 30, 6],
  ['Vidya Stationers',     'stationery', 'Ameerpet',      '9200000011', 20, 3],
  ['Petzone Supplies',     'petshop',    'Jubilee Hills', '9200000012', 25, 4],
];

const jitter = (base, lo, hi) => Math.round(base * (lo + Math.random() * (hi - lo)));

export async function buildSeed(now = Date.now()) {
  const pass = await sha256('123');
  const users = [], partners = [], shops = [], products = [];

  CUSTOMERS.forEach(([name, mobile, area]) => {
    users.push({ key: (name + '|' + mobile).toLowerCase(), id: nid('u'), name, mobile,
                 role: 'customer', pass, area, tier: 1, createdAt: now });
  });

  PARTNERS.forEach(([name, mobile, cat, ask, area, tier, completed, avg]) => {
    const key = (name + '|' + mobile).toLowerCase();
    const id = nid('p');
    users.push({ key, id, name, mobile, role: 'partner', pass, area, tier, partnerId: id, createdAt: now });
    const ratings = Array.from({ length: Math.min(24, completed) }, (_, i) => ({
      stars: Math.max(3, Math.min(5, Math.round(avg + (Math.random() - 0.5)))),
      ts: now - i * 86400000 * 3,
    }));
    partners.push({
      id, userKey: key, name, cat, ask: toPaise(ask), area, tier,
      online: true, completed, starts: completed,
      onTimeStarts: Math.round(completed * (0.82 + Math.random() * 0.15)),
      workerCancels: Math.round(completed * 0.02), noShows: Math.random() < 0.3 ? 1 : 0,
      disputesUpheld: 0, disputesPartial: completed > 100 ? 1 : 0,
      ratings, lastActiveTs: now - Math.random() * 86400000 * 3,
    });
  });

  SHOPS.forEach(([name, catId, area, mobile, prepMins, radiusKm]) => {
    const key = (name + '|' + mobile).toLowerCase();
    const id = nid('s');
    users.push({ key, id, name, mobile, role: 'shop', pass, area, tier: 2, shopId: id, createdAt: now });
    shops.push({
      id, ownerKey: key, name, catId, area, mobile, prepMins, radiusKm,
      status: 'active', isOpen: true,
      minOrder: toPaise(149), freeDeliveryAbove: toPaise(499),
      deliveryMode: 'both', selfDeliveryFee: toPaise(25),
      fillRate: 88 + Math.round(Math.random() * 11),
      ratingAvg: +(4.1 + Math.random() * 0.8).toFixed(1),
      ratingCount: 40 + Math.round(Math.random() * 260),
      ordersCompleted: 60 + Math.round(Math.random() * 500),
      badges: ['verified_shop'].concat(catId === 'veg' || catId === 'meat' ? ['fresh_today'] : [])
                               .concat(Math.random() > 0.4 ? ['reliable_stock'] : []),
      fssai: catId === 'pharmacy' ? '' : '1234' + Math.floor(Math.random() * 1e8),
      drugLicence: catId === 'pharmacy' ? 'TS/HYD/20B-' + Math.floor(Math.random() * 9000) : '',
      onboardedAt: now - Math.random() * 86400000 * 200,
    });

    // stock each shop from the starter catalog, with local price jitter
    byCategory(catId).forEach(sc => {
      if (Math.random() < 0.12) return;                     // not every shop carries everything
      products.push({
        id: nid('pr'), shopId: id, catId, refId: sc.refId,
        name: sc.name, aisle: sc.aisle, unit: sc.unit,
        price: sc.mrp ? Math.min(jitter(sc.price, 0.96, 1.02), sc.mrp) : jitter(sc.price, 0.94, 1.06),
        mrp: sc.mrp,
        stockQty: Math.random() < 0.07 ? 0 : 3 + Math.floor(Math.random() * 40),
        lowStockAt: 5, trackStock: !sc.variableWeight,
        variableWeight: sc.variableWeight, coldChain: sc.coldChain, perishable: sc.perishable,
        rxRequired: sc.rxRequired, bookingOnly: sc.bookingOnly,
        subPolicyDefault: sc.subPolicyDefault,
        mfgDate: sc.perishable ? now - Math.random() * 86400000 : null,
        active: true, soldCount: Math.floor(Math.random() * 300), createdAt: now,
      });
    });
  });

  const admin = await makeCredential(DEMO_PASSWORD);
  return { users, partners, shops, products, admin };
}

export const SEED_LOGIN_HINT = {
  customer: '9000000001 · Anoosh Kumar · password 123',
  partner:  '9100000001 · Amit Verma · password 123',
  shop:     '9200000001 · Sri Lakshmi Kirana · password 123',
  admin:    'admin · saahaa123',
};
