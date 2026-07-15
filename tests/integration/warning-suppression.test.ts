/**
 * Regression tests: Playwright's HTML report directory ships the static
 * trace-viewer app (playwright-report/trace/index.html, uiMode.html,
 * snapshot.html). These files contain no report payload and used to emit a
 * 'Could not find embedded report data' warning on every run.
 *
 * tests/fixtures/real/modern/trace-viewer-asset.html is the genuine
 * playwright-report/trace/index.html from a real Playwright 1.61 run.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { processHtmlReport } from '../../src/processors/html-report.js';
import { setLogLevel } from '../../src/logger.js';
import type { SanitizerConfig, RemoveRule } from '../../src/config/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_FIXTURE = path.join(
  HERE, '..', 'fixtures', 'real', 'modern', 'trace-viewer-asset.html'
);

const RULES: RemoveRule[] = [{ label: 'spinner', stepName: 'waitForSpinnerToDisappear' }];
const CONFIG: SanitizerConfig = {
  output: { mode: 'in-place' },
  remove: {},
};

let tmpDir: string;

afterEach(() => {
  setLogLevel('normal');
  vi.restoreAllMocks();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function stageAsset(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-suppress-'));
  const dest = path.join(tmpDir, 'index.html');
  fs.copyFileSync(ASSET_FIXTURE, dest);
  return dest;
}

describe('trace-viewer static assets in the report dir', () => {
  it('fixture is genuine and payload-free', () => {
    const html = fs.readFileSync(ASSET_FIXTURE, 'utf-8');
    expect(html).not.toContain('playwrightReportBase64');
    expect(html).not.toContain('__pw_report_data__');
  });

  it('does not emit a warning for payload-free HTML files', async () => {
    const assetPath = stageAsset();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await processHtmlReport(assetPath, assetPath, CONFIG, [], RULES);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(result.redactionsApplied).toBe(0);
    expect(result.stepsRemoved).toBe(0);
  });

  it('leaves the asset file untouched', async () => {
    const assetPath = stageAsset();
    const before = fs.readFileSync(assetPath, 'utf-8');

    await processHtmlReport(assetPath, assetPath, CONFIG, [], RULES);

    expect(fs.readFileSync(assetPath, 'utf-8')).toBe(before);
  });

  it('logs the skip at verbose level instead', async () => {
    const assetPath = stageAsset();
    setLogLevel('verbose');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processHtmlReport(assetPath, assetPath, CONFIG, [], RULES);

    expect(warnSpy).not.toHaveBeenCalled();
    const verboseLines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      verboseLines.some((l) => l.includes('No embedded report payload'))
    ).toBe(true);
  });
});
