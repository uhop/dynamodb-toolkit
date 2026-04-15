---
description: Update AI-facing documentation files after API or architecture changes
---

# AI Documentation Update

Update all AI-facing files after changes to the public API, the `Adapter`/`KoaAdapter` classes, or the standalone utilities.

## Steps

1. Read `index.js` and `Adapter.js` to identify the current public API surface.
2. Read `helpers/KoaAdapter.js` to confirm the HTTP wrapper is unchanged.
3. Skim `utils/` (one file per export) for new or removed utilities.
4. Read `AGENTS.md` and `ARCHITECTURE.md` for current state.
5. Update `llms.txt`:
   - Ensure the API section matches the current Adapter/KoaAdapter/utility surface.
   - Update common patterns if new features were added (especially patching, indirect indices, mass operations).
   - Keep it concise — for quick LLM consumption.
6. Update `llms-full.txt`:
   - Full reference for Adapter, KoaAdapter, and every standalone utility.
   - Note semantics that bit users in the past (DocumentClient vs raw DynamoDB, `Raw`/`DbRaw` markers, `__delete`/`__separator`, `indirectIndices`).
7. Update `ARCHITECTURE.md` if project structure or module dependencies changed.
8. Update `AGENTS.md` if critical rules, commands, or architecture quick reference changed.
9. Sync `.windsurfrules`, `.cursorrules`, `.clinerules` if `AGENTS.md` critical rules or code style changed (these three files should be byte-identical copies).
10. Update `wiki/Home.md` if the overview needs to reflect new features. (`wiki/` is a separate git submodule — commit there separately.)
11. Review `prompts/doc.md` for any needed updates to documentation generation guidelines.
12. Track progress with the todo list and provide a summary when done.
