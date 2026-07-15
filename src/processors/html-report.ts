import * as fs from 'node:fs';
import JSZip from 'jszip';
import type {
  SanitizerConfig,
  RedactPattern,
  RemoveRule,
  ProcessResult,
  TraceEvent,
  TimestampStrategy,
} from '../config/types.js';
import { walkAndRedact } from '../redact/json-walker.js';
import { findStepsToRemove } from '../remove/detector.js';
import { removeSteps } from '../remove/remover.js';
import { repairTimestamps } from '../remove/timestamp-repair.js';
import { logger } from '../logger.js';
import { writeOutput } from '../utils.js';

/**
 * Playwright's HTML reporter (>= 1.40, verified against 1.40–1.61) embeds all
 * report data as a base64-encoded zip. Two embedding styles exist:
 *
 * - Older versions (~1.40): a script assignment
 *   `window.playwrightReportBase64 = "data:application/zip;base64,<...>";`
 * - Newer versions: a template element
 *   `<template id="playwrightReportBase64">data:application/zip;base64,<...></template>`
 *
 * The zip contains `report.json` (aggregate stats) plus one JSON shard per
 * test file; step trees live in the shards as nested
 * `{ title, duration, steps: [...] }` objects.
 */
const WINDOW_BASE64_REGEX =
  /(window\.playwrightReportBase64\s*=\s*")data:application\/zip;base64,([A-Za-z0-9+/=]*)(";)/;

const TEMPLATE_BASE64_REGEX =
  /(<template id="playwrightReportBase64">)data:application\/zip;base64,([^<]*)(<\/template>)/;

/**
 * Legacy regex kept as a fallback for pre-base64 report formats that embedded
 * plain JSON as `window.__pw_report_data__ = {...};</script>`.
 */
const REPORT_DATA_REGEX =
  /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s;

/** Nested step node inside an HTML report shard. */
interface ReportStepNode {
  title?: string;
  startTime?: string;
  duration?: number;
  steps?: ReportStepNode[];
  count?: number;
  [key: string]: unknown;
}

/** Mutable counters shared across the recursive shard walk. */
interface RemovalCounters {
  stepsRemoved: number;
  timestampRepairs: number;
  mutations: number;
}

/** Counts a node and all of its descendants. */
function countStepNodes(steps: ReportStepNode[] | undefined): number {
  if (!steps) return 0;
  let n = 0;
  for (const s of steps) {
    n += 1 + countStepNodes(s.steps);
  }
  return n;
}

/** Parses a shard step's startTime (ISO string) into epoch ms; NaN-safe. */
function stepStartMs(step: ReportStepNode): number {
  const t = typeof step.startTime === 'string' ? Date.parse(step.startTime) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Applies removal rules to one nested `steps` array of a report shard
 * (recursively). Returns the filtered array.
 *
 * - `keep-shell`: the matched step node itself is kept; its `steps` array is
 *   emptied and count-related fields are reset.
 * - `remove-children`: the matched node (and implicitly its whole subtree)
 *   is removed from the array; sibling timestamps are repaired according to
 *   `timestampStrategy` (`absorb-into-prev` extends the previous sibling's
 *   duration, `absorb-into-next` shifts and extends the next sibling,
 *   `gap` leaves a hole).
 */
function sanitizeStepTree(
  steps: ReportStepNode[],
  rules: RemoveRule[],
  orphanStrategy: 'remove-children' | 'keep-shell',
  timestampStrategy: TimestampStrategy,
  counters: RemovalCounters,
  result: ProcessResult,
  dryRun: boolean
): ReportStepNode[] {
  if (steps.length === 0) return steps;

  // Build synthetic flat events for this sibling group so the shared detector
  // (including AND-matcher logic and minConsecutiveOccurrences runs) applies.
  const synthetic: TraceEvent[] = steps.map((s) => {
    const start = stepStartMs(s);
    return {
      title: s.title,
      startTime: start,
      endTime: start + (typeof s.duration === 'number' ? s.duration : 0),
    };
  });

  const removalSet = findStepsToRemove(synthetic, rules);
  result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);

  const matchedIndices = removalSet.indices;
  if (matchedIndices.size > 0) {
    result.removalMatches.push(...removalSet.matches);
  }

  if (dryRun) {
    // Report matches but do not mutate; still recurse to report nested matches.
    for (const i of matchedIndices) {
      const s = steps[i]!;
      counters.stepsRemoved +=
        orphanStrategy === 'keep-shell'
          ? countStepNodes(s.steps)
          : 1 + countStepNodes(s.steps);
    }
    steps.forEach((s, i) => {
      if (!matchedIndices.has(i) && s.steps) {
        sanitizeStepTree(s.steps, rules, orphanStrategy, timestampStrategy, counters, result, dryRun);
      }
    });
    return steps;
  }

  const output: ReportStepNode[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    if (matchedIndices.has(i)) {
      if (orphanStrategy === 'keep-shell') {
        // Keep the matched node as a hollow shell: empty its children and
        // reset count-related fields, but preserve its own duration.
        counters.stepsRemoved += countStepNodes(step.steps);
        counters.mutations++;
        step.steps = [];
        if (typeof step.count === 'number') step.count = 1;
        output.push(step);
      } else {
        // remove-children: drop the whole subtree.
        counters.stepsRemoved += 1 + countStepNodes(step.steps);
        counters.mutations++;

        const removedDuration = typeof step.duration === 'number' ? step.duration : 0;
        if (removedDuration > 0 && timestampStrategy !== 'gap') {
          if (timestampStrategy === 'absorb-into-next') {
            const next = steps
              .slice(i + 1)
              .find((s, j) => !matchedIndices.has(i + 1 + j));
            if (next) {
              if (typeof next.startTime === 'string') {
                const t = Date.parse(next.startTime);
                if (Number.isFinite(t)) {
                  next.startTime = new Date(t - removedDuration).toISOString();
                }
              }
              if (typeof next.duration === 'number') next.duration += removedDuration;
              counters.timestampRepairs++;
            } else if (output.length > 0) {
              const prev = output[output.length - 1]!;
              if (typeof prev.duration === 'number') prev.duration += removedDuration;
              counters.timestampRepairs++;
            }
          } else {
            // absorb-into-prev (default)
            const prev = output.length > 0 ? output[output.length - 1] : undefined;
            if (prev && typeof prev.duration === 'number') {
              prev.duration += removedDuration;
              counters.timestampRepairs++;
            } else {
              const next = steps
                .slice(i + 1)
                .find((s, j) => !matchedIndices.has(i + 1 + j));
              if (next) {
                if (typeof next.startTime === 'string') {
                  const t = Date.parse(next.startTime);
                  if (Number.isFinite(t)) {
                    next.startTime = new Date(t - removedDuration).toISOString();
                  }
                }
                if (typeof next.duration === 'number') next.duration += removedDuration;
                counters.timestampRepairs++;
              }
            }
          }
        }
      }
      continue;
    }

    // Not matched — recurse into children.
    if (Array.isArray(step.steps) && step.steps.length > 0) {
      step.steps = sanitizeStepTree(
        step.steps, rules, orphanStrategy, timestampStrategy, counters, result, dryRun
      );
    }
    output.push(step);
  }

  return output;
}

/**
 * Applies removal rules to all step trees found in a parsed shard JSON.
 * Shards contain `tests[].results[].steps` (each step may nest further).
 */
function sanitizeShard(
  shard: unknown,
  rules: RemoveRule[],
  orphanStrategy: 'remove-children' | 'keep-shell',
  timestampStrategy: TimestampStrategy,
  counters: RemovalCounters,
  result: ProcessResult,
  dryRun: boolean
): boolean {
  if (!shard || typeof shard !== 'object') return false;
  const before = counters.mutations;

  const tests = (shard as Record<string, unknown>)['tests'];
  if (!Array.isArray(tests)) return false;

  for (const test of tests) {
    if (!test || typeof test !== 'object') continue;
    const results = (test as Record<string, unknown>)['results'];
    if (!Array.isArray(results)) continue;
    for (const res of results) {
      if (!res || typeof res !== 'object') continue;
      const resObj = res as Record<string, unknown>;
      if (Array.isArray(resObj['steps'])) {
        resObj['steps'] = sanitizeStepTree(
          resObj['steps'] as ReportStepNode[],
          rules, orphanStrategy, timestampStrategy, counters, result, dryRun
        );
      }
    }
  }

  return counters.mutations > before;
}

/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Supports the **real Playwright HTML report format** (>= 1.40): the report
 * data is embedded as a base64-encoded zip (see {@link WINDOW_BASE64_REGEX}
 * and {@link TEMPLATE_BASE64_REGEX}). The zip is decoded, its `report.json`
 * and per-test-file JSON shards are redacted and step-pruned, then it is
 * re-zipped, re-encoded, and substituted back into the HTML.
 *
 * **Legacy fallback:** reports embedding plain JSON via
 * `window.__pw_report_data__` are still processed through the original path.
 *
 * @param inputPath  - Absolute path to the source HTML report file.
 * @param outputPath - Destination path for the sanitized output.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns.
 * @param rules      - Pre-built list of removal rules.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export async function processHtmlReport(
  inputPath: string,
  outputPath: string,
  config: SanitizerConfig,
  patterns: RedactPattern[],
  rules: RemoveRule[]
): Promise<ProcessResult> {
  const result: ProcessResult = {
    file: inputPath,
    redactionsApplied: 0,
    stepsRemoved: 0,
    timestampRepairs: 0,
    redactionMatches: [],
    removalMatches: [],
    safetyGuardWarnings: [],
  };

  const html = fs.readFileSync(inputPath, 'utf-8');

  // Try the real (base64 zip) format first — window assignment, then template.
  const base64Match =
    WINDOW_BASE64_REGEX.exec(html) ?? TEMPLATE_BASE64_REGEX.exec(html);

  if (base64Match) {
    return processBase64Report(
      html, base64Match, inputPath, outputPath, config, patterns, rules, result
    );
  }

  // Legacy fallback: plain-JSON window.__pw_report_data__ blob.
  if (REPORT_DATA_REGEX.test(html)) {
    return processLegacyReportData(
      html, inputPath, outputPath, config, patterns, rules, result
    );
  }

  // No report payload marker at all. This is expected for the static
  // trace-viewer app assets Playwright ships inside the report directory
  // (playwright-report/trace/index.html, uiMode.html, snapshot.html, ...),
  // so it is logged at verbose level rather than as a warning.
  logger.verbose(
    `No embedded report payload found in ${inputPath} — skipping ` +
    `(likely a static asset such as the trace viewer app, not a report).`
  );
  return result;
}

/**
 * Processes the modern base64-zip report format.
 *
 * @param base64Match - Regex match with groups: [1] prefix, [2] base64 payload, [3] suffix.
 */
async function processBase64Report(
  html: string,
  base64Match: RegExpExecArray,
  inputPath: string,
  outputPath: string,
  config: SanitizerConfig,
  patterns: RedactPattern[],
  rules: RemoveRule[],
  result: ProcessResult
): Promise<ProcessResult> {
  const [fullMatch, prefix, base64Payload, suffix] = base64Match;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(Buffer.from(base64Payload!, 'base64'));
  } catch (err) {
    logger.warn(
      `Failed to decode embedded report zip in ${inputPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  // Parse every JSON entry (report.json + one shard per test file).
  const entries: Array<{ name: string; data: unknown; modified: boolean }> = [];
  const entryNames: string[] = [];
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) entryNames.push(relativePath);
  });

  for (const name of entryNames) {
    if (!name.endsWith('.json')) continue;
    const entry = zip.file(name);
    if (!entry) continue;
    try {
      const content = await entry.async('string');
      entries.push({ name, data: JSON.parse(content), modified: false });
    } catch (err) {
      logger.warn(
        `Failed to parse ${name} inside report zip of ${inputPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (entries.length === 0) {
    logger.warn(`No JSON entries found inside embedded report zip of ${inputPath}.`);
    return result;
  }

  let modified = false;
  const dryRun = config.remove?.dryRun ?? false;

  // ── Redact phase ──
  if (config.redact && patterns.length > 0) {
    for (const entry of entries) {
      const walk = walkAndRedact(entry.data, patterns, config.redact);
      if (walk.count > 0) {
        entry.data = walk.result;
        entry.modified = true;
        result.redactionsApplied += walk.count;
        result.redactionMatches.push(...walk.matches);
        modified = true;
      }
    }
  }

  // ── Remove phase ──
  if (config.remove && rules.length > 0) {
    const orphanStrategy = config.remove.orphanStrategy ?? 'remove-children';
    const timestampStrategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
    const counters: RemovalCounters = { stepsRemoved: 0, timestampRepairs: 0, mutations: 0 };

    for (const entry of entries) {
      if (entry.name === 'report.json') continue; // no step trees in the aggregate
      const changed = sanitizeShard(
        entry.data, rules, orphanStrategy, timestampStrategy, counters, result, dryRun
      );
      if (changed && !dryRun) {
        entry.modified = true;
        modified = true;
      }
    }

    result.stepsRemoved += counters.stepsRemoved;
    result.timestampRepairs += counters.timestampRepairs;

    if (dryRun && counters.stepsRemoved > 0) {
      logger.info(
        `[DRY RUN] Would remove ${counters.stepsRemoved} steps from ${inputPath}`
      );
      for (const m of result.removalMatches) {
        logger.info(
          `  - Rule "${m.ruleLabel}": step "${m.event.title ?? 'unknown'}"`
        );
      }
    }
  }

  if (!modified && !dryRun) {
    logger.info(`No changes made to ${inputPath}`);
  }

  // Write output (unless dry-run)
  if (!dryRun) {
    for (const entry of entries) {
      if (entry.modified) {
        zip.file(entry.name, JSON.stringify(entry.data));
      }
    }

    const newBase64 = await zip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
    });

    const replacement = `${prefix}data:application/zip;base64,${newBase64}${suffix}`;
    const newHtml =
      html.slice(0, base64Match.index) +
      replacement +
      html.slice(base64Match.index + fullMatch!.length);

    writeOutput(inputPath, outputPath, newHtml, config);
  }

  return result;
}

/**
 * Legacy processing path for reports that embed plain JSON via
 * `window.__pw_report_data__ = {...};`. Kept for backwards compatibility.
 */
function processLegacyReportData(
  html: string,
  inputPath: string,
  outputPath: string,
  config: SanitizerConfig,
  patterns: RedactPattern[],
  rules: RemoveRule[],
  result: ProcessResult
): ProcessResult {
  const match = REPORT_DATA_REGEX.exec(html);

  if (!match?.[1]) {
    logger.warn(
      `Could not find embedded report data in ${inputPath}. ` +
      `Expected a base64 report payload (window.playwrightReportBase64 / ` +
      `<template id="playwrightReportBase64">) or legacy ` +
      `window.__pw_report_data__ = {...};`
    );
    return result;
  }

  let reportData: unknown;
  try {
    reportData = JSON.parse(match[1]);
  } catch (err) {
    logger.warn(
      `Failed to parse embedded JSON in ${inputPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  let modified = false;

  // Redact phase
  if (config.redact && patterns.length > 0) {
    const walkResult = walkAndRedact(reportData, patterns, config.redact);
    if (walkResult.count > 0) {
      reportData = walkResult.result;
      result.redactionsApplied = walkResult.count;
      result.redactionMatches = walkResult.matches;
      modified = true;
    }
  }

  // Remove phase
  if (config.remove && rules.length > 0) {
    const events = extractEventsFromReport(reportData);
    if (events.length > 0) {
      const removalSet = findStepsToRemove(events, rules);
      result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);

      if (removalSet.indices.size > 0) {
        if (config.remove.dryRun) {
          logger.info(
            `[DRY RUN] Would remove ${removalSet.indices.size} steps from ${inputPath}`
          );
          for (const m of removalSet.matches) {
            logger.info(
              `  - Rule "${m.ruleLabel}": step at index ${m.index} ` +
              `("${m.event.title ?? m.event.action ?? 'unknown'}")`
            );
          }
          result.removalMatches = removalSet.matches;
          result.stepsRemoved = removalSet.indices.size;
        } else {
          const orphanStrategy = config.remove.orphanStrategy ?? 'remove-children';
          const cleaned = removeSteps(events, removalSet, orphanStrategy);
          const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';

          const cleanedSet = new Set(cleaned);
          const actuallyRemovedEvents = events.filter((e) => !cleanedSet.has(e));

          // keep-shell: kept parents still span the hidden children's time —
          // no timeline hole exists, so nothing may be absorbed into neighbours.
          const repaired = repairTimestamps(
            cleaned,
            orphanStrategy === 'keep-shell' ? [] : actuallyRemovedEvents,
            strategy
          );

          const repairedByCallId = new Map<string, TraceEvent>();
          for (const e of repaired) {
            if (e.callId) repairedByCallId.set(e.callId, e);
          }

          const treeEventsToRemove = new Set<object>(actuallyRemovedEvents);

          replaceEventsInReport(reportData, treeEventsToRemove, repairedByCallId);
          result.stepsRemoved = actuallyRemovedEvents.length;
          result.timestampRepairs = actuallyRemovedEvents.length;
          result.removalMatches = removalSet.matches;
          modified = true;
        }
      }
    }
  }

  if (!modified && !config.remove?.dryRun) {
    logger.info(`No changes made to ${inputPath}`);
  }

  // Write output (unless dry-run)
  if (!config.remove?.dryRun) {
    const newJson = JSON.stringify(reportData);
    const newHtml = html.replace(
      REPORT_DATA_REGEX,
      `window.__pw_report_data__ = ${newJson};</script>`
    );
    writeOutput(inputPath, outputPath, newHtml, config);
  }

  return result;
}

/**
 * Flattens the nested legacy report structure into a single array of
 * step/action events that can be processed by the removal pipeline.
 */
function extractEventsFromReport(data: unknown): TraceEvent[] {
  const events: TraceEvent[] = [];

  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
      return;
    }

    const obj = node as Record<string, unknown>;

    if (
      ('startTime' in obj && 'endTime' in obj) ||
      'title' in obj ||
      'action' in obj
    ) {
      events.push(obj as unknown as TraceEvent);
    }

    for (const key of ['steps', 'actions', 'suites', 'tests', 'results', 'attachments']) {
      if (key in obj && Array.isArray(obj[key])) {
        traverse(obj[key]);
      }
    }
  }

  traverse(data);
  return events;
}

/**
 * Rebuilds the nested step/action arrays in the legacy report tree after
 * removal (identity-based filtering plus timestamp write-back).
 */
function replaceEventsInReport(
  data: unknown,
  eventsToRemove: Set<object>,
  repairedByCallId: Map<string, TraceEvent>
): void {
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    const obj = node as Record<string, unknown>;

    if (typeof obj['callId'] === 'string') {
      const repaired = repairedByCallId.get(obj['callId']);
      if (repaired) {
        obj['startTime'] = repaired.startTime;
        obj['endTime'] = repaired.endTime;
      }
    }

    for (const key of ['steps', 'actions']) {
      if (Array.isArray(obj[key])) {
        obj[key] = (obj[key] as unknown[]).filter(
          (item) => !(item !== null && typeof item === 'object' && eventsToRemove.has(item))
        );
        for (const item of obj[key] as unknown[]) {
          traverse(item);
        }
      }
    }

    for (const key of ['suites', 'tests', 'results', 'attachments']) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key] as unknown[]) {
          traverse(item);
        }
      }
    }
  }

  traverse(data);
}
