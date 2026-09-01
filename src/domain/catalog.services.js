/* SAAHAA · domain/catalog.services.js — SERVICE categories.
   OPEN/CLOSED SEAM. To add a category: append an entry here (or create a new
   self-registering file and import it from domain/index.js). Nothing else in
   the app changes — tiles, search, matching, pricing, admin filters, order
   stages and the self-tests all derive from this registry.

   base     = typical fair price in PAISE (integer; never a float)
   unit     = pricing strategy shown to the customer
   minTier  = verification tier a partner must reach to take this work
   homeAccess = unsupervised access to a customer's home -> forces Tier 3+ */
import { register } from '../core/registry.js';

export const UNITS = {
  VISIT: 'per visit', HOUR: 'per hour', ITEM: 'per item', SQFT: 'per sq.ft',
  KG: 'per kg', MONTH: 'per month', SESSION: 'per session', QUOTE: 'on survey',
  PLATE: 'per plate', DAY: 'per day', SHIFT: 'per shift', KM: 'per km',
};

/* group -> which home-screen rail a tile appears under */
export const GROUPS = [
  { id: 'home',  label: 'Home & Repairs',     ico: '🏠' },
  { id: 'care',  label: 'Care & Wellbeing',   ico: '💗' },
  { id: 'life',  label: 'Learn, Move & Live', ico: '🚀' },
  { id: 'shops', label: 'Shops Near You',     ico: '🛒' },
];

const SERVICES = [
  { id: 'repair', name: 'Home Repair & Carpentry', ico: '🔧', group: 'home', accent: '#C99A5B',
    base: 60000, workMins: 60, unit: UNITS.VISIT, altUnit: UNITS.QUOTE, minTier: 2,
    blurb: 'Handyman, wood, furniture, fittings',
    subs: ['Furniture assembly', 'Door & lock repair', 'Drilling / wall mounting', 'Curtain rod fitting',
           'Modular kitchen repair', 'Wardrobe & hinge fix', 'Bed & sofa repair', 'False ceiling patch'] },

  { id: 'electrical', name: 'Electrical', ico: '⚡', group: 'home', accent: '#E4B23C',
    base: 48000, workMins: 45, unit: UNITS.ITEM, altUnit: UNITS.VISIT, minTier: 2,
    blurb: 'Wiring, fixtures, switchboards, safety',
    subs: ['Fan install / repair', 'Switchboard & socket', 'MCB / fuse trip', 'Inverter & battery',
           'Light & chandelier fitting', 'Doorbell & CCTV point', 'Wiring fault trace'] },

  { id: 'plumbing', name: 'Plumbing', ico: '🚿', group: 'home', accent: '#5BA8D6',
    base: 52000, workMins: 45, unit: UNITS.ITEM, altUnit: UNITS.VISIT, minTier: 2,
    blurb: 'Leaks, drains, fittings, tanks',
    subs: ['Tap & mixer repair', 'Leak detection', 'Blocked drain / sink', 'Toilet & flush repair',
           'Motor & pump', 'Overhead tank cleaning', 'Geyser install', 'Pipeline replacement'] },

  { id: 'appliance', name: 'AC & Appliance Repair', ico: '❄️', group: 'home', accent: '#6FD3E0',
    base: 75000, workMins: 60, unit: UNITS.ITEM, altUnit: UNITS.MONTH, minTier: 2,
    blurb: 'Cooling, white goods, kitchen appliances',
    subs: ['AC service (split / window)', 'AC install / uninstall', 'Gas refill', 'Fridge repair',
           'Washing machine repair', 'Microwave & OTG', 'Water purifier service', 'Chimney deep clean'] },

  { id: 'cleaning', name: 'Home Cleaning', ico: '🧹', group: 'home', accent: '#7FD1A6',
    base: 40000, workMins: 90, unit: UNITS.SQFT, altUnit: UNITS.VISIT, minTier: 2,
    blurb: 'Deep cleaning and routine upkeep',
    subs: ['Full home deep clean', 'Bathroom deep clean', 'Kitchen deep clean', 'Sofa & carpet shampoo',
           'Post-construction clean', 'Water tank clean', 'Move-in / move-out', 'Balcony & windows'] },

  { id: 'pest', name: 'Pest Control', ico: '🐜', group: 'home', accent: '#9BC53D',
    base: 110000, workMins: 60, unit: UNITS.SQFT, altUnit: UNITS.VISIT, minTier: 2, warrantyDays: 90,
    blurb: 'Treatment with a written warranty period',
    subs: ['Cockroach gel', 'General pest (2/3 BHK)', 'Termite treatment', 'Bed bugs',
           'Mosquito fogging', 'Rodent control', 'Herbal child-safe pack'] },

  { id: 'vehicle', name: 'Vehicle Care', ico: '🏍️', group: 'home', accent: '#8E9BF0',
    base: 55000, workMins: 60, unit: UNITS.ITEM, altUnit: UNITS.MONTH, minTier: 2,
    blurb: 'Two & four wheeler at your doorstep',
    subs: ['Bike service at home', 'Car wash (dry / foam)', 'Interior detailing', 'Battery jumpstart',
           'Flat tyre & puncture', 'RSA towing', 'Periodic service pickup-drop'] },

  { id: 'help', name: 'Domestic Help & Cook', ico: '👩‍🍳', group: 'care', accent: '#E39BB8',
    base: 600000, workMins: 60, unit: UNITS.MONTH, altUnit: UNITS.HOUR, minTier: 3, recurring: true, homeAccess: true,
    blurb: 'Recurring household staff, background checked',
    subs: ['Daily maid (sweep / mop / utensils)', 'Cook (veg / non-veg)', 'Full-time housekeeping',
           'Elder companion', 'Baby sitter', 'Driver on call'] },

  { id: 'salon', name: 'Salon & Beauty at Home', ico: '💇', group: 'care', accent: '#E96D8D',
    base: 90000, workMins: 75, unit: UNITS.ITEM, altUnit: UNITS.SESSION, minTier: 2,
    blurb: 'Doorstep grooming, women & men',
    subs: ['Waxing (full / half)', 'Facial & cleanup', 'Haircut & styling', 'Manicure & pedicure',
           'Threading & face wax', 'Bridal & party makeup', 'Hair spa & colour', 'Mens grooming & beard'] },

  { id: 'wellness', name: 'Wellness & Massage', ico: '💆', group: 'care', accent: '#B99BE0',
    base: 130000, workMins: 60, unit: UNITS.SESSION, altUnit: UNITS.HOUR, minTier: 3, homeAccess: true,
    blurb: 'Therapy and physical wellbeing at home',
    subs: ['Full body massage', 'Ayurvedic / abhyanga', 'Physiotherapy session', 'Yoga trainer',
           'Personal fitness trainer', 'Post-natal massage'] },

  { id: 'health', name: 'Health & Care at Home', ico: '🩺', group: 'care', accent: '#6FC3B8',
    base: 70000, workMins: 45, unit: UNITS.VISIT, altUnit: UNITS.SHIFT, minTier: 4, licenceRequired: true, homeAccess: true,
    blurb: 'Nursing, samples, elder care — licence checked',
    subs: ['Nurse visit (injection / dressing)', 'Blood sample collection', 'Doctor teleconsult',
           'Clinical physiotherapy', 'Elder care attendant (12/24h)', 'BP & sugar check',
           'Equipment rental (oxygen, bed)'] },

  { id: 'pet', name: 'Pet Care', ico: '🐕', group: 'care', accent: '#D9A05B',
    base: 60000, workMins: 60, unit: UNITS.VISIT, altUnit: UNITS.DAY, minTier: 2,
    blurb: 'Grooming, vets, walking, boarding',
    subs: ['Dog grooming & bath', 'Vet home visit', 'Dog walking', 'Boarding / day care',
           'Vaccination', 'Cat grooming', 'Pet taxi', 'Aquarium cleaning'] },

  { id: 'tutor', name: 'Tutoring & Skills', ico: '📚', group: 'life', accent: '#7BA7E8',
    base: 50000, workMins: 60, unit: UNITS.HOUR, altUnit: UNITS.MONTH, minTier: 3, recurring: true, homeAccess: true,
    blurb: 'Home & online tuition — first demo class free',
    subs: ['School tuition (Class 1-10)', 'IIT-JEE / NEET', 'SSC / Banking / Govt exams', 'Spoken English',
           'Music (keyboard / guitar / vocal)', 'Dance', 'Coding for kids', 'Abacus & handwriting'] },

  { id: 'moving', name: 'Moving & Transport', ico: '🚚', group: 'life', accent: '#E28B4E',
    base: 250000, workMins: 180, unit: UNITS.QUOTE, altUnit: UNITS.KM, minTier: 2,
    blurb: 'Shifting, tempo, parcels, loading help',
    subs: ['House shifting (1/2/3 BHK)', 'Single item shift', 'Mini-truck / tempo on demand',
           'Packers & packing material', 'Intra-city parcel pickup', 'Loading-unloading labour',
           'Bike taxi parcel'] },

  { id: 'events', name: 'Events & Occasions', ico: '🎪', group: 'life', accent: '#D96FA8',
    base: 350000, workMins: 240, unit: UNITS.QUOTE, altUnit: UNITS.PLATE, minTier: 2,
    blurb: 'Birthdays, poojas, catering, photography',
    subs: ['Birthday decoration', 'Catering (per plate)', 'Tent, chairs & lighting',
           'Photographer / videographer', 'DJ & sound', 'Pandit / priest services', 'Mehndi artist',
           'House-warming & pooja setup'] },

  { id: 'laundry', name: 'Laundry & Tailoring', ico: '👕', group: 'life', accent: '#9BB8E0',
    base: 18000, workMins: 30, unit: UNITS.KG, altUnit: UNITS.ITEM, minTier: 1, recurring: true,
    blurb: 'Wash, iron, dry clean, alterations',
    subs: ['Wash & fold (per kg)', 'Dry cleaning (per garment)', 'Steam iron', 'Shoe cleaning',
           'Saree roll / fall / pico', 'Blouse & alteration stitching', 'Curtain cleaning'] },
];

SERVICES.forEach(c => register('category', Object.freeze({ ...c, kind: 'service' })));

export const SERVICE_IDS = SERVICES.map(c => c.id);
export default SERVICES;
