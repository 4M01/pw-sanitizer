import type {
  RedactConfig,
  RedactPattern,
  RedactionMatch,
  WalkResult,
} from '../config/types.js';
import { redactValue } from './matcher.js';

/**
 * Recursively walks a JSON structure and redacts values matching the provided patterns.
 * Returns a new structure (never mutates input) with redaction stats.
 */
export function walkAndRedact(
  obj: unknown,
  patterns: RedactPattern[],
  config: RedactConfig
): WalkResult {
  const matches: RedactionMatch[] = [];
  let count = 0;

  function walk(node: unknown, keyPath: string): unknown {
    if (node === null || node === undefined) {
      return node;
    }

    if (Array.isArray(node)) {
      return node.map((item, index) => walk(item, `${keyPath}[${index}]`));
    }

    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        const currentPath = keyPath ? `${keyPath}.${key}` : key;

        if (typeof value === 'string') {
          // Try to redact the string value
          const redactionResult = redactValue(key, value, patterns, config);
          if (redactionResult.redacted) {
            result[key] = redactionResult.value;
            count++;
            matches.push({
              keyPath: currentPath,
              patternId: redactionResult.matchedPatternId!,
            });
          } else {
            // Check if the string is embedded JSON
            const parsed = tryParseJson(value);
            if (parsed !== undefined) {
              const innerResult = walk(parsed, currentPath);
              result[key] = JSON.stringify(innerResult);
            } else {
              result[key] = value;
            }
          }
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          result[key] = value;
        } else {
          // Recurse into nested objects/arrays
          result[key] = walk(value, currentPath);
        }
      }

      // Handle base64-encoded JSON bodies:
      // If there's a content-type-like key indicating JSON, and a body-like key that's base64
      const bodyKey = findBase64JsonBody(obj);
      if (bodyKey && typeof result[bodyKey] === 'string') {
        const decoded = tryDecodeBase64Json(result[bodyKey] as string);
        if (decoded !== undefined) {
          const innerPath = keyPath ? `${keyPath}.${bodyKey}` : bodyKey;
          const redacted = walk(decoded, innerPath);
          result[bodyKey] = Buffer.from(
            JSON.stringify(redacted)
          ).toString('base64');
        }
      }

      return result;
    }

    return node;
  }

  const result = walk(obj, '');
  return { result, count, matches };
}

/**
 * Tries to parse a string as JSON. Returns parsed object or undefined.
 */
function tryParseJson(value: string): unknown | undefined {
  // Quick heuristic: only try if it starts with { or [
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Looks for a base64-encoded JSON body field in an object.
 * Checks if there's a Content-Type sibling indicating JSON and
 * a body-like field that looks like base64.
 */
function findBase64JsonBody(
  obj: Record<string, unknown>
): string | undefined {
  // Check for content-type indicating JSON
  const hasJsonContentType = Object.entries(obj).some(([key, value]) => {
    const keyLower = key.toLowerCase();
    return (
      (keyLower === 'content-type' || keyLower === 'contenttype') &&
      typeof value === 'string' &&
      value.toLowerCase().includes('application/json')
    );
  });

  if (!hasJsonContentType) return undefined;

  // Look for a body-like field that could be base64
  const bodyKeys = ['body', 'content', 'data', 'payload'];
  for (const key of Object.keys(obj)) {
    if (
      bodyKeys.includes(key.toLowerCase()) &&
      typeof obj[key] === 'string' &&
      isLikelyBase64(obj[key] as string)
    ) {
      return key;
    }
  }

  return undefined;
}

/**
 * Heuristic check if a string looks like base64-encoded data.
 */
function isLikelyBase64(value: string): boolean {
  if (value.length < 4) return false;
  // Base64 uses A-Z, a-z, 0-9, +, /, = (padding)
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}

/**
 * Tries to decode a base64 string as JSON.
 */
function tryDecodeBase64Json(value: string): unknown | undefined {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
}
