import type { RemoveConfig, RemoveRule } from '../config/types.js';
import { loadRuleFile } from './rule-loader.js';
import { validateRule } from '../config/validator.js';
import { logger } from '../logger.js';

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
export async function buildRuleRegistry(
  config: RemoveConfig
): Promise<RemoveRule[]> {
  const allRules: RemoveRule[] = [];

  // Load from rule files first
  if (config.ruleFiles) {
    const files = Array.isArray(config.ruleFiles)
      ? config.ruleFiles
      : [config.ruleFiles];

    for (const filePath of files) {
      const rules = await loadRuleFile(filePath);
      allRules.push(...rules);
    }
  }

  // Then inline rules
  if (config.rules) {
    allRules.push(...config.rules);
  }

  // Validate each rule
  for (const rule of allRules) {
    validateRule(rule);
  }

  // Check for duplicate labels and warn
  const seenLabels = new Map<string, number>();
  for (let i = 0; i < allRules.length; i++) {
    const rule = allRules[i]!;
    const previousIndex = seenLabels.get(rule.label);
    if (previousIndex !== undefined) {
      logger.warn(
        `Duplicate rule label "${rule.label}" — last definition wins (index ${i} replaces ${previousIndex}).`
      );
    }
    seenLabels.set(rule.label, i);
  }

  // Deduplicate: last-write-wins
  const deduped = new Map<string, RemoveRule>();
  for (const rule of allRules) {
    deduped.set(rule.label, rule);
  }

  return Array.from(deduped.values());
}
