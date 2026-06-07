import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

describe('config loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sanitizer-loader-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads config from a .json file', async () => {
    const configPath = path.join(tmpDir, 'custom.json');
    const mockConfig = {
      redact: {
        placeholder: '[TEST_REDACTED]',
        patterns: [{ id: 'json-test', key: 'api_key' }],
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(mockConfig), 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.redact?.placeholder).toBe('[TEST_REDACTED]');
    expect(config.redact?.patterns?.[0]?.id).toBe('json-test');
  });

  it('loads config from a .js file', async () => {
    const configPath = path.join(tmpDir, 'custom.js');
    const content = `
      module.exports = {
        redact: {
          placeholder: '[JS_REDACTED]'
        }
      };
    `;
    fs.writeFileSync(configPath, content, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.redact?.placeholder).toBe('[JS_REDACTED]');
  });

  it('loads config from a .ts file using jiti', async () => {
    const configPath = path.join(tmpDir, 'playwright-sanitizer.config.ts');
    const content = `
      const config = {
        redact: {
          placeholder: '[TS_REDACTED]'
        }
      };
      export default config;
    `;
    fs.writeFileSync(configPath, content, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.redact?.placeholder).toBe('[TS_REDACTED]');
  });

  it('auto-discovers config in order of priority', async () => {
    // Write a .json config
    const jsonPath = path.join(tmpDir, 'playwright-sanitizer.config.json');
    fs.writeFileSync(jsonPath, JSON.stringify({ redact: { placeholder: '[DISCOVER_JSON]' } }), 'utf-8');

    let config = await loadConfig();
    expect(config.redact?.placeholder).toBe('[DISCOVER_JSON]');

    // Write a .js config (higher priority than .json)
    const jsPath = path.join(tmpDir, 'playwright-sanitizer.config.js');
    fs.writeFileSync(jsPath, `module.exports = { redact: { placeholder: '[DISCOVER_JS]' } };`, 'utf-8');

    config = await loadConfig();
    expect(config.redact?.placeholder).toBe('[DISCOVER_JS]');

    // Write a .ts config (higher priority than .js)
    const tsPath = path.join(tmpDir, 'playwright-sanitizer.config.ts');
    fs.writeFileSync(tsPath, `export default { redact: { placeholder: '[DISCOVER_TS]' } };`, 'utf-8');

    config = await loadConfig();
    expect(config.redact?.placeholder).toBe('[DISCOVER_TS]');
  });

  it('auto-discovers sanitizer key from playwright.config.ts', async () => {
    const playwrightConfigPath = path.join(tmpDir, 'playwright.config.ts');
    const content = `
      export default {
        webServer: { command: 'npm run dev' },
        sanitizer: {
          redact: { placeholder: '[PLAYWRIGHT_TS]' }
        }
      };
    `;
    fs.writeFileSync(playwrightConfigPath, content, 'utf-8');

    const config = await loadConfig();
    expect(config.redact?.placeholder).toBe('[PLAYWRIGHT_TS]');
  });
});
