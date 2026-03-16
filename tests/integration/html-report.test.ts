import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { processHtmlReport } from '../../src/processors/html-report.js';
import type {
  SanitizerConfig,
  RedactPattern,
  RemoveRule,
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
});
