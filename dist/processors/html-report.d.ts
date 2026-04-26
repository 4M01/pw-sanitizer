import type { SanitizerConfig, RedactPattern, RemoveRule, ProcessResult } from '../config/types.js';
/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Processing pipeline:
 * 1. Read the HTML file from disk.
 * 2. Extract the embedded `window.__pw_report_data__` JSON blob via regex.
 * 3. **Redact phase** (if `config.redact` is set and patterns are loaded):
 *    walk the JSON tree with {@link walkAndRedact} and replace matched values.
 * 4. **Remove phase** (if `config.remove` is set and rules are loaded):
 *    extract step events, run {@link findStepsToRemove}, then
 *    {@link removeSteps} and {@link repairTimestamps}.
 * 5. Re-serialise the JSON and splice it back into the original HTML.
 * 6. Write the output according to `config.output.mode`.
 *
 * On any unrecoverable parse error, the function logs a warning and returns
 * an empty {@link ProcessResult} rather than throwing.
 *
 * @param inputPath  - Absolute path to the source HTML report file.
 * @param outputPath - Destination path for the sanitized output.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns (from {@link buildPatternRegistry}).
 * @param rules      - Pre-built list of removal rules (from {@link buildRuleRegistry}).
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export declare function processHtmlReport(inputPath: string, outputPath: string, config: SanitizerConfig, patterns: RedactPattern[], rules: RemoveRule[]): Promise<ProcessResult>;
//# sourceMappingURL=html-report.d.ts.map