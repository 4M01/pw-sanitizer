#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const loader_js_1 = require("./config/loader.js");
const index_js_1 = require("./index.js");
const program = new commander_1.Command();
program
    .name('playwright-sanitizer')
    .description('Post-process Playwright HTML reports and trace files to redact secrets and remove noisy steps')
    .version('0.1.0')
    .option('-c, --config <path>', 'Path to config file')
    .option('-r, --report <path>', 'HTML report directory', './playwright-report')
    .option('-t, --traces <path>', 'Trace directory', './test-results')
    .option('-o, --output <path>', 'Output directory (for copy mode)')
    .option('--in-place', 'Overwrite original files')
    .option('--patterns <path...>', 'One or more pattern files (repeatable)')
    .option('--placeholder <string>', 'Redaction placeholder', '[REDACTED]')
    .option('--dry-run', 'Log changes without writing files')
    .option('--no-traces', 'Skip trace file processing')
    .option('--no-reports', 'Skip HTML report processing')
    .option('--summary-output <path>', 'Write JSON summary to file')
    .option('--log-level <level>', 'silent | normal | verbose', 'normal');
program.action(async (opts) => {
    try {
        // Load config
        const config = await (0, loader_js_1.loadConfig)(opts['config']);
        // Apply CLI overrides
        applyCliOverrides(config, opts);
        await (0, index_js_1.sanitize)(config);
        process.exit(0);
    }
    catch (err) {
        if (err instanceof Error) {
            console.error(`[FATAL] ${err.message}`);
        }
        else {
            console.error(`[FATAL] ${String(err)}`);
        }
        process.exit(1);
    }
});
/**
 * Merges parsed CLI flag values into a {@link SanitizerConfig} object.
 *
 * CLI flags always take the highest priority — they overwrite any values
 * that were loaded from a config file. Sections are created on-demand
 * (e.g. `config.output` is initialised to `{}` if not already present).
 *
 * Flag → config field mapping:
 * - `--report`         → `output.reportDir`
 * - `--no-traces`      → `output.processTraces = false`
 * - `--no-reports`     → `output.processReports = false`
 * - `--output`         → `output.dir` + `output.mode = 'copy'`
 * - `--in-place`       → `output.mode = 'in-place'`
 * - `--patterns`       → `redact.patternFiles`
 * - `--placeholder`    → `redact.placeholder`
 * - `--dry-run`        → `remove.dryRun = true`
 * - `--log-level`      → `reporting.logLevel`
 * - `--summary-output` → `reporting.summaryFile`
 *
 * @param config - The config object to mutate (loaded from file or empty).
 * @param opts   - Raw parsed options from Commander.js (`program.opts()`).
 */
function applyCliOverrides(config, opts) {
    // Output overrides
    if (!config.output)
        config.output = {};
    if (opts['report']) {
        config.output.reportDir = opts['report'];
    }
    if (opts['traces'] === false) {
        config.output.processTraces = false;
    }
    if (opts['reports'] === false) {
        config.output.processReports = false;
    }
    if (opts['output']) {
        config.output.dir = opts['output'];
        config.output.mode = 'copy';
    }
    if (opts['inPlace']) {
        config.output.mode = 'in-place';
    }
    // Redact overrides
    if (opts['patterns']) {
        if (!config.redact)
            config.redact = {};
        config.redact.patternFiles = opts['patterns'];
    }
    if (opts['placeholder']) {
        if (!config.redact)
            config.redact = {};
        config.redact.placeholder = opts['placeholder'];
    }
    // Remove overrides
    if (opts['dryRun']) {
        if (!config.remove)
            config.remove = {};
        config.remove.dryRun = true;
    }
    // Reporting overrides
    if (!config.reporting)
        config.reporting = {};
    if (opts['logLevel']) {
        config.reporting.logLevel = opts['logLevel'];
    }
    if (opts['summaryOutput']) {
        config.reporting.summaryFile = opts['summaryOutput'];
    }
}
program.parse();
//# sourceMappingURL=cli.js.map