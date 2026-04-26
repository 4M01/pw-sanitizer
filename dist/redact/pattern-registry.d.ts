import type { RedactConfig, RedactPattern } from '../config/types.js';
/**
 * Builds the complete, deduplicated list of {@link RedactPattern}s for a run.
 *
 * Merge order:
 * 1. All patterns loaded from `config.patternFiles` (in declaration order)
 * 2. Inline patterns from `config.patterns`
 *
 * No built-in patterns are ever injected — only what the user explicitly declared.
 * If the same `id` appears more than once, a warning is emitted and the **last**
 * definition wins (last-write-wins semantics).
 *
 * @param config - The `redact` section of the sanitizer config.
 * @returns Deduplicated array of validated {@link RedactPattern}s, ready for use.
 */
export declare function buildPatternRegistry(config: RedactConfig): Promise<RedactPattern[]>;
//# sourceMappingURL=pattern-registry.d.ts.map