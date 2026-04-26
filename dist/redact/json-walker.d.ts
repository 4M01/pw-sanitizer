import type { RedactConfig, RedactPattern, WalkResult } from '../config/types.js';
/**
 * Recursively traverses a JSON-like structure and redacts any string values
 * that match the provided patterns.
 *
 * Traversal rules:
 * - **Arrays**: each element is walked with an indexed path (e.g. `items[0].token`).
 * - **Objects**: each property is visited; the key is tested against patterns.
 * - **Strings**: tested via {@link redactValue}. If not redacted, the value is also
 *   tested as embedded JSON (a string that is itself a JSON object/array) and, if
 *   parseable, the inner structure is walked recursively and re-serialised.
 * - **Base64 JSON bodies**: if an object has a `Content-Type: application/json`
 *   sibling and a body-like field containing base64 data, the decoded JSON is
 *   walked and the field is re-encoded after redaction.
 * - **Numbers / booleans**: copied through as-is (never redacted).
 * - **`null` / `undefined`**: returned unchanged.
 *
 * The input is **never mutated** — a new tree is produced for each call.
 *
 * @param obj      - The JSON value to walk. Typically a parsed `trace.json` array
 *   or the `window.__pw_report_data__` object extracted from an HTML report.
 * @param patterns - Ordered list of {@link RedactPattern}s to apply.
 * @param config   - The redact config, forwarded to {@link redactValue} for placeholder resolution.
 * @returns A {@link WalkResult} containing the transformed tree, total redaction count,
 *   and the list of individual {@link RedactionMatch}es.
 */
export declare function walkAndRedact(obj: unknown, patterns: RedactPattern[], config: RedactConfig): WalkResult;
//# sourceMappingURL=json-walker.d.ts.map