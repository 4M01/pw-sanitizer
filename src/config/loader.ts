import * as fs from 'node:fs';
import * as path from 'node:path';
import createJiti from 'jiti';
import type { SanitizerConfig } from './types.js';
import { logger } from '../logger.js';

/**
 * Ordered list of config file names that are auto-discovered in the current
 * working directory when no explicit `--config` path is provided.
 */
const CONFIG_FILE_NAMES = [
  'playwright-sanitizer.config.ts',
  'playwright-sanitizer.config.js',
  'playwright-sanitizer.config.json',
];

/**
 * Loads a {@link SanitizerConfig} from an explicit file path.
 *
 * - `.json` files are parsed with `JSON.parse`.
 * - `.ts` / `.js` files are loaded via dynamic `import()`.
 *   If loading a `.ts` file fails, a compiled `.js` sibling is tried automatically.
 *
 * @param filePath - Absolute or relative path to the config file.
 * @returns The resolved {@link SanitizerConfig}.
 * @throws Calls `logger.fatal` (which throws) if the file is not found or cannot be parsed.
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

  // Use jiti to transpile and load .ts or .js config files natively
  try {
    const jiti = createJiti(__filename);
    const module = jiti(absolutePath);
    return (module.default ?? module) as SanitizerConfig;
  } catch (err) {
    return logger.fatal(
      `Failed to load config from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Attempts to load a sanitizer config from the `sanitizer` key inside
 * `playwright.config.ts` or `playwright.config.js` in the given directory.
 *
 * Returns `null` if no Playwright config is found, the file cannot be
 * loaded, or it does not contain a `sanitizer` key.
 *
 * @param cwd - The directory to search for a Playwright config file.
 * @returns The embedded {@link SanitizerConfig}, or `null` if not found.
 */
async function loadFromPlaywrightConfig(cwd: string): Promise<SanitizerConfig | null> {
  const candidates = ['playwright.config.ts', 'playwright.config.js'];

  for (const name of candidates) {
    const fullPath = path.resolve(cwd, name);
    if (fs.existsSync(fullPath)) {
      try {
        const jiti = createJiti(__filename);
        const module = jiti(fullPath);
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
 * Resolves and loads the sanitizer configuration.
 *
 * Config discovery priority (first match wins):
 * 1. Explicit `configPath` (from `--config` CLI flag or programmatic call)
 * 2. `playwright-sanitizer.config.ts` in `cwd`
 * 3. `playwright-sanitizer.config.js` in `cwd`
 * 4. `playwright-sanitizer.config.json` in `cwd`
 * 5. `sanitizer` key inside `playwright.config.ts` / `playwright.config.js`
 *
 * If none of the above are found, the function calls `logger.fatal` which
 * throws an `Error` with an actionable message.
 *
 * @param configPath - Optional explicit path to a config file.
 *   When provided, auto-discovery is skipped entirely.
 * @returns The resolved {@link SanitizerConfig}.
 * @throws Calls `logger.fatal` (which throws) when no config can be found or loaded.
 *
 * @example
 * ```ts
 * // Auto-discover config in cwd
 * const config = await loadConfig();
 *
 * // Load from an explicit path
 * const config = await loadConfig('./configs/sanitizer.config.ts');
 * ```
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
