import type { RemoveConfig, RemoveRule } from '../config/types.js';
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
export declare function buildRuleRegistry(config: RemoveConfig): Promise<RemoveRule[]>;
//# sourceMappingURL=rule-registry.d.ts.map