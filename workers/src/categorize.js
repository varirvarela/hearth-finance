import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from '../../src/shared/categories.js';

const EXPENSE_CATS = CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.id !== 'uncategorized');

const SYSTEM = `You are a household transaction categorizer. Given a transaction, pick the single best category id from the list. Respond with ONLY the category id — no explanation, no punctuation.`;

export async function categorizeTransaction(txn, env) {
  const client  = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const catList = EXPENSE_CATS.map(c => `${c.id}: ${c.name}${c.parent ? ` (${CATEGORIES.find(p => p.id === c.parent)?.name ?? c.parent})` : ''}`).join('\n');

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 32,
    system:     SYSTEM,
    messages:   [{
      role:    'user',
      content: `Description: ${txn.description}
Merchant: ${txn.merchantName ?? 'Unknown'}
Amount: $${Math.abs(txn.amount).toFixed(2)}

Categories:
${catList}`,
    }],
  });

  const id = message.content[0].text.trim().toLowerCase();
  return EXPENSE_CATS.find(c => c.id === id)?.id ?? 'uncategorized';
}
