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
const orphan_strategy_js_1 = require("../remove/orphan-strategy.js");
const timestamp_repair_js_1 = require("../remove/timestamp-repair.js");
const screenshot_js_1 = require("./screenshot.js");
const logger_js_1 = require("../logger.js");
const utils_js_1 = require("../utils.js");
/** Reads NDJSON content into structured lines. */
function parseNdjson(name, content) {
    const trailingNewline = content.endsWith('\n');
    const body = trailingNewline ? content.slice(0, -1) : content;
    const lines = body.split('\n').map((raw) => {
        let obj = null;
        if (raw.trim().length > 0) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    obj = parsed;
                }
            }
            catch {
                // Not valid JSON — leave as raw passthrough
            }
        }
        return { raw, obj, removed: false, dirty: false };
    });
    return { name, lines, trailingNewline };
}
/** Serializes an {@link NdjsonFile} back to text, preserving untouched lines verbatim. */
function serializeNdjson(file) {
    const out = file.lines
        .filter((l) => !l.removed)
        .map((l) => (l.dirty && l.obj ? JSON.stringify(l.obj) : l.raw));
    return out.join('\n') + (file.trailingNewline ? '\n' : '');
}
/** Returns the step identifier of an event line (`callId`, falling back to `stepId`). */
function lineCallId(obj) {
    const callId = obj['callId'];
    if (typeof callId === 'string')
        return callId;
    const stepId = obj['stepId'];
    if (typeof stepId === 'string')
        return stepId;
    return undefined;
}
/**
 * Reconstructs the step list of an NDJSON trace file from its
 * `"before"` / `"after"` event pairs, in `"before"`-line order.
 */
function collectSteps(file) {
    const steps = [];
    const byCallId = new Map();
    for (let i = 0; i < file.lines.length; i++) {
        const obj = file.lines[i].obj;
        if (!obj)
            continue;
        if (obj['type'] === 'before') {
            const callId = lineCallId(obj);
            if (!callId)
                continue;
            const params = (obj['params'] ?? {});
            const rawStepId = obj['stepId'];
            const step = {
                file,
                callId,
                parentId: typeof obj['parentId'] === 'string' ? obj['parentId'] : undefined,
                linkedStepId: typeof rawStepId === 'string' && rawStepId !== callId
                    ? rawStepId
                    : undefined,
                beforeIndex: i,
                afterIndex: -1,
                synthetic: {
                    // Playwright >= ~1.45 uses `title`; older versions (e.g. 1.40) used `apiName`.
                    title: typeof obj['title'] === 'string'
                        ? obj['title']
                        : typeof obj['apiName'] === 'string'
                            ? obj['apiName']
                            : undefined,
                    method: typeof obj['method'] === 'string' ? obj['method'] : undefined,
                    actionType: typeof obj['method'] === 'string' ? obj['method'] : undefined,
                    selector: typeof params['selector'] === 'string' ? params['selector'] : undefined,
                    url: typeof params['url'] === 'string' ? params['url'] : undefined,
                    startTime: typeof obj['startTime'] === 'number' ? obj['startTime'] : 0,
                    endTime: typeof obj['startTime'] === 'number' ? obj['startTime'] : 0,
                    callId,
                    parentId: typeof obj['parentId'] === 'string' ? obj['parentId'] : undefined,
                },
            };
            steps.push(step);
            byCallId.set(callId, step);
        }
        else if (obj['type'] === 'after') {
            const callId = lineCallId(obj);
            if (!callId)
                continue;
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
function collectDescendantSteps(allSteps, rootLabels) {
    // parent (file-scoped callId) → children within the same file
    const childrenByParent = new Map();
    // parent callId (any file) → cross-file linked children
    const linkedByStepId = new Map();
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
    const descendants = new Map();
    const queue = [...rootLabels].map(([step, label]) => ({ step, label }));
    while (queue.length > 0) {
        const { step: current, label } = queue.pop();
        const children = [
            ...(childrenByParent.get(fileScopedId(current.file, current.callId)) ?? []),
            ...(linkedByStepId.get(current.callId) ?? []).filter((s) => s.file !== current.file || s.callId !== current.callId),
        ];
        for (const child of children) {
            // A step is a descendant only if it is neither a root nor already seen.
            // Descendants inherit the rule label of the root that reached them, so
            // the summary can attribute every removed event to a declared rule and
            // the per-rule counts sum to the grand total.
            if (!descendants.has(child) && !rootLabels.has(child)) {
                descendants.set(child, label);
                queue.push({ step: child, label });
            }
        }
    }
    return descendants;
}
/** Unique key for a callId within one file (callIds repeat across files). */
function fileScopedId(file, callId) {
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
function applyRemovalToTraceFiles(traceFiles, rules, config, result, inputPath) {
    const none = {
        modified: false,
        removedCallIdsByFile: new Map(),
        removedUrls: new Set(),
    };
    // ── Per-file step collection and rule matching ──
    const stepsByFile = new Map();
    const allSteps = [];
    // Matched roots → the label of the rule that matched them. Attribution is
    // carried through descendant expansion so the summary's per-rule counts sum
    // to the grand total (see reporter.ts).
    const rootLabels = new Map();
    // Matched roots → every rule that matched them. A step can be matched by
    // several rules; the full set is needed to resolve the effective
    // orphanStrategy (most-destructive-wins) per step.
    const rootRules = new Map();
    for (const file of traceFiles) {
        const steps = collectSteps(file);
        stepsByFile.set(file, steps);
        allSteps.push(...steps);
        if (steps.length === 0)
            continue;
        const removalSet = (0, detector_js_1.findStepsToRemove)(steps.map((s) => s.synthetic), rules);
        result.safetyGuardWarnings.push(...removalSet.safetyGuardWarnings);
        if (removalSet.indices.size === 0)
            continue;
        // First rule label wins for a given step (labels are only for reporting);
        // collect ALL matched rules per index for strategy resolution.
        const labelByIndex = new Map();
        const rulesByIndex = new Map();
        for (const m of removalSet.matches) {
            if (!labelByIndex.has(m.index))
                labelByIndex.set(m.index, m.ruleLabel);
            if (m.rule) {
                const list = rulesByIndex.get(m.index) ?? [];
                list.push(m.rule);
                rulesByIndex.set(m.index, list);
            }
        }
        for (const idx of removalSet.indices) {
            const step = steps[idx];
            rootLabels.set(step, labelByIndex.get(idx) ?? rules[0]?.label ?? 'remove');
            rootRules.set(step, rulesByIndex.get(idx) ?? []);
        }
    }
    if (rootLabels.size === 0)
        return none;
    // ── Back-propagate browser-file matches to their test.trace step ──
    // A rule that matches a library-side action directly (selector / actionType
    // rules against `0-trace.trace`, ...) would otherwise leave the paired
    // test-runner step behind in `test.trace`, so the two streams disagree. Remap
    // such a match onto the runner step it belongs to (via `linkedStepId`); the
    // browser leaf then falls out naturally as that step's descendant. This keeps
    // keep-shell coherent (the runner step becomes the shell) and makes a
    // browser-only match actually remove something instead of reporting a phantom.
    const testStepByCallId = new Map();
    for (const step of allSteps) {
        if (step.file.name.endsWith('test.trace') && step.linkedStepId === undefined) {
            testStepByCallId.set(step.callId, step);
        }
    }
    for (const [leaf, label] of [...rootLabels]) {
        if (leaf.linkedStepId) {
            const owner = testStepByCallId.get(leaf.linkedStepId);
            if (owner) {
                if (!rootLabels.has(owner))
                    rootLabels.set(owner, label);
                // The owner step inherits the leaf's matched rules so its effective
                // orphanStrategy accounts for the browser-side rule that hit the leaf.
                const ownerRules = rootRules.get(owner) ?? [];
                ownerRules.push(...(rootRules.get(leaf) ?? []));
                rootRules.set(owner, ownerRules);
                rootRules.delete(leaf);
                rootLabels.delete(leaf);
            }
        }
    }
    // ── Resolve orphanStrategy PER matched root ──
    // Each root's strategy is `rule.orphanStrategy ?? remove.orphanStrategy ??
    // 'remove-children'`; when a step is matched by rules that disagree, the most
    // destructive (remove-children) wins and the conflict is logged at verbose.
    const globalDefault = config.remove?.orphanStrategy;
    const keepShellRoots = new Map();
    const removeChildrenRoots = new Map();
    for (const [root, label] of rootLabels) {
        const { strategy, conflict } = (0, orphan_strategy_js_1.resolveOrphanStrategy)(rootRules.get(root) ?? [], globalDefault);
        if (conflict) {
            logger_js_1.logger.verbose(`Step "${root.synthetic.title ?? root.callId}" in ${root.file.name} ` +
                `is matched by rules with conflicting orphanStrategy; the most ` +
                `destructive ('remove-children') wins.`);
        }
        if (strategy === 'keep-shell')
            keepShellRoots.set(root, label);
        else
            removeChildrenRoots.set(root, label);
    }
    // ── Expand to descendants across the whole archive, per strategy group ──
    const descOfRemoveChildren = collectDescendantSteps(allSteps, removeChildrenRoots);
    const descOfKeepShell = collectDescendantSteps(allSteps, keepShellRoots);
    // Steps whose lines are DROPPED from the archive:
    //   - every descendant of any matched step (both strategies strip children);
    //   - the matched step itself ONLY under remove-children (keep-shell keeps
    //     its own before/after pair as the surviving shell).
    const removedLabels = new Map();
    for (const [s, l] of descOfKeepShell)
        if (!removedLabels.has(s))
            removedLabels.set(s, l);
    for (const [s, l] of descOfRemoveChildren)
        if (!removedLabels.has(s))
            removedLabels.set(s, l);
    for (const [s, l] of removeChildrenRoots)
        if (!removedLabels.has(s))
            removedLabels.set(s, l);
    // Steps whose duration leaves a real timeline hole to be absorbed by a
    // neighbour: remove-children roots and their descendants. Descendants of a
    // surviving keep-shell shell are excluded — the shell still spans their time,
    // so absorbing it into neighbours would inflate the timeline.
    const holeSteps = new Set();
    for (const s of removeChildrenRoots.keys())
        holeSteps.add(s);
    for (const s of descOfRemoveChildren.keys())
        holeSteps.add(s);
    for (const s of descOfKeepShell.keys())
        holeSteps.delete(s);
    // keep-shell on leaf matches (no descendants) legitimately removes nothing.
    // Report zero rather than a phantom count so per-rule totals stay honest.
    if (removedLabels.size === 0)
        return none;
    // ── Dry run: report the true removal count (incl. descendants) and stop ──
    if (config.remove?.dryRun) {
        logger_js_1.logger.info(`[DRY RUN] Would remove ${removedLabels.size} steps from ${inputPath}`);
        for (const [s, label] of removedLabels) {
            logger_js_1.logger.verbose(`  - Rule "${label}": step ${s.callId} in ${s.file.name} ` +
                `("${s.synthetic.title ?? s.synthetic.action ?? 'unknown'}")`);
            result.removalMatches.push({ index: s.beforeIndex, ruleLabel: label, event: s.synthetic });
        }
        result.stepsRemoved += removedLabels.size;
        return none;
    }
    const removedSteps = new Set(removedLabels.keys());
    // URLs of removed steps — used to drop matching *.network resource
    // snapshots, which have no callId to correlate on.
    const removedUrls = new Set();
    const removedCallIdsByFile = new Map();
    for (const s of removedSteps) {
        if (typeof s.synthetic.url === 'string')
            removedUrls.add(s.synthetic.url);
        let set = removedCallIdsByFile.get(s.file);
        if (!set) {
            set = new Set();
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
            if (!line.obj)
                continue;
            const callId = lineCallId(line.obj);
            if (callId && removedIds.has(callId)) {
                line.removed = true;
            }
        }
        const steps = stepsByFile.get(file);
        const survivors = steps.filter((s) => !removedIds.has(s.callId));
        const removed = steps.filter((s) => removedIds.has(s.callId));
        // Clone synthetic events so the repair never mutates our originals.
        //
        // Only steps in `holeSteps` leave a real gap the neighbours must absorb.
        // A kept keep-shell step still spans its (now-hidden) children's time, so
        // those children are NOT holes — passing them would inflate the timeline.
        // Under mixed strategies this is decided per removed step, not globally.
        const survivorClones = survivors.map((s) => ({ ...s.synthetic }));
        const removedClones = removed
            .filter((s) => holeSteps.has(s))
            .map((s) => ({ ...s.synthetic }));
        const repaired = (0, timestamp_repair_js_1.repairTimestamps)(survivorClones, removedClones, strategy);
        const repairedByCallId = new Map();
        for (const e of repaired) {
            if (e.callId)
                repairedByCallId.set(e.callId, e);
        }
        for (const step of survivors) {
            const fixed = repairedByCallId.get(step.callId);
            if (!fixed)
                continue;
            if (fixed.startTime !== step.synthetic.startTime) {
                const beforeLine = file.lines[step.beforeIndex];
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
                const afterLine = file.lines[step.afterIndex];
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
    // Emit one removal match per ACTUALLY removed step, attributed to the rule
    // that caused it. This keeps `removalMatches.length === stepsRemoved`, so the
    // summary's per-rule counts always sum to the grand total (both dry and real
    // runs) — the invariant the old code violated (per-rule matched roots vs. a
    // total that also counted, or failed to count, descendants).
    for (const [s, label] of removedLabels) {
        result.removalMatches.push({ index: s.beforeIndex, ruleLabel: label, event: s.synthetic });
    }
    result.stepsRemoved += removedSteps.size;
    result.timestampRepairs += timestampRepairs;
    return { modified: true, removedCallIdsByFile, removedUrls };
}
/**
 * Phase 2 — cross-stream orphan sweep.
 *
 * The step graph in {@link applyRemovalToTraceFiles} removes browser-side
 * `before`/`after` actions (they are captured as steps and linked via
 * `stepId`). It does NOT catch two classes of correlated line that carry no
 * top-level `callId` matching a removed step:
 *
 * - `frame-snapshot` entries, whose callId lives at `snapshot.callId`;
 * - fire-and-forget `event` / `log` lines that reference a removed step purely
 *   through `stepId` (their own `callId`, if any, never had a `before`).
 *
 * Left behind, these surface in the trace viewer as loose rows and dangling
 * snapshot references. This pass seeds from every callId removed in phase 1 and
 * iterates to a fixpoint: any surviving line that references a removed callId
 * via `callId`, `stepId`, `parentId`, or `snapshot.callId` is dropped, and its
 * own `callId` is added to the removed set so its paired `after` / `log` /
 * snapshot siblings follow. Auxiliary lines are not steps, so they do not count
 * toward `stepsRemoved`.
 *
 * @returns The number of additional lines dropped and the final removed-callId set.
 */
function sweepCrossStreamOrphans(traceFiles, seed) {
    const removed = new Set(seed);
    let orphanLinesRemoved = 0;
    let changed = true;
    while (changed) {
        changed = false;
        for (const file of traceFiles) {
            for (const line of file.lines) {
                if (line.removed || !line.obj)
                    continue;
                const o = line.obj;
                const cid = typeof o['callId'] === 'string' ? o['callId'] : undefined;
                const sid = typeof o['stepId'] === 'string' && o['stepId'] !== cid
                    ? o['stepId']
                    : undefined;
                const pid = typeof o['parentId'] === 'string' ? o['parentId'] : undefined;
                let snapCid;
                const snap = o['snapshot'];
                if (snap && typeof snap === 'object' && typeof snap['callId'] === 'string') {
                    snapCid = snap['callId'];
                }
                const hit = (cid !== undefined && removed.has(cid)) ||
                    (sid !== undefined && removed.has(sid)) ||
                    (pid !== undefined && removed.has(pid)) ||
                    (snapCid !== undefined && removed.has(snapCid));
                if (hit) {
                    line.removed = true;
                    orphanLinesRemoved++;
                    changed = true;
                    // Propagate this line's callId so its siblings (paired after, logs,
                    // snapshots sharing the callId) are swept on a later pass.
                    if (cid !== undefined && !removed.has(cid))
                        removed.add(cid);
                }
            }
        }
    }
    return { orphanLinesRemoved, removedCallIds: removed };
}
/**
 * Sanity pass — asserts the two streams agree after removal.
 *
 * Scans every surviving line across all `*.trace` streams and reports any that
 * still references a removed callId via `stepId`, `parentId`, or
 * `snapshot.callId`. A clean run logs nothing; survivors indicate the removal
 * left the streams inconsistent and are surfaced as a warning rather than
 * silently shipped in the sanitized archive.
 *
 * @returns The number of dangling references found (0 when consistent).
 */
function assertNoDanglingReferences(traceFiles, removedCallIds, inputPath) {
    let dangling = 0;
    for (const file of traceFiles) {
        for (const line of file.lines) {
            if (line.removed || !line.obj)
                continue;
            const o = line.obj;
            const cid = typeof o['callId'] === 'string' ? o['callId'] : undefined;
            const sid = typeof o['stepId'] === 'string' && o['stepId'] !== cid ? o['stepId'] : undefined;
            const pid = typeof o['parentId'] === 'string' ? o['parentId'] : undefined;
            const snap = o['snapshot'];
            const snapCid = snap && typeof snap === 'object' && typeof snap['callId'] === 'string'
                ? snap['callId']
                : undefined;
            if ((sid !== undefined && removedCallIds.has(sid)) ||
                (pid !== undefined && removedCallIds.has(pid)) ||
                (snapCid !== undefined && removedCallIds.has(snapCid))) {
                dangling++;
            }
        }
    }
    if (dangling > 0) {
        logger_js_1.logger.warn(`Sanitized ${inputPath}: ${dangling} event(s) still reference a removed ` +
            `callId across trace streams after cross-stream sweep. The trace may show ` +
            `orphan rows in the viewer. Please file an issue with a sample trace.`);
    }
    return dangling;
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
async function processTraceFile(inputPath, outputPath, config, patterns, rules) {
    const result = {
        file: inputPath,
        redactionsApplied: 0,
        stepsRemoved: 0,
        timestampRepairs: 0,
        redactionMatches: [],
        removalMatches: [],
        safetyGuardWarnings: [],
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
    // Discover NDJSON entries of the real Playwright trace format.
    const traceEntryNames = [];
    const networkEntryNames = [];
    zip.forEach((relativePath, entry) => {
        if (entry.dir)
            return;
        if (relativePath.endsWith('.trace'))
            traceEntryNames.push(relativePath);
        else if (relativePath.endsWith('.network'))
            networkEntryNames.push(relativePath);
    });
    const isModernFormat = traceEntryNames.length > 0;
    if (!isModernFormat && zip.file('trace.json')) {
        // Legacy layout (trace.json / network.json as JSON arrays).
        return processLegacyTraceJson(zip, inputPath, outputPath, config, patterns, rules, result);
    }
    if (!isModernFormat) {
        logger_js_1.logger.warn(`No *.trace entries (and no legacy trace.json) found in ${inputPath} — skipping.`);
        return result;
    }
    let modified = false;
    // Parse all NDJSON entries up-front.
    const ndjsonFiles = [];
    for (const name of [...traceEntryNames, ...networkEntryNames]) {
        const entry = zip.file(name);
        if (!entry)
            continue;
        try {
            const content = await entry.async('string');
            ndjsonFiles.push(parseNdjson(name, content));
        }
        catch (err) {
            logger_js_1.logger.warn(`Failed to read ${name} in ${inputPath}: ` +
                `${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // Collect element bounding boxes before any removal so that boxes from
    // steps that will later be removed remain available for screenshot blurring.
    const elementBoxes = [];
    if (config.output?.redactScreenshots) {
        for (const file of ndjsonFiles) {
            for (const line of file.lines) {
                const box = line.obj?.['box'];
                if (box && typeof box === 'object') {
                    const b = box;
                    if (typeof b['x'] === 'number' &&
                        typeof b['y'] === 'number' &&
                        typeof b['width'] === 'number' &&
                        typeof b['height'] === 'number') {
                        elementBoxes.push({ x: b['x'], y: b['y'], width: b['width'], height: b['height'] });
                    }
                }
            }
        }
        if (elementBoxes.length === 0) {
            logger_js_1.logger.verbose(`Screenshot redaction enabled for ${inputPath} but no element bounding boxes ` +
                `were found in trace events — screenshots will not be blurred.`);
        }
    }
    // ── Redact phase ──
    if (config.redact && patterns.length > 0) {
        for (const file of ndjsonFiles) {
            for (const line of file.lines) {
                if (!line.obj)
                    continue;
                const walk = (0, json_walker_js_1.walkAndRedact)(line.obj, patterns, config.redact);
                if (walk.count > 0) {
                    line.obj = walk.result;
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
                            zip.file(resPath, JSON.stringify(resWalk.result));
                            result.redactionsApplied += resWalk.count;
                            result.redactionMatches.push(...resWalk.matches);
                            modified = true;
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
    if (config.remove && rules.length > 0) {
        const traceFiles = ndjsonFiles.filter((f) => f.name.endsWith('.trace'));
        const { modified: removalModified, removedCallIdsByFile, removedUrls } = applyRemovalToTraceFiles(traceFiles, rules, config, result, inputPath);
        if (removalModified)
            modified = true;
        // Drop network events tied to removed steps. Two correlation paths:
        // - by callId (events that carry one);
        // - by request URL — `resource-snapshot` entries have NO callId, so they
        //   are matched against the URLs of the removed steps instead. Note this
        //   drops every snapshot for a removed URL, which is the intent for the
        //   noisy repeated endpoints removal rules typically target.
        const allRemovedCallIds = new Set();
        for (const ids of removedCallIdsByFile.values()) {
            for (const id of ids)
                allRemovedCallIds.add(id);
        }
        // ── Phase 2: cross-stream orphan sweep ──
        // Remove correlated lines the step graph can't see (frame-snapshots whose
        // callId is nested under `snapshot.callId`, and fire-and-forget event/log
        // lines that reference a removed step only through `stepId`). The swept
        // callId set then also feeds network dropping below.
        if (allRemovedCallIds.size > 0) {
            const { orphanLinesRemoved, removedCallIds } = sweepCrossStreamOrphans(traceFiles, allRemovedCallIds);
            if (orphanLinesRemoved > 0) {
                modified = true;
                logger_js_1.logger.verbose(`Cross-stream sweep removed ${orphanLinesRemoved} orphan line(s) in ${inputPath}`);
            }
            for (const id of removedCallIds)
                allRemovedCallIds.add(id);
            // ── Sanity pass ── assert the streams now agree.
            assertNoDanglingReferences(traceFiles, allRemovedCallIds, inputPath);
        }
        if (allRemovedCallIds.size > 0 || removedUrls.size > 0) {
            for (const file of ndjsonFiles) {
                if (!file.name.endsWith('.network'))
                    continue;
                for (const line of file.lines) {
                    if (!line.obj)
                        continue;
                    const callId = lineCallId(line.obj);
                    if (callId && allRemovedCallIds.has(callId)) {
                        line.removed = true;
                        modified = true;
                        continue;
                    }
                    const snapshot = line.obj['snapshot'];
                    if (snapshot && typeof snapshot === 'object') {
                        const request = snapshot['request'];
                        if (request && typeof request === 'object') {
                            const url = request['url'];
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
        const screenshotPaths = [];
        zip.forEach((relativePath, file) => {
            if (!file.dir &&
                (relativePath.endsWith('.png') ||
                    relativePath.endsWith('.jpeg') ||
                    relativePath.endsWith('.jpg'))) {
                screenshotPaths.push(relativePath);
            }
        });
        for (const screenshotPath of screenshotPaths) {
            const screenshotFile = zip.file(screenshotPath);
            if (!screenshotFile)
                continue;
            try {
                const originalBuffer = await screenshotFile.async('nodebuffer');
                const redactedBuffer = await (0, screenshot_js_1.redactScreenshot)(originalBuffer, elementBoxes);
                if (redactedBuffer !== originalBuffer) {
                    zip.file(screenshotPath, redactedBuffer);
                    modified = true;
                }
            }
            catch (err) {
                logger_js_1.logger.warn(`Failed to redact screenshot ${screenshotPath} in ${inputPath}: ` +
                    `${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    if (!modified && !config.remove?.dryRun) {
        logger_js_1.logger.info(`No changes made to ${inputPath}`);
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
        (0, utils_js_1.writeOutput)(inputPath, outputPath, outputBuffer, config);
    }
    return result;
}
/**
 * Legacy processing path for archives that contain a `trace.json` /
 * `network.json` pair (JSON arrays rather than NDJSON). Kept for backwards
 * compatibility with pre-NDJSON fixtures and third-party tooling.
 */
async function processLegacyTraceJson(zip, inputPath, outputPath, config, patterns, rules, result) {
    let modified = false;
    const elementBoxes = [];
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
    // Collect element bounding boxes before any removal.
    if (config.output?.redactScreenshots && traceEvents) {
        for (const event of traceEvents) {
            const box = event['box'];
            if (box !== null && box !== undefined && typeof box === 'object') {
                const b = box;
                if (typeof b['x'] === 'number' &&
                    typeof b['y'] === 'number' &&
                    typeof b['width'] === 'number' &&
                    typeof b['height'] === 'number') {
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
            logger_js_1.logger.verbose(`Screenshot redaction enabled for ${inputPath} but no element bounding boxes ` +
                `were found in trace events — screenshots will not be blurred. ` +
                `Bounding boxes are recorded by Playwright for UI actions (fill, click, etc.).`);
        }
    }
    // ── Redact phase ──
    if (config.redact && patterns.length > 0) {
        if (traceEvents) {
            const traceWalk = (0, json_walker_js_1.walkAndRedact)(traceEvents, patterns, config.redact);
            if (traceWalk.count > 0) {
                traceEvents = traceWalk.result;
                result.redactionsApplied += traceWalk.count;
                result.redactionMatches.push(...traceWalk.matches);
                modified = true;
            }
        }
        if (networkData) {
            const networkWalk = (0, json_walker_js_1.walkAndRedact)(networkData, patterns, config.redact);
            if (networkWalk.count > 0) {
                networkData = networkWalk.result;
                result.redactionsApplied += networkWalk.count;
                result.redactionMatches.push(...networkWalk.matches);
                modified = true;
            }
        }
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
                            zip.file(resPath, JSON.stringify(resWalk.result));
                            result.redactionsApplied += resWalk.count;
                            result.redactionMatches.push(...resWalk.matches);
                            modified = true;
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
                const removedEvents = Array.from(removalSet.indices).map((i) => traceEvents[i]);
                const removedRequestIds = new Set();
                for (const event of removedEvents) {
                    if (event.requestId) {
                        removedRequestIds.add(event.requestId);
                    }
                }
                // Resolve orphanStrategy per matched step (per-rule, most-destructive
                // wins). A step can be matched by several rules.
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
                        logger_js_1.logger.verbose(`Step at index ${idx} ("${traceEvents[idx]?.title ?? 'unknown'}") ` +
                            `is matched by rules with conflicting orphanStrategy; the most ` +
                            `destructive ('remove-children') wins.`);
                    }
                }
                const cleaned = (0, remover_js_1.removeSteps)(traceEvents, removalSet, strategyByIndex);
                const cleanedSet = new Set(cleaned);
                const actuallyRemovedEvents = traceEvents.filter((e) => !cleanedSet.has(e));
                // A removed step leaves an absorbable timeline hole UNLESS it is covered
                // by a surviving keep-shell ancestor (which still spans its time). Seed
                // with keep-shell root callIds and propagate down parentId chains.
                const coveredCallIds = new Set();
                for (const idx of removalSet.indices) {
                    if (strategyByIndex(idx) === 'keep-shell') {
                        const cid = traceEvents[idx]?.callId;
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
                const strategy = config.remove.timestampStrategy ?? 'absorb-into-prev';
                traceEvents = (0, timestamp_repair_js_1.repairTimestamps)(cleaned, holeEvents, strategy);
                if (networkData && removedRequestIds.size > 0) {
                    networkData = networkData.filter((entry) => {
                        if (entry && typeof entry === 'object' && 'requestId' in entry) {
                            const reqId = entry.requestId;
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
        const screenshotPaths = [];
        zip.forEach((relativePath, file) => {
            if (!file.dir &&
                (relativePath.endsWith('.png') ||
                    relativePath.endsWith('.jpeg') ||
                    relativePath.endsWith('.jpg'))) {
                screenshotPaths.push(relativePath);
            }
        });
        logger_js_1.logger.verbose(`Screenshot redaction: processing ${screenshotPaths.length} screenshot(s) ` +
            `with ${elementBoxes.length} region(s) in ${inputPath}`);
        for (const screenshotPath of screenshotPaths) {
            const screenshotFile = zip.file(screenshotPath);
            if (!screenshotFile)
                continue;
            try {
                const originalBuffer = await screenshotFile.async('nodebuffer');
                const redactedBuffer = await (0, screenshot_js_1.redactScreenshot)(originalBuffer, elementBoxes);
                if (redactedBuffer !== originalBuffer) {
                    zip.file(screenshotPath, redactedBuffer);
                    modified = true;
                    logger_js_1.logger.verbose(`Screenshot redacted: ${screenshotPath}`);
                }
            }
            catch (err) {
                logger_js_1.logger.warn(`Failed to redact screenshot ${screenshotPath} in ${inputPath}: ` +
                    `${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    if (!modified && !config.remove?.dryRun) {
        logger_js_1.logger.info(`No changes made to ${inputPath}`);
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
        (0, utils_js_1.writeOutput)(inputPath, outputPath, outputBuffer, config);
    }
    return result;
}
//# sourceMappingURL=trace-file.js.map