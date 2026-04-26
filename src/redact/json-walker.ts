import type {
  RedactConfig,
  RedactPattern,
  RedactionMatch,
  WalkResult,
} from '../config/types.js';
import { redactValue } from './matcher.js';

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
 * Attempts to parse a string as JSON.
 *
 * Uses a fast heuristic to skip non-JSON strings: the trimmed value must start
 * with `{` and end with `}`, or start with `[` and end with `]`.
 *
 * @param value - The string to attempt to parse.
 * @returns The parsed value, or `undefined` if parsing fails or the value
 *   does not look like JSON.
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
 * Scans an object for a base64-encoded JSON body field.
 *
 * Returns the key name of the body field if all of the following are true:
 * 1. The object contains a `content-type` / `contenttype` field whose value
 *    includes `application/json`.
 * 2. The object contains a field named `body`, `content`, `data`, or `payload`
 *    whose value passes the {@link isLikelyBase64} heuristic.
 *
 * This is used to transparently redact request/response bodies that Playwright
 * stores as base64 in trace files.
 *
 * @param obj - The object to inspect.
 * @returns The key of the body field, or `undefined` if not detected.
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
 * Heuristic check for whether a string looks like base64-encoded data.
 *
 * Considers a string base64 if it is at least 4 characters long and consists
 * entirely of the base64 alphabet (`A-Za-z0-9+/`) with optional `=` padding.
 *
 * @param value - The string to test.
 * @returns `true` if the value matches the base64 character set.
 */
function isLikelyBase64(value: string): boolean {
  if (value.length < 4) return false;
  // Base64 uses A-Z, a-z, 0-9, +, /, = (padding)
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}

/**
 * Attempts to decode a base64 string and parse the result as JSON.
 *
 * @param value - A base64-encoded string (UTF-8 JSON content expected).
 * @returns The parsed JSON value, or `undefined` if decoding or parsing fails.
 */
function tryDecodeBase64Json(value: string): unknown | undefined {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
}
