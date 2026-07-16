import type { TraceEvent, RemovalSet, OrphanStrategy } from '../config/types.js';

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
function collectChildIndices(
  events: TraceEvent[],
  parentIndex: number,
  allEvents: TraceEvent[]
): Set<number> {
  const children = new Set<number>();
  const parentEvent = allEvents[parentIndex];
  if (!parentEvent) return children;

  const parentCallId = parentEvent.callId;
  if (!parentCallId) return children;

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
 * ### Per-step (mixed) strategies
 * `orphanStrategy` may be a **function** `(index) => OrphanStrategy` returning
 * the strategy for each matched index. This lets one pass mix `'keep-shell'`
 * and `'remove-children'` across different matched steps (per-rule strategies).
 * A plain string applies the same strategy to every matched step.
 *
 * @param events          - The ordered list of trace events.
 * @param removalSet      - The set of matched step indices (from {@link findStepsToRemove}).
 * @param orphanStrategy  - How to handle descendants of removed steps.
 *   `'remove-children'` *(default)* or `'keep-shell'`, or a per-index resolver
 *   function for mixed strategies.
 * @returns A new array with the appropriate steps removed.
 */
export function removeSteps(
  events: TraceEvent[],
  removalSet: RemovalSet,
  orphanStrategy:
    | OrphanStrategy
    | ((index: number) => OrphanStrategy) = 'remove-children'
): TraceEvent[] {
  const strategyFor = (idx: number): OrphanStrategy =>
    typeof orphanStrategy === 'function' ? orphanStrategy(idx) : orphanStrategy;

  const indicesToRemove = new Set<number>();

  for (const idx of removalSet.indices) {
    // remove-children removes the matched step itself; keep-shell keeps it.
    if (strategyFor(idx) !== 'keep-shell') {
      indicesToRemove.add(idx);
    }
    // Both strategies remove all descendants.
    const children = collectChildIndices(events, idx, events);
    for (const childIdx of children) {
      indicesToRemove.add(childIdx);
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
