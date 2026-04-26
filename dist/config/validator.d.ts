import type { SanitizerConfig, RedactPattern, RemoveRule } from './types.js';
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
export declare function validateConfig(config: SanitizerConfig): void;
/**
 * Validates a single {@link RedactPattern}.
 *
 * Ensures that at least one of `key` or `valuePattern` is defined — a pattern
 * with neither matcher would match nothing and is almost certainly a mistake.
 *
 * @param pattern - The pattern to validate.
 * @throws Calls `logger.fatal` (which throws) if the pattern has no matchers.
 */
export declare function validatePattern(pattern: RedactPattern): void;
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
export declare function validateRule(rule: RemoveRule): void;
//# sourceMappingURL=validator.d.ts.map