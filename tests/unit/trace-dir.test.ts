/**
 * Unit tests for multi-directory trace discovery (`output.traceDir` as
 * `string | string[]`) including dedupe of overlapping matches.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { collectTraceFiles } from '../../src/index.js';

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-dir-test-'));
  savedCwd = process.cwd();
});

afterEach(() => {
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(relPath: string): string {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'zip-stub');
  return full;
}

describe('collectTraceFiles', () => {
  it('accepts a single string traceDir (backward compatible)', async () => {
    touch('test-results/a/trace.zip');
    touch('test-results/b/trace.zip');

    const files = await collectTraceFiles(path.join(tmpDir, 'test-results'));
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(f.dir).toBe(path.join(tmpDir, 'test-results'));
    }
  });

  it('globs across every directory in an array traceDir', async () => {
    touch('test-results/a/trace.zip');
    touch('playwright-report/data/abc123.zip');
    touch('playwright-report/data/def456.zip');

    const files = await collectTraceFiles([
      path.join(tmpDir, 'test-results'),
      path.join(tmpDir, 'playwright-report/data'),
    ]);

    expect(files).toHaveLength(3);
    const names = files.map((f) => path.basename(f.file)).sort();
    expect(names).toEqual(['abc123.zip', 'def456.zip', 'trace.zip']);
  });

  it('dedupes overlapping matches by resolved absolute path (first dir wins)', async () => {
    touch('results/nested/trace.zip');
    touch('results/other.zip');

    const parent = path.join(tmpDir, 'results');
    const nested = path.join(tmpDir, 'results', 'nested');

    // nested/trace.zip is matched by BOTH directories' globs
    const files = await collectTraceFiles([parent, nested]);

    expect(files).toHaveLength(2);
    const traceEntries = files.filter((f) => f.file.endsWith('trace.zip'));
    expect(traceEntries).toHaveLength(1);
    // First directory that matched is kept as the root for output mirroring
    expect(traceEntries[0]!.dir).toBe(parent);

    // Same overlap listed the other way round: nested dir seen first
    const files2 = await collectTraceFiles([nested, parent]);
    expect(files2).toHaveLength(2);
    const traceEntries2 = files2.filter((f) => f.file.endsWith('trace.zip'));
    expect(traceEntries2).toHaveLength(1);
    expect(traceEntries2[0]!.dir).toBe(nested);
  });

  it('dedupes even when the same directory is listed twice', async () => {
    touch('test-results/a/trace.zip');
    const dir = path.join(tmpDir, 'test-results');

    const files = await collectTraceFiles([dir, dir]);
    expect(files).toHaveLength(1);
  });

  it('defaults to ./test-results when traceDir is omitted', async () => {
    touch('test-results/x/trace.zip');
    process.chdir(tmpDir);

    const files = await collectTraceFiles(undefined);
    expect(files).toHaveLength(1);
    expect(path.resolve(files[0]!.file)).toBe(
      path.resolve(tmpDir, 'test-results/x/trace.zip')
    );
  });

  it('returns an empty list for missing directories without throwing', async () => {
    const files = await collectTraceFiles([
      path.join(tmpDir, 'does-not-exist'),
      path.join(tmpDir, 'also-missing'),
    ]);
    expect(files).toEqual([]);
  });
});
