import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_MAP,
  getCategoryById,
  getRootCategories,
  getChildCategories,
  getIncomeCategories,
  getExpenseCategories,
  CATEGORY_NAME_MAP,
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
      expect(cat.id, `missing id`).toBeTruthy();
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
    const cat = getCategoryById('paycheck');
    expect(cat.name).toBe('Sueldo');
    expect(cat.parent).toBe('income_trabajo');
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

  it('includes the expected groups', () => {
    const ids = new Set(getRootCategories().map(c => c.id));
    expect(ids.has('casa')).toBe(true);
    expect(ids.has('auto')).toBe(true);
    expect(ids.has('salidas')).toBe(true);
    expect(ids.has('income_trabajo')).toBe(true);
    expect(ids.has('travel')).toBe(true);
  });
});

describe('getChildCategories', () => {
  it('returns children of casa', () => {
    const children = getChildCategories('casa');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(c => c.parent === 'casa')).toBe(true);
    expect(children.some(c => c.id === 'casa_fijo_mensual')).toBe(true);
  });

  it('returns empty array for a leaf category', () => {
    expect(getChildCategories('paycheck')).toHaveLength(0);
  });

  it('returns empty array for unknown id', () => {
    expect(getChildCategories('nonexistent')).toHaveLength(0);
  });
});

describe('getIncomeCategories', () => {
  it('all returned categories have isIncome true', () => {
    expect(getIncomeCategories().every(c => c.isIncome)).toBe(true);
  });

  it('includes paycheck and bonus', () => {
    const ids = new Set(getIncomeCategories().map(c => c.id));
    expect(ids.has('paycheck')).toBe(true);
    expect(ids.has('bonus')).toBe(true);
  });
});

describe('getExpenseCategories', () => {
  it('excludes income categories', () => {
    expect(getExpenseCategories().some(c => c.isIncome)).toBe(false);
  });

  it('excludes transfer', () => {
    expect(getExpenseCategories().some(c => c.id === 'transfer')).toBe(false);
  });

  it('includes core expense categories', () => {
    const ids = new Set(getExpenseCategories().map(c => c.id));
    expect(ids.has('casa')).toBe(true);
    expect(ids.has('auto')).toBe(true);
    expect(ids.has('salidas')).toBe(true);
  });
});

describe('CATEGORY_NAME_MAP', () => {
  it('maps all known Tiller category names to valid ids', () => {
    const validIds = new Set(CATEGORIES.map(c => c.id));
    for (const [name, id] of Object.entries(CATEGORY_NAME_MAP)) {
      expect(validIds.has(id), `"${name}" maps to unknown id "${id}"`).toBe(true);
    }
  });

  it('maps key categories correctly', () => {
    expect(CATEGORY_NAME_MAP['Paycheck']).toBe('paycheck');
    expect(CATEGORY_NAME_MAP['Casa Fijo Mensual']).toBe('casa_fijo_mensual');
    expect(CATEGORY_NAME_MAP['Shopping Comunes Mensual']).toBe('shopping_comunes');
    expect(CATEGORY_NAME_MAP['Travel Argentina']).toBe('travel_argentina');
  });
});
