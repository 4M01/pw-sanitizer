/**
 * Integration tests for the `pw-sanitizer/reporter` Playwright reporter
 * (src/playwright-reporter.ts).
 *
 * Simulates what Playwright does at the end of a run: by the time `onExit()`
 * fires, the HTML report and its `data/*.zip` trace copies exist on disk
 * (reporters' `onEnd()` all complete before any `onExit()`). The test stages a
 * realistic post-run directory layout from the real fixtures and lets the
 * reporter sanitize it via config auto-discovery.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import PwSanitizerReporter from '../../src/playwright-reporter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', 'fixtures', 'real', 'modern');

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reporter-test-'));
  savedCwd = process.cwd();
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const CONFIG = {
  remove: {
    rules: [{ label: 'spinner-noise', stepName: 'waitForSpinnerToDisappear' }],
  },
  output: {
    mode: 'in-place',
    reportDir: './playwright-report',
    traceDir: ['./test-results', './playwright-report/data'],
  },
  reporting: { summary: false, logLevel: 'silent' },
};

/** Stages a realistic post-run layout: report + data/ trace copy + test-results trace. */
function stageRunDirectory(): void {
  fs.mkdirSync(path.join(tmpDir, 'playwright-report', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'test-results', 'example-test'), { recursive: true });

  fs.copyFileSync(
    path.join(FIXTURES, 'index.html'),
    path.join(tmpDir, 'playwright-report', 'index.html')
  );
  // The HTML report serves this copy to its built-in trace viewer
  fs.copyFileSync(
    path.join(FIXTURES, 'trace.zip'),
    path.join(tmpDir, 'playwright-report', 'data', '24cdb39c116a3c41d0fbdc717.zip')
  );
  fs.copyFileSync(
    path.join(FIXTURES, 'trace.zip'),
    path.join(tmpDir, 'test-results', 'example-test', 'trace.zip')
  );
}

async function traceContains(zipPath: string, needle: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const content = await zip.file('test.trace')!.async('string');
  return content.includes(needle);
}

describe('PwSanitizerReporter (pw-sanitizer/reporter)', () => {
  it('printsToStdio() is false so it never suppresses the terminal reporter', () => {
    const reporter = new PwSanitizerReporter();
    expect(reporter.printsToStdio()).toBe(false);
  });

  it('onExit() sanitizes the report AND both trace locations via config auto-discovery', async () => {
    stageRunDirectory();
    fs.writeFileSync(
      path.join(tmpDir, 'playwright-sanitizer.config.json'),
      JSON.stringify(CONFIG)
    );
    process.chdir(tmpDir);

    const originalHtml = fs.readFileSync(
      path.join(tmpDir, 'playwright-report', 'index.html'),
      'utf-8'
    );

    const reporter = new PwSanitizerReporter();
    await reporter.onExit();

    // test-results trace sanitized
    expect(
      await traceContains(
        path.join(tmpDir, 'test-results', 'example-test', 'trace.zip'),
        'waitForSpinnerToDisappear'
      )
    ).toBe(false);

    // data/ trace copy (what the report's trace viewer opens) also sanitized —
    // this is the copy the old globalTeardown integration could never reach
    expect(
      await traceContains(
        path.join(tmpDir, 'playwright-report', 'data', '24cdb39c116a3c41d0fbdc717.zip'),
        'waitForSpinnerToDisappear'
      )
    ).toBe(false);

    // HTML report payload rewritten
    const newHtml = fs.readFileSync(
      path.join(tmpDir, 'playwright-report', 'index.html'),
      'utf-8'
    );
    expect(newHtml).not.toBe(originalHtml);
    expect(newHtml).toContain('playwrightReportBase64');
  });

  it('onExit() honours an explicit configPath option', async () => {
    stageRunDirectory();
    const configPath = path.join(tmpDir, 'custom-sanitizer.config.json');
    fs.writeFileSync(configPath, JSON.stringify(CONFIG));
    process.chdir(tmpDir);

    const reporter = new PwSanitizerReporter({ configPath });
    await reporter.onExit();

    expect(
      await traceContains(
        path.join(tmpDir, 'test-results', 'example-test', 'trace.zip'),
        'waitForSpinnerToDisappear'
      )
    ).toBe(false);
  });

  it('onExit() never throws — even when no config exists (must not mask test results)', async () => {
    // Empty directory: config auto-discovery will fail internally
    process.chdir(tmpDir);

    const reporter = new PwSanitizerReporter();
    await expect(reporter.onExit()).resolves.toBeUndefined();
  });

  it('onExit() never throws when the configured directories are missing', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'playwright-sanitizer.config.json'),
      JSON.stringify(CONFIG)
    );
    process.chdir(tmpDir);

    const reporter = new PwSanitizerReporter();
    await expect(reporter.onExit()).resolves.toBeUndefined();
  });
});
