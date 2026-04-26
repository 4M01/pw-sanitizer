import type { TraceEvent, RemovalSet } from '../config/types.js';
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
export declare function removeSteps(events: TraceEvent[], removalSet: RemovalSet): TraceEvent[];
//# sourceMappingURL=remover.d.ts.map