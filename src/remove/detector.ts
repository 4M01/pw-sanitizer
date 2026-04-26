import type { TraceEvent, RemoveRule, RemovalSet, StepMatch } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Tests whether an event field value satisfies a rule matcher.
 *
 * - `string` matcher → case-sensitive substring match (compatible with JSON-sourced rules).
 * - `RegExp` matcher → tested against the value string.
 * - Either argument being `undefined` → returns `false` immediately.
 *
 * @param value   - The event field value to test (may be `undefined` if the field is absent).
 * @param matcher - The rule matcher from a {@link RemoveRule} field (may be `undefined` if not set).
 * @returns `true` if the matcher is defined, the value is defined, and the value satisfies the matcher.
 */
function matchesField(
  value: string | undefined,
  matcher: string | RegExp | undefined
): boolean {
  if (matcher === undefined || value === undefined) return false;

  if (typeof matcher === 'string') {
    // Substring match for compatibility with JSON rule files
    return value.includes(matcher);
  }
  return matcher.test(value);
}

/**
 * Tests whether a single {@link TraceEvent} satisfies a {@link RemoveRule}.
 *
 * Each matcher field on the rule (`stepName`, `selector`, `url`, `actionType`)
 * is compared against the corresponding event field(s). Only matchers that are
 * explicitly set on the rule are evaluated — unset matchers are ignored.
 * **All active matchers must match** (AND logic); a rule with no matchers never matches.
 *
 * Field mapping:
 * - `rule.stepName` → `event.title ?? event.action ?? event.method`
 * - `rule.selector` → `event.selector`
 * - `rule.url`      → `event.url`
 * - `rule.actionType` → `event.actionType ?? event.type`
 *
 * @param event - The trace event to test.
 * @param rule  - The removal rule to test against.
 * @returns `true` if all active matchers on the rule match the event.
 */
function eventMatchesRule(event: TraceEvent, rule: RemoveRule): boolean {
  const matchers: Array<{ eventValue: string | undefined; ruleValue: string | RegExp | undefined }> = [
    { eventValue: event.title ?? event.action ?? event.method, ruleValue: rule.stepName },
    { eventValue: event.selector, ruleValue: rule.selector },
    { eventValue: event.url, ruleValue: rule.url },
    { eventValue: event.actionType ?? event.type, ruleValue: rule.actionType },
  ];

  // Only consider matchers that are defined on the rule
  const activeMatchers = matchers.filter((m) => m.ruleValue !== undefined);

  if (activeMatchers.length === 0) return false;

  // ALL active matchers must match (AND logic)
  return activeMatchers.every((m) => matchesField(m.eventValue, m.ruleValue));
}

/**
 * Partitions the event list into contiguous runs where every event matches the rule.
 *
 * A "run" is a maximal sequence of consecutive indices where each event satisfies
 * `eventMatchesRule`. Runs are separated by at least one non-matching event.
 * Used to enforce {@link RemoveRule.minConsecutiveOccurrences}.
 *
 * @param events - The flat ordered list of trace events.
 * @param rule   - The rule to match against each event.
 * @returns An array of runs; each run is an array of matching event indices.
 */
function findConsecutiveRuns(
  events: TraceEvent[],
  rule: RemoveRule
): number[][] {
  const runs: number[][] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (eventMatchesRule(event, rule)) {
      currentRun.push(i);
    } else {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
  }

  // Don't forget the last run
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  return runs;
}

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
export function findStepsToRemove(
  events: TraceEvent[],
  rules: RemoveRule[]
): RemovalSet {
  const indices = new Set<number>();
  const matches: StepMatch[] = [];

  for (const rule of rules) {
    if (rule.minConsecutiveOccurrences !== undefined) {
      // Use consecutive-run logic
      const runs = findConsecutiveRuns(events, rule);

      for (const run of runs) {
        if (run.length >= rule.minConsecutiveOccurrences) {
          // Threshold met — remove all events in this run
          for (const idx of run) {
            indices.add(idx);
            matches.push({
              index: idx,
              ruleLabel: rule.label,
              event: events[idx]!,
            });
          }
        } else {
          // Threshold NOT met — warn and skip this entire run
          logger.warn(
            `Rule "${rule.label}" matched ${run.length} consecutive occurrences ` +
            `but minConsecutiveOccurrences is ${rule.minConsecutiveOccurrences}. ` +
            `Skipping removal. Review your rule.`
          );
        }
      }
    } else {
      // No consecutive guard — remove every single match
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (eventMatchesRule(event, rule)) {
          indices.add(i);
          matches.push({
            index: i,
            ruleLabel: rule.label,
            event,
          });
        }
      }
    }
  }

  return { indices, matches };
}
