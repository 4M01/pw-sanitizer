import type { SanitizerConfig, RedactPattern, RemoveRule, ProcessResult } from '../config/types.js';
/**
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Processing pipeline:
 * 1. Read and parse the `.zip` archive with JSZip.
 * 2. Extract `trace.json` (primary event stream) and `network.json` (request log).
 * 3. **Redact phase** (if `config.redact` and patterns are loaded):
 *    - Walk and redact `trace.json` events.
 *    - Walk and redact `network.json` entries.
 *    - Walk and redact `.json` / `.txt` files inside the `resources/` folder.
 * 4. **Remove phase** (if `config.remove` and rules are loaded):
 *    - Run {@link findStepsToRemove} on the trace events.
 *    - Run {@link removeSteps} and {@link repairTimestamps}.
 *    - Remove corresponding `network.json` entries by `requestId`.
 * 5. Write modified `trace.json` and `network.json` back into the archive.
 * 6. Re-generate the `.zip` buffer and write it according to `config.output.mode`.
 *
 * Unreadable files and non-JSON resources are skipped gracefully with warnings.
 *
 * @param inputPath  - Absolute path to the source trace `.zip` file.
 * @param outputPath - Destination path for the sanitized output archive.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns (from {@link buildPatternRegistry}).
 * @param rules      - Pre-built list of removal rules (from {@link buildRuleRegistry}).
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export declare function processTraceFile(inputPath: string, outputPath: string, config: SanitizerConfig, patterns: RedactPattern[], rules: RemoveRule[]): Promise<ProcessResult>;
//# sourceMappingURL=trace-file.d.ts.map