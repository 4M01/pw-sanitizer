import type { SanitizerConfig, RedactPattern, RemoveRule, ProcessResult } from '../config/types.js';
/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Supports the **real Playwright HTML report format** (>= 1.40): the report
 * data is embedded as a base64-encoded zip (see {@link WINDOW_BASE64_REGEX}
 * and {@link TEMPLATE_BASE64_REGEX}). The zip is decoded, its `report.json`
 * and per-test-file JSON shards are redacted and step-pruned, then it is
 * re-zipped, re-encoded, and substituted back into the HTML.
 *
 * **Legacy fallback:** reports embedding plain JSON via
 * `window.__pw_report_data__` are still processed through the original path.
 *
 * @param inputPath  - Absolute path to the source HTML report file.
 * @param outputPath - Destination path for the sanitized output.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns.
 * @param rules      - Pre-built list of removal rules.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export declare function processHtmlReport(inputPath: string, outputPath: string, config: SanitizerConfig, patterns: RedactPattern[], rules: RemoveRule[]): Promise<ProcessResult>;
//# sourceMappingURL=html-report.d.ts.map