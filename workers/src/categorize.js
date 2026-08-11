import { CATEGORIES, getCategoryById } from '../../src/shared/categories.js';

// Only leaf expense categories are valid targets for AI categorization.
const EXPENSE_CATS = CATEGORIES.filter(
  c => c.parent && !c.isIncome && c.parent !== 'transfer' && !c.hide,
);

const SYSTEM_PROMPT = `You are a household transaction categorizer for a family in the USA.
Given a transaction description and amount, return JSON with your best categorization.

Response format (JSON only, no explanation, no markdown):
{
  "category": "<category_id>",
  "confidence": <0.0-1.0>,
  "alternatives": [
    { "id": "<category_id>", "confidence": <0.0-1.0> }
  ]
}

Use at most 2 alternatives. Only pick ids from the provided list.`;

export async function categorizeTransaction(txn, env) {
  const catList = EXPENSE_CATS.map(c => {
    const parent = CATEGORIES.find(p => p.id === c.parent);
    return `${c.id}: ${c.name} [${parent?.name ?? c.parent}]`;
  }).join('\n');

  const prompt = `${SYSTEM_PROMPT}

Transaction:
Description: ${txn.description}
Merchant: ${txn.merchantName ?? 'Unknown'}
Amount: $${Math.abs(txn.amount ?? 0).toFixed(2)}

Available categories:
${catList}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 200 },
      }),
    },
  );

  let parsed;
  try {
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    parsed = JSON.parse(text);
  } catch {
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
    alternatives,
    needsReview: conf < 0.75,
  };
}
