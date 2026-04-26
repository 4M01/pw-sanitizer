import { describe, it, expect } from 'vitest';
import { walkAndRedact } from '../../src/redact/json-walker.js';
import type {
  RedactConfig,
  RedactPattern,
} from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple config that replaces matched values with '[REDACTED]'. */
const defaultConfig: RedactConfig = {
  placeholder: '[REDACTED]',
};

/** Pattern that matches the "authorization" key (case-insensitive exact). */
const authPattern: RedactPattern = {
  id: 'auth-header',
  key: 'authorization',
};

/** Pattern that matches the "password" key. */
const passwordPattern: RedactPattern = {
  id: 'password',
  key: 'password',
};

/** Pattern that matches the "x-api-key" key. */
const apiKeyPattern: RedactPattern = {
  id: 'api-key',
  key: 'x-api-key',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('walkAndRedact', () => {
  // ── 1. Simple flat object ──────────────────────────────────────────────

  describe('simple flat object', () => {
    it('redacts a matching key in a flat object', () => {
      const input = { authorization: 'Bearer token123' };
      const { result, count, matches } = walkAndRedact(
        input,
        [authPattern],
        defaultConfig,
      );

      expect(result).toEqual({ authorization: '[REDACTED]' });
      expect(count).toBe(1);
      expect(matches).toEqual([
        { keyPath: 'authorization', patternId: 'auth-header' },
      ]);
    });

    it('matches keys case-insensitively', () => {
      const input = { Authorization: 'Bearer token123' };
      const { result, count } = walkAndRedact(
        input,
        [authPattern],
        defaultConfig,
      );

      expect(result).toEqual({ Authorization: '[REDACTED]' });
      expect(count).toBe(1);
    });
  });

  // ── 2. Nested objects ──────────────────────────────────────────────────

  describe('nested objects', () => {
    it('redacts deeply nested matching keys', () => {
      const input = {
        request: {
          headers: {
            'x-api-key': 'secret',
          },
        },
      };

      const { result, count, matches } = walkAndRedact(
        input,
        [apiKeyPattern],
        defaultConfig,
      );

      expect(result).toEqual({
        request: {
          headers: {
            'x-api-key': '[REDACTED]',
          },
        },
      });
      expect(count).toBe(1);
      expect(matches).toHaveLength(1);
      expect(matches[0].keyPath).toBe('request.headers.x-api-key');
    });

    it('redacts multiple nested keys in one walk', () => {
      const input = {
        request: {
          headers: {
            authorization: 'Bearer abc',
            'x-api-key': 'key123',
          },
        },
      };

      const { result, count, matches } = walkAndRedact(
        input,
        [authPattern, apiKeyPattern],
        defaultConfig,
      );

      const expected = {
        request: {
          headers: {
            authorization: '[REDACTED]',
            'x-api-key': '[REDACTED]',
          },
        },
      };
      expect(result).toEqual(expected);
      expect(count).toBe(2);
      expect(matches).toHaveLength(2);
    });
  });

  // ── 3. Arrays ──────────────────────────────────────────────────────────

  describe('arrays', () => {
    it('redacts matching keys inside every array element', () => {
      const input = [
        { password: 'abc' },
        { password: 'def' },
      ];

      const { result, count, matches } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      expect(result).toEqual([
        { password: '[REDACTED]' },
        { password: '[REDACTED]' },
      ]);
      expect(count).toBe(2);
      expect(matches).toEqual([
        { keyPath: '[0].password', patternId: 'password' },
        { keyPath: '[1].password', patternId: 'password' },
      ]);
    });

    it('handles nested arrays of objects', () => {
      const input = {
        users: [
          { name: 'Alice', password: 'secret1' },
          { name: 'Bob', password: 'secret2' },
        ],
      };

      const { result, count } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, unknown>;
      const users = res.users as Array<Record<string, unknown>>;
      expect(users[0].password).toBe('[REDACTED]');
      expect(users[1].password).toBe('[REDACTED]');
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');
      expect(count).toBe(2);
    });
  });

  // ── 4. Embedded stringified JSON ───────────────────────────────────────

  describe('embedded stringified JSON', () => {
    it('parses a stringified JSON body, redacts inside, and re-stringifies', () => {
      const inner = JSON.stringify({ password: 'secret' });
      const input = { body: inner };

      const { result, count, matches } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, string>;
      // The body should still be a string (re-stringified)
      expect(typeof res.body).toBe('string');

      const parsed = JSON.parse(res.body);
      expect(parsed.password).toBe('[REDACTED]');
      expect(count).toBe(1);
      expect(matches).toHaveLength(1);
      expect(matches[0].keyPath).toBe('body.password');
    });

    it('handles nested stringified JSON with multiple keys', () => {
      const inner = JSON.stringify({
        authorization: 'Bearer tok',
        safe: 'ok',
      });
      const input = { body: inner };

      const { result, count } = walkAndRedact(
        input,
        [authPattern],
        defaultConfig,
      );

      const parsed = JSON.parse((result as Record<string, string>).body);
      expect(parsed.authorization).toBe('[REDACTED]');
      expect(parsed.safe).toBe('ok');
      expect(count).toBe(1);
    });
  });

  // ── 5. No matches ─────────────────────────────────────────────────────

  describe('no matches', () => {
    it('returns the object unchanged with count 0 when nothing matches', () => {
      const input = { safeKey: 'safeValue', another: 'value' };

      const { result, count, matches } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      expect(result).toEqual({ safeKey: 'safeValue', another: 'value' });
      expect(count).toBe(0);
      expect(matches).toEqual([]);
    });

    it('returns count 0 when patterns array is empty', () => {
      const input = { authorization: 'Bearer token' };

      const { result, count, matches } = walkAndRedact(
        input,
        [],
        defaultConfig,
      );

      expect(result).toEqual({ authorization: 'Bearer token' });
      expect(count).toBe(0);
      expect(matches).toEqual([]);
    });
  });

  // ── 6. Preserves non-string values ────────────────────────────────────

  describe('preserves non-string values', () => {
    it('keeps numbers, booleans, and null intact', () => {
      const input = {
        count: 42,
        enabled: true,
        disabled: false,
        nothing: null,
        password: 'secret',
      };

      const { result } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, unknown>;
      expect(res.count).toBe(42);
      expect(res.enabled).toBe(true);
      expect(res.disabled).toBe(false);
      expect(res.nothing).toBeNull();
      expect(res.password).toBe('[REDACTED]');
    });

    it('preserves undefined and null at top level', () => {
      expect(walkAndRedact(null, [passwordPattern], defaultConfig).result).toBeNull();
      expect(
        walkAndRedact(undefined, [passwordPattern], defaultConfig).result,
      ).toBeUndefined();
    });
  });

  // ── 7. Tracks keyPath in matches ──────────────────────────────────────

  describe('keyPath tracking', () => {
    it('builds dotted keyPaths for nested objects', () => {
      const input = {
        request: {
          headers: {
            authorization: 'Bearer xyz',
          },
        },
      };

      const { matches } = walkAndRedact(
        input,
        [authPattern],
        defaultConfig,
      );

      expect(matches).toEqual([
        { keyPath: 'request.headers.authorization', patternId: 'auth-header' },
      ]);
    });

    it('builds bracket-notation keyPaths for array indices', () => {
      const input = {
        items: [{ password: 'a' }],
      };

      const { matches } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      expect(matches).toEqual([
        { keyPath: 'items[0].password', patternId: 'password' },
      ]);
    });

    it('records the correct patternId in each match', () => {
      const input = {
        authorization: 'Bearer token',
        password: 'secret',
      };

      const { matches } = walkAndRedact(
        input,
        [authPattern, passwordPattern],
        defaultConfig,
      );

      const authMatch = matches.find((m) => m.keyPath === 'authorization');
      const pwMatch = matches.find((m) => m.keyPath === 'password');

      expect(authMatch).toBeDefined();
      expect(authMatch!.patternId).toBe('auth-header');
      expect(pwMatch).toBeDefined();
      expect(pwMatch!.patternId).toBe('password');
    });
  });



  // ── 9. Base64-encoded JSON body ────────────────────────────────────────

  describe('base64-encoded JSON body', () => {
    it('decodes base64 body, redacts, and re-encodes when content-type is JSON', () => {
      const innerJson = JSON.stringify({ password: 'secret' });
      const encodedBody = Buffer.from(innerJson).toString('base64');

      const input = {
        'content-type': 'application/json',
        body: encodedBody,
      };

      const { result, count, matches } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, string>;

      // content-type should be preserved
      expect(res['content-type']).toBe('application/json');

      // body should be re-encoded as base64
      const decodedBody = Buffer.from(res.body, 'base64').toString('utf-8');
      const parsed = JSON.parse(decodedBody);
      expect(parsed.password).toBe('[REDACTED]');

      expect(count).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.patternId === 'password')).toBe(true);
    });

    it('handles mixed-case Content-Type header', () => {
      const innerJson = JSON.stringify({ password: 'hidden' });
      const encodedBody = Buffer.from(innerJson).toString('base64');

      const input = {
        'Content-Type': 'application/json',
        body: encodedBody,
      };

      const { result } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, string>;
      const decodedBody = Buffer.from(res.body, 'base64').toString('utf-8');
      const parsed = JSON.parse(decodedBody);
      expect(parsed.password).toBe('[REDACTED]');
    });

    it('does not alter base64 body when content-type is not JSON', () => {
      const innerJson = JSON.stringify({ password: 'secret' });
      const encodedBody = Buffer.from(innerJson).toString('base64');

      const input = {
        'content-type': 'text/plain',
        body: encodedBody,
      };

      const { result } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, string>;
      // body should remain unchanged because content-type is not JSON
      expect(res.body).toBe(encodedBody);
    });

    it('leaves body unchanged if base64 does not decode to valid JSON', () => {
      const nonJsonBase64 = Buffer.from('not json at all').toString('base64');

      const input = {
        'content-type': 'application/json',
        body: nonJsonBase64,
      };

      const { result } = walkAndRedact(
        input,
        [passwordPattern],
        defaultConfig,
      );

      const res = result as Record<string, string>;
      expect(res.body).toBe(nonJsonBase64);
    });
  });
});
