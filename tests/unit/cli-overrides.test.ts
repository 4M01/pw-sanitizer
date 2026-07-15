import { describe, it, expect } from 'vitest';
import { applyCliOverrides } from '../../src/cli.js';
import type { SanitizerConfig } from '../../src/config/types.js';

describe('applyCliOverrides', () => {
  it('sets output.reportDir from --report flag', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { report: './custom-reports' });
    expect(config.output?.reportDir).toBe('./custom-reports');
  });

  it('sets output.processTraces = false from --no-traces', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { traces: false });
    expect(config.output?.processTraces).toBe(false);
  });

  it('sets output.processReports = false from --no-reports', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { reports: false });
    expect(config.output?.processReports).toBe(false);
  });

  it('sets output.dir and output.mode = copy from --output', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { output: './out' });
    expect(config.output?.dir).toBe('./out');
    expect(config.output?.mode).toBe('copy');
  });

  it('sets output.mode = in-place from --in-place', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { inPlace: true });
    expect(config.output?.mode).toBe('in-place');
  });

  it('sets redact.patternFiles from --patterns', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { patterns: ['patterns.json'] });
    expect(config.redact?.patternFiles).toEqual(['patterns.json']);
  });

  it('sets redact.placeholder from --placeholder', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { placeholder: '***' });
    expect(config.redact?.placeholder).toBe('***');
  });

  it('sets remove.dryRun = true from --dry-run', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { dryRun: true });
    expect(config.remove?.dryRun).toBe(true);
  });

  it('sets reporting.logLevel from --log-level', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { logLevel: 'verbose' });
    expect(config.reporting?.logLevel).toBe('verbose');
  });

  it('sets reporting.summaryFile from --summary-output', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, { summaryOutput: './summary.json' });
    expect(config.reporting?.summaryFile).toBe('./summary.json');
  });

  // ── CLI > config precedence (regression: --traces used to be ignored) ──

  it('REGRESSION: --traces overrides config traceDir', () => {
    const config: SanitizerConfig = {
      output: { traceDir: './test-results' },
    };
    // Commander parses -t/--traces <path...> as an array of strings
    applyCliOverrides(config, { traces: ['/tmp/other'] });
    expect(config.output?.traceDir).toBe('/tmp/other');
  });

  it('uses config traceDir when --traces flag is absent', () => {
    const config: SanitizerConfig = {
      output: { traceDir: './from-config' },
    };
    // Commander sets opts.traces to true when --no-traces exists but neither
    // --traces <path> nor --no-traces was passed
    applyCliOverrides(config, { traces: true });
    expect(config.output?.traceDir).toBe('./from-config');
    expect(config.output?.processTraces).toBeUndefined();

    // Also when the key is entirely absent
    const config2: SanitizerConfig = {
      output: { traceDir: './from-config' },
    };
    applyCliOverrides(config2, {});
    expect(config2.output?.traceDir).toBe('./from-config');
  });

  it('supports repeated --traces flags as an array traceDir', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, {
      traces: ['./test-results', './playwright-report/data'],
    });
    expect(config.output?.traceDir).toEqual([
      './test-results',
      './playwright-report/data',
    ]);
  });

  it('still maps --no-traces to processTraces = false without touching traceDir', () => {
    const config: SanitizerConfig = {
      output: { traceDir: './from-config' },
    };
    applyCliOverrides(config, { traces: false });
    expect(config.output?.processTraces).toBe(false);
    expect(config.output?.traceDir).toBe('./from-config');
  });

  it('does not clobber config reportDir when opts.report is a non-string (negation default)', () => {
    const config: SanitizerConfig = {
      output: { reportDir: './from-config' },
    };
    applyCliOverrides(config, { report: true });
    expect(config.output?.reportDir).toBe('./from-config');
  });

  it('does not overwrite existing config values when flags are absent', () => {
    const config: SanitizerConfig = {
      output: { mode: 'in-place', reportDir: './orig' },
    };
    applyCliOverrides(config, {});
    expect(config.output?.mode).toBe('in-place');
    expect(config.output?.reportDir).toBe('./orig');
  });

  it('merges multiple overrides in a single call', () => {
    const config: SanitizerConfig = {};
    applyCliOverrides(config, {
      report: './r',
      output: './o',
      logLevel: 'silent',
      dryRun: true,
    });
    expect(config.output?.reportDir).toBe('./r');
    expect(config.output?.dir).toBe('./o');
    expect(config.reporting?.logLevel).toBe('silent');
    expect(config.remove?.dryRun).toBe(true);
  });
});
