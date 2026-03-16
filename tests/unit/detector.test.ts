import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findStepsToRemove } from '../../src/remove/detector.js';
import type { TraceEvent, RemoveRule } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helper: create a minimal TraceEvent with sensible defaults
// ---------------------------------------------------------------------------
function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    startTime: 0,
    endTime: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findStepsToRemove', () => {
  // -----------------------------------------------------------------------
  // 1. AND logic within a single rule
  // -----------------------------------------------------------------------
  describe('AND logic within a single rule', () => {
    const rule: RemoveRule = {
      label: 'api-health-navigation',
      url: '/api/health',
      actionType: 'navigation',
    };

    it('matches events where ALL rule fields match', () => {
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health', actionType: 'navigation' }),
      ];

      const result = findStepsToRemove(events, [rule]);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.ruleLabel).toBe('api-health-navigation');
    });

    it('does NOT match when only url matches but actionType does not', () => {
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health', actionType: 'click' }),
      ];

      const result = findStepsToRemove(events, [rule]);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('does NOT match when only actionType matches but url does not', () => {
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/dashboard', actionType: 'navigation' }),
      ];

      const result = findStepsToRemove(events, [rule]);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('does NOT match when neither field matches', () => {
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/dashboard', actionType: 'click' }),
      ];

      const result = findStepsToRemove(events, [rule]);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. OR logic across rules
  // -----------------------------------------------------------------------
  describe('OR logic across rules', () => {
    it('includes events matching any one of the provided rules', () => {
      const rules: RemoveRule[] = [
        { label: 'health-check', url: '/api/health' },
        { label: 'click-action', actionType: 'click' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health', actionType: 'navigation' }),
        makeEvent({ url: 'https://example.com/dashboard', actionType: 'click' }),
        makeEvent({ url: 'https://example.com/about', actionType: 'navigation' }),
      ];

      const result = findStepsToRemove(events, rules);

      // Event 0 matches 'health-check', event 1 matches 'click-action'
      expect(result.indices.size).toBe(2);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(true);
      expect(result.indices.has(2)).toBe(false);
    });

    it('an event matching multiple rules appears once in indices but once per rule in matches', () => {
      const rules: RemoveRule[] = [
        { label: 'rule-a', url: '/api/health' },
        { label: 'rule-b', actionType: 'navigation' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health', actionType: 'navigation' }),
      ];

      const result = findStepsToRemove(events, rules);

      // Index set deduplicates
      expect(result.indices.size).toBe(1);
      // Both rules generate a match entry
      expect(result.matches).toHaveLength(2);
      expect(result.matches.map((m) => m.ruleLabel)).toContain('rule-a');
      expect(result.matches.map((m) => m.ruleLabel)).toContain('rule-b');
    });
  });

  // -----------------------------------------------------------------------
  // 3. String matcher uses substring match
  // -----------------------------------------------------------------------
  describe('string matcher — substring match', () => {
    it('matches when the event url contains the rule url substring', () => {
      const rules: RemoveRule[] = [
        { label: 'health-substring', url: '/api/health' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health' }),
        makeEvent({ url: 'https://example.com/api/health?check=true' }),
        makeEvent({ url: 'https://other.io/v2/api/health/ping' }),
        makeEvent({ url: 'https://example.com/dashboard' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(3);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(true);
      expect(result.indices.has(2)).toBe(true);
      expect(result.indices.has(3)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. RegExp matcher
  // -----------------------------------------------------------------------
  describe('RegExp matcher', () => {
    it('url regex anchored to end matches correctly', () => {
      const rules: RemoveRule[] = [
        { label: 'health-regex', url: /\/api\/health$/ },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/api/health' }),          // match
        makeEvent({ url: 'https://example.com/api/health?q=1' }),      // no match (query string)
        makeEvent({ url: 'https://example.com/api/health/ping' }),     // no match (extra path)
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(false);
      expect(result.indices.has(2)).toBe(false);
    });

    it('actionType regex matches', () => {
      const rules: RemoveRule[] = [
        { label: 'nav-types', actionType: /^nav/ },
      ];

      const events: TraceEvent[] = [
        makeEvent({ actionType: 'navigation' }),
        makeEvent({ actionType: 'navigate' }),
        makeEvent({ actionType: 'click' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(2);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(true);
      expect(result.indices.has(2)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. minConsecutiveOccurrences — threshold MET
  // -----------------------------------------------------------------------
  describe('minConsecutiveOccurrences — threshold MET', () => {
    it('removes all events in a consecutive run that meets the threshold', () => {
      const rules: RemoveRule[] = [
        { label: 'polling', url: '/api/poll', minConsecutiveOccurrences: 4 },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://app.com/api/poll', startTime: 0, endTime: 1 }),
        makeEvent({ url: 'https://app.com/api/poll', startTime: 1, endTime: 2 }),
        makeEvent({ url: 'https://app.com/api/poll', startTime: 2, endTime: 3 }),
        makeEvent({ url: 'https://app.com/api/poll', startTime: 3, endTime: 4 }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(4);
      expect(result.matches).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(result.indices.has(i)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 6. minConsecutiveOccurrences — threshold NOT MET (warning logged)
  // -----------------------------------------------------------------------
  describe('minConsecutiveOccurrences — threshold NOT MET', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('removes nothing and logs a warning when consecutive count is below threshold', () => {
      const rules: RemoveRule[] = [
        { label: 'polling', url: '/api/poll', minConsecutiveOccurrences: 4 },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://app.com/api/poll', startTime: 0, endTime: 1 }),
        makeEvent({ url: 'https://app.com/api/poll', startTime: 1, endTime: 2 }),
        // Only 2 consecutive — below the threshold of 4
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);

      // logger.warn calls console.warn with a [WARN] prefix
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0]![0] as string;
      expect(warnMessage).toContain('polling');
      expect(warnMessage).toContain('2 consecutive');
      expect(warnMessage).toContain('minConsecutiveOccurrences is 4');
    });
  });

  // -----------------------------------------------------------------------
  // 7. minConsecutiveOccurrences — multiple runs
  // -----------------------------------------------------------------------
  describe('minConsecutiveOccurrences — multiple runs', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('only removes the run that meets the threshold; skips the short run with a warning', () => {
      const rules: RemoveRule[] = [
        { label: 'polling', url: '/api/poll', minConsecutiveOccurrences: 4 },
      ];

      // Run 1: 5 consecutive (indices 0-4) — meets threshold
      // Non-matching event at index 5
      // Run 2: 2 consecutive (indices 6-7) — below threshold
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://app.com/api/poll', startTime: 0, endTime: 1 }),   // 0
        makeEvent({ url: 'https://app.com/api/poll', startTime: 1, endTime: 2 }),   // 1
        makeEvent({ url: 'https://app.com/api/poll', startTime: 2, endTime: 3 }),   // 2
        makeEvent({ url: 'https://app.com/api/poll', startTime: 3, endTime: 4 }),   // 3
        makeEvent({ url: 'https://app.com/api/poll', startTime: 4, endTime: 5 }),   // 4
        makeEvent({ url: 'https://app.com/other', startTime: 5, endTime: 6 }),      // 5 — break
        makeEvent({ url: 'https://app.com/api/poll', startTime: 6, endTime: 7 }),   // 6
        makeEvent({ url: 'https://app.com/api/poll', startTime: 7, endTime: 8 }),   // 7
      ];

      const result = findStepsToRemove(events, rules);

      // Only the first run of 5 should be removed
      expect(result.indices.size).toBe(5);
      for (let i = 0; i <= 4; i++) {
        expect(result.indices.has(i)).toBe(true);
      }
      // The break event and second run should NOT be removed
      expect(result.indices.has(5)).toBe(false);
      expect(result.indices.has(6)).toBe(false);
      expect(result.indices.has(7)).toBe(false);

      expect(result.matches).toHaveLength(5);

      // A warning should have been logged for the short run
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0]![0] as string;
      expect(warnMessage).toContain('2 consecutive');
    });
  });

  // -----------------------------------------------------------------------
  // 8. No rules = empty RemovalSet
  // -----------------------------------------------------------------------
  describe('no rules', () => {
    it('returns an empty RemovalSet when no rules are provided', () => {
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/page', actionType: 'navigation' }),
        makeEvent({ url: 'https://example.com/other', actionType: 'click' }),
      ];

      const result = findStepsToRemove(events, []);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 9. No matching events = empty RemovalSet (no false positives)
  // -----------------------------------------------------------------------
  describe('no matching events', () => {
    it('returns an empty RemovalSet when no events match the rules', () => {
      const rules: RemoveRule[] = [
        { label: 'never-matches', url: '/api/nonexistent-endpoint' },
        { label: 'also-never', actionType: 'teleport' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com/page', actionType: 'navigation' }),
        makeEvent({ url: 'https://example.com/other', actionType: 'click' }),
        makeEvent({ url: 'https://example.com/form', actionType: 'fill' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 10. stepName matcher matches against event.title or event.action
  // -----------------------------------------------------------------------
  describe('stepName matcher', () => {
    it('matches against event.title with a string matcher', () => {
      const rules: RemoveRule[] = [
        { label: 'click-button', stepName: 'Click' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ title: 'Click "Submit"' }),
        makeEvent({ title: 'Fill username' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(false);
    });

    it('matches against event.action when event.title is undefined', () => {
      const rules: RemoveRule[] = [
        { label: 'goto-action', stepName: 'goto' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ action: 'goto', url: 'https://example.com' }),
        makeEvent({ action: 'click' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
    });

    it('prefers event.title over event.action when both are present', () => {
      const rules: RemoveRule[] = [
        { label: 'by-title', stepName: 'Navigate' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ title: 'Navigate to page', action: 'goto' }),
        makeEvent({ title: 'Fill form', action: 'Navigate' }),
      ];

      const result = findStepsToRemove(events, rules);

      // Only event 0 should match because title takes precedence via ??
      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      // Event 1 has title 'Fill form' which doesn't contain 'Navigate',
      // even though action is 'Navigate'
      expect(result.indices.has(1)).toBe(false);
    });

    it('falls back to event.method when title and action are both undefined', () => {
      const rules: RemoveRule[] = [
        { label: 'method-match', stepName: 'evaluateExpression' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ method: 'evaluateExpression' }),
        makeEvent({ method: 'waitForSelector' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
    });

    it('matches stepName with a RegExp', () => {
      const rules: RemoveRule[] = [
        { label: 'click-regex', stepName: /^Click\s/ },
      ];

      const events: TraceEvent[] = [
        makeEvent({ title: 'Click "Submit"' }),
        makeEvent({ title: 'Double Click "Item"' }),
        makeEvent({ title: 'Click' }),  // no space after Click
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(false);
      expect(result.indices.has(2)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 11. selector matcher matches against event.selector
  // -----------------------------------------------------------------------
  describe('selector matcher', () => {
    it('matches against event.selector with a string matcher (substring)', () => {
      const rules: RemoveRule[] = [
        { label: 'submit-button', selector: '#submit' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ selector: '#submit', title: 'Click "Submit"' }),
        makeEvent({ selector: '#submit-btn', title: 'Click "Submit Button"' }),
        makeEvent({ selector: '#cancel', title: 'Click "Cancel"' }),
      ];

      const result = findStepsToRemove(events, rules);

      // Both #submit and #submit-btn contain '#submit' as substring
      expect(result.indices.size).toBe(2);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(true);
      expect(result.indices.has(2)).toBe(false);
    });

    it('matches against event.selector with a RegExp matcher', () => {
      const rules: RemoveRule[] = [
        { label: 'exact-submit', selector: /^#submit$/ },
      ];

      const events: TraceEvent[] = [
        makeEvent({ selector: '#submit' }),
        makeEvent({ selector: '#submit-btn' }),
        makeEvent({ selector: 'button#submit' }),
      ];

      const result = findStepsToRemove(events, rules);

      // Only exact match
      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
      expect(result.indices.has(1)).toBe(false);
      expect(result.indices.has(2)).toBe(false);
    });

    it('does not match when event has no selector', () => {
      const rules: RemoveRule[] = [
        { label: 'needs-selector', selector: '#submit' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com' }),  // no selector
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('empty events array returns an empty RemovalSet', () => {
      const rules: RemoveRule[] = [
        { label: 'any-rule', url: '/anything' },
      ];

      const result = findStepsToRemove([], rules);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('rule with no matcher fields matches nothing', () => {
      const rules: RemoveRule[] = [
        { label: 'empty-rule' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ url: 'https://example.com', actionType: 'click', title: 'Click' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('match entries reference the correct event objects', () => {
      const rules: RemoveRule[] = [
        { label: 'check-ref', url: '/target' },
      ];

      const targetEvent = makeEvent({ url: 'https://app.com/target', startTime: 42, endTime: 99 });
      const events: TraceEvent[] = [
        makeEvent({ url: 'https://app.com/other' }),
        targetEvent,
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.index).toBe(1);
      expect(result.matches[0]!.event).toBe(targetEvent);
      expect(result.matches[0]!.event.startTime).toBe(42);
    });

    it('actionType falls back to event.type when event.actionType is undefined', () => {
      const rules: RemoveRule[] = [
        { label: 'type-fallback', actionType: 'frame-snapshot' },
      ];

      const events: TraceEvent[] = [
        makeEvent({ type: 'frame-snapshot' }),
        makeEvent({ type: 'action', actionType: 'click' }),
      ];

      const result = findStepsToRemove(events, rules);

      expect(result.indices.size).toBe(1);
      expect(result.indices.has(0)).toBe(true);
    });
  });
});
