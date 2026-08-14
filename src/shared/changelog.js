export const CHANGELOG = [
  {
    version: '0.9.0',
    date: '2026-08-14',
    changes: [
      'Responsive layout: on tablet and desktop the app uses a left sidebar navigation instead of a bottom bar.',
      'Content is no longer constrained to a narrow mobile column — pages expand to 900px on tablet and 1080px on large screens.',
      'Modals and category pickers appear as centered dialogs on desktop instead of bottom sheets.',
      'The sign-in screen uses a split hero + form layout on wider screens.',
      'Dashboard metric cards reflow to a single three-card row on wider screens.',
    ],
  },
  {
    version: '0.8.1',
    date: '2026-08-14',
    changes: [
      'Internal: extracted filter utility functions into a shared module and added 61 unit tests covering all filter branches.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-08-14',
    changes: [
      'Partner sharing: when a partner is linked, their transactions, accounts, and budgets are combined with yours across all tabs.',
      'Transactions: partner transactions show a pill badge with the partner\'s initial and are read-only (notes, transfer flag, and category cannot be changed).',
      'Accounts: partner institutions are marked with a "Partner" badge; Reconnect/Unlink controls are hidden for partner accounts.',
      'Dashboard and Budgets: spending totals and budget calculations now include partner transactions.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-08-14',
    changes: [
      'Settings: new Recurring Transactions section — define monthly bill and income templates, generate them as real transactions for any month with a single tap.',
      'Settings: "Apply rules to existing transactions" batch button — re-categorizes all non-manual transactions in one click.',
      'Transactions: clicking "Add Rule" in the category picker now pre-fills the merchant name in the rule editor.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-08-14',
    changes: [
      'Budget tab fully rebuilt: hierarchical category view, inline budget editing, progress bars (green/amber/red), month navigation.',
      'Dashboard: month ← → navigation, 12-month SVG spending trend chart, "vs Budget" card showing over/under spend.',
      'Transactions: click any row to expand detail panel with notes, transfer checkbox, source badge, and AI confidence.',
      'Transactions: account name shown in each row; Tiller accounts now appear in the account filter.',
      'Transactions: Hide transfers filter on by default — excludes both manually-marked and category-based transfers.',
      'Accounts: Unlink button per institution — removes bank connection with optional transaction deletion.',
      'Transfer transactions excluded from spending calculations in budget, dashboard, and trend chart.',
    ],
  },
  {
    version: '0.5.2',
    date: '2026-08-13',
    changes: [
      'Transactions tab now paginates at 100 rows — no more slow full-list render.',
      'Added rich filter panel: date (all / month+year / range), type (expense/income), amount range, hierarchical category multi-select, account multi-select, needs-review, pending.',
      'Active filter count shown on Filters button badge.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-08-12',
    changes: [
      'Plaid bank connection now works end-to-end in sandbox mode.',
      'Added "Sync transactions" button on Accounts tab — pulls up to 90 days on first sync, 2 days on subsequent.',
      'Fixed sync bug that wrote lastSync to the wrong Firebase path.',
      'Transaction sync now deduplicates by Plaid Item (one API call per institution, not per account).',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-05',
    changes: [
      'Category taxonomy enriched: leaf names now describe what (not budget type), with isFixed/isAnnual as data attributes.',
      'Added new categories: Delivery, Gym & Fitness, Suscripciones, Colegio & Útiles.',
      'Transactions now store group, isFixed, and isAnnual fields (run scripts/enrich-transactions.js to migrate history).',
      'Category picker upgraded to two-step flow: pick group → pick leaf category.',
      'Transactions flagged as uncategorized or low-confidence AI show a ⚠ needs-review dot and "Needs review" filter.',
      'Cloudflare Worker /categorize endpoint now returns confidence score and alternatives, enabling AI-assisted categorization.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-05',
    changes: [
      'Replaced generic categories with the family\'s actual taxonomy (auto, casa, salidas, kids, travel, etc.).',
      'Added Tiller CSV importer in Settings — imports ~8,000 transactions with automatic deduplication.',
      'Category name map links Tiller category names directly to internal IDs.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-08-05',
    changes: [
      'Deploy to GitHub Pages via GitHub Actions on every push to main.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-05',
    changes: [
      'Fixed Google sign-in (switched back to popup; redirect was unnecessary after CSS hidden bug was resolved).',
      'Added Vitest unit tests for rule engine, formatters, and category utilities.',
      'Added Playwright E2E tests covering the auth shell and PWA metadata.',
      'Added GitHub Actions CI workflow running unit tests, build, and E2E on every PR.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-31',
    changes: [
      'Initial project scaffold: Firebase auth, tab navigation, and shared category taxonomy.',
    ],
  },
];
