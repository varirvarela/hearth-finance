// Offline batch AI categorization.
// Reads all uncategorized transactions for a user, calls Gemini directly,
// and writes suggestions to suggestions/${UID}/ in Firebase.
// When the app next loads, suggestions are already cached — no "Analyzing..." shown.
//
// Run: GOOGLE_AI_API_KEY=<key> node scripts/batch-categorize.js
// Or:  node scripts/batch-categorize.js  (reads GOOGLE_AI_API_KEY from environment)

import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';
import { CATEGORIES }          from '../src/shared/categories.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db  = getDatabase();
const UID = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!GOOGLE_AI_API_KEY) {
  console.error('Missing GOOGLE_AI_API_KEY environment variable.');
  process.exit(1);
}

// ── Category helpers ─────────────────────────────────────────────────────────
const EXPENSE_CATS = CATEGORIES.filter(
  c => c.parent && !c.isIncome && c.parent !== 'transfer' && !c.hide,
);

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

function getCategoryById(id) {
  return CAT_MAP[id] ?? CAT_MAP['uncategorized'] ?? { id: 'uncategorized', name: 'Uncategorized', icon: '❓' };
}

// ── Gemini call (same logic as Worker) ───────────────────────────────────────
const SYSTEM_PROMPT = `You are a household transaction categorizer for a bilingual (English/Spanish) family based in Mexico and the USA.
Given transaction details, return JSON with your best categorization.

Rules:
- Transfers between own accounts (wire, transferencia, SPEI, sent to, received from) → do NOT categorize, return category "uncategorized"
- Only pick category ids from the provided list
- Use at most 2 alternatives
- If truly ambiguous, lower confidence and include alternatives

Response format (JSON only, no explanation, no markdown):
{
  "category": "<category_id>",
  "confidence": <0.0-1.0>,
  "alternatives": [
    { "id": "<category_id>", "confidence": <0.0-1.0> }
  ]
}`;

async function categorizeTransaction(txn) {
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

  const prompt = `${SYSTEM_PROMPT}\n\nTransaction:\n${lines.join('\n')}\n\nAvailable categories:\n${catList}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 200 },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(text);

  const catId = EXPENSE_CATS.find(c => c.id === parsed.category)?.id ?? 'uncategorized';
  const conf  = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;

  const alternatives = (parsed.alternatives ?? [])
    .filter(a => a?.id && EXPENSE_CATS.some(c => c.id === a.id))
    .map(a => a.id)
    .slice(0, 2);

  return { catId, conf, alternatives };
}

// ── Keyword heuristics (same as app — skip AI call if match found) ────────────
const KEYWORDS = [
  [/\btransfer\b|transferencia|entre cuentas|wire transfer|sent to|received from/i, null],
  [/pago.*tarjeta|card payment|tarjeta.*pago|credit card payment/i,                null],
  [/uber eats|rappi|didi food|doordash|grubhub|pedidos ya/i,                       'salidas_delivery'],
  [/restaurante|restaurant|café|cafe|coffee|starbucks|sushi|pizza|taco|burger|mcdonald|kfc|subway|bar |cantina/i, 'salidas_comunes'],
  [/netflix|spotify|disney\+|hbo|apple.*sub|amazon prime|youtube premium|deezer|paramount/i, 'suscripciones_comunes'],
  [/telmex|totalplay|izzi|megacable|infinitum|at&t|att fijo|teléfono fijo|internet.*hogar/i, 'telecom_fijo'],
  [/\bcfe\b|luz eléctrica|sacmex|\bconagua\b|gas natural fenosa|sempra|agua potable/i, 'utilities_comunes'],
  [/walmart|costco|sam.?s club|soriana|chedraui|h.?e.?b|oxxo|7.?eleven|farmacia|similares|benavides|san pablo|superama|coppel/i, 'super_farmacia_comunes'],
  [/amazon|mercado libre|shein|liverpool|palacio de hierro|zara|h&m|forever 21|sears/i, 'shopping_comunes'],
  [/gasolina|pemex|bp |shell|total.?gas|combustible|\bpeaje\b|\bcaseta\b|tag iave|autopass/i, 'auto_comunes'],
  [/seguro.*auto|auto.*seguro|car insurance|mantenimiento auto|servicio.*auto|nissan|honda service/i, 'auto_comunes_anual'],
  [/colegio|escuela|material escolar|útiles|papelería|librería escolar/i,           'kids_colegio'],
  [/\btuition\b|inscripción|matrícula|cuota escolar/i,                               'kids_tuition'],
  [/kids.*actividad|actividad.*niños|fútbol.*niños|clases.*niños/i,                 'kids_activities'],
  [/doctor|médico|medico|hospital|clínica|clinica|dentista|farmacia benavides|farmacias del ahorro|laboratorio/i, 'salud_comunes'],
  [/cinepolis|cinemex|cineteca|teatro|concierto|ticketmaster|superboletos|show|espectáculo/i, 'salidas_eventos'],
  [/limpieza|cleaning service|servicio hogar|mucama|srvc hogar/i,                    'casa_comunes_mensual'],
  [/hipoteca|mortgage|infonavit|fovissste|\brenta\b|arrendamiento/i,                'casa_fijo_mensual'],
  [/smartfit|equinox|sport.?city|gym|crossfit|\bspin\b|gimnasio/i,                  'adult_activities'],
  [/airbnb|booking\b|expedia|vrbo|marriott|hilton|hyatt|four seasons|hotel\b/i,     'travel_vari'],
  [/aeromexico|volaris|vivaaerobus|delta|united|american airlines|aerol[ií]nea/i,    'travel_vari'],
  [/\bvenmo\b/i, 'venmo'],
  [/donación|donation|donativo|charity|cruz roja/i,                                  'donation'],
  [/accenture|infosys|deloitte|kpmg|expense report/i,                                'business_accenture'],
];

function heuristicCategory(txn) {
  const text = ((txn.merchantName ?? '') + ' ' + (txn.description ?? '')).toLowerCase();
  for (const [pattern, catId] of KEYWORDS) {
    if (pattern.test(text)) return catId; // null means "transfer — skip AI"
  }
  return undefined; // no heuristic match
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nBatch categorization for UID: ${UID}\n`);

  // Load existing suggestions so we don't re-call for already-cached results
  const [txnsSnap, sugsSnap] = await Promise.all([
    db.ref(`transactions/${UID}`).get(),
    db.ref(`suggestions/${UID}`).get(),
  ]);

  const txns    = txnsSnap.val() ?? {};
  const existing = sugsSnap.val() ?? {};

  // Collect uncategorized transactions that don't already have a suggestion
  const targets = Object.entries(txns).filter(([txnId, t]) => {
    if (existing[txnId]) return false;                  // already suggested
    if (t.categorySource === 'manual') return false;    // user confirmed
    if (t.ignored || t.isTransfer) return false;        // ignored
    if (t.group === 'transfer') return false;           // transfer
    if (t.category && t.category !== 'uncategorized') return false; // already categorized
    return true;
  });

  console.log(`${targets.length} uncategorized transactions to process.`);
  if (!targets.length) { console.log('Nothing to do.'); process.exit(0); }

  let aiCalls = 0, heuristicHits = 0, skipped = 0, errors = 0;
  const patch = {};

  for (const [txnId, txn] of targets) {
    const label = (txn.merchantName ?? txn.description ?? txnId).slice(0, 40);

    // Tier 1: keyword heuristic (free, no API call)
    const heurResult = heuristicCategory(txn);
    if (heurResult !== undefined) {
      if (heurResult === null) {
        // transfer pattern — skip
        process.stdout.write(`  skip  ${label}\n`);
        skipped++;
        continue;
      }
      patch[`suggestions/${UID}/${txnId}`] = { catId: heurResult, source: 'heuristic', alts: [] };
      process.stdout.write(`  heur  ${label} → ${heurResult}\n`);
      heuristicHits++;
      continue;
    }

    // Tier 2: AI call
    try {
      const result = await categorizeTransaction(txn);
      if (result.catId && result.catId !== 'uncategorized') {
        patch[`suggestions/${UID}/${txnId}`] = { catId: result.catId, source: 'ai', alts: result.alternatives };
        process.stdout.write(`  ai    ${label} → ${result.catId} (${(result.conf * 100).toFixed(0)}%)\n`);
      } else {
        process.stdout.write(`  ???   ${label} → no suggestion\n`);
      }
      aiCalls++;
    } catch (err) {
      process.stdout.write(`  ERR   ${label}: ${err.message}\n`);
      errors++;
    }

    // Rate limit: 15 req/min on free Gemini tier → 4s between calls
    // Remove or lower this delay if you have a paid Gemini API key
    await new Promise(r => setTimeout(r, 4000));
  }

  // Write all suggestions in one multi-path update
  if (Object.keys(patch).length) {
    await db.ref().update(patch);
  }

  console.log(`\nDone.`);
  console.log(`  Heuristic hits : ${heuristicHits}`);
  console.log(`  AI calls       : ${aiCalls}`);
  console.log(`  Transfers skip : ${skipped}`);
  console.log(`  Errors         : ${errors}`);
  console.log(`  Written        : ${Object.keys(patch).length} suggestions`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
