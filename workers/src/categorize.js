import { CATEGORIES, getCategoryById } from '../../src/shared/categories.js';
import { normalizeMerchant }           from '../../src/shared/normalize-merchant.js';

// Only leaf categories (expense + transfer + income) are valid targets.
const ALL_CATS = CATEGORIES.filter(c => c.parent && !c.hide);
const EXPENSE_CATS = ALL_CATS.filter(c => !c.isIncome && c.parent !== 'transfer');

const SYSTEM_PROMPT = `You are a household transaction categorizer for a bilingual (English/Spanish) family based in Connecticut, USA.
Transactions are primarily from US merchants. Return JSON with your best categorization.

Rules:
- Credit card payments → "transfer_tarjeta"
- Inter-account wire transfers (wire transfer, transferencia, SPEI, entre cuentas) → "transfer_cuentas"
- Only pick category ids from the provided list
- Use at most 2 alternatives
- Lower confidence and include alternatives when ambiguous

Response format (JSON only, no explanation, no markdown):
{
  "category": "<category_id>",
  "confidence": <0.0-1.0>,
  "alternatives": [
    { "id": "<category_id>", "confidence": <0.0-1.0> }
  ]
}`;

// context = { merchantRules, examples, categoryDescriptions }
// merchantRules: { [normalizedName]: { catId } }  — confirmed by user in the app
// examples: [{ merchantName, description, category, date, amount }]  — recent confirmed txns
// categoryDescriptions: { [catId]: string }  — user-written descriptions for AI guidance
export async function categorizeTransaction(txn, env, context = {}) {
  const { merchantRules = {}, examples = [], categoryDescriptions = {} } = context;

  // Tier 0: learned merchant rule (exact normalized name, written when user confirms)
  const key = normalizeMerchant(txn.merchantName ?? txn.description);
  if (key) {
    const rule = merchantRules[key];
    if (rule?.catId && rule.catId !== 'uncategorized') {
      const cat = getCategoryById(rule.catId);
      return {
        category:    rule.catId,
        group:       cat.parent ?? rule.catId,
        isFixed:     cat.isFixed  ?? false,
        isAnnual:    cat.isAnnual ?? false,
        confidence:  1.0,
        source:      'learned',
        alternatives: [],
        needsReview: false,
      };
    }
  }

  // Tier 1: Gemini AI
  const catList = EXPENSE_CATS.map(c => {
    const parent = CATEGORIES.find(p => p.id === c.parent);
    const desc   = categoryDescriptions[c.id] ? ` — ${categoryDescriptions[c.id]}` : '';
    return `${c.id}: ${c.name}${desc} [group: ${parent?.name ?? c.parent}]`;
  }).join('\n');

  const lines = [
    `Description: ${txn.description ?? ''}`,
    `Merchant: ${txn.merchantName ?? 'Unknown'}`,
    `Amount: $${Math.abs(txn.amount ?? 0).toFixed(2)}`,
  ];
  if (txn.date)          lines.push(`Date: ${txn.date}`);
  if (txn.accountName)   lines.push(`Account: ${txn.accountName}`);
  if (txn.plaidCategory) lines.push(`Bank category: ${txn.plaidCategory}`);

  const examplesBlock = examples.length
    ? '\n\nSimilar transactions already categorized:\n' +
      examples.map(e =>
        `- "${e.merchantName ?? e.description}" (${e.date ?? ''}, $${Math.abs(e.amount ?? 0).toFixed(2)}) → ${e.category}`
      ).join('\n')
    : '';

  const prompt = `${SYSTEM_PROMPT}\n\nTransaction:\n${lines.join('\n')}${examplesBlock}\n\nAvailable categories:\n${catList}`;

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GOOGLE_AI_API_KEY },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512 },
      }),
    },
  );

  // 429 = quota exhausted — return gracefully so the app can degrade silently
  if (res.status === 429) {
    return { category: 'uncategorized', group: 'uncategorized', isFixed: false, isAnnual: false, confidence: 0, alternatives: [], needsReview: false, quotaExhausted: true };
  }

  if (!res.ok) {
    return { category: 'uncategorized', group: 'uncategorized', isFixed: false, isAnnual: false, confidence: 0, alternatives: [], needsReview: true };
  }

  let parsed;
  try {
    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return { category: 'uncategorized', group: 'uncategorized', isFixed: false, isAnnual: false, confidence: 0, alternatives: [], needsReview: true };
  }

  if (!parsed) {
    return { category: 'uncategorized', group: 'uncategorized', isFixed: false, isAnnual: false, confidence: 0, alternatives: [], needsReview: true };
  }

  const catId = EXPENSE_CATS.find(c => c.id === parsed.category)?.id ?? 'uncategorized';
  const cat   = getCategoryById(catId);
  const conf  = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;

  const alternatives = (parsed.alternatives ?? [])
    .filter(a => a?.id && EXPENSE_CATS.some(c => c.id === a.id))
    .map(a => ({ id: a.id, confidence: typeof a.confidence === 'number' ? a.confidence : 0 }))
    .slice(0, 2);

  return {
    category:    catId,
    group:       cat.parent ?? catId,
    isFixed:     cat.isFixed  ?? false,
    isAnnual:    cat.isAnnual ?? false,
    confidence:  conf,
    source:      'ai',
    alternatives,
    needsReview: conf < 0.75,
  };
}
