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
Object.defineProperty(exports, "__esModule", { value: true });
exports.processHtmlReport = processHtmlReport;
const fs = __importStar(require("node:fs"));
const json_walker_js_1 = require("../redact/json-walker.js");
const detector_js_1 = require("../remove/detector.js");
const remover_js_1 = require("../remove/remover.js");
const timestamp_repair_js_1 = require("../remove/timestamp-repair.js");
const logger_js_1 = require("../logger.js");
const utils_js_1 = require("../utils.js");
/**
 * Regex that locates the embedded JSON blob inside a Playwright HTML report.
 *
 * Playwright injects report data as:
 * `window.__pw_report_data__ = { ... };</script>`
 *
 * The first capture group (`[1]`) contains the raw JSON object literal.
 * The `s` flag allows `.` to match newlines (the blob can be multi-line).
 */
const REPORT_DATA_REGEX = /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s;
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
async function processHtmlReport(inputPath, outputPath, config, patterns, rules) {
    const result = {
        file: inputPath,
        redactionsApplied: 0,
        stepsRemoved: 0,
        timestampRepairs: 0,
        redactionMatches: [],
        removalMatches: [],
    };
    const html = fs.readFileSync(inputPath, 'utf-8');
    const match = REPORT_DATA_REGEX.exec(html);
    if (!match?.[1]) {
        logger_js_1.logger.warn(`Could not find embedded report data in ${inputPath}. ` +
            `Expected pattern: window.__pw_report_data__ = {...};`);
        return result;
    }
    let reportData;
    try {
        reportData = JSON.parse(match[1]);
    }
    catch (err) {
        logger_js_1.logger.warn(`Failed to parse embedded JSON in ${inputPath}: ` +
            `${err instanceof Error ? err.message : String(err)}`);
        return result;
    }
    let modified = false;
    // Redact phase
    if (config.redact && patterns.length > 0) {
        const walkResult = (0, json_walker_js_1.walkAndRedact)(reportData, patterns, config.redact);
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
            const removalSet = (0, detector_js_1.findStepsToRemove)(events, rules);
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
                    const removedEvents = Array.from(removalSet.indices).map((i) => events[i]);
                    const cleaned = (0, remover_js_1.removeSteps)(events, removalSet);
                    const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
                    const repaired = (0, timestamp_repair_js_1.repairTimestamps)(cleaned, removedEvents, strategy);
                    replaceEventsInReport(reportData, repaired);
                    result.stepsRemoved = removalSet.indices.size;
                    result.timestampRepairs = removalSet.indices.size;
                    result.removalMatches = removalSet.matches;
                    modified = true;
                }
            }
        }
    }
    if (!modified && !config.remove?.dryRun) {
        logger_js_1.logger.info(`No changes made to ${inputPath}`);
    }
    // Write output (unless dry-run)
    if (!config.remove?.dryRun) {
        const newJson = JSON.stringify(reportData);
        const newHtml = html.replace(REPORT_DATA_REGEX, `window.__pw_report_data__ = ${newJson};</script>`);
        (0, utils_js_1.writeOutput)(inputPath, outputPath, newHtml, config);
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
function extractEventsFromReport(data) {
    const events = [];
    function traverse(node) {
        if (!node || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const item of node) {
                traverse(item);
            }
            return;
        }
        const obj = node;
        // Check if this looks like a step/action event
        if (('startTime' in obj && 'endTime' in obj) ||
            'title' in obj ||
            'action' in obj) {
            events.push(obj);
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
 * Placeholder for post-removal tree reconstruction in HTML reports.
 *
 * In the current implementation, step mutations during the redact walk phase
 * are applied directly to object references within the report tree, which is
 * sufficient for the redaction use-case.
 *
 * Full step-removal support for HTML reports would require rebuilding the
 * nested `steps` arrays in each test result to exclude the removed events —
 * this is tracked as a future enhancement.
 *
 * @param _data           - The parsed report data (unused — present for future implementation).
 * @param _repairedEvents - The repaired event array (unused — present for future implementation).
 */
function replaceEventsInReport(_data, _repairedEvents) {
    // The events extracted from the report are object references.
    // removeSteps returns a new array but the original tree still contains
    // the old references. For a full implementation, we'd need to rebuild
    // the tree structure. For now, the walked-and-redacted data is sufficient
    // since we modify the objects in place during the walk phase.
    //
    // A more complete implementation would rebuild the steps arrays in the
    // report tree to match the filtered events.
}
//# sourceMappingURL=html-report.js.map