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
import { logger } from '../logger.js';

/**
 * Processes a single Playwright trace .zip file.
 *
 * 1. Opens .zip with jszip
 * 2. Extracts and parses trace.json and network.json
 * 3. If redact: walks both trees + resources/ JSON files
 * 4. If remove: detects, removes, repairs timestamps, removes network entries
 * 5. Rebuilds .zip preserving unmodified files
 * 6. Writes per output.mode
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

        // Remove steps
        const cleaned = removeSteps(traceEvents, removalSet);

        // Repair timestamps
        const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
        traceEvents = repairTimestamps(cleaned, removedEvents, strategy);

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

        result.stepsRemoved = removalSet.indices.size;
        result.timestampRepairs = removalSet.indices.size;
        result.removalMatches = removalSet.matches;
        modified = true;
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

/**
 * Writes output based on the configured output mode.
 */
function writeOutput(
  inputPath: string,
  outputPath: string,
  content: Buffer,
  config: SanitizerConfig
): void {
  const mode = config.output?.mode ?? 'copy';

  if (mode === 'in-place') {
    fs.writeFileSync(inputPath, content);
    logger.verbose(`Wrote in-place: ${inputPath}`);
  } else if (mode === 'side-by-side') {
    const ext = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length);
    const sidePath = `${base}.sanitized${ext}`;
    fs.writeFileSync(sidePath, content);
    logger.verbose(`Wrote side-by-side: ${sidePath}`);
  } else {
    // 'copy' mode
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, content);
    logger.verbose(`Wrote copy: ${outputPath}`);
  }
}
