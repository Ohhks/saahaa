/* SAAHAA · domain/catalog.retail.js — RETAIL categories (shops list PRODUCTS).
   Same registry, different `kind`. Everything that branches on service-vs-retail
   reads `kind`, never a hard-coded id list.

   takePct  = platform fee on order value for this category.
              Panel decision (V2, conf 5): retail CANNOT carry the 10% service
              rate — kirana gross margin on staples is 3-6%, so a 10% take is
              larger than the entire margin on the items people order most.
              Staples 3% (cap Rs.25), high-margin verticals 5%.
   takeCapPaise = per-order cap so a big basket never pays a punitive fee.
   coldChain / rxGated / bookingOnly drive compliance UI. */
import { register } from '../core/registry.js';

const RETAIL = [
  { id: 'kirana', name: 'Grocery & Kirana', ico: '🛒', group: 'shops', accent: '#D9A05B',
    blurb: 'Daily staples from your neighbourhood store',
    takePct: 3, takeCapPaise: 2500, prepMins: 20, licence: 'fssai',
    aisles: ['Staples & Flour', 'Dals & Pulses', 'Oils & Ghee', 'Spices & Masala',
             'Sugar, Salt & Basics', 'Packaged & Snacks', 'Beverages', 'Home & Cleaning',
             'Personal Care', 'Baby'] },

  { id: 'veg', name: 'Fruits & Vegetables', ico: '🥬', group: 'shops', accent: '#7FD1A6',
    blurb: 'Fresh today — weighed in front of you',
    takePct: 3, takeCapPaise: 2500, prepMins: 15, licence: 'fssai', variableWeight: true, freshPhoto: true,
    aisles: ['Daily Vegetables', 'Leafy Greens', 'Gourds & Others', 'Fruits', 'Combos'] },

  { id: 'meat', name: 'Meat, Fish & Eggs', ico: '🍗', group: 'shops', accent: '#E07A6E',
    blurb: 'Cut to order, halal/jhatka declared',
    takePct: 3, takeCapPaise: 2500, prepMins: 30, licence: 'fssai',
    variableWeight: true, coldChain: true, freshPhoto: true, declareHalal: true,
    aisles: ['Chicken', 'Mutton', 'Fish & Seafood', 'Eggs'] },

  { id: 'dairy', name: 'Dairy & Bakery', ico: '🥛', group: 'shops', accent: '#EBD08A',
    blurb: 'Milk, curd, bread, sweets — dated on the label',
    takePct: 5, takeCapPaise: 2500, prepMins: 15, licence: 'fssai',
    coldChain: true, requireMfgDate: true,
    aisles: ['Milk', 'Curd & Paneer', 'Bakery', 'Sweets'] },

  { id: 'pharmacy', name: 'Pharmacy & Wellness', ico: '💊', group: 'shops', accent: '#6FC3B8',
    blurb: 'OTC, devices, and Rx with prescription',
    takePct: 5, takeCapPaise: 5000, prepMins: 20, licence: 'drug',
    rxGated: true, noReturns: true,
    aisles: ['OTC Pain & Fever', 'Cold & Digestive', 'First Aid', 'Devices & Diagnostics',
             'Wellness', 'Prescription (Rx)'] },

  { id: 'water', name: 'Water Cans & Gas', ico: '💧', group: 'shops', accent: '#5BA8D6',
    blurb: 'Subscribe once, never run out',
    takePct: 5, takeCapPaise: 2500, prepMins: 30, licence: null,
    recurring: true, deposit: true,
    aisles: ['Water', 'LPG & Fuel'] },

  { id: 'stationery', name: 'Stationery & School', ico: '✏️', group: 'shops', accent: '#7BA7E8',
    blurb: 'Notebooks, pens, exam kits',
    takePct: 5, takeCapPaise: 5000, prepMins: 20, licence: null,
    aisles: ['Notebooks & Paper', 'Writing', 'Art & School', 'Office', 'Exam Kits'] },

  { id: 'petshop', name: 'Pet Supplies', ico: '🦴', group: 'shops', accent: '#C99A5B',
    blurb: 'Food, toys, grooming, vet basics',
    takePct: 5, takeCapPaise: 5000, prepMins: 25, licence: null,
    aisles: ['Dog Food', 'Cat', 'Accessories', 'Birds & Fish', 'Vet Meds'] },
];

RETAIL.forEach(c => register('category', Object.freeze({ ...c, kind: 'retail' })));

export const RETAIL_IDS = RETAIL.map(c => c.id);
export default RETAIL;
