import type { SanitizerConfig, ProcessResult } from './config/types.js';
export type { SanitizerConfig, RedactConfig, RemoveConfig, OutputConfig, ReportingConfig, RedactPattern, RemoveRule, ProcessResult, SanitizationSummary, TraceEvent, TimestampStrategy, RedactionResult, RedactionMatch, WalkResult, StepMatch, RemovalSet, } from './config/types.js';
export { loadPatternFile } from './redact/pattern-loader.js';
export { loadRuleFile } from './remove/rule-loader.js';
/**
 * Discovers trace `.zip` files across one or more trace directories.
 *
 * `output.traceDir` accepts `string | string[]` — an array lets a single run
 * cover both `./test-results` and the HTML report's `data/` folder (the trace
 * copies the report's built-in viewer actually opens). Files matched by more
 * than one directory are deduplicated by resolved absolute path; the first
 * directory that matched a file is kept as its root for output-path mirroring.
 *
 * Exported primarily for testing.
 *
 * @param traceDir - The configured trace directory or directories.
 *   Defaults to `'./test-results'` when omitted.
 * @returns One entry per unique trace file: the absolute file path plus the
 *   trace directory it was discovered under.
 */
export declare function collectTraceFiles(traceDir?: string | string[]): Promise<Array<{
    file: string;
    dir: string;
}>>;
/**
 * Main programmatic entry point for `playwright-sanitizer`.
 *
 * Discovers (or uses the provided) configuration, then processes all matching
 * HTML reports and trace `.zip` files found in the configured directories.
 *
 * Typical usage — run after a Playwright test suite from your own script:
 * ```ts
 * import { sanitize } from 'pw-sanitizer';
 *
 * await sanitize({
 *   redact: { patterns: [{ id: 'token', key: 'authorization' }] },
 *   output: { mode: 'in-place' },
 * });
 * ```
 *
 * Config resolution (when `configOverride` is omitted):
 * - Delegates to {@link loadConfig} which auto-discovers `playwright-sanitizer.config.ts`
 *   (or the `sanitizer` key in `playwright.config.ts`).
 *
 * @param configOverride - Optional config object. When provided, skips file-based
 *   config discovery entirely and uses this object directly.
 * @returns Array of {@link ProcessResult}s — one entry per file processed.
 */
export declare function sanitize(configOverride?: SanitizerConfig): Promise<ProcessResult[]>;
/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Convenience wrapper around {@link processHtmlReport} for cases where you
 * need to process one specific file rather than an entire directory.
 *
 * @param reportPath - Absolute or relative path to the HTML report file.
 * @param config     - The full sanitizer configuration to apply.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 *
 * @example
 * ```ts
 * import { redactReport } from 'pw-sanitizer';
 *
 * const result = await redactReport('./playwright-report/index.html', {
 *   redact: { patterns: [{ id: 'auth', key: 'authorization' }] },
 *   output: { mode: 'copy', dir: './sanitized' },
 * });
 * console.log(`Redacted ${result.redactionsApplied} values`);
 * ```
 */
export declare function redactReport(reportPath: string, config: SanitizerConfig): Promise<ProcessResult>;
/**
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Convenience wrapper around {@link processTraceFile} for cases where you
 * need to process one specific file rather than an entire directory.
 *
 * @param tracePath - Absolute or relative path to the trace `.zip` file.
 * @param config    - The full sanitizer configuration to apply.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 *
 * @example
 * ```ts
 * import { redactTrace } from 'pw-sanitizer';
 *
 * const result = await redactTrace('./test-results/my-test/trace.zip', {
 *   redact: { patterns: [{ id: 'cookie', key: /^cookie$/i }] },
 *   output: { mode: 'side-by-side' },
 * });
 * console.log(`Removed ${result.stepsRemoved} steps`);
 * ```
 */
export declare function redactTrace(tracePath: string, config: SanitizerConfig): Promise<ProcessResult>;
//# sourceMappingURL=index.d.ts.map