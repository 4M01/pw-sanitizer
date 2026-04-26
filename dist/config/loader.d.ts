import type { SanitizerConfig } from './types.js';
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
export declare function loadConfig(configPath?: string): Promise<SanitizerConfig>;
//# sourceMappingURL=loader.d.ts.map