#!/usr/bin/env node
// dynamodb-toolkit CLI — thin wrapper over src/provisioning/.
//
// Subcommands:
//   ensure-table <adapter-module>   Plan + optionally execute ADD-only provisioning.
//   verify-table <adapter-module>   Diff declaration vs live table.
//
// The <adapter-module> argument is a path (absolute or relative) to an
// ESM JS module that default-exports an Adapter instance (or exports a
// named `adapter` / `default`). The module is imported as-is — the CLI
// does no transpilation.
//
// Flags:
//   --yes                 ensure-table: actually execute the plan. Default is plan-only.
//   --strict              verify-table: exit non-zero on any diff.
//   --require-descriptor  verify-table: missing descriptor becomes an error.
//   --endpoint <url>      Override the adapter's client endpoint (useful for local / offline).
//   --region <name>       Set AWS region for a CLI-constructed client override.
//   --json                Output as JSON instead of human-readable lines.
//   --help / -h           Show usage.

import {pathToFileURL} from 'node:url';
import {resolve as resolvePath} from 'node:path';

const USAGE = `Usage: dynamodb-toolkit <command> <adapter-module> [flags]

Commands:
  ensure-table <adapter-module>   Plan + optionally execute ADD-only provisioning.
  verify-table <adapter-module>   Diff declaration vs live table.

Flags:
  --yes                   ensure-table: execute the plan (default: plan-only).
  --strict                verify-table: exit non-zero on any diff.
  --require-descriptor    verify-table: missing descriptor is an error.
  --json                  Emit JSON instead of human-readable output.
  -h / --help             Show this message.

<adapter-module> must be an ESM path exporting an Adapter instance as
either its default export or a named \`adapter\` export.`;

const parseArgs = argv => {
  const out = {flags: {}, positional: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') out.flags.yes = true;
    else if (a === '--strict') out.flags.strict = true;
    else if (a === '--require-descriptor') out.flags.requireDescriptor = true;
    else if (a === '--json') out.flags.json = true;
    else if (a === '-h' || a === '--help') out.flags.help = true;
    else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      out.positional.push(a);
    }
  }
  return out;
};

const loadAdapter = async modulePath => {
  const absPath = resolvePath(process.cwd(), modulePath);
  const url = pathToFileURL(absPath).href;
  const mod = await import(url);
  const candidate = mod.adapter ?? mod.default;
  if (!candidate) {
    throw new Error(`Adapter module '${modulePath}' must export an Adapter instance as 'adapter' or the default export.`);
  }
  if (!candidate.client || !candidate.table || !candidate.keyFields) {
    throw new Error(`Adapter module '${modulePath}' exported an object but it does not look like an Adapter (missing client/table/keyFields).`);
  }
  return candidate;
};

const runEnsureTable = async (adapter, flags) => {
  const {ensureTable} = await import('../src/provisioning/index.js');
  const result = await ensureTable(adapter, {yes: flags.yes});
  const plan = result.plan || result;
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  for (const line of plan.summary) process.stdout.write(line + '\n');
  if (flags.yes) {
    process.stdout.write(`\nExecuted ${result.executed?.length || 0} step(s): ${(result.executed || []).join(', ') || '(none)'}\n`);
    if (result.descriptorWritten) process.stdout.write('Descriptor record written.\n');
  } else if (plan.steps.some(s => s.action === 'create' || s.action === 'add-gsi')) {
    process.stdout.write('\nRe-run with --yes to apply.\n');
  }
  return 0;
};

const runVerifyTable = async (adapter, flags) => {
  const {verifyTable} = await import('../src/provisioning/index.js');
  const result = await verifyTable(adapter, {
    requireDescriptor: flags.requireDescriptor
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    if (result.ok && result.diffs.length === 0) {
      process.stdout.write(`Table matches declaration — no diffs.\n`);
    } else {
      for (const d of result.diffs) {
        process.stdout.write(`[${d.severity}] ${d.path}: expected ${JSON.stringify(d.expected)}, actual ${JSON.stringify(d.actual)}\n`);
      }
    }
  }
  if (flags.strict && result.diffs.length > 0) return 1;
  if (!result.ok) return 1;
  return 0;
};

const main = async () => {
  const {flags, positional} = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length === 0) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  const [command, modulePath] = positional;
  if (!command || !modulePath) {
    process.stderr.write(USAGE + '\n');
    return 2;
  }
  const adapter = await loadAdapter(modulePath);
  if (command === 'ensure-table') return runEnsureTable(adapter, flags);
  if (command === 'verify-table') return runVerifyTable(adapter, flags);
  process.stderr.write(`Unknown command: ${command}\n\n${USAGE}\n`);
  return 2;
};

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(`dynamodb-toolkit: ${err?.message || err}\n`);
    if (err?.diffs) {
      process.stderr.write(JSON.stringify(err.diffs, null, 2) + '\n');
    }
    process.exit(1);
  }
);
