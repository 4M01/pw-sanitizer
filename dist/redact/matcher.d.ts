import type { RedactConfig, RedactPattern, RedactionResult } from '../config/types.js';
/**
 * Evaluates a key/value pair against the full list of patterns and returns
 * a {@link RedactionResult} describing whether — and how — it was redacted.
 *
 * Matching rules:
 * - Pattern with only `key`: key must match.
 * - Pattern with only `valuePattern`: value must match.
 * - Pattern with both: **both** must match (AND logic).
 * - Patterns are tested in order; the **first** match wins.
 *
 * @remarks
 * This function intentionally **never logs the matched value** to prevent
 * secrets from appearing in log output. Only the key name and pattern ID
 * are logged at verbose level.
 *
 * @param key      - The field name (e.g. header name, JSON property key).
 * @param value    - The current string value of the field.
 * @param patterns - Ordered list of {@link RedactPattern}s to test against.
 * @param config   - The redact config, used to resolve placeholder / partial-redaction settings.
 * @returns A {@link RedactionResult} with `redacted: false` if no pattern matched,
 *   or `redacted: true` with the replacement value and matched pattern ID.
 */
export declare function redactValue(key: string, value: string, patterns: RedactPattern[], config: RedactConfig): RedactionResult;
//# sourceMappingURL=matcher.d.ts.map