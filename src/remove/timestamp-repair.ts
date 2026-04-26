import type { TraceEvent, TimestampStrategy } from '../config/types.js';
import { logger } from '../logger.js';

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
export function repairTimestamps(
  events: TraceEvent[],
  removedEvents: TraceEvent[],
  strategy: TimestampStrategy
): TraceEvent[] {
  if (strategy === 'gap' || removedEvents.length === 0) {
    // No adjustment needed for 'gap' strategy
    return recomputeSuiteTimes(events);
  }

  // Deep clone to ensure immutability
  const result: TraceEvent[] = events.map((e) => ({ ...e }));

  // Process each removed event and adjust surrounding timestamps
  for (const removed of removedEvents) {
    const duration = removed.endTime - removed.startTime;
    if (duration <= 0) continue;

    applyStrategy(result, removed, duration, strategy);
  }

  // Validate: no event should have startTime > endTime
  for (const event of result) {
    if (event.startTime > event.endTime) {
      logger.warn(
        `Timestamp repair created invalid duration for event ` +
        `"${event.title ?? event.action ?? 'unknown'}": ` +
        `startTime (${event.startTime}) > endTime (${event.endTime}). ` +
        `Setting endTime = startTime.`
      );
      event.endTime = event.startTime;
    }
  }

  return recomputeSuiteTimes(result);
}

/**
 * Applies a single timestamp redistribution for one removed event.
 *
 * Mutates the `events` array in place (only called on a cloned copy inside
 * {@link repairTimestamps}).
 *
 * @param events   - Shallow-cloned events array to mutate.
 * @param removed  - The event that was deleted.
 * @param duration - The duration (`endTime - startTime`) of the removed event in ms.
 * @param strategy - Which adjacent event should absorb the duration.
 */
function applyStrategy(
  events: TraceEvent[],
  removed: TraceEvent,
  duration: number,
  strategy: TimestampStrategy
): void {
  if (strategy === 'absorb-into-prev') {
    // Find the event that ended just before or at the removed event's start
    const prev = findPrecedingEvent(events, removed.startTime);
    if (prev) {
      prev.endTime += duration;
    } else {
      // Fallback: absorb into next
      const next = findFollowingEvent(events, removed.endTime);
      if (next) {
        next.startTime -= duration;
      }
    }
  } else if (strategy === 'absorb-into-next') {
    const next = findFollowingEvent(events, removed.endTime);
    if (next) {
      next.startTime -= duration;
    } else {
      // Fallback: absorb into prev
      const prev = findPrecedingEvent(events, removed.startTime);
      if (prev) {
        prev.endTime += duration;
      }
    }
  }
}

/**
 * Finds the event whose `endTime` is closest to (and no greater than) `time`.
 *
 * Used by the `'absorb-into-prev'` strategy to locate the last event that
 * finished at or before the start of the removed event.
 *
 * @param events - The list of remaining events.
 * @param time   - The reference timestamp (`removedEvent.startTime`).
 * @returns The best preceding event, or `undefined` if none qualifies.
 */
function findPrecedingEvent(
  events: TraceEvent[],
  time: number
): TraceEvent | undefined {
  let best: TraceEvent | undefined;
  let bestDiff = Infinity;

  for (const event of events) {
    const diff = time - event.endTime;
    if (diff >= 0 && diff < bestDiff) {
      bestDiff = diff;
      best = event;
    }
  }

  return best;
}

/**
 * Finds the event whose `startTime` is closest to (and no less than) `time`.
 *
 * Used by the `'absorb-into-next'` strategy to locate the first event that
 * starts at or after the end of the removed event.
 *
 * @param events - The list of remaining events.
 * @param time   - The reference timestamp (`removedEvent.endTime`).
 * @returns The best following event, or `undefined` if none qualifies.
 */
function findFollowingEvent(
  events: TraceEvent[],
  time: number
): TraceEvent | undefined {
  let best: TraceEvent | undefined;
  let bestDiff = Infinity;

  for (const event of events) {
    const diff = event.startTime - time;
    if (diff >= 0 && diff < bestDiff) {
      bestDiff = diff;
      best = event;
    }
  }

  return best;
}

/**
 * Placeholder for suite-level timestamp recomputation.
 *
 * Suite-level `startTime` / `endTime` aggregation is handled by the Playwright
 * report viewer from the leaf event timestamps; callers may perform their own
 * recomputation after this function returns.
 *
 * @param events - The events array (returned as-is for empty arrays).
 * @returns The same events array.
 */
function recomputeSuiteTimes(events: TraceEvent[]): TraceEvent[] {
  // Nothing to recompute if empty
  if (events.length === 0) return events;

  // Suite-level times will be recomputed by callers if needed
  return events;
}
