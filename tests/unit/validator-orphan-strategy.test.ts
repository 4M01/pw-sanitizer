import { describe, it, expect } from 'vitest';
import { validateConfig, validateRule } from '../../src/config/validator.js';
import type { RemoveRule } from '../../src/config/types.js';

/** Validation of the per-rule and global `orphanStrategy` (CHANGE 1). */
describe('orphanStrategy validation', () => {
  const baseRule: RemoveRule = { label: 'r', stepName: 'x' };

  it('accepts the two valid global orphanStrategy values', () => {
    for (const v of ['remove-children', 'keep-shell'] as const) {
      expect(() =>
        validateConfig({ remove: { rules: [baseRule], orphanStrategy: v } })
      ).not.toThrow();
    }
  });

  it('rejects an invalid global orphanStrategy value', () => {
    expect(() =>
      validateConfig({
        remove: { rules: [baseRule], orphanStrategy: 'nope' as never },
      })
    ).toThrowError(/remove\.orphanStrategy must be one of/);
  });

  it('accepts the two valid per-rule orphanStrategy values', () => {
    for (const v of ['remove-children', 'keep-shell'] as const) {
      expect(() => validateRule({ label: 'r', stepName: 'x', orphanStrategy: v })).not.toThrow();
    }
  });

  it('rejects an invalid per-rule orphanStrategy value (message names the rule)', () => {
    expect(() =>
      validateRule({ label: 'timeout noise', stepName: 'x', orphanStrategy: 'bogus' as never })
    ).toThrowError(/rule "timeout noise" orphanStrategy must be one of/);
  });

  it('allows an omitted orphanStrategy (falls through the resolution chain)', () => {
    expect(() => validateRule({ label: 'r', stepName: 'x' })).not.toThrow();
    expect(() => validateConfig({ remove: { rules: [baseRule] } })).not.toThrow();
  });
});
