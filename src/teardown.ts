import { sanitize } from './index.js';
import { logger } from './logger.js';

/**
 * Playwright `globalTeardown` integration for `playwright-sanitizer`.
 *
 * Register this as the `globalTeardown` hook in your Playwright config and the
 * sanitizer will run automatically after every test suite completes. Config is
 * auto-discovered from `playwright-sanitizer.config.ts` (or the `sanitizer`
 * key inside `playwright.config.ts`) — no arguments needed.
 *
 * @example
 * ```ts
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   globalTeardown: require.resolve('playwright-sanitizer/teardown'),
 * });
 * ```
 *
 * @remarks
 * Errors thrown by the sanitizer are **caught and logged** rather than
 * re-thrown. This is intentional: a post-processing failure must never mask
 * the actual test results that Playwright has already recorded.
 *
 * @returns A promise that resolves when sanitization completes (or fails gracefully).
 */
export default async function teardown(): Promise<void> {
  try {
    await sanitize();
  } catch (err) {
    // Log the error but don't throw — teardown failures should not
    // mask test results. The sanitizer is a post-processing step.
    const message =
      err instanceof Error ? err.message : String(err);
    logger.error(`playwright-sanitizer teardown failed: ${message}`);
  }
}
