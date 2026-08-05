export const CHANGELOG = [
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
