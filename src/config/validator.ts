import type { SanitizerConfig, RedactPattern, RemoveRule } from './types.js';
import { logger } from '../logger.js';

/**
 * Validates that the config is structurally correct and has meaningful content.
 *
 * Checks that at least one of `redact` or `remove` contains actionable
 * patterns / rules, then validates each pattern and rule individually.
 * Any violation calls `logger.fatal` which throws immediately.
 *
 * @param config - The {@link SanitizerConfig} to validate.
 * @throws Calls `logger.fatal` (which throws) for any validation failure.
 */
export function validateConfig(config: SanitizerConfig): void {
  const hasRedact = hasRedactContent(config);
  const hasRemove = hasRemoveContent(config);

  if (!hasRedact && !hasRemove) {
    logger.fatal(
      'Config has no redact or remove rules. Nothing to do.'
    );
  }

  if (config.redact?.patterns) {
    for (const pattern of config.redact.patterns) {
      validatePattern(pattern);
    }
  }

  if (config.remove) {
    validateOrphanStrategy(config.remove.orphanStrategy, 'remove.orphanStrategy');
  }

  if (config.remove?.rules) {
    for (const rule of config.remove.rules) {
      validateRule(rule);
    }
  }

  validateOutput(config);
}

/** The only values {@link OrphanStrategy} accepts. */
const VALID_ORPHAN_STRATEGIES = ['remove-children', 'keep-shell'] as const;

/**
 * Validates an `orphanStrategy` value (global or per-rule). `undefined` is
 * always allowed — it means "fall back to the next level of the resolution
 * chain". Any other value that is not one of the two accepted strings is fatal.
 *
 * @param value   - The value to validate (may be `undefined`).
 * @param context - Where the value came from, used in the error message
 *   (e.g. `'remove.orphanStrategy'` or `'rule "timeout noise" orphanStrategy'`).
 * @throws Calls `logger.fatal` (which throws) for an invalid value.
 */
function validateOrphanStrategy(value: unknown, context: string): void {
  if (value === undefined) return;
  if (
    typeof value !== 'string' ||
    !(VALID_ORPHAN_STRATEGIES as readonly string[]).includes(value)
  ) {
    logger.fatal(
      `${context} must be one of ${VALID_ORPHAN_STRATEGIES.map((s) => `'${s}'`).join(
        ' or '
      )}, got ${JSON.stringify(value)}.`
    );
  }
}

/**
 * Validates the `output` section. Currently checks that `traceDir` — which
 * accepts `string | string[]` — only contains non-empty strings.
 *
 * @param config - The config to inspect.
 * @throws Calls `logger.fatal` (which throws) for an invalid `traceDir`.
 */
function validateOutput(config: SanitizerConfig): void {
  const traceDir = config.output?.traceDir;
  if (traceDir === undefined) return;

  const dirs = Array.isArray(traceDir) ? traceDir : [traceDir];
  if (Array.isArray(traceDir) && dirs.length === 0) {
    logger.fatal('output.traceDir must not be an empty array.');
  }
  for (const dir of dirs) {
    if (typeof dir !== 'string' || dir.length === 0) {
      logger.fatal(
        'output.traceDir must be a non-empty string or an array of non-empty strings.'
      );
    }
  }
}

/**
 * Returns `true` if the config's `redact` section contains at least one
 * inline pattern or a reference to an external pattern file.
 *
 * @param config - The config to inspect.
 */
function hasRedactContent(config: SanitizerConfig): boolean {
  if (!config.redact) return false;

  const hasInlinePatterns =
    Array.isArray(config.redact.patterns) && config.redact.patterns.length > 0;

  const hasPatternFiles =
    config.redact.patternFiles !== undefined &&
    (typeof config.redact.patternFiles === 'string'
      ? config.redact.patternFiles.length > 0
      : config.redact.patternFiles.length > 0);

  return hasInlinePatterns || hasPatternFiles;
}

/**
 * Returns `true` if the config's `remove` section contains at least one
 * inline rule or a reference to an external rule file.
 *
 * @param config - The config to inspect.
 */
function hasRemoveContent(config: SanitizerConfig): boolean {
  if (!config.remove) return false;

  const hasInlineRules =
    Array.isArray(config.remove.rules) && config.remove.rules.length > 0;

  const hasRuleFiles =
    config.remove.ruleFiles !== undefined &&
    (typeof config.remove.ruleFiles === 'string'
      ? config.remove.ruleFiles.length > 0
      : config.remove.ruleFiles.length > 0);

  return hasInlineRules || hasRuleFiles;
}

/**
 * Validates a single {@link RedactPattern}.
 *
 * Ensures that at least one of `key` or `valuePattern` is defined — a pattern
 * with neither matcher would match nothing and is almost certainly a mistake.
 *
 * @param pattern - The pattern to validate.
 * @throws Calls `logger.fatal` (which throws) if the pattern has no matchers.
 */
export function validatePattern(pattern: RedactPattern): void {
  if (!pattern.key && !pattern.valuePattern) {
    logger.fatal(
      `Pattern "${pattern.id}" must define at least one of: key, valuePattern`
    );
  }
}

/**
 * Validates a single {@link RemoveRule}.
 *
 * Ensures that at least one matcher field (`stepName`, `selector`, `url`, or
 * `actionType`) is defined — a rule with no matchers would match every step,
 * which is almost certainly unintentional.
 *
 * @param rule - The rule to validate.
 * @throws Calls `logger.fatal` (which throws) if the rule has no matchers.
 */
export function validateRule(rule: RemoveRule): void {
  if (!rule.stepName && !rule.selector && !rule.url && !rule.actionType) {
    logger.fatal(
      `Rule "${rule.label}" must define at least one matcher: stepName, selector, url, or actionType`
    );
  }
  validateOrphanStrategy(rule.orphanStrategy, `rule "${rule.label}" orphanStrategy`);
}
