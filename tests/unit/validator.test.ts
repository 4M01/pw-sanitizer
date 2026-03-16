import { describe, it, expect } from 'vitest';
import { validateConfig, validatePattern, validateRule } from '../../src/config/validator.js';
import type { SanitizerConfig, RedactPattern, RemoveRule } from '../../src/config/types.js';

describe('validateConfig', () => {
  it('throws when both redact and remove are absent', () => {
    const config: SanitizerConfig = {};
    expect(() => validateConfig(config)).toThrowError(
      'Config has no redact or remove rules. Nothing to do.'
    );
  });

  it('throws when redact has empty patterns and no patternFiles, and remove has empty rules and no ruleFiles', () => {
    const config: SanitizerConfig = {
      redact: { patterns: [] },
      remove: { rules: [] },
    };
    expect(() => validateConfig(config)).toThrowError(
      'Config has no redact or remove rules. Nothing to do.'
    );
  });

  it('passes when redact has at least one pattern', () => {
    const config: SanitizerConfig = {
      redact: {
        patterns: [{ id: 'p1', key: 'Authorization' }],
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('passes when remove has at least one rule', () => {
    const config: SanitizerConfig = {
      remove: {
        rules: [{ label: 'r1', stepName: 'login' }],
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('passes when redact has patternFiles even if patterns is empty', () => {
    const config: SanitizerConfig = {
      redact: {
        patterns: [],
        patternFiles: 'patterns.json',
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('passes when remove has ruleFiles even if rules is empty', () => {
    const config: SanitizerConfig = {
      remove: {
        rules: [],
        ruleFiles: 'rules.json',
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe('validatePattern', () => {
  it('throws when pattern has neither key nor valuePattern', () => {
    const pattern: RedactPattern = { id: 'test-id' };
    expect(() => validatePattern(pattern)).toThrowError(
      'Pattern "test-id" must define at least one of: key, valuePattern'
    );
  });

  it('passes when pattern has key', () => {
    const pattern: RedactPattern = { id: 'test-id', key: 'Authorization' };
    expect(() => validatePattern(pattern)).not.toThrow();
  });

  it('passes when pattern has valuePattern', () => {
    const pattern: RedactPattern = { id: 'test-id', valuePattern: /secret/ };
    expect(() => validatePattern(pattern)).not.toThrow();
  });

  it('passes when pattern has both key and valuePattern', () => {
    const pattern: RedactPattern = {
      id: 'test-id',
      key: 'Authorization',
      valuePattern: /Bearer/,
    };
    expect(() => validatePattern(pattern)).not.toThrow();
  });
});

describe('validateRule', () => {
  it('throws when rule has no matchers', () => {
    const rule: RemoveRule = { label: 'test-label' };
    expect(() => validateRule(rule)).toThrowError(
      'Rule "test-label" must define at least one matcher: stepName, selector, url, or actionType'
    );
  });

  it('passes with stepName matcher', () => {
    const rule: RemoveRule = { label: 'test-label', stepName: 'login' };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it('passes with selector matcher', () => {
    const rule: RemoveRule = { label: 'test-label', selector: '#submit' };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it('passes with url matcher', () => {
    const rule: RemoveRule = { label: 'test-label', url: 'https://example.com' };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it('passes with actionType matcher', () => {
    const rule: RemoveRule = { label: 'test-label', actionType: 'click' };
    expect(() => validateRule(rule)).not.toThrow();
  });
});
