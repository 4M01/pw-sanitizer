import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SanitizerConfig,
  RedactPattern,
  RemoveRule,
  ProcessResult,
  TraceEvent,
} from '../config/types.js';
import { walkAndRedact } from '../redact/json-walker.js';
import { findStepsToRemove } from '../remove/detector.js';
import { removeSteps } from '../remove/remover.js';
import { repairTimestamps } from '../remove/timestamp-repair.js';
import { logger } from '../logger.js';
import { writeOutput } from '../utils.js';

/**
 * Regex that locates the embedded JSON blob inside a Playwright HTML report.
 *
 * Playwright injects report data as:
 * `window.__pw_report_data__ = { ... };</script>`
 *
 * The first capture group (`[1]`) contains the raw JSON object literal.
 * The `s` flag allows `.` to match newlines (the blob can be multi-line).
 */
const REPORT_DATA_REGEX =
  /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s;

/**
 * Sanitizes a single Playwright HTML report file.
 *
 * Processing pipeline:
 * 1. Read the HTML file from disk.
 * 2. Extract the embedded `window.__pw_report_data__` JSON blob via regex.
 * 3. **Redact phase** (if `config.redact` is set and patterns are loaded):
 *    walk the JSON tree with {@link walkAndRedact} and replace matched values.
 * 4. **Remove phase** (if `config.remove` is set and rules are loaded):
 *    extract step events, run {@link findStepsToRemove}, then
 *    {@link removeSteps} and {@link repairTimestamps}.
 * 5. Re-serialise the JSON and splice it back into the original HTML.
 * 6. Write the output according to `config.output.mode`.
 *
 * On any unrecoverable parse error, the function logs a warning and returns
 * an empty {@link ProcessResult} rather than throwing.
 *
 * @param inputPath  - Absolute path to the source HTML report file.
 * @param outputPath - Destination path for the sanitized output.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns (from {@link buildPatternRegistry}).
 * @param rules      - Pre-built list of removal rules (from {@link buildRuleRegistry}).
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
  const match = REPORT_DATA_REGEX.exec(html);

  if (!match?.[1]) {
    logger.warn(
      `Could not find embedded report data in ${inputPath}. ` +
      `Expected pattern: window.__pw_report_data__ = {...};`
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
    // The report data typically has a structure with tests/suites containing steps
    const events = extractEventsFromReport(reportData);
    if (events.length > 0) {
      const removalSet = findStepsToRemove(events, rules);

      // Always propagate safety warnings regardless of whether removal runs
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

          // Remove steps — orphanStrategy controls whether matched parents or only
          // their children are dropped from the flat events array.
          const cleaned = removeSteps(events, removalSet, orphanStrategy);
          const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';

          // Determine which events were actually removed (set-difference by identity).
          // For remove-children: matched events + their descendants.
          // For keep-shell: only the children (matched events are kept).
          const cleanedSet = new Set(cleaned);
          const actuallyRemovedEvents = events.filter((e) => !cleanedSet.has(e));

          const repaired = repairTimestamps(cleaned, actuallyRemovedEvents, strategy);

          // Build callId → repaired event for tree timestamp updates
          const repairedByCallId = new Map<string, TraceEvent>();
          for (const e of repaired) {
            if (e.callId) repairedByCallId.set(e.callId, e);
          }

          // For the tree traversal: in keep-shell mode the matched parent objects
          // stay in the tree — only their children are filtered out.
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
 * Flattens the nested Playwright HTML report structure into a single array of
 * step/action events that can be processed by the removal pipeline.
 *
 * Playwright HTML reports nest steps under `suites → tests → results → steps`.
 * This function performs a depth-first traversal, collecting any node that
 * looks like a step (has `startTime`/`endTime`, `title`, or `action` fields)
 * and recursing into known container keys (`steps`, `actions`, `suites`,
 * `tests`, `results`, `attachments`).
 *
 * @param data - The parsed `window.__pw_report_data__` object.
 * @returns A flat array of event-like objects cast to {@link TraceEvent}.
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

    // Check if this looks like a step/action event
    if (
      ('startTime' in obj && 'endTime' in obj) ||
      'title' in obj ||
      'action' in obj
    ) {
      events.push(obj as unknown as TraceEvent);
    }

    // Recurse into common containers
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
 * Rebuilds the nested step/action arrays in the HTML report tree after removal.
 *
 * Because {@link extractEventsFromReport} returns object **references** that
 * live inside the report tree, `eventsToRemove` can be used as an identity
 * set to filter matching objects directly from the tree's `steps` / `actions`
 * arrays without a separate re-serialisation step.
 *
 * Additionally, repaired timestamps (computed from the flat event array) are
 * applied back to tree nodes that carry a `callId` field.
 *
 * @param data            - The parsed `window.__pw_report_data__` object.
 * @param eventsToRemove  - Set of original event objects to exclude from step arrays.
 * @param repairedByCallId - Map of `callId` → repaired event used to update timestamps.
 */
function replaceEventsInReport(
  data: unknown,
  eventsToRemove: Set<object>,
  repairedByCallId: Map<string, TraceEvent>
): void {
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    const obj = node as Record<string, unknown>;

    // Apply repaired timestamps to this node when it has a known callId
    if (typeof obj['callId'] === 'string') {
      const repaired = repairedByCallId.get(obj['callId']);
      if (repaired) {
        obj['startTime'] = repaired.startTime;
        obj['endTime'] = repaired.endTime;
      }
    }

    // Filter removed events from step/action arrays and recurse into survivors
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

    // Recurse into structural containers (not filtered)
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


