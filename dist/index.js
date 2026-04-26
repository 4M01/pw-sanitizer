"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRuleFile = exports.loadPatternFile = void 0;
exports.sanitize = sanitize;
exports.redactReport = redactReport;
exports.redactTrace = redactTrace;
const path = __importStar(require("node:path"));
const utils_js_1 = require("./utils.js");
const loader_js_1 = require("./config/loader.js");
const validator_js_1 = require("./config/validator.js");
const pattern_registry_js_1 = require("./redact/pattern-registry.js");
const rule_registry_js_1 = require("./remove/rule-registry.js");
const html_report_js_1 = require("./processors/html-report.js");
const trace_file_js_1 = require("./processors/trace-file.js");
const reporter_js_1 = require("./reporter.js");
const logger_js_1 = require("./logger.js");
// Re-export loaders
var pattern_loader_js_1 = require("./redact/pattern-loader.js");
Object.defineProperty(exports, "loadPatternFile", { enumerable: true, get: function () { return pattern_loader_js_1.loadPatternFile; } });
var rule_loader_js_1 = require("./remove/rule-loader.js");
Object.defineProperty(exports, "loadRuleFile", { enumerable: true, get: function () { return rule_loader_js_1.loadRuleFile; } });
/**
 * Main programmatic entry point for `playwright-sanitizer`.
 *
 * Discovers (or uses the provided) configuration, then processes all matching
 * HTML reports and trace `.zip` files found in the configured directories.
 *
 * Typical usage — run after a Playwright test suite from your own script:
 * ```ts
 * import { sanitize } from 'playwright-sanitizer';
 *
 * await sanitize({
 *   redact: { patterns: [{ id: 'token', key: 'authorization' }] },
 *   output: { mode: 'in-place' },
 * });
 * ```
 *
 * Config resolution (when `configOverride` is omitted):
 * - Delegates to {@link loadConfig} which auto-discovers `playwright-sanitizer.config.ts`
 *   (or the `sanitizer` key in `playwright.config.ts`).
 *
 * @param configOverride - Optional config object. When provided, skips file-based
 *   config discovery entirely and uses this object directly.
 * @returns Array of {@link ProcessResult}s — one entry per file processed.
 */
async function sanitize(configOverride) {
    const config = configOverride ?? (await (0, loader_js_1.loadConfig)());
    (0, logger_js_1.configureLogger)(config.reporting);
    (0, validator_js_1.validateConfig)(config);
    if (config.output?.mode === 'in-place') {
        logger_js_1.logger.warn('in-place mode overwrites originals — ensure files are version-controlled.');
    }
    const patterns = config.redact
        ? await (0, pattern_registry_js_1.buildPatternRegistry)(config.redact)
        : [];
    const rules = config.remove
        ? await (0, rule_registry_js_1.buildRuleRegistry)(config.remove)
        : [];
    const results = [];
    // Process HTML reports
    if (config.output?.processReports !== false) {
        const reportDir = config.output?.reportDir ?? './playwright-report';
        const reportFiles = await (0, utils_js_1.findFiles)(reportDir, '**/*.html');
        for (const file of reportFiles) {
            const outputPath = (0, utils_js_1.computeOutputPath)(file, reportDir, config);
            const result = await (0, html_report_js_1.processHtmlReport)(file, outputPath, config, patterns, rules);
            results.push(result);
        }
    }
    // Process trace files
    if (config.output?.processTraces !== false) {
        const traceDir = config.output?.traceDir ?? './test-results';
        const traceFiles = await (0, utils_js_1.findFiles)(traceDir, '**/*.zip');
        for (const file of traceFiles) {
            const outputPath = (0, utils_js_1.computeOutputPath)(file, traceDir, config);
            const result = await (0, trace_file_js_1.processTraceFile)(file, outputPath, config, patterns, rules);
            results.push(result);
        }
    }
    // Summary
    const showSummary = config.reporting?.summary !== false;
    if (showSummary || config.reporting?.summaryFile) {
        const summary = (0, reporter_js_1.generateSummary)(results, config, patterns.length, rules.length, []);
        if (showSummary) {
            (0, reporter_js_1.printSummary)(summary);
        }
        if (config.reporting?.summaryFile) {
            (0, reporter_js_1.writeSummaryFile)(summary, config.reporting.summaryFile);
        }
    }
    return results;
}
/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Convenience wrapper around {@link processHtmlReport} for cases where you
 * need to process one specific file rather than an entire directory.
 *
 * @param reportPath - Absolute or relative path to the HTML report file.
 * @param config     - The full sanitizer configuration to apply.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 *
 * @example
 * ```ts
 * import { redactReport } from 'playwright-sanitizer';
 *
 * const result = await redactReport('./playwright-report/index.html', {
 *   redact: { patterns: [{ id: 'auth', key: 'authorization' }] },
 *   output: { mode: 'copy', dir: './sanitized' },
 * });
 * console.log(`Redacted ${result.redactionsApplied} values`);
 * ```
 */
async function redactReport(reportPath, config) {
    (0, logger_js_1.configureLogger)(config.reporting);
    const patterns = config.redact
        ? await (0, pattern_registry_js_1.buildPatternRegistry)(config.redact)
        : [];
    const rules = config.remove
        ? await (0, rule_registry_js_1.buildRuleRegistry)(config.remove)
        : [];
    const outputPath = (0, utils_js_1.computeOutputPath)(reportPath, path.dirname(reportPath), config);
    return (0, html_report_js_1.processHtmlReport)(reportPath, outputPath, config, patterns, rules);
}
/**
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Convenience wrapper around {@link processTraceFile} for cases where you
 * need to process one specific file rather than an entire directory.
 *
 * @param tracePath - Absolute or relative path to the trace `.zip` file.
 * @param config    - The full sanitizer configuration to apply.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 *
 * @example
 * ```ts
 * import { redactTrace } from 'playwright-sanitizer';
 *
 * const result = await redactTrace('./test-results/my-test/trace.zip', {
 *   redact: { patterns: [{ id: 'cookie', key: /^cookie$/i }] },
 *   output: { mode: 'side-by-side' },
 * });
 * console.log(`Removed ${result.stepsRemoved} steps`);
 * ```
 */
async function redactTrace(tracePath, config) {
    (0, logger_js_1.configureLogger)(config.reporting);
    const patterns = config.redact
        ? await (0, pattern_registry_js_1.buildPatternRegistry)(config.redact)
        : [];
    const rules = config.remove
        ? await (0, rule_registry_js_1.buildRuleRegistry)(config.remove)
        : [];
    const outputPath = (0, utils_js_1.computeOutputPath)(tracePath, path.dirname(tracePath), config);
    return (0, trace_file_js_1.processTraceFile)(tracePath, outputPath, config, patterns, rules);
}
//# sourceMappingURL=index.js.map