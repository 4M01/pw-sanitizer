import { describe, it, expect } from 'vitest';
import { removeSteps } from '../../src/remove/remover.js';
import type { TraceEvent, RemovalSet } from '../../src/config/types.js';

/** Helper to create a minimal TraceEvent with required fields. */
function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return { startTime: 0, endTime: 1, ...overrides };
}

describe('removeSteps', () => {
  it('removes events at specified indices and returns a new array', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'a' }),
      makeEvent({ title: 'b' }),
      makeEvent({ title: 'c' }),
    ];

    const removalSet: RemovalSet = {
      indices: new Set([1]),
      matches: [{ index: 1, ruleLabel: 'test', event: events[1] }],
    };

    const result = removeSteps(events, removalSet);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('a');
    expect(result[1].title).toBe('c');
    expect(result).not.toBe(events);
  });

  it('does not mutate the original events array', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'a' }),
      makeEvent({ title: 'b' }),
      makeEvent({ title: 'c' }),
    ];

    const originalLength = events.length;
    const originalTitles = events.map((e) => e.title);

    const removalSet: RemovalSet = {
      indices: new Set([1]),
      matches: [{ index: 1, ruleLabel: 'test', event: events[1] }],
    };

    removeSteps(events, removalSet);

    expect(events).toHaveLength(originalLength);
    expect(events.map((e) => e.title)).toEqual(originalTitles);
  });

  it('handles reverse-order processing when removing indices [1, 3] from a 5-element array', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'e0' }),
      makeEvent({ title: 'e1' }),
      makeEvent({ title: 'e2' }),
      makeEvent({ title: 'e3' }),
      makeEvent({ title: 'e4' }),
    ];

    const removalSet: RemovalSet = {
      indices: new Set([1, 3]),
      matches: [
        { index: 1, ruleLabel: 'rule-a', event: events[1] },
        { index: 3, ruleLabel: 'rule-b', event: events[3] },
      ],
    };

    const result = removeSteps(events, removalSet);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.title)).toEqual(['e0', 'e2', 'e4']);
  });

  it('removes child steps when a parent step is removed (callId/parentId relationship)', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'step0' }),
      makeEvent({ title: 'step1' }),
      makeEvent({ title: 'parent', callId: 'c2' }),   // index 2
      makeEvent({ title: 'step3' }),
      makeEvent({ title: 'child', parentId: 'c2' }),   // index 4, child of index 2
    ];

    const removalSet: RemovalSet = {
      indices: new Set([2]),
      matches: [{ index: 2, ruleLabel: 'remove-parent', event: events[2] }],
    };

    const result = removeSteps(events, removalSet);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.title)).toEqual(['step0', 'step1', 'step3']);
    expect(result.some((e) => e.callId === 'c2')).toBe(false);
    expect(result.some((e) => e.parentId === 'c2')).toBe(false);
  });

  it('returns a copy of the original array when removal set is empty', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'a' }),
      makeEvent({ title: 'b' }),
    ];

    const removalSet: RemovalSet = {
      indices: new Set(),
      matches: [],
    };

    const result = removeSteps(events, removalSet);

    expect(result).toEqual(events);
    expect(result).not.toBe(events);
  });

  it('returns an empty array when all events are removed', () => {
    const events: TraceEvent[] = [
      makeEvent({ title: 'a' }),
      makeEvent({ title: 'b' }),
      makeEvent({ title: 'c' }),
    ];

    const removalSet: RemovalSet = {
      indices: new Set([0, 1, 2]),
      matches: [
        { index: 0, ruleLabel: 'rule', event: events[0] },
        { index: 1, ruleLabel: 'rule', event: events[1] },
        { index: 2, ruleLabel: 'rule', event: events[2] },
      ],
      safetyGuardWarnings: [],
    };

    const result = removeSteps(events, removalSet);

    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  // ── orphanStrategy: 'keep-shell' ──────────────────────────────────────────

  describe("orphanStrategy: 'keep-shell'", () => {
    it('keeps the matched parent event and removes only its children', () => {
      const events: TraceEvent[] = [
        makeEvent({ title: 'unrelated' }),
        makeEvent({ title: 'parent', callId: 'p1' }),      // index 1 — matched
        makeEvent({ title: 'child-a', parentId: 'p1' }),   // index 2 — should be removed
        makeEvent({ title: 'child-b', parentId: 'p1' }),   // index 3 — should be removed
        makeEvent({ title: 'sibling' }),
      ];

      const removalSet: RemovalSet = {
        indices: new Set([1]),
        matches: [{ index: 1, ruleLabel: 'rule', event: events[1]! }],
        safetyGuardWarnings: [],
      };

      const result = removeSteps(events, removalSet, 'keep-shell');

      // Parent is kept, children removed, unrelated events untouched
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.title)).toEqual(['unrelated', 'parent', 'sibling']);
    });

    it('returns the matched event with no children when it has none', () => {
      const events: TraceEvent[] = [
        makeEvent({ title: 'a' }),
        makeEvent({ title: 'b', callId: 'b1' }),  // matched, but no children
        makeEvent({ title: 'c' }),
      ];

      const removalSet: RemovalSet = {
        indices: new Set([1]),
        matches: [{ index: 1, ruleLabel: 'rule', event: events[1]! }],
        safetyGuardWarnings: [],
      };

      const result = removeSteps(events, removalSet, 'keep-shell');

      // Nothing to remove — all 3 events survive
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.title)).toEqual(['a', 'b', 'c']);
    });

    it('removes grandchildren transitively in keep-shell mode', () => {
      const events: TraceEvent[] = [
        makeEvent({ title: 'parent', callId: 'p1' }),       // index 0 — matched
        makeEvent({ title: 'child', parentId: 'p1', callId: 'c1' }), // index 1
        makeEvent({ title: 'grandchild', parentId: 'c1' }), // index 2
      ];

      const removalSet: RemovalSet = {
        indices: new Set([0]),
        matches: [{ index: 0, ruleLabel: 'rule', event: events[0]! }],
        safetyGuardWarnings: [],
      };

      const result = removeSteps(events, removalSet, 'keep-shell');

      // Parent kept, child and grandchild removed
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe('parent');
    });

    it('does not mutate the original events array', () => {
      const events: TraceEvent[] = [
        makeEvent({ title: 'parent', callId: 'p1' }),
        makeEvent({ title: 'child', parentId: 'p1' }),
      ];
      const originalLength = events.length;

      const removalSet: RemovalSet = {
        indices: new Set([0]),
        matches: [{ index: 0, ruleLabel: 'rule', event: events[0]! }],
        safetyGuardWarnings: [],
      };

      removeSteps(events, removalSet, 'keep-shell');

      expect(events).toHaveLength(originalLength);
    });

    it('behaves identically to remove-children when matched event has no children', () => {
      const events: TraceEvent[] = [
        makeEvent({ title: 'a' }),
        makeEvent({ title: 'b' }),
        makeEvent({ title: 'c' }),
      ];

      const removalSet: RemovalSet = {
        indices: new Set([1]),
        matches: [{ index: 1, ruleLabel: 'rule', event: events[1]! }],
        safetyGuardWarnings: [],
      };

      const keepShell = removeSteps(events, removalSet, 'keep-shell');
      // keep-shell: parent has no children, so nothing is removed
      expect(keepShell.map((e) => e.title)).toEqual(['a', 'b', 'c']);

      const removeChildren = removeSteps(events, removalSet, 'remove-children');
      // remove-children: parent itself is removed
      expect(removeChildren.map((e) => e.title)).toEqual(['a', 'c']);
    });
  });
});
