# Hearth Finance — Design Reference

This document is the single source of truth for architecture decisions, UI patterns, and feature design. Update it whenever a major feature changes.

---

## Stack & Entry Points

| Layer | Technology |
|---|---|
| Frontend | Vite + vanilla ES modules, no framework |
| Auth / DB | Firebase Auth + Realtime Database |
| Bank sync | Plaid (via Cloudflare Worker) |
| AI categorize | Google Gemini (via Cloudflare Worker) |
| Deploy | GitHub Pages (dist/), Actions on push |
| CSS | Single file: `src/app/styles.css` |

**Key files:**
- `src/app/app.js` — shell, tab routing, auth, changelog popup
- `src/app/transactions.js` — transactions list, toolbar, filters, duplicate review
- `src/app/budgets.js` — cascading budget tiles (3 levels)
- `src/app/automation.js` — rules category tiles (2 levels) + recurring transactions
- `src/app/accounts.js` — account list, sync, WORKER_URL defined here
- `src/app/settings.js` — partner sharing, about, sign out
- `src/shared/rules.js` — `evaluateRules`, `matchesRule`, `buildRule`
- `src/shared/categories.js` — full CATEGORIES taxonomy (groups + leaves)
- `src/shared/changelog.js` — CHANGELOG array, source of truth for version

**CLAUDE.md rules (always apply):**
- Bump `src/shared/changelog.js` + `package.json` in every commit with user-visible changes
- Run `npm run build` before committing
- Commit format: `<scope>: <short imperative>`

---

## Navigation

**Mobile:** bottom nav bar with 7 tabs  
**Desktop (≥768px):** left sidebar (196px) with the same 7 tabs

Tabs: `dashboard` · `transactions` · `budgets` · `accounts` · `insights` · `automation` (labelled "Rules") · `settings`

Tab routing is in `app.js` — the `TABS` array and `renderers` map. Each tab renderer is called with the container element and re-renders from scratch on tab switch.

**Firebase listeners accumulate** across tab visits — always guard with element-existence checks (e.g. `if (!container.querySelector('#id')) return`) before adding new listeners.

---

## Color System (Dark Desktop Theme)

Desktop uses `:root` overrides inside `@media (min-width: 768px)`:

```css
--bg:      #0c1017   /* page background */
--surface: #161c27   /* cards, toolbar, sidebar */
--card:    #1e2636   /* elevated cards */
--border:  rgba(255,255,255,.08)
--text:    #e2e8f0
--muted:   #64748b
--faint:   #334155   /* tracks, empty fills */
--brand:   #16a34a   /* green primary */
--brand-l: rgba(22,163,74,.22)
```

Mobile uses the light theme (CSS variable defaults — mostly white/near-white surfaces).

**Auth screen** explicitly overrides back to light vars even on desktop — it must always look light.

`tintColor(hex)` in transactions.js:
- Desktop: `hex + '28'` (16% alpha overlay) — dark bg + tint = subtle colored background
- Mobile: lightens hex toward white at 88% — gives a pastel on light bg

---

## Transactions Tab

### Toolbar layout

```
Mobile (flex-wrap):
  Row 1: [ 🔍 Search transactions…          ]  ← flex-basis:100%
  Row 2: [ Filter{N} ]  ·············  [ ↑ Import ] [ ↓ Export ]

Desktop (no-wrap):
  [ Transactions ] [ 🔍 search fills ……… ] [ Filter{N} ] [ ↑ Import ] [ ↓ Export ]
```

Key CSS: `.toolbar { flex-wrap: wrap }`, `#txn-search { order:1; flex: 1 1 100% }` on mobile → overridden to `flex: 1 1 auto; order:0` on `@media (min-width:768px)`.

Filter count badge: `<span class="filter-badge hidden" id="filter-active-count">` — toggle `.hidden` class in JS (not `style.display`).

### Transaction row structure

```
.txn-item
  .txn-row[data-id]  ← .needs-review / .is-uncategorized state classes
    button.txn-icon.cat-btn   ← colored emoji icon, opens category picker on tap
    .txn-meta                 ← flex:1; min-width:0
      span.txn-desc           ← display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap
      span.txn-sub            ← display:flex; gap:4px; overflow:hidden — "Aug 23 · Bancomer [P]"
    .txn-right                ← flex-shrink:0
      span.txn-amount
      span.txn-pending-badge
  .sug-strip[.ai|.heuristic|.warn]   ← suggestion row, sibling of .txn-row
```

**Critical**: `.txn-desc` must have `display:block` for `text-overflow:ellipsis` to work (inline spans ignore it). `.txn-meta` has `min-width:0` so flex items can shrink below content width.

### Suggestion strip (tiered categorization)

For `needsReview` rows that are uncategorized, the app tries suggestions in order:

| Tier | Source | How | Badge |
|---|---|---|---|
| 1 | Rules | `evaluateRules(txn, allRulesSnapshot)` — synchronous, client-side | `Rule` (green) |
| 2 | Heuristics | 18-pattern keyword regex table in `suggestCategory()` — synchronous, client-side | `Suggested` (indigo) |
| 3 | AI Worker | `fetch(WORKER_URL + '/categorize', ...)` — async; `_aiSugCache` map prevents double-calls | `AI suggest` (amber) |

If Tier 3 hasn't returned yet, shows "Analyzing…" placeholder. When the Worker responds, `updateSugStrip(txnId, sug)` patches the DOM in-place and re-wires Confirm/Change buttons.

`allRulesSnapshot` is a module-level variable kept fresh by a `dbListen('rules/${uid}', ...)` listener inside `renderTransactions`.

### Duplicate review overlay

Built as a `.sheet-overlay` + `.sheet` containing two `.dup-card` elements side-by-side in a 2-column grid.

`.dup-card` has: `.dup-card-name` (merchant, ellipsis), `.dup-card-meta` (date · category), `.dup-card-amt` (amount, large), `.dup-card-acct` (account, small muted).

Actions: **Keep A · Delete B** / **Keep B · Delete A** / **Skip (keep both)**. Skip writes `dupOk: [idB]` on txn A and `dupOk: [idA]` on txn B — they're excluded from future `findDuplicates` scans.

`_dupReviewOverlay` module-level guard prevents stacking overlays. Firebase listener guard (`if (_dupReviewOverlay) return`) prevents banner refresh while review is open.

---

## Budget Tab — Cascading Tiles (3 levels)

### State
```js
let _budgetLevel   = 1;   // 1|2|3
let _budgetGroupId = null; // root category id (e.g. 'casa')
let _budgetCatId   = null; // leaf category id (e.g. 'utilities')
```

### Level 1 — Group tiles
Grid of `.bud-group-tile` cards (one per root category with budget/spend).  
Each tile: icon · name · cat count · spent/budget · mini bar · pct.  
Status class (`good`/`warn`/`over`/`zero`) drives left accent bar color + amount color.  
Click → sets `_budgetLevel=2`, `_budgetGroupId=id`, re-renders.

### Level 2 — Category tiles
Grid of `.bud-cat-tile` cards within the selected group.  
Each tile: icon box (colored with category color tint) · status dot · name · spent/budget · mini bar · pct.  
Click → sets `_budgetLevel=3`, `_budgetCatId=id`, re-renders.

### Level 3 — Category detail
Full-width panel: large icon header with spent/budget · full progress bar with pace tick · 4 stat cards (this month / transactions / largest / average) · recent transactions list (up to 8 rows).  
Recent txns pulled from `Object.values(txns).filter(t => t.category === catId && t.date.startsWith(prefix))`.

### Breadcrumb navigation
`.bud-breadcrumb` built by `renderBudgetNav`. Clicking a level link resets state and re-renders.

### Annual view
`renderBudgetAnnual` / `buildAnnualSection` — completely separate code path, untouched by tile redesign. Only `renderBudgetList` (monthly view) uses the cascading tile system.

---

## Rules Tab — Cascading Tiles (2 levels)

### State
`selectedCatId` — module-level variable in `automation.js`.

### Level 1 — Category tiles
`.auto-tiles-grid` grid of `.auto-cat-tile` cards (one per target category that has rules).  
Each tile: icon · name · rule count · field badges (desc/merchant/account/amount/source — color coded).  
Click → sets `selectedCatId`, re-renders.

### Level 2 — Field-grouped rules
`.auto-cat-detail-hdr` with back button + category name + "Add rule" button.  
Rules grouped into `.auto-field-group` sections by `r.matchField` (description / merchant / account / amount / source).  
Each rule shows: field pill → op → pattern (monospace) · priority · edit · delete · toggle (on/off).  
Toggle updates `rules/${uid}/${id}/enabled` in Firebase.

Back button: sets `selectedCatId=null`, re-renders to tile grid.

---

## Accounts Tab

### Sync
- **No automatic daily sync** — sync is always manual via the Sync button.
- `#sync-range` select: presets (2d/30d/90d/6mo/1yr) or "Custom range…" which reveals `#sync-from` + `#sync-to` date inputs.
- `syncTransactions(uid)` reads the select and calls `WORKER_URL + '/sync'` with `{ startDate, endDate }`.
- `syncStatusDot(account)` returns `{ cls, label }` with the actual last-sync date formatted as "synced Aug 23, 2026".

### Account list
Grouped by institution. Each row: sync status dot · account name (alias preferred over Plaid name) · balance.  
Alias edit: ✎ button writes `accounts/${uid}/${acctId}/alias`.

### Plaid linking
`WORKER_URL` defined at top of accounts.js (`import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787'`).  
Plaid Link flow: `/plaid/link-token` → Plaid.create → `onSuccess` → `/plaid/exchange-token`.

---

## Settings Tab

Three sections only:
1. **Partner Sharing** — invite code generation + accept flow → writes `users/${uid}/partnerUid`
2. **About** — version number (from `CHANGELOG[0].version`) · "What's new →" button opens `openChangelogSheet()` (imported from accounts.js)
3. **Sign Out** — Firebase `signOut(auth)`

No import/export here (those are in Transactions toolbar).  
No rules/recurring here (those are in Automation/Rules tab).

---

## "What's New" Popup

localStorage key: `hearth-seen-version-2` (the `-2` suffix was added to force the popup for all existing users after the key name was changed).

Logic in `app.js` `onAuthStateChanged`:
```js
const lastSeen = localStorage.getItem('hearth-seen-version-2');
const current  = CHANGELOG[0].version;
if (!lastSeen || lastSeen !== current) {
  const since = lastSeen ?? (CHANGELOG[1]?.version ?? '0.0.0');
  setTimeout(() => showWhatsNew(since), 900);
}
localStorage.setItem('hearth-seen-version-2', current);
```

`showWhatsNew(sinceVersion)` filters `CHANGELOG.filter(e => gt(e.version, sinceVersion))` to show only entries newer than last seen.

---

## Partner Sharing

`getPartnerUid(uid)` resolves `users/${uid}/partnerUid`.  
Partner transactions are loaded in each tab with `dbListen('transactions/${partnerUid}', ...)`.  
Partner rows show a pill badge `[P]` (partner initial) and are read-only — category, notes, transfer flag cannot be changed.  
Partner accounts are read-only (no Reconnect/Unlink).

---

## Design Principles

| Principle | Application |
|---|---|
| **Tiles over flat lists** | Budgets and Rules both use tiles to show many items without scrolling; compact and scannable |
| **Cascading over tabs** | Drill-down within the same tab (back button/breadcrumb) rather than separate screens |
| **Status color encoding** | Green = on pace, amber = approaching limit/stale, red = over budget/error — consistent across tiles, dots, and bars |
| **Least cost first** | Category suggestions: rules (free) → heuristics (free) → AI Worker (API cost). Never call the API if client-side can answer |
| **No duplicate UI** | Each feature lives in exactly one tab. Rules/Recurring → Automation. Import/Export → Transactions. Version/Changelog → Settings |
| **Pace tick** | A thin vertical line at today's elapsed-month position on all budget bars — instant over/under-pace reading |
| **Alias over bank name** | `acctName` priority: `alias ?? accountMap.name ?? t.accountName` — user-set aliases always win |

---

## Design HTML Files

| File | Content |
|---|---|
| `docs/design-brief.html` | Original full app design brief (screens 1–6+) |
| `docs/budget-tiles-design.html` | Interactive 3-level cascading budget tiles mockup |
| `docs/rules-tiles-design.html` | Interactive 2-level cascading rules tiles mockup |

These are standalone dark-themed HTML files with no external dependencies. They include JavaScript for inter-level navigation. Open them directly in a browser.

---

## Version History Summary

| Version | Date | Highlight |
|---|---|---|
| 1.7.4 | 2026-08-24 | Cascading budget tiles, tiered suggestions, toolbar redesign |
| 1.7.3 | 2026-08-24 | Custom sync dates, rules tiles, Import/Export labels |
| 1.7.2 | 2026-08-23 | Tab cleanup, sync row presets, account aliases in transactions |
| 1.7.1 | 2026-08-21 | Recurring transactions, dark mode fixes, bulk dup dismiss |
| 1.7.0 | 2026-08-20 | Settings tab, What's new popup, skip persistence, dark desktop |
| 1.6.x | 2026-08-19–20 | Desktop sheets/modals, duplicate review, account aliases |
| 1.5.x | 2026-08-18 | Transactions filter redesign, budget compact layout |
| 1.0.0–1.4.x | 2026-08-14–17 | Full redesign pass matching design brief |
| 0.x | 2026-07–08 | Initial scaffold, Plaid, Firebase, categories, rules engine |
