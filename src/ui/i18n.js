/* SAAHAA · ui/i18n.js — the app in the language the person actually speaks.

   WHY THIS EXISTS. This product knows exactly who it is for: a pro's public
   page defaults their languages to "Telugu, Hindi". Then it put every word of
   itself in English, and gated their livelihood behind a five-question English
   comprehension test with three attempts and a twenty-four hour lock. A
   competent Hyderabad plumber who cannot read English lost a working day to a
   reading test, and the lock screen explaining why was also in English.

   WHAT IS TRANSLATED, HONESTLY. The operationally critical surface: the door
   code on both sides, the seven onboarding steps, the money words, the conduct
   quiz, the navigation, and the warnings that cost somebody money or time.
   The per-trade question banks in domain/quiz.js are NOT translated yet —
   there are eighty-five of them across twenty trades, and a wrong translation
   in a test that can cost a day's work is worse than English. They fall back
   to English and the screen says so rather than pretending.

   NEEDS A NATIVE SPEAKER BEFORE LAUNCH. These strings were written to be
   plain and correct, but nobody whose first language this is has read them.
   `docs/I18N.md` is the checklist. Until that review happens the language
   picker carries a note saying so — an app should not quietly imply that its
   Telugu has been checked when it has not.

   HOW IT WORKS. `t('key')` returns the current language's string, falling back
   to English rather than to a blank or a key name. Interpolation is `{name}`.
   Nothing here touches the DOM; views call `t()` while they build markup. */

import * as persist from '../core/persist.js';
import { emit } from '../core/bus.js';

export const LANGS = [
  { id: 'en', label: 'English',  native: 'English' },
  { id: 'hi', label: 'Hindi',    native: 'हिन्दी' },
  { id: 'te', label: 'Telugu',   native: 'తెలుగు' },
];

const KEY = 'SAAHAA_LANG';
const urlLang = () => { try { return new URLSearchParams(location.search).get('lang'); } catch (e) { return null; } };

let current = (() => {
  const u = urlLang();
  if (u && LANGS.some(l => l.id === u)) return u;
  const saved = persist.read(KEY, null);
  if (saved && LANGS.some(l => l.id === saved)) return saved;
  /* the browser's own preference, if it is one we speak */
  try {
    for (const tag of (navigator.languages || [navigator.language || ''])) {
      const two = String(tag).slice(0, 2).toLowerCase();
      if (LANGS.some(l => l.id === two)) return two;
    }
  } catch (e) {}
  return 'en';
})();

export const lang = () => current;
export const langLabel = () => (LANGS.find(l => l.id === current) || LANGS[0]).native;
/* True while the current language has not been read by a native speaker. */
export const unreviewed = () => current !== 'en';

export function setLang(id) {
  if (!LANGS.some(l => l.id === id)) return current;
  current = id;
  persist.write(KEY, id);
  try { document.documentElement.lang = id; } catch (e) {}
  emit('lang:changed', { lang: id });
  return current;
}

/* ── the strings ───────────────────────────────────────────────
   Keys are namespaced by where they are read, so a translator can work through
   one screen at a time. English is the source of truth; a missing key in
   another language falls back to it rather than showing the key. */
const EN = {
  'stage.MATCHING':       'Finding your pro',
  'stage.ASSIGNED':       'Pro accepted',
  'stage.EN_ROUTE':       'On the way to you',
  'stage.ARRIVED':        'Pro has arrived',
  'stage.IN_PROGRESS':    'Work in progress',
  'stage.WORK_DONE':      'Work finished',
  'stage.SETTLED':        'Paid & settled',

  'lang.pick':            'Language',
  'lang.unreviewed':      'This translation has not yet been checked by a native speaker. Tell us if anything reads wrong.',

  'nav.home':             'Home',
  'nav.shops':            'Shops',
  'nav.orders':           'Orders',
  'nav.earn':             'Earn',
  'nav.you':              'You',

  /* the door — the one moment where a misunderstanding costs a job */
  'door.customer.title':  'Read your code out to your pro',
  'door.customer.body':   'This is your own SAAHAA code — the same one every job, so there is never a code to wait for. Read it out only once they are at your door. Them typing it is proof the right person came.',
  'door.pro.title':       'Ask the customer for their SAAHAA code',
  'door.pro.shape':       'It starts with C and has eight digits after it. It is on their screen, and it is the same one every time you work for them.',
  'door.pro.field':       'Their SAAHAA code',
  'door.pro.stake':       'Entering this code starts the job and locks {amount} of your own money. Every rupee of it comes back the moment the customer confirms the work.',
  'door.pro.submit':      'Verify & start work',
  'door.wrong':           'Wrong code',
  'door.tooMany':         'Too many wrong codes — a person will look at this',

  /* the seven steps */
  'ob.title':             'Getting you verified',
  'ob.steps':             'The seven steps',
  'ob.free':              'Jobs open the moment step 7 is done. Nobody has to approve you.',
  'ob.s1.t':              'Confirm your number',
  'ob.s1.s':              'Type your number and collect your SAAHAA code.',
  'ob.s2.t':              'Show us your ID',
  'ob.s2.s':              'Aadhaar, PAN or licence. We keep only the last 4 digits.',
  'ob.s3.t':              'One photo of you',
  'ob.s3.s':              'For checking who you are. It stays private.',
  'ob.s4.t':              'Five trade questions',
  'ob.s4.s':              'Things every real pro knows. Get 4 right.',
  'ob.s5.t':              'How SAAHAA works',
  'ob.s5.s':              'Six questions that teach. You cannot fail this one.',
  'ob.s6.t':              'Where to pay you',
  'ob.s6.s':              'Your UPI id. You send your earnings there whenever you like.',
  'ob.s7.t':              'Agree and go',
  'ob.s7.s':              'Read it, agree, and you are live.',
  'ob.noCode':            'Type the number you opened this account with. Nothing is texted to you — SAAHAA never sends codes.',
  'ob.yourCode':          'And this is your SAAHAA code',
  'ob.yourCodeBody':      'It is yours for good. Customers type it at their door to confirm you turned up, and it is printed on your public page. There is never another code to wait for.',
  'ob.quizWarn':          'Three wrong tries locks this for 24 hours. Take your time.',
  'ob.quizEnglish':       'These trade questions are only in English so far. Ask someone to read them with you if that helps — it is a test of the trade, not of English.',

  /* money — the words a pro checks every day */
  'money.available':      'Available',
  'money.availableSub':   'yours to withdraw',
  'money.locked':         'Locked',
  'money.pending':        'Pending',
  'money.released':       'Released',
  'money.withdraw':       'Withdraw',
  'money.add':            'Add money',
  'money.youKeep':        'You keep the whole {amount}. SAAHAA’s charge was paid on top, by the customer.',
  'money.minWithdraw':    'The smallest withdrawal is {amount}.',
  'money.stakeBack':      '{amount} comes back the moment the customer confirms.',

  /* the things that cost money or time if misunderstood */
  'warn.deviceFull':      'This device is full — your last changes were not saved.',
  'warn.deviceFullBody':  'Everything on screen after this point may disappear when you reopen the app. Free some space on the phone, or ask the owner to export and clear old data.',
  'job.cannotDo':         'I cannot do this job',
  'job.photoNeeded':      'Photograph the finished work',
  'job.photoWhy':         'The customer sees the picture. There is no way to be paid that skips it.',
};

const HI = {
  'stage.MATCHING':       'आपका कारीगर ढूँढ रहे हैं',
  'stage.ASSIGNED':       'कारीगर ने काम लिया',
  'stage.EN_ROUTE':       'आपकी ओर आ रहे हैं',
  'stage.ARRIVED':        'कारीगर पहुँच गए',
  'stage.IN_PROGRESS':    'काम चल रहा है',
  'stage.WORK_DONE':      'काम पूरा हुआ',
  'stage.SETTLED':        'भुगतान हो गया',

  'lang.pick':            'भाषा',
  'lang.unreviewed':      'यह अनुवाद अभी तक किसी मूल भाषी ने नहीं जाँचा है। कुछ गलत लगे तो हमें बताएँ।',

  'nav.home':             'होम',
  'nav.shops':            'दुकानें',
  'nav.orders':           'ऑर्डर',
  'nav.earn':             'कमाएँ',
  'nav.you':              'आप',

  'door.customer.title':  'अपना कोड अपने प्रो को बोलकर बताएँ',
  'door.customer.body':   'यह आपका अपना SAAHAA कोड है — हर काम में यही रहता है, इसलिए किसी कोड का इंतज़ार कभी नहीं करना पड़ता। इसे तभी बताएँ जब वे आपके दरवाज़े पर हों। उनका इसे टाइप करना ही सबूत है कि सही आदमी आया है।',
  'door.pro.title':       'ग्राहक से उनका SAAHAA कोड माँगें',
  'door.pro.shape':       'यह C से शुरू होता है और उसके बाद आठ अंक होते हैं। यह उनकी स्क्रीन पर है, और आप जब भी उनका काम करें, यही रहता है।',
  'door.pro.field':       'उनका SAAHAA कोड',
  'door.pro.stake':       'यह कोड डालते ही काम शुरू हो जाता है और आपके अपने {amount} लॉक हो जाते हैं। ग्राहक के काम की पुष्टि करते ही एक-एक रुपया वापस आ जाता है।',
  'door.pro.submit':      'जाँचें और काम शुरू करें',
  'door.wrong':           'कोड गलत है',
  'door.tooMany':         'कई बार गलत कोड — अब इसे एक व्यक्ति देखेगा',

  'ob.title':             'आपका सत्यापन हो रहा है',
  'ob.steps':             'सात चरण',
  'ob.free':              'चरण 7 पूरा होते ही काम मिलना शुरू। किसी की मंज़ूरी की ज़रूरत नहीं।',
  'ob.s1.t':              'अपना नंबर पक्का करें',
  'ob.s1.s':              'अपना नंबर लिखें और अपना SAAHAA कोड लें।',
  'ob.s2.t':              'अपनी ID दिखाएँ',
  'ob.s2.s':              'आधार, PAN या लाइसेंस। हम सिर्फ़ आखिरी 4 अंक रखते हैं।',
  'ob.s3.t':              'आपकी एक फोटो',
  'ob.s3.s':              'यह जाँचने के लिए कि आप कौन हैं। यह निजी रहती है।',
  'ob.s4.t':              'काम के पाँच सवाल',
  'ob.s4.s':              'जो हर सच्चा कारीगर जानता है। 4 सही करने हैं।',
  'ob.s5.t':              'SAAHAA कैसे चलता है',
  'ob.s5.s':              'छह सवाल जो सिखाते हैं। इसमें फेल नहीं हो सकते।',
  'ob.s6.t':              'पैसा कहाँ भेजें',
  'ob.s6.s':              'आपकी UPI id. कमाई आप जब चाहें वहाँ भेज सकते हैं।',
  'ob.s7.t':              'सहमति दें और शुरू करें',
  'ob.s7.s':              'पढ़ें, सहमत हों, और आप live हैं।',
  'ob.noCode':            'वही नंबर लिखें जिससे यह खाता खोला था। आपको कोई SMS नहीं आएगा — SAAHAA कभी कोड नहीं भेजता।',
  'ob.yourCode':          'और यह है आपका SAAHAA कोड',
  'ob.yourCodeBody':      'यह हमेशा के लिए आपका है। ग्राहक इसे अपने दरवाज़े पर टाइप करते हैं कि आप सचमुच आए। यह आपके सार्वजनिक पेज पर भी छपा रहता है। किसी और कोड का इंतज़ार कभी नहीं।',
  'ob.quizWarn':          'तीन बार गलत होने पर यह 24 घंटे के लिए बंद हो जाएगा। आराम से सोचकर जवाब दें।',
  'ob.quizEnglish':       'काम के ये सवाल अभी सिर्फ़ अंग्रेज़ी में हैं। ज़रूरत हो तो किसी से साथ में पढ़वा लें — यह काम की परीक्षा है, अंग्रेज़ी की नहीं।',

  'money.available':      'उपलब्ध',
  'money.availableSub':   'निकालने के लिए आपका',
  'money.locked':         'लॉक',
  'money.pending':        'बाकी',
  'money.released':       'जारी',
  'money.withdraw':       'निकालें',
  'money.add':            'पैसे डालें',
  'money.youKeep':        'पूरे {amount} आपके। SAAHAA का शुल्क ऊपर से, ग्राहक ने दिया।',
  'money.minWithdraw':    'सबसे कम निकासी {amount} है।',
  'money.stakeBack':      'ग्राहक की पुष्टि करते ही {amount} वापस आ जाते हैं।',

  'warn.deviceFull':      'इस फ़ोन में जगह नहीं बची — आपके पिछले बदलाव सेव नहीं हुए।',
  'warn.deviceFullBody':  'इसके बाद स्क्रीन पर जो कुछ है, ऐप दोबारा खोलने पर गायब हो सकता है। फ़ोन में जगह खाली करें।',
  'job.cannotDo':         'मैं यह काम नहीं कर सकता',
  'job.photoNeeded':      'पूरे हुए काम की फोटो लें',
  'job.photoWhy':         'ग्राहक यह फोटो देखता है। बिना इसके भुगतान का कोई रास्ता नहीं।',
};

const TE = {
  'stage.MATCHING':       'మీ ప్రొను వెతుకుతున్నాం',
  'stage.ASSIGNED':       'ప్రొ ఒప్పుకున్నారు',
  'stage.EN_ROUTE':       'మీ దగ్గరికి వస్తున్నారు',
  'stage.ARRIVED':        'ప్రొ వచ్చారు',
  'stage.IN_PROGRESS':    'పని జరుగుతోంది',
  'stage.WORK_DONE':      'పని పూర్తయింది',
  'stage.SETTLED':        'చెల్లింపు పూర్తి',

  'lang.pick':            'భాష',
  'lang.unreviewed':      'ఈ అనువాదాన్ని ఇంకా తెలుగు మాతృభాషీయులు ఎవరూ సరిచూడలేదు. ఏదైనా తప్పుగా అనిపిస్తే మాకు చెప్పండి.',

  'nav.home':             'హోమ్',
  'nav.shops':            'దుకాణాలు',
  'nav.orders':           'ఆర్డర్లు',
  'nav.earn':             'సంపాదన',
  'nav.you':              'మీరు',

  'door.customer.title':  'మీ కోడ్‌ను మీ ప్రొ‌కి చదివి చెప్పండి',
  'door.customer.body':   'ఇది మీ సొంత SAAHAA కోడ్ — ప్రతి పనికీ ఇదే, కాబట్టి కోడ్ కోసం ఎప్పుడూ ఎదురుచూడాల్సిన అవసరం లేదు. వాళ్ళు మీ ఇంటి తలుపు దగ్గరకు వచ్చాకే చెప్పండి. వాళ్ళు దాన్ని టైప్ చేయడమే సరైన వ్యక్తి వచ్చారనడానికి రుజువు.',
  'door.pro.title':       'కస్టమర్‌ని వాళ్ళ SAAHAA కోడ్ అడగండి',
  'door.pro.shape':       'ఇది C తో మొదలై, ఆ తర్వాత ఎనిమిది అంకెలు ఉంటాయి. అది వాళ్ళ స్క్రీన్‌పై ఉంటుంది, మీరు వాళ్ళకి ఎన్నిసార్లు పని చేసినా అదే ఉంటుంది.',
  'door.pro.field':       'వాళ్ళ SAAHAA కోడ్',
  'door.pro.stake':       'ఈ కోడ్ వేయగానే పని మొదలవుతుంది, మీ సొంత {amount} లాక్ అవుతాయి. కస్టమర్ పని నిర్ధారించగానే ప్రతి రూపాయీ తిరిగి వస్తుంది.',
  'door.pro.submit':      'సరిచూసి పని మొదలుపెట్టండి',
  'door.wrong':           'కోడ్ తప్పు',
  'door.tooMany':         'చాలాసార్లు తప్పు కోడ్ — దీన్ని ఒక వ్యక్తి చూస్తారు',

  'ob.title':             'మీ ధృవీకరణ జరుగుతోంది',
  'ob.steps':             'ఏడు దశలు',
  'ob.free':              'దశ 7 పూర్తయిన వెంటనే పనులు వస్తాయి. ఎవరి అనుమతీ అవసరం లేదు.',
  'ob.s1.t':              'మీ నంబర్ నిర్ధారించండి',
  'ob.s1.s':              'మీ నంబర్ టైప్ చేసి, మీ SAAHAA కోడ్ తీసుకోండి.',
  'ob.s2.t':              'మీ ID చూపించండి',
  'ob.s2.s':              'ఆధార్, PAN లేదా లైసెన్స్. మేము చివరి 4 అంకెలు మాత్రమే ఉంచుతాం.',
  'ob.s3.t':              'మీ ఒక ఫోటో',
  'ob.s3.s':              'మీరు ఎవరో తెలుసుకోవడానికి. ఇది ప్రైవేట్‌గానే ఉంటుంది.',
  'ob.s4.t':              'పనికి సంబంధించిన ఐదు ప్రశ్నలు',
  'ob.s4.s':              'నిజమైన పనివాడికి తెలిసినవి. 4 సరిగ్గా చెప్పాలి.',
  'ob.s5.t':              'SAAHAA ఎలా పనిచేస్తుంది',
  'ob.s5.s':              'నేర్పించే ఆరు ప్రశ్నలు. దీనిలో ఫెయిల్ కాలేరు.',
  'ob.s6.t':              'డబ్బు ఎక్కడికి పంపాలి',
  'ob.s6.s':              'మీ UPI id. మీ సంపాదనను మీకు నచ్చినప్పుడు అక్కడికి పంపుకోవచ్చు.',
  'ob.s7.t':              'ఒప్పుకుని మొదలుపెట్టండి',
  'ob.s7.s':              'చదవండి, ఒప్పుకోండి, మీరు live.',
  'ob.noCode':            'ఈ ఖాతా ఏ నంబర్‌తో తెరిచారో అదే టైప్ చేయండి. మీకు SMS ఏమీ రాదు — SAAHAA ఎప్పుడూ కోడ్ పంపదు.',
  'ob.yourCode':          'ఇదిగో మీ SAAHAA కోడ్',
  'ob.yourCodeBody':      'ఇది శాశ్వతంగా మీది. మీరు నిజంగా వచ్చారని నిర్ధారించడానికి కస్టమర్లు దీన్ని తమ ఇంటి దగ్గర టైప్ చేస్తారు, మీ పబ్లిక్ పేజీలోనూ ఇది ఉంటుంది. ఇంకో కోడ్ కోసం ఎప్పుడూ ఎదురుచూడనవసరం లేదు.',
  'ob.quizWarn':          'మూడుసార్లు తప్పైతే ఇది 24 గంటలు మూసుకుపోతుంది. తొందరపడకుండా జవాబు చెప్పండి.',
  'ob.quizEnglish':       'పనికి సంబంధించిన ఈ ప్రశ్నలు ప్రస్తుతానికి ఇంగ్లీషులో మాత్రమే ఉన్నాయి. అవసరమైతే ఎవరినైనా కలిసి చదవమని అడగండి — ఇది పని గురించిన పరీక్ష, ఇంగ్లీషు గురించి కాదు.',

  'money.available':      'అందుబాటులో',
  'money.availableSub':   'తీసుకోవడానికి మీది',
  'money.locked':         'లాక్',
  'money.pending':        'పెండింగ్',
  'money.released':       'విడుదల',
  'money.withdraw':       'తీసుకోండి',
  'money.add':            'డబ్బు వేయండి',
  'money.youKeep':        'మొత్తం {amount} మీవే. SAAHAA ఛార్జీని కస్టమర్ పైన అదనంగా చెల్లించారు.',
  'money.minWithdraw':    'కనిష్ఠంగా {amount} తీసుకోవచ్చు.',
  'money.stakeBack':      'కస్టమర్ నిర్ధారించగానే {amount} తిరిగి వస్తాయి.',

  'warn.deviceFull':      'ఈ ఫోన్‌లో స్థలం లేదు — మీ చివరి మార్పులు సేవ్ కాలేదు.',
  'warn.deviceFullBody':  'ఇక్కడి నుంచి స్క్రీన్‌పై ఉన్నవి యాప్ మళ్ళీ తెరిచినప్పుడు కనిపించకపోవచ్చు. ఫోన్‌లో కొంత స్థలం ఖాళీ చేయండి.',
  'job.cannotDo':         'నేను ఈ పని చేయలేను',
  'job.photoNeeded':      'పూర్తయిన పని ఫోటో తీయండి',
  'job.photoWhy':         'కస్టమర్ ఈ ఫోటో చూస్తారు. దీన్ని దాటి డబ్బు అందే మార్గం లేదు.',
};

const TABLES = { en: EN, hi: HI, te: TE };

/**
 * The string for `key` in the current language.
 * Falls back to English, then to the key itself — never to a blank, because a
 * missing translation should look like a bug, not like an empty screen.
 */
export function t(key, vars) {
  const table = TABLES[current] || EN;
  let s = table[key];
  if (s == null) s = EN[key];
  if (s == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}

/** Every key that has no translation in the given language — for docs/I18N.md. */
export function missing(id = current) {
  const table = TABLES[id] || {};
  return Object.keys(EN).filter(k => table[k] == null);
}

try { document.documentElement.lang = current; } catch (e) {}
