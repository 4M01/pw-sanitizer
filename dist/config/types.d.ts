/**
 * Root configuration object for `playwright-sanitizer`.
 *
 * All sections are optional — omitting a section disables that feature entirely.
 * Nothing is redacted or removed unless explicitly declared here.
 *
 * @example
 * ```ts
 * // playwright-sanitizer.config.ts
 * import type { SanitizerConfig } from 'playwright-sanitizer';
 *
 * const config: SanitizerConfig = {
 *   redact: {
 *     patterns: [{ id: 'auth-header', key: 'authorization' }],
 *   },
 *   remove: {
 *     rules: [{ label: 'noisy-poll', stepName: /waitFor/ }],
 *   },
 * };
 *
 * export default config;
 * ```
 */
export interface SanitizerConfig {
    /**
     * Declares what values to mask.
     * Nothing is redacted unless explicitly listed here.
     */
    redact?: RedactConfig;
    /**
     * Declares which steps to delete entirely.
     * Nothing is removed unless explicitly listed here.
     */
    remove?: RemoveConfig;
    /** Output behaviour */
    output?: OutputConfig;
    /** Summary and logging */
    reporting?: ReportingConfig;
}
/**
 * Configuration for the redaction pipeline.
 *
 * Patterns are loaded from `patternFiles` first, then merged with inline
 * `patterns`. Duplicate IDs result in a warning; the last definition wins.
 */
export interface RedactConfig {
    /**
     * Path(s) to external pattern files (.ts, .js, .json).
     * Merged with inline `patterns`. No built-in patterns apply.
     */
    patternFiles?: string | string[];
    /**
     * Inline pattern definitions. Merged with patternFiles.
     * These are the only patterns that will ever be applied.
     */
    patterns?: RedactPattern[];
    /**
     * Replacement string for redacted values.
     * Default: `'[REDACTED]'`
     */
    placeholder?: string;
    /**
     * Partial redaction: keep first `prefix` and last `suffix` characters,
     * replace the middle with `'***'`.
     *
     * @example
     * With `{ prefix: 4, suffix: 4 }`:
     * `'Bearer eyJhbGci...'` → `'Bear***..ci'`
     *
     * When set, takes priority over `placeholder` for string values.
     * If the value is too short to apply partial redaction, it is fully redacted.
     */
    partialRedaction?: {
        prefix: number;
        suffix: number;
    };
}
/**
 * A single secret-matching rule used by the redaction pipeline.
 *
 * At least one of {@link key} or {@link valuePattern} must be provided.
 * When both are provided, **both** must match for redaction to apply (AND logic).
 *
 * @example
 * ```ts
 * // Redact any field named "authorization" regardless of value
 * { id: 'auth-header', key: 'authorization' }
 *
 * // Redact any field whose value looks like a Bearer token
 * { id: 'bearer-token', valuePattern: /^Bearer\s+\S+$/ }
 *
 * // Redact only when both match
 * { id: 'api-key', key: /^x-api-key$/i, valuePattern: /^[A-Za-z0-9]{32,}$/ }
 * ```
 */
export interface RedactPattern {
    /**
     * REQUIRED. Unique identifier for this pattern.
     * Used in summary output, warnings, and the dry-run log.
     */
    id: string;
    /** Optional human-readable description of why this is being redacted. */
    description?: string;
    /**
     * Match against the field/key name (header name, body property, query param name).
     *
     * - `string`: exact case-insensitive match
     * - `RegExp`: tested against the key string
     *
     * At least one of `key` or {@link valuePattern} must be provided.
     */
    key?: string | RegExp;
    /**
     * Match against the field value. When provided alongside {@link key},
     * **both** must match for redaction to apply (AND logic).
     */
    valuePattern?: RegExp;
    /**
     * Severity level — informational only, used for filtering in summary output.
     * Does not affect whether redaction runs.
     */
    severity?: 'low' | 'medium' | 'high' | 'critical';
}
/**
 * Configuration for the step-removal pipeline.
 *
 * Rules are loaded from `ruleFiles` first, then merged with inline `rules`.
 * Duplicate labels result in a warning; the last definition wins.
 */
export interface RemoveConfig {
    /**
     * Path(s) to external step rule files (.ts, .js, .json).
     * Merged with inline `rules`. No built-in rules apply.
     */
    ruleFiles?: string | string[];
    /**
     * Inline step removal rules. Merged with ruleFiles.
     * These are the only rules that will ever be applied.
     */
    rules?: RemoveRule[];
    /**
     * How to redistribute time after a step is deleted.
     *
     * - `'absorb-into-prev'` *(default)*: the preceding step's `endTime` absorbs the deleted duration.
     * - `'absorb-into-next'`: the following step's `startTime` is shifted back.
     * - `'gap'`: timestamps are not adjusted; a visible gap appears in the timeline.
     */
    timestampStrategy?: TimestampStrategy;
    /**
     * When `true`: log what would be removed per rule, but do not write any files.
     * Default: `false`
     */
    dryRun?: boolean;
    /**
     * What to do with child steps when a parent step is removed.
     *
     * - `'remove-children'` *(default)*: also remove all descendant steps.
     * - `'keep-shell'`: keep the parent as a no-op container without its children.
     */
    orphanStrategy?: 'remove-children' | 'keep-shell';
}
/**
 * Controls how the timestamp timeline is repaired after step removal.
 *
 * @see {@link RemoveConfig.timestampStrategy}
 */
export type TimestampStrategy = 'absorb-into-prev' | 'absorb-into-next' | 'gap';
/**
 * A single step-matching rule used by the removal pipeline.
 *
 * At least one of {@link stepName}, {@link selector}, {@link url}, or
 * {@link actionType} must be provided. When multiple matchers are set,
 * **all** must match (AND logic) for a step to be removed.
 *
 * @example
 * ```ts
 * // Remove all "waitForTimeout" steps
 * { label: 'timeouts', stepName: /waitForTimeout/ }
 *
 * // Remove network requests to a specific polling endpoint
 * { label: 'health-poll', url: /\/api\/health$/, actionType: 'route' }
 *
 * // Safety guard: only remove if seen 5+ times consecutively
 * { label: 'scroll-noise', actionType: 'scroll', minConsecutiveOccurrences: 5 }
 * ```
 */
export interface RemoveRule {
    /**
     * REQUIRED. Human-readable label for this rule.
     * Used in summary output, dry-run logs, and safety-guard warnings.
     */
    label: string;
    /**
     * Match against the step/action name as shown in the HTML report.
     *
     * - `string`: case-sensitive substring match
     * - `RegExp`: tested against the step title, action, or method name
     */
    stepName?: string | RegExp;
    /**
     * Match against the CSS selector or XPath locator of a UI step.
     *
     * - `string`: case-sensitive substring match
     * - `RegExp`: tested against the selector string
     */
    selector?: string | RegExp;
    /**
     * Match against the URL of a network request step.
     *
     * - `string`: case-sensitive substring match
     * - `RegExp`: tested against the URL string
     */
    url?: string | RegExp;
    /**
     * Match against the Playwright internal action type from `trace.json`
     * (e.g. `'click'`, `'fill'`, `'route'`, `'waitForSelector'`).
     *
     * - `string`: case-sensitive substring match
     * - `RegExp`: tested against the action type string
     */
    actionType?: string | RegExp;
    /**
     * **SAFETY GUARD** — not an automatic detection threshold.
     *
     * Only remove a matching step if it appears **at least this many times
     * consecutively** within a single test run. If the actual consecutive count
     * is below this threshold, the tool **skips removal** and emits a warning.
     *
     * Use this to protect against accidentally removing legitimate one-off
     * occurrences of a step that also appears in noisy repeating sequences.
     */
    minConsecutiveOccurrences?: number;
}
/**
 * Controls where sanitized files are written and which file types are processed.
 */
export interface OutputConfig {
    /** Directory containing Playwright HTML report files. Default: `'./playwright-report'` */
    reportDir?: string;
    /** Directory containing Playwright test result trace files. Default: `'./test-results'` */
    traceDir?: string;
    /**
     * Output mode.
     *
     * - `'copy'` *(default)*: write sanitized files to {@link dir}, originals untouched.
     * - `'in-place'`: overwrite original files (**destructive** — ensure version control).
     * - `'side-by-side'`: write `<name>.sanitized.<ext>` next to each original.
     */
    mode?: 'copy' | 'in-place' | 'side-by-side';
    /** Destination directory when {@link mode} is `'copy'`. Default: `'./sanitized-report'` */
    dir?: string;
    /** Whether to process HTML reports. Default: `true` */
    processReports?: boolean;
    /** Whether to process trace `.zip` files. Default: `true` */
    processTraces?: boolean;
    /**
     * Whether to attempt screenshot redaction in trace files.
     * Requires the optional `sharp` peer dependency.
     * Default: `false`
     */
    redactScreenshots?: boolean;
}
/**
 * Controls summary output and log verbosity.
 */
export interface ReportingConfig {
    /** Print a summary table to stdout after processing. Default: `true` */
    summary?: boolean;
    /** Write the summary as JSON to this file path. Optional. */
    summaryFile?: string;
    /**
     * Log verbosity level.
     *
     * - `'silent'` — no output at all
     * - `'normal'` — info, warnings, and errors (default)
     * - `'verbose'` — everything including per-step traces
     */
    logLevel?: 'silent' | 'normal' | 'verbose';
}
/**
 * A single event entry from a Playwright `trace.json` or HTML report step list.
 *
 * Fields are a superset of what Playwright may emit — not all fields are present
 * on every event type. Extra fields are preserved via the index signature.
 */
export interface TraceEvent {
    /** Playwright internal event type (e.g. `'action'`, `'event'`). */
    type?: string;
    /** Human-readable action name (e.g. `'click'`, `'fill'`). */
    action?: string;
    /** API method name for protocol-level events. */
    method?: string;
    /** Arbitrary parameters attached to the event. */
    params?: Record<string, unknown>;
    /** Unix timestamp (ms) when the event started. */
    startTime: number;
    /** Unix timestamp (ms) when the event ended. */
    endTime: number;
    /** Display title shown in the Playwright report UI. */
    title?: string;
    /** CSS selector or XPath locator targeted by the action. */
    selector?: string;
    /** URL associated with a network request step. */
    url?: string;
    /** Playwright action type string used for internal classification. */
    actionType?: string;
    /** `callId` of the parent step, used to reconstruct the tree hierarchy. */
    parentId?: string;
    /** Unique identifier for this step within the trace. */
    callId?: string;
    /** Nested child steps (tree representation). */
    children?: TraceEvent[];
    /** Network request ID, used to correlate trace steps with `network.json` entries. */
    requestId?: string;
    /** Catch-all for any additional fields Playwright may add. */
    [key: string]: unknown;
}
/**
 * Result of attempting to redact a single string value.
 */
export interface RedactionResult {
    /** `true` if a pattern matched and the value was replaced. */
    redacted: boolean;
    /** The (potentially replaced) value. Equal to the input when `redacted` is `false`. */
    value: string;
    /** ID of the pattern that triggered redaction. `undefined` when `redacted` is `false`. */
    matchedPatternId?: string;
}
/**
 * Records where a redaction occurred within the JSON tree.
 */
export interface RedactionMatch {
    /** Dot-notation path to the redacted field (e.g. `'request.headers.authorization'`). */
    keyPath: string;
    /** ID of the {@link RedactPattern} that matched. */
    patternId: string;
}
/**
 * Aggregated result from a full `walkAndRedact` traversal.
 */
export interface WalkResult {
    /** The transformed JSON tree (new object, input is never mutated). */
    result: unknown;
    /** Total number of individual values that were redacted. */
    count: number;
    /** Detailed list of every redaction that occurred. */
    matches: RedactionMatch[];
}
/**
 * A single step that was matched by a removal rule.
 */
export interface StepMatch {
    /** Zero-based index of the step in the flat events array. */
    index: number;
    /** Label of the {@link RemoveRule} that matched this step. */
    ruleLabel: string;
    /** The matched {@link TraceEvent} object. */
    event: TraceEvent;
}
/**
 * The set of steps identified for removal across all rules.
 */
export interface RemovalSet {
    /** Deduplicated set of event indices to remove. */
    indices: Set<number>;
    /** Detailed list of every match (one entry per step per rule). */
    matches: StepMatch[];
}
/**
 * Processing result for a single file (HTML report or trace `.zip`).
 */
export interface ProcessResult {
    /** Absolute path of the input file. */
    file: string;
    /** Number of individual value redactions applied. */
    redactionsApplied: number;
    /** Number of top-level steps removed (children excluded from count). */
    stepsRemoved: number;
    /** Number of timestamp adjustments made after step removal. */
    timestampRepairs: number;
    /** Detailed list of every redaction match. */
    redactionMatches: RedactionMatch[];
    /** Detailed list of every step-removal match. */
    removalMatches: StepMatch[];
}
/**
 * Aggregated statistics produced after processing all files.
 * Returned by {@link generateSummary} and optionally written to disk as JSON.
 */
export interface SanitizationSummary {
    /** ISO-8601 timestamp of when processing completed. */
    processedAt: string;
    /** Count of HTML reports and trace files processed. */
    filesProcessed: {
        reports: number;
        traces: number;
    };
    /** Redaction statistics. */
    redact: {
        /** Number of distinct patterns that were loaded. */
        patternsLoaded: number;
        /** Total number of value occurrences replaced across all files. */
        totalOccurrencesReplaced: number;
        /** Per-pattern occurrence counts, keyed by pattern `id`. */
        byPatternId: Record<string, number>;
    };
    /** Step-removal statistics. */
    remove: {
        /** Number of distinct rules that were loaded. */
        rulesLoaded: number;
        /** Total number of steps deleted across all files. */
        totalStepsDeleted: number;
        /** Number of timestamp adjustments applied. */
        timestampRepairs: number;
        /** The {@link TimestampStrategy} that was used. */
        timestampStrategy: string;
        /** Per-rule removal counts. */
        byRuleLabel: Array<{
            label: string;
            count: number;
            files: number;
        }>;
        /** Safety-guard warning messages emitted during processing. */
        safetyGuardWarnings: string[];
    };
    /** Output mode and destination directory. */
    output: {
        mode: string;
        dir: string;
    };
}
//# sourceMappingURL=types.d.ts.map