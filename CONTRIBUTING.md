# Contributing to dynamodb-toolkit

Thank you for your interest in contributing!

## Getting started

```bash
git clone --recursive https://github.com/uhop/dynamodb-toolkit.git
cd dynamodb-toolkit
npm install
```

The `--recursive` flag clones the wiki submodule under `wiki/`. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the module map and the [wiki](https://github.com/uhop/dynamodb-toolkit/wiki) for the documentation.

## Development workflow

1. Make your changes in `src/`, keeping each `.js` file's `.d.ts` sidecar in step.
2. Test: `npm test`, then `npm run test:bun`, `npm run test:deno`, and `npm run ts-test`.
3. Type check: `npm run ts-check` and `npm run js-check`.
4. Format: `npm run lint:fix`.

`npm run test:e2e` runs the end-to-end suite against DynamoDB Local and needs Docker.

## Code style

- ES modules (`import`/`export`) in source, shipped as-is with no build step.
- Formatted with Prettier &mdash; see `.prettierrc` for settings.
- Zero runtime dependencies. Do not add packages to `dependencies`.
- Types and their documentation live in the `.d.ts` sidecars, not in the `.js` files.

## License

This project is distributed under the [BSD-3-Clause license](./LICENSE).
External contributions are accepted only under licenses compatible with
BSD-3-Clause; submissions under fundamentally incompatible licenses cannot
be merged.

## AI agents

If you are an AI coding agent, see [AGENTS.md](./AGENTS.md) for detailed project conventions, commands, and architecture.
