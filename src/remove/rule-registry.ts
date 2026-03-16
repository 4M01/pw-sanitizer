import type { RemoveConfig, RemoveRule } from '../config/types.js';
import { loadRuleFile } from './rule-loader.js';
import { validateRule } from '../config/validator.js';
import { logger } from '../logger.js';

/**
 * Builds the full list of remove rules by merging:
 * 1. All rules from ruleFiles (in order)
 * 2. Inline rules from config.rules
 *
 * No built-in rules are added. Only what the user declared.
 * Warns on duplicate `label` values (last-write-wins).
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
