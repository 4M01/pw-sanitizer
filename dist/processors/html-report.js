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
exports.processHtmlReport = processHtmlReport;
const fs = __importStar(require("node:fs"));
const jszip_1 = __importDefault(require("jszip"));
const json_walker_js_1 = require("../redact/json-walker.js");
const detector_js_1 = require("../remove/detector.js");
const remover_js_1 = require("../remove/remover.js");
const orphan_strategy_js_1 = require("../remove/orphan-strategy.js");
const timestamp_repair_js_1 = require("../remove/timestamp-repair.js");
const logger_js_1 = require("../logger.js");
const utils_js_1 = require("../utils.js");
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
const WINDOW_BASE64_REGEX = /(window\.playwrightReportBase64\s*=\s*")data:application\/zip;base64,([A-Za-z0-9+/=]*)(";)/;
const TEMPLATE_BASE64_REGEX = /(<template id="playwrightReportBase64">)data:application\/zip;base64,([^<]*)(<\/template>)/;
/**
 * Legacy regex kept as a fallback for pre-base64 report formats that embedded
 * plain JSON as `window.__pw_report_data__ = {...};</script>`.
 */
const REPORT_DATA_REGEX = /window\.__pw_report_data__\s*=\s*(\{.+?\});\s*<\/script>/s;
/** Counts a node and all of its descendants. */
function countStepNodes(steps) {
    if (!steps)
        return 0;
    let n = 0;
    for (const s of steps) {
        n += 1 + countStepNodes(s.steps);
    }
    return n;
}
/** Parses a shard step's startTime (ISO string) into epoch ms; NaN-safe. */
function stepStartMs(step) {
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
 *
 * The strategy is resolved **per matched node** from the rules that matched it
 * (`rule.orphanStrategy ?? globalOrphanStrategy ?? 'remove-children'`), so one
 * pass can mix strategies. Conflicting rules on one node resolve to the most
 * destructive (`remove-children`) and log the conflict at verbose level.
 */
function sanitizeStepTree(steps, rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun) {
    if (steps.length === 0)
        return steps;
    // Build synthetic flat events for this sibling group so the shared detector
    // (including AND-matcher logic and minConsecutiveOccurrences runs) applies.
    const synthetic = steps.map((s) => {
        const start = stepStartMs(s);
        return {
            title: s.title,
            startTime: start,
            endTime: start + (typeof s.duration === 'number' ? s.duration : 0),
        };
    });
    const removalSet = (0, detector_js_1.findStepsToRemove)(synthetic, rules);
    result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);
    const matchedIndices = removalSet.indices;
    // Group matched rules per index, and resolve the effective strategy per node.
    const rulesByIndex = new Map();
    for (const m of removalSet.matches) {
        if (m.rule) {
            const list = rulesByIndex.get(m.index) ?? [];
            list.push(m.rule);
            rulesByIndex.set(m.index, list);
        }
    }
    const strategyFor = (i) => {
        const { strategy, conflict } = (0, orphan_strategy_js_1.resolveOrphanStrategy)(rulesByIndex.get(i) ?? [], globalOrphanStrategy);
        if (conflict) {
            logger_js_1.logger.verbose(`Step "${steps[i]?.title ?? 'unknown'}" is matched by rules with ` +
                `conflicting orphanStrategy; the most destructive ('remove-children') wins.`);
        }
        return strategy;
    };
    if (matchedIndices.size > 0) {
        // One removal match per matched node (dedup across multiple matching rules),
        // attributed to the first rule that matched it.
        const seen = new Set();
        for (const m of removalSet.matches) {
            if (!seen.has(m.index)) {
                seen.add(m.index);
                result.removalMatches.push(m);
            }
        }
    }
    if (dryRun) {
        // Report matches but do not mutate; still recurse to report nested matches.
        for (const i of matchedIndices) {
            const s = steps[i];
            counters.stepsRemoved +=
                strategyFor(i) === 'keep-shell'
                    ? countStepNodes(s.steps)
                    : 1 + countStepNodes(s.steps);
        }
        steps.forEach((s, i) => {
            if (!matchedIndices.has(i) && s.steps) {
                sanitizeStepTree(s.steps, rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun);
            }
        });
        return steps;
    }
    const output = [];
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (matchedIndices.has(i)) {
            if (strategyFor(i) === 'keep-shell') {
                // Keep the matched node as a hollow shell: empty its children and
                // reset count-related fields, but preserve its own duration.
                counters.stepsRemoved += countStepNodes(step.steps);
                counters.mutations++;
                step.steps = [];
                if (typeof step.count === 'number')
                    step.count = 1;
                output.push(step);
            }
            else {
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
                            if (typeof next.duration === 'number')
                                next.duration += removedDuration;
                            counters.timestampRepairs++;
                        }
                        else if (output.length > 0) {
                            const prev = output[output.length - 1];
                            if (typeof prev.duration === 'number')
                                prev.duration += removedDuration;
                            counters.timestampRepairs++;
                        }
                    }
                    else {
                        // absorb-into-prev (default)
                        const prev = output.length > 0 ? output[output.length - 1] : undefined;
                        if (prev && typeof prev.duration === 'number') {
                            prev.duration += removedDuration;
                            counters.timestampRepairs++;
                        }
                        else {
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
                                if (typeof next.duration === 'number')
                                    next.duration += removedDuration;
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
            step.steps = sanitizeStepTree(step.steps, rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun);
        }
        output.push(step);
    }
    return output;
}
/**
 * Applies removal rules to all step trees found in a parsed shard JSON.
 * Shards contain `tests[].results[].steps` (each step may nest further).
 */
function sanitizeShard(shard, rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun) {
    if (!shard || typeof shard !== 'object')
        return false;
    const before = counters.mutations;
    const tests = shard['tests'];
    if (!Array.isArray(tests))
        return false;
    for (const test of tests) {
        if (!test || typeof test !== 'object')
            continue;
        const results = test['results'];
        if (!Array.isArray(results))
            continue;
        for (const res of results) {
            if (!res || typeof res !== 'object')
                continue;
            const resObj = res;
            if (Array.isArray(resObj['steps'])) {
                resObj['steps'] = sanitizeStepTree(resObj['steps'], rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun);
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
async function processHtmlReport(inputPath, outputPath, config, patterns, rules) {
    const result = {
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
    const base64Match = WINDOW_BASE64_REGEX.exec(html) ?? TEMPLATE_BASE64_REGEX.exec(html);
    if (base64Match) {
        return processBase64Report(html, base64Match, inputPath, outputPath, config, patterns, rules, result);
    }
    // Legacy fallback: plain-JSON window.__pw_report_data__ blob.
    if (REPORT_DATA_REGEX.test(html)) {
        return processLegacyReportData(html, inputPath, outputPath, config, patterns, rules, result);
    }
    // No report payload marker at all. This is expected for the static
    // trace-viewer app assets Playwright ships inside the report directory
    // (playwright-report/trace/index.html, uiMode.html, snapshot.html, ...),
    // so it is logged at verbose level rather than as a warning.
    logger_js_1.logger.verbose(`No embedded report payload found in ${inputPath} — skipping ` +
        `(likely a static asset such as the trace viewer app, not a report).`);
    return result;
}
/**
 * Processes the modern base64-zip report format.
 *
 * @param base64Match - Regex match with groups: [1] prefix, [2] base64 payload, [3] suffix.
 */
async function processBase64Report(html, base64Match, inputPath, outputPath, config, patterns, rules, result) {
    const [fullMatch, prefix, base64Payload, suffix] = base64Match;
    let zip;
    try {
        zip = await jszip_1.default.loadAsync(Buffer.from(base64Payload, 'base64'));
    }
    catch (err) {
        logger_js_1.logger.warn(`Failed to decode embedded report zip in ${inputPath}: ` +
            `${err instanceof Error ? err.message : String(err)}`);
        return result;
    }
    // Parse every JSON entry (report.json + one shard per test file).
    const entries = [];
    const entryNames = [];
    zip.forEach((relativePath, entry) => {
        if (!entry.dir)
            entryNames.push(relativePath);
    });
    for (const name of entryNames) {
        if (!name.endsWith('.json'))
            continue;
        const entry = zip.file(name);
        if (!entry)
            continue;
        try {
            const content = await entry.async('string');
            entries.push({ name, data: JSON.parse(content), modified: false });
        }
        catch (err) {
            logger_js_1.logger.warn(`Failed to parse ${name} inside report zip of ${inputPath}: ` +
                `${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (entries.length === 0) {
        logger_js_1.logger.warn(`No JSON entries found inside embedded report zip of ${inputPath}.`);
        return result;
    }
    let modified = false;
    const dryRun = config.remove?.dryRun ?? false;
    // ── Redact phase ──
    if (config.redact && patterns.length > 0) {
        for (const entry of entries) {
            const walk = (0, json_walker_js_1.walkAndRedact)(entry.data, patterns, config.redact);
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
        // Global default only — the effective strategy is resolved per matched node
        // inside sanitizeStepTree (`rule.orphanStrategy ?? this ?? 'remove-children'`).
        const globalOrphanStrategy = config.remove.orphanStrategy;
        const timestampStrategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
        const counters = { stepsRemoved: 0, timestampRepairs: 0, mutations: 0 };
        for (const entry of entries) {
            if (entry.name === 'report.json')
                continue; // no step trees in the aggregate
            const changed = sanitizeShard(entry.data, rules, globalOrphanStrategy, timestampStrategy, counters, result, dryRun);
            if (changed && !dryRun) {
                entry.modified = true;
                modified = true;
            }
        }
        result.stepsRemoved += counters.stepsRemoved;
        result.timestampRepairs += counters.timestampRepairs;
        if (dryRun && counters.stepsRemoved > 0) {
            logger_js_1.logger.info(`[DRY RUN] Would remove ${counters.stepsRemoved} steps from ${inputPath}`);
            for (const m of result.removalMatches) {
                logger_js_1.logger.info(`  - Rule "${m.ruleLabel}": step "${m.event.title ?? 'unknown'}"`);
            }
        }
    }
    if (!modified && !dryRun) {
        logger_js_1.logger.info(`No changes made to ${inputPath}`);
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
        const newHtml = html.slice(0, base64Match.index) +
            replacement +
            html.slice(base64Match.index + fullMatch.length);
        (0, utils_js_1.writeOutput)(inputPath, outputPath, newHtml, config);
    }
    return result;
}
/**
 * Legacy processing path for reports that embed plain JSON via
 * `window.__pw_report_data__ = {...};`. Kept for backwards compatibility.
 */
function processLegacyReportData(html, inputPath, outputPath, config, patterns, rules, result) {
    const match = REPORT_DATA_REGEX.exec(html);
    if (!match?.[1]) {
        logger_js_1.logger.warn(`Could not find embedded report data in ${inputPath}. ` +
            `Expected a base64 report payload (window.playwrightReportBase64 / ` +
            `<template id="playwrightReportBase64">) or legacy ` +
            `window.__pw_report_data__ = {...};`);
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
        const events = extractEventsFromReport(reportData);
        if (events.length > 0) {
            const removalSet = (0, detector_js_1.findStepsToRemove)(events, rules);
            result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);
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
                    // Resolve orphanStrategy per matched step (per-rule, most-destructive
                    // wins) for this flat legacy event list.
                    const globalDefault = config.remove.orphanStrategy;
                    const rulesByIndex = new Map();
                    for (const m of removalSet.matches) {
                        if (m.rule) {
                            const list = rulesByIndex.get(m.index) ?? [];
                            list.push(m.rule);
                            rulesByIndex.set(m.index, list);
                        }
                    }
                    const strategyByIndex = (idx) => (0, orphan_strategy_js_1.resolveOrphanStrategy)(rulesByIndex.get(idx) ?? [], globalDefault).strategy;
                    for (const idx of removalSet.indices) {
                        if ((0, orphan_strategy_js_1.resolveOrphanStrategy)(rulesByIndex.get(idx) ?? [], globalDefault).conflict) {
                            logger_js_1.logger.verbose(`Step "${events[idx]?.title ?? 'unknown'}" is matched by rules with ` +
                                `conflicting orphanStrategy; the most destructive ('remove-children') wins.`);
                        }
                    }
                    const cleaned = (0, remover_js_1.removeSteps)(events, removalSet, strategyByIndex);
                    const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
                    const cleanedSet = new Set(cleaned);
                    const actuallyRemovedEvents = events.filter((e) => !cleanedSet.has(e));
                    // A removed event leaves an absorbable hole UNLESS covered by a
                    // surviving keep-shell ancestor (which still spans its time). Seed
                    // with keep-shell root callIds and propagate down parentId chains.
                    const coveredCallIds = new Set();
                    for (const idx of removalSet.indices) {
                        if (strategyByIndex(idx) === 'keep-shell') {
                            const cid = events[idx]?.callId;
                            if (typeof cid === 'string')
                                coveredCallIds.add(cid);
                        }
                    }
                    const coveredEvents = new Set();
                    let coveredChanged = true;
                    while (coveredChanged) {
                        coveredChanged = false;
                        for (const e of actuallyRemovedEvents) {
                            if (coveredEvents.has(e))
                                continue;
                            const pid = typeof e.parentId === 'string' ? e.parentId : undefined;
                            if (pid && coveredCallIds.has(pid)) {
                                coveredEvents.add(e);
                                if (typeof e.callId === 'string')
                                    coveredCallIds.add(e.callId);
                                coveredChanged = true;
                            }
                        }
                    }
                    const holeEvents = actuallyRemovedEvents.filter((e) => !coveredEvents.has(e));
                    const repaired = (0, timestamp_repair_js_1.repairTimestamps)(cleaned, holeEvents, strategy);
                    const repairedByCallId = new Map();
                    for (const e of repaired) {
                        if (e.callId)
                            repairedByCallId.set(e.callId, e);
                    }
                    const treeEventsToRemove = new Set(actuallyRemovedEvents);
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
 * Flattens the nested legacy report structure into a single array of
 * step/action events that can be processed by the removal pipeline.
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
        if (('startTime' in obj && 'endTime' in obj) ||
            'title' in obj ||
            'action' in obj) {
            events.push(obj);
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
function replaceEventsInReport(data, eventsToRemove, repairedByCallId) {
    function traverse(node) {
        if (!node || typeof node !== 'object' || Array.isArray(node))
            return;
        const obj = node;
        if (typeof obj['callId'] === 'string') {
            const repaired = repairedByCallId.get(obj['callId']);
            if (repaired) {
                obj['startTime'] = repaired.startTime;
                obj['endTime'] = repaired.endTime;
            }
        }
        for (const key of ['steps', 'actions']) {
            if (Array.isArray(obj[key])) {
                obj[key] = obj[key].filter((item) => !(item !== null && typeof item === 'object' && eventsToRemove.has(item)));
                for (const item of obj[key]) {
                    traverse(item);
                }
            }
        }
        for (const key of ['suites', 'tests', 'results', 'attachments']) {
            if (Array.isArray(obj[key])) {
                for (const item of obj[key]) {
                    traverse(item);
                }
            }
        }
    }
    traverse(data);
}
//# sourceMappingURL=html-report.js.map