import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_MAP,
  getCategoryById,
  getRootCategories,
  getChildCategories,
  getIncomeCategories,
  getExpenseCategories,
} from '../shared/categories.js';

describe('CATEGORIES', () => {
  it('has no duplicate ids', () => {
    const ids = CATEGORIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all parent refs point to existing ids', () => {
    const ids = new Set(CATEGORIES.map(c => c.id));
    for (const cat of CATEGORIES) {
      if (cat.parent) {
        expect(ids.has(cat.parent), `${cat.id} references unknown parent "${cat.parent}"`).toBe(true);
      }
    }
  });

  it('every category has id, name, icon, color', () => {
    for (const cat of CATEGORIES) {
      expect(cat.id, `${cat.id} missing id`).toBeTruthy();
      expect(cat.name, `${cat.id} missing name`).toBeTruthy();
      expect(cat.icon, `${cat.id} missing icon`).toBeTruthy();
      expect(cat.color, `${cat.id} missing color`).toBeTruthy();
    }
  });
});

describe('CATEGORY_MAP', () => {
  it('indexes all categories by id', () => {
    expect(Object.keys(CATEGORY_MAP).length).toBe(CATEGORIES.length);
  });
});

describe('getCategoryById', () => {
  it('returns the correct category', () => {
    const cat = getCategoryById('food_groceries');
    expect(cat.name).toBe('Groceries');
    expect(cat.parent).toBe('food');
  });

  it('falls back to uncategorized for unknown ids', () => {
    expect(getCategoryById('does_not_exist').id).toBe('uncategorized');
    expect(getCategoryById(undefined).id).toBe('uncategorized');
    expect(getCategoryById(null).id).toBe('uncategorized');
  });
});

describe('getRootCategories', () => {
  it('only returns top-level categories', () => {
    const roots = getRootCategories();
    expect(roots.every(c => !c.parent)).toBe(true);
    expect(roots.length).toBeGreaterThan(0);
  });

  it('excludes uncategorized', () => {
    expect(getRootCategories().some(c => c.id === 'uncategorized')).toBe(false);
  });

  it('includes known root categories', () => {
    const ids = new Set(getRootCategories().map(c => c.id));
    expect(ids.has('food')).toBe(true);
    expect(ids.has('housing')).toBe(true);
    expect(ids.has('transport')).toBe(true);
    expect(ids.has('income')).toBe(true);
  });
});

describe('getChildCategories', () => {
  it('returns children of food', () => {
    const children = getChildCategories('food');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(c => c.parent === 'food')).toBe(true);
    expect(children.some(c => c.id === 'food_groceries')).toBe(true);
    expect(children.some(c => c.id === 'food_dining')).toBe(true);
  });

  it('returns empty array for a leaf category', () => {
    expect(getChildCategories('food_groceries')).toHaveLength(0);
  });

  it('returns empty array for unknown id', () => {
    expect(getChildCategories('nonexistent')).toHaveLength(0);
  });
});

describe('getIncomeCategories', () => {
  it('all returned categories have isIncome true', () => {
    expect(getIncomeCategories().every(c => c.isIncome)).toBe(true);
  });

  it('includes salary', () => {
    expect(getIncomeCategories().some(c => c.id === 'income_salary')).toBe(true);
  });
});

describe('getExpenseCategories', () => {
  it('excludes income categories', () => {
    expect(getExpenseCategories().some(c => c.isIncome)).toBe(false);
  });

  it('excludes transfer', () => {
    expect(getExpenseCategories().some(c => c.id === 'transfer')).toBe(false);
  });

  it('includes food and housing', () => {
    const ids = new Set(getExpenseCategories().map(c => c.id));
    expect(ids.has('food')).toBe(true);
    expect(ids.has('housing')).toBe(true);
  });
});
