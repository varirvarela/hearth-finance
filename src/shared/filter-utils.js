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
  if (t.categorySource === 'manual') return false; // user confirmed — never prompt again
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

// Returns [[idA, txnA, idB, txnB], ...] pairs of potential duplicates.
// Duplicates = same amount (±1¢), date within 2 days, same merchant/description.
export function findDuplicates(txnEntries) {
  const byAmountCents = new Map();
  for (const [id, t] of txnEntries) {
    if (t.ignored || t.isTransfer || t.group === 'transfer') continue;
    const cents = Math.round(t.amount * 100);
    if (!byAmountCents.has(cents)) byAmountCents.set(cents, []);
    byAmountCents.get(cents).push([id, t]);
  }

  const pairs = [];
  const used  = new Set();

  for (const group of byAmountCents.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, a] = group[i];
        const [idB, b] = group[j];
        if (used.has(idA) || used.has(idB)) continue;

        // Date within 2 days
        if (Math.abs(new Date(a.date) - new Date(b.date)) > 2 * 86400000) continue;

        // Same name (case-insensitive; strip punctuation)
        const clean = s => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const nameA = clean(a.merchantName ?? a.description);
        const nameB = clean(b.merchantName ?? b.description);
        if (!nameA || !nameB) continue;
        if (nameA !== nameB && !nameA.includes(nameB) && !nameB.includes(nameA)) continue;

        // Firebase RTDB may deserialize short arrays as objects — normalize both
        const okA = Array.isArray(a.dupOk) ? a.dupOk : Object.values(a.dupOk ?? {});
        const okB = Array.isArray(b.dupOk) ? b.dupOk : Object.values(b.dupOk ?? {});
        if (okA.includes(idB) || okB.includes(idA)) continue;
        pairs.push([idA, a, idB, b]);
        used.add(idA);
        used.add(idB);
      }
    }
  }
  return pairs;
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
