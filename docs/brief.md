# Hearth Finance — Product Blueprint

> **Living document.** Update this file whenever a feature, data path, or architectural decision changes. See `CLAUDE.md` for the update rule.

Hearth is a mobile-first progressive web app (PWA) for household finance management. It connects to bank accounts via Plaid, automatically categorizes transactions through a 4-tier AI pipeline, and lets both partners in a household share budgets, transactions, and net worth.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS (ES modules), Vite 5 |
| Database | Firebase Realtime Database |
| Auth | Firebase Auth (email/password + Google) |
| Bank integration | Plaid API — proxied via Cloudflare Worker |
| AI categorization | Cloudflare Worker → Google Gemini (`gemini-3.6-flash`) |
| Hosting | GitHub Pages (auto-deploy on push to `main`) |
| CI/CD | GitHub Actions: unit tests + E2E tests + deploy |
| Background jobs | Cloudflare Worker crons (daily sync, budget alerts) |

There is a single Vite build serving the main PWA (`src/app/`). Shared utilities live in `src/shared/`.

Plaid access tokens are stored in Cloudflare KV — never in the client or Firebase. The Worker is the only process that holds and uses raw Plaid tokens.

In development, all Firebase RTDB paths are prefixed with `_dev/` (`DEV_ROOT` in `src/shared/firebase.js`) so dev data never touches production.

---

## Firebase data shape

```
users/
  {uid}: { name, email, partnerUid, createdAt, pushSubscription }

accounts/
  {uid}/
    {accountId}: {
      name, alias,                  # alias = user-set display name
      type, subtype, institution,
      plaidItemId, plaidSlot,       # slot 1 or 2 (two-credential system)
      currentBalance, availableBalance, currency,
      lastSync,                     # 'YYYY-MM-DD' — set on each successful sync
      lastSyncStatus,               # 'ok' | 'error'
      lastSyncError,                # error message or null
      isManual, isHidden,
      mergedNames,                  # Tiller account names merged into this Plaid account
      excludedMerges,               # Tiller names explicitly excluded from merging
    }

transactions/
  {uid}/
    {txnId}: {
      date,                         # 'YYYY-MM-DD'
      amount,                       # positive = expense, negative = income
      description, originalDescription, merchantName,
      category,                     # category id from taxonomy (or 'uncategorized')
      categorySource,               # 'plaid' | 'rule' | 'ai' | 'manual' | 'tiller' | 'import'
      needsReview,                  # boolean — shown in "needs review" filter
      aiConfidence,                 # 0–1 float from AI tier
      accountId, accountName,
      pending,                      # boolean — Plaid pending flag
      notes, ignored,
      isTransfer, group,            # group = parent category id
      dupOk,                        # { [pairedTxnId]: true } — skipped duplicate pairs
      _owner,                       # partner uid if this is a mirrored partner transaction
    }

budgets/
  {uid}/
    {catId}: { monthly }            # monthly limit in dollars for that leaf category

suggestions/
  {uid}/
    {txnId}: {                      # pre-computed AI/heuristic suggestion from batch script
      catId, source,                # source: 'ai' | 'heuristic'
      conf,                         # confidence 0–1
      hint,                         # human-readable match explanation
    }

merchantRules/
  {uid}/
    {normalizedName}: { catId, confirmedAt }   # learned from user confirmations

categoryDescriptions/
  {uid}/
    {catId}: "plain-text description"           # used as AI context

customCategories/
  {uid}/
    {catId}: { name, icon, parent, color, ... } # user-defined leaf categories (future)

rules/
  {uid}/
    {ruleId}: {
      name, matchField, matchOp, matchValue,
      categoryId, priority, enabled, createdAt,
    }

invites/
  {code}: { fromUid, email, createdAt, accepted, acceptedBy }
```

Computed values (monthly spend per category, net worth) are derived on the client — not stored — to avoid fan-out write complexity.

---

## App views / tabs

| Tab | File | Description |
|---|---|---|
| Dashboard | `src/app/dashboard.js` | Net worth, monthly cash flow, top spending donut chart, recent transactions, upcoming bills |
| Transactions | `src/app/transactions.js` | Full ledger with search + multi-filter; inline category correction; duplicate detection and review; quick-confirm suggestion strips |
| Budgets | `src/app/budgets.js` | Monthly and annual budget tiles by group → category → detail drill-down; progress bars with pace indicator; group and category edit modals |
| Accounts | `src/app/accounts.js` | Linked Plaid accounts + manual accounts; per-account last-sync status (green/amber/red); Tiller merge tool; reconnect/unlink |
| Settings | `src/app/settings.js` | Partner sharing (invite code flow); Category descriptions editor (AI context); app version + changelog |

---

## Transaction categorization — 4-tier pipeline

Every uncategorized transaction is evaluated through four tiers, in order. The first match wins.

```
Tier 1 — User rules
  evaluateRules(txn, rules) from src/shared/rules.js
  User-defined rules (matchField, matchOp, matchValue → categoryId, priority).
  Source tag: 'rule'

Tier 2 — Keyword heuristics
  Static regex patterns in suggestCategory() in transactions.js.
  ~25 patterns covering transfers, dining, streaming, utilities, shopping, etc.
  Source tag: 'heuristic'

Tier 3 — Firebase batch suggestions
  Pre-loaded at startup from suggestions/{uid} into _aiSugCache Map.
  Written by the patch-manual-categorize.js batch script using the same
  heuristics + 260+ merchant-specific rules (more comprehensive than Tier 2).
  Persisted so the same transaction never triggers an AI call again.
  Source tag: 'heuristic' or 'ai'

Tier 4 — Live AI (Gemini)
  Fires only when Tiers 1–3 all miss.
  App calls Cloudflare Worker POST /categorize with:
    - transaction fields (description, merchant, amount, date, account, Plaid category)
    - merchantRules (learned from user confirmations)
    - categoryDescriptions (per-category AI-context strings from Settings)
  Worker calls Google Gemini, returns { category, confidence, alternatives }.
  Result is saved to suggestions/{uid}/{txnId} so Tier 3 catches it next load.
  Source tag: 'ai'
```

**Learned merchant rules (Tier 0.5):** When a user confirms a suggestion, `learnMerchant()` writes `normalizedMerchantName → { catId }` to `merchantRules/{uid}`. The Worker reads these and applies them before calling AI — so recurring merchants are categorized instantly on the next sync.

**UI states for uncategorized rows:**
- `Analyzing…` (grey) — Tier 4 call in-flight
- `Suggested` / `Rule` / `AI` (purple/amber strip) — recommendation ready, shows Confirm + Change
- `⚠ Uncategorized` (red strip) — all tiers missed, manual categorization required

---

## Duplicate detection

`findDuplicates(txnEntries)` in `src/shared/filter-utils.js` finds potential duplicate transactions:
- Same amount (±1¢)
- Date within 2 days (5 days for pending→settled)
- Same merchant name (fuzzy: prefix/substring match)

Returns all pairwise combinations (no `used` Set — all transitive pairs shown at once).
Capped at 100 pairs for performance.

When a user skips a pair, `dupOk[pairedTxnId] = true` is written to each transaction, permanently suppressing that specific pair.

---

## Budget model

- **Budgets** are stored flat: `budgets/{uid}/{catId}/monthly` (dollars per month).
- Annual view multiplies `monthly * 12` — no separate annual storage.
- All expense leaf categories (including those with $0 budget) are shown in the budget tiles.
- Categories are grouped into tiles: Group → Category → Detail drill-down.
- Pace indicator: current day / days-in-month × 100% = expected spend percentage.
- Status: `good` (green), `warn` (amber, ≥ pace+10%), `over` (red, spent > budget), `zero` (dim, no budget set).

---

## Category taxonomy

Static in `src/shared/categories.js`. Two-level hierarchy:

- **Groups** (`parent: null`): 16 expense groups + 2 income groups + `transfer` + `uncategorized`
- **Leaves** (`parent: groupId`): 44 leaf categories (the actual tags on transactions)
- `hide: true` — kept for data integrity, not shown in pickers
- `isFixed: true` — amount is the same each period (mortgage, phone)
- `isAnnual: true` — budgeted annually, not monthly

User-editable descriptions per category are stored in `categoryDescriptions/{uid}` and shown in Settings → Categories.

---

## Partner sharing

One partner sends an invite (6-character code in `invites/`). On acceptance:
- `users/{uid1}.partnerUid = uid2` (and vice versa)
- Transactions merges both streams; partner transactions shown with a badge
- Budgets count spending from both partners
- Rules, suggestions, merchant rules remain per-user

---

## Accounts and Plaid flow

1. "Link Bank" → Worker `POST /plaid/link-token`
2. Worker creates Link token (server-side) → returned to app
3. App opens Plaid Link modal → user authenticates with their bank
4. Plaid returns `public_token` → app calls Worker `POST /plaid/exchange-token`
5. Worker exchanges for `access_token` → stores in KV, writes account records to `accounts/{uid}`
6. Worker daily cron: fetches last 2 days of transactions → rule engine → AI → writes to `transactions/{uid}`
7. `lastSync` on each account is updated to today's date; `lastSyncStatus` set to `'ok'` or `'error'`

Supported types: checking, savings, credit, investment, loan.

Two Plaid credential slots (`plaidSlot: 1 | 2`) allow connecting up to two separate bank institutions with independent credentials stored in KV.

---

## Cloudflare Worker endpoints

**`src/workers/src/index.js`** handles all Worker routes:

| Route | Method | What it does |
|---|---|---|
| `/plaid/link-token` | POST | Creates a Plaid Link token for the frontend |
| `/plaid/exchange-token` | POST | Exchanges public_token → access_token, writes accounts |
| `/plaid/reconnect-token` | POST | Re-authenticates an expired Plaid item |
| `/plaid/remove-account` | POST | Revokes Plaid access and removes account records |
| `/categorize` | POST | Runs Gemini AI categorization for a single transaction |
| `/sync` | POST | Manual trigger for transaction sync for a specific user |
| Cron `0 6 * * *` | — | Daily auto-sync for all users |
| Cron `0 20 * * *` | — | Budget overage alerts (push notifications) |

Auth: Firebase JWT extracted from `Authorization: Bearer <token>` header (uid extracted from payload for routing; actual security enforced by Firebase RTDB rules).

---

## Security rules

`database.rules.json` — deployed with `firebase deploy --only database`.

Every path restricts to `auth.uid === $uid`. Root-level rule is `.read: false, .write: false` (deny-all default).

Currently protected paths: `accounts`, `transactions`, `budgets`, `rules`, `suggestions`, `merchantRules`, `categoryDescriptions`, `customCategories`, `users`, `invites`, `_dev/*`.

---

## Key files

| File | Purpose |
|---|---|
| `src/shared/firebase.js` | Firebase init, `dbGet/Set/Listen/Update/Remove`, `DEV_ROOT` prefix |
| `src/shared/categories.js` | Full taxonomy — `CATEGORIES`, `getCategoryById`, `CATEGORY_MAP` |
| `src/shared/rules.js` | `evaluateRules(txn, rules)` — deterministic rule engine |
| `src/shared/filter-utils.js` | `applyFilters`, `findDuplicates`, `needsReview`, `blankState` |
| `src/shared/changelog.js` | `CHANGELOG` array — source of truth for app version |
| `src/shared/normalize-merchant.js` | Normalize merchant names for learned-rule keys |
| `src/app/app.js` | Auth gate, tab router, Firebase Auth listener |
| `src/app/transactions.js` | Transaction list, suggestion pipeline, duplicate banner |
| `src/app/budgets.js` | Budget tiles, drill-down, edit modals |
| `src/app/accounts.js` | Account cards, Plaid link/sync, Tiller merge |
| `src/app/settings.js` | Partner sharing, category descriptions editor |
| `workers/src/categorize.js` | `categorizeTransaction()` — Gemini prompt + response parsing |
| `workers/src/sync.js` | Plaid fetch → rule engine → AI → RTDB write |
| `workers/src/firebase.js` | Firebase Admin REST calls from Worker |
| `scripts/patch-manual-categorize.js` | One-time/recurring batch: applies 260+ merchant rules, writes to `suggestions/{uid}` |
| `database.rules.json` | Firebase RTDB security rules |
| `firebase.json` | Firebase CLI project config (points at rules file) |

---

## Local development

```bash
npm install
npm run dev              # PWA on :5173 (DEV_ROOT = '_dev/' — isolated from prod)
npm run test             # vitest unit tests (fast, no Firebase)
npm run test:e2e         # Playwright E2E (unauthenticated shell only in CI; full flow needs local Firebase)
npm run worker:dev       # Cloudflare Worker on :8787

firebase deploy --only database   # deploy security rule changes
npm run worker:deploy             # deploy Worker to Cloudflare
```

Copy `.env.example` to `.env.local` and fill Firebase credentials before running `npm run dev`.

---

## Testing strategy

| Layer | Tool | What's covered |
|---|---|---|
| Unit | Vitest (`src/__tests__/`) | Rule engine, filter utils, `findDuplicates`, formatters, category helpers |
| E2E shell | Playwright (`e2e/`) | Auth screen structure, PWA metadata, form validation — no Firebase needed |
| E2E authenticated | Playwright + Firebase Emulator | Full tab navigation, category correction, budget entry — local only for now |

CI runs unit tests + E2E shell tests on every push to `main` before deploying.
