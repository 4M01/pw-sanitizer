/**
 * Integration tests for Playwright scripts that do NOT use `test.step` —
 * i.e. traces whose only step tree is the pw:api runner steps in `test.trace`,
 * each linked (via the `stepId` field) to library-side `call@N` events in
 * `0-trace.trace` and to `resource-snapshot` entries in `0-trace.network`.
 *
 * Fixture: tests/fixtures/real/no-steps/ — genuine artifacts from a real
 * @playwright/test 1.61 run of an APIRequestContext-only test (no `test.step`
 * anywhere; a local HTTP server, several GET calls including a repeated noisy
 * `/health/poll`). See tests/fixtures/real/README.md for regeneration.
 *
 * Regression coverage for the bug where removing a step only touched
 * `test.trace`: the library call, its `log` lines (URLs + headers), and the
 * network snapshots survived, and `stepId` references dangled.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import JSZip from 'jszip';
import { processTraceFile } from '../../src/processors/trace-file.js';
import { processHtmlReport } from '../../src/processors/html-report.js';
import type { SanitizerConfig, RemoveRule } from '../../src/config/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', 'fixtures', 'real', 'no-steps');

const TITLE_RULE: RemoveRule[] = [{ label: 'poll', stepName: 'GET "/health/poll"' }];
const URL_RULE: RemoveRule[] = [{ label: 'poll', url: '/health/poll' }];

let tmpDir: string;
function stage(name: string): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-steps-'));
  const dest = path.join(tmpDir, name);
  fs.copyFileSync(path.join(FIXTURES, name), dest);
  return dest;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

interface Line {
  type?: string;
  callId?: string;
  stepId?: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  [key: string]: unknown;
}

async function readEntryLines(zipPath: string, entry: string): Promise<Line[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const file = zip.file(entry);
  expect(file, `${entry} must exist`).not.toBeNull();
  return (await file!.async('string'))
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Line);
}

/** No dangling links, no orphan logs, no half-open steps (per file). */
async function assertArchiveConsistent(zipPath: string): Promise<void> {
  const test = await readEntryLines(zipPath, 'test.trace');
  const lib = await readEntryLines(zipPath, '0-trace.trace');

  for (const lines of [test, lib]) {
    const befores = new Set(
      lines.filter((l) => l.type === 'before').map((l) => l.callId)
    );
    const afters = new Set(
      lines.filter((l) => l.type === 'after').map((l) => l.callId)
    );
    for (const id of befores) {
      expect(afters.has(id), `before ${id} lost its after`).toBe(true);
    }
    for (const l of lines) {
      if (l.type === 'log') {
        expect(befores.has(l.callId), `orphan log for ${l.callId}`).toBe(true);
      }
    }
  }

  // Cross-file: every library event's stepId must reference a surviving
  // test-runner step (this is what the viewer merges actions on).
  const runnerIds = new Set(
    test.filter((l) => l.type === 'before').map((l) => l.callId)
  );
  for (const l of lib) {
    if (l.type === 'before' && typeof l.stepId === 'string') {
      expect(
        runnerIds.has(l.stepId),
        `library event ${l.callId} dangles on removed step ${l.stepId}`
      ).toBe(true);
    }
  }
}

describe('real no-test.step trace.zip', () => {
  it('fixture is genuine: pw:api runner steps + stepId-linked library calls, no test.step', async () => {
    const traceFixture = path.join(FIXTURES, 'trace.zip');
    const test = await readEntryLines(traceFixture, 'test.trace');
    const lib = await readEntryLines(traceFixture, '0-trace.trace');
    const net = await readEntryLines(traceFixture, '0-trace.network');

    expect(test.some((l) => l.callId?.startsWith('test.step@'))).toBe(false);
    const pollSteps = test.filter(
      (l) => l.type === 'before' && l.title === 'GET "/health/poll"'
    );
    expect(pollSteps.length).toBe(3);

    // Library calls are linked to runner steps via stepId and have NO title
    const linked = lib.filter(
      (l) => l.type === 'before' && typeof l.stepId === 'string'
    );
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every((l) => l.title === undefined)).toBe(true);

    // Network snapshots carry no callId at all
    const snapshots = net.filter((l) => l.type === 'resource-snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((l) => l.callId === undefined)).toBe(true);
  });

  it('REGRESSION: a stepName rule also removes linked library calls, logs, and network snapshots', async () => {
    const zipPath = stage('trace.zip');
    const config: SanitizerConfig = {
      output: { mode: 'in-place' },
      remove: {}, // remove-children default
      reporting: { logLevel: 'silent' },
    };

    const result = await processTraceFile(zipPath, zipPath, config, [], TITLE_RULE);
    // 3 pw:api runner steps + 3 linked library calls
    expect(result.stepsRemoved).toBe(6);

    const all = JSON.stringify([
      await readEntryLines(zipPath, 'test.trace'),
      await readEntryLines(zipPath, '0-trace.trace'),
      await readEntryLines(zipPath, '0-trace.network'),
    ]);
    expect(all).not.toContain('/health/poll');

    // Unrelated actions survive everywhere
    expect(all).toContain('/login');
    expect(all).toContain('/dashboard');

    await assertArchiveConsistent(zipPath);
  });

  it('a url rule produces the same clean result', async () => {
    const zipPath = stage('trace.zip');
    const config: SanitizerConfig = {
      output: { mode: 'in-place' },
      remove: {},
      reporting: { logLevel: 'silent' },
    };

    const result = await processTraceFile(zipPath, zipPath, config, [], URL_RULE);
    expect(result.stepsRemoved).toBe(6);

    const all = JSON.stringify([
      await readEntryLines(zipPath, 'test.trace'),
      await readEntryLines(zipPath, '0-trace.trace'),
      await readEntryLines(zipPath, '0-trace.network'),
    ]);
    expect(all).not.toContain('/health/poll');
    await assertArchiveConsistent(zipPath);
  });

  it('keep-shell: titled step stays as the roll-up of its hidden children, span untouched', async () => {
    const traceFixture = path.join(FIXTURES, 'trace.zip');
    const originalTest = await readEntryLines(traceFixture, 'test.trace');
    const originalSpans = new Map<string, [number, number]>();
    for (const l of originalTest) {
      if (l.type === 'before' && l.title === 'GET "/health/poll"') {
        originalSpans.set(l.callId!, [l.startTime!, NaN]);
      }
    }
    for (const l of originalTest) {
      if (l.type === 'after' && originalSpans.has(l.callId!)) {
        originalSpans.get(l.callId!)![1] = l.endTime!;
      }
    }

    const zipPath = stage('trace.zip');
    const config: SanitizerConfig = {
      output: { mode: 'in-place' },
      remove: { orphanStrategy: 'keep-shell' },
      reporting: { logLevel: 'silent' },
    };

    const result = await processTraceFile(zipPath, zipPath, config, [], TITLE_RULE);
    // Only the 3 linked library calls are hidden; the titled steps remain
    expect(result.stepsRemoved).toBe(3);
    // The kept shells still span the children's time — nothing was absorbed
    expect(result.timestampRepairs).toBe(0);

    const test = await readEntryLines(zipPath, 'test.trace');
    for (const [callId, [start, end]] of originalSpans) {
      const before = test.find((l) => l.type === 'before' && l.callId === callId);
      const after = test.find((l) => l.type === 'after' && l.callId === callId);
      expect(before, `kept shell ${callId} before event`).toBeTruthy();
      expect(after, `kept shell ${callId} after event`).toBeTruthy();
      expect(before!.startTime).toBe(start);
      expect(after!.endTime).toBe(end);
    }

    // All children hidden: library calls, their logs, and network snapshots
    const lib = JSON.stringify(await readEntryLines(zipPath, '0-trace.trace'));
    const net = JSON.stringify(await readEntryLines(zipPath, '0-trace.network'));
    expect(lib).not.toContain('/health/poll');
    expect(net).not.toContain('/health/poll');

    await assertArchiveConsistent(zipPath);
  });
});

describe('real no-test.step HTML report', () => {
  const TEMPLATE_RE =
    /<template id="playwrightReportBase64">data:application\/zip;base64,([^<]*)<\/template>/;

  async function shardSteps(htmlPath: string): Promise<Array<{ title?: string; steps?: unknown[] }>> {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const m = TEMPLATE_RE.exec(html);
    expect(m).not.toBeNull();
    const zip = await JSZip.loadAsync(Buffer.from(m![1]!, 'base64'));
    const names: string[] = [];
    zip.forEach((rel, e) => {
      if (!e.dir && rel.endsWith('.json') && rel !== 'report.json') names.push(rel);
    });
    const out: Array<{ title?: string; steps?: unknown[] }> = [];
    for (const name of names) {
      const shard = JSON.parse(await zip.file(name)!.async('string'));
      const walk = (steps: Array<{ title?: string; steps?: [] }>) => {
        for (const s of steps ?? []) {
          out.push(s);
          walk(s.steps ?? []);
        }
      };
      for (const t of shard.tests ?? []) {
        for (const r of t.results ?? []) walk(r.steps ?? []);
      }
    }
    return out;
  }

  it('pw:api steps appear as titled shard steps and are pruned by a stepName rule', async () => {
    const htmlPath = stage('index.html');

    const before = await shardSteps(htmlPath);
    expect(before.filter((s) => s.title === 'GET "/health/poll"')).toHaveLength(3);

    const config: SanitizerConfig = {
      output: { mode: 'in-place' },
      remove: {},
      reporting: { logLevel: 'silent' },
    };
    const result = await processHtmlReport(htmlPath, htmlPath, config, [], TITLE_RULE);
    expect(result.stepsRemoved).toBeGreaterThan(0);

    const after = await shardSteps(htmlPath);
    expect(after.some((s) => s.title === 'GET "/health/poll"')).toBe(false);
    expect(after.some((s) => s.title === 'GET "/login"')).toBe(true);
  });
});
