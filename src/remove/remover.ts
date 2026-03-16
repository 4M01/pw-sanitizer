import type { TraceEvent, RemovalSet } from '../config/types.js';

/**
 * Collects all child event indices (recursively) for a given parent event.
 * Uses callId/parentId relationships to find children.
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
 * Removes matched steps from the events array.
 *
 * - Processes removals in reverse index order so earlier indices stay valid.
 * - Also removes all child steps nested under a removed event.
 * - Returns a new array (never mutates input).
 */
export function removeSteps(
  events: TraceEvent[],
  removalSet: RemovalSet
): TraceEvent[] {
  // Expand removal set to include child indices
  const expandedIndices = new Set<number>(removalSet.indices);

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
