/**
 * Regression tests for the cross-stream (two-trace-stream) removal fix.
 *
 * A modern Playwright `trace.zip` holds TWO correlated NDJSON event streams:
 *
 *   - `test.trace`      — test-runner steps, nested via `parentId` → `callId`.
 *   - `0-trace.trace`,… — browser-context actions, in their OWN callId
 *                          namespace, linked back to a runner step only through
 *                          the `stepId` field (before/after actions) or, for
 *                          `frame-snapshot` lines, through `snapshot.callId`.
 *
 * Before the fix, removing a step from `test.trace` left the correlated
 * browser-side events behind: they kept a dangling `stepId`, so the trace
 * viewer rendered them as loose "orphan" rows even though `test.trace` was
 * clean. These tests build a real-format archive with a step nested THREE
 * levels deep whose leaves have browser children, then assert that removal
 * spans both streams and the per-rule/total counters agree.
 *
 * The fixture is assembled in-memory (not hand-waved) using the exact event
 * shapes a genuine Playwright 1.61 trace emits — verified against
 * tests/fixtures/playwright-project/.../trace.zip in this repo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { processTraceFile } from '../../src/processors/trace-file.js';
import { generateSummary } from '../../src/reporter.js';
import type { SanitizerConfig, RemoveRule, ProcessResult } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Real-format fixture builder
// ---------------------------------------------------------------------------

interface Line { [k: string]: unknown }

/**
 * Builds a trace.zip whose `test.trace` contains:
 *   test.step@10 "outer login flow"        (L1)
 *     test.step@11 "wait for spinner"       (L2)
 *       pw:api@12 "Wait for selector"       (L3, browser-backed)
 *       pw:api@13 "Is visible"              (L3, browser-backed)
 *     pw:api@14 "Wait for event info"       (L2, browser-backed)
 *   test.step@20 "assert dashboard"         (unrelated, kept)
 *     pw:api@21 "Wait for selector"         (browser-backed, kept)
 *
 * and a `0-trace.trace` with browser before/after actions linked by `stepId`,
 * plus `frame-snapshot` lines (callId nested at snapshot.callId), a `log`, and
 * one fire-and-forget `event` that references pw:api@12 only via `stepId`.
 */
function buildTraceZip(): Promise<Buffer> {
  let t = 1000;
  const tick = (d = 5) => (t += d);
  const j = (o: Line) => JSON.stringify(o);

  const test: string[] = [];
  test.push(j({ version: 8, type: 'context-options', origin: 'testRunner', browserName: 'chromium', playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165, monotonicTime: tick(), sdkLanguage: 'javascript', title: 'nested-browser.spec.ts:3 › nested step with browser children' }));

  const step = (callId: string, title: string, parentId?: string, method = 'test.step') => {
    const before: Line = { type: 'before', callId, stepId: callId, startTime: tick(), class: 'Test', method, title, params: {} };
    if (parentId) before.parentId = parentId;
    test.push(j(before));
    return { after: () => test.push(j({ type: 'after', callId, endTime: tick() })) };
  };

  const s10 = step('test.step@10', 'outer login flow');
  const s11 = step('test.step@11', 'wait for spinner', 'test.step@10');
  const a12 = step('pw:api@12', 'Wait for selector', 'test.step@11', 'pw:api'); a12.after();
  const a13 = step('pw:api@13', 'Is visible', 'test.step@11', 'pw:api'); a13.after();
  s11.after();
  const a14 = step('pw:api@14', 'Wait for event info', 'test.step@10', 'pw:api'); a14.after();
  s10.after();
  const s20 = step('test.step@20', 'assert dashboard');
  const e21 = step('pw:api@21', 'Wait for selector', 'test.step@20', 'pw:api'); e21.after();
  s20.after();

  const brow: string[] = [];
  brow.push(j({ version: 8, type: 'context-options', origin: 'library', browserName: 'chromium', playwrightVersion: '1.61.1', options: {}, platform: 'linux', wallTime: 1784137391165, monotonicTime: tick(), sdkLanguage: 'javascript', contextId: 'browser-context@abc', title: 'nested-browser' }));

  const action = (callId: string, stepId: string, method: string, opts: { selector?: string; snapshots?: boolean; log?: boolean } = {}) => {
    const before: Line = { type: 'before', callId, startTime: tick(), class: 'Frame', method, params: opts.selector ? { selector: opts.selector } : {}, stepId, pageId: 'page@1' };
    if (opts.snapshots) before.beforeSnapshot = `before@${callId}`;
    brow.push(j(before));
    if (opts.snapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `before@${callId}`, pageId: 'page@1', frameId: 'frame@1', html: ['HTML', {}], timestamp: tick(1) } }));
    if (opts.log) brow.push(j({ type: 'log', callId, time: tick(1), message: `running ${method}` }));
    brow.push(j({ type: 'after', callId, endTime: tick() }));
    if (opts.snapshots) brow.push(j({ type: 'frame-snapshot', snapshot: { callId, snapshotName: `after@${callId}`, pageId: 'page@1', frameId: 'frame@1', html: ['HTML', {}], timestamp: tick(1) } }));
  };

  for (let i = 0; i < 10; i++) action(`call@${100 + i}`, 'pw:api@12', 'waitForSelector', { selector: '#spinner', snapshots: true, log: true });
  // Fire-and-forget event that references pw:api@12 ONLY through stepId (its
  // callId never had a `before`, so a callId-only sweep would miss it).
  brow.push(j({ type: 'event', callId: 'call@199', stepId: 'pw:api@12', time: tick(1), class: 'Frame', method: 'navigated', params: {} }));
  for (let i = 0; i < 5; i++) action(`call@${120 + i}`, 'pw:api@13', 'isVisible', { selector: '#spinner' });
  for (let i = 0; i < 60; i++) action(`call@${200 + i}`, 'pw:api@14', 'waitForEventInfo');
  // Kept browser child under the surviving subtree — must NOT be removed.
  action('call@900', 'pw:api@21', 'waitForSelector', { selector: '#dashboard', snapshots: true });

  const zip = new JSZip();
  zip.file('test.trace', test.join('\n') + '\n');
  zip.file('0-trace.trace', brow.join('\n') + '\n');
  zip.file('0-trace.network', '');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
async function stageZip(): Promise<string> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xstream-'));
  const p = path.join(tmpDir, 'trace.zip');
  fs.writeFileSync(p, await buildTraceZip());
  return p;
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
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

/** Every event across every browser stream that still points at a removed callId. */
function danglingRefs(streams: Record<string, Line[]>): Line[] {
  const survivingTest = callIdsOf(streams['test.trace'] ?? []);
  const dangling: Line[] = [];
  for (const [name, evts] of Object.entries(streams)) {
    if (name === 'test.trace') continue;
    const localBefore = callIdsOf(evts);
    for (const o of evts) {
      const sid = typeof o.stepId === 'string' ? o.stepId : undefined;
      if (sid && sid !== o.callId && !survivingTest.has(sid)) dangling.push(o);
      const snap = o.snapshot as { callId?: string } | undefined;
      if (o.type === 'frame-snapshot' && snap?.callId && !localBefore.has(snap.callId)) dangling.push(o);
    }
  }
  return dangling;
}

async function run(zipPath: string, rules: RemoveRule[], config: Partial<SanitizerConfig['remove']>): Promise<ProcessResult> {
  const cfg: SanitizerConfig = { output: { mode: 'in-place' }, remove: { ...config }, reporting: { logLevel: 'silent' } as unknown as SanitizerConfig['reporting'] };
  return processTraceFile(zipPath, zipPath, cfg, [], rules);
}

const OUTER_RULE: RemoveRule[] = [{ label: 'drop login flow', stepName: 'outer login flow' }];
const MIDDLE_RULE: RemoveRule[] = [{ label: 'drop spinner wait', stepName: 'wait for spinner' }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cross-stream orphan removal', () => {
  afterEach(cleanup);

  it('(3) keep-shell: shell kept with paired before/after, zero descendants, no dangling stepId in ANY stream', async () => {
    const zipPath = await stageZip();
    const original = await readStreams(zipPath);
    const removedTestIds = new Set([...callIdsOf(original['test.trace'])]);

    const result = await run(zipPath, OUTER_RULE, { orphanStrategy: 'keep-shell' });

    const after = await readStreams(zipPath);
    const survivingTest = callIdsOf(after['test.trace']);

    // The shell (matched step) is KEPT with both before and after events.
    expect(after['test.trace'].some((l) => l.type === 'before' && l.callId === 'test.step@10')).toBe(true);
    expect(after['test.trace'].some((l) => l.type === 'after' && l.callId === 'test.step@10')).toBe(true);

    // ...but every one of its descendants is gone from test.trace.
    for (const id of ['test.step@11', 'pw:api@12', 'pw:api@13', 'pw:api@14']) {
      expect(survivingTest.has(id), `${id} should be removed`).toBe(false);
    }
    // Unrelated subtree untouched.
    expect(survivingTest.has('test.step@20')).toBe(true);
    expect(survivingTest.has('pw:api@21')).toBe(true);

    // No event in ANY browser stream references a removed callId (the core bug).
    const dangling = danglingRefs(after);
    expect(dangling, `found ${dangling.length} orphan(s)`).toHaveLength(0);

    // The kept subtree's browser child survives.
    expect(callIdsOf(after['0-trace.trace']).has('call@900')).toBe(true);

    // Counters agree.
    expect(result.removalMatches.length).toBe(result.stepsRemoved);
    void removedTestIds;
  });

  it('(4) sanitized archive stays viewer-compatible: no orphan browser rows at the root', async () => {
    const zipPath = await stageZip();
    await run(zipPath, OUTER_RULE, { orphanStrategy: 'remove-children' });
    const after = await readStreams(zipPath);

    // A viewer renders a browser `before` as a row; if its stepId points at a
    // step no longer in test.trace, it shows as a loose orphan. There must be
    // none. Also every surviving after pairs with a surviving before.
    const survivingTest = callIdsOf(after['test.trace']);
    for (const [name, evts] of Object.entries(after)) {
      if (name === 'test.trace') continue;
      const localBefore = callIdsOf(evts);
      for (const o of before(evts)) {
        if (typeof o.stepId === 'string' && o.stepId !== o.callId) {
          expect(survivingTest.has(o.stepId), `orphan row ${o.callId} → ${o.stepId}`).toBe(true);
        }
      }
      // every after has a matching before in the same stream
      for (const o of evts.filter((e) => e.type === 'after')) {
        expect(localBefore.has(o.callId as string)).toBe(true);
      }
    }
    // Header survives.
    expect(after['0-trace.trace'][0].type).toBe('context-options');
  });

  it('(5) deeply nested matched step (parent→child→match) is fully cleaned across streams', async () => {
    const zipPath = await stageZip();
    // Match the MIDDLE step (level 2). Its level-3 children pw:api@12/@13 and
    // their browser calls must all vanish, transitively.
    const result = await run(zipPath, MIDDLE_RULE, { orphanStrategy: 'remove-children' });
    const after = await readStreams(zipPath);
    const survivingTest = callIdsOf(after['test.trace']);

    for (const id of ['test.step@11', 'pw:api@12', 'pw:api@13']) {
      expect(survivingTest.has(id), `${id} should be gone`).toBe(false);
    }
    // The level-2 sibling pw:api@14 (child of test.step@10, NOT of @11) stays.
    expect(survivingTest.has('pw:api@14')).toBe(true);
    // pw:api@14's browser calls survive; @12/@13's do not.
    const browIds = callIdsOf(after['0-trace.trace']);
    expect([...browIds].some((c) => c.startsWith('call@10'))).toBe(false); // waitForSelector calls gone
    expect([...browIds].some((c) => c.startsWith('call@2'))).toBe(true);   // waitForEventInfo calls kept
    expect(danglingRefs(after)).toHaveLength(0);
    expect(result.stepsRemoved).toBeGreaterThan(0);
  });

  it('(6) summary total equals the sum of per-rule counts — dry run AND real run', async () => {
    const cfg = (dry: boolean, strat: 'keep-shell' | 'remove-children'): SanitizerConfig => ({
      output: { mode: 'in-place' },
      remove: { orphanStrategy: strat, dryRun: dry },
      reporting: { logLevel: 'silent' },
    });

    for (const strat of ['keep-shell', 'remove-children'] as const) {
      // dry run
      const dryPath = await stageZip();
      const dryRes = await processTraceFile(dryPath, dryPath, cfg(true, strat), [], OUTER_RULE);
      const drySummary = generateSummary([dryRes], cfg(true, strat), 0, OUTER_RULE.length, []);
      const drySum = drySummary.remove.byRuleLabel.reduce((n, e) => n + e.count, 0);
      expect(drySummary.remove.totalStepsDeleted, `${strat} dry`).toBe(drySum);
      expect(drySum).toBeGreaterThan(0);
      cleanup();

      // real run
      const realPath = await stageZip();
      const realRes = await processTraceFile(realPath, realPath, cfg(false, strat), [], OUTER_RULE);
      const realSummary = generateSummary([realRes], cfg(false, strat), 0, OUTER_RULE.length, []);
      const realSum = realSummary.remove.byRuleLabel.reduce((n, e) => n + e.count, 0);
      expect(realSummary.remove.totalStepsDeleted, `${strat} real`).toBe(realSum);
      expect(realSum).toBeGreaterThan(0);

      // dry and real report the same total (dry-run predicts the real removal).
      expect(drySummary.remove.totalStepsDeleted).toBe(realSummary.remove.totalStepsDeleted);
      cleanup();
    }
  });
});
