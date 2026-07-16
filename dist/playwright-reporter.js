"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("./index.js");
const loader_js_1 = require("./config/loader.js");
const logger_js_1 = require("./logger.js");
/**
 * Playwright **reporter** integration for `pw-sanitizer` — the recommended way
 * to sanitize HTML reports.
 *
 * Why a reporter and not `globalTeardown`? Playwright's execution order is
 * (verified in `playwright/lib/runner/tasks.js`):
 *
 * 1. tests finish
 * 2. `globalTeardown` runs
 * 3. `reporter.onEnd()` for each reporter — this is where the HTML report and
 *    the `playwright-report/data/*.zip` trace-attachment copies get written
 * 4. `reporter.onExit()` for each reporter
 *
 * So a `globalTeardown` hook runs **before** the current run's HTML report
 * exists — it can only sanitize `test-results` traces (and, misleadingly, the
 * previous run's report). `onExit()` is the only hook guaranteed to run after
 * every reporter has finished writing, which is exactly where this reporter
 * invokes the sanitizer.
 *
 * @example
 * ```ts
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [
 *     ['html'],
 *     ['pw-sanitizer/reporter'], // list last by convention
 *   ],
 * });
 * ```
 *
 * Listing it last is recommended for readability, but correctness does not
 * depend on order: Playwright completes **all** reporters' `onEnd()` calls
 * before it invokes **any** reporter's `onExit()`.
 *
 * @remarks
 * Errors thrown by the sanitizer are caught and logged rather than re-thrown —
 * a post-processing failure must never mask the test results Playwright has
 * already recorded.
 */
class PwSanitizerReporter {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Tells Playwright this reporter never writes to stdio, so it does not
     * suppress the default terminal reporter output.
     */
    printsToStdio() {
        return false;
    }
    /**
     * Runs after every reporter's `onEnd()` has completed — i.e. after the HTML
     * report and its `data/` trace copies have been written to disk.
     *
     * Loads the sanitizer config (auto-discovery unless `configPath` was given)
     * and runs {@link sanitize}. Never throws.
     */
    async onExit() {
        try {
            const config = this.options.configPath
                ? await (0, loader_js_1.loadConfig)(this.options.configPath)
                : undefined;
            await (0, index_js_1.sanitize)(config);
        }
        catch (err) {
            // Log the error but don't throw — sanitization is a post-processing
            // step and must not mask test results.
            const message = err instanceof Error ? err.message : String(err);
            logger_js_1.logger.error(`pw-sanitizer reporter failed: ${message}`);
        }
    }
}
exports.default = PwSanitizerReporter;
//# sourceMappingURL=playwright-reporter.js.map