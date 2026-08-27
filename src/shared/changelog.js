export const CHANGELOG = [
  {
    version: '1.11.5',
    date:    '2026-08-26',
    changes: [
      'Transactions: "✦ Ask AI" button in the detail panel lets you request an AI suggestion for any transaction, even already-categorized ones — accept it or keep the current category.',
    ],
  },
  {
    version: '1.11.4',
    date:    '2026-08-26',
    changes: [
      'Transactions: detail panel now shows the full category lineage with a Change button — works for any transaction regardless of how it was categorized.',
      'Transactions: tap the category name in a suggestion strip to expand the full parent › child path.',
    ],
  },
  {
    version: '1.11.3',
    date:    '2026-08-26',
    changes: [
      'Transactions: tap any transaction to expand details, then delete it with a confirmation step.',
    ],
  },
  {
    version: '1.11.2',
    date:    '2026-08-26',
    changes: [
      'AI categorization: similar previously-confirmed transactions are now sent as examples so the AI can learn from your history (e.g. Zelle payments to the same person).',
      'AI categorization: daily sync now passes your learned merchant rules and category descriptions to the AI — new transactions get the same context as the browser.',
    ],
  },
  {
    version: '1.11.1',
    date:    '2026-08-26',
    changes: [
      'Accounts: reconnect now actually exchanges the token, clears the error status, and triggers an immediate backfill sync.',
      'Accounts: accounts no longer stay red after reconnect (error status was not being cleared on exchange-token).',
      'Sync: daily cron no longer skips all remaining users when one fails — each user is now isolated.',
      'Sync: after an error period, the sync backfills from the last successful date instead of only the past 2 days.',
      'Sync: accounts with missing KV tokens now show a red error dot with "please reconnect" instead of silently staying stale.',
    ],
  },
  {
    version: '1.11.0',
    date:    '2026-08-26',
    changes: [
      'Categories: full management screen — hide/show any category, add custom leaf categories under any group, delete custom ones.',
      'Categories: all 44 built-in categories now have default AI descriptions; your customizations override the defaults.',
      'AI categorization: built-in descriptions now sent automatically to the AI for all categories, even ones you haven\'t customized yet.',
      'Accounts: fixed red box appearing behind the sync-date label (CSS scoping bug).',
      'CI: unit tests (vitest) and E2E shell tests (Playwright) now run on every push before deploying.',
      'Bug fix: duplicate suppression (dupOk) was silently failing for the object storage format; now correctly uses Object.keys instead of Object.values.',
    ],
  },
  {
    version: '1.10.0',
    date:    '2026-08-26',
    changes: [
      'Budgets: all non-hidden categories now show in budget tiles, not just ones with a budget or spend.',
      'Accounts: each account row now shows last sync date with a color-coded status indicator.',
      'Settings: new Categories section lets you add AI-guidance descriptions per category, saved to Firebase and sent to the AI when categorizing.',
    ],
  },
  {
    version: '1.9.7',
    date:    '2026-08-26',
    changes: [
      'Transactions: AI suggestions re-enabled as Tier 4 — fires only when rules, keywords, and stored Firebase suggestions all miss. Result is saved to Firebase so the AI call never repeats for the same transaction.',
    ],
  },
  {
    version: '1.9.6',
    date:    '2026-08-26',
    changes: [
      'Transactions: ACH Electronic debit, ACH debit, and scheduled online payments now auto-suggest Transfer category via Tier 2 keyword matching.',
    ],
  },
  {
    version: '1.9.5',
    date:    '2026-08-26',
    changes: [
      'Transactions: stored Firebase recommendations now reliably appear on uncategorized rows — suggestions are preloaded before the first render so they surface synchronously, eliminating all listener/render race conditions.',
    ],
  },
  {
    version: '1.9.4',
    date:    '2026-08-25',
    changes: [
      'Transactions: Firebase recommendations now reliably appear on uncategorized rows — fixed a race condition where the suggestions listener populated the cache before the DOM existed, causing stored recommendations to be silently skipped.',
    ],
  },
  {
    version: '1.9.3',
    date:    '2026-08-25',
    changes: [
      'Transactions: uncategorized rows now show "Uncategorized" immediately and update to a suggestion as soon as the stored recommendation is found in Firebase — no more stuck "Analyzing…" spinner.',
      'Transactions: AI / Worker calls disabled; recommendations come exclusively from pre-loaded batch-script suggestions.',
    ],
  },
  {
    version: '1.9.2',
    date:    '2026-08-25',
    changes: [
      'Transactions: fixed race condition where Firebase suggestions (from batch script) didn\'t surface on first page load — suggestions are now pre-loaded before the first render.',
      'Duplicates: skip count now reflects all transitive pairs — if A, B, C are all duplicates of each other, all three pairs are shown upfront instead of revealing them one round at a time.',
    ],
  },
  {
    version: '1.9.1',
    date:    '2026-08-25',
    changes: [
      'Transactions: Firebase suggestions (from batch script or external writes) now surface immediately, even when a transaction was stuck in "Analyzing…".',
      'Duplicates: skip button now closes the modal when the last pair is skipped, rather than showing an intermediate "All reviewed" screen.',
      'Duplicates: fixed duplicate card background appearing dark (black) in light mode.',
      'Duplicates: skip now uses a safer Firebase write path that avoids silent array serialization failures.',
    ],
  },
  {
    version: '1.9.0',
    date:    '2026-08-25',
    changes: [
      'Transactions: confirming a category suggestion now saves a learned merchant rule — future transactions from the same merchant are categorized instantly, without AI.',
      'Transactions: AI suggestion strips now show "Learned" when a confirmed merchant rule is the source.',
      'AI categorization: the Worker now receives your 12 most recent manually-confirmed transactions as few-shot examples, improving accuracy for familiar merchants.',
      'AI categorization: Gemini 429 quota errors now degrade gracefully — the Worker returns no suggestion instead of an error, and the batch script saves partial results and exits cleanly.',
      'Batch script: added Tier 0.5 (learned merchant rules from Firebase) — these fire before keyword heuristics and have 100% confidence.',
      'Batch script: added ~60 US merchant patterns covering airlines, restaurants, parks, shopping, health, and home improvement.',
    ],
  },
  {
    version: '1.8.2',
    date:    '2026-08-25',
    changes: [
      'Transactions: skipping a duplicate is now pair-scoped — it only excludes that specific A↔B pair, so transaction A can still be matched with C in the future.',
      'Transactions: "Keep A / Keep B" now correctly removes the deleted transaction from the transaction list immediately.',
      'Transactions: pending → settled Plaid duplicates are auto-dismissed on banner load — the pending version is hidden when a matching settled transaction exists within 5 days.',
      'Transactions: duplicate review shows a warning when one side is a pending transaction, recommending the settled version.',
    ],
  },
  {
    version: '1.8.1',
    date:    '2026-08-25',
    changes: [
      'Transactions: skipping a duplicate now permanently marks both transactions as reviewed — they will never re-pair with any other transaction, fixing the "same duplicates keep appearing" loop.',
    ],
  },
  {
    version: '1.8.0',
    date:    '2026-08-25',
    changes: [
      'Transactions: confirmed suggestions no longer reappear after refresh — manually confirmed category is permanent.',
      'Transactions: AI "Analyzing…" now times out after 15 seconds and falls back to a manual Categorize button instead of spinning forever.',
      'Transactions: skipped duplicate pairs now stay skipped — fixed a Firebase array serialization issue that caused the skip to be ignored on re-check.',
      'Accounts: merge sheet no longer shows horizontal scrollbars; transaction preview text wraps cleanly.',
    ],
  },
  {
    version: '1.7.9',
    date:    '2026-08-24',
    changes: [
      'Transactions: AI suggestions no longer get stuck "Analyzing…" when the Worker returns an error — correctly falls back to "Categorize →" button.',
      'Transactions: confirming a suggestion now immediately updates the icon and removes the strip — no more waiting for a full refresh.',
      'Transactions: duplicate pairs you skipped no longer reappear after closing the review.',
      'Transactions: AI Worker prompt now includes date, bank account, and Plaid category in the context sent to Gemini for better accuracy.',
      'Accounts: "Last 10 txns" button shows recent transactions for each merge pair so you can verify before merging.',
      'Accounts: "Not same" button permanently dismisses a merge suggestion so it never reappears.',
    ],
  },
  {
    version: '1.7.8',
    date:    '2026-08-24',
    changes: [
      'Transactions: "Analyzing…" no longer gets stuck — failed or slow Worker calls resolve correctly and show a manual Categorize button instead.',
      'Transactions: confirming a suggestion now correctly saves the category (was only marking needsReview=false before).',
      'Transactions: suggestion strip now shows the full category path (e.g. "Salidas › Restaurante") so the hierarchy is visible.',
      'Accounts: duplicate merge no longer matches Plaid account names against their own aliases — only the original bank name is used for comparison.',
    ],
  },
  {
    version: '1.7.7',
    date:    '2026-08-24',
    changes: [
      'Transactions: AI category suggestions are now saved to Firebase — no re-analysis needed when you reload or return to the tab.',
      'Accounts: "Merge duplicate accounts" rows now show account names and Merge button on separate lines — no more button overlap.',
      'Budgets: annual view now has ✎ edit buttons on group and category tiles. All edits accept an annual amount and prorate across categories (÷ 12 saved as monthly).',
    ],
  },
  {
    version: '1.7.6',
    date:    '2026-08-24',
    changes: [
      'Budgets: annual view now uses the same 3-level cascading tiles as monthly — group → category → detail with YTD stats and projected end-of-year.',
      'Budgets: edit button (✎) on every group and category tile — set a group total and it prorates proportionally across all categories in that group.',
    ],
  },
  {
    version: '1.7.5',
    date:    '2026-08-24',
    changes: [
      'Transactions: category suggestions no longer show "No Category" — if no valid match is found after rules, heuristics, and AI, the row requires manual categorization instead.',
      'Transactions: "Transfer" keyword now correctly triggers a Transfer category suggestion.',
      'Accounts: "Merge duplicate accounts" sheet redesigned — clearer two-column layout with labeled bank/import columns.',
    ],
  },
  {
    version: '1.7.4',
    date:    '2026-08-24',
    changes: [
      'Budgets: redesigned as cascading tiles — click a group tile to see categories, click a category tile to see transactions and stats.',
      'Transactions: tiered category suggestions for uncategorized rows — tries rules first, then keyword heuristics, then AI (Worker). Shows source badge (Rule / Suggested / AI).',
      'Transactions: toolbar redesigned — search bar fills full width on mobile (own row), filter and Import/Export on second row; single clean row on desktop.',
      'Transactions: duplicate review cards now show properly styled name, date/category meta, amount, and account in side-by-side layout.',
      'Transactions: long merchant descriptions no longer overflow or overlap on mobile (display:block fix).',
    ],
  },
  {
    version: '1.7.3',
    date:    '2026-08-24',
    changes: [
      'Accounts: custom date range sync — select "Custom range…" to pick an exact from/to date window.',
      'Accounts: last sync date now shown beside each account (e.g. "synced Aug 23, 2026").',
      'Transactions: Import and Export toolbar buttons now show labels instead of bare arrows.',
      'Transactions: search bar now fills the full available toolbar width.',
      'Transactions: account/date sub-line no longer wraps or overlaps on mobile.',
      'Rules tab: redesigned as a category tile grid — click a category to see its rules grouped by match field (description, merchant, account, amount, source).',
      'Design: budget tiles updated to interactive cascading 3-level design (group → category → detail).',
      'Design: new rules tiles design file showing cascading category → field-grouped rules view.',
    ],
  },
  {
    version: '1.7.2',
    date:    '2026-08-23',
    changes: [
      'Accounts: removed duplicate Settings section (partner, import/export, about) — those now live in Settings and Transactions tabs only.',
      'Accounts: sync row redesigned — replaced two tiny date-input boxes with a clean range preset (2 days / 30 days / 90 days / 6 months / 1 year).',
      'Transactions: Import CSV and Export CSV buttons (⬆ ⬇) added to the toolbar.',
      'Transactions: account name in each row now always shows the alias (if set) instead of the raw Plaid account name.',
      'Automation tab: label renamed to "Rules" in the nav; added as a visible nav item.',
      'Settings: Import and Export sections removed (moved to Transactions toolbar).',
    ],
  },
  {
    version: '1.7.1',
    date:    '2026-08-21',
    changes: [
      'Fix: "What\'s new" popup now appears correctly on first open after an update (localStorage key corrected).',
      'Fix: category icon backgrounds on dark desktop now use a subtle tinted overlay instead of a bright near-white color.',
      'Fix: needs-review (amber) and uncategorized (red) row backgrounds and suggestion strips now display correctly in dark mode.',
      'Settings: Rules and Recurring Transactions sections removed — both now live exclusively in the Automation tab.',
      'Automation: Recurring Transactions section added (create, enable/disable, generate for any month).',
      'Rules: rules can now match on Account name, Amount (greater/less than), and Source in addition to description and merchant.',
    ],
  },
  {
    version: '1.7.0',
    date:    '2026-08-20',
    changes: [
      'Settings tab: new gear icon tab in the nav bar for Settings — shows partner sharing, import/export, version info, and sign-out.',
      'What\'s new: on first open after an update, a sheet automatically shows the new features since your last session.',
      'Settings: "What\'s new →" button in About section opens the full version history at any time.',
      'Duplicates: tapping "Skip (keep both)" now permanently marks the pair as reviewed — they will not reappear in the duplicate banner.',
      'Desktop: content area is now dark-themed (matching the design brief) with a matching dark body background.',
    ],
  },
  {
    version: '1.6.2',
    date:    '2026-08-20',
    changes: [
      'Fix: duplicate review, changelog, and account rationalize sheets now display as a proper overlay (not appended below the page).',
      'Desktop: "Transactions" title now appears on the left side of the toolbar on desktop, matching the design brief topbar layout.',
      'Desktop: transactions and budget pages now fill the full content width (no artificial max-width centering when sidebar is already visible).',
      'Desktop: sheets and modals open as centered dialogs with a scale-in animation instead of bottom-sheets.',
    ],
  },
  {
    version: '1.6.1',
    date:    '2026-08-19',
    changes: [
      'Fix: duplicate review modal no longer stacks when "Review →" is tapped multiple times.',
      'Fix: duplicate banner now sticks to the top while scrolling through transactions.',
      'Fix: Firebase listeners from previously-visited tabs no longer crash when transactions are updated on another tab (dashboard textContent null error resolved).',
    ],
  },
  {
    version: '1.6.0',
    date:    '2026-08-19',
    changes: [
      'Fix: SVG trend chart no longer throws "Expected length, auto" console error.',
      'PWA: app is now installable to the home screen — service worker added, manifest moved to correct location with relative start_url.',
      'Transactions: automatic duplicate detection scans for same-amount + same-date + same-name pairs and shows a banner with a guided "Keep A / Keep B" review flow.',
      'Accounts: each account row now has a rename (✎) button — tap to set a display alias stored in Firebase.',
      'Accounts: "Rationalize accounts" button auto-detects Tiller import accounts that look like a linked bank account and offers to merge them.',
      'Transactions filter: merged Tiller accounts are hidden from the account filter; selecting a Plaid account pill also matches its merged Tiller transactions.',
      'Transactions filter: Plaid account pills now show the alias (if set) instead of the raw bank name.',
    ],
  },
  {
    version: '1.5.0',
    date:    '2026-08-18',
    changes: [
      'Transactions: search bar now fills the toolbar width; filter button correctly styled with brand color and active state.',
      'Transactions: filter panel sections are tighter (9×11px padding), labels smaller (0.6rem), pills and segment controls match design brief.',
      'Budgets: page is now edge-to-edge (no side padding); month nav uses compact bg-gray bar; summary row shows color-coded values (muted budget, red spent, green remaining).',
      'Budgets: pace legend strip shows today\'s pace percentage below the summary, with the same tick marker used on progress bars.',
      'Budgets: Monthly/Annual toggle active state is now dark (matches design brief) instead of green.',
      'Accounts: action buttons (Link Bank, Manual) are smaller and tighter; settings buttons use 0.78rem font and 8px border-radius.',
      'Accounts: "What\'s new" button in About opens a full changelog sheet showing version history.',
    ],
  },
  {
    version: '1.4.0',
    date:    '2026-08-17',
    changes: [
      'Transactions: rows are now compact (9×12px padding, 36px icon, tighter typography) matching the design brief exactly.',
      'Transactions: AI suggestion strip is now a clean separate row below the transaction (no longer nested inside, correct 57px left-indent alignment).',
      'Transactions: needs-review and uncategorized rows now use background-only state (removed left border, matches design brief).',
      'Budgets: category rows redesigned to compact single-line layout (icon · name · 76px bar · amount) matching the design brief.',
      'Budgets: group headers now use the design brief style (small caps, faint color, bg strip).',
      'Accounts: hero values smaller (1rem/800) and labels tighter (0.58rem) per design brief.',
      'Accounts: account rows have a boxed icon (30×30px, border-radius 8px) per design brief.',
      'Desktop sidebar: 196px wide with 7×14px nav items, 0.78rem font, green left-accent bar on active tab.',
    ],
  },
  {
    version: '1.3.0',
    date:    '2026-08-16',
    changes: [
      'Desktop sidebar: now correctly appears on the LEFT (was on right due to DOM order).',
      'Dashboard: tapping a category spend bar now navigates to Transactions pre-filtered to that category and month (category drill-down).',
      'Transactions: needs-review rows now show amber left-border + background; uncategorized rows show red left-border + background; active category filter chips appear at top when drill-down filter is active.',
      'Budgets: leaf rows redesigned — two-row layout (icon + name + amount on top, full-width progress bar with pace tick below) replacing the cramped single-row style.',
      'Design brief updated to v1.1.0: added Screen 2a (Settings in Accounts) and Screen 2b (Category drill-down mockup).',
    ],
  },
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
