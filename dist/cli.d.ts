#!/usr/bin/env node
import type { SanitizerConfig } from './config/types.js';
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
export declare function applyCliOverrides(config: SanitizerConfig, opts: Record<string, unknown>): void;
//# sourceMappingURL=cli.d.ts.map