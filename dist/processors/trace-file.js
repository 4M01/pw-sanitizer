"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTraceFile = processTraceFile;
const fs = __importStar(require("node:fs"));
const jszip_1 = __importDefault(require("jszip"));
const json_walker_js_1 = require("../redact/json-walker.js");
const detector_js_1 = require("../remove/detector.js");
const remover_js_1 = require("../remove/remover.js");
const timestamp_repair_js_1 = require("../remove/timestamp-repair.js");
const logger_js_1 = require("../logger.js");
const utils_js_1 = require("../utils.js");
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
 * 5. Write modified `trace.json` and `network.json` back into the archive.
 * 6. Re-generate the `.zip` buffer and write it according to `config.output.mode`.
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
async function processTraceFile(inputPath, outputPath, config, patterns, rules) {
    const result = {
        file: inputPath,
        redactionsApplied: 0,
        stepsRemoved: 0,
        timestampRepairs: 0,
        redactionMatches: [],
        removalMatches: [],
    };
    let zipData;
    try {
        zipData = fs.readFileSync(inputPath);
    }
    catch (err) {
        logger_js_1.logger.warn(`Could not read trace file ${inputPath}: ` +
            `${err instanceof Error ? err.message : String(err)}`);
        return result;
    }
    let zip;
    try {
        zip = await jszip_1.default.loadAsync(zipData);
    }
    catch (err) {
        logger_js_1.logger.warn(`Could not parse trace zip ${inputPath}: ` +
            `${err instanceof Error ? err.message : String(err)}`);
        return result;
    }
    let modified = false;
    // Load trace.json
    let traceEvents = null;
    const traceFile = zip.file('trace.json');
    if (traceFile) {
        try {
            const traceContent = await traceFile.async('string');
            traceEvents = JSON.parse(traceContent);
        }
        catch (err) {
            logger_js_1.logger.warn(`Failed to parse trace.json in ${inputPath}: ` +
                `${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // Load network.json
    let networkData = null;
    const networkFile = zip.file('network.json');
    if (networkFile) {
        try {
            const networkContent = await networkFile.async('string');
            networkData = JSON.parse(networkContent);
        }
        catch {
            // network.json might not exist in all traces
        }
    }
    // ── Redact phase ──
    if (config.redact && patterns.length > 0) {
        // Redact trace.json
        if (traceEvents) {
            const traceWalk = (0, json_walker_js_1.walkAndRedact)(traceEvents, patterns, config.redact);
            if (traceWalk.count > 0) {
                traceEvents = traceWalk.result;
                result.redactionsApplied += traceWalk.count;
                result.redactionMatches.push(...traceWalk.matches);
                modified = true;
            }
        }
        // Redact network.json
        if (networkData) {
            const networkWalk = (0, json_walker_js_1.walkAndRedact)(networkData, patterns, config.redact);
            if (networkWalk.count > 0) {
                networkData = networkWalk.result;
                result.redactionsApplied += networkWalk.count;
                result.redactionMatches.push(...networkWalk.matches);
                modified = true;
            }
        }
        // Redact JSON files in resources/
        const resourceFiles = zip.folder('resources');
        if (resourceFiles) {
            const jsonResources = [];
            resourceFiles.forEach((relativePath, file) => {
                if (!file.dir &&
                    (relativePath.endsWith('.json') || relativePath.endsWith('.txt'))) {
                    jsonResources.push(`resources/${relativePath}`);
                }
            });
            for (const resPath of jsonResources) {
                const resFile = zip.file(resPath);
                if (resFile) {
                    try {
                        const content = await resFile.async('string');
                        const parsed = JSON.parse(content);
                        const resWalk = (0, json_walker_js_1.walkAndRedact)(parsed, patterns, config.redact);
                        if (resWalk.count > 0) {
                            zip.file(resPath, JSON.stringify(parsed));
                            result.redactionsApplied += resWalk.count;
                            result.redactionMatches.push(...resWalk.matches);
                            modified = true;
                            // Update with redacted content
                            zip.file(resPath, JSON.stringify(resWalk.result));
                        }
                    }
                    catch {
                        // Not valid JSON — skip
                    }
                }
            }
        }
    }
    // ── Remove phase ──
    if (config.remove && rules.length > 0 && traceEvents) {
        const removalSet = (0, detector_js_1.findStepsToRemove)(traceEvents, rules);
        if (removalSet.indices.size > 0) {
            if (config.remove.dryRun) {
                logger_js_1.logger.info(`[DRY RUN] Would remove ${removalSet.indices.size} steps from ${inputPath}`);
                for (const m of removalSet.matches) {
                    logger_js_1.logger.info(`  - Rule "${m.ruleLabel}": step at index ${m.index} ` +
                        `("${m.event.title ?? m.event.action ?? 'unknown'}")`);
                }
                result.removalMatches = removalSet.matches;
                result.stepsRemoved = removalSet.indices.size;
            }
            else {
                // Collect removed events before removal
                const removedEvents = Array.from(removalSet.indices).map((i) => traceEvents[i]);
                // Collect requestIds of removed events for network cleanup
                const removedRequestIds = new Set();
                for (const event of removedEvents) {
                    if (event.requestId) {
                        removedRequestIds.add(event.requestId);
                    }
                }
                // Remove steps
                const cleaned = (0, remover_js_1.removeSteps)(traceEvents, removalSet);
                // Repair timestamps
                const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
                traceEvents = (0, timestamp_repair_js_1.repairTimestamps)(cleaned, removedEvents, strategy);
                // Remove corresponding network.json entries
                if (networkData && removedRequestIds.size > 0) {
                    networkData = networkData.filter((entry) => {
                        if (entry &&
                            typeof entry === 'object' &&
                            'requestId' in entry) {
                            const reqId = entry.requestId;
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
        logger_js_1.logger.info(`No changes made to ${inputPath}`);
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
        (0, utils_js_1.writeOutput)(inputPath, outputPath, outputBuffer, config);
    }
    return result;
}
//# sourceMappingURL=trace-file.js.map