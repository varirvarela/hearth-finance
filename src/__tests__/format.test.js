import { describe, it, expect } from 'vitest';
import { fmtCurrency, fmtDate, fmtMonth, fmtRelativeDate, fmtPercent, currentMonthKey } from '../shared/format.js';

describe('fmtCurrency', () => {
  it('formats whole dollars', () => {
    expect(fmtCurrency(100)).toBe('$100.00');
  });

  it('formats cents', () => {
    expect(fmtCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats zero', () => {
    expect(fmtCurrency(0)).toBe('$0.00');
  });

  it('formats negative values', () => {
    expect(fmtCurrency(-50)).toBe('-$50.00');
  });

  it('accepts other currencies', () => {
    const result = fmtCurrency(100, 'EUR');
    expect(result).toMatch(/100/);
  });
});

describe('fmtDate', () => {
  it('formats a date string into readable form', () => {
    expect(fmtDate('2026-08-01')).toContain('Aug');
    expect(fmtDate('2026-01-15')).toContain('Jan');
    expect(fmtDate('2026-12-25')).toContain('Dec');
  });

  it('includes the year', () => {
    expect(fmtDate('2026-08-01')).toContain('2026');
  });
});

describe('fmtMonth', () => {
  it('returns full month name and year', () => {
    expect(fmtMonth(2026, '08')).toBe('August 2026');
    expect(fmtMonth(2026, '01')).toBe('January 2026');
    expect(fmtMonth(2026, '12')).toBe('December 2026');
  });
});

describe('fmtRelativeDate', () => {
  it('returns Today for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(fmtRelativeDate(today)).toBe('Today');
  });

  it('returns Yesterday for yesterday', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    expect(fmtRelativeDate(yesterday)).toBe('Yesterday');
  });

  it('falls back to formatted date for older dates', () => {
    expect(fmtRelativeDate('2020-01-01')).toContain('2020');
  });
});

describe('fmtPercent', () => {
  it('calculates percentage', () => {
    expect(fmtPercent(50, 100)).toBe('50%');
    expect(fmtPercent(1, 3)).toBe('33%');
    expect(fmtPercent(100, 100)).toBe('100%');
  });

  it('returns 0% when total is 0', () => {
    expect(fmtPercent(50, 0)).toBe('0%');
  });

  it('returns 0% when value is 0', () => {
    expect(fmtPercent(0, 100)).toBe('0%');
  });
});

describe('currentMonthKey', () => {
  it('returns YYYY-MM format', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('month is within 1–12', () => {
    const [, month] = currentMonthKey().split('-');
    const m = Number(month);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(12);
  });

  it('offset by 1 month differs from current', () => {
    expect(currentMonthKey(1)).not.toBe(currentMonthKey());
    expect(currentMonthKey(-1)).not.toBe(currentMonthKey());
  });
});
