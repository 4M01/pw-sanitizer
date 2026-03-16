// ─────────────────────────────────────────────
// Top-level config
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// redact section
// ─────────────────────────────────────────────

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
   * Default: '[REDACTED]'
   */
  placeholder?: string;

  /**
   * Partial redaction: keep first N and last N characters, replace middle with '***'.
   * Example: { prefix: 4, suffix: 4 } on 'Bearer eyJhbGci...' -> 'Bear***..ci'
   * When set, takes priority over `placeholder` for string values.
   */
  partialRedaction?: { prefix: number; suffix: number };
}

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
   * String values are matched case-insensitively as exact matches.
   * RegExp values are tested against the key.
   * At least one of `key` or `valuePattern` must be provided.
   */
  key?: string | RegExp;

  /**
   * Match against the field value. When provided alongside `key`,
   * BOTH must match for redaction to apply (AND logic).
   */
  valuePattern?: RegExp;

  /**
   * Severity level — informational only, used for filtering in summary output.
   * Does not affect whether redaction runs.
   */
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

// ─────────────────────────────────────────────
// remove section
// ─────────────────────────────────────────────

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
   * 'absorb-into-prev' (default): preceding step's endTime absorbs the deleted duration.
   * 'absorb-into-next': following step's startTime is shifted back.
   * 'gap': timestamps are not adjusted; a gap appears in the timeline.
   */
  timestampStrategy?: TimestampStrategy;

  /**
   * When true: log what would be removed per rule, but do not write any files.
   * Default: false
   */
  dryRun?: boolean;

  /**
   * What to do with child steps when a parent step is removed.
   * 'remove-children' (default): also remove all children.
   * 'keep-shell': keep the parent as a no-op container.
   */
  orphanStrategy?: 'remove-children' | 'keep-shell';
}

export type TimestampStrategy = 'absorb-into-prev' | 'absorb-into-next' | 'gap';

export interface RemoveRule {
  /**
   * REQUIRED. Human-readable label for this rule.
   * Used in summary output, dry-run logs, and safety-guard warnings.
   */
  label: string;

  /**
   * Match against the step/action name as shown in the HTML report.
   */
  stepName?: string | RegExp;

  /**
   * Match against the CSS selector or XPath locator of a UI step.
   */
  selector?: string | RegExp;

  /**
   * Match against the URL of a network request step.
   */
  url?: string | RegExp;

  /**
   * Match against the Playwright internal action type from trace.json.
   */
  actionType?: string | RegExp;

  /**
   * SAFETY GUARD — not an auto-detector.
   *
   * Only remove a matching step if it appears at least this many times
   * consecutively in a row within a test. If the actual consecutive count
   * is below this threshold, the tool does NOT remove and instead logs a warning.
   */
  minConsecutiveOccurrences?: number;
}

// ─────────────────────────────────────────────
// output section
// ─────────────────────────────────────────────

export interface OutputConfig {
  /** Directory containing Playwright HTML report files. Default: './playwright-report' */
  reportDir?: string;

  /** Directory containing Playwright test result trace files. Default: './test-results' */
  traceDir?: string;

  /**
   * Output mode.
   * 'copy' (default): write sanitized files to dir, originals untouched.
   * 'in-place': overwrite original files.
   * 'side-by-side': write '<name>.sanitized.<ext>' next to each original.
   */
  mode?: 'copy' | 'in-place' | 'side-by-side';

  /** Destination directory when mode is 'copy'. Default: './sanitized-report' */
  dir?: string;

  /** Whether to process HTML reports. Default: true */
  processReports?: boolean;

  /** Whether to process trace .zip files. Default: true */
  processTraces?: boolean;

  /**
   * Whether to attempt screenshot redaction in traces.
   * Requires 'sharp' peer dependency.
   * Default: false
   */
  redactScreenshots?: boolean;
}

// ─────────────────────────────────────────────
// reporting section
// ─────────────────────────────────────────────

export interface ReportingConfig {
  /** Print a summary table after processing. Default: true */
  summary?: boolean;

  /** Write summary as JSON to this file path. Optional. */
  summaryFile?: string;

  /** Log level. Default: 'normal' */
  logLevel?: 'silent' | 'normal' | 'verbose';
}

// ─────────────────────────────────────────────
// Internal types used across modules
// ─────────────────────────────────────────────

export interface TraceEvent {
  type?: string;
  action?: string;
  method?: string;
  params?: Record<string, unknown>;
  startTime: number;
  endTime: number;
  title?: string;
  selector?: string;
  url?: string;
  actionType?: string;
  parentId?: string;
  callId?: string;
  children?: TraceEvent[];
  requestId?: string;
  [key: string]: unknown;
}

export interface RedactionResult {
  redacted: boolean;
  value: string;
  matchedPatternId?: string;
}

export interface RedactionMatch {
  keyPath: string;
  patternId: string;
}

export interface WalkResult {
  result: unknown;
  count: number;
  matches: RedactionMatch[];
}

export interface StepMatch {
  index: number;
  ruleLabel: string;
  event: TraceEvent;
}

export interface RemovalSet {
  indices: Set<number>;
  matches: StepMatch[];
}

export interface ProcessResult {
  file: string;
  redactionsApplied: number;
  stepsRemoved: number;
  timestampRepairs: number;
  redactionMatches: RedactionMatch[];
  removalMatches: StepMatch[];
}

export interface SanitizationSummary {
  processedAt: string;
  filesProcessed: { reports: number; traces: number };
  redact: {
    patternsLoaded: number;
    totalOccurrencesReplaced: number;
    byPatternId: Record<string, number>;
  };
  remove: {
    rulesLoaded: number;
    totalStepsDeleted: number;
    timestampRepairs: number;
    timestampStrategy: string;
    byRuleLabel: Array<{ label: string; count: number; files: number }>;
    safetyGuardWarnings: string[];
  };
  output: { mode: string; dir: string };
}
