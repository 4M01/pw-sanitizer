import type { RedactConfig, RedactPattern, RedactionResult } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Tests whether a key matches a pattern's key field.
 *
 * - String pattern.key: exact case-insensitive match
 * - RegExp pattern.key: tested against the key
 */
function matchesKey(key: string, patternKey: string | RegExp): boolean {
  if (typeof patternKey === 'string') {
    return key.toLowerCase() === patternKey.toLowerCase();
  }
  return patternKey.test(key);
}

/**
 * Tests whether a value matches a pattern's valuePattern.
 */
function matchesValue(value: string, valuePattern: RegExp): boolean {
  return valuePattern.test(value);
}

/**
 * Applies partial redaction: keep first `prefix` and last `suffix` characters,
 * replace the middle with '***'.
 */
function applyPartialRedaction(
  value: string,
  prefix: number,
  suffix: number
): string {
  if (value.length <= prefix + suffix) {
    // Value too short for partial redaction — redact entirely
    return '***';
  }
  const start = value.substring(0, prefix);
  const end = value.substring(value.length - suffix);
  return `${start}***${end}`;
}

/**
 * Determines if a key/value pair should be redacted based on the provided patterns.
 * Returns the redaction result including the replacement value.
 *
 * NEVER logs the matched value — only the key name and pattern id.
 */
export function redactValue(
  key: string,
  value: string,
  patterns: RedactPattern[],
  config: RedactConfig
): RedactionResult {
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
      if (!keyMatches || !valueMatches) continue;
    } else if (pattern.key !== undefined) {
      if (!keyMatches) continue;
    } else if (pattern.valuePattern !== undefined) {
      if (!valueMatches) continue;
    } else {
      // No matchers (should have been caught by validation)
      continue;
    }

    // Match found — apply redaction
    logger.verbose(`Redacting key "${key}" matched by pattern "${pattern.id}"`);

    let redactedValue: string;
    if (config.partialRedaction) {
      redactedValue = applyPartialRedaction(
        value,
        config.partialRedaction.prefix,
        config.partialRedaction.suffix
      );
    } else {
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
