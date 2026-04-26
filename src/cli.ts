#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { SanitizerConfig } from './config/types.js';
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
import type { ProcessResult } from './config/types.js';

const program = new Command();

program
  .name('playwright-sanitizer')
  .description(
    'Post-process Playwright HTML reports and trace files to redact secrets and remove noisy steps'
  )
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to config file')
  .option(
    '-r, --report <path>',
    'HTML report directory',
    './playwright-report'
  )
  .option(
    '-t, --traces <path>',
    'Trace directory',
    './test-results'
  )
  .option('-o, --output <path>', 'Output directory (for copy mode)')
  .option('--in-place', 'Overwrite original files')
  .option(
    '--patterns <path...>',
    'One or more pattern files (repeatable)'
  )
  .option(
    '--placeholder <string>',
    'Redaction placeholder',
    '[REDACTED]'
  )
  .option('--dry-run', 'Log changes without writing files')
  .option('--no-traces', 'Skip trace file processing')
  .option('--no-reports', 'Skip HTML report processing')
  .option(
    '--summary-output <path>',
    'Write JSON summary to file'
  )
  .option(
    '--log-level <level>',
    'silent | normal | verbose',
    'normal'
  );

program.action(async (opts: Record<string, unknown>) => {
  try {
    // Load config
    const config = await loadConfig(opts['config'] as string | undefined);

    // Apply CLI overrides
    applyCliOverrides(config, opts);

    // Configure logger
    configureLogger(config.reporting);

    // Validate
    validateConfig(config);

    // Warn about in-place mode
    if (config.output?.mode === 'in-place') {
      logger.warn(
        'in-place mode overwrites originals — ensure files are version-controlled.'
      );
    }

    // Build pattern and rule registries
    const patterns = config.redact
      ? await buildPatternRegistry(config.redact)
      : [];
    const rules = config.remove
      ? await buildRuleRegistry(config.remove)
      : [];

    const results: ProcessResult[] = [];

    // Process HTML reports
    const processReports = config.output?.processReports !== false;
    if (processReports) {
      const reportDir =
        config.output?.reportDir ?? './playwright-report';
      const reportFiles = await findFiles(reportDir, '**/*.html');

      for (const file of reportFiles) {
        const outputPath = computeOutputPath(
          file,
          reportDir,
          config
        );
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
    const processTraces = config.output?.processTraces !== false;
    if (processTraces) {
      const traceDir = config.output?.traceDir ?? './test-results';
      const traceFiles = await findFiles(traceDir, '**/*.zip');

      for (const file of traceFiles) {
        const outputPath = computeOutputPath(
          file,
          traceDir,
          config
        );
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

    // Generate summary
    const showSummary = config.reporting?.summary !== false;
    if (showSummary || config.reporting?.summaryFile) {
      const summary = generateSummary(
        results,
        config,
        patterns.length,
        rules.length,
        [] // Safety warnings are collected during processing via logger
      );

      if (showSummary) {
        printSummary(summary);
      }

      if (config.reporting?.summaryFile) {
        writeSummaryFile(summary, config.reporting.summaryFile);
      }
    }

    process.exit(0);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[FATAL] ${err.message}`);
    } else {
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
function applyCliOverrides(
  config: SanitizerConfig,
  opts: Record<string, unknown>
): void {
  // Output overrides
  if (!config.output) config.output = {};

  if (opts['report']) {
    config.output.reportDir = opts['report'] as string;
  }
  if (opts['traces'] === false) {
    config.output.processTraces = false;
  }
  if (opts['reports'] === false) {
    config.output.processReports = false;
  }
  if (opts['output']) {
    config.output.dir = opts['output'] as string;
    config.output.mode = 'copy';
  }
  if (opts['inPlace']) {
    config.output.mode = 'in-place';
  }

  // Redact overrides
  if (opts['patterns']) {
    if (!config.redact) config.redact = {};
    config.redact.patternFiles = opts['patterns'] as string[];
  }
  if (opts['placeholder']) {
    if (!config.redact) config.redact = {};
    config.redact.placeholder = opts['placeholder'] as string;
  }

  // Remove overrides
  if (opts['dryRun']) {
    if (!config.remove) config.remove = {};
    config.remove.dryRun = true;
  }

  // Reporting overrides
  if (!config.reporting) config.reporting = {};
  if (opts['logLevel']) {
    config.reporting.logLevel = opts['logLevel'] as
      | 'silent'
      | 'normal'
      | 'verbose';
  }
  if (opts['summaryOutput']) {
    config.reporting.summaryFile = opts['summaryOutput'] as string;
  }
}

/**
 * Resolves a directory and returns all files matching a glob pattern.
 * Returns an empty array (with an info log) if the directory does not exist.
 *
 * @param dir     - Directory to search in (absolute or relative to `cwd`).
 * @param pattern - Glob pattern relative to `dir` (e.g. `'**\/*.html'`).
 * @returns Absolute paths of all matching files.
 */
async function findFiles(
  dir: string,
  pattern: string
): Promise<string[]> {
  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) {
    logger.info(`Directory not found: ${resolvedDir}`);
    return [];
  }

  const files = await glob(pattern, {
    cwd: resolvedDir,
    absolute: true,
  });

  return files;
}

/**
 * Computes the destination path for a sanitized output file.
 *
 * - **`in-place`** / **`side-by-side`**: returns `inputPath` as-is.
 * - **`copy`** *(default)*: mirrors the file's path relative to `sourceDir`
 *   into the configured output directory (default: `'./sanitized-report'`).
 *
 * @param inputPath - Absolute path to the source file.
 * @param sourceDir - Root directory used to compute the relative fragment.
 * @param config    - The sanitizer configuration (read for `output.mode` and `output.dir`).
 * @returns The computed output path.
 */
function computeOutputPath(
  inputPath: string,
  sourceDir: string,
  config: SanitizerConfig
): string {
  const mode = config.output?.mode ?? 'copy';

  if (mode === 'in-place' || mode === 'side-by-side') {
    return inputPath;
  }

  // 'copy' mode: mirror the structure into output dir
  const outputDir = config.output?.dir ?? './sanitized-report';
  const relative = path.relative(path.resolve(sourceDir), inputPath);
  return path.resolve(outputDir, relative);
}

program.parse();
