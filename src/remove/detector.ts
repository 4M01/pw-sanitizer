import type { TraceEvent, RemoveRule, RemovalSet, StepMatch } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Tests whether a string value matches a rule matcher field.
 *
 * - String matcher: case-sensitive substring match (for JSON-sourced rules)
 *   or exact match depending on context
 * - RegExp matcher: tested against the value
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
 * Tests whether a single event matches a rule.
 * ALL provided matchers within a rule must match (AND logic).
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
 * Finds runs of consecutive matching events for a given rule.
 * Returns an array of runs, where each run is an array of event indices.
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
 * Finds all steps that should be removed based on user-declared rules.
 *
 * ONLY matches against user-declared rules — zero automatic detection.
 *
 * Within a single rule: ALL provided matchers must match (AND logic).
 * Across different rules: any rule matching makes an event a candidate (OR logic).
 *
 * Implements minConsecutiveOccurrences safety guard:
 * - If a run of consecutive matches is shorter than the threshold, emits a WARN
 *   and excludes ALL events in that run from RemovalSet.
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
