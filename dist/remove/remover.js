"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeSteps = removeSteps;
/**
 * Recursively collects the indices of all descendant events for a given parent.
 *
 * Traverses the `callId` → `parentId` relationship: an event is considered a
 * child of `parentIndex` if its `parentId` equals the parent's `callId`.
 * Children of children are collected transitively.
 *
 * @param events      - The flat event array being searched (current working copy).
 * @param parentIndex - Zero-based index of the parent event in `allEvents`.
 * @param allEvents   - The original full event array used to look up the parent's `callId`.
 * @returns A `Set` of all descendant indices (does **not** include `parentIndex` itself).
 */
function collectChildIndices(events, parentIndex, allEvents) {
    const children = new Set();
    const parentEvent = allEvents[parentIndex];
    if (!parentEvent)
        return children;
    const parentCallId = parentEvent.callId;
    if (!parentCallId)
        return children;
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event && event.parentId === parentCallId && i !== parentIndex) {
            children.add(i);
            // Recursively collect children of children
            const grandChildren = collectChildIndices(events, i, allEvents);
            for (const gc of grandChildren) {
                children.add(gc);
            }
        }
    }
    return children;
}
/**
 * Removes the matched steps — and all their descendants — from the events array.
 *
 * Algorithm:
 * 1. Expands the removal set to include all descendant events (via {@link collectChildIndices}).
 * 2. Sorts the combined indices in **descending** order so earlier indices remain
 *    stable as elements are spliced out.
 * 3. Splices each index from a shallow copy of the events array.
 *
 * The input array is **never mutated** — a new array is returned.
 *
 * @param events     - The ordered list of trace events.
 * @param removalSet - The set of matched step indices (from {@link findStepsToRemove}).
 * @returns A new array with all matched steps (and their descendants) removed.
 */
function removeSteps(events, removalSet) {
    // Expand removal set to include child indices
    const expandedIndices = new Set(removalSet.indices);
    for (const idx of removalSet.indices) {
        const children = collectChildIndices(events, idx, events);
        for (const childIdx of children) {
            expandedIndices.add(childIdx);
        }
    }
    // Sort indices in reverse order for safe removal
    const sortedIndices = Array.from(expandedIndices).sort((a, b) => b - a);
    // Create a new array (immutability)
    const result = [...events];
    for (const idx of sortedIndices) {
        if (idx >= 0 && idx < result.length) {
            result.splice(idx, 1);
        }
    }
    return result;
}
//# sourceMappingURL=remover.js.map