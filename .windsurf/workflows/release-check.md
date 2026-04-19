---
description: Pre-release verification checklist for dynamodb-toolkit (v3)
---

# Release Check

Run through this checklist before publishing a new version. The v3 toolkit is
ESM-only, ships only `src/` in the tarball, has no build step, and is tested
on Node, Deno, and Bun.

## Steps

1. **Semver decision.** Review `git log <last-tag>..HEAD` and classify the
   diff:
   - Additive public API (new method, new option, new sub-export) → minor.
   - Behavior fix or dep bump → patch.
   - Any existing signature, return shape, or exported name changed → major.
     Record the chosen bump before touching anything else.
2. **AGENTS.md** is up to date with any rule, script, or workflow changes
   (cross-runtime scripts, new checks, new testing conventions).
3. **AI rule files** (`.windsurfrules`, `.clinerules`, `.cursorrules`) are
   byte-identical to `AGENTS.md`:
   ```
   diff -q AGENTS.md .cursorrules && diff -q AGENTS.md .windsurfrules && diff -q AGENTS.md .clinerules
   ```
   If they drift, run `/sync-ai-rules` (or `cp AGENTS.md .cursorrules .windsurfrules .clinerules`).
4. **Wiki** (submodule at `wiki/`): every new public method, option, or
   sub-export reachable from user code has coverage on the relevant page. New
   pages follow the `Adapter:-<X>.md` / `Expressions:-<X>.md` convention and are
   linked from `wiki/Home.md`. The `wiki/Concepts.md` glossary mentions any new
   vocabulary. Cross-cutting pages (`Batch-and-transactions.md`, `Mass-operations.md`,
   `Compatibility.md`) are updated for any change touching that surface. Wiki
   links use Markdown (`[text](Page-Name)`) with `%3A`-encoded colons — GitHub
   wiki ignores Obsidian `[[]]`.
5. **`llms.txt` and `llms-full.txt`** are up to date with the public API
   (new options, new helpers, new sub-exports, signature changes).
6. **`package.json` verification:**
   - `version` reflects the bump chosen in step 1.
   - `files` is `["src", "llms.txt", "llms-full.txt"]`. Tarball = `src/` +
     `README.md` + `LICENSE` + `llms.txt` + `llms-full.txt` + `package.json`.
   - Top-level `main`, `module`, `types` point at `./src/index.js` / `./src/index.d.ts`
     (legacy-resolver fallback + reliable npm TS-badge detection).
   - `exports` map covers every named sub-export path with plain-string values
     (`"./batch": "./src/batch/index.js"`). TypeScript picks up sibling `.d.ts`
     automatically under `moduleResolution: node16 | nodenext | bundler` — no
     `{types, default}` split needed. A final `"./*": "./src/*"` entry exposes
     internal files for power-user escape-hatch access.
   - `description` and `keywords` reflect the current surface (keywords capped
     at 20).
   - `llms` and `llmsFull` top-level URL fields point at the raw GitHub files.
   - `peerDependencies` covers the AWS SDK v3 packages; `dependencies` stays
     empty (zero-dep policy).
   - `engines.node` is `>=20` (current threshold — `require(esm)` ships unflagged
     on 20.19+ and 22.12+).
   - `repository`, `bugs`, `homepage`, `author`, `funding`, `license` are accurate.
7. **LICENSE** file exists at the repo root and contains the current year.
   (`license: BSD-3-Clause` in `package.json` requires the corresponding
   license text to ship.)
8. **Regenerate the lockfile** so it tracks the new version + any dep bumps:
   ```
   npm install
   ```
9. **Full check matrix** — all must pass cleanly:
   ```
   npm run lint
   npm run ts-check
   npm run js-check
   npm test                # Node; includes `.cjs` smoke test
   npm run test:deno       # Deno; skips .cjs per config
   npm run test:bun        # Bun; skips .cjs per config
   ```
   Cross-runtime test counts match on `.js` / `.mjs`; Node additionally runs
   the `.cjs` smoke test (6 tests / 24 asserts delta is expected).
10. **Type test (manual).** `npm run ts-test` runs `tests/test-typed.ts` on Node
    22+ via tape-six's native TS support. Verifies the consumer-facing typings
    still compile and execute.
11. **End-to-end (Docker-gated).** If Docker is available, `npm run test:e2e`
    exercises the Adapter + REST handler against DynamoDB Local. Skip with a
    note in the release summary when Docker isn't on the release machine.
12. **Dry-run publish** to verify tarball contents:
    ```
    npm pack --dry-run
    ```
    Expected: ~111 files — `src/` (106 files), plus `README.md`, `LICENSE`,
    `llms.txt`, `llms-full.txt`, `package.json`. Confirm NONE of these appear:
    `tests/`, `wiki/`, `dev-docs/`, `.github/`, `.claude/`, `.windsurf*`, `.cursor*`,
    `.cline*`, `AGENTS.md`, `CLAUDE.md`, `prompts/`, `ARCHITECTURE.md`.
13. **Stop and report** — surface:
    - Chosen version bump and the diff summary since the last tag.
    - Test / lint / pack-dry-run results across all runtimes.
    - Any skipped step (e.g., e2e without Docker).
    - Any unresolved issue flagged during the walkthrough.
      Do **not** commit, tag, or publish without explicit user confirmation.
