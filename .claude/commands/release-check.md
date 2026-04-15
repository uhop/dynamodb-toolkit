---
description: Pre-release verification checklist for dynamodb-toolkit
---

# Release Check

Run through this checklist before publishing a new version.

## Steps

1. Check that `ARCHITECTURE.md` reflects any structural changes.
2. Check that `AGENTS.md` is up to date with any rule or workflow changes.
3. Check that `.windsurfrules`, `.clinerules`, `.cursorrules` are byte-identical and in sync with `AGENTS.md`.
4. Check that `wiki/Home.md` links to all relevant wiki pages and that any new utility/method has its own wiki page (`Utility:-<name>.md` or `Adapter:-<family>.md`).
5. Check that `llms.txt` and `llms-full.txt` are up to date with API changes.
6. Verify `package.json`:
   - `files` array still covers the published surface (`/*.js`, `/utils`, `/helpers` — do not ship `tests/`, `wiki/`, or AI-rules files).
   - `version` reflects the bump.
   - `description`, `keywords`, `author`, `license`, and repo URLs are accurate.
7. Verify `index.js` still exports the right entry (`module.exports = require('./Adapter.js')`).
8. Update release history in `README.md` ("# Versions" section) with a one-line note for the new version.
9. Bump `version` in `package.json`.
10. Run `npm install` to regenerate `package-lock.json`.
11. Boot the test server and run the Postman collection against it (skip if doc-only):
    - `HOST=localhost PORT=3000 npm start &`
    - Run the collection in Postman or `newman run "tests/Unit test dynamodb-toolkit.postman_collection.json"`.
    - Stop the server.
12. Dry-run publish to verify package contents: `npm pack --dry-run`.
13. Confirm the dry-run tarball does not contain `tests/`, `wiki/`, `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `.windsurf*`, `.cursor*`, `.cline*`, `.claude/`, `.github/`, `prompts/`, or `llms*.txt`. The library should ship as just `index.js`, `Adapter.js`, `utils/`, `helpers/`, `package.json`, `README.md` (plus whatever `npm` adds automatically).
