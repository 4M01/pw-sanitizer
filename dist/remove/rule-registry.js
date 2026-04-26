"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRuleRegistry = buildRuleRegistry;
const rule_loader_js_1 = require("./rule-loader.js");
const validator_js_1 = require("../config/validator.js");
const logger_js_1 = require("../logger.js");
/**
 * Builds the complete, deduplicated list of {@link RemoveRule}s for a run.
 *
 * Merge order:
 * 1. All rules loaded from `config.ruleFiles` (in declaration order)
 * 2. Inline rules from `config.rules`
 *
 * No built-in rules are ever injected — only what the user explicitly declared.
 * If the same `label` appears more than once, a warning is emitted and the **last**
 * definition wins (last-write-wins semantics).
 *
 * @param config - The `remove` section of the sanitizer config.
 * @returns Deduplicated array of validated {@link RemoveRule}s, ready for use.
 */
async function buildRuleRegistry(config) {
    const allRules = [];
    // Load from rule files first
    if (config.ruleFiles) {
        const files = Array.isArray(config.ruleFiles)
            ? config.ruleFiles
            : [config.ruleFiles];
        for (const filePath of files) {
            const rules = await (0, rule_loader_js_1.loadRuleFile)(filePath);
            allRules.push(...rules);
        }
    }
    // Then inline rules
    if (config.rules) {
        allRules.push(...config.rules);
    }
    // Validate each rule
    for (const rule of allRules) {
        (0, validator_js_1.validateRule)(rule);
    }
    // Check for duplicate labels and warn
    const seenLabels = new Map();
    for (let i = 0; i < allRules.length; i++) {
        const rule = allRules[i];
        const previousIndex = seenLabels.get(rule.label);
        if (previousIndex !== undefined) {
            logger_js_1.logger.warn(`Duplicate rule label "${rule.label}" — last definition wins (index ${i} replaces ${previousIndex}).`);
        }
        seenLabels.set(rule.label, i);
    }
    // Deduplicate: last-write-wins
    const deduped = new Map();
    for (const rule of allRules) {
        deduped.set(rule.label, rule);
    }
    return Array.from(deduped.values());
}
//# sourceMappingURL=rule-registry.js.map