import { describe, it, expect } from 'vitest';
import { blankState, needsReview, applyFilters, countActive, normalizeSource, findDuplicates } from '../shared/filter-utils.js';

// [id, txnObject] tuple — mirrors the format transactions.js uses
const tx = (id, overrides = {}) => [id, {
  date:         '2026-08-01',
  amount:       50,
  description:  'Test description',
  merchantName: 'Test Merchant',
  group:        'food',
  category:     'food_dining',
  accountId:    'acct-1',
  accountName:  'Checking',
  ...overrides,
}];

// Merge overrides on top of blankState so tests only specify what they care about
const st = (overrides = {}) => ({ ...blankState(), ...overrides });

// ── blankState ──────────────────────────────────────────────────────────────

describe('blankState', () => {
  it('shows transfers by default', () => {
    expect(blankState().hideTransfers).toBe(false);
  });
  it('dateMode defaults to all', () => {
    expect(blankState().dateMode).toBe('all');
  });
  it('type defaults to all', () => {
    expect(blankState().type).toBe('all');
  });
  it('starts with empty groups, cats, accounts, and sources', () => {
    const s = blankState();
    expect(s.groups).toHaveLength(0);
    expect(s.cats).toHaveLength(0);
    expect(s.accounts).toHaveLength(0);
    expect(s.sources).toHaveLength(0);
  });
  it('review and pending default to false', () => {
    const s = blankState();
    expect(s.review).toBe(false);
    expect(s.pending).toBe(false);
  });
  it('query defaults to empty string', () => {
    expect(blankState().query).toBe('');
  });
});

// ── needsReview ─────────────────────────────────────────────────────────────

describe('needsReview', () => {
  it('returns true when needsReview flag is explicitly set', () => {
    expect(needsReview({ needsReview: true, category: 'food_dining', aiConfidence: 0.9 })).toBe(true);
  });
  it('returns true when category is uncategorized', () => {
    expect(needsReview({ category: 'uncategorized' })).toBe(true);
  });
  it('returns true when aiConfidence is below 0.75', () => {
    expect(needsReview({ category: 'food_dining', aiConfidence: 0.74 })).toBe(true);
  });
  it('returns false when aiConfidence is exactly 0.75', () => {
    expect(needsReview({ category: 'food_dining', aiConfidence: 0.75 })).toBe(false);
  });
  it('returns false for a clean transaction with high confidence', () => {
    expect(needsReview({ category: 'food_dining', aiConfidence: 0.95, needsReview: false })).toBe(false);
  });
  it('returns false when aiConfidence is absent (not AI-categorized)', () => {
    expect(needsReview({ category: 'food_dining' })).toBe(false);
  });
  it('returns false when needsReview is false and category is set', () => {
    expect(needsReview({ category: 'auto_gas', needsReview: false })).toBe(false);
  });
});

// ── applyFilters — hideTransfers ─────────────────────────────────────────────

describe('applyFilters — hideTransfers', () => {
  it('excludes isTransfer:true when hideTransfers is on', () => {
    const txns = [tx('a', { isTransfer: true }), tx('b')];
    const result = applyFilters(txns, st({ hideTransfers: true }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('excludes group:"transfer" when hideTransfers is on (Tiller imports)', () => {
    const txns = [tx('a', { group: 'transfer', isTransfer: false }), tx('b')];
    const result = applyFilters(txns, st({ hideTransfers: true }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('excludes transactions with both flags set', () => {
    expect(applyFilters([tx('a', { isTransfer: true, group: 'transfer' })], st({ hideTransfers: true }))).toHaveLength(0);
  });
  it('allows transfers through when hideTransfers is false', () => {
    const txns = [tx('a', { isTransfer: true }), tx('b', { group: 'transfer' })];
    expect(applyFilters(txns, st({ hideTransfers: false }))).toHaveLength(2);
  });
  it('keeps non-transfer transactions when hideTransfers is on', () => {
    const txns = [tx('a'), tx('b', { amount: -100 })];
    expect(applyFilters(txns, st({ hideTransfers: true }))).toHaveLength(2);
  });
});

// ── applyFilters — query search ───────────────────────────────────────────────

describe('applyFilters — query', () => {
  it('matches on description (case-insensitive)', () => {
    const txns = [tx('a', { description: 'AMAZON ORDER 123' }), tx('b', { description: 'Target' })];
    expect(applyFilters(txns, st({ query: 'amazon' }))).toHaveLength(1);
  });
  it('matches on merchantName (case-insensitive)', () => {
    const txns = [tx('a', { merchantName: 'WHOLE FOODS MARKET' }), tx('b', { merchantName: 'Target' })];
    expect(applyFilters(txns, st({ query: 'whole foods' }))).toHaveLength(1);
  });
  it('matches on notes', () => {
    const txns = [tx('a', { notes: 'birthday gift for mom' }), tx('b', { notes: 'groceries' })];
    expect(applyFilters(txns, st({ query: 'birthday' }))).toHaveLength(1);
  });
  it('empty query passes all transactions', () => {
    const txns = [tx('a'), tx('b'), tx('c')];
    expect(applyFilters(txns, st({ query: '' }))).toHaveLength(3);
  });
  it('returns empty array when no transactions match', () => {
    const txns = [tx('a', { description: 'Starbucks', merchantName: 'Starbucks' })];
    expect(applyFilters(txns, st({ query: 'amazon' }))).toHaveLength(0);
  });
});

// ── applyFilters — dateMode month ─────────────────────────────────────────────

describe('applyFilters — dateMode month', () => {
  it('includes transactions in the selected month', () => {
    const txns = [tx('a', { date: '2026-08-15' }), tx('b', { date: '2026-07-31' })];
    const result = applyFilters(txns, st({ dateMode: 'month', year: 2026, month: 8 }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('excludes transactions from adjacent months', () => {
    const txns = [tx('a', { date: '2026-09-01' }), tx('b', { date: '2026-07-31' })];
    expect(applyFilters(txns, st({ dateMode: 'month', year: 2026, month: 8 }))).toHaveLength(0);
  });
  it('month=0 includes all months in the year', () => {
    const txns = [
      tx('a', { date: '2026-01-01' }),
      tx('b', { date: '2026-12-31' }),
      tx('c', { date: '2025-12-31' }),
    ];
    const result = applyFilters(txns, st({ dateMode: 'month', year: 2026, month: 0 }));
    expect(result).toHaveLength(2);
    expect(result.map(([id]) => id)).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('pads single-digit month correctly (month=3 → 2026-03)', () => {
    const txns = [tx('a', { date: '2026-03-15' }), tx('b', { date: '2026-3-15' })];
    // 2026-3-15 won't start with 2026-03, so only 'a' matches
    const result = applyFilters(txns, st({ dateMode: 'month', year: 2026, month: 3 }));
    expect(result[0][0]).toBe('a');
  });
});

// ── applyFilters — dateMode range ─────────────────────────────────────────────

describe('applyFilters — dateMode range', () => {
  it('excludes transactions before dateFrom', () => {
    const txns = [tx('a', { date: '2026-06-30' }), tx('b', { date: '2026-07-01' })];
    const result = applyFilters(txns, st({ dateMode: 'range', dateFrom: '2026-07-01' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('excludes transactions after dateTo', () => {
    const txns = [tx('a', { date: '2026-08-31' }), tx('b', { date: '2026-08-01' })];
    const result = applyFilters(txns, st({ dateMode: 'range', dateTo: '2026-08-30' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('includes transactions on the boundary dates', () => {
    const txns = [tx('a', { date: '2026-08-01' }), tx('b', { date: '2026-08-31' })];
    const result = applyFilters(txns, st({ dateMode: 'range', dateFrom: '2026-08-01', dateTo: '2026-08-31' }));
    expect(result).toHaveLength(2);
  });
  it('empty dateFrom does not filter from the left', () => {
    const txns = [tx('a', { date: '2020-01-01' }), tx('b', { date: '2026-08-01' })];
    const result = applyFilters(txns, st({ dateMode: 'range', dateFrom: '', dateTo: '2026-12-31' }));
    expect(result).toHaveLength(2);
  });
});

// ── applyFilters — type ───────────────────────────────────────────────────────

describe('applyFilters — type', () => {
  it('expense keeps only positive amounts', () => {
    const txns = [tx('a', { amount: 50 }), tx('b', { amount: -100 }), tx('c', { amount: 0 })];
    const result = applyFilters(txns, st({ type: 'expense' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('income keeps only negative amounts', () => {
    const txns = [tx('a', { amount: 50 }), tx('b', { amount: -100 }), tx('c', { amount: 0 })];
    const result = applyFilters(txns, st({ type: 'income' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('all type keeps both positive and negative amounts', () => {
    const txns = [tx('a', { amount: 50 }), tx('b', { amount: -100 })];
    expect(applyFilters(txns, st({ type: 'all' }))).toHaveLength(2);
  });
});

// ── applyFilters — amount range ───────────────────────────────────────────────

describe('applyFilters — amount range', () => {
  it('amtMin excludes transactions below the threshold', () => {
    const txns = [tx('a', { amount: 5 }), tx('b', { amount: 100 })];
    const result = applyFilters(txns, st({ amtMin: '10' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
  it('amtMax excludes transactions above the threshold', () => {
    const txns = [tx('a', { amount: 5 }), tx('b', { amount: 100 })];
    const result = applyFilters(txns, st({ amtMax: '50' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('uses Math.abs so negative amounts are compared by magnitude', () => {
    const txns = [tx('a', { amount: -150 }), tx('b', { amount: -30 })];
    const result = applyFilters(txns, st({ amtMin: '100' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('empty amtMin and amtMax pass all transactions', () => {
    const txns = [tx('a', { amount: 0.01 }), tx('b', { amount: 99999 })];
    expect(applyFilters(txns, st({ amtMin: '', amtMax: '' }))).toHaveLength(2);
  });
  it('both amtMin and amtMax can be applied together', () => {
    const txns = [tx('a', { amount: 5 }), tx('b', { amount: 50 }), tx('c', { amount: 200 })];
    const result = applyFilters(txns, st({ amtMin: '10', amtMax: '100' }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });
});

// ── applyFilters — category groups and leaves ─────────────────────────────────

describe('applyFilters — groups and cats', () => {
  it('groups filter includes only matching group', () => {
    const txns = [tx('a', { group: 'food' }), tx('b', { group: 'auto' })];
    const result = applyFilters(txns, st({ groups: ['food'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('cats filter restricts to specific leaf category within group', () => {
    const txns = [
      tx('a', { group: 'food', category: 'food_dining' }),
      tx('b', { group: 'food', category: 'food_coffee' }),
    ];
    const result = applyFilters(txns, st({ groups: ['food'], cats: ['food_dining'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('empty groups and cats arrays pass all transactions', () => {
    const txns = [tx('a', { group: 'food' }), tx('b', { group: 'auto' }), tx('c', { group: 'casa' })];
    expect(applyFilters(txns, st({ groups: [], cats: [] }))).toHaveLength(3);
  });
  it('multiple groups in filter are inclusive', () => {
    const txns = [tx('a', { group: 'food' }), tx('b', { group: 'auto' }), tx('c', { group: 'casa' })];
    const result = applyFilters(txns, st({ groups: ['food', 'auto'] }));
    expect(result).toHaveLength(2);
  });
});

// ── applyFilters — accounts ───────────────────────────────────────────────────

describe('applyFilters — accounts', () => {
  it('matches on accountId (Plaid transactions)', () => {
    const txns = [tx('a', { accountId: 'acct-1' }), tx('b', { accountId: 'acct-2' })];
    const result = applyFilters(txns, st({ accounts: ['acct-1'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('matches on accountName (Tiller imports without accountId)', () => {
    const txns = [
      tx('a', { accountId: null, accountName: 'Chase Checking' }),
      tx('b', { accountId: null, accountName: 'AmEx Platinum' }),
    ];
    const result = applyFilters(txns, st({ accounts: ['Chase Checking'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('empty accounts list passes all transactions', () => {
    const txns = [tx('a', { accountId: 'acct-1' }), tx('b', { accountId: 'acct-2' })];
    expect(applyFilters(txns, st({ accounts: [] }))).toHaveLength(2);
  });
});

// ── applyFilters — status flags ───────────────────────────────────────────────

describe('applyFilters — review and pending', () => {
  it('review filter includes only transactions that need review (uncategorized)', () => {
    const txns = [tx('a', { category: 'uncategorized' }), tx('b', { category: 'food_dining' })];
    const result = applyFilters(txns, st({ review: true }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('review filter includes low-confidence AI categorizations', () => {
    const txns = [
      tx('a', { category: 'food_dining', aiConfidence: 0.5 }),
      tx('b', { category: 'food_dining', aiConfidence: 0.9 }),
    ];
    const result = applyFilters(txns, st({ review: true }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
  it('pending filter includes only pending transactions', () => {
    const txns = [tx('a', { pending: true }), tx('b', { pending: false }), tx('c')];
    const result = applyFilters(txns, st({ pending: true }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
});

// ── normalizeSource ───────────────────────────────────────────────────────────

describe('normalizeSource', () => {
  it('returns "import" for categorySource tiller', () => {
    expect(normalizeSource({ categorySource: 'tiller' })).toBe('import');
  });
  it('returns "import" for categorySource import', () => {
    expect(normalizeSource({ categorySource: 'import' })).toBe('import');
  });
  it('returns "ai" for categorySource ai', () => {
    expect(normalizeSource({ categorySource: 'ai' })).toBe('ai');
  });
  it('returns "manual" for categorySource manual', () => {
    expect(normalizeSource({ categorySource: 'manual' })).toBe('manual');
  });
  it('falls back to t.source when categorySource is absent', () => {
    expect(normalizeSource({ source: 'plaid' })).toBe('plaid');
  });
  it('returns empty string when neither field is set', () => {
    expect(normalizeSource({})).toBe('');
  });
});

// ── applyFilters — source filter ──────────────────────────────────────────────

describe('applyFilters — sources', () => {
  it('empty sources array passes all transactions', () => {
    const txns = [
      tx('a', { categorySource: 'ai'     }),
      tx('b', { categorySource: 'manual' }),
      tx('c', { categorySource: 'rule'   }),
    ];
    expect(applyFilters(txns, st({ sources: [] }))).toHaveLength(3);
  });

  it('filters to AI-categorized transactions', () => {
    const txns = [
      tx('a', { categorySource: 'ai'     }),
      tx('b', { categorySource: 'manual' }),
    ];
    const result = applyFilters(txns, st({ sources: ['ai'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });

  it('filters to manually categorized transactions', () => {
    const txns = [
      tx('a', { categorySource: 'ai'     }),
      tx('b', { categorySource: 'manual' }),
      tx('c', { categorySource: 'rule'   }),
    ];
    const result = applyFilters(txns, st({ sources: ['manual'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('b');
  });

  it('normalizes tiller and import both match the "import" source filter', () => {
    const txns = [
      tx('a', { categorySource: 'tiller' }),
      tx('b', { categorySource: 'import' }),
      tx('c', { categorySource: 'ai'     }),
    ];
    const result = applyFilters(txns, st({ sources: ['import'] }));
    expect(result).toHaveLength(2);
    expect(result.map(([id]) => id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('multiple sources are inclusive (OR logic)', () => {
    const txns = [
      tx('a', { categorySource: 'ai'     }),
      tx('b', { categorySource: 'manual' }),
      tx('c', { categorySource: 'rule'   }),
    ];
    const result = applyFilters(txns, st({ sources: ['ai', 'manual'] }));
    expect(result).toHaveLength(2);
    expect(result.map(([id]) => id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('falls back to t.source when categorySource is absent', () => {
    const txns = [
      tx('a', { source: 'plaid', categorySource: undefined }),
      tx('b', { source: 'tiller', categorySource: undefined }),
    ];
    const result = applyFilters(txns, st({ sources: ['plaid'] }));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('a');
  });
});

// ── countActive ───────────────────────────────────────────────────────────────

describe('countActive', () => {
  it('returns 0 for default blank state', () => {
    expect(countActive(blankState())).toBe(0);
  });
  it('counts dateMode change from all', () => {
    expect(countActive(st({ dateMode: 'month' }))).toBe(1);
    expect(countActive(st({ dateMode: 'range' }))).toBe(1);
  });
  it('counts type change from all', () => {
    expect(countActive(st({ type: 'expense' }))).toBe(1);
    expect(countActive(st({ type: 'income' }))).toBe(1);
  });
  it('counts amtMin or amtMax as a single filter', () => {
    expect(countActive(st({ amtMin: '10' }))).toBe(1);
    expect(countActive(st({ amtMax: '100' }))).toBe(1);
    expect(countActive(st({ amtMin: '10', amtMax: '100' }))).toBe(1);
  });
  it('counts non-empty groups', () => {
    expect(countActive(st({ groups: ['food'] }))).toBe(1);
  });
  it('does not count cats separately from groups', () => {
    // cats refine the current group selection — groups already counts them
    expect(countActive(st({ groups: ['food'], cats: ['food_dining'] }))).toBe(1);
  });
  it('counts non-empty accounts', () => {
    expect(countActive(st({ accounts: ['acct-1'] }))).toBe(1);
  });
  it('counts non-empty sources', () => {
    expect(countActive(st({ sources: ['ai'] }))).toBe(1);
    expect(countActive(st({ sources: ['ai', 'manual'] }))).toBe(1);
  });
  it('counts review flag', () => {
    expect(countActive(st({ review: true }))).toBe(1);
  });
  it('counts pending flag', () => {
    expect(countActive(st({ pending: true }))).toBe(1);
  });
  it('accumulates multiple active filters', () => {
    expect(countActive(st({ dateMode: 'month', type: 'expense', review: true }))).toBe(3);
  });
  it('hideTransfers does not count (it is a persistent preference, not an active filter)', () => {
    expect(countActive(st({ hideTransfers: false }))).toBe(0);
    expect(countActive(st({ hideTransfers: true }))).toBe(0);
  });
  it('max count: all filter types active simultaneously', () => {
    expect(countActive(st({
      dateMode: 'month',
      type:     'expense',
      amtMin:   '10',
      groups:   ['food'],
      accounts: ['acct-1'],
      sources:  ['ai'],
      review:   true,
      pending:  true,
    }))).toBe(8);
  });
});

// ── findDuplicates ─────────────────────────────────────────────────────────────

// Helper: build a [id, txn] pair with sensible defaults
const dup = (id, overrides = {}) => [id, {
  date:         '2026-08-01',
  amount:       50,
  merchantName: 'Starbucks',
  description:  'STARBUCKS STORE 12345',
  pending:      false,
  ignored:      false,
  isTransfer:   false,
  group:        'food',
  ...overrides,
}];

describe('findDuplicates — basic detection', () => {
  it('flags two transactions with the same amount and same merchant on the same date', () => {
    const pairs = findDuplicates([dup('a'), dup('b')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0][0]).toBe('a');
    expect(pairs[0][2]).toBe('b');
  });

  it('returns empty array when there is only one transaction', () => {
    expect(findDuplicates([dup('a')])).toHaveLength(0);
  });

  it('returns empty array for transactions with different amounts', () => {
    const txns = [dup('a', { amount: 50 }), dup('b', { amount: 51 })];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('treats amounts within ±1¢ as the same (rounding to cents)', () => {
    // Both round to 5000 cents
    const txns = [dup('a', { amount: 49.999 }), dup('b', { amount: 50.001 })];
    expect(findDuplicates(txns)).toHaveLength(1);
  });
});

describe('findDuplicates — date window', () => {
  it('allows 2 days between same-pending-state transactions', () => {
    const txns = [
      dup('a', { date: '2026-08-01' }),
      dup('b', { date: '2026-08-03' }),
    ];
    expect(findDuplicates(txns)).toHaveLength(1);
  });

  it('rejects transactions 3 days apart when neither is pending', () => {
    const txns = [
      dup('a', { date: '2026-08-01' }),
      dup('b', { date: '2026-08-04' }),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('allows 5 days when one transaction is pending and the other is not', () => {
    const txns = [
      dup('a', { date: '2026-08-01', pending: true }),
      dup('b', { date: '2026-08-06', pending: false }),
    ];
    expect(findDuplicates(txns)).toHaveLength(1);
  });

  it('rejects 6-day gap even between pending and settled', () => {
    const txns = [
      dup('a', { date: '2026-08-01', pending: true }),
      dup('b', { date: '2026-08-07', pending: false }),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });
});

describe('findDuplicates — name matching', () => {
  it('is case-insensitive for merchant names', () => {
    const txns = [
      dup('a', { merchantName: 'STARBUCKS' }),
      dup('b', { merchantName: 'starbucks' }),
    ];
    expect(findDuplicates(txns)).toHaveLength(1);
  });

  it('matches when one name is a substring of the other (fuzzy)', () => {
    const txns = [
      dup('a', { merchantName: 'Starbucks Coffee' }),
      dup('b', { merchantName: 'Starbucks' }),
    ];
    expect(findDuplicates(txns)).toHaveLength(1);
  });

  it('rejects transactions with completely different merchant names', () => {
    const txns = [
      dup('a', { merchantName: 'Starbucks' }),
      dup('b', { merchantName: 'McDonalds' }),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('falls back to description when merchantName is absent', () => {
    const txns = [
      dup('a', { merchantName: undefined, description: 'STARBUCKS STORE 001' }),
      dup('b', { merchantName: undefined, description: 'STARBUCKS STORE 002' }),
    ];
    // "starbucks store 001" contains "starbucks store" — no match because 001 ≠ 002
    // But 001 doesn't include 002 and vice versa; however "starbucks store 001" includes "starbucks"
    // Actually both include "starbucks" — let's use exact same description for a definitive test
    const txns2 = [
      dup('c', { merchantName: null, description: 'NETFLIX.COM' }),
      dup('d', { merchantName: null, description: 'NETFLIX.COM' }),
    ];
    expect(findDuplicates(txns2)).toHaveLength(1);
  });

  it('skips pairs where both cleaned names are empty', () => {
    const txns = [
      dup('a', { merchantName: '---', description: '...' }),
      dup('b', { merchantName: '---', description: '...' }),
    ];
    // After cleaning, both become '' → skipped
    expect(findDuplicates(txns)).toHaveLength(0);
  });
});

describe('findDuplicates — exclusions', () => {
  it('ignores transactions flagged as ignored', () => {
    const txns = [dup('a', { ignored: true }), dup('b')];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('ignores transactions that are transfers (isTransfer)', () => {
    const txns = [dup('a', { isTransfer: true }), dup('b', { isTransfer: true })];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('ignores transactions in the transfer group', () => {
    const txns = [dup('a', { group: 'transfer' }), dup('b', { group: 'transfer' })];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('ignores transactions with legacy dupReviewed flag', () => {
    const txns = [dup('a', { dupReviewed: true }), dup('b', { dupReviewed: true })];
    expect(findDuplicates(txns)).toHaveLength(0);
  });
});

describe('findDuplicates — dupOk suppression', () => {
  it('suppresses a pair when A has dupOk referencing B (object form)', () => {
    const txns = [
      dup('a', { dupOk: { b: true } }),
      dup('b'),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('suppresses a pair when B has dupOk referencing A (object form)', () => {
    const txns = [
      dup('a'),
      dup('b', { dupOk: { a: true } }),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('suppresses a pair when dupOk is stored as an array', () => {
    const txns = [
      dup('a', { dupOk: ['b'] }),
      dup('b'),
    ];
    expect(findDuplicates(txns)).toHaveLength(0);
  });

  it('does not suppress unrelated pairs when dupOk targets a different txn', () => {
    const txns = [
      dup('a', { dupOk: { c: true } }),
      dup('b'),
    ];
    expect(findDuplicates(txns)).toHaveLength(1);
  });
});

describe('findDuplicates — pairwise completeness', () => {
  it('returns all 3 pairs for 3 matching transactions (no used-Set pruning)', () => {
    const txns = [dup('a'), dup('b'), dup('c')];
    const pairs = findDuplicates(txns);
    expect(pairs).toHaveLength(3);
    const ids = pairs.map(([idA, , idB]) => `${idA}-${idB}`).sort();
    expect(ids).toEqual(['a-b', 'a-c', 'b-c']);
  });

  it('caps output at 100 pairs', () => {
    // Create 15 identical transactions → 15×14/2 = 105 pairs → should return exactly 100
    const txns = Array.from({ length: 15 }, (_, i) => dup(`t${i}`));
    const pairs = findDuplicates(txns);
    expect(pairs).toHaveLength(100);
  });
});
