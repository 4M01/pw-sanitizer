/**
 * Tests for per-rule `orphanStrategy` (mixed strategies in ONE sanitize pass).
 *
 * The motivating real consumer config:
 *   - global `orphanStrategy: 'keep-shell'`
 *   - rule A: stepName /waitForSpinnerToDisappear/i  → 'keep-shell'
 *     (the parent polling step stays visible; its polling children are stripped)
 *   - rules B/C: stepName 'Wait for timeout' / 'Wait for selector' → 'remove-children'
 *     (leaf explicit-wait steps that would otherwise survive as empty shells)
 *
 * Fixtures use the real Playwright >= 1.40 trace format: an NDJSON `test.trace`
 * (runner steps nested via parentId→callId) plus a `0-trace.trace` browser
 * stream correlated back to runner steps via the `stepId` field. The HTML
 * report fixture embeds the report data as a base64 zip whose shard holds a
 * nested `steps[]` tree.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { processTraceFile } from '../../src/processors/trace-file.js';
import { processHtmlReport } from '../../src/processors/html-report.js';
import { generateSummary } from '../../src/reporter.js';
import { setLogLevel } from '../../src/logger.js';
import type { SanitizerConfig, RemoveRule, ProcessResult } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Trace fixture (NDJSON test.trace + correlated browser stream)
// ---------------------------------------------------------------------------

interface Line { [k: string]: unknown }

/**
 * test.trace tree:
 *   test.step@10 "waitForSpinnerToDisappear"     (keep-shell target)
 *     pw:api@11 "isVisible"                       (polling child → stripped)
 *     pw:api@12 "isVisible"                       (polling child → stripped)
 *   test.step@20 "Wait for timeout"              (remove-children leaf)
 *     pw:api@21 "waitForTimeout"
 *   test.step@30 "Wait for selector"             (remove-children leaf)
 *     pw:api@31 "waitForSelector"
 *   test.step@40 "assert dashboard"              (unrelated, kept)
 *     pw:api@41 "click"
 *
 * 0-trace.trace: browser before/after actions linked via `stepId`, plus
 * frame-snapshots (callId at snapshot.callId) and a fire-and-forget event that
 * references pw:api@11 ONLY through stepId.
 */
function buildTraceZip(): Promise<Buffer> {
  let t = 1000;
  const tick = (d = 5) => (t += d);
  const j = (o: Line) => JSON.stringify(o);

  const test: string[] = [];
  test.push(j({ version: 8, type: 'context-options', origin: 'testRunner', browserName: 'chromium', playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165, monotonicTime: tick(), sdkLanguage: 'javascript', title: 'per-rule.spec.ts:3 › mixed strategies' }));

  const step = (callId: string, title: string, parentId?: string, method = 'test.step') => {
    const before: Line = { type: 'before', callId, stepId: callId, startTime: tick(), class: 'Test', method, title, params: {} };
    if (parentId) before.parentId = parentId;
    test.push(j(before));
    return { after: () => test.push(j({ type: 'after', callId, endTime: tick() })) };
  };

  const s10 = step('test.step@10', 'waitForSpinnerToDisappear');
  const a11 = step('pw:api@11', 'isVisible', 'test.step@10', 'pw:api'); a11.after();
  const a12 = step('pw:api@12', 'isVisible', 'test.step@10', 'pw:api'); a12.after();
  s10.after();
  const s20 = step('test.step@20', 'Wait for timeout');
  const a21 = step('pw:api@21', 'waitForTimeout', 'test.step@20', 'pw:api'); a21.after();
  s20.after();
  const s30 = step('test.step@30', 'Wait for selector');
  const a31 = step('pw:api@31', 'waitForSelector', 'test.step@30', 'pw:api'); a31.after();
  s30.after();
  const s40 = step('test.step@40', 'assert dashboard');
  const a41 = step('pw:api@41', 'click', 'test.step@40', 'pw:api'); a41.after();
  s40.after();

  const brow: string[] = [];
  brow.push(j({ version: 8, type: 'context-options', origin: 'library', browserName: 'chromium', playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165, monotonicTime: tick(), sdkLanguage: 'javascript', contextId: 'browser-context@abc', title: 'per-rule' }));

  const action = (callId: string, stepId: string, method: string, opts: { selector?: string; snapshots?: boolean; log?: boolean } = {}) => {
    const before: Line = { type: 'before', callId, startTime: tick(), class: 'Frame', method, params: opts.selector ? { selector: opts.selector } : {}, stepId, pageId: 'page@1' };
    if (opts.snapshots) before.beforeSnapshot = `before@${callId}`;
    brow.push(j(before));
    if (opts.snapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `before@${callId}`, pageId: 'page@1', frameId: 'frame@1', html: ['HTML', {}], timestamp: tick(1) } }));
    if (opts.log) brow.push(j({ type: 'log', callId, time: tick(1), message: `running ${method}` }));
    brow.push(j({ type: 'after', callId, endTime: tick() }));
    if (opts.snapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `after@${callId}`, pageId: 'page@1', frameId: 'frame@1', html: ['HTML', {}], timestamp: tick(1) } }));
  };

  // Spinner polling browser calls (children of the keep-shell parent).
  for (let i = 0; i < 8; i++) action(`call@${100 + i}`, 'pw:api@11', 'isVisible', { selector: '#spinner', snapshots: true, log: true });
  // Fire-and-forget event referencing pw:api@11 ONLY via stepId.
  brow.push(j({ type: 'event', callId: 'call@199', stepId: 'pw:api@11', time: tick(1), class: 'Frame', method: 'navigated', params: {} }));
  for (let i = 0; i < 8; i++) action(`call@${120 + i}`, 'pw:api@12', 'isVisible', { selector: '#spinner' });
  // Leaf browser calls.
  action('call@210', 'pw:api@21', 'waitForTimeout');
  action('call@310', 'pw:api@31', 'waitForSelector', { selector: '#late', snapshots: true });
  // Kept subtree browser call.
  action('call@410', 'pw:api@41', 'click', { selector: '#ok', snapshots: true });

  const zip = new JSZip();
  zip.file('test.trace', test.join('\n') + '\n');
  zip.file('0-trace.trace', brow.join('\n') + '\n');
  zip.file('0-trace.network', '');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// HTML report fixture (base64-zip, nested shard step tree)
// ---------------------------------------------------------------------------

function buildReportHtml(): Promise<string> {
  const iso = (ms: number) => new Date(1_700_000_000_000 + ms).toISOString();
  const shard = {
    tests: [{
      results: [{
        steps: [
          {
            title: 'waitForSpinnerToDisappear', startTime: iso(0), duration: 100, count: 1,
            steps: [
              { title: 'isVisible', startTime: iso(0), duration: 40 },
              { title: 'isVisible', startTime: iso(40), duration: 40 },
            ],
          },
          { title: 'Wait for timeout', startTime: iso(100), duration: 50, steps: [] },
          { title: 'Wait for selector', startTime: iso(150), duration: 50, steps: [] },
          { title: 'expect.toBeVisible', startTime: iso(200), duration: 10 },
        ],
      }],
    }],
  };
  const zip = new JSZip();
  zip.file('report.json', JSON.stringify({ files: [], stats: {} }));
  zip.file('0000.json', JSON.stringify(shard));
  return zip.generateAsync({ type: 'base64' }).then(
    (b64) => `<html><head></head><body><script>window.playwrightReportBase64 = "data:application/zip;base64,${b64}";</script></body></html>`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
async function stageZip(): Promise<string> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perrule-'));
  const p = path.join(tmpDir, 'trace.zip');
  fs.writeFileSync(p, await buildTraceZip());
  return p;
}
async function stageHtml(): Promise<string> {
  tmpDir = tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'perrule-'));
  const p = path.join(tmpDir, 'index.html');
  fs.writeFileSync(p, await buildReportHtml());
  return p;
}
function cleanup() {
  setLogLevel('normal');
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined as unknown as string;
}

async function readStreams(zipPath: string): Promise<Record<string, Line[]>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const out: Record<string, Line[]> = {};
  const names: string[] = [];
  zip.forEach((rel, e) => { if (!e.dir && rel.endsWith('.trace')) names.push(rel); });
  for (const n of names) {
    const c = await zip.file(n)!.async('string');
    out[n] = c.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Line);
  }
  return out;
}

const before = (evts: Line[]) => evts.filter((e) => e.type === 'before');
const callIdsOf = (evts: Line[]) => new Set(before(evts).map((e) => e.callId as string));

/** Every surviving event across every stream that still points at a removed callId. */
function danglingRefs(streams: Record<string, Line[]>): Line[] {
  const survivingTest = callIdsOf(streams['test.trace'] ?? []);
  const dangling: Line[] = [];
  for (const [name, evts] of Object.entries(streams)) {
    const localBefore = callIdsOf(evts);
    for (const o of evts) {
      const sid = typeof o.stepId === 'string' ? o.stepId : undefined;
      if (name !== 'test.trace' && sid && sid !== o.callId && !survivingTest.has(sid)) dangling.push(o);
      const pid = typeof o.parentId === 'string' ? o.parentId : undefined;
      if (pid && name === 'test.trace' && !survivingTest.has(pid) && !localBefore.has(pid)) dangling.push(o);
      const snap = o.snapshot as { callId?: string } | undefined;
      if (o.type === 'frame-snapshot' && snap?.callId && !localBefore.has(snap.callId)) dangling.push(o);
    }
  }
  return dangling;
}

async function decodeReport(htmlPath: string): Promise<Record<string, unknown>> {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const m = /playwrightReportBase64\s*=\s*"data:application\/zip;base64,([A-Za-z0-9+/=]*)"/.exec(html);
  const zip = await JSZip.loadAsync(Buffer.from(m![1]!, 'base64'));
  return JSON.parse(await zip.file('0000.json')!.async('string')) as Record<string, unknown>;
}
function reportSteps(shard: Record<string, unknown>): Array<Record<string, unknown>> {
  const tests = shard['tests'] as Array<Record<string, unknown>>;
  const results = tests[0]!['results'] as Array<Record<string, unknown>>;
  return results[0]!['steps'] as Array<Record<string, unknown>>;
}

const MIXED_RULES: RemoveRule[] = [
  { label: 'spinner internals', stepName: /waitForSpinnerToDisappear/i, orphanStrategy: 'keep-shell' },
  { label: 'timeout noise', stepName: 'Wait for timeout', orphanStrategy: 'remove-children' },
  { label: 'selector noise', stepName: 'Wait for selector', orphanStrategy: 'remove-children' },
];

function cfg(remove: Partial<NonNullable<SanitizerConfig['remove']>>): SanitizerConfig {
  return { output: { mode: 'in-place' }, remove: { ...remove }, reporting: { logLevel: 'silent' } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('per-rule orphanStrategy', () => {
  afterEach(cleanup);

  it('(1) mixed config in ONE pass: spinner kept as shell, leaf waits fully removed — trace + browser streams', async () => {
    const zipPath = await stageZip();
    const result = await processTraceFile(
      zipPath, zipPath, cfg({ orphanStrategy: 'keep-shell', rules: MIXED_RULES }), [], MIXED_RULES
    );

    const after = await readStreams(zipPath);
    const survTest = callIdsOf(after['test.trace']);
    const survBrow = callIdsOf(after['0-trace.trace']);

    // Spinner shell KEPT: both before and after present, zero descendants.
    expect(after['test.trace'].some((l) => l.type === 'before' && l.callId === 'test.step@10')).toBe(true);
    expect(after['test.trace'].some((l) => l.type === 'after' && l.callId === 'test.step@10')).toBe(true);
    for (const id of ['pw:api@11', 'pw:api@12']) expect(survTest.has(id), `${id} stripped`).toBe(false);
    // Spinner's browser polling calls gone.
    for (let i = 0; i < 8; i++) {
      expect(survBrow.has(`call@${100 + i}`)).toBe(false);
      expect(survBrow.has(`call@${120 + i}`)).toBe(false);
    }

    // Leaf waits FULLY removed (before+after) from test.trace and browser stream.
    for (const id of ['test.step@20', 'pw:api@21', 'test.step@30', 'pw:api@31']) {
      expect(survTest.has(id), `${id} removed`).toBe(false);
    }
    expect(after['test.trace'].some((l) => l.callId === 'test.step@20')).toBe(false);
    expect(after['test.trace'].some((l) => l.callId === 'test.step@30')).toBe(false);
    expect(survBrow.has('call@210')).toBe(false);
    expect(survBrow.has('call@310')).toBe(false);

    // Unrelated subtree untouched.
    expect(survTest.has('test.step@40')).toBe(true);
    expect(survTest.has('pw:api@41')).toBe(true);
    expect(survBrow.has('call@410')).toBe(true);

    // Counters agree.
    expect(result.removalMatches.length).toBe(result.stepsRemoved);
    expect(result.stepsRemoved).toBeGreaterThan(0);
  });

  it('(1b) mixed config also prunes the base64 HTML report step tree', async () => {
    const htmlPath = await stageHtml();
    await processHtmlReport(
      htmlPath, htmlPath, cfg({ orphanStrategy: 'keep-shell', rules: MIXED_RULES }), [], MIXED_RULES
    );

    const steps = reportSteps(await decodeReport(htmlPath));
    const titles = steps.map((s) => s['title']);

    // Spinner kept as an empty shell.
    expect(titles).toContain('waitForSpinnerToDisappear');
    const spinner = steps.find((s) => s['title'] === 'waitForSpinnerToDisappear')!;
    expect((spinner['steps'] as unknown[]) ?? []).toHaveLength(0);

    // Leaf waits deleted from the tree; sibling kept.
    expect(titles).not.toContain('Wait for timeout');
    expect(titles).not.toContain('Wait for selector');
    expect(titles).toContain('expect.toBeVisible');
  });

  it('(2) no surviving event references a removed callId via stepId or parentId', async () => {
    const zipPath = await stageZip();
    await processTraceFile(
      zipPath, zipPath, cfg({ orphanStrategy: 'keep-shell', rules: MIXED_RULES }), [], MIXED_RULES
    );
    const after = await readStreams(zipPath);
    expect(danglingRefs(after)).toHaveLength(0);
  });

  it('(3) rule without orphanStrategy falls back to global, and global-absent falls back to remove-children', async () => {
    const rule: RemoveRule[] = [{ label: 'spinner', stepName: /waitForSpinnerToDisappear/i }]; // no per-rule strategy

    // (a) global keep-shell → the rule inherits keep-shell → spinner kept as shell.
    const pA = await stageZip();
    await processTraceFile(pA, pA, cfg({ orphanStrategy: 'keep-shell', rules: rule }), [], rule);
    const afterA = await readStreams(pA);
    expect(afterA['test.trace'].some((l) => l.type === 'before' && l.callId === 'test.step@10')).toBe(true);
    expect(afterA['test.trace'].some((l) => l.type === 'after' && l.callId === 'test.step@10')).toBe(true);
    expect(callIdsOf(afterA['test.trace']).has('pw:api@11')).toBe(false);
    expect(danglingRefs(afterA)).toHaveLength(0);
    cleanup();

    // (b) global absent → default remove-children → spinner removed entirely.
    const pB = await stageZip();
    await processTraceFile(pB, pB, cfg({ rules: rule }), [], rule);
    const afterB = await readStreams(pB);
    expect(afterB['test.trace'].some((l) => l.callId === 'test.step@10')).toBe(false);
    expect(callIdsOf(afterB['test.trace']).has('pw:api@11')).toBe(false);
    expect(danglingRefs(afterB)).toHaveLength(0);
  });

  it('(4) conflicting rules on one step → most destructive (remove-children) wins + verbose warning', async () => {
    const conflict: RemoveRule[] = [
      { label: 'keep it', stepName: 'waitForSpinnerToDisappear', orphanStrategy: 'keep-shell' },
      { label: 'nuke it', stepName: /Spinner/, orphanStrategy: 'remove-children' },
    ];
    setLogLevel('verbose');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const zipPath = await stageZip();
    const result = await processTraceFile(
      zipPath, zipPath, cfg({ orphanStrategy: 'keep-shell', rules: conflict }), [], conflict
    );

    const after = await readStreams(zipPath);
    // remove-children wins: the spinner step itself is gone (not kept as a shell).
    expect(after['test.trace'].some((l) => l.callId === 'test.step@10')).toBe(false);
    expect(callIdsOf(after['test.trace']).has('pw:api@11')).toBe(false);

    const loggedConflict = logSpy.mock.calls
      .map((c) => String(c[0]))
      .some((m) => m.includes('[VERBOSE]') && m.toLowerCase().includes('conflicting orphanstrategy'));
    expect(loggedConflict).toBe(true);

    logSpy.mockRestore();
    expect(result.stepsRemoved).toBeGreaterThan(0);
    expect(danglingRefs(after)).toHaveLength(0);
  });

  it('(5) timestamps stay monotonic and summary per-rule counts sum to the total', async () => {
    const zipPath = await stageZip();
    const remove = { orphanStrategy: 'keep-shell' as const, rules: MIXED_RULES };
    const result: ProcessResult = await processTraceFile(zipPath, zipPath, cfg(remove), [], MIXED_RULES);

    const after = await readStreams(zipPath);

    // Monotonic non-decreasing startTime among surviving runner before-events,
    // and endTime >= startTime for each.
    const survBefore = before(after['test.trace']).filter((e) => typeof e.startTime === 'number');
    const byCall = new Map<string, Line>();
    for (const e of after['test.trace']) if (e.type === 'after') byCall.set(e.callId as string, e);
    let prev = -Infinity;
    for (const b of survBefore) {
      const st = b.startTime as number;
      expect(st).toBeGreaterThanOrEqual(prev);
      prev = st;
      const a = byCall.get(b.callId as string);
      if (a && typeof a.endTime === 'number') expect(a.endTime).toBeGreaterThanOrEqual(st);
    }

    // Per-rule counts sum to the reported total (real run).
    const summary = generateSummary([result], cfg(remove), 0, MIXED_RULES.length, []);
    const sum = summary.remove.byRuleLabel.reduce((n, e) => n + e.count, 0);
    expect(summary.remove.totalStepsDeleted).toBe(sum);
    expect(sum).toBe(result.stepsRemoved);
    expect(sum).toBeGreaterThan(0);
  });
});
