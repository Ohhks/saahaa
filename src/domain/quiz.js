/* SAAHAA · domain/quiz.js — the trade and conduct question banks.

   WHY A QUIZ AT ALL. Nobody can check a plumber's hands over a phone. What we
   can check is whether he knows the five things every real plumber in
   Hyderabad knows and no impostor does — which is a far better filter than a
   certificate scan nobody can read. Five questions, four options, plain
   English a tradesperson uses on the job. Pass is 4 of 5.

   The CONDUCT quiz is different: it is not a filter, it is the moment the pro
   reads the rules once, with attention, because a wrong answer costs them a
   retry. Their code at the door, never cash outside, photo before payout. Pass is
   5 of 6.

   Answers are the INDEX of the correct option. Options are shuffled at render
   time by a seeded pick so the correct answer is not always in the same slot.
   Keep every question answerable from job experience alone — never from
   theory, never from a textbook. */

export const PASS = { trade: 4, conduct: 5 };
export const MAX_ATTEMPTS = 3;
export const LOCK_MS = 24 * 3600e3;

/* q: question · o: options · a: index of the correct option */
export const TRADE = {
  plumbing: [
    { q: 'A tap keeps dripping after it is closed. What do you replace first?',
      o: ['The washer or cartridge', 'The whole tap', 'The pipe behind it', 'The overhead tank'], a: 0 },
    { q: 'Which pipe is normally used for hot water lines in a flat?',
      o: ['CPVC', 'Plain PVC', 'Garden hose', 'GI without lining'], a: 0 },
    { q: 'Before opening a supply line inside a home, what must you do?',
      o: ['Close the main valve for that line', 'Open all taps', 'Switch off the geyser only', 'Nothing, just start'], a: 0 },
    { q: 'A bathroom drain is slow but not blocked. Most likely cause?',
      o: ['Hair and soap in the trap', 'Low water pressure', 'The tank float', 'A leaking flush valve'], a: 0 },
    { q: 'What is the trap under a wash basin for?',
      o: ['Holds water to block sewer smell', 'Increases pressure', 'Filters sand', 'Decoration'], a: 0 },
  ],
  electrical: [
    { q: 'Before touching any wiring in a house, the first step is?',
      o: ['Switch off the MCB and test the line is dead', 'Wear slippers', 'Ask the customer to hold a torch', 'Remove the neutral only'], a: 0 },
    { q: 'An MCB trips as soon as a geyser is switched on. Most likely?',
      o: ['Earth leakage or a short in the element', 'Low voltage from the board', 'A loose bulb', 'The fan regulator'], a: 0 },
    { q: 'Which wire colour is EARTH in India?',
      o: ['Green', 'Red', 'Black', 'Blue'], a: 0 },
    { q: 'A 1.5-ton AC point needs what kind of wiring?',
      o: ['A dedicated line with its own MCB', 'Any nearby socket', 'The fan circuit', 'A two-pin extension'], a: 0 },
    { q: 'A socket sparks when a plug is inserted. Cause?',
      o: ['Loose terminal or worn socket', 'Too much earth', 'Normal for old houses', 'The plug is too clean'], a: 0 },
  ],
  appliance: [
    { q: 'A split AC cools poorly and the outdoor pipe has ice on it. Most likely?',
      o: ['Low gas or a dirty filter', 'Remote battery', 'Too much gas', 'Wrong wall colour'], a: 0 },
    { q: 'How often should a home AC filter be cleaned in Hyderabad dust?',
      o: ['Every 2–4 weeks in season', 'Once a year', 'Never, it is sealed', 'Only when it smells'], a: 0 },
    { q: 'Which gas is common in newer home ACs in India?',
      o: ['R32 or R410A', 'LPG', 'CNG', 'Oxygen'], a: 0 },
    { q: 'A fridge runs all the time but is not cold. First check?',
      o: ['Condenser coils and door seal', 'The power plug colour', 'The freezer light', 'The floor level'], a: 0 },
    { q: 'Before gas refill on an AC, what must you do?',
      o: ['Check for leaks and fix them first', 'Fill straight away', 'Remove the remote', 'Run it on fan mode for a day'], a: 0 },
  ],
  cleaning: [
    { q: 'Which cleaner should NEVER be mixed with bleach?',
      o: ['Acid or ammonia cleaners', 'Plain water', 'Dish soap', 'Baking soda'], a: 0 },
    { q: 'For a marble floor you should avoid?',
      o: ['Acidic cleaners like harpic', 'Mild soap water', 'A microfiber mop', 'Dry dusting'], a: 0 },
    { q: 'Deep-cleaning a kitchen, what do you do first?',
      o: ['Remove loose dirt and dust before wet cleaning', 'Wet the floor first', 'Spray perfume', 'Clean the fan last with water'], a: 0 },
    { q: 'A sofa fabric tag says "S". It means?',
      o: ['Solvent clean only, no water', 'Soak in water', 'Steam only', 'Safe for bleach'], a: 0 },
    { q: 'After the job, the customer’s things are?',
      o: ['Put back where they were', 'Left in one corner', 'Taken for cleaning', 'Thrown if they look old'], a: 0 },
  ],
  repair: [
    { q: 'A door is rubbing the frame at the top. First thing to check?',
      o: ['Loose hinge screws', 'The lock', 'The paint', 'The floor tiles'], a: 0 },
    { q: 'Which screw is used for plywood and MDF?',
      o: ['Wood screw or chipboard screw', 'Machine bolt', 'Nail', 'Self-tapping metal screw only'], a: 0 },
    { q: 'For fixing a shelf to a brick wall you use?',
      o: ['Wall plugs (rawl plugs) and screws', 'Nails only', 'Fevicol only', 'Tape'], a: 0 },
    { q: 'Before painting a wall with old flaking paint you must?',
      o: ['Scrape, sand and prime it', 'Paint over it thick', 'Wet it', 'Add more colour'], a: 0 },
    { q: 'What does a spirit level tell you?',
      o: ['Whether something is straight/level', 'The wood type', 'The screw size', 'The paint shade'], a: 0 },
  ],
  pest: [
    { q: 'Before spraying inside a home you must ask about?',
      o: ['Children, pets, pregnant people and food kept open', 'The TV size', 'Their car', 'The WiFi password'], a: 0 },
    { q: 'The gel bait for cockroaches goes?',
      o: ['In small dots in cracks and under sinks', 'Poured on the floor', 'Mixed in drinking water', 'On the walls in lines'], a: 0 },
    { q: 'For termites in a wooden frame, the usual treatment is?',
      o: ['Drill-and-inject termiticide', 'Just paint it', 'Wash with water', 'Cover with plastic'], a: 0 },
    { q: 'After a chemical spray, the family should stay out for?',
      o: ['The time on the label, usually 2–4 hours', 'One week', 'No need to leave', 'Five minutes'], a: 0 },
    { q: 'Bed bugs are found mostly?',
      o: ['In mattress seams and bed frames', 'In the fridge', 'On the ceiling', 'In the water tank'], a: 0 },
  ],
  vehicle: [
    { q: 'Engine oil should be checked when?',
      o: ['Engine off, on level ground, after a few minutes', 'Engine running', 'On a slope', 'Only at the petrol pump'], a: 0 },
    { q: 'A car pulls to one side when driving. Common cause?',
      o: ['Uneven tyre pressure or alignment', 'Radio on', 'Too much fuel', 'AC on'], a: 0 },
    { q: 'Before jump-starting a battery, connect?',
      o: ['Red to positive first', 'Black to positive first', 'Both to negative', 'Any order is fine'], a: 0 },
    { q: 'Brake pads are worn when?',
      o: ['They squeal or the pedal goes deeper', 'The car goes faster', 'Fuel drops', 'The horn changes'], a: 0 },
    { q: 'A wash and polish: polish goes on?',
      o: ['A clean dry surface in shade', 'A wet car in sun', 'Over the dust', 'The tyres first'], a: 0 },
  ],
  help: [
    { q: 'A child in your care has a small cut. First step?',
      o: ['Wash with clean water and inform the parent', 'Ignore it', 'Apply turmeric and say nothing', 'Give a tablet'], a: 0 },
    { q: 'Raw chicken and cut vegetables should be?',
      o: ['Kept and cut separately', 'Cut on the same board', 'Stored together open', 'Washed together'], a: 0 },
    { q: 'You find money lying in the house. You?',
      o: ['Leave it and tell the family', 'Keep it', 'Hide it for later', 'Give it to the neighbour'], a: 0 },
    { q: 'Cooked food left outside in Hyderabad heat is safe for?',
      o: ['About 2 hours, then refrigerate', 'A whole day', 'Two days', 'Until it smells'], a: 0 },
    { q: 'An elderly person feels dizzy and confused suddenly. You?',
      o: ['Sit them down, call the family and 108 if needed', 'Give them coffee', 'Let them sleep it off', 'Go home'], a: 0 },
  ],
  salon: [
    { q: 'Before a facial or waxing on a new client you should?',
      o: ['Do a small patch test / ask about allergies', 'Start immediately', 'Use the strongest product', 'Skip cleansing'], a: 0 },
    { q: 'Razors and blades between clients are?',
      o: ['Single-use, new for each client', 'Wiped and reused', 'Reused for a week', 'Washed in water only'], a: 0 },
    { q: 'Hair colour developer 20 volume is used for?',
      o: ['Normal grey coverage and 1–2 shades lift', 'Bleaching to blonde', 'Cleaning tools', 'Skin'], a: 0 },
    { q: 'For hot wax the correct temperature test is?',
      o: ['On your own wrist first', 'Straight on the client', 'Boiling', 'No test needed'], a: 0 },
    { q: 'A client has an open cut on the skin. You?',
      o: ['Avoid that area completely', 'Wax over it', 'Apply bleach', 'Continue if they insist'], a: 0 },
  ],
  wellness: [
    { q: 'Before a massage you must ask about?',
      o: ['Injuries, surgery, pregnancy, blood pressure', 'Their salary', 'Their car', 'Nothing'], a: 0 },
    { q: 'Deep pressure on the front of the neck is?',
      o: ['Never done — it is unsafe', 'Fine', 'Good for headaches', 'Standard'], a: 0 },
    { q: 'Oil for massage should be?',
      o: ['Warmed slightly and tested on the wrist', 'Hot from the stove', 'Cold from the fridge', 'Any cooking oil'], a: 0 },
    { q: 'A client says a spot is painful. You?',
      o: ['Reduce pressure and avoid it', 'Press harder', 'Ignore', 'Stop the whole session and leave'], a: 0 },
    { q: 'Your towels and sheets between clients are?',
      o: ['Fresh and washed for each client', 'Reused if they look clean', 'Sprayed with perfume', 'Not needed'], a: 0 },
  ],
  health: [
    { q: 'Before giving any medicine at home you must?',
      o: ['Check the prescription and the patient name', 'Guess the dose', 'Give what worked for someone else', 'Ask the neighbour'], a: 0 },
    { q: 'Used needles go?',
      o: ['In a sharps container, never the dustbin', 'In the kitchen bin', 'Down the drain', 'In a plastic bag'], a: 0 },
    { q: 'A patient’s BP reads 190/120 and they have a headache. You?',
      o: ['Call the doctor / 108 now', 'Wait till tomorrow', 'Give extra water', 'Massage the head'], a: 0 },
    { q: 'Hand washing is done?',
      o: ['Before and after every patient contact', 'Once in the morning', 'Only if visibly dirty', 'After lunch'], a: 0 },
    { q: 'A bedridden patient should be turned?',
      o: ['Every 2 hours to prevent bed sores', 'Once a day', 'Never', 'Only when asked'], a: 0 },
  ],
  pet: [
    { q: 'Which food is poisonous for dogs?',
      o: ['Chocolate, grapes, onions', 'Boiled rice', 'Plain chicken', 'Carrots'], a: 0 },
    { q: 'A dog shows teeth and stiffens. You?',
      o: ['Stop, give space, do not stare or reach', 'Hug it', 'Pat its head', 'Pick it up'], a: 0 },
    { q: 'Nail clipping — cut too deep and you hit?',
      o: ['The quick, which bleeds', 'Nothing, nails are dead', 'The bone', 'The paw pad'], a: 0 },
    { q: 'Walking a dog in Hyderabad summer is best?',
      o: ['Early morning or after sunset', 'At 2pm', 'Any time', 'On hot tar'], a: 0 },
    { q: 'A cat is vomiting repeatedly. You?',
      o: ['Inform the owner and suggest a vet', 'Give human medicine', 'Feed more', 'Ignore'], a: 0 },
  ],
  tutor: [
    { q: 'A student keeps getting the same type of sum wrong. You?',
      o: ['Find the step they misunderstand and reteach it', 'Give 50 more sums', 'Scold them', 'Skip the topic'], a: 0 },
    { q: 'For a class 10 board student, the most useful habit is?',
      o: ['Solving previous years’ papers on time', 'Reading the textbook once', 'Watching videos only', 'Memorising answers'], a: 0 },
    { q: 'A parent asks for daily progress. You?',
      o: ['Share a short weekly note and be honest', 'Say everything is perfect', 'Refuse', 'Only report marks'], a: 0 },
    { q: 'Teaching at a student’s home, you are alone with a minor. You?',
      o: ['Keep the door open and a parent nearby', 'Lock the door for silence', 'Ask the parent to leave', 'It does not matter'], a: 0 },
    { q: 'A student says "I understood" but cannot solve one alone. It means?',
      o: ['They need to practise, not just listen', 'They are lying', 'The topic is done', 'Move to the next chapter'], a: 0 },
  ],
  moving: [
    { q: 'A fridge should be moved?',
      o: ['Upright, and rested before switching on', 'On its side, plugged in at once', 'Upside down', 'Any way'], a: 0 },
    { q: 'Glass and crockery are packed with?',
      o: ['Paper/bubble wrap, marked FRAGILE, on top', 'Loose in a bag', 'Under the heavy boxes', 'With the tools'], a: 0 },
    { q: 'Before lifting a heavy almirah you?',
      o: ['Empty it and lift with your legs, two people', 'Lift alone quickly', 'Drag it on the floor', 'Push it down the stairs'], a: 0 },
    { q: 'In a load, the heaviest items go?',
      o: ['At the bottom, against the cab', 'On top', 'At the back edge', 'Anywhere'], a: 0 },
    { q: 'A wall gets scratched during a move. You?',
      o: ['Tell the customer at once and note it', 'Hide it with a box', 'Say nothing', 'Blame the customer'], a: 0 },
  ],
  events: [
    { q: 'Food for 100 guests at 7pm is ready at?',
      o: ['Just before, kept hot and covered', 'At 10am, kept open', 'Whenever', 'Made at the venue at 7pm'], a: 0 },
    { q: 'A power cut during an event. You?',
      o: ['Have a backup plan (genset/battery lights) ready', 'Send everyone home', 'Wait', 'Blame the venue'], a: 0 },
    { q: 'Decoration on a rented hall wall uses?',
      o: ['Tape and stands that leave no marks', 'Nails', 'Strong glue', 'Paint'], a: 0 },
    { q: 'For a child’s birthday, the most important safety point is?',
      o: ['No small balloons/choking parts near toddlers', 'Loud music', 'Big candles everywhere', 'Sharp props'], a: 0 },
    { q: 'The customer changes the guest count a day before. You?',
      o: ['Confirm the new price and plan in writing', 'Refuse', 'Charge double silently', 'Ignore'], a: 0 },
  ],
  laundry: [
    { q: 'A silk saree should be?',
      o: ['Dry-cleaned or hand-washed cold, no wringing', 'Machine hot wash', 'Bleached', 'Ironed on max heat wet'], a: 0 },
    { q: 'Colours and whites are washed?',
      o: ['Separately', 'Together in hot water', 'Together with bleach', 'It does not matter'], a: 0 },
    { q: 'A shirt that shrunk was washed?',
      o: ['Too hot', 'Too cold', 'Without soap', 'Too gently'], a: 0 },
    { q: 'For ironing cotton the iron is set to?',
      o: ['High, with steam', 'Low', 'Off', 'Silk setting'], a: 0 },
    { q: 'A garment gets damaged in your care. You?',
      o: ['Tell the customer at once and settle fairly', 'Return it silently', 'Say it was like that', 'Keep it'], a: 0 },
  ],
};

/* ── the rules of the house ────────────────────────────────── */
export const CONDUCT = [
  { q: 'You arrive at the customer’s door. Before starting work you?',
    o: ['Ask for their SAAHAA code and enter it in the app', 'Start immediately', 'Call the office', 'Take a photo of the house'], a: 0 },
  { q: 'The customer offers to pay you cash directly and skip the app. You?',
    o: ['Refuse — payment is always through SAAHAA', 'Accept, it is more money', 'Accept half', 'Ask for UPI to your number'], a: 0 },
  { q: 'When is your money released to you?',
    o: ['After the work photo and the customer’s confirmation', 'Before you start', 'When you arrive', 'At the end of the month'], a: 0 },
  { q: '"You keep 100%" means?',
    o: ['The price you quote is exactly what you are paid', 'You pay 100% of the fee', 'The customer pays nothing', 'You get a bonus'], a: 0 },
  { q: 'You cannot make a job you accepted. You?',
    o: ['Cancel in the app as early as possible', 'Just do not go', 'Send a friend instead', 'Switch off the phone'], a: 0 },
  { q: 'A customer complains the work was not done properly. What decides it?',
    o: ['Your arrival code, your photos, and the SAAHAA team', 'Whoever shouts louder', 'The customer always wins', 'The pro always wins'], a: 0 },
];

/* Every category with a bank; a category without one falls back to the
   generic professional set so no trade is ever ungated. */
export const GENERIC = [
  { q: 'A customer asks for something outside what was booked. You?',
    o: ['Agree the extra price in the app before doing it', 'Do it and ask for cash', 'Refuse rudely', 'Do it free and complain later'], a: 0 },
  { q: 'You will be 30 minutes late. You?',
    o: ['Tell the customer in the app chat before the slot', 'Say nothing', 'Cancel silently', 'Blame traffic afterwards'], a: 0 },
  { q: 'Your tools for the job are?',
    o: ['Brought by you, in working order', 'Borrowed from the customer', 'Not needed', 'Bought on the way at their cost'], a: 0 },
  { q: 'After finishing you?',
    o: ['Show the customer the work and take a clear photo', 'Leave quickly', 'Ask for a tip', 'Take their number for next time'], a: 0 },
  { q: 'The customer’s home and belongings are?',
    o: ['Treated with respect, nothing touched that is not part of the job', 'Yours to use during the job', 'Fine to photograph', 'Not your concern'], a: 0 },
];

export function tradeBank(catId) { return TRADE[catId] || GENERIC; }

/* A seeded, deterministic shuffle so the correct option is not always first
   on screen but the SAME order is shown on every re-render of one attempt. */
export function shuffled(bank, seed = 1) {
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  return bank.map(item => {
    const idx = item.o.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return { q: item.q, o: idx.map(i => item.o[i]), a: idx.indexOf(item.a) };
  });
}

/** Score a set of answers (array of chosen option indexes) against a shuffled bank. */
export function score(bank, answers) {
  let right = 0;
  bank.forEach((item, i) => { if (answers[i] === item.a) right++; });
  return { right, total: bank.length };
}
