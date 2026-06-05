import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { processHtmlReport } from '../../src/processors/html-report.js';
import type {
  SanitizerConfig,
  RedactPattern,
  RemoveRule,
  TraceEvent,
} from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FIXTURE_JSON = {
  suites: [
    {
      title: 'test',
      tests: [
        {
          results: [
            {
              steps: [
                {
                  title: 'page.goto',
                  startTime: 0,
                  endTime: 100,
                  url: 'https://example.com',
                },
                {
                  title: 'locator.fill',
                  startTime: 100,
                  endTime: 200,
                  selector: '#password',
                },
                {
                  title: 'expect.toBeVisible',
                  startTime: 200,
                  endTime: 300,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  headers: {
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature',
    'x-api-key': 'my-secret-key-12345',
  },
};

function buildFixtureHtml(json: unknown = FIXTURE_JSON): string {
  return (
    '<html><head><script>window.__pw_report_data__ = ' +
    JSON.stringify(json) +
    ';</script></head><body></body></html>'
  );
}

// ---------------------------------------------------------------------------
// Patterns & configs
// ---------------------------------------------------------------------------

const authPattern: RedactPattern = {
  id: 'auth-header',
  key: 'authorization',
};

const apiKeyPattern: RedactPattern = {
  id: 'api-key',
  key: 'x-api-key',
};

const inPlaceConfig: SanitizerConfig = {
  redact: {
    placeholder: '[REDACTED]',
  },
  output: {
    mode: 'in-place',
  },
};

const noRules: RemoveRule[] = [];

// ---------------------------------------------------------------------------
// Temp-file helpers
// ---------------------------------------------------------------------------

let tempFiles: string[] = [];

function createTempHtml(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(
    tmpDir,
    `pw-sanitizer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  fs.writeFileSync(filePath, content, 'utf-8');
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const f of tempFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore cleanup errors
    }
  }
  tempFiles = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processHtmlReport', () => {
  // ── 1. Redaction replaces secret values with [REDACTED] ────────────────

  describe('redaction of secret values', () => {
    it('replaces authorization and x-api-key values with [REDACTED]', async () => {
      const filePath = createTempHtml(buildFixtureHtml());

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [authPattern, apiKeyPattern],
        noRules,
      );

      const outputHtml = fs.readFileSync(filePath, 'utf-8');

      // The original secret values must not appear in the output
      expect(outputHtml).not.toContain(
        'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature',
      );
      expect(outputHtml).not.toContain('my-secret-key-12345');

      // [REDACTED] should appear instead
      expect(outputHtml).toContain('[REDACTED]');

      // Parse the embedded JSON back out to verify structure
      const jsonMatch = outputHtml.match(
        /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s,
      );
      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![1]);
      expect(parsed.headers.authorization).toBe('[REDACTED]');
      expect(parsed.headers['x-api-key']).toBe('[REDACTED]');
    });
  });

  // ── 2. Correct redactionsApplied count ─────────────────────────────────

  describe('redactionsApplied count', () => {
    it('reports the correct number of redactions applied', async () => {
      const filePath = createTempHtml(buildFixtureHtml());

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [authPattern, apiKeyPattern],
        noRules,
      );

      expect(result.redactionsApplied).toBe(2);
    });

    it('reports 1 redaction when only one pattern matches', async () => {
      const filePath = createTempHtml(buildFixtureHtml());

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [authPattern],
        noRules,
      );

      expect(result.redactionsApplied).toBe(1);
    });
  });

  // ── 3. No matching patterns: file unchanged, 0 redactions ─────────────

  describe('no matching patterns', () => {
    it('writes the file unchanged and reports 0 redactionsApplied', async () => {
      const fixtureHtml = buildFixtureHtml();
      const filePath = createTempHtml(fixtureHtml);

      const nonMatchingPattern: RedactPattern = {
        id: 'no-match',
        key: 'x-nonexistent-header',
      };

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [nonMatchingPattern],
        noRules,
      );

      expect(result.redactionsApplied).toBe(0);

      // The output file should still contain the original secret values
      const outputHtml = fs.readFileSync(filePath, 'utf-8');
      expect(outputHtml).toContain(
        'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature',
      );
      expect(outputHtml).toContain('my-secret-key-12345');
    });

    it('writes the file unchanged when patterns array is empty', async () => {
      const fixtureHtml = buildFixtureHtml();
      const filePath = createTempHtml(fixtureHtml);

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [],
        noRules,
      );

      expect(result.redactionsApplied).toBe(0);
      expect(result.stepsRemoved).toBe(0);

      const outputHtml = fs.readFileSync(filePath, 'utf-8');
      expect(outputHtml).toContain(
        'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature',
      );
    });
  });

  // ── 4. Missing marker pattern: warning logged, 0 changes ──────────────

  describe('missing report data marker', () => {
    it('logs a warning and returns 0 changes when marker is not found', async () => {
      const htmlWithoutMarker =
        '<html><head><script>console.log("no data here");</script></head><body></body></html>';
      const filePath = createTempHtml(htmlWithoutMarker);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [authPattern],
        noRules,
      );

      expect(result.redactionsApplied).toBe(0);
      expect(result.stepsRemoved).toBe(0);
      expect(result.timestampRepairs).toBe(0);

      // The logger.warn calls console.warn with a [WARN] prefix
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not find embedded report data'),
      );

      warnSpy.mockRestore();
    });

    it('returns the input file path in result.file', async () => {
      const htmlWithoutMarker = '<html><body>plain page</body></html>';
      const filePath = createTempHtml(htmlWithoutMarker);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await processHtmlReport(
        filePath,
        filePath,
        inPlaceConfig,
        [authPattern],
        noRules,
      );

      expect(result.file).toBe(filePath);

      warnSpy.mockRestore();
    });
  });

  // ── 5. Step removal ───────────────────────────────────────────────────────

  describe('step removal', () => {
    /**
     * Build a report JSON whose steps use callId fields so that the
     * replaceEventsInReport traversal can verify tree-level filtering.
     */
    function buildRemovalFixtureJson(): { suites: unknown[] } {
      return {
        suites: [{
          title: 'suite',
          tests: [{
            results: [{
              steps: [
                { title: 'page.goto', startTime: 0, endTime: 100, callId: 'c1' },
                { title: 'waitForTimeout', startTime: 100, endTime: 300, callId: 'c2' },
                { title: 'locator.click', startTime: 300, endTime: 400, callId: 'c3' },
              ] as TraceEvent[],
            }],
          }],
        }],
      };
    }

    it('removes matched steps from the nested report tree', async () => {
      const reportJson = buildRemovalFixtureJson();
      const filePath = createTempHtml(buildFixtureHtml(reportJson));

      const waitRule: RemoveRule = { label: 'remove-wait', stepName: 'waitForTimeout' };
      const config: SanitizerConfig = { remove: {}, output: { mode: 'in-place' } };

      const result = await processHtmlReport(filePath, filePath, config, [], [waitRule]);

      expect(result.stepsRemoved).toBe(1);

      const html = fs.readFileSync(filePath, 'utf-8');
      const jsonMatch = html.match(
        /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s,
      );
      expect(jsonMatch).not.toBeNull();

      const parsed = JSON.parse(jsonMatch![1]) as typeof reportJson;
      const steps = parsed.suites[0]?.tests?.[0]?.results?.[0]?.steps as TraceEvent[];

      expect(steps).toHaveLength(2);
      expect(steps.every((s: TraceEvent) => s.title !== 'waitForTimeout')).toBe(true);
    });

    it('does not modify the report tree in dry-run mode', async () => {
      const reportJson = buildRemovalFixtureJson();
      const originalHtml = buildFixtureHtml(reportJson);
      const filePath = createTempHtml(originalHtml);

      const waitRule: RemoveRule = { label: 'remove-wait', stepName: 'waitForTimeout' };
      const config: SanitizerConfig = {
        remove: { dryRun: true },
        output: { mode: 'in-place' },
      };

      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await processHtmlReport(filePath, filePath, config, [], [waitRule]);
      infoSpy.mockRestore();

      // stepsRemoved is counted even in dry-run
      expect(result.stepsRemoved).toBe(1);

      // File on disk must be unchanged
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('waitForTimeout');
    });

    it("keeps matched parent step and removes its children with orphanStrategy 'keep-shell'", async () => {
      const reportJson = {
        suites: [{
          title: 'suite',
          tests: [{
            results: [{
              steps: [
                {
                  title: 'login',
                  startTime: 0,
                  endTime: 200,
                  callId: 'p1',
                  steps: [
                    { title: 'locator.fill', startTime: 10, endTime: 100, callId: 'c1', parentId: 'p1' },
                    { title: 'locator.click', startTime: 100, endTime: 200, callId: 'c2', parentId: 'p1' },
                  ],
                },
                { title: 'page.goto', startTime: 200, endTime: 300, callId: 'other' },
              ],
            }],
          }],
        }],
      };
      const filePath = createTempHtml(buildFixtureHtml(reportJson));

      const loginRule: RemoveRule = { label: 'strip-login', stepName: 'login' };
      const config: SanitizerConfig = {
        remove: { orphanStrategy: 'keep-shell' },
        output: { mode: 'in-place' },
      };

      const result = await processHtmlReport(filePath, filePath, config, [], [loginRule]);

      // Children removed, parent kept → stepsRemoved = 2
      expect(result.stepsRemoved).toBe(2);

      const html = fs.readFileSync(filePath, 'utf-8');
      const jsonMatch = html.match(
        /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s,
      );
      const parsed = JSON.parse(jsonMatch![1]) as typeof reportJson;
      const topSteps = parsed.suites[0]?.tests?.[0]?.results?.[0]?.steps as TraceEvent[];

      // Parent step "login" must remain
      expect(topSteps.some((s: TraceEvent) => s.title === 'login')).toBe(true);

      // "page.goto" sibling must remain
      expect(topSteps.some((s: TraceEvent) => s.title === 'page.goto')).toBe(true);

      // Children inside "login" step must be gone
      const loginStep = topSteps.find((s: TraceEvent) => s.title === 'login') as TraceEvent & { steps?: TraceEvent[] };
      expect(loginStep?.steps ?? []).toHaveLength(0);
    });

    it('reports safetyGuardWarnings when minConsecutiveOccurrences threshold is not met', async () => {
      const reportJson = {
        suites: [{
          title: 'suite',
          tests: [{
            results: [{
              steps: [
                // Only 1 occurrence — below threshold of 3
                { title: 'poll', startTime: 0, endTime: 50, callId: 'c1' },
                { title: 'other', startTime: 50, endTime: 100, callId: 'c2' },
              ],
            }],
          }],
        }],
      };
      const filePath = createTempHtml(buildFixtureHtml(reportJson));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const pollRule: RemoveRule = {
        label: 'remove-poll',
        stepName: 'poll',
        minConsecutiveOccurrences: 3,
      };
      const config: SanitizerConfig = { remove: {}, output: { mode: 'in-place' } };

      const result = await processHtmlReport(filePath, filePath, config, [], [pollRule]);

      expect(result.stepsRemoved).toBe(0);
      expect(result.safetyGuardWarnings).toHaveLength(1);
      expect(result.safetyGuardWarnings[0]).toContain('remove-poll');

      warnSpy.mockRestore();
    });
  });
});
