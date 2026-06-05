import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeOutputPath, writeOutput, findFiles } from '../../src/utils.js';
import type { SanitizerConfig } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-utils-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// computeOutputPath
// ---------------------------------------------------------------------------

describe('computeOutputPath', () => {
  it('mirrors the relative path into output.dir for copy mode', () => {
    const config: SanitizerConfig = { output: { mode: 'copy', dir: '/out' } };
    const result = computeOutputPath('/src/reports/index.html', '/src/reports', config);
    expect(result).toBe(path.resolve('/out/index.html'));
  });

  it('returns the input path unchanged for in-place mode', () => {
    const config: SanitizerConfig = { output: { mode: 'in-place' } };
    const result = computeOutputPath('/src/report.html', '/src', config);
    expect(result).toBe('/src/report.html');
  });

  it('returns the input path unchanged for side-by-side mode', () => {
    const config: SanitizerConfig = { output: { mode: 'side-by-side' } };
    const result = computeOutputPath('/src/report.html', '/src', config);
    expect(result).toBe('/src/report.html');
  });

  it('defaults to copy mode with ./sanitized-report when output is absent', () => {
    const config: SanitizerConfig = {};
    const result = computeOutputPath(
      path.resolve('./playwright-report/index.html'),
      path.resolve('./playwright-report'),
      config
    );
    expect(result).toBe(path.resolve('./sanitized-report/index.html'));
  });
});

// ---------------------------------------------------------------------------
// writeOutput
// ---------------------------------------------------------------------------

describe('writeOutput', () => {
  it('writes to the outputPath in copy mode and creates parent dirs', () => {
    const dir = createTmpDir();
    const inputPath = path.join(dir, 'original.html');
    const outputPath = path.join(dir, 'subdir', 'copy.html');

    fs.writeFileSync(inputPath, 'original', 'utf-8');

    const config: SanitizerConfig = { output: { mode: 'copy' } };
    writeOutput(inputPath, outputPath, 'sanitized', config);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe('sanitized');
    // Original is untouched
    expect(fs.readFileSync(inputPath, 'utf-8')).toBe('original');
  });

  it('overwrites the original file in in-place mode', () => {
    const dir = createTmpDir();
    const inputPath = path.join(dir, 'report.html');
    fs.writeFileSync(inputPath, 'original', 'utf-8');

    const config: SanitizerConfig = { output: { mode: 'in-place' } };
    writeOutput(inputPath, inputPath, 'sanitized', config);

    expect(fs.readFileSync(inputPath, 'utf-8')).toBe('sanitized');
  });

  it('writes a .sanitized sibling file in side-by-side mode', () => {
    const dir = createTmpDir();
    const inputPath = path.join(dir, 'report.html');
    fs.writeFileSync(inputPath, 'original', 'utf-8');

    const config: SanitizerConfig = { output: { mode: 'side-by-side' } };
    writeOutput(inputPath, inputPath, 'sanitized', config);

    const siblingPath = path.join(dir, 'report.sanitized.html');
    expect(fs.existsSync(siblingPath)).toBe(true);
    expect(fs.readFileSync(siblingPath, 'utf-8')).toBe('sanitized');
    // Original untouched
    expect(fs.readFileSync(inputPath, 'utf-8')).toBe('original');
  });

  it('accepts a Buffer as content', () => {
    const dir = createTmpDir();
    const inputPath = path.join(dir, 'trace.zip');
    const outputPath = path.join(dir, 'trace-out.zip');
    fs.writeFileSync(inputPath, 'data', 'utf-8');

    const config: SanitizerConfig = { output: { mode: 'copy', dir } };
    const buf = Buffer.from([0x50, 0x4b]);
    writeOutput(inputPath, outputPath, buf, config);

    expect(Buffer.from(fs.readFileSync(outputPath))).toEqual(buf);
  });
});

// ---------------------------------------------------------------------------
// findFiles
// ---------------------------------------------------------------------------

describe('findFiles', () => {
  it('returns matching files from a directory', async () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'a.html'), '');
    fs.writeFileSync(path.join(dir, 'b.html'), '');
    fs.writeFileSync(path.join(dir, 'c.txt'), '');

    const files = await findFiles(dir, '**/*.html');
    const names = files.map((f) => path.basename(f)).sort();
    expect(names).toEqual(['a.html', 'b.html']);
  });

  it('returns empty array when directory does not exist', async () => {
    const files = await findFiles('/nonexistent-directory-xyz', '**/*.html');
    expect(files).toEqual([]);
  });
});
