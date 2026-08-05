# Hearth Finance — Claude Code Rules

## Versioning (ALWAYS do this before committing user-visible changes)

1. **Read the current version first**: `CHANGELOG[0].version` in `src/shared/changelog.js` is the source of truth. `package.json` `"version"` must always match it.

2. **Bump the version** using semver:
   - Patch (`x.x.+1`): bug fixes, copy tweaks, layout fixes
   - Minor (`x.+1.0`): new features or significant UX changes
   - Major (`+1.0.0`): breaking changes or full redesigns

3. **Add a new entry at the TOP of `CHANGELOG`** in `src/shared/changelog.js`:
   ```js
   {
     version: 'X.Y.Z',
     date:    'YYYY-MM-DD',  // today's actual date — never copy-paste a prior date
     changes: [
       'Short user-facing sentence describing each change.',
     ],
   },
   ```
   The array must stay **newest-first**. A lower version number must never have a newer date than a higher version number above it.

4. **Update `package.json`** `"version"` to match the new semver.

5. **Do both in the same commit** as the code changes. Never ship code without bumping the version.

## Brief document

The file `docs/brief.md` (if it exists) describes the product for new contributors. Update it whenever a new major feature is added or a section of the product changes significantly.

## Commit discipline

- One logical change per commit. Don't batch unrelated fixes.
- Commit message format: `<scope>: <short imperative description>` (e.g. `feed: collapse league filter by default`).
- Always run `npm run build` and `npm run build:admin` before committing — a build failure means the commit is broken.
