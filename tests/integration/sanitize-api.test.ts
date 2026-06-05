/**
 * Integration tests for the top-level programmatic API:
 *   sanitize(), redactReport(), redactTrace()
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { sanitize, redactReport, redactTrace } from '../../src/index.js';
import type { SanitizerConfig } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function mkTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-api-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

function buildHtml(json: unknown): string {
  return (
    '<html><head><script>window.__pw_report_data__ = ' +
    JSON.stringify(json) +
    ';</script></head><body></body></html>'
  );
}

async function buildTraceZip(traceEvents: unknown[], networkEntries: unknown[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('trace.json', JSON.stringify(traceEvents));
  zip.file('network.json', JSON.stringify(networkEntries));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const REPORT_JSON = {
  suites: [{
    title: 'suite',
    tests: [{
      results: [{
        steps: [
          { title: 'page.goto', startTime: 0, endTime: 100 },
          { title: 'locator.fill', startTime: 100, endTime: 200 },
        ],
      }],
    }],
  }],
  headers: { authorization: 'Bearer secret-token' },
};

// ---------------------------------------------------------------------------
// redactReport
// ---------------------------------------------------------------------------

describe('redactReport', () => {
  it('redacts a single HTML report file and returns ProcessResult', async () => {
    const dir = mkTmp();
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, buildHtml(REPORT_JSON), 'utf-8');

    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'auth', key: 'authorization' }], placeholder: '[REDACTED]' },
      output: { mode: 'in-place' },
    };

    const result = await redactReport(filePath, config);

    expect(result.file).toBe(filePath);
    expect(result.redactionsApplied).toBe(1);
    expect(result.redactionMatches[0]?.patternId).toBe('auth');

    const html = fs.readFileSync(filePath, 'utf-8');
    expect(html).not.toContain('Bearer secret-token');
    expect(html).toContain('[REDACTED]');
  });

  it('returns zero counts when no patterns match', async () => {
    const dir = mkTmp();
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, buildHtml(REPORT_JSON), 'utf-8');

    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'noop', key: 'x-noop-header' }] },
      output: { mode: 'in-place' },
    };

    const result = await redactReport(filePath, config);
    expect(result.redactionsApplied).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// redactTrace
// ---------------------------------------------------------------------------

describe('redactTrace', () => {
  it('redacts a single trace zip file and returns ProcessResult', async () => {
    const dir = mkTmp();
    const zipPath = path.join(dir, 'trace.zip');
    const traceEvents = [{ title: 'page.goto', startTime: 0, endTime: 100, callId: 'c1' }];
    const network = [{ requestId: 'r1', headers: { authorization: 'Bearer token' } }];
    fs.writeFileSync(zipPath, await buildTraceZip(traceEvents, network));

    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'auth', key: 'authorization' }], placeholder: '[REDACTED]' },
      output: { mode: 'in-place' },
    };

    const result = await redactTrace(zipPath, config);

    expect(result.file).toBe(zipPath);
    expect(result.redactionsApplied).toBeGreaterThanOrEqual(1);

    // Verify the zip was updated
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const networkJson = await zip.file('network.json')!.async('string');
    const parsed = JSON.parse(networkJson) as Array<{ requestId: string; headers: Record<string, string> }>;
    expect(parsed[0]?.headers.authorization).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// sanitize (full directory scan)
// ---------------------------------------------------------------------------

describe('sanitize', () => {
  it('processes all HTML reports in reportDir and returns results array', async () => {
    const dir = mkTmp();
    const reportDir = path.join(dir, 'playwright-report');
    const outputDir = path.join(dir, 'sanitized');
    fs.mkdirSync(reportDir);

    fs.writeFileSync(path.join(reportDir, 'index.html'), buildHtml(REPORT_JSON));

    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'auth', key: 'authorization' }], placeholder: '[REDACTED]' },
      output: { mode: 'copy', dir: outputDir, reportDir, processTraces: false },
    };

    const results = await sanitize(config);

    expect(results).toHaveLength(1);
    expect(results[0]?.redactionsApplied).toBe(1);

    const outFile = path.join(outputDir, 'index.html');
    expect(fs.existsSync(outFile)).toBe(true);
    expect(fs.readFileSync(outFile, 'utf-8')).toContain('[REDACTED]');
  });

  it('processes all trace zips in traceDir and returns results array', async () => {
    const dir = mkTmp();
    const traceDir = path.join(dir, 'test-results');
    const outputDir = path.join(dir, 'sanitized');
    fs.mkdirSync(traceDir);

    const traceEvents = [{ title: 'page.goto', startTime: 0, endTime: 100, callId: 'c1' }];
    const network = [{ requestId: 'r1', headers: { authorization: 'Bearer token' } }];
    fs.writeFileSync(path.join(traceDir, 'trace.zip'), await buildTraceZip(traceEvents, network));

    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'auth', key: 'authorization' }], placeholder: '[REDACTED]' },
      output: { mode: 'copy', dir: outputDir, traceDir, processReports: false },
    };

    const results = await sanitize(config);

    expect(results).toHaveLength(1);
    expect(results[0]?.redactionsApplied).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no files exist in configured dirs', async () => {
    const dir = mkTmp();
    const config: SanitizerConfig = {
      redact: { patterns: [{ id: 'auth', key: 'authorization' }] },
      output: {
        reportDir: path.join(dir, 'nonexistent-reports'),
        traceDir: path.join(dir, 'nonexistent-traces'),
      },
    };

    const results = await sanitize(config);
    expect(results).toHaveLength(0);
  });
});
