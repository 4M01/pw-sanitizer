import type { TraceEvent, TimestampStrategy } from '../config/types.js';
/**
 * Repairs the event timeline after steps have been removed, so that the total
 * duration reported in the Playwright UI remains coherent.
 *
 * For each removed event, the duration (`endTime - startTime`) that it occupied
 * is redistributed to an adjacent event according to the chosen strategy:
 *
 * - **`'absorb-into-prev'`** *(default)*: the preceding event's `endTime` is
 *   extended by the removed duration. Falls back to shifting the following
 *   event's `startTime` if no preceding event exists.
 * - **`'absorb-into-next'`**: the following event's `startTime` is shifted
 *   back by the removed duration. Falls back to extending the preceding
 *   event if no following event exists.
 * - **`'gap'`**: no adjustment — a visible gap will appear in the timeline.
 *
 * After redistribution, events where `startTime > endTime` are detected and
 * corrected (a warning is emitted for each such case).
 *
 * The input arrays are **never mutated** — a new events array is returned.
 *
 * @param events        - The events array **after** step removal (output of {@link removeSteps}).
 * @param removedEvents - The events that were removed (needed to determine their durations).
 * @param strategy      - The {@link TimestampStrategy} to apply.
 * @returns A new array of events with adjusted timestamps.
 */
export declare function repairTimestamps(events: TraceEvent[], removedEvents: TraceEvent[], strategy: TimestampStrategy): TraceEvent[];
//# sourceMappingURL=timestamp-repair.d.ts.map