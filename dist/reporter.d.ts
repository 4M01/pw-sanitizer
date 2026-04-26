import type { SanitizerConfig, ProcessResult, SanitizationSummary } from './config/types.js';
/**
 * Aggregates the per-file {@link ProcessResult}s into a single
 * {@link SanitizationSummary} for display and/or JSON export.
 *
 * Aggregation includes:
 * - Total redaction occurrence counts, broken down by pattern ID.
 * - Total step-removal counts, broken down by rule label (with file counts).
 * - Timestamp repair count and the strategy that was used.
 * - Output mode and destination directory from the config.
 *
 * @param results         - Per-file results from {@link sanitize} / {@link processHtmlReport} / {@link processTraceFile}.
 * @param config          - The sanitizer configuration used for this run.
 * @param patternsLoaded  - Number of distinct redact patterns that were active.
 * @param rulesLoaded     - Number of distinct removal rules that were active.
 * @param safetyWarnings  - Any safety-guard warning messages collected during processing.
 * @returns A fully populated {@link SanitizationSummary}.
 */
export declare function generateSummary(results: ProcessResult[], config: SanitizerConfig, patternsLoaded: number, rulesLoaded: number, safetyWarnings: string[]): SanitizationSummary;
/**
 * Renders a {@link SanitizationSummary} as a formatted table to `stdout`.
 *
 * The output includes:
 * - File counts (HTML reports + trace files).
 * - Per-pattern redaction counts (tree-style, with `├─` / `└─` connectors).
 * - Per-rule removal counts and file coverage.
 * - Timestamp repair count and strategy.
 * - Any safety-guard warnings.
 * - Output mode and destination directory.
 *
 * @param summary - The summary to render (typically from {@link generateSummary}).
 */
export declare function printSummary(summary: SanitizationSummary): void;
/**
 * Serialises a {@link SanitizationSummary} to a JSON file at the given path.
 *
 * Creates parent directories as needed. The JSON is pretty-printed with
 * 2-space indentation for human readability.
 *
 * @param summary  - The summary to serialise.
 * @param filePath - Destination file path (absolute or relative to `cwd`).
 */
export declare function writeSummaryFile(summary: SanitizationSummary, filePath: string): void;
//# sourceMappingURL=reporter.d.ts.map