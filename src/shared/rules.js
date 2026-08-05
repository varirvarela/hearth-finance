/**
 * Evaluates user-defined categorization rules against a transaction.
 * Rules run in ascending priority order (lower number = higher priority).
 * Returns the first matching category id, or null if no rule matches.
 *
 * Rule shape:
 *   { matchField, matchOp, matchValue, action, actionValue, priority, enabled }
 *
 * matchField: 'description' | 'merchant' | 'amount'
 * matchOp:    'contains' | 'startsWith' | 'equals' | 'gt' | 'lt'
 * action:     'setCategory'
 * actionValue: category id string
 */

export function evaluateRules(transaction, rules) {
  const sorted = Object.values(rules ?? {})
    .filter(r => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (matchesRule(transaction, rule)) return rule.actionValue;
  }
  return null;
}

export function matchesRule(txn, rule) {
  const { matchField, matchOp, matchValue } = rule;
  let fieldVal;

  if      (matchField === 'description') fieldVal = (txn.description  ?? '').toLowerCase();
  else if (matchField === 'merchant')    fieldVal = (txn.merchantName ?? '').toLowerCase();
  else if (matchField === 'amount')      fieldVal = txn.amount;
  else return false;

  const val = typeof matchValue === 'string' ? matchValue.toLowerCase() : matchValue;

  switch (matchOp) {
    case 'contains':   return typeof fieldVal === 'string' && fieldVal.includes(val);
    case 'startsWith': return typeof fieldVal === 'string' && fieldVal.startsWith(val);
    case 'equals':     return fieldVal === val;
    case 'gt':         return typeof fieldVal === 'number' && fieldVal > matchValue;
    case 'lt':         return typeof fieldVal === 'number' && fieldVal < matchValue;
    default:           return false;
  }
}

export function buildRule({ matchField, matchOp, matchValue, categoryId, name, priority = 50 }) {
  return {
    name,
    matchField,
    matchOp,
    matchValue,
    action: 'setCategory',
    actionValue: categoryId,
    priority,
    enabled: true,
    createdAt: Date.now(),
  };
}
