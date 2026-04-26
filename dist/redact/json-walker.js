"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkAndRedact = walkAndRedact;
const matcher_js_1 = require("./matcher.js");
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
function walkAndRedact(obj, patterns, config) {
    const matches = [];
    let count = 0;
    function walk(node, keyPath) {
        if (node === null || node === undefined) {
            return node;
        }
        if (Array.isArray(node)) {
            // Mutate array in place to save memory
            for (let i = 0; i < node.length; i++) {
                node[i] = walk(node[i], `${keyPath}[${i}]`);
            }
            return node;
        }
        if (typeof node === 'object') {
            const objNode = node;
            let hasJsonContentType = false;
            const bodyKeys = [];
            for (const [key, value] of Object.entries(objNode)) {
                const currentPath = keyPath ? `${keyPath}.${key}` : key;
                const keyLower = key.toLowerCase();
                // Check for content-type indicating JSON
                if ((keyLower === 'content-type' || keyLower === 'contenttype') &&
                    typeof value === 'string' &&
                    value.toLowerCase().includes('application/json')) {
                    hasJsonContentType = true;
                }
                else if (['body', 'content', 'data', 'payload'].includes(keyLower) &&
                    typeof value === 'string' &&
                    isLikelyBase64(value)) {
                    bodyKeys.push(key);
                }
                if (typeof value === 'string') {
                    // Try to redact the string value
                    const redactionResult = (0, matcher_js_1.redactValue)(key, value, patterns, config);
                    if (redactionResult.redacted) {
                        objNode[key] = redactionResult.value;
                        count++;
                        matches.push({
                            keyPath: currentPath,
                            patternId: redactionResult.matchedPatternId,
                        });
                    }
                    else {
                        // Check if the string is embedded JSON
                        const parsed = tryParseJson(value);
                        if (parsed !== undefined) {
                            const innerResult = walk(parsed, currentPath);
                            objNode[key] = JSON.stringify(innerResult);
                        }
                        // else string remains unchanged
                    }
                }
                else if (typeof value === 'object' && value !== null) {
                    // Recurse into nested objects/arrays
                    objNode[key] = walk(value, currentPath);
                }
                // Booleans and numbers remain unchanged
            }
            // Handle base64-encoded JSON bodies
            if (hasJsonContentType && bodyKeys.length > 0) {
                for (const bodyKey of bodyKeys) {
                    const bodyValue = objNode[bodyKey];
                    if (typeof bodyValue === 'string') {
                        const decoded = tryDecodeBase64Json(bodyValue);
                        if (decoded !== undefined) {
                            const innerPath = keyPath ? `${keyPath}.${bodyKey}` : bodyKey;
                            const redacted = walk(decoded, innerPath);
                            objNode[bodyKey] = Buffer.from(JSON.stringify(redacted)).toString('base64');
                        }
                    }
                }
            }
            return objNode;
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
function tryParseJson(value) {
    // Quick heuristic: only try if it starts with { or [
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return JSON.parse(value);
        }
        catch {
            return undefined;
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
function isLikelyBase64(value) {
    if (value.length < 4)
        return false;
    // Base64 uses A-Z, a-z, 0-9, +, /, = (padding)
    return /^[A-Za-z0-9+/]+=*$/.test(value);
}
/**
 * Attempts to decode a base64 string and parse the result as JSON.
 *
 * @param value - A base64-encoded string (UTF-8 JSON content expected).
 * @returns The parsed JSON value, or `undefined` if decoding or parsing fails.
 */
function tryDecodeBase64Json(value) {
    try {
        const decoded = Buffer.from(value, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=json-walker.js.map