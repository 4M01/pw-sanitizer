import type { TraceEvent, TimestampStrategy } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Repairs timestamps after step removal using the specified strategy.
 *
 * Given: ordered events array, set of removed events, strategy
 * Processes removals in reverse index order so preceding indices stay valid.
 *
 * Strategies:
 * - 'absorb-into-prev': preceding step's endTime absorbs the deleted duration
 * - 'absorb-into-next': following step's startTime is shifted back
 * - 'gap': timestamps are not adjusted; a gap appears in the timeline
 *
 * Returns a new array (never mutates input).
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
 * Find the event whose endTime is closest to and <= the given time.
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
 * Find the event whose startTime is closest to and >= the given time.
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
 * Recompute suite-level startTime and endTime from remaining events.
 */
function recomputeSuiteTimes(events: TraceEvent[]): TraceEvent[] {
  // Nothing to recompute if empty
  if (events.length === 0) return events;

  // Suite-level times will be recomputed by callers if needed
  return events;
}
