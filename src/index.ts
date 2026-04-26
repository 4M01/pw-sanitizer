import * as fs from 'node:fs';
import * as path from 'node:path';
import { findFiles, computeOutputPath } from './utils.js';
import type { SanitizerConfig, ProcessResult } from './config/types.js';
import { loadConfig } from './config/loader.js';
import { validateConfig } from './config/validator.js';
import { buildPatternRegistry } from './redact/pattern-registry.js';
import { buildRuleRegistry } from './remove/rule-registry.js';
import { processHtmlReport } from './processors/html-report.js';
import { processTraceFile } from './processors/trace-file.js';
import {
  generateSummary,
  printSummary,
  writeSummaryFile,
} from './reporter.js';
import { configureLogger, logger } from './logger.js';

// Re-export types
export type {
  SanitizerConfig,
  RedactConfig,
  RemoveConfig,
  OutputConfig,
  ReportingConfig,
  RedactPattern,
  RemoveRule,
  ProcessResult,
  SanitizationSummary,
  TraceEvent,
  TimestampStrategy,
  RedactionResult,
  RedactionMatch,
  WalkResult,
  StepMatch,
  RemovalSet,
} from './config/types.js';

// Re-export loaders
export { loadPatternFile } from './redact/pattern-loader.js';
export { loadRuleFile } from './remove/rule-loader.js';

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
export async function sanitize(
  configOverride?: SanitizerConfig
): Promise<ProcessResult[]> {
  const config = configOverride ?? (await loadConfig());

  configureLogger(config.reporting);
  validateConfig(config);

  if (config.output?.mode === 'in-place') {
    logger.warn(
      'in-place mode overwrites originals — ensure files are version-controlled.'
    );
  }

  const patterns = config.redact
    ? await buildPatternRegistry(config.redact)
    : [];
  const rules = config.remove
    ? await buildRuleRegistry(config.remove)
    : [];

  const results: ProcessResult[] = [];

  // Process HTML reports
  if (config.output?.processReports !== false) {
    const reportDir = config.output?.reportDir ?? './playwright-report';
    const reportFiles = await findFiles(reportDir, '**/*.html');

    for (const file of reportFiles) {
      const outputPath = computeOutputPath(file, reportDir, config);
      const result = await processHtmlReport(
        file,
        outputPath,
        config,
        patterns,
        rules
      );
      results.push(result);
    }
  }

  // Process trace files
  if (config.output?.processTraces !== false) {
    const traceDir = config.output?.traceDir ?? './test-results';
    const traceFiles = await findFiles(traceDir, '**/*.zip');

    for (const file of traceFiles) {
      const outputPath = computeOutputPath(file, traceDir, config);
      const result = await processTraceFile(
        file,
        outputPath,
        config,
        patterns,
        rules
      );
      results.push(result);
    }
  }

  // Summary
  const showSummary = config.reporting?.summary !== false;
  if (showSummary || config.reporting?.summaryFile) {
    const summary = generateSummary(
      results,
      config,
      patterns.length,
      rules.length,
      []
    );

    if (showSummary) {
      printSummary(summary);
    }

    if (config.reporting?.summaryFile) {
      writeSummaryFile(summary, config.reporting.summaryFile);
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
export async function redactReport(
  reportPath: string,
  config: SanitizerConfig
): Promise<ProcessResult> {
  configureLogger(config.reporting);

  const patterns = config.redact
    ? await buildPatternRegistry(config.redact)
    : [];
  const rules = config.remove
    ? await buildRuleRegistry(config.remove)
    : [];

  const outputPath = computeOutputPath(
    reportPath,
    path.dirname(reportPath),
    config
  );

  return processHtmlReport(reportPath, outputPath, config, patterns, rules);
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
export async function redactTrace(
  tracePath: string,
  config: SanitizerConfig
): Promise<ProcessResult> {
  configureLogger(config.reporting);

  const patterns = config.redact
    ? await buildPatternRegistry(config.redact)
    : [];
  const rules = config.remove
    ? await buildRuleRegistry(config.remove)
    : [];

  const outputPath = computeOutputPath(
    tracePath,
    path.dirname(tracePath),
    config
  );

  return processTraceFile(tracePath, outputPath, config, patterns, rules);
}


