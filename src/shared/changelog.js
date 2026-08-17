export const CHANGELOG = [
  {
    version: '1.2.0',
    date:    '2026-08-16',
    changes: [
      'Dashboard: redesigned with dark gradient net-worth hero, 3 mini metric cards (Spent, vs Budget, vs Last Year), category spend-vs-budget progress bars with pace ticks, alert banner for over-budget categories, and Review CTA.',
      'Accounts: redesigned with dark gradient hero (Assets / Debt / Net Worth), institution groups with sync-status dots, and Settings section (partner sharing, import/export, sign-out) embedded at the bottom.',
      'Insights: new tab (Screen 6) — AI-generated spending alerts sorted by severity: over-budget (red), on-pace-to-overspend (amber), anomalies vs last month (purple), subscription overlaps (blue), good-news under-pace (green).',
      'Nav: 5th slot changed from Automation to Insights (sparkle icon); Automation remains accessible via direct link.',
      'Desktop sidebar: dark (#0f1623) with white text and green active-state accent — matches design brief.',
    ],
  },
  {
    version: '1.1.0',
    date:    '2026-08-16',
    changes: [
      'Automation tab: full rules management screen — rules grouped by category, semantic "when → then" cards, active/pause toggle per rule, add/edit modal with live preview.',
      'Dashboard: Monthly/Annual view toggle — annual view shows YTD spend vs annual budget with pace bar indicating how much of the year has elapsed.',
      'Budgets: Monthly/Annual view toggle — annual view shows all categories annualized (monthly × 12), with monthly goals and annual goals in separate sections, each with a pace tick.',
      'Nav: replaced generic emoji icons with custom SVG icons across all five tabs.',
      'Brand: custom hearth icon (pillars + arch + flame) replaces the generic house — applied to favicon, auth screen, and sidebar nav.',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-08-14',
    changes: [
      'Transactions: full visual redesign — colored category icon backgrounds, bolder merchant names, cleaner amount/date layout, and a pending badge.',
      'Transactions: needs-review rows now surface the AI-suggested category inline with one-tap Confirm or Change buttons.',
      'Transactions: after confirming or changing a category, a prompt offers to create a permanent matching rule in one click.',
      'Filters: new Source filter — quickly show only AI-categorized, rule-categorized, manually set, imported (Tiller), or Plaid transactions.',
      'Filters: account list now scrolls instead of expanding to multiple rows.',
      'Filters: redesigned pill chips, segment controls, and panel layout for a cleaner look on both mobile and desktop.',
    ],
  },
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
