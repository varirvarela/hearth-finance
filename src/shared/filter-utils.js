export function blankState() {
  return {
    query:         '',
    dateMode:      'all',
    year:          new Date().getFullYear(),
    month:         new Date().getMonth() + 1,
    dateFrom:      '',
    dateTo:        '',
    type:          'all',
    amtMin:        '',
    amtMax:        '',
    groups:        [],
    cats:          [],
    accounts:      [],
    sources:       [],
    review:        false,
    pending:       false,
    hideTransfers: true,
    page:          0,
  };
}

export function needsReview(t) {
  return t.needsReview === true || t.category === 'uncategorized' || (t.aiConfidence != null && t.aiConfidence < 0.75);
}

// Normalize the raw source values stored on a transaction to a canonical bucket
// used by the source filter UI.
export function normalizeSource(t) {
  const raw = t.categorySource ?? t.source ?? '';
  if (raw === 'tiller' || raw === 'import') return 'import';
  return raw; // 'ai' | 'rule' | 'manual' | 'plaid' | ''
}

export function applyFilters(txns, state) {
  return txns.filter(([, t]) => {
    if (state.hideTransfers && (t.isTransfer || t.group === 'transfer')) return false;

    if (state.query) {
      const q = state.query;
      if (
        !t.description?.toLowerCase().includes(q) &&
        !t.merchantName?.toLowerCase().includes(q) &&
        !t.notes?.toLowerCase().includes(q)
      ) return false;
    }

    if (state.dateMode === 'month') {
      if (state.month === 0) {
        if (!t.date?.startsWith(String(state.year))) return false;
      } else {
        const prefix = `${state.year}-${String(state.month).padStart(2, '0')}`;
        if (!t.date?.startsWith(prefix)) return false;
      }
    }

    if (state.dateMode === 'range') {
      if (state.dateFrom && t.date < state.dateFrom) return false;
      if (state.dateTo   && t.date > state.dateTo)   return false;
    }

    if (state.type === 'expense' && t.amount <= 0) return false;
    if (state.type === 'income'  && t.amount >= 0) return false;

    if (state.amtMin && Math.abs(t.amount) < Number(state.amtMin)) return false;
    if (state.amtMax && Math.abs(t.amount) > Number(state.amtMax)) return false;

    if (state.groups.length > 0 && !state.groups.includes(t.group))    return false;
    if (state.cats.length   > 0 && !state.cats.includes(t.category))   return false;

    if (state.accounts.length > 0 &&
        !(state.accounts.includes(t.accountId) || state.accounts.includes(t.accountName))) return false;

    if (state.sources.length > 0 && !state.sources.includes(normalizeSource(t))) return false;

    if (state.review  && !needsReview(t))    return false;
    if (state.pending && t.pending !== true) return false;

    return true;
  });
}

export function countActive(state) {
  let count = 0;
  if (state.dateMode !== 'all')       count++;
  if (state.type !== 'all')           count++;
  if (state.amtMin || state.amtMax)   count++;
  if (state.groups.length > 0)        count++;
  if (state.accounts.length > 0)      count++;
  if (state.sources.length > 0)       count++;
  if (state.review)                   count++;
  if (state.pending)                  count++;
  return count;
}
