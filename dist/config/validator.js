"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConfig = validateConfig;
exports.validatePattern = validatePattern;
exports.validateRule = validateRule;
const logger_js_1 = require("../logger.js");
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
function validateConfig(config) {
    const hasRedact = hasRedactContent(config);
    const hasRemove = hasRemoveContent(config);
    if (!hasRedact && !hasRemove) {
        logger_js_1.logger.fatal('Config has no redact or remove rules. Nothing to do.');
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
/**
 * Returns `true` if the config's `redact` section contains at least one
 * inline pattern or a reference to an external pattern file.
 *
 * @param config - The config to inspect.
 */
function hasRedactContent(config) {
    if (!config.redact)
        return false;
    const hasInlinePatterns = Array.isArray(config.redact.patterns) && config.redact.patterns.length > 0;
    const hasPatternFiles = config.redact.patternFiles !== undefined &&
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
function hasRemoveContent(config) {
    if (!config.remove)
        return false;
    const hasInlineRules = Array.isArray(config.remove.rules) && config.remove.rules.length > 0;
    const hasRuleFiles = config.remove.ruleFiles !== undefined &&
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
function validatePattern(pattern) {
    if (!pattern.key && !pattern.valuePattern) {
        logger_js_1.logger.fatal(`Pattern "${pattern.id}" must define at least one of: key, valuePattern`);
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
function validateRule(rule) {
    if (!rule.stepName && !rule.selector && !rule.url && !rule.actionType) {
        logger_js_1.logger.fatal(`Rule "${rule.label}" must define at least one matcher: stepName, selector, url, or actionType`);
    }
}
//# sourceMappingURL=validator.js.map