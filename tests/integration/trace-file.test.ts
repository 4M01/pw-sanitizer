import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import JSZip from 'jszip';
import { processTraceFile } from '../../src/processors/trace-file.js';
import type {
  SanitizerConfig,
  RedactPattern,
  RemoveRule,
} from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a temp directory that is cleaned up in afterEach. */
let tmpDir: string;

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-file-test-'));
  return tmpDir;
}

/** Builds a minimal trace .zip containing trace.json and network.json. */
async function buildFixtureZip(
  traceEvents: unknown[],
  networkEntries: unknown[],
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('trace.json', JSON.stringify(traceEvents));
  zip.file('network.json', JSON.stringify(networkEntries));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Reads a zip from disk and extracts a file as parsed JSON. */
async function readJsonFromZip(
  zipPath: string,
  entryName: string,
): Promise<unknown> {
  const data = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(data);
  const file = zip.file(entryName);
  if (!file) throw new Error(`${entryName} not found in zip`);
  const content = await file.async('string');
  return JSON.parse(content);
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const traceEvents = [
  {
    title: 'page.goto',
    startTime: 0,
    endTime: 100,
    url: 'https://example.com/api/health',
    actionType: 'page.goto',
    callId: 'c1',
    requestId: 'r1',
  },
  {
    title: 'page.goto',
    startTime: 100,
    endTime: 200,
    url: 'https://example.com/login',
    actionType: 'page.goto',
    callId: 'c2',
  },
  {
    title: 'locator.fill',
    startTime: 200,
    endTime: 300,
    selector: '#password',
    actionType: 'locator.fill',
    callId: 'c3',
  },
];

const networkEntries = [
  {
    requestId: 'r1',
    url: 'https://example.com/api/health',
    headers: { authorization: 'Bearer secret123' },
  },
  {
    requestId: 'r2',
    url: 'https://example.com/login',
    headers: { 'x-api-key': 'my-key' },
  },
];

/** In-place config shared across tests. */
const inPlaceConfig: SanitizerConfig = {
  output: { mode: 'in-place' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processTraceFile (integration)', () => {
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── 1. Redaction ──────────────────────────────────────────────────────────

  describe('redaction', () => {
    it('redacts header values matching redact patterns in network.json', async () => {
      const dir = createTmpDir();
      const zipPath = path.join(dir, 'trace.zip');
      fs.writeFileSync(zipPath, await buildFixtureZip(traceEvents, networkEntries));

      const patterns: RedactPattern[] = [
        { id: 'auth-header', key: 'authorization' },
        { id: 'api-key', key: 'x-api-key' },
      ];

      const config: SanitizerConfig = {
        ...inPlaceConfig,
        redact: { placeholder: '[REDACTED]' },
      };

      const result = await processTraceFile(zipPath, zipPath, config, patterns, []);

      expect(result.redactionsApplied).toBeGreaterThanOrEqual(2);

      const network = (await readJsonFromZip(zipPath, 'network.json')) as Array<{
        headers: Record<string, string>;
      }>;

      expect(network[0].headers.authorization).toBe('[REDACTED]');
      expect(network[1].headers['x-api-key']).toBe('[REDACTED]');
    });
  });

  // ── 2. Removal ────────────────────────────────────────────────────────────

  describe('removal', () => {
    it('removes trace events matching a URL rule and cleans up corresponding network entries', async () => {
      const dir = createTmpDir();
      const zipPath = path.join(dir, 'trace.zip');
      fs.writeFileSync(zipPath, await buildFixtureZip(traceEvents, networkEntries));

      const rules: RemoveRule[] = [
        { label: 'remove-health', url: '/api/health' },
      ];

      const config: SanitizerConfig = {
        ...inPlaceConfig,
        remove: {},
      };

      const result = await processTraceFile(zipPath, zipPath, config, [], rules);

      expect(result.stepsRemoved).toBe(1);

      // trace.json should no longer contain the health event
      const trace = (await readJsonFromZip(zipPath, 'trace.json')) as Array<{
        url?: string;
        callId?: string;
      }>;
      const healthEvents = trace.filter((e) => e.url?.includes('/api/health'));
      expect(healthEvents).toHaveLength(0);

      // The remaining events should still be present
      expect(trace.some((e) => e.callId === 'c2')).toBe(true);
      expect(trace.some((e) => e.callId === 'c3')).toBe(true);

      // network.json should have removed the entry with requestId 'r1'
      const network = (await readJsonFromZip(zipPath, 'network.json')) as Array<{
        requestId: string;
      }>;
      expect(network.some((e) => e.requestId === 'r1')).toBe(false);
      expect(network.some((e) => e.requestId === 'r2')).toBe(true);
    });
  });

  // ── 3. Redaction + removal together ───────────────────────────────────────

  describe('redaction and removal combined', () => {
    it('applies both redaction and removal in a single pass', async () => {
      const dir = createTmpDir();
      const zipPath = path.join(dir, 'trace.zip');
      fs.writeFileSync(zipPath, await buildFixtureZip(traceEvents, networkEntries));

      const patterns: RedactPattern[] = [
        { id: 'auth-header', key: 'authorization' },
        { id: 'api-key', key: 'x-api-key' },
      ];

      const rules: RemoveRule[] = [
        { label: 'remove-health', url: '/api/health' },
      ];

      const config: SanitizerConfig = {
        ...inPlaceConfig,
        redact: { placeholder: '[REDACTED]' },
        remove: {},
      };

      const result = await processTraceFile(zipPath, zipPath, config, patterns, rules);

      // Removal should have removed the health step
      expect(result.stepsRemoved).toBe(1);
      // Redaction should have redacted at least the headers
      expect(result.redactionsApplied).toBeGreaterThanOrEqual(2);

      // Verify trace.json: health event removed
      const trace = (await readJsonFromZip(zipPath, 'trace.json')) as Array<{
        url?: string;
      }>;
      expect(trace.every((e) => !e.url?.includes('/api/health'))).toBe(true);

      // Verify network.json: r1 removed, remaining headers redacted
      const network = (await readJsonFromZip(zipPath, 'network.json')) as Array<{
        requestId: string;
        headers: Record<string, string>;
      }>;

      // r1 entry (health) should be removed entirely
      expect(network.some((e) => e.requestId === 'r1')).toBe(false);

      // r2 entry should remain with its header redacted
      const r2Entry = network.find((e) => e.requestId === 'r2');
      expect(r2Entry).toBeDefined();
      expect(r2Entry!.headers['x-api-key']).toBe('[REDACTED]');
    });
  });

  // ── 4. Unreadable zip ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns an empty result and does not throw when the zip file is unreadable', async () => {
      const dir = createTmpDir();
      const zipPath = path.join(dir, 'corrupt.zip');
      fs.writeFileSync(zipPath, 'this is not a valid zip file');

      const config: SanitizerConfig = {
        ...inPlaceConfig,
        redact: { placeholder: '[REDACTED]' },
        remove: {},
      };

      const patterns: RedactPattern[] = [
        { id: 'auth-header', key: 'authorization' },
      ];
      const rules: RemoveRule[] = [
        { label: 'remove-health', url: '/api/health' },
      ];

      const result = await processTraceFile(zipPath, zipPath, config, patterns, rules);

      expect(result.redactionsApplied).toBe(0);
      expect(result.stepsRemoved).toBe(0);
      expect(result.timestampRepairs).toBe(0);
      expect(result.redactionMatches).toEqual([]);
      expect(result.removalMatches).toEqual([]);
    });

    it('returns an empty result when the file does not exist', async () => {
      const dir = createTmpDir();
      const zipPath = path.join(dir, 'nonexistent.zip');

      const config: SanitizerConfig = {
        ...inPlaceConfig,
      };

      const result = await processTraceFile(zipPath, zipPath, config, [], []);

      expect(result.redactionsApplied).toBe(0);
      expect(result.stepsRemoved).toBe(0);
      expect(result.file).toBe(zipPath);
    });
  });
});
