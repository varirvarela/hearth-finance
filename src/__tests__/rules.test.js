import { describe, it, expect } from 'vitest';
import { evaluateRules, matchesRule, buildRule } from '../shared/rules.js';

const rule = (overrides) => buildRule({
  matchField: 'description',
  matchOp: 'contains',
  matchValue: 'starbucks',
  categoryId: 'food_coffee',
  name: 'Starbucks',
  ...overrides,
});

describe('matchesRule', () => {
  it('contains — case-insensitive on description', () => {
    const r = rule();
    expect(matchesRule({ description: 'STARBUCKS #123' }, r)).toBe(true);
    expect(matchesRule({ description: 'Target' }, r)).toBe(false);
  });

  it('contains — case-insensitive on merchant', () => {
    const r = rule({ matchField: 'merchant', matchValue: 'whole foods' });
    expect(matchesRule({ merchantName: 'WHOLE FOODS MARKET' }, r)).toBe(true);
    expect(matchesRule({ merchantName: 'Trader Joes' }, r)).toBe(false);
  });

  it('startsWith', () => {
    const r = rule({ matchOp: 'startsWith', matchValue: 'amazon' });
    expect(matchesRule({ description: 'AMAZON.COM*AB1C2' }, r)).toBe(true);
    expect(matchesRule({ description: 'My Amazon order' }, r)).toBe(false);
  });

  it('equals', () => {
    const r = rule({ matchOp: 'equals', matchValue: 'netflix' });
    expect(matchesRule({ description: 'netflix' }, r)).toBe(true);
    expect(matchesRule({ description: 'NETFLIX' }, r)).toBe(true);
    expect(matchesRule({ description: 'netflix HD' }, r)).toBe(false);
  });

  it('gt on amount', () => {
    const r = rule({ matchField: 'amount', matchOp: 'gt', matchValue: 100 });
    expect(matchesRule({ amount: 150 }, r)).toBe(true);
    expect(matchesRule({ amount: 100 }, r)).toBe(false);
    expect(matchesRule({ amount: 50 }, r)).toBe(false);
  });

  it('lt on amount', () => {
    const r = rule({ matchField: 'amount', matchOp: 'lt', matchValue: 5 });
    expect(matchesRule({ amount: 4.99 }, r)).toBe(true);
    expect(matchesRule({ amount: 5 }, r)).toBe(false);
  });

  it('unknown op returns false', () => {
    const r = { conditions: [{ field: 'description', op: 'regex', value: 'starbucks' }], enabled: true, actionValue: 'food_coffee', priority: 50 };
    expect(matchesRule({ description: 'starbucks' }, r)).toBe(false);
  });

  it('unknown field returns false', () => {
    const r = { conditions: [{ field: 'notes', op: 'contains', value: 'starbucks' }], enabled: true, actionValue: 'food_coffee', priority: 50 };
    expect(matchesRule({ description: 'starbucks' }, r)).toBe(false);
  });

  it('multiple conditions — all must match (AND logic)', () => {
    const r = {
      conditions: [
        { field: 'description', op: 'contains', value: 'starbucks' },
        { field: 'amount', op: 'gt', value: 5 },
      ],
      enabled: true, actionValue: 'food_coffee', priority: 50,
    };
    expect(matchesRule({ description: 'STARBUCKS', amount: 10 }, r)).toBe(true);
    expect(matchesRule({ description: 'STARBUCKS', amount: 3 }, r)).toBe(false);
    expect(matchesRule({ description: 'Target',    amount: 10 }, r)).toBe(false);
  });

  it('notContains operator', () => {
    const r = { conditions: [{ field: 'description', op: 'notContains', value: 'amazon' }], enabled: true, actionValue: 'x', priority: 50 };
    expect(matchesRule({ description: 'Walmart' }, r)).toBe(true);
    expect(matchesRule({ description: 'Amazon Prime' }, r)).toBe(false);
  });

  it('gte / lte operators on amount', () => {
    const gte = { conditions: [{ field: 'amount', op: 'gte', value: 100 }], enabled: true, actionValue: 'x', priority: 50 };
    expect(matchesRule({ amount: 100 }, gte)).toBe(true);
    expect(matchesRule({ amount: 99 },  gte)).toBe(false);
    const lte = { conditions: [{ field: 'amount', op: 'lte', value: 5 }],   enabled: true, actionValue: 'x', priority: 50 };
    expect(matchesRule({ amount: 5 }, lte)).toBe(true);
    expect(matchesRule({ amount: 6 }, lte)).toBe(false);
  });

  it('in operator matches any value in array', () => {
    const r = { conditions: [{ field: 'source', op: 'in', value: ['plaid', 'manual'] }], enabled: true, actionValue: 'x', priority: 50 };
    expect(matchesRule({ source: 'plaid' },  r)).toBe(true);
    expect(matchesRule({ source: 'manual' }, r)).toBe(true);
    expect(matchesRule({ source: 'ai' },     r)).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('returns null when rules is empty', () => {
    expect(evaluateRules({ description: 'Starbucks' }, {})).toBe(null);
  });

  it('returns null when no rule matches', () => {
    const rules = { r1: rule() };
    expect(evaluateRules({ description: 'Target' }, rules)).toBe(null);
  });

  it('returns actionValue of the matching rule', () => {
    const rules = { r1: rule() };
    expect(evaluateRules({ description: 'STARBUCKS RESERVE' }, rules)).toBe('food_coffee');
  });

  it('skips disabled rules', () => {
    const rules = { r1: { ...rule(), enabled: false } };
    expect(evaluateRules({ description: 'STARBUCKS' }, rules)).toBe(null);
  });

  it('lower priority number wins when multiple rules match', () => {
    const rules = {
      r1: { ...rule({ categoryId: 'food_coffee' }), priority: 10 },
      r2: { ...rule({ categoryId: 'food_dining' }), priority: 5 },
    };
    expect(evaluateRules({ description: 'starbucks' }, rules)).toBe('food_dining');
  });

  it('handles null rules gracefully', () => {
    expect(evaluateRules({ description: 'anything' }, null)).toBe(null);
  });
});

describe('buildRule', () => {
  it('sets sensible defaults', () => {
    const r = buildRule({ conditions: [{ field: 'description', op: 'contains', value: 'test' }], categoryId: 'food', name: 'Test' });
    expect(r.enabled).toBe(true);
    expect(r.priority).toBe(50);
    expect(r.action).toBe('setCategory');
    expect(r.actionValue).toBe('food');
    expect(r.conditions).toHaveLength(1);
  });

  it('accepts custom priority', () => {
    const r = buildRule({ conditions: [{ field: 'description', op: 'contains', value: 'x' }], categoryId: 'y', name: 'x', priority: 1 });
    expect(r.priority).toBe(1);
  });

  it('legacy matchField/matchOp/matchValue are converted to conditions', () => {
    const r = buildRule({ matchField: 'merchant', matchOp: 'startsWith', matchValue: 'amazon', categoryId: 'shopping', name: 'Amazon' });
    expect(r.conditions).toEqual([{ field: 'merchant', op: 'startsWith', value: 'amazon' }]);
  });
});
