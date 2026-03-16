import { describe, it, expect } from 'vitest';
import { redactValue } from '../../src/redact/matcher.js';
import type { RedactPattern, RedactConfig, RedactionResult } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers — minimal config/pattern factories
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<RedactConfig> = {}): RedactConfig {
  return { patterns: [], ...overrides };
}

function makePattern(overrides: Partial<RedactPattern> & { id: string }): RedactPattern {
  return { ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Match by string key (case-insensitive exact match)
// ---------------------------------------------------------------------------

describe('string key matching (case-insensitive)', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'auth-header', key: 'authorization' }),
  ];
  const config = makeConfig();

  it('matches when key casing differs', () => {
    const result = redactValue('Authorization', 'Bearer token123', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('auth-header');
  });

  it('matches when key is all uppercase', () => {
    const result = redactValue('AUTHORIZATION', 'some-value', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('auth-header');
  });

  it('matches when key is all lowercase', () => {
    const result = redactValue('authorization', 'some-value', patterns, config);
    expect(result.redacted).toBe(true);
  });

  it('does not match a different key', () => {
    const result = redactValue('content-type', 'application/json', patterns, config);
    expect(result.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Match by RegExp key
// ---------------------------------------------------------------------------

describe('RegExp key matching', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'x-api-pattern', key: /^x-api/i }),
  ];
  const config = makeConfig();

  it('matches a key that starts with "x-api"', () => {
    const result = redactValue('x-api-key', 'secret-key-value', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('x-api-pattern');
  });

  it('matches case-insensitively when regex has /i flag', () => {
    const result = redactValue('X-API-TOKEN', 'tok_abc', patterns, config);
    expect(result.redacted).toBe(true);
  });

  it('does not match a key that does not satisfy the regex', () => {
    const result = redactValue('api-key', 'value', patterns, config);
    expect(result.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Match by valuePattern only (no key constraint)
// ---------------------------------------------------------------------------

describe('valuePattern-only matching', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'bearer-token', valuePattern: /^Bearer\s/i }),
  ];
  const config = makeConfig();

  it('matches any field whose value starts with "Bearer "', () => {
    const result = redactValue('some-random-header', 'Bearer eyJhbGciOi', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('bearer-token');
  });

  it('matches regardless of the key name', () => {
    const result = redactValue('x-custom', 'Bearer abc123', patterns, config);
    expect(result.redacted).toBe(true);
  });

  it('does not match when value does not satisfy the pattern', () => {
    const result = redactValue('authorization', 'Basic dXNlcjpwYXNz', patterns, config);
    expect(result.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. AND logic: both key AND valuePattern must match
// ---------------------------------------------------------------------------

describe('AND logic — key + valuePattern', () => {
  const patterns: RedactPattern[] = [
    makePattern({
      id: 'auth-bearer',
      key: 'authorization',
      valuePattern: /^Bearer\s/,
    }),
  ];
  const config = makeConfig();

  it('matches when both key and valuePattern match', () => {
    const result = redactValue('Authorization', 'Bearer eyJhbGciOi', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('auth-bearer');
  });

  it('does not match when key matches but value does not', () => {
    const result = redactValue('Authorization', 'Basic dXNlcjpwYXNz', patterns, config);
    expect(result.redacted).toBe(false);
  });

  it('does not match when value matches but key does not', () => {
    const result = redactValue('x-custom-header', 'Bearer eyJhbGciOi', patterns, config);
    expect(result.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. No match returns { redacted: false, value: originalValue }
// ---------------------------------------------------------------------------

describe('no match behaviour', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'password', key: 'password' }),
  ];
  const config = makeConfig();

  it('returns redacted: false with the original value unchanged', () => {
    const originalValue = 'nothing-sensitive-here';
    const result = redactValue('content-type', originalValue, patterns, config);
    expect(result).toEqual({ redacted: false, value: originalValue });
  });

  it('does not set matchedPatternId when there is no match', () => {
    const result = redactValue('accept', 'text/html', patterns, config);
    expect(result.redacted).toBe(false);
    expect(result.matchedPatternId).toBeUndefined();
  });

  it('returns redacted: false when patterns array is empty', () => {
    const result = redactValue('authorization', 'Bearer token', [], config);
    expect(result.redacted).toBe(false);
    expect(result.value).toBe('Bearer token');
  });
});

// ---------------------------------------------------------------------------
// 6. Partial redaction
// ---------------------------------------------------------------------------

describe('partial redaction', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'auth-header', key: 'authorization' }),
  ];

  it('keeps prefix and suffix characters, replaces middle with ***', () => {
    const config = makeConfig({ partialRedaction: { prefix: 4, suffix: 4 } });
    const result = redactValue('Authorization', 'Bearer eyJhbGciOi', patterns, config);
    expect(result.redacted).toBe(true);
    // "Bear" + "***" + "ciOi"
    expect(result.value).toBe('Bear***ciOi');
  });

  it('applies different prefix/suffix lengths correctly', () => {
    const config = makeConfig({ partialRedaction: { prefix: 2, suffix: 3 } });
    const result = redactValue('Authorization', 'abcdefghij', patterns, config);
    expect(result.redacted).toBe(true);
    // "ab" + "***" + "hij"
    expect(result.value).toBe('ab***hij');
  });

  it('preserves only the outer characters for long values', () => {
    const config = makeConfig({ partialRedaction: { prefix: 1, suffix: 1 } });
    const result = redactValue('Authorization', 'secret', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('s***t');
  });
});

// ---------------------------------------------------------------------------
// 7. Placeholder (when no partialRedaction)
// ---------------------------------------------------------------------------

describe('placeholder replacement', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'api-key', key: 'x-api-key' }),
  ];

  it('uses "[REDACTED]" as the default placeholder', () => {
    const config = makeConfig();
    const result = redactValue('x-api-key', 'sk_live_abc123', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('[REDACTED]');
  });

  it('uses a custom placeholder when provided', () => {
    const config = makeConfig({ placeholder: '***HIDDEN***' });
    const result = redactValue('x-api-key', 'sk_live_abc123', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('***HIDDEN***');
  });

  it('uses placeholder even for an empty string value', () => {
    const config = makeConfig({ placeholder: '<removed>' });
    const result = redactValue('x-api-key', '', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('<removed>');
  });
});

// ---------------------------------------------------------------------------
// 8. Value too short for partial redaction
// ---------------------------------------------------------------------------

describe('value too short for partial redaction', () => {
  const patterns: RedactPattern[] = [
    makePattern({ id: 'short-val', key: 'token' }),
  ];

  it('returns "***" when value length equals prefix + suffix', () => {
    const config = makeConfig({ partialRedaction: { prefix: 4, suffix: 4 } });
    // "abcdefgh" has length 8, which equals 4 + 4
    const result = redactValue('token', 'abcdefgh', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('***');
  });

  it('returns "***" when value length is less than prefix + suffix', () => {
    const config = makeConfig({ partialRedaction: { prefix: 4, suffix: 4 } });
    // "abc" has length 3, which is less than 4 + 4
    const result = redactValue('token', 'abc', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('***');
  });

  it('returns "***" for an empty value with partial redaction', () => {
    const config = makeConfig({ partialRedaction: { prefix: 1, suffix: 1 } });
    const result = redactValue('token', '', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('***');
  });

  it('returns "***" for a single-character value with prefix 1 + suffix 1', () => {
    const config = makeConfig({ partialRedaction: { prefix: 1, suffix: 1 } });
    // "x" has length 1, which is less than 1 + 1
    const result = redactValue('token', 'x', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('***');
  });
});

// ---------------------------------------------------------------------------
// 9. First matching pattern wins
// ---------------------------------------------------------------------------

describe('first matching pattern wins', () => {
  it('returns the id of the first pattern that matches', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'first-pattern', key: 'authorization' }),
      makePattern({ id: 'second-pattern', key: 'authorization' }),
    ];
    const config = makeConfig();
    const result = redactValue('Authorization', 'Bearer xyz', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('first-pattern');
  });

  it('skips non-matching patterns and returns the first match', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'no-match', key: 'cookie' }),
      makePattern({ id: 'match-by-value', valuePattern: /^Bearer\s/ }),
      makePattern({ id: 'also-matches', key: 'authorization' }),
    ];
    const config = makeConfig();
    const result = redactValue('Authorization', 'Bearer abc', patterns, config);
    expect(result.redacted).toBe(true);
    // 'no-match' fails (key mismatch), 'match-by-value' succeeds first
    expect(result.matchedPatternId).toBe('match-by-value');
  });

  it('uses the replacement from the first matching pattern', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'broad', valuePattern: /.*/ }),
      makePattern({ id: 'specific', key: 'authorization' }),
    ];
    const config = makeConfig({ placeholder: 'GONE' });
    const result = redactValue('Authorization', 'Bearer token', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('broad');
    expect(result.value).toBe('GONE');
  });
});

// ---------------------------------------------------------------------------
// Edge cases and additional coverage
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('pattern with no key and no valuePattern is skipped (no match)', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'empty-pattern' }), // no key, no valuePattern
    ];
    const config = makeConfig();
    const result = redactValue('authorization', 'Bearer token', patterns, config);
    expect(result.redacted).toBe(false);
  });

  it('severity field does not affect matching', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'critical-key', key: 'secret', severity: 'critical' }),
    ];
    const config = makeConfig();
    const result = redactValue('secret', 'my-secret-value', patterns, config);
    expect(result.redacted).toBe(true);
    expect(result.matchedPatternId).toBe('critical-key');
  });

  it('partialRedaction takes priority over placeholder', () => {
    const patterns: RedactPattern[] = [
      makePattern({ id: 'dual-config', key: 'token' }),
    ];
    const config = makeConfig({
      placeholder: 'SHOULD_NOT_APPEAR',
      partialRedaction: { prefix: 2, suffix: 2 },
    });
    const result = redactValue('token', 'abcdef', patterns, config);
    expect(result.redacted).toBe(true);
    // partial redaction wins: "ab" + "***" + "ef"
    expect(result.value).toBe('ab***ef');
    expect(result.value).not.toBe('SHOULD_NOT_APPEAR');
  });
});
