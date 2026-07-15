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
  /** The NDJSON file this step lives in. `callId`s are only unique per file. */
  file: NdjsonFile;
  callId: string;
  parentId?: string;
  /**
   * Cross-file link: library-side events (`0-trace.trace`, `1-trace.trace`, ...
   * with class `Page` / `APIRequestContext` / ...) carry a `stepId` field that
   * references the test-runner step (in `test.trace`) they belong to, e.g.
   * `{"type":"before","callId":"call@7",...,"stepId":"pw:api@90"}`.
   * Set only when `stepId` differs from the event's own `callId`
   * (test-runner events carry `stepId === callId`).
   */
  linkedStepId?: string;
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
      const rawStepId = obj['stepId'];
      const step: NdjsonStep = {
        file,
        callId,
        parentId: typeof obj['parentId'] === 'string' ? obj['parentId'] : undefined,
        linkedStepId:
          typeof rawStepId === 'string' && rawStepId !== callId
            ? rawStepId
            : undefined,
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
 * Expands a set of matched steps to include all descendants across the WHOLE
 * archive (children can nest arbitrarily — test.step children, pw:api calls,
 * expects, etc.).
 *
 * Two kinds of parent→child edges are walked:
 * - **same-file**: `child.parentId === parent.callId` within one `.trace` file;
 * - **cross-file**: `child.linkedStepId === parent.callId` — library-side
 *   events (`0-trace.trace`, ...) reference the test-runner step (`test.trace`)
 *   they belong to via their `stepId` field. Without this edge, removing a
 *   step from `test.trace` leaves its underlying `call@N` events (and their
 *   `log` lines) behind in the library trace, still visible in the viewer and
 *   dangling by `stepId`. This is essential for scripts that do NOT use
 *   `test.step`, where every action exists as a `pw:api@N` runner step plus a
 *   linked library `call@N`.
 */
function collectDescendantSteps(
  allSteps: NdjsonStep[],
  roots: Set<NdjsonStep>
): Set<NdjsonStep> {
  // parent (file-scoped callId) → children within the same file
  const childrenByParent = new Map<string, NdjsonStep[]>();
  // parent callId (any file) → cross-file linked children
  const linkedByStepId = new Map<string, NdjsonStep[]>();

  for (const step of allSteps) {
    if (step.parentId) {
      const key = fileScopedId(step.file, step.parentId);
      const list = childrenByParent.get(key) ?? [];
      list.push(step);
      childrenByParent.set(key, list);
    }
    if (step.linkedStepId) {
      const list = linkedByStepId.get(step.linkedStepId) ?? [];
      list.push(step);
      linkedByStepId.set(step.linkedStepId, list);
    }
  }

  const descendants = new Set<NdjsonStep>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = [
      ...(childrenByParent.get(fileScopedId(current.file, current.callId)) ?? []),
      ...(linkedByStepId.get(current.callId) ?? []).filter(
        (s) => s.file !== current.file || s.callId !== current.callId
      ),
    ];
    for (const child of children) {
      if (!descendants.has(child) && !roots.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }
  return descendants;
}

/** Unique key for a callId within one file (callIds repeat across files). */
function fileScopedId(file: NdjsonFile, callId: string): string {
  return `${file.name} ${callId}`;
}

/**
 * Applies removal rules to ALL NDJSON `.trace` files of an archive as one
 * step graph.
 *
 * - Rules are matched against the `"before"` events per file (title /
 *   apiName / method / params), preserving `minConsecutiveOccurrences`
 *   semantics within each file's step order.
 * - Descendants are expanded across files via {@link collectDescendantSteps}
 *   — this is what removes the library-side `call@N` events (and their `log`
 *   lines) in `0-trace.trace` when the matched step lives in `test.trace`,
 *   which is the only place the step tree exists for scripts that never call
 *   `test.step`.
 * - `orphanStrategy: 'keep-shell'` keeps each matched step's own before/after
 *   lines but removes all descendant events; `'remove-children'` removes the
 *   matched steps too.
 * - `timestampStrategy` is applied per file to the surviving steps'
 *   `startTime` / `endTime` (and `monotonicTime` where present) via
 *   {@link repairTimestamps}.
 *
 * @returns Whether any file was modified, the removed callIds grouped by
 *   file, and the URLs of removed steps (used to drop correlated
 *   `*.network` resource snapshots, which carry no callId).
 */
function applyRemovalToTraceFiles(
  traceFiles: NdjsonFile[],
  rules: RemoveRule[],
  config: SanitizerConfig,
  result: ProcessResult,
  inputPath: string
): {
  modified: boolean;
  removedCallIdsByFile: Map<NdjsonFile, Set<string>>;
  removedUrls: Set<string>;
} {
  const none = {
    modified: false,
    removedCallIdsByFile: new Map<NdjsonFile, Set<string>>(),
    removedUrls: new Set<string>(),
  };

  // ── Per-file step collection and rule matching ──
  const stepsByFile = new Map<NdjsonFile, NdjsonStep[]>();
  const allSteps: NdjsonStep[] = [];
  const matched = new Set<NdjsonStep>();
  let totalMatched = 0;

  for (const file of traceFiles) {
    const steps = collectSteps(file);
    stepsByFile.set(file, steps);
    allSteps.push(...steps);
    if (steps.length === 0) continue;

    const removalSet = findStepsToRemove(steps.map((s) => s.synthetic), rules);
    result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);
    if (removalSet.indices.size === 0) continue;

    totalMatched += removalSet.indices.size;
    result.removalMatches.push(...removalSet.matches);

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
      continue;
    }

    for (const idx of removalSet.indices) {
      matched.add(steps[idx]!);
    }
  }

  if (totalMatched === 0) return none;

  if (config.remove?.dryRun) {
    result.stepsRemoved += totalMatched;
    return none;
  }

  // ── Expand to descendants across the whole archive ──
  const orphanStrategy = config.remove?.orphanStrategy ?? 'remove-children';
  const descendants = collectDescendantSteps(allSteps, matched);

  // keep-shell: keep the matched steps' own before/after events, drop descendants.
  // remove-children: drop matched steps AND descendants.
  const removedSteps = new Set<NdjsonStep>(descendants);
  if (orphanStrategy !== 'keep-shell') {
    for (const s of matched) removedSteps.add(s);
  }

  if (removedSteps.size === 0) return none;

  // URLs of removed steps — used to drop matching *.network resource
  // snapshots, which have no callId to correlate on.
  const removedUrls = new Set<string>();
  const removedCallIdsByFile = new Map<NdjsonFile, Set<string>>();
  for (const s of removedSteps) {
    if (typeof s.synthetic.url === 'string') removedUrls.add(s.synthetic.url);
    let set = removedCallIdsByFile.get(s.file);
    if (!set) {
      set = new Set<string>();
      removedCallIdsByFile.set(s.file, set);
    }
    set.add(s.callId);
  }

  // ── Drop lines and repair timestamps, per file ──
  const strategy = config.remove?.timestampStrategy ?? 'absorb-into-prev';
  let timestampRepairs = 0;

  for (const [file, removedIds] of removedCallIdsByFile) {
    // Drop every event line belonging to a removed step (before, after, and
    // any auxiliary events such as logs that carry the same callId).
    for (const line of file.lines) {
      if (!line.obj) continue;
      const callId = lineCallId(line.obj);
      if (callId && removedIds.has(callId)) {
        line.removed = true;
      }
    }

    const steps = stepsByFile.get(file)!;
    const survivors = steps.filter((s) => !removedIds.has(s.callId));
    const removed = steps.filter((s) => removedIds.has(s.callId));

    // Clone synthetic events so the repair never mutates our originals.
    //
    // keep-shell: the matched titled step is KEPT with its original span — it
    // is the roll-up of the hidden children, whose time it still covers. No
    // hole appears in the timeline, so no duration may be absorbed into
    // neighbours (doing so would inflate the timeline). Passing an empty
    // removed list limits the repair to parent-span recomputation.
    const survivorClones: TraceEvent[] = survivors.map((s) => ({ ...s.synthetic }));
    const removedClones: TraceEvent[] =
      orphanStrategy === 'keep-shell'
        ? []
        : removed.map((s) => ({ ...s.synthetic }));
    const repaired = repairTimestamps(survivorClones, removedClones, strategy);

    const repairedByCallId = new Map<string, TraceEvent>();
    for (const e of repaired) {
      if (e.callId) repairedByCallId.set(e.callId, e);
    }

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
  }

  result.stepsRemoved += removedSteps.size;
  result.timestampRepairs += timestampRepairs;
  return { modified: true, removedCallIdsByFile, removedUrls };
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
 * 4. **Remove phase**: match rules against `"before"` events in each
 *    `*.trace` file, then treat ALL `.trace` files as one step graph —
 *    library-side events (`0-trace.trace`, ...) are linked to their
 *    test-runner step (`test.trace`) via their `stepId` field, so removing a
 *    step also removes its underlying `call@N` / `log` events even for
 *    scripts that never use `test.step`. Drop matched steps and/or their
 *    descendant events according to `orphanStrategy`; repair timestamps
 *    according to `timestampStrategy`. Correlated `*.network` events are
 *    dropped by `callId` and, for `resource-snapshot` entries (which carry
 *    no callId), by removed-step URL.
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
    const traceFiles = ndjsonFiles.filter((f) => f.name.endsWith('.trace'));
    const { modified: removalModified, removedCallIdsByFile, removedUrls } =
      applyRemovalToTraceFiles(traceFiles, rules, config, result, inputPath);
    if (removalModified) modified = true;

    // Drop network events tied to removed steps. Two correlation paths:
    // - by callId (events that carry one);
    // - by request URL — `resource-snapshot` entries have NO callId, so they
    //   are matched against the URLs of the removed steps instead. Note this
    //   drops every snapshot for a removed URL, which is the intent for the
    //   noisy repeated endpoints removal rules typically target.
    const allRemovedCallIds = new Set<string>();
    for (const ids of removedCallIdsByFile.values()) {
      for (const id of ids) allRemovedCallIds.add(id);
    }

    if (allRemovedCallIds.size > 0 || removedUrls.size > 0) {
      for (const file of ndjsonFiles) {
        if (!file.name.endsWith('.network')) continue;
        for (const line of file.lines) {
          if (!line.obj) continue;

          const callId = lineCallId(line.obj);
          if (callId && allRemovedCallIds.has(callId)) {
            line.removed = true;
            modified = true;
            continue;
          }

          const snapshot = line.obj['snapshot'];
          if (snapshot && typeof snapshot === 'object') {
            const request = (snapshot as Record<string, unknown>)['request'];
            if (request && typeof request === 'object') {
              const url = (request as Record<string, unknown>)['url'];
              if (typeof url === 'string' && removedUrls.has(url)) {
                line.removed = true;
                modified = true;
              }
            }
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
        // keep-shell: kept parents still span the hidden children's time — no
        // timeline hole exists, so nothing may be absorbed into neighbours.
        traceEvents = repairTimestamps(
          cleaned,
          orphanStrategy === 'keep-shell' ? [] : actuallyRemovedEvents,
          strategy
        );

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
