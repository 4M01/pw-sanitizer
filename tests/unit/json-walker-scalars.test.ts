import { describe, it, expect } from 'vitest';
import { walkAndRedact } from '../../src/redact/json-walker.js';
import type { RedactConfig, RedactPattern } from '../../src/config/types.js';

const secret = 'FAKE_ONLY_SCALAR_CANARY';
const mask = '[SCALAR_REDACTED]';
const literal: RedactPattern = { id: 'known-literal', valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ };
const config: RedactConfig = { placeholder: mask };

// Use independent clones because the incumbent mutates containers. Changing
// that existing behavior is outside this scalar-string regression patch.
function redact(input: unknown, patterns: RedactPattern[] = [literal], redactConfig: RedactConfig = config) {
  return walkAndRedact(structuredClone(input), patterns, redactConfig);
}

describe('walkAndRedact keyless scalar strings', () => {
  it('redacts a root string and reports the root path', () => {
    expect(redact(secret)).toEqual({ result: mask, count: 1, matches: [{ keyPath: '', patternId: 'known-literal' }] });
  });

  it('redacts nested primitive arrays with independent inputs and preserves public values', () => {
    const input = { values: [secret, ['public', secret], 500, false, null, undefined] };
    const first = redact(input);
    expect(first.result).toEqual({ values: [mask, ['public', mask], 500, false, null, undefined] });
    expect(first.count).toBe(2);
    expect(first.matches).toEqual([
      { keyPath: 'values[0]', patternId: 'known-literal' },
      { keyPath: 'values[1][1]', patternId: 'known-literal' },
    ]);
    expect(redact(input)).toEqual(first);
    expect(input.values[0]).toBe(secret);
  });

  it('preserves DOM-shaped tags and safe attributes while redacting text', () => {
    const input = { html: ['DIV', { id: 'diagnosis', 'data-fake-secret': secret }, ['CODE', {}, secret], 'E_SYNTHETIC_500'] };
    const result = redact(input);
    expect(result.result).toEqual({ html: ['DIV', { id: 'diagnosis', 'data-fake-secret': mask }, ['CODE', {}, mask], 'E_SYNTHETIC_500'] });
    expect(result.count).toBe(2);
    expect(result.matches).toEqual([
      { keyPath: 'html[1].data-fake-secret', patternId: 'known-literal' },
      { keyPath: 'html[2][2]', patternId: 'known-literal' },
    ]);
  });

  it.each(['secret', /.*/, /^$/, ''])('keeps key-only scope (%s) off keyless leaves', (key) => {
    const pattern: RedactPattern = { id: 'key-only', key };
    expect(redact([secret, 'CODE'], [pattern])).toEqual({ result: [secret, 'CODE'], count: 0, matches: [] });
    expect(redact(secret, [pattern])).toEqual({ result: secret, count: 0, matches: [] });
  });

  it.each(['secret', /.*/, /^$/, ''])('keeps key+value AND scope (%s) off keyless leaves', (key) => {
    const pattern: RedactPattern = { id: 'and-rule', key, valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ };
    expect(redact([secret, 'CODE'], [pattern])).toEqual({ result: [secret, 'CODE'], count: 0, matches: [] });
    expect(redact(secret, [pattern])).toEqual({ result: secret, count: 0, matches: [] });
  });

  it('retains a real empty-string property key constraint', () => {
    const result = redact({ '': secret, secret, array: [secret] }, [{ id: 'empty-key', key: '', valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ }]);
    expect(result.result).toEqual({ '': mask, secret, array: [secret] });
    expect(result.count).toBe(1);
    expect(result.matches).toEqual([{ keyPath: '', patternId: 'empty-key' }]);
  });

  it('retains keyed AND matching on object fields inside arrays', () => {
    const result = redact([{ secret }, { other: secret }, secret, { secret: 'public' }], [{ id: 'and-rule', key: 'secret', valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ }]);
    expect(result.result).toEqual([{ secret: mask }, { other: secret }, secret, { secret: 'public' }]);
    expect(result.count).toBe(1);
    expect(result.matches).toEqual([{ keyPath: '[0].secret', patternId: 'and-rule' }]);
  });

  it('preserves first-match order and custom placeholders among keyed/value rules', () => {
    const patterns: RedactPattern[] = [
      { id: 'keyed-first', key: /.*/, valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ },
      { id: 'value-first', valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ },
      { id: 'value-second', valuePattern: /^FAKE_ONLY_SCALAR_CANARY$/ },
    ];
    const result = redact({ keyed: secret, array: [secret] }, patterns, { placeholder: 'CUSTOM' });
    expect(result.result).toEqual({ keyed: 'CUSTOM', array: ['CUSTOM'] });
    expect(result.count).toBe(2);
    expect(result.matches).toEqual([
      { keyPath: 'keyed', patternId: 'keyed-first' },
      { keyPath: 'array[0]', patternId: 'value-first' },
    ]);
  });

  it('uses existing partial-redaction semantics for primitive leaves', () => {
    const result = redact([secret], [literal], { partialRedaction: { prefix: 4, suffix: 3 } });
    expect(result.result).toEqual(['FAKE***ARY']);
    expect(result.count).toBe(1);
  });

  it('redacts primitive leaves in root stringified JSON arrays', () => {
    const result = redact(JSON.stringify([secret, 'public']));
    expect(result.result).toBe(JSON.stringify([mask, 'public']));
    expect(result.count).toBe(1);
    expect(result.matches).toEqual([{ keyPath: '[0]', patternId: 'known-literal' }]);
  });

  it('redacts primitive leaves in array-contained and keyed stringified JSON', () => {
    const encoded = JSON.stringify([secret, 'public']);
    const arrayResult = redact([encoded]);
    expect(arrayResult.result).toEqual([JSON.stringify([mask, 'public'])]);
    expect(arrayResult.matches).toEqual([{ keyPath: '[0][0]', patternId: 'known-literal' }]);
    const objectResult = redact({ body: encoded });
    expect(objectResult.result).toEqual({ body: JSON.stringify([mask, 'public']) });
    expect(objectResult.matches).toEqual([{ keyPath: 'body[0]', patternId: 'known-literal' }]);
  });

  it('redacts primitive leaves in the existing base64 JSON body format', () => {
    const input = { 'content-type': 'application/json', body: Buffer.from(JSON.stringify([secret, 'public', 500])).toString('base64') };
    const result = redact(input);
    expect(result.result).toEqual({ 'content-type': 'application/json', body: Buffer.from(JSON.stringify([mask, 'public', 500])).toString('base64') });
    expect(result.count).toBe(1);
    expect(result.matches).toEqual([{ keyPath: 'body[0]', patternId: 'known-literal' }]);
  });

  it('leaves malformed JSON, nonmatching strings and empty-pattern leaves unchanged', () => {
    const input = ['[invalid JSON]', 'CODE', 500, null];
    expect(redact(input)).toEqual({ result: input, count: 0, matches: [] });
    expect(redact([secret], [])).toEqual({ result: [secret], count: 0, matches: [] });
  });
});
