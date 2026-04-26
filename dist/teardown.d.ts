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
export default function teardown(): Promise<void>;
//# sourceMappingURL=teardown.d.ts.map