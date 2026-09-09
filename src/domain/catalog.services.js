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
/* WHY EVERY JOB IN A CATEGORY USED TO COST THE SAME.
   `subs` were bare strings, so "Tap & mixer repair" and "Pipeline replacement"
   both quoted the category's base — under a screen promising "the price cannot
   change without your approval" and a home page promising "price locked before
   you book". One of those two jobs was going to end with the pro walking away
   or the price moving, and either way the lock was a lie.

   These are RELATIVE SIZES, not prices. The rupee figure is still the pro's own
   ask times the owner's dials; this only says that a tank clean is a bigger
   piece of work than a washer. Anything not listed is 1.0. A sub marked
   `survey` is one no honest tradesperson quotes unseen — the app says so and
   asks for approval on the day instead of pretending to lock a number.

   Tune these in one place; no screen may hardcode a multiplier. */
export const SUB_SIZE = {
  plumbing: { 'Tap & mixer repair': 0.7, 'Leak detection': 0.9, 'Blocked drain / sink': 0.9,
              'Toilet & flush repair': 1.0, 'Motor & pump': 1.4, 'Overhead tank cleaning': 1.6,
              'Geyser install': 1.3, 'Pipeline replacement': { x: 2.2, survey: true } },
  electrical: { 'Fan install / repair': 0.8, 'Switchboard & socket': 0.7, 'MCB / fuse trip': 0.8,
                'Inverter & battery': { x: 1.6, survey: true },
                'Light & chandelier fitting': 0.9, 'Doorbell & CCTV point': 1.2,
                'Wiring fault trace': { x: 1.5, survey: true } },
  appliance: { 'AC service (split / window)': 0.8, 'AC install / uninstall': { x: 1.4, survey: true },
               'Gas refill': 1.2, 'Fridge repair': 1.1, 'Washing machine repair': 1.0,
               'Microwave & OTG': 0.8, 'Water purifier service': 0.7, 'Chimney deep clean': 1.1 },
  cleaning: { 'Full home deep clean': { x: 2.4, survey: true }, 'Bathroom deep clean': 0.8,
              'Kitchen deep clean': 1.1, 'Sofa & carpet shampoo': 1.0,
              'Post-construction clean': { x: 2.6, survey: true }, 'Water tank clean': 1.2,
              'Move-in / move-out': { x: 2.2, survey: true }, 'Balcony & windows': 0.7 },
  pest: { 'Cockroach gel': 0.8, 'General pest (2/3 BHK)': 1.2,
          'Termite treatment': { x: 2.0, survey: true }, 'Bed bugs': 1.4,
          'Mosquito fogging': 0.9, 'Rodent control': 1.2, 'Herbal child-safe pack': 1.3 },
  repair: { 'Furniture assembly': 1.0, 'Door & lock repair': 0.8, 'Drilling / wall mounting': 0.6,
            'Curtain rod fitting': 0.6, 'Modular kitchen repair': { x: 1.6, survey: true },
            'Wardrobe & hinge fix': 0.9, 'Bed & sofa repair': 1.1,
            'False ceiling patch': { x: 1.4, survey: true } },
  moving: { 'House shifting (1/2/3 BHK)': { x: 3.0, survey: true }, 'Single item shift': 0.6,
            'Mini-truck / tempo on demand': 1.6, 'Packers & packing material': { x: 1.8, survey: true },
            'Intra-city parcel pickup': 0.5, 'Loading-unloading labour': 0.9, 'Bike taxi parcel': 0.4 },
  vehicle: { 'Bike service at home': 0.9, 'Car wash (dry / foam)': 0.7, 'Interior detailing': 1.8,
             'Battery jumpstart': 0.5, 'Flat tyre & puncture': 0.5, 'RSA towing': { x: 1.6, survey: true },
             'Periodic service pickup-drop': 1.4 },
  help: { 'Daily maid (sweep / mop / utensils)': 1.0, 'Cook (veg / non-veg)': 1.2,
          'Full-time housekeeping': { x: 2.4, survey: true }, 'Elder companion': 1.6,
          'Baby sitter': 1.4, 'Driver on call': 1.1 },
  salon: { 'Waxing (full / half)': 0.9, 'Facial & cleanup': 1.0, 'Haircut & styling': 0.7,
           'Manicure & pedicure': 0.9, 'Threading & face wax': 0.4,
           'Bridal & party makeup': { x: 3.0, survey: true }, 'Hair spa & colour': 1.6,
           'Mens grooming & beard': 0.6 },
  wellness: { 'Full body massage': 1.0, 'Ayurvedic / abhyanga': 1.3, 'Physiotherapy session': 1.2,
              'Yoga trainer': 0.9, 'Personal fitness trainer': 1.0, 'Post-natal massage': 1.2 },
  health: { 'Nurse visit (injection / dressing)': 0.7, 'Blood sample collection': 0.5,
            'Doctor teleconsult': 0.5, 'Clinical physiotherapy': 1.1,
            'Elder care attendant (12/24h)': { x: 3.0, survey: true }, 'BP & sugar check': 0.4,
            'Equipment rental (oxygen, bed)': { x: 1.8, survey: true } },
  pet: { 'Dog grooming & bath': 1.0, 'Vet home visit': 1.5, 'Dog walking': 0.35,
         'Boarding / day care': { x: 1.8, survey: true }, 'Vaccination': 0.9,
         'Cat grooming': 0.9, 'Pet taxi': 0.6, 'Aquarium cleaning': 0.9 },
  tutor: { 'School tuition (Class 1-10)': 0.9, 'IIT-JEE / NEET': 2.0,
           'SSC / Banking / Govt exams': 1.4, 'Spoken English': 0.9,
           'Music (keyboard / guitar / vocal)': 1.1, 'Dance': 1.0,
           'Coding for kids': 1.3, 'Abacus & handwriting': 0.7 },
  events: { 'Birthday decoration': 1.2, 'Catering (per plate)': { x: 2.0, survey: true },
            'Tent, chairs & lighting': { x: 1.8, survey: true },
            'Photographer / videographer': 2.2, 'DJ & sound': 1.6,
            'Pandit / priest services': 1.0, 'Mehndi artist': 0.9,
            'House-warming & pooja setup': { x: 1.6, survey: true } },
  laundry: { 'Wash & fold (per kg)': 0.6, 'Dry cleaning (per garment)': 0.8, 'Steam iron': 0.4,
             'Shoe cleaning': 0.7, 'Saree roll / fall / pico': 0.6,
             'Blouse & alteration stitching': 1.0, 'Curtain cleaning': 1.2 },
};

/** The multiplier for a sub-service, and whether it must be seen to be priced. */
export function subSize(catId, sub) {
  const e = (SUB_SIZE[catId] || {})[sub];
  if (e == null) return { x: 1, survey: false };
  return typeof e === 'number' ? { x: e, survey: false } : { x: e.x, survey: !!e.survey };
}

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
