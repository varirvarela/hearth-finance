// Offline batch categorization.
// Tier 0  — history lookup: exact merchant match from your own past transactions (no API)
// Tier 0.5 — learned rules: merchant→category pairs written to Firebase when you confirm in the app
// Tier 1  — keyword heuristics: pattern matching (no API)
// Tier 2  — Gemini AI: only runs when GOOGLE_AI_API_KEY is set
//
// Run without AI (heuristics + history only):
//   node scripts/batch-categorize.js
//
// Run with AI for remaining transactions:
//   $env:GOOGLE_AI_API_KEY="AIzaSy..."; node scripts/batch-categorize.js

import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';
import { CATEGORIES }          from '../src/shared/categories.js';
import { normalizeMerchant }  from '../src/shared/normalize-merchant.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db  = getDatabase();
const UID = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY ?? null;
const USE_AI = !!GOOGLE_AI_API_KEY;

// ── Category helpers ─────────────────────────────────────────────────────────
const EXPENSE_CATS = CATEGORIES.filter(
  c => c.parent && !c.isIncome && !c.hide,
);

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

function catName(id) {
  return CAT_MAP[id]?.name ?? id ?? '—';
}

// ── Similar-transaction lookup for few-shot examples ─────────────────────────
function findSimilarExamples(txn, categorizedTxns, maxResults = 4) {
  const clean = s => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const name  = clean(txn.merchantName ?? txn.description);
  const words = name.split(' ').filter(w => w.length > 2);

  const scored = [];
  for (const [, t] of categorizedTxns) {
    if (!t.category || t.category === 'uncategorized') continue;
    const tName = clean(t.merchantName ?? t.description);
    let score = 0;
    if (tName === name)                                  score = 10;
    else if (tName.includes(name) || name.includes(tName)) score = 5;
    else score = words.filter(w => tName.includes(w)).length;
    if (score > 0) scored.push({ t, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const result = [];
  for (const { t } of scored) {
    if (result.length >= maxResults) break;
    const key = `${t.category}_${clean(t.merchantName ?? t.description)}`;
    if (!seen.has(key)) { seen.add(key); result.push(t); }
  }
  return result;
}

// ── Gemini call ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a household transaction categorizer. Transactions are primarily in English from US and Mexican merchants.
Given transaction details, return JSON with your best categorization.

Rules:
- Credit card payments (pago tarjeta, card payment) → use category "transfer_tarjeta"
- Inter-account transfers (wire transfer, transferencia, SPEI, entre cuentas) → use category "transfer_cuentas"
- Only pick category ids from the provided list
- Use at most 2 alternatives
- If truly ambiguous, lower confidence and include alternatives

Response format (JSON only, no explanation, no markdown):
{
  "category": "<category_id>",
  "confidence": <0.0-1.0>,
  "reason": "<one sentence explaining why this category was chosen>",
  "alternatives": [
    { "id": "<category_id>", "confidence": <0.0-1.0> }
  ]
}`;

async function categorizeTransaction(txn, categorizedTxns) {
  const catList = EXPENSE_CATS.map(c => {
    const parent = CATEGORIES.find(p => p.id === c.parent);
    return `${c.id}: ${c.name} [group: ${parent?.name ?? c.parent}]`;
  }).join('\n');

  const lines = [
    `Description: ${txn.description ?? ''}`,
    `Merchant: ${txn.merchantName ?? 'Unknown'}`,
    `Amount: $${Math.abs(txn.amount ?? 0).toFixed(2)}`,
  ];
  if (txn.date)          lines.push(`Date: ${txn.date}`);
  if (txn.accountName)   lines.push(`Account: ${txn.accountName}`);
  if (txn.plaidCategory) lines.push(`Bank category: ${txn.plaidCategory}`);

  const examples = findSimilarExamples(txn, categorizedTxns);
  const examplesBlock = examples.length
    ? '\n\nSimilar transactions you have already categorized:\n' +
      examples.map(t =>
        `- "${t.merchantName ?? t.description}" (${t.date}, $${Math.abs(t.amount).toFixed(2)}) → ${t.category}`
      ).join('\n')
    : '';

  const prompt = `${SYSTEM_PROMPT}\n\nTransaction:\n${lines.join('\n')}${examplesBlock}\n\nAvailable categories:\n${catList}`;

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_AI_API_KEY },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512 },
      }),
    },
  );

  if (res.status === 429) {
    const err = new Error(`Gemini quota exhausted (429): ${await res.text()}`);
    err.quotaExhausted = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { catId: 'uncategorized', conf: 0, reason: 'model returned no JSON', alternatives: [] };

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { return { catId: 'uncategorized', conf: 0, reason: 'malformed JSON from model', alternatives: [] }; }

  const catId = EXPENSE_CATS.find(c => c.id === parsed.category)?.id ?? 'uncategorized';
  const conf  = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
  const reason = parsed.reason ?? '';

  const alternatives = (parsed.alternatives ?? [])
    .filter(a => a?.id && EXPENSE_CATS.some(c => c.id === a.id))
    .map(a => a.id)
    .slice(0, 2);

  return { catId, conf, reason, alternatives };
}

// ── Keyword heuristics ────────────────────────────────────────────────────────
const KEYWORDS = [
  [/transferencia|entre cuentas|\bwire transfer\b|\bSPEI\b|sent to self|received from self/i, 'transfer_cuentas', 'inter-account transfer (bank terms)'],
  [/pago.*tarjeta|tarjeta.*pago|credit card payment/i,                              'transfer_tarjeta',       'credit card payment'],
  [/uber eats|rappi|didi food|doordash|grubhub|pedidos ya/i,                        'salidas_delivery',       'food delivery service'],
  [/restaurante|restaurant|café|cafe|coffee|starbucks|sushi|pizza|taco|burger|mcdonald|kfc|subway|bar |cantina/i, 'salidas_comunes', 'restaurant / café'],
  [/netflix|spotify|disney\+|hbo|apple.*sub|amazon prime|youtube premium|deezer|paramount/i, 'suscripciones_comunes', 'streaming subscription'],
  [/telmex|totalplay|izzi|megacable|infinitum|at&t|att fijo|teléfono fijo|internet.*hogar/i, 'telecom_fijo',  'home telecom / internet'],
  [/\bcfe\b|luz eléctrica|sacmex|\bconagua\b|gas natural fenosa|sempra|agua potable/i, 'utilities_comunes',   'utilities (electricity, water, gas)'],
  [/walmart|costco|sam.?s club|soriana|chedraui|h.?e.?b|oxxo|7.?eleven|farmacia|similares|benavides|san pablo|superama|coppel/i, 'super_farmacia_comunes', 'supermarket / pharmacy'],
  [/amazon|mercado libre|shein|liverpool|palacio de hierro|zara|h&m|forever 21|sears/i, 'shopping_comunes',   'online / retail shopping'],
  [/gasolina|pemex|bp |shell|total.?gas|combustible|\bpeaje\b|\bcaseta\b|tag iave|autopass/i, 'auto_comunes', 'gas / toll / fuel'],
  [/seguro.*auto|auto.*seguro|car insurance|mantenimiento auto|servicio.*auto|nissan|honda service/i, 'auto_comunes_anual', 'car insurance / maintenance'],
  [/colegio|escuela|material escolar|útiles|papelería|librería escolar/i,            'kids_colegio',          'school supplies / tuition'],
  [/\btuition\b|inscripción|matrícula|cuota escolar/i,                               'kids_tuition',          'school / tuition enrollment'],
  [/kids.*actividad|actividad.*niños|fútbol.*niños|clases.*niños/i,                  'kids_activities',       'kids activities'],
  [/doctor|médico|medico|hospital|clínica|clinica|dentista|farmacia benavides|farmacias del ahorro|laboratorio/i, 'salud_comunes', 'medical / health'],
  [/cinepolis|cinemex|cineteca|teatro|concierto|ticketmaster|superboletos|show|espectáculo/i, 'salidas_eventos', 'entertainment / events'],
  [/limpieza|cleaning service|servicio hogar|mucama|srvc hogar/i,                    'casa_comunes_mensual',  'home cleaning service'],
  [/hipoteca|mortgage|infonavit|fovissste|\brenta\b|arrendamiento/i,                 'casa_fijo_mensual',     'rent / mortgage'],
  [/smartfit|equinox|sport.?city|gym|crossfit|\bspin\b|gimnasio/i,                   'adult_activities',      'gym / fitness'],
  [/airbnb|booking\b|expedia|vrbo|marriott|hilton|hyatt|four seasons|hotel\b/i,      'travel_vari',           'hotel / accommodation'],
  [/aeromexico|volaris|vivaaerobus|delta|united|american airlines|aerol[ií]nea/i,     'travel_vari',           'airline / flight'],
  [/\bvenmo\b/i,                                                                       'venmo',                 'Venmo payment'],
  [/donación|donation|donativo|charity|cruz roja/i,                                   'donation',              'charitable donation'],
  [/accenture|infosys|deloitte|kpmg|expense report/i,                                 'business_accenture',    'business / work expense'],

  // ── US merchants (learned from transaction history) ───────────────────────────
  // Income
  [/ubs.*finsvc|finsvc.*dps/i,                        'income_other',          'UBS investment/brokerage credit'],
  [/ach.*credit.*stubhub/i,                            'income_other',          'StubHub sale proceeds'],
  [/bond interest|security redeemed/i,                 'income_interest',       'investment / bond income'],
  [/irs.*treas.*310|treas.*310.*tax/i,                 'taxes',                 'IRS tax refund'],
  [/zelle payment from/i,                              'income_other',          'Zelle received'],
  [/return of posted check/i,                          'income_other',          'returned / reversed check'],
  // Transfers
  [/zelle payment to|zelle debitpay|^zelle debit/i,   'transfer_cuentas',      'Zelle outgoing payment'],
  [/discover e.?payment/i,                             'transfer_tarjeta',      'Discover card payment'],
  [/online.*scheduled payment.*acct/i,                 'transfer_tarjeta',      'scheduled card payment'],
  [/online payment.?thank you/i,                       'transfer_tarjeta',      'card payment'],
  [/ach.*electronic.*debit.*chase/i,                   'transfer_tarjeta',      'Chase card payment'],
  [/ach.*debit.*pac.?life|pac.?life.*insur/i,          'auto_comunes_anual',    'Pacific Life insurance'],
  [/outgoing.*wire transfer|incoming.*wire transfer/i, 'transfer_cuentas',      'wire transfer'],
  [/outgoing domestic wire/i,                          'transfer_cuentas',      'domestic wire transfer'],
  // Airlines
  [/jetblue/i,                                         'travel_vari',           'JetBlue Airlines'],
  [/frontier ai[^r]|frontier.*airlines/i,              'travel_vari',           'Frontier Airlines'],
  [/arajet/i,                                          'travel_vari',           'Arajet airline'],
  [/edreams/i,                                         'travel_vari',           'eDreams travel booking'],
  // Car rental / hotels
  [/enterprise rent|enterprise.*car/i,                 'travel_vari',           'Enterprise car rental'],
  [/avis rent.?a.?car|etoll avis|alamo toll/i,         'travel_vari',           'Avis / Alamo car rental'],
  [/sixt\.com|^sixt\s/i,                              'travel_vari',           'Sixt car rental'],
  [/cozysuites/i,                                      'travel_vari',           'hotel / short-stay'],
  [/priceln.*tvl|priceline.*travel/i,                  'travel_vari',           'Priceline travel'],
  // Parking / transit
  [/parkmobile/i,                                      'auto_comunes',          'ParkMobile parking'],
  [/parkfast/i,                                        'auto_comunes',          'Parkfast parking'],
  [/valet park of america/i,                           'auto_comunes',          'valet parking'],
  [/marta tap and go/i,                                'auto_comunes',          'MARTA Atlanta transit'],
  [/citibik/i,                                         'auto_comunes',          'Citi Bike'],
  [/pride station/i,                                   'auto_comunes',          'gas station (Pride)'],
  // Restaurants — Toast POS (TST*) is always a sit-down restaurant
  [/tst[\* ]/i,                                        'salidas_comunes',       'restaurant (Toast POS)'],
  [/p\.?f\.?chang/i,                                   'salidas_comunes',       'P.F. Chang\'s'],
  [/macaroni grill/i,                                  'salidas_comunes',       'Macaroni Grill'],
  [/chick.?fil.?a/i,                                   'salidas_comunes',       'Chick-fil-A'],
  [/sweetgreen/i,                                      'salidas_comunes',       'Sweetgreen'],
  [/\bcava\b/i,                                        'salidas_comunes',       'Cava restaurant'],
  [/wdw (dining|akershus|abc commissary|catalina|cosmic ray|france cart|combo cart|popcorn|fast food)/i, 'salidas_comunes', 'Disney park dining'],
  [/ewr airp/i,                                        'salidas_comunes',       'EWR airport food'],
  [/atl airp market/i,                                 'salidas_comunes',       'ATL airport food'],
  [/dal stadium concession/i,                          'salidas_comunes',       'stadium food concession'],
  [/levy@|levy restaurant/i,                           'salidas_comunes',       'stadium concession (Levy)'],
  [/radiocity.*food|radiocityfood/i,                   'salidas_comunes',       'Radio City food'],
  [/medialunas del abuelo|lucciano|havanna\b/i,        'salidas_comunes',       'Argentine café / restaurant'],
  // Supermarket / pharmacy
  [/publix\s*#?\d*/i,                                  'super_farmacia_comunes','Publix supermarket'],
  [/shaws?\s+\d{3,}/i,                                 'super_farmacia_comunes','Shaw\'s supermarket'],
  [/duane reade/i,                                     'super_farmacia_comunes','Duane Reade pharmacy'],
  [/harbor point organic/i,                            'super_farmacia_comunes','Harbor Point organic market'],
  // Kids
  [/greenwich soccer/i,                                'kids_activities',       'Greenwich Soccer Association'],
  [/greenwich dance|ssp\*greenwich dance/i,            'kids_activities',       'Greenwich Dance Studio'],
  [/boys.*girls club/i,                                'kids_activities',       'Boys & Girls Club'],
  [/cos cob pta|cob pta/i,                             'kids_colegio',          'school PTA'],
  // Events / Entertainment
  [/seatgeek/i,                                        'salidas_eventos',       'SeatGeek tickets'],
  [/axs\.com/i,                                        'salidas_eventos',       'AXS live event tickets'],
  [/wdw lightning/i,                                   'salidas_eventos',       'Disney Lightning Lane'],
  [/okemo/i,                                           'salidas_eventos',       'Okemo ski resort'],
  [/sky zone/i,                                        'salidas_eventos',       'Sky Zone trampoline park'],
  [/rpm raceway/i,                                     'salidas_eventos',       'RPM Raceway go-kart'],
  [/newport mansions/i,                                'salidas_eventos',       'Newport Mansions tour'],
  [/tkts|theater tix/i,                                'salidas_eventos',       'TKTS Broadway tickets'],
  [/neue galerie/i,                                    'salidas_eventos',       'Neue Galerie NYC museum'],
  [/universal (orlando|florida)/i,                     'salidas_eventos',       'Universal Studios'],
  // Shopping
  [/sp maaji|^maaji\b/i,                               'shopping_comunes',      'Maaji swimwear'],
  [/lululemon/i,                                       'shopping_comunes',      'Lululemon'],
  [/j\.?crew factory|j crew/i,                        'shopping_comunes',      'J.Crew Factory'],
  [/farm rio\b/i,                                      'shopping_comunes',      'Farm Rio clothing'],
  [/longchamp/i,                                       'shopping_comunes',      'Longchamp bags'],
  [/foot locker/i,                                     'shopping_comunes',      'Foot Locker'],
  [/famous footwear/i,                                 'shopping_comunes',      'Famous Footwear'],
  [/etsy\.com/i,                                       'shopping_comunes',      'Etsy marketplace'],
  // Health
  [/stamford orthodontics/i,                           'salud_comunes',         'orthodontics / dental'],
  [/fairfield county allergy/i,                        'salud_comunes',         'allergy / medical clinic'],
  [/physicians for wom/i,                              'salud_comunes',         'women\'s health clinic'],
  [/nyu grossman|nyu.*som/i,                           'salud_comunes',         'NYU medical'],
  // Home improvement
  [/ring.?s end/i,                                     'casa_comunes_anual',    'Ring\'s End lumber & supply'],
  [/byram mason/i,                                     'casa_comunes_anual',    'Byram Mason building supply'],
  [/lowe.?s\b/i,                                       'casa_comunes_anual',    'Lowe\'s home improvement'],
  [/ridgeway garden/i,                                 'casa_comunes_anual',    'Ridgeway Garden Center'],
  // Subscriptions
  [/peacock\b/i,                                       'suscripciones_comunes', 'Peacock streaming'],
  [/uber.*one membership/i,                            'suscripciones_comunes', 'Uber One membership'],
  [/google \*(supercell|minecraft|niagara|frame)/i,    'suscripciones_comunes', 'Google app subscription'],
  [/whoop\b/i,                                         'suscripciones_comunes', 'WHOOP fitness subscription'],
  // Business
  [/upwork\s*\*/i,                                     'business_accenture',    'Upwork freelance platform'],
  [/ct secretary of state/i,                           'business_accenture',    'CT state business fee'],
  [/franchise tax bo/i,                                'business_accenture',    'CA Franchise Tax Board'],
  [/monthly fee business adv/i,                        'business_accenture',    'business account fee'],
  // Donations
  [/autism speaks/i,                                   'donation',              'Autism Speaks charity'],
];

function heuristicCategory(txn) {
  const text = ((txn.merchantName ?? '') + ' ' + (txn.description ?? '')).toLowerCase();
  for (const [pattern, catId, label] of KEYWORDS) {
    if (pattern.test(text)) return { catId, reason: label };
  }
  return undefined;
}

// Tier 0a: exact cleaned-name history lookup
function historyLookup(txn, categorizedTxns) {
  const name = normalizeMerchant(txn.merchantName ?? txn.description);
  if (!name || name.length < 3) return undefined;

  const votes = {};
  let total   = 0;
  for (const [, t] of categorizedTxns) {
    if (normalizeMerchant(t.merchantName ?? t.description) !== name) continue;
    votes[t.category] = (votes[t.category] ?? 0) + 1;
    total++;
  }
  if (!total) return undefined;

  const [topCat, topCount] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const pct = Math.round((topCount / total) * 100);
  return { catId: topCat, count: topCount, total, pct, method: 'exact' };
}

// Tier 0b: fuzzy history — match on first 2–3 significant words (handles location suffixes,
// e.g. "Starbucks Chicago" matches "Starbucks New York" already categorized).
function historyLookupFuzzy(txn, categorizedTxns) {
  const name   = normalizeMerchant(txn.merchantName ?? txn.description);
  const words  = name.split(' ').filter(w => w.length > 2);
  const prefix = words.slice(0, 3).join(' ');
  if (!prefix || prefix.length < 4) return undefined;

  const votes = {};
  let total   = 0;
  for (const [, t] of categorizedTxns) {
    const tWords  = normalizeMerchant(t.merchantName ?? t.description).split(' ').filter(w => w.length > 2);
    const tPrefix = tWords.slice(0, 3).join(' ');
    if (tPrefix !== prefix) continue;
    votes[t.category] = (votes[t.category] ?? 0) + 1;
    total++;
  }
  if (!total) return undefined;

  const [topCat, topCount] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const pct = Math.round((topCount / total) * 100);
  if (pct < 70) return undefined; // require strong agreement on fuzzy match
  return { catId: topCat, count: topCount, total, pct, method: 'fuzzy' };
}

// Tier 1.5: map Plaid's own category to ours (free signal, no API).
const PLAID_MAP = [
  [/payroll|direct deposit|salary/,                  'paycheck'],
  [/credit card.*pay|card.*payment|payment.*card/,   'transfer_tarjeta'],
  [/wire|ach.*transfer|account.*transfer/,           'transfer_cuentas'],
  [/restaurant|fast food|coffee|cafe|dining/,        'salidas_comunes'],
  [/food.*deliver|delivery.*food|doordash|grubhub/,  'salidas_delivery'],
  [/groceries|supermarket|warehouse store/,          'super_farmacia_comunes'],
  [/pharmacy|drug store/,                            'super_farmacia_comunes'],
  [/airline|aviation|flight/,                        'travel_vari'],
  [/hotel|lodging|motel|vacation rental/,            'travel_vari'],
  [/gas station|fuel|petrol/,                        'auto_comunes'],
  [/taxi|rideshare|ride.*hail|car service|uber|lyft/, 'auto_comunes'],
  [/parking|toll/,                                   'auto_comunes'],
  [/auto.*insurance|car.*insurance/,                 'auto_comunes_anual'],
  [/gym|fitness|sport.*club/,                        'adult_activities'],
  [/entertainment|movie|cinema|theater/,             'salidas_eventos'],
  [/concert|ticket|event/,                           'salidas_eventos'],
  [/doctor|physician|clinic|dental|hospital|medical/, 'salud_comunes'],
  [/telecom|phone|cellular|internet.*service/,       'telecom_fijo'],
  [/utilities|electric|water.*bill|gas.*bill/,       'utilities_comunes'],
  [/rent|mortgage|lease/,                            'casa_fijo_mensual'],
  [/clothing|apparel|fashion|accessories/,           'shopping_comunes'],
  [/department store|retail|merchandise/,            'shopping_comunes'],
  [/online.*shop|marketplace|e.?commerce/,           'shopping_comunes'],
  [/education|tuition|school|university|college/,    'kids_tuition'],
  [/subscription|streaming/,                         'suscripciones_comunes'],
  [/charity|donation|nonprofit/,                     'donation'],
  [/insurance/,                                      'auto_comunes_anual'],
  [/home.*improvement|hardware|home.*repair/,        'casa_comunes_mensual'],
  [/cleaning|housekeeping/,                          'casa_comunes_mensual'],
];

function plaidCategoryLookup(txn) {
  const p = (txn.plaidCategory ?? '').toLowerCase();
  if (!p) return undefined;
  for (const [pattern, catId] of PLAID_MAP) {
    if (pattern.test(p)) return { catId, reason: `Plaid category: ${txn.plaidCategory}` };
  }
  return undefined;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nBatch categorization for UID: ${UID}\n`);

  const [txnsSnap, sugsSnap, rulesSnap] = await Promise.all([
    db.ref(`transactions/${UID}`).get(),
    db.ref(`suggestions/${UID}`).get(),
    db.ref(`merchantRules/${UID}`).get(),
  ]);

  const txns          = txnsSnap.val() ?? {};
  const existing      = sugsSnap.val() ?? {};
  const merchantRules = rulesSnap.val() ?? {};
  const learnedCount  = Object.keys(merchantRules).length;
  if (learnedCount) console.log(`${learnedCount} learned merchant rules loaded.\n`);

  // Already-categorized transactions used as few-shot examples for the AI
  const categorizedTxns = Object.entries(txns).filter(([, t]) =>
    t.category && t.category !== 'uncategorized' && !t.ignored,
  );
  console.log(`${categorizedTxns.length} already-categorized transactions available as examples.\n`);

  const targets = Object.entries(txns).filter(([txnId, t]) => {
    if (existing[txnId]) return false;
    if (t.categorySource === 'manual') return false;
    if (t.ignored) return false;
    if (t.category && t.category !== 'uncategorized') return false;
    return true;
  });

  console.log(`${targets.length} uncategorized transactions to process.\n`);
  if (!targets.length) { console.log('Nothing to do.'); process.exit(0); }

  console.log(`AI tier: ${USE_AI ? 'ON' : 'OFF (set GOOGLE_AI_API_KEY to enable)'}\n`);

  const report = { history: [], learned: [], heuristic: [], ai: [], noSuggestion: [], errors: [] };
  const patch  = {};
  let quotaExhausted = false;

  for (const [txnId, txn] of targets) {
    const label  = (txn.merchantName ?? txn.description ?? txnId).slice(0, 45);
    const amount = `$${Math.abs(txn.amount ?? 0).toFixed(2)}`;
    const date   = txn.date ?? '';

    // Tier 0a: exact merchant history
    const hist = historyLookup(txn, categorizedTxns);
    if (hist) {
      const hint = `${hist.count} past txn${hist.count > 1 ? 's' : ''}`;
      patch[`suggestions/${UID}/${txnId}`] = { catId: hist.catId, source: 'history', alts: [], conf: hist.pct / 100, hint };
      process.stdout.write(`  hist  ${label} → ${hist.catId} (${hist.count}/${hist.total} exact)\n`);
      report.history.push({ label, date, amount, catId: hist.catId, catName: catName(hist.catId), count: hist.count, total: hist.total, pct: hist.pct, method: hist.method });
      continue;
    }

    // Tier 0b: fuzzy merchant history
    const histFuzzy = historyLookupFuzzy(txn, categorizedTxns);
    if (histFuzzy) {
      const hint = `${histFuzzy.count} past txn${histFuzzy.count > 1 ? 's' : ''} ~`;
      patch[`suggestions/${UID}/${txnId}`] = { catId: histFuzzy.catId, source: 'history', alts: [], conf: histFuzzy.pct / 100, hint };
      process.stdout.write(`  fuzz  ${label} → ${histFuzzy.catId} (${histFuzzy.pct}% of ${histFuzzy.total} fuzzy)\n`);
      report.history.push({ label, date, amount, catId: histFuzzy.catId, catName: catName(histFuzzy.catId), count: histFuzzy.count, total: histFuzzy.total, pct: histFuzzy.pct, method: histFuzzy.method });
      continue;
    }

    // Tier 0.5: learned merchant rules (written to Firebase when user confirms in the app)
    const ruleKey = normalizeMerchant(txn.merchantName ?? txn.description);
    const learned = ruleKey ? merchantRules[ruleKey] : undefined;
    if (learned?.catId && learned.catId !== 'uncategorized') {
      patch[`suggestions/${UID}/${txnId}`] = { catId: learned.catId, source: 'learned', alts: [], conf: 1.0, hint: 'confirmed by user' };
      process.stdout.write(`  rule  ${label} → ${learned.catId} (learned)\n`);
      report.learned.push({ label, date, amount, catId: learned.catId, catName: catName(learned.catId) });
      continue;
    }

    // Tier 1: keyword heuristic
    const heur = heuristicCategory(txn);
    if (heur) {
      patch[`suggestions/${UID}/${txnId}`] = { catId: heur.catId, source: 'heuristic', alts: [] };
      process.stdout.write(`  heur  ${label} → ${heur.catId}\n`);
      report.heuristic.push({ label, date, amount, catId: heur.catId, catName: catName(heur.catId), reason: heur.reason });
      continue;
    }

    // Tier 1.5: Plaid category mapping
    const plaid = plaidCategoryLookup(txn);
    if (plaid) {
      patch[`suggestions/${UID}/${txnId}`] = { catId: plaid.catId, source: 'heuristic', alts: [] };
      process.stdout.write(`  plaid ${label} → ${plaid.catId}\n`);
      report.heuristic.push({ label, date, amount, catId: plaid.catId, catName: catName(plaid.catId), reason: plaid.reason });
      continue;
    }

    // Tier 2: AI (only when key is set)
    if (!USE_AI) {
      process.stdout.write(`  ???   ${label} → no match\n`);
      report.noSuggestion.push({ label, date, amount, bankCat: txn.plaidCategory ?? '', reason: 'no heuristic or history match; run with AI key to categorize' });
      continue;
    }

    try {
      const result = await categorizeTransaction(txn, categorizedTxns);
      if (result.catId && result.catId !== 'uncategorized') {
        patch[`suggestions/${UID}/${txnId}`] = { catId: result.catId, source: 'ai', alts: result.alternatives, conf: result.conf };
        const exs = findSimilarExamples(txn, categorizedTxns);
        process.stdout.write(`  ai    ${label} → ${result.catId} (${(result.conf * 100).toFixed(0)}%)\n`);
        report.ai.push({ label, date, amount, catId: result.catId, catName: catName(result.catId), conf: result.conf, reason: result.reason, alts: result.alternatives, examples: exs });
      } else {
        process.stdout.write(`  ???   ${label} → no suggestion\n`);
        report.noSuggestion.push({ label, date, amount, bankCat: txn.plaidCategory ?? '', reason: result.reason || 'model returned uncategorized' });
      }
    } catch (err) {
      if (err.quotaExhausted) {
        console.log('\n⚠  Gemini quota exhausted — flushing results so far and stopping gracefully.');
        console.log('   Re-run when quota resets; already-matched transactions will be skipped.\n');
        quotaExhausted = true;
        break;
      }
      process.stdout.write(`  ERR   ${label}: ${err.message.slice(0, 80)}\n`);
      report.errors.push({ label, date, amount, error: err.message });
    }

    await new Promise(r => setTimeout(r, 4000));
  }

  if (Object.keys(patch).length) {
    await db.ref().update(patch);
  }

  // ── Final report ─────────────────────────────────────────────────────────────
  const hr = '─'.repeat(72);
  console.log(`\n${'═'.repeat(72)}`);
  console.log('CATEGORIZATION REPORT');
  console.log(`${'═'.repeat(72)}\n`);

  if (quotaExhausted) {
    console.log('⚠  PARTIAL RUN — stopped early due to Gemini quota. Saved results above.\n');
  }

  if (report.learned.length) {
    console.log(`LEARNED RULES (${report.learned.length})`);
    console.log(hr);
    for (const r of report.learned) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
      console.log(`             → ${r.catName}  [confirmed by user]`);
    }
    console.log();
  }

  if (report.history.length) {
    console.log(`HISTORY MATCHES (${report.history.length})`);
    console.log(hr);
    for (const r of report.history) {
      const confidence = r.pct === 100 ? '100%' : `${r.pct}% (${r.count} of ${r.total} past txns agree)`;
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
      console.log(`             → ${r.catName}  [${confidence}]`);
    }
    console.log();
  }

  if (report.ai.length) {
    console.log(`AI SUGGESTIONS (${report.ai.length})`);
    console.log(hr);
    for (const r of report.ai) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
      console.log(`             → ${r.catName} (${(r.conf * 100).toFixed(0)}% confidence)`);
      if (r.reason) console.log(`               ${r.reason}`);
      if (r.alts.length) console.log(`               Alternatives: ${r.alts.map(catName).join(', ')}`);
      if (r.examples?.length) console.log(`               Based on: ${r.examples.map(e => `"${(e.merchantName ?? e.description ?? '').slice(0,25)}" → ${e.category}`).join(' | ')}`);
    }
    console.log();
  }

  if (report.heuristic.length) {
    console.log(`HEURISTIC MATCHES (${report.heuristic.length})`);
    console.log(hr);
    for (const r of report.heuristic) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
      console.log(`             → ${r.catName}  [${r.reason}]`);
    }
    console.log();
  }

  if (report.noSuggestion.length) {
    console.log(`NO SUGGESTION (${report.noSuggestion.length})`);
    console.log(hr);
    for (const r of report.noSuggestion) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}${r.bankCat ? `  [bank: ${r.bankCat}]` : ''}`);
      if (r.reason) console.log(`             ${r.reason}`);
    }
    console.log();
  }

  if (report.errors.length) {
    console.log(`ERRORS (${report.errors.length})`);
    console.log(hr);
    for (const r of report.errors) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
      console.log(`             ${r.error.slice(0, 100)}`);
    }
    console.log();
  }

  console.log(`${'═'.repeat(72)}`);
  console.log(`  Learned rules    : ${report.learned.length}`);
  console.log(`  History matches  : ${report.history.length}`);
  console.log(`  Heuristic hits   : ${report.heuristic.length}`);
  console.log(`  AI suggestions   : ${report.ai.length}`);
  console.log(`  No suggestion    : ${report.noSuggestion.length}`);
  console.log(`  Errors           : ${report.errors.length}`);
  console.log(`  Written to DB    : ${Object.keys(patch).length}`);
  if (quotaExhausted) console.log(`  ⚠  Stopped early : quota exhausted`);
  console.log(`${'═'.repeat(72)}\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
