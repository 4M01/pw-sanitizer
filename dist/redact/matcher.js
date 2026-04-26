"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactValue = redactValue;
const logger_js_1 = require("../logger.js");
/**
 * Tests whether an event key matches a pattern's `key` field.
 *
 * - `string` → exact case-insensitive comparison
 * - `RegExp` → tested against the raw key string
 *
 * @param key - The key to test (e.g. a header name or JSON property name).
 * @param patternKey - The matcher from {@link RedactPattern.key}.
 * @returns `true` if the key satisfies the matcher.
 */
function matchesKey(key, patternKey) {
    if (typeof patternKey === 'string') {
        return key.toLowerCase() === patternKey.toLowerCase();
    }
    return patternKey.test(key);
}
/**
 * Tests whether a string value satisfies a pattern's `valuePattern` regexp.
 *
 * @param value - The string value to test.
 * @param valuePattern - The regexp from {@link RedactPattern.valuePattern}.
 * @returns `true` if the regexp matches.
 */
function matchesValue(value, valuePattern) {
    return valuePattern.test(value);
}
/**
 * Applies partial redaction to a string value.
 *
 * Keeps the first `prefix` characters and last `suffix` characters visible,
 * replacing everything in between with `'***'`.
 * If the value is too short for partial redaction (`length <= prefix + suffix`),
 * the entire value is replaced with `'***'`.
 *
 * @param value  - The original string value to partially redact.
 * @param prefix - Number of leading characters to keep visible.
 * @param suffix - Number of trailing characters to keep visible.
 * @returns The partially redacted string.
 *
 * @example
 * ```ts
 * applyPartialRedaction('Bearer eyJhbGci', 4, 4); // 'Bear***lci'
 * applyPartialRedaction('short', 4, 4);           // '***'  (too short)
 * ```
 */
function applyPartialRedaction(value, prefix, suffix) {
    if (value.length <= prefix + suffix) {
        // Value too short for partial redaction — redact entirely
        return '***';
    }
    const start = value.substring(0, prefix);
    const end = value.substring(value.length - suffix);
    return `${start}***${end}`;
}
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
function redactValue(key, value, patterns, config) {
    for (const pattern of patterns) {
        let keyMatches = true;
        let valueMatches = true;
        // Check key match (if pattern specifies a key)
        if (pattern.key !== undefined) {
            keyMatches = matchesKey(key, pattern.key);
        }
        // Check value match (if pattern specifies a valuePattern)
        if (pattern.valuePattern !== undefined) {
            valueMatches = matchesValue(value, pattern.valuePattern);
        }
        // If pattern has only key: key must match
        // If pattern has only valuePattern: value must match
        // If pattern has both: both must match (AND logic)
        if (pattern.key !== undefined && pattern.valuePattern !== undefined) {
            // AND logic: both must match
            if (!keyMatches || !valueMatches)
                continue;
        }
        else if (pattern.key !== undefined) {
            if (!keyMatches)
                continue;
        }
        else if (pattern.valuePattern !== undefined) {
            if (!valueMatches)
                continue;
        }
        else {
            // No matchers (should have been caught by validation)
            continue;
        }
        // Match found — apply redaction
        logger_js_1.logger.verbose(`Redacting key "${key}" matched by pattern "${pattern.id}"`);
        let redactedValue;
        if (config.partialRedaction) {
            redactedValue = applyPartialRedaction(value, config.partialRedaction.prefix, config.partialRedaction.suffix);
        }
        else {
            redactedValue = config.placeholder ?? '[REDACTED]';
        }
        return {
            redacted: true,
            value: redactedValue,
            matchedPatternId: pattern.id,
        };
    }
    return { redacted: false, value };
}
//# sourceMappingURL=matcher.js.map