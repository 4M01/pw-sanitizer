import { sanitize } from './index.js';
import { logger } from './logger.js';

/**
 * Playwright globalTeardown integration.
 *
 * Export this as the default function for use with Playwright's globalTeardown:
 *
 *   // playwright.config.ts
 *   export default defineConfig({
 *     globalTeardown: require.resolve('playwright-sanitizer/teardown'),
 *   });
 *
 * Config is auto-discovered from playwright-sanitizer.config.ts or
 * the sanitizer key in playwright.config.ts.
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
