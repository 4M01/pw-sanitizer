import * as fs from 'node:fs';
import JSZip from 'jszip';
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
import { redactScreenshot } from './screenshot.js';
import { logger } from '../logger.js';
import { writeOutput } from '../utils.js';

/**
 * A single parsed line of an NDJSON trace/network file.
 *
 * `obj` is `null` when the line is empty or not valid JSON — such lines are
 * always written back verbatim and never modified.
 */
interface NdjsonLine {
  /** The original raw line text (without trailing newline). */
  raw: string;
  /** Parsed JSON object, or `null` if the line could not be parsed. */
  obj: Record<string, unknown> | null;
  /** Marked `true` when the line should be dropped from the output. */
  removed: boolean;
  /** Marked `true` when `obj` was mutated and must be re-serialized. */
  dirty: boolean;
}

/** A parsed NDJSON file plus bookkeeping needed to write it back. */
interface NdjsonFile {
  /** Entry name inside the zip (e.g. `test.trace`, `0-trace.network`). */
  name: string;
  /** Parsed lines in original order. */
  lines: NdjsonLine[];
  /** Whether the original content ended with a newline. */
  trailingNewline: boolean;
}

/**
 * A step reconstructed from a `"before"` / `"after"` NDJSON event pair.
 *
 * Real Playwright traces (>= 1.40 stable format) store each step as two
 * separate NDJSON events sharing a `callId`:
 *
 * ```
 * {"type":"before","callId":"test.step@63","stepId":"test.step@63","parentId":"test.step@33",
 *  "startTime":89411818.027,"class":"Test","method":"test.step","title":"...","params":{},"stack":[...]}
 * {"type":"after","callId":"test.step@63","endTime":89411819.5,...}
 * ```
 */
interface NdjsonStep {
  callId: string;
  parentId?: string;
  /** Line index of the `"before"` event within its file. */
  beforeIndex: number;
  /** Line index of the paired `"after"` event, or -1 if absent. */
  afterIndex: number;
  /** Synthetic flat event used with the shared detector/repair pipeline. */
  synthetic: TraceEvent;
}

/** Reads NDJSON content into structured lines. */
function parseNdjson(name: string, content: string): NdjsonFile {
  const trailingNewline = content.endsWith('\n');
  const body = trailingNewline ? content.slice(0, -1) : content;
  const lines: NdjsonLine[] = body.split('\n').map((raw) => {
    let obj: Record<string, unknown> | null = null;
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          obj = parsed as Record<string, unknown>;
        }
      } catch {
        // Not valid JSON — leave as raw passthrough
      }
    }
    return { raw, obj, removed: false, dirty: false };
  });
  return { name, lines, trailingNewline };
}

/** Serializes an {@link NdjsonFile} back to text, preserving untouched lines verbatim. */
function serializeNdjson(file: NdjsonFile): string {
  const out = file.lines
    .filter((l) => !l.removed)
    .map((l) => (l.dirty && l.obj ? JSON.stringify(l.obj) : l.raw));
  return out.join('\n') + (file.trailingNewline ? '\n' : '');
}

/** Returns the step identifier of an event line (`callId`, falling back to `stepId`). */
function lineCallId(obj: Record<string, unknown>): string | undefined {
  const callId = obj['callId'];
  if (typeof callId === 'string') return callId;
  const stepId = obj['stepId'];
  if (typeof stepId === 'string') return stepId;
  return undefined;
}

/**
 * Reconstructs the step list of an NDJSON trace file from its
 * `"before"` / `"after"` event pairs, in `"before"`-line order.
 */
function collectSteps(file: NdjsonFile): NdjsonStep[] {
  const steps: NdjsonStep[] = [];
  const byCallId = new Map<string, NdjsonStep>();

  for (let i = 0; i < file.lines.length; i++) {
    const obj = file.lines[i]!.obj;
    if (!obj) continue;

    if (obj['type'] === 'before') {
      const callId = lineCallId(obj);
      if (!callId) continue;
      const params = (obj['params'] ?? {}) as Record<string, unknown>;
      const step: NdjsonStep = {
        callId,
        parentId: typeof obj['parentId'] === 'string' ? obj['parentId'] : undefined,
        beforeIndex: i,
        afterIndex: -1,
        synthetic: {
          // Playwright >= ~1.45 uses `title`; older versions (e.g. 1.40) used `apiName`.
          title:
            typeof obj['title'] === 'string'
              ? obj['title']
              : typeof obj['apiName'] === 'string'
                ? (obj['apiName'] as string)
                : undefined,
          method: typeof obj['method'] === 'string' ? obj['method'] : undefined,
          actionType: typeof obj['method'] === 'string' ? obj['method'] : undefined,
          selector: typeof params['selector'] === 'string' ? (params['selector'] as string) : undefined,
          url: typeof params['url'] === 'string' ? (params['url'] as string) : undefined,
          startTime: typeof obj['startTime'] === 'number' ? obj['startTime'] : 0,
          endTime: typeof obj['startTime'] === 'number' ? obj['startTime'] : 0,
          callId,
          parentId: typeof obj['parentId'] === 'string' ? obj['parentId'] : undefined,
        },
      };
      steps.push(step);
      byCallId.set(callId, step);
    } else if (obj['type'] === 'after') {
      const callId = lineCallId(obj);
      if (!callId) continue;
      const step = byCallId.get(callId);
      if (step) {
        step.afterIndex = i;
        if (typeof obj['endTime'] === 'number') {
          step.synthetic.endTime = obj['endTime'];
        }
      }
    }
  }

  return steps;
}

/**
 * Expands a set of matched step callIds to include all descendants by walking
 * the `parentId` chain (children can nest arbitrarily — test.step children,
 * pw:api calls, expects, etc.).
 */
function collectDescendantCallIds(
  steps: NdjsonStep[],
  rootCallIds: Set<string>
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const step of steps) {
    if (step.parentId) {
      const list = childrenByParent.get(step.parentId) ?? [];
      list.push(step.callId);
      childrenByParent.set(step.parentId, list);
    }
  }

  const descendants = new Set<string>();
  const queue = [...rootCallIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!descendants.has(child) && !rootCallIds.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }
  return descendants;
}

/**
 * Applies removal rules to one NDJSON `.trace` file.
 *
 * - Rules are matched against the `"before"` events (title / method / params).
 * - `orphanStrategy: 'keep-shell'` keeps the matched step's own before/after
 *   lines but removes all descendant events.
 * - `orphanStrategy: 'remove-children'` removes the matched step and all
 *   descendants (both `"before"` and paired `"after"` lines).
 * - `timestampStrategy` is applied to the surviving steps' `startTime` /
 *   `endTime` (and `monotonicTime` where present) via {@link repairTimestamps}.
 *
 * @returns Whether the file was modified plus the callIds of removed steps
 *   (used to drop correlated `*.network` events).
 */
function applyRemovalToTraceFile(
  file: NdjsonFile,
  rules: RemoveRule[],
  config: SanitizerConfig,
  result: ProcessResult,
  inputPath: string
): { modified: boolean; removedCallIds: Set<string> } {
  const none = { modified: false, removedCallIds: new Set<string>() };
  const steps = collectSteps(file);
  if (steps.length === 0) return none;

  const syntheticEvents = steps.map((s) => s.synthetic);
  const removalSet = findStepsToRemove(syntheticEvents, rules);
  result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);

  if (removalSet.indices.size === 0) return none;

  if (config.remove?.dryRun) {
    logger.info(
      `[DRY RUN] Would remove ${removalSet.indices.size} steps from ${inputPath} (${file.name})`
    );
    for (const m of removalSet.matches) {
      logger.info(
        `  - Rule "${m.ruleLabel}": step at index ${m.index} ` +
        `("${m.event.title ?? m.event.action ?? 'unknown'}")`
      );
    }
    result.removalMatches.push(...removalSet.matches);
    result.stepsRemoved += removalSet.indices.size;
    return none;
  }

  const orphanStrategy = config.remove?.orphanStrategy ?? 'remove-children';

  const matchedCallIds = new Set<string>();
  for (const idx of removalSet.indices) {
    matchedCallIds.add(steps[idx]!.callId);
  }
  const descendantCallIds = collectDescendantCallIds(steps, matchedCallIds);

  // keep-shell: keep the matched steps' own before/after events, drop descendants.
  // remove-children: drop matched steps AND descendants.
  const removedCallIds = new Set<string>(descendantCallIds);
  if (orphanStrategy !== 'keep-shell') {
    for (const id of matchedCallIds) removedCallIds.add(id);
  }

  if (removedCallIds.size === 0) {
    result.removalMatches.push(...removalSet.matches);
    return none;
  }

  // Drop every event line belonging to a removed step (before, after, and any
  // auxiliary events such as logs that carry the same callId).
  for (const line of file.lines) {
    if (!line.obj) continue;
    const callId = lineCallId(line.obj);
    if (callId && removedCallIds.has(callId)) {
      line.removed = true;
    }
  }

  // ── Timestamp repair ──
  const strategy = config.remove?.timestampStrategy ?? 'absorb-into-prev';
  const survivors = steps.filter((s) => !removedCallIds.has(s.callId));
  const removedSteps = steps.filter((s) => removedCallIds.has(s.callId));

  // Clone synthetic events so the repair never mutates our originals.
  const survivorClones: TraceEvent[] = survivors.map((s) => ({ ...s.synthetic }));
  const removedClones: TraceEvent[] = removedSteps.map((s) => ({ ...s.synthetic }));
  const repaired = repairTimestamps(survivorClones, removedClones, strategy);

  const repairedByCallId = new Map<string, TraceEvent>();
  for (const e of repaired) {
    if (e.callId) repairedByCallId.set(e.callId, e);
  }

  let timestampRepairs = 0;
  for (const step of survivors) {
    const fixed = repairedByCallId.get(step.callId);
    if (!fixed) continue;

    if (fixed.startTime !== step.synthetic.startTime) {
      const beforeLine = file.lines[step.beforeIndex]!;
      if (beforeLine.obj) {
        beforeLine.obj['startTime'] = fixed.startTime;
        if (typeof beforeLine.obj['monotonicTime'] === 'number') {
          beforeLine.obj['monotonicTime'] = fixed.startTime;
        }
        beforeLine.dirty = true;
        timestampRepairs++;
      }
    }
    if (fixed.endTime !== step.synthetic.endTime && step.afterIndex >= 0) {
      const afterLine = file.lines[step.afterIndex]!;
      if (afterLine.obj) {
        afterLine.obj['endTime'] = fixed.endTime;
        if (typeof afterLine.obj['monotonicTime'] === 'number') {
          afterLine.obj['monotonicTime'] = fixed.endTime;
        }
        afterLine.dirty = true;
        timestampRepairs++;
      }
    }
  }

  result.stepsRemoved += removedCallIds.size;
  result.timestampRepairs += timestampRepairs;
  result.removalMatches.push(...removalSet.matches);
  return { modified: true, removedCallIds };
}

/**
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Supports the **real Playwright trace format** (Playwright >= 1.40, verified
 * against 1.40–1.61): the archive contains NDJSON event streams named
 * `test.trace`, `0-trace.trace`, `1-trace.trace`, ..., `N-trace.network`,
 * `N-trace.stacks` plus a `resources/` folder. Each `.trace` / `.network`
 * entry holds one JSON event per line.
 *
 * Processing pipeline:
 * 1. Read and parse the `.zip` archive with JSZip.
 * 2. Parse every `*.trace` and `*.network` entry as NDJSON.
 * 3. **Redact phase**: walk and redact each parsed event line, plus
 *    `.json` / `.txt` files inside `resources/`.
 * 4. **Remove phase**: match rules against `"before"` event titles in each
 *    `*.trace` file; drop matched steps and/or their descendant events
 *    according to `orphanStrategy`; repair timestamps according to
 *    `timestampStrategy`. Matching `*.network` events (same `callId`) are
 *    dropped as well.
 * 5. **Screenshot redaction phase** (optional, requires `sharp`).
 * 6. Write back NDJSON preserving the line order of untouched events, re-zip
 *    and write according to `config.output.mode`.
 *
 * **Legacy fallback:** archives containing a `trace.json` (the pre-NDJSON
 * fake/legacy layout) are still processed through the original JSON-array
 * code path.
 *
 * @param inputPath  - Absolute path to the source trace `.zip` file.
 * @param outputPath - Destination path for the sanitized output archive.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns.
 * @param rules      - Pre-built list of removal rules.
 * @returns A {@link ProcessResult} with counts and match details for this file.
 */
export async function processTraceFile(
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

  let zipData: Buffer;
  try {
    zipData = fs.readFileSync(inputPath);
  } catch (err) {
    logger.warn(
      `Could not read trace file ${inputPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch (err) {
    logger.warn(
      `Could not parse trace zip ${inputPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  // Discover NDJSON entries of the real Playwright trace format.
  const traceEntryNames: string[] = [];
  const networkEntryNames: string[] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (relativePath.endsWith('.trace')) traceEntryNames.push(relativePath);
    else if (relativePath.endsWith('.network')) networkEntryNames.push(relativePath);
  });

  const isModernFormat = traceEntryNames.length > 0;

  if (!isModernFormat && zip.file('trace.json')) {
    // Legacy layout (trace.json / network.json as JSON arrays).
    return processLegacyTraceJson(zip, inputPath, outputPath, config, patterns, rules, result);
  }

  if (!isModernFormat) {
    logger.warn(
      `No *.trace entries (and no legacy trace.json) found in ${inputPath} — skipping.`
    );
    return result;
  }

  let modified = false;

  // Parse all NDJSON entries up-front.
  const ndjsonFiles: NdjsonFile[] = [];
  for (const name of [...traceEntryNames, ...networkEntryNames]) {
    const entry = zip.file(name);
    if (!entry) continue;
    try {
      const content = await entry.async('string');
      ndjsonFiles.push(parseNdjson(name, content));
    } catch (err) {
      logger.warn(
        `Failed to read ${name} in ${inputPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Collect element bounding boxes before any removal so that boxes from
  // steps that will later be removed remain available for screenshot blurring.
  const elementBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  if (config.output?.redactScreenshots) {
    for (const file of ndjsonFiles) {
      for (const line of file.lines) {
        const box = line.obj?.['box'];
        if (box && typeof box === 'object') {
          const b = box as Record<string, unknown>;
          if (
            typeof b['x'] === 'number' &&
            typeof b['y'] === 'number' &&
            typeof b['width'] === 'number' &&
            typeof b['height'] === 'number'
          ) {
            elementBoxes.push({ x: b['x'], y: b['y'], width: b['width'], height: b['height'] });
          }
        }
      }
    }
    if (elementBoxes.length === 0) {
      logger.verbose(
        `Screenshot redaction enabled for ${inputPath} but no element bounding boxes ` +
        `were found in trace events — screenshots will not be blurred.`
      );
    }
  }

  // ── Redact phase ──
  if (config.redact && patterns.length > 0) {
    for (const file of ndjsonFiles) {
      for (const line of file.lines) {
        if (!line.obj) continue;
        const walk = walkAndRedact(line.obj, patterns, config.redact);
        if (walk.count > 0) {
          line.obj = walk.result as Record<string, unknown>;
          line.dirty = true;
          result.redactionsApplied += walk.count;
          result.redactionMatches.push(...walk.matches);
          modified = true;
        }
      }
    }

    // Redact JSON/text files in resources/
    const resourceFiles = zip.folder('resources');
    if (resourceFiles) {
      const jsonResources: string[] = [];
      resourceFiles.forEach((relativePath, file) => {
        if (
          !file.dir &&
          (relativePath.endsWith('.json') || relativePath.endsWith('.txt'))
        ) {
          jsonResources.push(`resources/${relativePath}`);
        }
      });

      for (const resPath of jsonResources) {
        const resFile = zip.file(resPath);
        if (resFile) {
          try {
            const content = await resFile.async('string');
            const parsed = JSON.parse(content);
            const resWalk = walkAndRedact(parsed, patterns, config.redact);
            if (resWalk.count > 0) {
              zip.file(resPath, JSON.stringify(resWalk.result));
              result.redactionsApplied += resWalk.count;
              result.redactionMatches.push(...resWalk.matches);
              modified = true;
            }
          } catch {
            // Not valid JSON — skip
          }
        }
      }
    }
  }

  // ── Remove phase ──
  if (config.remove && rules.length > 0) {
    const allRemovedCallIds = new Set<string>();
    for (const file of ndjsonFiles) {
      if (!file.name.endsWith('.trace')) continue;
      const { modified: fileModified, removedCallIds } = applyRemovalToTraceFile(
        file, rules, config, result, inputPath
      );
      if (fileModified) modified = true;
      for (const id of removedCallIds) allRemovedCallIds.add(id);
    }

    // Drop network events tied to removed steps (matched by callId).
    if (allRemovedCallIds.size > 0) {
      for (const file of ndjsonFiles) {
        if (!file.name.endsWith('.network')) continue;
        for (const line of file.lines) {
          if (!line.obj) continue;
          const callId = lineCallId(line.obj);
          if (callId && allRemovedCallIds.has(callId)) {
            line.removed = true;
            modified = true;
          }
        }
      }
    }
  }

  // ── Screenshot redaction phase ──
  if (config.output?.redactScreenshots && elementBoxes.length > 0 && !config.remove?.dryRun) {
    const screenshotPaths: string[] = [];
    zip.forEach((relativePath, file) => {
      if (
        !file.dir &&
        (relativePath.endsWith('.png') ||
          relativePath.endsWith('.jpeg') ||
          relativePath.endsWith('.jpg'))
      ) {
        screenshotPaths.push(relativePath);
      }
    });

    for (const screenshotPath of screenshotPaths) {
      const screenshotFile = zip.file(screenshotPath);
      if (!screenshotFile) continue;
      try {
        const originalBuffer = await screenshotFile.async('nodebuffer');
        const redactedBuffer = await redactScreenshot(originalBuffer, elementBoxes);
        if (redactedBuffer !== originalBuffer) {
          zip.file(screenshotPath, redactedBuffer);
          modified = true;
        }
      } catch (err) {
        logger.warn(
          `Failed to redact screenshot ${screenshotPath} in ${inputPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (!modified && !config.remove?.dryRun) {
    logger.info(`No changes made to ${inputPath}`);
  }

  // Write output (unless dry-run)
  if (!config.remove?.dryRun) {
    for (const file of ndjsonFiles) {
      const anyChange = file.lines.some((l) => l.removed || l.dirty);
      if (anyChange) {
        zip.file(file.name, serializeNdjson(file));
      }
    }

    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    writeOutput(inputPath, outputPath, outputBuffer, config);
  }

  return result;
}

/**
 * Legacy processing path for archives that contain a `trace.json` /
 * `network.json` pair (JSON arrays rather than NDJSON). Kept for backwards
 * compatibility with pre-NDJSON fixtures and third-party tooling.
 */
async function processLegacyTraceJson(
  zip: JSZip,
  inputPath: string,
  outputPath: string,
  config: SanitizerConfig,
  patterns: RedactPattern[],
  rules: RemoveRule[],
  result: ProcessResult
): Promise<ProcessResult> {
  let modified = false;

  const elementBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  // Load trace.json
  let traceEvents: TraceEvent[] | null = null;
  const traceFile = zip.file('trace.json');
  if (traceFile) {
    try {
      const traceContent = await traceFile.async('string');
      traceEvents = JSON.parse(traceContent) as TraceEvent[];
    } catch (err) {
      logger.warn(
        `Failed to parse trace.json in ${inputPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Load network.json
  let networkData: unknown[] | null = null;
  const networkFile = zip.file('network.json');
  if (networkFile) {
    try {
      const networkContent = await networkFile.async('string');
      networkData = JSON.parse(networkContent) as unknown[];
    } catch {
      // network.json might not exist in all traces
    }
  }

  // Collect element bounding boxes before any removal.
  if (config.output?.redactScreenshots && traceEvents) {
    for (const event of traceEvents) {
      const box = event['box'];
      if (box !== null && box !== undefined && typeof box === 'object') {
        const b = box as Record<string, unknown>;
        if (
          typeof b['x'] === 'number' &&
          typeof b['y'] === 'number' &&
          typeof b['width'] === 'number' &&
          typeof b['height'] === 'number'
        ) {
          elementBoxes.push({
            x: b['x'],
            y: b['y'],
            width: b['width'],
            height: b['height'],
          });
        }
      }
    }

    if (elementBoxes.length === 0) {
      logger.verbose(
        `Screenshot redaction enabled for ${inputPath} but no element bounding boxes ` +
        `were found in trace events — screenshots will not be blurred. ` +
        `Bounding boxes are recorded by Playwright for UI actions (fill, click, etc.).`
      );
    }
  }

  // ── Redact phase ──
  if (config.redact && patterns.length > 0) {
    if (traceEvents) {
      const traceWalk = walkAndRedact(traceEvents, patterns, config.redact);
      if (traceWalk.count > 0) {
        traceEvents = traceWalk.result as TraceEvent[];
        result.redactionsApplied += traceWalk.count;
        result.redactionMatches.push(...traceWalk.matches);
        modified = true;
      }
    }

    if (networkData) {
      const networkWalk = walkAndRedact(networkData, patterns, config.redact);
      if (networkWalk.count > 0) {
        networkData = networkWalk.result as unknown[];
        result.redactionsApplied += networkWalk.count;
        result.redactionMatches.push(...networkWalk.matches);
        modified = true;
      }
    }

    const resourceFiles = zip.folder('resources');
    if (resourceFiles) {
      const jsonResources: string[] = [];
      resourceFiles.forEach((relativePath, file) => {
        if (
          !file.dir &&
          (relativePath.endsWith('.json') || relativePath.endsWith('.txt'))
        ) {
          jsonResources.push(`resources/${relativePath}`);
        }
      });

      for (const resPath of jsonResources) {
        const resFile = zip.file(resPath);
        if (resFile) {
          try {
            const content = await resFile.async('string');
            const parsed = JSON.parse(content);
            const resWalk = walkAndRedact(parsed, patterns, config.redact);
            if (resWalk.count > 0) {
              zip.file(resPath, JSON.stringify(resWalk.result));
              result.redactionsApplied += resWalk.count;
              result.redactionMatches.push(...resWalk.matches);
              modified = true;
            }
          } catch {
            // Not valid JSON — skip
          }
        }
      }
    }
  }

  // ── Remove phase ──
  if (config.remove && rules.length > 0 && traceEvents) {
    const removalSet = findStepsToRemove(traceEvents, rules);
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
        const removedEvents = Array.from(removalSet.indices).map(
          (i) => traceEvents![i]!
        );

        const removedRequestIds = new Set<string>();
        for (const event of removedEvents) {
          if (event.requestId) {
            removedRequestIds.add(event.requestId);
          }
        }

        const orphanStrategy = config.remove.orphanStrategy ?? 'remove-children';
        const cleaned = removeSteps(traceEvents, removalSet, orphanStrategy);

        const cleanedSet = new Set(cleaned);
        const actuallyRemovedEvents = traceEvents.filter((e) => !cleanedSet.has(e));

        const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
        traceEvents = repairTimestamps(cleaned, actuallyRemovedEvents, strategy);

        if (networkData && removedRequestIds.size > 0) {
          networkData = networkData.filter((entry) => {
            if (entry && typeof entry === 'object' && 'requestId' in entry) {
              const reqId = (entry as { requestId: string }).requestId;
              return !removedRequestIds.has(reqId);
            }
            return true;
          });
        }

        result.stepsRemoved = actuallyRemovedEvents.length;
        result.timestampRepairs = actuallyRemovedEvents.length;
        result.removalMatches = removalSet.matches;
        modified = true;
      }
    }
  }

  // ── Screenshot redaction phase ──
  if (config.output?.redactScreenshots && elementBoxes.length > 0 && !config.remove?.dryRun) {
    const screenshotPaths: string[] = [];
    zip.forEach((relativePath, file) => {
      if (
        !file.dir &&
        (relativePath.endsWith('.png') ||
          relativePath.endsWith('.jpeg') ||
          relativePath.endsWith('.jpg'))
      ) {
        screenshotPaths.push(relativePath);
      }
    });

    logger.verbose(
      `Screenshot redaction: processing ${screenshotPaths.length} screenshot(s) ` +
      `with ${elementBoxes.length} region(s) in ${inputPath}`
    );

    for (const screenshotPath of screenshotPaths) {
      const screenshotFile = zip.file(screenshotPath);
      if (!screenshotFile) continue;

      try {
        const originalBuffer = await screenshotFile.async('nodebuffer');
        const redactedBuffer = await redactScreenshot(originalBuffer, elementBoxes);

        if (redactedBuffer !== originalBuffer) {
          zip.file(screenshotPath, redactedBuffer);
          modified = true;
          logger.verbose(`Screenshot redacted: ${screenshotPath}`);
        }
      } catch (err) {
        logger.warn(
          `Failed to redact screenshot ${screenshotPath} in ${inputPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (!modified && !config.remove?.dryRun) {
    logger.info(`No changes made to ${inputPath}`);
  }

  // Write output (unless dry-run)
  if (!config.remove?.dryRun) {
    if (traceEvents) {
      zip.file('trace.json', JSON.stringify(traceEvents));
    }
    if (networkData) {
      zip.file('network.json', JSON.stringify(networkData));
    }

    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    writeOutput(inputPath, outputPath, outputBuffer, config);
  }

  return result;
}
