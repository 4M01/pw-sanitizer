import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TraceEvent } from '../../src/config/types.js';

// Mock the logger — vi.mock is hoisted, so use vi.fn() inline
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Import after mock setup
import { repairTimestamps } from '../../src/remove/timestamp-repair.js';
import { logger } from '../../src/logger.js';

function makeEvent(start: number, end: number, title?: string): TraceEvent {
  return { startTime: start, endTime: end, ...(title != null ? { title } : {}) };
}

describe('repairTimestamps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. absorb-into-prev ────────────────────────────────────────────

  it('absorb-into-prev: adds removed event duration to the preceding event endTime', () => {
    const events: TraceEvent[] = [makeEvent(0, 100), makeEvent(200, 300)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'absorb-into-prev');

    expect(result[0]!.endTime).toBe(200); // 100 + (200 - 100)
    expect(result[1]!.startTime).toBe(200); // unchanged
    expect(result[1]!.endTime).toBe(300); // unchanged
  });

  // ── 2. absorb-into-next ────────────────────────────────────────────

  it('absorb-into-next: subtracts removed event duration from the following event startTime', () => {
    const events: TraceEvent[] = [makeEvent(0, 100), makeEvent(200, 300)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'absorb-into-next');

    expect(result[0]!.endTime).toBe(100); // unchanged
    expect(result[1]!.startTime).toBe(100); // 200 - (200 - 100)
    expect(result[1]!.endTime).toBe(300); // unchanged
  });

  // ── 3. gap ─────────────────────────────────────────────────────────

  it('gap: returns events with no timestamp adjustment', () => {
    const events: TraceEvent[] = [makeEvent(0, 100), makeEvent(200, 300)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'gap');

    expect(result[0]!.startTime).toBe(0);
    expect(result[0]!.endTime).toBe(100);
    expect(result[1]!.startTime).toBe(200);
    expect(result[1]!.endTime).toBe(300);
  });

  // ── 4. absorb-into-prev fallback ───────────────────────────────────

  it('absorb-into-prev with no preceding event falls back to absorb-into-next', () => {
    const events: TraceEvent[] = [makeEvent(200, 300)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'absorb-into-prev');

    expect(result[0]!.startTime).toBe(100); // 200 - 100
    expect(result[0]!.endTime).toBe(300); // unchanged
  });

  // ── 5. absorb-into-next fallback ───────────────────────────────────

  it('absorb-into-next with no following event falls back to absorb-into-prev', () => {
    const events: TraceEvent[] = [makeEvent(0, 100)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'absorb-into-next');

    expect(result[0]!.startTime).toBe(0); // unchanged
    expect(result[0]!.endTime).toBe(200); // 100 + 100
  });

  // ── 6. Empty removedEvents ─────────────────────────────────────────

  it('returns events unchanged when removedEvents is empty', () => {
    const events: TraceEvent[] = [makeEvent(0, 100), makeEvent(200, 300)];

    const result = repairTimestamps(events, [], 'absorb-into-prev');

    expect(result[0]!.startTime).toBe(0);
    expect(result[0]!.endTime).toBe(100);
    expect(result[1]!.startTime).toBe(200);
    expect(result[1]!.endTime).toBe(300);
  });

  // ── 7. Immutability ────────────────────────────────────────────────

  it('returns a new array without mutating the input events', () => {
    const events: TraceEvent[] = [makeEvent(0, 100), makeEvent(200, 300)];
    const removed: TraceEvent[] = [makeEvent(100, 200)];

    const result = repairTimestamps(events, removed, 'absorb-into-prev');

    expect(result).not.toBe(events);
    expect(events[0]!.endTime).toBe(100);
    expect(events[1]!.startTime).toBe(200);
  });

  // ── 8. Warn on startTime > endTime ─────────────────────────────────

  it('warns and corrects endTime when repair produces startTime > endTime', () => {
    const events: TraceEvent[] = [
      makeEvent(500, 200, 'broken-event'), // startTime > endTime
    ];
    const removed: TraceEvent[] = [makeEvent(600, 700)];

    const result = repairTimestamps(events, removed, 'absorb-into-prev');

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('broken-event')
    );

    // The function should correct by setting endTime = startTime
    expect(result[0]!.startTime).toBe(500);
    expect(result[0]!.endTime).toBe(500);
  });
});
