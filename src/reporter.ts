import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SanitizerConfig,
  ProcessResult,
  SanitizationSummary,
} from './config/types.js';
import { logger } from './logger.js';

/**
 * Aggregates the per-file {@link ProcessResult}s into a single
 * {@link SanitizationSummary} for display and/or JSON export.
 *
 * Aggregation includes:
 * - Total redaction occurrence counts, broken down by pattern ID.
 * - Total step-removal counts, broken down by rule label (with file counts).
 * - Timestamp repair count and the strategy that was used.
 * - Output mode and destination directory from the config.
 *
 * @param results         - Per-file results from {@link sanitize} / {@link processHtmlReport} / {@link processTraceFile}.
 * @param config          - The sanitizer configuration used for this run.
 * @param patternsLoaded  - Number of distinct redact patterns that were active.
 * @param rulesLoaded     - Number of distinct removal rules that were active.
 * @param safetyWarnings  - Any safety-guard warning messages collected during processing.
 * @returns A fully populated {@link SanitizationSummary}.
 */
export function generateSummary(
  results: ProcessResult[],
  config: SanitizerConfig,
  patternsLoaded: number,
  rulesLoaded: number,
  safetyWarnings: string[]
): SanitizationSummary {
  const reportCount = results.filter((r) =>
    r.file.endsWith('.html')
  ).length;
  const traceCount = results.filter((r) =>
    r.file.endsWith('.zip')
  ).length;

  // Aggregate redaction counts by pattern ID
  const byPatternId: Record<string, number> = {};
  for (const result of results) {
    for (const match of result.redactionMatches) {
      byPatternId[match.patternId] =
        (byPatternId[match.patternId] ?? 0) + 1;
    }
  }

  // Aggregate removal counts by rule label
  const ruleLabelMap = new Map<string, { count: number; files: Set<string> }>();
  for (const result of results) {
    for (const match of result.removalMatches) {
      const existing = ruleLabelMap.get(match.ruleLabel);
      if (existing) {
        existing.count++;
        existing.files.add(result.file);
      } else {
        ruleLabelMap.set(match.ruleLabel, {
          count: 1,
          files: new Set([result.file]),
        });
      }
    }
  }

  const totalRedactions = results.reduce(
    (sum, r) => sum + r.redactionsApplied,
    0
  );
  const totalSteps = results.reduce(
    (sum, r) => sum + r.stepsRemoved,
    0
  );
  const totalRepairs = results.reduce(
    (sum, r) => sum + r.timestampRepairs,
    0
  );

  const strategy =
    config.remove?.timestampStrategy ?? 'absorb-into-prev';
  const mode = config.output?.mode ?? 'copy';
  const dir = config.output?.dir ?? './sanitized-report';

  const summary: SanitizationSummary = {
    processedAt: new Date().toISOString(),
    filesProcessed: { reports: reportCount, traces: traceCount },
    redact: {
      patternsLoaded,
      totalOccurrencesReplaced: totalRedactions,
      byPatternId,
    },
    remove: {
      rulesLoaded,
      totalStepsDeleted: totalSteps,
      timestampRepairs: totalRepairs,
      timestampStrategy: strategy,
      byRuleLabel: Array.from(ruleLabelMap.entries()).map(
        ([label, data]) => ({
          label,
          count: data.count,
          files: data.files.size,
        })
      ),
      safetyGuardWarnings: safetyWarnings,
    },
    output: { mode, dir },
  };

  return summary;
}

/**
 * Renders a {@link SanitizationSummary} as a formatted table to `stdout`.
 *
 * The output includes:
 * - File counts (HTML reports + trace files).
 * - Per-pattern redaction counts (tree-style, with `├─` / `└─` connectors).
 * - Per-rule removal counts and file coverage.
 * - Timestamp repair count and strategy.
 * - Any safety-guard warnings.
 * - Output mode and destination directory.
 *
 * @param summary - The summary to render (typically from {@link generateSummary}).
 */
export function printSummary(summary: SanitizationSummary): void {
  const lines: string[] = [
    '',
    'playwright-sanitizer — Sanitization Summary',
    '───────────────────────────────────────────────────────────────',
    `Files processed     : ${summary.filesProcessed.reports} HTML reports, ${summary.filesProcessed.traces} trace files`,
  ];

  if (summary.redact.patternsLoaded > 0) {
    lines.push(
      `[ redact ] Secrets masked  : ${summary.redact.totalOccurrencesReplaced} values across ${summary.redact.patternsLoaded} declared patterns`
    );
    const patternEntries = Object.entries(summary.redact.byPatternId);
    for (let i = 0; i < patternEntries.length; i++) {
      const [id, count] = patternEntries[i]!;
      const prefix =
        i === patternEntries.length - 1 ? '  └─' : '  ├─';
      lines.push(
        `${prefix} ${id.padEnd(25)}: ${count} occurrences`
      );
    }
  }

  if (summary.remove.rulesLoaded > 0) {
    lines.push(
      `[ remove ] Steps deleted   : ${summary.remove.totalStepsDeleted} steps across ${summary.remove.rulesLoaded} declared rules`
    );
    for (let i = 0; i < summary.remove.byRuleLabel.length; i++) {
      const entry = summary.remove.byRuleLabel[i]!;
      const prefix =
        i === summary.remove.byRuleLabel.length - 1 ? '  └─' : '  ├─';
      lines.push(
        `${prefix} ${entry.label.padEnd(40)}: ${entry.count} removed (${entry.files} files)`
      );
    }
    lines.push(
      `Timestamp repairs   : ${summary.remove.timestampRepairs} adjustments (strategy: ${summary.remove.timestampStrategy})`
    );
  }

  if (summary.remove.safetyGuardWarnings.length > 0) {
    lines.push('Safety guard warnings:');
    for (const w of summary.remove.safetyGuardWarnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  lines.push(`Output              : ${summary.output.mode} → ${summary.output.dir}`);
  lines.push(
    '───────────────────────────────────────────────────────────────'
  );

  console.log(lines.join('\n'));
}

/**
 * Serialises a {@link SanitizationSummary} to a JSON file at the given path.
 *
 * Creates parent directories as needed. The JSON is pretty-printed with
 * 2-space indentation for human readability.
 *
 * @param summary  - The summary to serialise.
 * @param filePath - Destination file path (absolute or relative to `cwd`).
 */
export function writeSummaryFile(
  summary: SanitizationSummary,
  filePath: string
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
  logger.verbose(`Summary written to ${filePath}`);
}
