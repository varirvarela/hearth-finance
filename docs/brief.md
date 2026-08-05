# Hearth Finance — Product Brief

Hearth is a mobile-first progressive web app (PWA) for managing household finances. It connects to bank and investment accounts via Plaid, automatically categorizes transactions using AI, and lets both partners in a household share a unified view of their spending, budgets, and net worth.

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS (ES modules), Vite bundler |
| Backend | Firebase Realtime Database (all transactional data) |
| Auth | Firebase Auth (email/password + Google sign-in) |
| Bank Integration | Plaid API (Link flow + transaction sync) — proxied via Cloudflare Worker |
| AI Categorization | Cloudflare Worker calls Claude API (`@anthropic-ai/sdk`) |
| Hosting | GitHub Pages (PWA at `/`) |
| CI/CD | GitHub Actions: tests on PR, deploy on push to `main` |
| Scheduled jobs | Cloudflare Worker (`workers/src/`) — daily transaction sync, budget alerts |

There is a single Vite build:
- **Main app** (`src/app/`) — the PWA installed on Android and iOS

Shared code lives in `src/shared/` (Firebase helpers, category taxonomy, rule engine, formatters, changelog).

Plaid access tokens are stored in Cloudflare KV (never in the client or RTDB). The Cloudflare Worker is the only process that holds and uses raw Plaid tokens.

---

## Firebase data shape

```
users/
  {uid}: { name, email, currency, partnerUid, inviteCode,
           createdAt, pushSubscription, pwaMode }

accounts/
  {uid}/
    {accountId}: { name, type, subtype, institution, plaidItemId,
                   lastSync, currentBalance, availableBalance,
                   currency, isManual, isHidden }

transactions/
  {uid}/
    {txnId}: { date, amount, description, originalDescription,
               merchantName, category, categorySource,
               accountId, pending, notes, tags[], ignored,
               splitOf, splitChildren[], plaidId }
  — categorySource: 'plaid' | 'rule' | 'ai' | 'manual'

budgets/
  {uid}/
    {year}/
      monthly/
        {month}/         ← "01"–"12"
          {category}: { limit }
      annual/
        {category}: { limit }

rules/
  {uid}/
    {ruleId}: { name, matchField, matchOp, matchValue,
                action, actionValue, priority, enabled, createdAt }

categories/
  default/               ← system defaults (seeded at first sync)
    {catId}: { name, parent, color, icon, isIncome, sortOrder }
  {uid}/                 ← user overrides / custom categories
    {catId}: { name, parent, color, icon, isIncome }

invites/
  {code}: { fromUid, email, createdAt, accepted, acceptedBy }

config/
  plaidEnvironment: 'sandbox' | 'development' | 'production'
```

Computed values (monthly spent per category, net worth) are derived on the client from raw transactions — not stored — to avoid fan-out write complexity.

---

## App views / tabs

| Tab | File | What it does |
|---|---|---|
| Dashboard | `src/app/dashboard.js` | Net worth, monthly cash flow, top spending categories (donut chart), recent transactions, upcoming bills |
| Transactions | `src/app/transactions.js` | Full ledger with search + filters (account, category, date range); inline category correction; split transaction; add note/tag |
| Budgets | `src/app/budgets.js` | Monthly and annual budget setup per category; progress bars; over-budget alerts; projected end-of-month spend |
| Accounts | `src/app/accounts.js` | Linked accounts (Plaid) + manual accounts; sync status; balance history |
| Settings | `src/app/settings.js` | Categorization rules, custom categories, partner sharing, push notifications, CSV export |

---

## Transaction categorization pipeline

```
Plaid transaction arrives
        │
        ▼
Rule engine (user rules, priority-ordered)
        │  match? → apply category, source = 'rule'
        │  no match ↓
        ▼
AI classifier (Claude via Cloudflare Worker)
        │  → category + confidence, source = 'ai'
        ▼
Saved to RTDB with categorySource tag
        │
        ▼
User corrects category in app
        │  → source = 'manual'
        │  → "always categorize X as Y?" → creates rule
```

Rules have: `matchField` (description | merchant | amount), `matchOp` (contains | startsWith | equals | gt | lt), `matchValue`, `action` (setCategory), `actionValue` (category id), `priority` (lower number = higher priority).

---

## Accounts and Plaid flow

1. User taps "Add Account" → app calls Worker `POST /plaid/link-token`
2. Worker creates a Plaid Link token (server-side) → returns to app
3. App opens Plaid Link embedded modal → user connects their bank
4. Plaid Link returns `public_token` → app calls Worker `POST /plaid/exchange-token`
5. Worker exchanges for `access_token` → stores in KV, fetches account metadata, writes account record to RTDB
6. Worker's daily sync cron fetches new transactions for all linked accounts

Supported account types: checking, savings, credit cards, brokerage, 401k, IRA.

---

## Budget model

Two period types:
- **Monthly budget**: limits that reset each month (e.g., $600/mo for Groceries)
- **Annual budget**: limits for the full year (e.g., $3,000/yr for Travel)

Spending is computed by summing transactions in the period for that category and all its sub-categories. The UI shows:
- Remaining / overage in dollars
- Progress bar (green < 80%, amber 80–99%, red ≥ 100%)
- Projected end-of-month spend (linear extrapolation from current day)

---

## Partner sharing

One partner sends an invite (6-character code, stored in `invites/`). The other signs in and enters the code. On acceptance:
- `users/{uid1}.partnerUid = uid2` (and vice versa)
- Transactions view merges both partners' streams (toggle: "My accounts" / "All accounts")
- Budgets are shared — both partners' spending counts against the same budget limits
- Rules and category overrides remain per-user

---

## Cloudflare Worker (scheduled jobs)

All background jobs run in a single Cloudflare Worker (`workers/src/`) with cron triggers. Firebase access is via REST (`workers/src/firebase.js`); Plaid via REST (`workers/src/plaid.js`).

| Cron | What it does |
|---|---|
| `0 6 * * *` | Daily transaction sync: fetches last 2 days of transactions from Plaid for all linked accounts, de-dupes, runs rule + AI categorization, writes to RTDB |
| `0 20 * * *` | Budget alert: checks if any category is > 80% used or over budget; sends push notification |
| `0 8 1 * *` | Monthly reset reminder: notifies users to review last month's spending |

---

## Local development

```bash
npm install
npm run dev              # app on :5173 (DEV_ROOT = '_dev/' prefix — isolated from prod data)
npm run test             # vitest unit tests (rule engine, formatters, category logic)
npm run test:e2e         # Playwright E2E (requires Firebase emulator on :9000)
npm run worker:dev       # wrangler dev for the Cloudflare Worker on :8787

firebase emulators:start --only database --project hearth-finance
```

The `DEV_ROOT = '_dev/'` prefix is applied to all Firebase RTDB paths in dev mode so dev data never touches production.

Copy `.env.example` to `.env.local` and fill in your Firebase project credentials before running `npm run dev`.

---

## Key files for new contributors

| File | Purpose |
|---|---|
| `src/shared/firebase.js` | Firebase init, all DB helpers, `DEV_ROOT` prefix logic |
| `src/shared/categories.js` | Full category taxonomy: ids, names, parent hierarchy, icons, colors |
| `src/shared/rules.js` | `evaluateRules(transaction, rules)` — deterministic rule engine, returns matched category or null |
| `src/shared/format.js` | `fmtCurrency(amount, currency)`, `fmtDate(ts)`, `fmtMonth(year, month)` |
| `src/shared/changelog.js` | `CHANGELOG` array — source of truth for app version |
| `src/app/app.js` | Auth gate, tab router, Firebase Auth listener |
| `src/app/transactions.js` | Transaction list rendering, category correction UI, split flow |
| `workers/src/sync.js` | Core sync logic: Plaid fetch → rule engine → AI → RTDB write |
| `workers/src/plaid.js` | Plaid REST helpers: link-token, exchange-token, transactions.get |
| `workers/src/categorize.js` | `categorizeTransaction(txn, categories, env)` — calls Claude API |
| `e2e/helpers.js` | `seedData`, `clearData`, `freshStart`, `adminWrite`, `adminRead` — test utilities |
