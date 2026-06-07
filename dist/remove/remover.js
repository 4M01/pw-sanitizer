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
 * Removes steps from the events array according to the configured orphan strategy.
 *
 * ### `'remove-children'` (default)
 * Removes every matched step **and all of its descendants**.
 * Algorithm:
 * 1. Expands the removal set to include all descendant events (via {@link collectChildIndices}).
 * 2. Sorts the combined indices in **descending** order so earlier indices remain
 *    stable as elements are spliced out.
 * 3. Splices each index from a shallow copy of the events array.
 *
 * ### `'keep-shell'`
 * Keeps each matched step as a hollow, child-free container and removes **only its
 * descendants**. This is useful when you want the step to remain visible in the
 * trace timeline (e.g. to preserve overall duration) but need to strip its
 * sub-steps that may contain sensitive details.
 *
 * Algorithm:
 * 1. For each matched index, collects all descendant indices via {@link collectChildIndices}.
 * 2. The matched indices themselves are **not** added to the removal set.
 * 3. Splices descendant indices in descending order from a shallow copy.
 *
 * The input array is **never mutated** — a new array is always returned.
 *
 * @param events          - The ordered list of trace events.
 * @param removalSet      - The set of matched step indices (from {@link findStepsToRemove}).
 * @param orphanStrategy  - How to handle descendants of removed steps.
 *   `'remove-children'` *(default)* or `'keep-shell'`.
 * @returns A new array with the appropriate steps removed.
 */
function removeSteps(events, removalSet, orphanStrategy = 'remove-children') {
    const indicesToRemove = new Set();
    if (orphanStrategy === 'keep-shell') {
        // Keep matched events themselves; remove only their descendants.
        for (const idx of removalSet.indices) {
            const children = collectChildIndices(events, idx, events);
            for (const childIdx of children) {
                indicesToRemove.add(childIdx);
            }
        }
    }
    else {
        // remove-children (default): remove matched events AND all descendants.
        for (const idx of removalSet.indices) {
            indicesToRemove.add(idx);
            const children = collectChildIndices(events, idx, events);
            for (const childIdx of children) {
                indicesToRemove.add(childIdx);
            }
        }
    }
    // Sort indices in reverse order for safe removal
    const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
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