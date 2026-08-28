/**
 * Evaluates user-defined categorization rules against a transaction.
 * Rules run in ascending priority order (lower number = higher priority).
 * Returns the first matching category id, or null if no rule matches.
 *
 * Rule shape (new — multi-condition):
 *   { conditions: [{ field, op, value }], action, actionValue, priority, enabled }
 * Rule shape (legacy — single condition):
 *   { matchField, matchOp, matchValue, action, actionValue, priority, enabled }
 *
 * field:  'description' | 'merchant' | 'accountName' | 'amount' | 'category' | 'source'
 * op:     'contains' | 'notContains' | 'startsWith' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
 * action: 'setCategory'
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

function getFieldValue(txn, field) {
  switch (field) {
    case 'description':  return (txn.description  ?? '').toLowerCase();
    case 'merchant':     return (txn.merchantName  ?? '').toLowerCase();
    case 'accountName':  return (txn.accountName   ?? '').toLowerCase();
    case 'category':     return (txn.category      ?? '').toLowerCase();
    case 'notes':        return (txn.notes         ?? '').toLowerCase();
    case 'source':       return (txn.source ?? txn.categorySource ?? '').toLowerCase();
    case 'amount':       return txn.amount;
    default:             return null;
  }
}

function matchesCondition(txn, { field, op, value }) {
  const fieldVal = getFieldValue(txn, field);
  if (fieldVal === null) return false;

  const isStr = typeof fieldVal === 'string';
  const isNum = typeof fieldVal === 'number';
  const norm  = v => (typeof v === 'string' ? v.toLowerCase() : v);

  switch (op) {
    case 'contains':    return isStr && fieldVal.includes(norm(value));
    case 'notContains': return isStr && !fieldVal.includes(norm(value));
    case 'startsWith':  return isStr && fieldVal.startsWith(norm(value));
    case 'equals':      return isStr ? fieldVal === norm(value) : fieldVal === value;
    case 'gt':          return isNum && fieldVal > Number(value);
    case 'gte':         return isNum && fieldVal >= Number(value);
    case 'lt':          return isNum && fieldVal < Number(value);
    case 'lte':         return isNum && fieldVal <= Number(value);
    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      return arr.some(v => isStr ? fieldVal === norm(v) : fieldVal === v);
    }
    default: return false;
  }
}

export function matchesRule(txn, rule) {
  // New format: conditions array (AND logic — all must match)
  if (Array.isArray(rule.conditions) && rule.conditions.length) {
    return rule.conditions.every(c => matchesCondition(txn, c));
  }
  // Legacy format: single matchField/matchOp/matchValue
  if (rule.matchField) {
    return matchesCondition(txn, { field: rule.matchField, op: rule.matchOp ?? 'contains', value: rule.matchValue });
  }
  return false;
}

export function buildRule({ conditions, matchField, matchOp, matchValue, categoryId, name, priority = 50 }) {
  const conds = conditions ?? [{ field: matchField ?? 'description', op: matchOp ?? 'contains', value: matchValue }];
  return {
    name,
    conditions:  conds,
    action:      'setCategory',
    actionValue: categoryId,
    priority,
    enabled:     true,
    createdAt:   Date.now(),
  };
}
