/* SAAHAA · domain/starter-catalog.js — the SEEDED STARTER CATALOG.
   This is the answer to "make sure grocery store can list their products too."

   A kirana owner on a cheap Android with two free minutes will abandon any
   long form. So they never type a product from scratch: they search this
   catalog, TAP an item, overtype the price, set stock — about 6 seconds per
   SKU. (Panel decision V2-B2, confidence 5.)

   Rows are compact tuples to keep the file readable and small:
     [ name, unit, priceRupees, mrpRupees|0, flagString ]
   flags: v=variable weight  c=cold chain  x=perishable(needs mfg date)
          r=Rx required      b=booking only (price locked, no markup)
   Prices are realistic Hyderabad rates; the shop overrides every one. */

const R = 100; // rupees -> paise

/* catId -> aisle -> rows */
const RAW = {
  kirana: {
    'Staples & Flour': [
      ['Aashirvaad Atta 5kg', 'pack', 285, 310, ''], ['Fortune Chakki Atta 10kg', 'pack', 520, 560, ''],
      ['Sona Masoori Rice (loose)', 'kg', 62, 0, 'v'], ['HMT Rice 26kg bag', 'bag', 1560, 0, ''],
      ['Idli Rava (loose)', 'kg', 58, 0, 'v'], ['Maida (loose)', 'kg', 52, 0, 'v'],
      ['Sugar (loose)', 'kg', 46, 0, 'v'],
    ],
    /* A KIRANA THAT SOLD ONE THING BY WEIGHT. The persona this product is
       built for sells "loose rice, dal and vegetables by weight" and the
       starter catalogue gave a whole shop exactly ONE variable-weight line —
       so the scale, the short-weigh refund and the reweigh cap, which are the
       most carefully built machinery in the app, could appear on one row of a
       thirty-seven item shop. Dal is bought by the kilo from a sack in
       Hyderabad; it is listed that way. Packed brands stay packed. */
    'Dals & Pulses': [
      ['Toor Dal (loose)', 'kg', 165, 0, 'v'], ['Moong Dal (loose)', 'kg', 128, 0, 'v'],
      ['Chana Dal (loose)', 'kg', 92, 0, 'v'], ['Urad Dal (Gota) 1kg', 'kg', 142, 0, ''],
    ],
    'Oils & Ghee': [
      ['Fortune Sunflower Oil 1L', 'pouch', 142, 155, ''], ['Freedom Sunflower 5L can', 'can', 690, 730, ''],
      ['Idhayam Sesame Oil 500ml', 'btl', 185, 199, ''], ['Amul Ghee 500ml', 'pack', 340, 355, ''],
    ],
    'Spices & Masala': [
      ['Everest Turmeric 100g', 'pack', 42, 45, ''], ['Priya Red Chilli Powder 200g', 'pack', 78, 85, ''],
      ['MTR Sambar Powder 100g', 'pack', 48, 52, ''], ['Tamarind (seedless) 500g', 'pack', 95, 0, ''],
      ['Mustard Seeds 100g', 'pack', 22, 0, ''],
    ],
    'Sugar, Salt & Basics': [
      ['Sugar (loose) 1kg', 'kg', 48, 0, 'v'], ['Tata Salt 1kg', 'pack', 28, 30, ''],
      ['Jaggery Block 1kg', 'kg', 72, 0, 'v'],
    ],
    'Packaged & Snacks': [
      ['Maggi 2-Min Noodles 12-pack', 'pack', 168, 180, ''], ['Parle-G 800g family pack', 'pack', 85, 90, ''],
      ['Lays Magic Masala', 'pack', 20, 20, ''], ['Britannia Good Day 600g', 'pack', 150, 160, ''],
      ['Kurkure', 'pack', 20, 20, ''],
    ],
    'Beverages': [
      ['Tata Tea Gold 500g', 'pack', 305, 330, ''], ['Bru Instant Coffee 100g', 'jar', 340, 360, ''],
      ['Thums Up 750ml', 'btl', 45, 45, ''], ['Bisleri 1L', 'btl', 20, 20, ''],
    ],
    'Home & Cleaning': [
      ['Surf Excel Easy Wash 1kg', 'pack', 135, 145, ''], ['Vim Bar 3-pack', 'pack', 45, 48, ''],
      ['Harpic 500ml', 'btl', 98, 105, ''], ['Lizol 500ml', 'btl', 115, 125, ''], ['Colin 500ml', 'btl', 99, 105, ''],
    ],
    'Personal Care': [
      ['Colgate Strong Teeth 200g', 'pack', 115, 122, ''], ['Clinic Plus Shampoo 175ml', 'btl', 110, 118, ''],
      ['Lifebuoy Soap 4-pack', 'pack', 120, 128, ''], ['Dettol Handwash 200ml', 'btl', 99, 105, ''],
    ],
    'Baby': [
      ['Pampers Pants M 32s', 'pack', 649, 699, ''], ['Cerelac Wheat 300g', 'pack', 285, 299, 'x'],
      ['Johnson Baby Soap 75g', 'pc', 68, 72, ''],
    ],
  },

  veg: {
    'Daily Vegetables': [
      ['Tomato', 'kg', 32, 0, 'v'], ['Onion', 'kg', 38, 0, 'v'], ['Potato', 'kg', 34, 0, 'v'],
      ['Green Chilli', 'kg', 60, 0, 'v'], ['Ginger', 'kg', 110, 0, 'v'], ['Garlic', 'kg', 180, 0, 'v'],
    ],
    'Leafy Greens': [
      ['Palak (Spinach)', 'bunch', 15, 0, 'x'], ['Coriander (Kothimeera)', 'bunch', 10, 0, 'x'],
      ['Curry Leaves', 'bunch', 10, 0, 'x'], ['Methi', 'bunch', 20, 0, 'x'], ['Gongura', 'bunch', 20, 0, 'x'],
    ],
    'Gourds & Others': [
      ['Brinjal', 'kg', 45, 0, 'v'], ['Ladies Finger (Bhindi)', 'kg', 55, 0, 'v'],
      ['Bottle Gourd (Sorakaya)', 'pc', 35, 0, ''], ['Ridge Gourd (Beerakaya)', 'kg', 50, 0, 'v'],
      ['Drumstick', 'pc', 15, 0, ''], ['Carrot', 'kg', 58, 0, 'v'], ['Beans', 'kg', 75, 0, 'v'],
      ['Cabbage', 'pc', 30, 0, ''], ['Cauliflower', 'pc', 40, 0, ''], ['Capsicum', 'kg', 70, 0, 'v'],
    ],
    'Fruits': [
      ['Banana (Chakkarakeli)', 'dozen', 60, 0, ''], ['Apple (Shimla)', 'kg', 180, 0, 'v'],
      ['Pomegranate', 'kg', 160, 0, 'v'], ['Papaya', 'kg', 40, 0, 'v'], ['Mosambi', 'kg', 85, 0, 'v'],
      ['Watermelon', 'kg', 35, 0, 'v'], ['Grapes', 'kg', 90, 0, 'v'],
    ],
    'Combos': [
      ['Weekly Veg Basket (10 items, 6kg)', 'basket', 399, 0, ''],
    ],
  },

  meat: {
    'Chicken': [
      ['Broiler Curry Cut (with skin)', 'kg', 230, 0, 'vc'], ['Skinless Curry Cut', 'kg', 260, 0, 'vc'],
      ['Boneless Breast', 'kg', 340, 0, 'vc'], ['Chicken Legs (4pc)', 'pack', 190, 0, 'c'],
      ['Country Chicken (Natu Kodi)', 'kg', 520, 0, 'vc'], ['Chicken Liver 250g', 'pack', 80, 0, 'c'],
    ],
    'Mutton': [
      ['Mutton Curry Cut', 'kg', 880, 0, 'vc'], ['Mutton Boneless', 'kg', 1050, 0, 'vc'],
      ['Mutton Keema 500g', 'pack', 460, 0, 'c'], ['Mutton Liver 250g', 'pack', 180, 0, 'c'],
      ['Paya (4pc)', 'set', 220, 0, 'c'],
    ],
    'Fish & Seafood': [
      ['Rohu (cleaned)', 'kg', 280, 0, 'vc'], ['Katla', 'kg', 300, 0, 'vc'],
      ['Korameenu (Murrel)', 'kg', 650, 0, 'vc'], ['Prawns Medium (cleaned)', 'kg', 520, 0, 'vc'],
      ['Vanjaram Slices', 'kg', 950, 0, 'vc'], ['Tilapia', 'kg', 220, 0, 'vc'],
    ],
    'Eggs': [
      ['Farm Eggs 30-tray', 'tray', 210, 0, ''], ['Eggs 6-pack', 'pack', 48, 0, ''],
      ['Country Eggs 6-pack', 'pack', 90, 0, ''],
    ],
  },

  dairy: {
    'Milk': [
      ['Heritage Toned 500ml', 'pack', 28, 28, 'cx'], ['Jersey Full Cream 500ml', 'pack', 35, 35, 'cx'],
      ['Amul Gold 500ml', 'pack', 36, 36, 'cx'], ['Loose Buffalo Milk', 'L', 70, 0, 'cxv'],
      ['Dodla Standardised 1L', 'pack', 62, 62, 'cx'],
    ],
    'Curd & Paneer': [
      ['Heritage Curd 400g', 'pack', 40, 42, 'cx'], ['Amul Masti Dahi 400g', 'pack', 42, 44, 'cx'],
      ['Paneer 200g', 'pack', 95, 0, 'cx'], ['Butter Milk 500ml', 'pack', 15, 15, 'cx'],
      ['Amul Butter 100g', 'pack', 62, 62, 'cx'], ['Amul Cheese Slices 100g', 'pack', 95, 98, 'cx'],
    ],
    'Bakery': [
      ['Milk Bread 400g', 'pack', 45, 0, 'x'], ['Brown Bread 400g', 'pack', 50, 0, 'x'],
      ['Bun (6pc)', 'pack', 30, 0, 'x'], ['Osmania Biscuits 250g', 'pack', 60, 0, ''],
      ['Dilkush', 'pc', 40, 0, 'x'], ['Veg Puff', 'pc', 25, 0, 'x'], ['Cream Bun', 'pc', 20, 0, 'x'],
      ['Rusk 300g', 'pack', 55, 0, ''],
    ],
    'Sweets': [
      ['Mysore Pak 250g', 'box', 120, 0, 'x'], ['Kaju Katli 250g', 'box', 280, 0, 'x'],
      ['Boondi Laddu 250g', 'box', 90, 0, 'x'],
    ],
  },

  pharmacy: {
    'OTC Pain & Fever': [
      ['Dolo 650 (15 tab)', 'strip', 34, 34, ''], ['Combiflam (20 tab)', 'strip', 58, 58, ''],
      ['Volini Gel 30g', 'tube', 135, 135, ''], ['Moov Spray 50g', 'can', 210, 210, ''],
    ],
    'Cold & Digestive': [
      ['Vicks Vaporub 50ml', 'jar', 165, 165, ''], ['Strepsils (8 loz)', 'pack', 45, 45, ''],
      ['Digene Gel 200ml', 'btl', 150, 150, ''], ['ENO Sachet', 'pc', 6, 6, ''],
      ['Pudin Hara (10 cap)', 'strip', 40, 40, ''],
    ],
    'First Aid': [
      ['Dettol Antiseptic 100ml', 'btl', 68, 68, ''], ['Band-Aid (10 strips)', 'pack', 45, 45, ''],
      ['Cotton Roll 50g', 'pack', 35, 35, ''], ['Betadine 15ml', 'btl', 85, 85, ''],
      ['Soframycin 30g', 'tube', 65, 65, ''],
    ],
    'Devices & Diagnostics': [
      ['Digital Thermometer', 'pc', 180, 199, ''], ['Accu-Chek Active Strips (50)', 'pack', 1150, 1199, ''],
      ['BP Monitor (Omron)', 'pc', 1899, 2100, ''], ['Pulse Oximeter', 'pc', 899, 999, ''],
      ['N95 Mask', 'pc', 35, 40, ''],
    ],
    'Wellness': [
      ['ORS Sachet', 'pc', 22, 22, ''], ['Electral Powder', 'pack', 25, 25, ''],
      ['Zincovit (15 tab)', 'strip', 110, 110, ''], ['Shelcal 500 (15 tab)', 'strip', 135, 135, ''],
      ['Whisper Sanitary Pads 15s', 'pack', 185, 189, ''],
    ],
    'Prescription (Rx)': [
      ['Metformin 500 (15 tab)', 'strip', 32, 32, 'r'], ['Amlodipine 5mg (15 tab)', 'strip', 28, 28, 'r'],
      ['Azithromycin 500 (3 tab)', 'strip', 78, 78, 'r'],
    ],
  },

  water: {
    'Water': [
      ['20L Can (refill, own can)', 'can', 45, 0, ''], ['20L Can + new can deposit', 'can', 280, 0, ''],
      ['Bisleri 20L Refill', 'can', 85, 0, ''], ['5L Packaged', 'can', 60, 60, ''],
      ['1L x 12 Case', 'case', 210, 240, ''], ['Commercial Water Tanker', 'tanker', 1200, 0, ''],
    ],
    'LPG & Fuel': [
      ['Domestic Cylinder Refill 14.2kg', 'cyl', 905, 905, 'b'], ['Commercial 19kg', 'cyl', 1720, 1720, 'b'],
      ['Chhotu 5kg', 'cyl', 410, 410, 'b'], ['Gas Lighter', 'pc', 60, 65, ''],
      ['Regulator', 'pc', 250, 260, ''], ['Suraksha Hose Pipe 1.5m', 'pc', 190, 199, ''],
    ],
  },

  stationery: {
    'Notebooks & Paper': [
      ['Classmate Long Notebook 172pg', 'pc', 65, 70, ''], ['Ruled Notebook 100pg', 'pc', 35, 38, ''],
      ['A4 Sheets 500 (ream)', 'ream', 340, 360, ''], ['Graph Book', 'pc', 40, 42, ''],
      ['Record Book', 'pc', 75, 80, ''], ['Chart Paper', 'sheet', 15, 15, ''],
    ],
    'Writing': [
      ['Reynolds 045 Pen', 'pc', 10, 10, ''], ['Cello Butterflow (5pk)', 'pack', 50, 50, ''],
      ['Apsara Platinum Pencil (10pk)', 'pack', 60, 60, ''], ['Gel Pen', 'pc', 20, 20, ''],
      ['Permanent Marker', 'pc', 35, 38, ''], ['Highlighter', 'pc', 25, 28, ''],
    ],
    'Art & School': [
      ['Camlin Geometry Box', 'pc', 150, 160, ''], ['Faber-Castell Crayons 24', 'pack', 110, 118, ''],
      ['Water Colour Set', 'pack', 95, 99, ''], ['Glue Stick', 'pc', 35, 35, ''], ['Scale 30cm', 'pc', 20, 20, ''],
    ],
    'Office': [
      ['Stapler + Pins', 'pc', 120, 130, ''], ['File Folder', 'pc', 25, 25, ''],
      ['Sticky Notes', 'pack', 45, 48, ''], ['Envelope (10pc)', 'pack', 30, 30, ''],
      ['Tape Roll', 'pc', 40, 42, ''], ['Citizen Calculator', 'pc', 280, 300, ''],
    ],
    'Exam Kits': [
      ['Class 10 Full Stationery Kit', 'kit', 499, 0, ''], ['Office Starter Kit', 'kit', 899, 0, ''],
    ],
  },

  petshop: {
    'Dog Food': [
      ['Pedigree Adult Chicken 3kg', 'pack', 850, 899, ''], ['Pedigree Puppy 1.2kg', 'pack', 380, 399, ''],
      ['Drools Adult 3kg', 'pack', 690, 720, ''], ['Chicken Chunks Gravy Pouch 70g', 'pouch', 35, 38, ''],
      ['Milk Bone Dog Biscuits 500g', 'pack', 180, 190, ''],
    ],
    'Cat': [
      ['Whiskas Adult Ocean Fish 1.2kg', 'pack', 460, 480, ''], ['Me-O Kitten 1.2kg', 'pack', 420, 440, ''],
      ['Cat Litter (bentonite) 5kg', 'pack', 450, 470, ''], ['Whiskas Wet Pouch 80g', 'pouch', 45, 48, ''],
    ],
    'Accessories': [
      ['Nylon Collar (M)', 'pc', 180, 199, ''], ['Retractable Leash', 'pc', 450, 480, ''],
      ['Steel Bowl', 'pc', 150, 160, ''], ['Rubber Chew Toy', 'pc', 200, 220, ''],
      ['Pet Shampoo 200ml', 'btl', 280, 299, ''], ['Notix Tick Powder 100g', 'pack', 190, 199, ''],
    ],
    'Birds & Fish': [
      ['Bird Seed Mix 1kg', 'pack', 120, 130, ''], ['Taiyo Fish Food 100g', 'pack', 90, 95, ''],
      ['Cuttlebone', 'pc', 40, 45, ''],
    ],
    'Vet Meds': [
      ['Kiwof Deworming Tablet', 'pc', 120, 120, 'r'], ['Fiprofort Tick Spot-On', 'pc', 190, 199, 'r'],
    ],
  },
};

/* default substitution policy per category (V2-B7):
   staples/produce may be swapped for a similar brand; pharmacy/meat/baby never. */
const SUB_POLICY = {
  kirana: 'similar', veg: 'similar', stationery: 'similar', petshop: 'similar',
  dairy: 'call', water: 'call',
  meat: 'refund', pharmacy: 'refund',
};

function flatten() {
  const out = [];
  let n = 0;
  for (const [catId, aisles] of Object.entries(RAW)) {
    for (const [aisle, rows] of Object.entries(aisles)) {
      for (const [name, unit, price, mrp, flags] of rows) {
        out.push(Object.freeze({
          refId: `sc${++n}`,
          catId, aisle, name, unit,
          price: price * R,
          mrp: (mrp || 0) * R,
          variableWeight: flags.includes('v'),
          coldChain: flags.includes('c'),
          perishable: flags.includes('x'),
          rxRequired: flags.includes('r'),
          bookingOnly: flags.includes('b'),
          subPolicyDefault: SUB_POLICY[catId] || 'call',
        }));
      }
    }
  }
  return out;
}

export const STARTER = flatten();
export const byCategory = catId => STARTER.filter(p => p.catId === catId);
export const aislesOf = catId => [...new Set(byCategory(catId).map(p => p.aisle))];
export function searchStarter(catId, q) {
  const needle = String(q || '').trim().toLowerCase();
  const pool = catId ? byCategory(catId) : STARTER;
  if (!needle) return pool;
  return pool.filter(p => p.name.toLowerCase().includes(needle) || p.aisle.toLowerCase().includes(needle));
}
export const STARTER_COUNT = STARTER.length;
export default STARTER;
