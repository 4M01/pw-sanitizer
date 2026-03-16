import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadRuleFile, RuleFileNotFoundError } from '../../src/remove/rule-loader.js';

describe('loadRuleFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sanitizer-rule-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads rules from a .json file', async () => {
    const filePath = path.join(tmpDir, 'rules.json');
    const rules = [
      { label: 'Health check', url: '/api/health' },
      { label: 'Spinner wait', actionType: 'page.waitForSelector', selector: '#spinner' },
    ];
    fs.writeFileSync(filePath, JSON.stringify(rules), 'utf-8');

    const result = await loadRuleFile(filePath);
    expect(result).toHaveLength(2);
    expect(result[0]!.label).toBe('Health check');
    expect(result[1]!.label).toBe('Spinner wait');
  });

  it('throws RuleFileNotFoundError for missing file', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');
    await expect(loadRuleFile(filePath)).rejects.toThrow(RuleFileNotFoundError);
    await expect(loadRuleFile(filePath)).rejects.toThrow('file not found');
  });

  it('throws for non-array JSON file', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, JSON.stringify({ label: 'not-array' }), 'utf-8');

    await expect(loadRuleFile(filePath)).rejects.toThrow('must export an array');
  });

  it('loads rules from a .js file', async () => {
    const filePath = path.join(tmpDir, 'rules.js');
    const content = `
      module.exports = [
        { label: 'JS rule', url: '/api/test' }
      ];
    `;
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await loadRuleFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('JS rule');
  });

  it('loads rules from .js file with default export', async () => {
    const filePath = path.join(tmpDir, 'rules-default.js');
    const content = `
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = [
        { label: 'Default rule', actionType: 'page.goto' }
      ];
    `;
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await loadRuleFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Default rule');
  });

  it('handles duplicate labels without error (dedup happens in registry)', async () => {
    const filePath = path.join(tmpDir, 'dupes.json');
    const rules = [
      { label: 'Same label', url: '/first' },
      { label: 'Same label', url: '/second' },
    ];
    fs.writeFileSync(filePath, JSON.stringify(rules), 'utf-8');

    const result = await loadRuleFile(filePath);
    expect(result).toHaveLength(2);
  });
});
