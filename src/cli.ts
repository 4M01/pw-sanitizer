#!/usr/bin/env node

import { Command } from 'commander';
import type { SanitizerConfig } from './config/types.js';
import { loadConfig } from './config/loader.js';
import { sanitize } from './index.js';
// resolveJsonModule: true in tsconfig.json enables this JSON import.
// TypeScript will type `version` as `string` from the package.json schema.
import pkg from '../package.json';

const program = new Command();

program
  .name('pw-sanitizer')
  .description(
    'Post-process Playwright HTML reports and trace files to redact secrets and remove noisy steps'
  )
  .version(pkg.version)
  // NOTE: value flags deliberately have NO Commander defaults. A default would
  // make the flag look "provided" on every run, so it would silently override
  // config-file values (CLI > config > default precedence would break).
  // Effective defaults are applied downstream in sanitize().
  .option('-c, --config <path>', 'Path to config file')
  .option(
    '-r, --report <path>',
    'HTML report directory (default: ./playwright-report)'
  )
  .option(
    '-t, --traces <path...>',
    'Trace directory — repeatable (default: ./test-results)'
  )
  .option('-o, --output <path>', 'Output directory (for copy mode)')
  .option('--in-place', 'Overwrite original files')
  .option(
    '--patterns <path...>',
    'One or more pattern files (repeatable)'
  )
  .option(
    '--placeholder <string>',
    'Redaction placeholder (default: [REDACTED])'
  )
  .option('--dry-run', 'Log changes without writing files')
  .option('--no-traces', 'Skip trace file processing')
  .option('--no-reports', 'Skip HTML report processing')
  .option(
    '--summary-output <path>',
    'Write JSON summary to file'
  )
  .option(
    '--log-level <level>',
    'silent | normal | verbose (default: normal)'
  );

program.action(async (opts: Record<string, unknown>) => {
  try {
    // Load config
    const config = await loadConfig(opts['config'] as string | undefined);

    // Apply CLI overrides
    applyCliOverrides(config, opts);

    await sanitize(config);

    process.exit(0);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[FATAL] ${err.message}`);
    } else {
      console.error(`[FATAL] ${String(err)}`);
    }
    process.exit(1);
  }
});

/**
 * Exported for unit testing. Merges parsed CLI flag values into a {@link SanitizerConfig} object.
 *
 * CLI flags always take the highest priority — they overwrite any values
 * that were loaded from a config file. Sections are created on-demand
 * (e.g. `config.output` is initialised to `{}` if not already present).
 *
 * Flag → config field mapping:
 * - `--report`         → `output.reportDir`
 * - `--traces <path>`  → `output.traceDir` (string or array when repeated)
 * - `--no-traces`      → `output.processTraces = false`
 * - `--no-reports`     → `output.processReports = false`
 * - `--output`         → `output.dir` + `output.mode = 'copy'`
 * - `--in-place`       → `output.mode = 'in-place'`
 * - `--patterns`       → `redact.patternFiles`
 * - `--placeholder`    → `redact.placeholder`
 * - `--dry-run`        → `remove.dryRun = true`
 * - `--log-level`      → `reporting.logLevel`
 * - `--summary-output` → `reporting.summaryFile`
 *
 * Precedence is strictly CLI > config file > built-in default: a flag only
 * touches the config when it was actually provided (no Commander defaults),
 * so config-file values survive when the corresponding flag is absent.
 *
 * Note on `--traces` / `--no-traces`: Commander merges both into `opts.traces` —
 * `false` (skip processing), a string/array (directory override), or
 * `true`/`undefined` (absent).
 *
 * @param config - The config object to mutate (loaded from file or empty).
 * @param opts   - Raw parsed options from Commander.js (`program.opts()`).
 */
export function applyCliOverrides(
  config: SanitizerConfig,
  opts: Record<string, unknown>
): void {
  // Output overrides
  if (!config.output) config.output = {};

  if (typeof opts['report'] === 'string') {
    config.output.reportDir = opts['report'];
  }
  if (opts['traces'] === false) {
    config.output.processTraces = false;
  } else if (typeof opts['traces'] === 'string') {
    config.output.traceDir = opts['traces'];
  } else if (
    Array.isArray(opts['traces']) &&
    opts['traces'].every((t): t is string => typeof t === 'string')
  ) {
    config.output.traceDir =
      opts['traces'].length === 1 ? opts['traces'][0] : opts['traces'];
  }
  if (opts['reports'] === false) {
    config.output.processReports = false;
  }
  if (opts['output']) {
    config.output.dir = opts['output'] as string;
    config.output.mode = 'copy';
  }
  if (opts['inPlace']) {
    config.output.mode = 'in-place';
  }

  // Redact overrides
  if (opts['patterns']) {
    if (!config.redact) config.redact = {};
    config.redact.patternFiles = opts['patterns'] as string[];
  }
  if (opts['placeholder']) {
    if (!config.redact) config.redact = {};
    config.redact.placeholder = opts['placeholder'] as string;
  }

  // Remove overrides
  if (opts['dryRun']) {
    if (!config.remove) config.remove = {};
    config.remove.dryRun = true;
  }

  // Reporting overrides
  if (!config.reporting) config.reporting = {};
  if (opts['logLevel']) {
    config.reporting.logLevel = opts['logLevel'] as
      | 'silent'
      | 'normal'
      | 'verbose';
  }
  if (opts['summaryOutput']) {
    config.reporting.summaryFile = opts['summaryOutput'] as string;
  }
}



// Only parse when this file is the Node.js entry-point, not when it is imported
// by a test or another module. The CJS `require.main === module` idiom is the
// standard pattern for this in CommonJS (which is what `module: Node16` compiles
// to when package.json has no `"type": "module"` field).
if (require.main === module) {
  program.parse();
}
