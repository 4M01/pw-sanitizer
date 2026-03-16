import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadPatternFile, PatternFileNotFoundError } from '../../src/redact/pattern-loader.js';

describe('loadPatternFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sanitizer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads patterns from a .json file', async () => {
    const filePath = path.join(tmpDir, 'patterns.json');
    const patterns = [
      { id: 'auth-header', key: 'authorization', severity: 'critical' },
      { id: 'api-key', key: 'x-api-key', severity: 'high' },
    ];
    fs.writeFileSync(filePath, JSON.stringify(patterns), 'utf-8');

    const result = await loadPatternFile(filePath);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('auth-header');
    expect(result[1]!.id).toBe('api-key');
  });

  it('throws PatternFileNotFoundError for missing file', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');
    await expect(loadPatternFile(filePath)).rejects.toThrow(PatternFileNotFoundError);
    await expect(loadPatternFile(filePath)).rejects.toThrow('file not found');
  });

  it('throws for non-array JSON file', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, JSON.stringify({ id: 'not-array' }), 'utf-8');

    await expect(loadPatternFile(filePath)).rejects.toThrow(
      'must export an array'
    );
  });

  it('loads patterns from a .js file', async () => {
    const filePath = path.join(tmpDir, 'patterns.js');
    const content = `
      module.exports = [
        { id: 'js-pattern', key: 'x-token', severity: 'high' }
      ];
    `;
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await loadPatternFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('js-pattern');
  });

  it('loads patterns from .js file with default export', async () => {
    const filePath = path.join(tmpDir, 'patterns-default.js');
    const content = `
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = [
        { id: 'default-pattern', key: 'secret', severity: 'critical' }
      ];
    `;
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await loadPatternFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('default-pattern');
  });
});
