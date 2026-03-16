import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SanitizerConfig } from './types.js';
import { logger } from '../logger.js';

const CONFIG_FILE_NAMES = [
  'playwright-sanitizer.config.ts',
  'playwright-sanitizer.config.js',
  'playwright-sanitizer.config.json',
];

/**
 * Loads config from a specific file path.
 */
async function loadConfigFromFile(filePath: string): Promise<SanitizerConfig> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return logger.fatal(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.json') {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content) as SanitizerConfig;
  }

  // .ts or .js — use dynamic import
  try {
    const module = await import(absolutePath);
    return (module.default ?? module) as SanitizerConfig;
  } catch (err) {
    // If .ts failed, try .js sibling
    if (ext === '.ts') {
      const jsSibling = absolutePath.replace(/\.ts$/, '.js');
      if (fs.existsSync(jsSibling)) {
        try {
          const module = await import(jsSibling);
          return (module.default ?? module) as SanitizerConfig;
        } catch {
          return logger.fatal(
            `Failed to load config from both ${absolutePath} and ${jsSibling}. ` +
            `Ensure tsx or ts-node is available, or provide a .js config file.`
          );
        }
      }
    }
    return logger.fatal(
      `Failed to load config from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Tries to load the 'sanitizer' key from playwright.config.ts/.js.
 */
async function loadFromPlaywrightConfig(cwd: string): Promise<SanitizerConfig | null> {
  const candidates = ['playwright.config.ts', 'playwright.config.js'];

  for (const name of candidates) {
    const fullPath = path.resolve(cwd, name);
    if (fs.existsSync(fullPath)) {
      try {
        const module = await import(fullPath);
        const config = module.default ?? module;
        if (config && typeof config === 'object' && 'sanitizer' in config) {
          return config.sanitizer as SanitizerConfig;
        }
      } catch {
        // Not loadable or no sanitizer key — continue
      }
    }
  }

  return null;
}

/**
 * Resolves and loads the sanitizer config.
 *
 * Priority:
 * 1. Explicit configPath (from --config CLI flag)
 * 2. playwright-sanitizer.config.ts
 * 3. playwright-sanitizer.config.js
 * 4. playwright-sanitizer.config.json
 * 5. sanitizer key inside playwright.config.ts
 */
export async function loadConfig(configPath?: string): Promise<SanitizerConfig> {
  const cwd = process.cwd();

  // 1. Explicit path
  if (configPath) {
    logger.verbose(`Loading config from explicit path: ${configPath}`);
    return loadConfigFromFile(configPath);
  }

  // 2-4. Auto-discover config files
  for (const name of CONFIG_FILE_NAMES) {
    const fullPath = path.resolve(cwd, name);
    if (fs.existsSync(fullPath)) {
      logger.verbose(`Found config file: ${fullPath}`);
      return loadConfigFromFile(fullPath);
    }
  }

  // 5. Playwright config sanitizer key
  const fromPlaywright = await loadFromPlaywrightConfig(cwd);
  if (fromPlaywright) {
    logger.verbose('Loaded config from playwright.config sanitizer key');
    return fromPlaywright;
  }

  return logger.fatal(
    'No playwright-sanitizer config found. ' +
    'Create playwright-sanitizer.config.ts or pass --config <path>.'
  );
}
