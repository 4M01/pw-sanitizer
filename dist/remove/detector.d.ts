import type { TraceEvent, RemoveRule, RemovalSet } from '../config/types.js';
/**
 * Identifies all trace events that should be removed based on user-declared rules.
 *
 * Matching semantics:
 * - **Within a rule**: all provided matchers must match (AND logic).
 * - **Across rules**: any matching rule makes an event a removal candidate (OR logic).
 * - **No automatic detection**: zero built-in heuristics; only explicitly declared rules apply.
 *
 * `minConsecutiveOccurrences` safety guard:
 * If a rule declares this threshold, each consecutive run of matching events is
 * evaluated against it. Runs that are *shorter* than the threshold are **skipped**
 * (not removed) and a warning is emitted. This prevents accidentally deleting
 * one-off occurrences of a step that also appears in noisy repeating sequences.
 *
 * @param events - The flat ordered list of trace events to scan.
 * @param rules  - The user-declared removal rules to apply.
 * @returns A {@link RemovalSet} containing the indices and match details of every
 *   event selected for removal.
 */
export declare function findStepsToRemove(events: TraceEvent[], rules: RemoveRule[]): RemovalSet;
//# sourceMappingURL=detector.d.ts.map