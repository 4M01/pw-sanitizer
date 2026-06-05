import * as fs from 'node:fs';
import * as path from 'node:path';
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
 * Sanitizes a single Playwright trace `.zip` file.
 *
 * Processing pipeline:
 * 1. Read and parse the `.zip` archive with JSZip.
 * 2. Extract `trace.json` (primary event stream) and `network.json` (request log).
 * 3. **Redact phase** (if `config.redact` and patterns are loaded):
 *    - Walk and redact `trace.json` events.
 *    - Walk and redact `network.json` entries.
 *    - Walk and redact `.json` / `.txt` files inside the `resources/` folder.
 * 4. **Remove phase** (if `config.remove` and rules are loaded):
 *    - Run {@link findStepsToRemove} on the trace events.
 *    - Run {@link removeSteps} and {@link repairTimestamps}.
 *    - Remove corresponding `network.json` entries by `requestId`.
 * 5. **Screenshot redaction phase** (if `config.output.redactScreenshots` is `true`):
 *    - Collects element bounding boxes (`box` field) from all trace events.
 *    - For every PNG/JPEG in `resources/`, blurs the collected regions using {@link redactScreenshot}.
 *    - Requires the optional `sharp` peer dependency; falls back to a no-op with a warning.
 * 6. Write modified `trace.json` and `network.json` back into the archive.
 * 7. Re-generate the `.zip` buffer and write it according to `config.output.mode`.
 *
 * Unreadable files and non-JSON resources are skipped gracefully with warnings.
 *
 * @param inputPath  - Absolute path to the source trace `.zip` file.
 * @param outputPath - Destination path for the sanitized output archive.
 * @param config     - The full sanitizer configuration.
 * @param patterns   - Pre-built list of redact patterns (from {@link buildPatternRegistry}).
 * @param rules      - Pre-built list of removal rules (from {@link buildRuleRegistry}).
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

  let modified = false;

  // Collect element bounding boxes early, before any removal, so that boxes from
  // steps that will later be removed are still available for screenshot blurring.
  // Each entry comes from a trace event's `box` field (Playwright records the
  // on-screen bounding rectangle for UI actions such as fill, click, type, etc.).
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

  // Populate elementBoxes now that trace.json is loaded.
  // We read boxes from the original events (before any redaction/removal) so that
  // no coordinates are lost if those events are subsequently removed.
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
    // Redact trace.json
    if (traceEvents) {
      const traceWalk = walkAndRedact(traceEvents, patterns, config.redact);
      if (traceWalk.count > 0) {
        traceEvents = traceWalk.result as TraceEvent[];
        result.redactionsApplied += traceWalk.count;
        result.redactionMatches.push(...traceWalk.matches);
        modified = true;
      }
    }

    // Redact network.json
    if (networkData) {
      const networkWalk = walkAndRedact(networkData, patterns, config.redact);
      if (networkWalk.count > 0) {
        networkData = networkWalk.result as unknown[];
        result.redactionsApplied += networkWalk.count;
        result.redactionMatches.push(...networkWalk.matches);
        modified = true;
      }
    }

    // Redact JSON files in resources/
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
              zip.file(resPath, JSON.stringify(parsed));
              result.redactionsApplied += resWalk.count;
              result.redactionMatches.push(...resWalk.matches);
              modified = true;
              // Update with redacted content
              zip.file(resPath, JSON.stringify(resWalk.result));
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
        // Collect removed events before removal
        const removedEvents = Array.from(removalSet.indices).map(
          (i) => traceEvents![i]!
        );

        // Collect requestIds of removed events for network cleanup
        const removedRequestIds = new Set<string>();
        for (const event of removedEvents) {
          if (event.requestId) {
            removedRequestIds.add(event.requestId);
          }
        }

        // Remove steps (pass orphan strategy so keep-shell is respected)
        const orphanStrategy = config.remove.orphanStrategy ?? 'remove-children';
        const cleaned = removeSteps(traceEvents, removalSet, orphanStrategy);

        // Determine which events were actually removed (works for both strategies:
        // remove-children removes matched + children; keep-shell removes only children)
        const cleanedSet = new Set(cleaned);
        const actuallyRemovedEvents = traceEvents.filter((e) => !cleanedSet.has(e));

        // Repair timestamps using events that were actually removed
        const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
        traceEvents = repairTimestamps(cleaned, actuallyRemovedEvents, strategy);

        // Remove corresponding network.json entries
        if (networkData && removedRequestIds.size > 0) {
          networkData = networkData.filter((entry) => {
            if (
              entry &&
              typeof entry === 'object' &&
              'requestId' in entry
            ) {
              const reqId = (entry as { requestId: string }).requestId;
              return !removedRequestIds.has(reqId);
            }
            return true;
          });
        }

        // stepsRemoved = events actually removed from the output
        result.stepsRemoved = actuallyRemovedEvents.length;
        result.timestampRepairs = actuallyRemovedEvents.length;
        result.removalMatches = removalSet.matches;
        modified = true;
      }
    }
  }

  // ── Screenshot redaction phase ──
  // Runs after remove so the final traceEvents state is consistent, but uses the
  // bounding boxes collected from the original events (before any removal).
  if (config.output?.redactScreenshots && elementBoxes.length > 0 && !config.remove?.dryRun) {
    // Collect all PNG/JPEG screenshot files stored in the zip
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
    // Update files in the zip
    if (traceEvents) {
      zip.file('trace.json', JSON.stringify(traceEvents));
    }
    if (networkData) {
      zip.file('network.json', JSON.stringify(networkData));
    }

    // Generate zip buffer
    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    writeOutput(inputPath, outputPath, outputBuffer, config);
  }

  return result;
}


