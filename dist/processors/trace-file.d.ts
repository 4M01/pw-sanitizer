import type { SanitizerConfig, RedactPattern, RemoveRule, ProcessResult } from '../config/types.js';
/**
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Supports the **real Playwright trace format** (Playwright >= 1.40, verified
 * against 1.40–1.61): the archive contains NDJSON event streams named
 * `test.trace`, `0-trace.trace`, `1-trace.trace`, ..., `N-trace.network`,
 * `N-trace.stacks` plus a `resources/` folder. Each `.trace` / `.network`
 * entry holds one JSON event per line.
 *
 * Processing pipeline:
 * 1. Read and parse the `.zip` archive with JSZip.
 * 2. Parse every `*.trace` and `*.network` entry as NDJSON.
 * 3. **Redact phase**: walk and redact each parsed event line, plus
 *    `.json` / `.txt` files inside `resources/`.
 * 4. **Remove phase**: match rules against `"before"` events in each
 *    `*.trace` file, then treat ALL `.trace` files as one step graph —
 *    library-side events (`0-trace.trace`, ...) are linked to their
 *    test-runner step (`test.trace`) via their `stepId` field, so removing a
 *    step also removes its underlying `call@N` / `log` events even for
 *    scripts that never use `test.step`. Drop matched steps and/or their
 *    descendant events according to `orphanStrategy`; repair timestamps
 *    according to `timestampStrategy`. Correlated `*.network` events are
 *    dropped by `callId` and, for `resource-snapshot` entries (which carry
 *    no callId), by removed-step URL.
 * 5. **Screenshot redaction phase** (optional, requires `sharp`).
 * 6. Write back NDJSON preserving the line order of untouched events, re-zip
 *    and write according to `config.output.mode`.
 *
 * **Legacy fallback:** archives containing a `trace.json` (the pre-NDJSON
 * fake/legacy layout) are still processed through the original JSON-array
 * code path.
 *
 * @param inputPath  - Absolute path to the source trace `.zip` file.
 * @param outputPath - Destination path for the sanitized output archive.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns.
 * @param rules      - Pre-built list of removal rules.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export declare function processTraceFile(inputPath: string, outputPath: string, config: SanitizerConfig, patterns: RedactPattern[], rules: RemoveRule[]): Promise<ProcessResult>;
//# sourceMappingURL=trace-file.d.ts.map