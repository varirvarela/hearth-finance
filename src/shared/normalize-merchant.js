// Normalizes a merchant/description string to a stable key used for merchant-rule lookups.
// Must be identical across: batch script, Worker, and app — do not change without updating all three.
export function normalizeMerchant(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/^(sq \*|tst\*|tst \*|paypal \*|pp \*|dba |sp \*|int \*)/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b[a-z0-9]{8,}\b/g, '')   // strip long alphanumeric order IDs
    .replace(/\b(inc|llc|ltd|corp|co)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
