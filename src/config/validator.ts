import type { SanitizerConfig, RedactPattern, RemoveRule } from './types.js';
import { logger } from '../logger.js';

/**
 * Validates that the config is structurally correct and has meaningful content.
 * Throws fatal errors for invalid config — see §15 of the spec.
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

  if (config.remove?.rules) {
    for (const rule of config.remove.rules) {
      validateRule(rule);
    }
  }
}

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
 * Validates a single RedactPattern.
 */
export function validatePattern(pattern: RedactPattern): void {
  if (!pattern.key && !pattern.valuePattern) {
    logger.fatal(
      `Pattern "${pattern.id}" must define at least one of: key, valuePattern`
    );
  }
}

/**
 * Validates a single RemoveRule.
 */
export function validateRule(rule: RemoveRule): void {
  if (!rule.stepName && !rule.selector && !rule.url && !rule.actionType) {
    logger.fatal(
      `Rule "${rule.label}" must define at least one matcher: stepName, selector, url, or actionType`
    );
  }
}
