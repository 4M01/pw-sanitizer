import type { TraceEvent, RemovalSet, OrphanStrategy } from '../config/types.js';
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
export declare function removeSteps(events: TraceEvent[], removalSet: RemovalSet, orphanStrategy?: OrphanStrategy | ((index: number) => OrphanStrategy)): TraceEvent[];
//# sourceMappingURL=remover.d.ts.map