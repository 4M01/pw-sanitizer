import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateSummary, printSummary, writeSummaryFile } from '../../src/reporter.js';
import type { ProcessResult, SanitizerConfig, SanitizationSummary } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    file: '/tmp/report.html',
    redactionsApplied: 0,
    stepsRemoved: 0,
    timestampRepairs: 0,
    redactionMatches: [],
    removalMatches: [],
    safetyGuardWarnings: [],
    ...overrides,
  };
}

const baseConfig: SanitizerConfig = {
  redact: { patterns: [{ id: 'auth', key: 'authorization' }] },
  remove: { rules: [{ label: 'noisy', stepName: 'poll' }] },
  output: { mode: 'copy', dir: './sanitized' },
};

// ---------------------------------------------------------------------------
// generateSummary
// ---------------------------------------------------------------------------

describe('generateSummary', () => {
  it('counts HTML reports and trace files separately', () => {
    const results = [
      makeResult({ file: 'a.html' }),
      makeResult({ file: 'b.zip' }),
      makeResult({ file: 'c.html' }),
    ];
    const summary = generateSummary(results, baseConfig, 1, 1, []);
    expect(summary.filesProcessed.reports).toBe(2);
    expect(summary.filesProcessed.traces).toBe(1);
  });

  it('aggregates redaction counts by pattern id', () => {
    const results = [
      makeResult({
        redactionsApplied: 2,
        redactionMatches: [
          { keyPath: 'a.authorization', patternId: 'auth' },
          { keyPath: 'b.authorization', patternId: 'auth' },
        ],
      }),
      makeResult({
        file: '/tmp/trace.zip',
        redactionsApplied: 1,
        redactionMatches: [{ keyPath: 'c.token', patternId: 'token' }],
      }),
    ];
    const summary = generateSummary(results, baseConfig, 2, 0, []);
    expect(summary.redact.totalOccurrencesReplaced).toBe(3);
    expect(summary.redact.byPatternId['auth']).toBe(2);
    expect(summary.redact.byPatternId['token']).toBe(1);
    expect(summary.redact.patternsLoaded).toBe(2);
  });

  it('aggregates removal counts by rule label', () => {
    const results = [
      makeResult({
        file: 'a.html',
        stepsRemoved: 2,
        removalMatches: [
          { index: 0, ruleLabel: 'noisy', event: { startTime: 0, endTime: 1 } },
          { index: 1, ruleLabel: 'noisy', event: { startTime: 1, endTime: 2 } },
        ],
      }),
      makeResult({
        file: 'b.zip',
        stepsRemoved: 1,
        removalMatches: [
          { index: 0, ruleLabel: 'noisy', event: { startTime: 0, endTime: 1 } },
        ],
      }),
    ];
    const summary = generateSummary(results, baseConfig, 0, 1, []);
    expect(summary.remove.totalStepsDeleted).toBe(3);
    const noisyEntry = summary.remove.byRuleLabel.find((e) => e.label === 'noisy');
    expect(noisyEntry).toBeDefined();
    expect(noisyEntry!.count).toBe(3);
    expect(noisyEntry!.files).toBe(2);
  });

  it('includes safety guard warnings', () => {
    const summary = generateSummary([], baseConfig, 0, 0, ['warn1', 'warn2']);
    expect(summary.remove.safetyGuardWarnings).toEqual(['warn1', 'warn2']);
  });

  it('uses config output mode and dir', () => {
    const summary = generateSummary([], baseConfig, 0, 0, []);
    expect(summary.output.mode).toBe('copy');
    expect(summary.output.dir).toBe('./sanitized');
  });

  it('defaults output mode to copy and dir to ./sanitized-report', () => {
    const summary = generateSummary([], {}, 0, 0, []);
    expect(summary.output.mode).toBe('copy');
    expect(summary.output.dir).toBe('./sanitized-report');
  });

  it('includes a processedAt ISO timestamp', () => {
    const summary = generateSummary([], baseConfig, 0, 0, []);
    expect(new Date(summary.processedAt).toISOString()).toBe(summary.processedAt);
  });
});

// ---------------------------------------------------------------------------
// printSummary
// ---------------------------------------------------------------------------

describe('printSummary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs file counts, pattern counts, and output info', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary: SanitizationSummary = {
      processedAt: new Date().toISOString(),
      filesProcessed: { reports: 2, traces: 1 },
      redact: { patternsLoaded: 2, totalOccurrencesReplaced: 5, byPatternId: { auth: 3, token: 2 } },
      remove: {
        rulesLoaded: 1,
        totalStepsDeleted: 4,
        timestampRepairs: 4,
        timestampStrategy: 'absorb-into-prev',
        byRuleLabel: [{ label: 'noisy', count: 4, files: 2 }],
        safetyGuardWarnings: [],
      },
      output: { mode: 'copy', dir: './sanitized' },
    };

    printSummary(summary);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');

    expect(output).toContain('2 HTML reports');
    expect(output).toContain('1 trace files');
    expect(output).toContain('auth');
    expect(output).toContain('noisy');
    expect(output).toContain('copy');
    expect(output).toContain('./sanitized');
  });

  it('prints safety guard warnings when present', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary: SanitizationSummary = {
      processedAt: new Date().toISOString(),
      filesProcessed: { reports: 0, traces: 0 },
      redact: { patternsLoaded: 0, totalOccurrencesReplaced: 0, byPatternId: {} },
      remove: {
        rulesLoaded: 1,
        totalStepsDeleted: 0,
        timestampRepairs: 0,
        timestampStrategy: 'gap',
        byRuleLabel: [],
        safetyGuardWarnings: ['threshold not met for rule "poll"'],
      },
      output: { mode: 'copy', dir: './out' },
    };

    printSummary(summary);
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('threshold not met');
  });
});

// ---------------------------------------------------------------------------
// writeSummaryFile
// ---------------------------------------------------------------------------

describe('writeSummaryFile', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes a valid JSON file at the given path', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reporter-test-'));
    const outPath = path.join(tmpDir, 'summary.json');

    const summary: SanitizationSummary = {
      processedAt: '2024-01-01T00:00:00.000Z',
      filesProcessed: { reports: 1, traces: 0 },
      redact: { patternsLoaded: 1, totalOccurrencesReplaced: 2, byPatternId: { auth: 2 } },
      remove: {
        rulesLoaded: 0,
        totalStepsDeleted: 0,
        timestampRepairs: 0,
        timestampStrategy: 'absorb-into-prev',
        byRuleLabel: [],
        safetyGuardWarnings: [],
      },
      output: { mode: 'copy', dir: './sanitized' },
    };

    writeSummaryFile(summary, outPath);

    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as SanitizationSummary;
    expect(parsed.processedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(parsed.redact.byPatternId['auth']).toBe(2);
  });

  it('creates parent directories as needed', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reporter-test-'));
    const outPath = path.join(tmpDir, 'nested', 'deep', 'summary.json');

    writeSummaryFile(
      {
        processedAt: new Date().toISOString(),
        filesProcessed: { reports: 0, traces: 0 },
        redact: { patternsLoaded: 0, totalOccurrencesReplaced: 0, byPatternId: {} },
        remove: {
          rulesLoaded: 0,
          totalStepsDeleted: 0,
          timestampRepairs: 0,
          timestampStrategy: 'absorb-into-prev',
          byRuleLabel: [],
          safetyGuardWarnings: [],
        },
        output: { mode: 'copy', dir: './out' },
      },
      outPath
    );

    expect(fs.existsSync(outPath)).toBe(true);
  });
});
