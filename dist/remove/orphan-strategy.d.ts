import type { OrphanStrategy, RemoveRule } from '../config/types.js';
/**
 * Resolves the effective {@link OrphanStrategy} for a single matched step.
 *
 * A step may be matched by more than one {@link RemoveRule}. Each contributing
 * rule resolves to a strategy via the chain:
 *
 * ```
 * rule.orphanStrategy ?? globalDefault ?? 'remove-children'
 * ```
 *
 * The results are combined with a **most-destructive-wins** policy: if any
 * contributing rule resolves to `'remove-children'`, the step is removed
 * entirely (children and self); `'keep-shell'` only applies when *every*
 * contributing rule resolves to `'keep-shell'`. When both strategies are
 * present the outcome is flagged as a `conflict` so the caller can log it.
 *
 * @param rules         - The rules that matched this step. May be empty (e.g.
 *   a descendant reached by expansion), in which case the global default (or
 *   `'remove-children'`) is used.
 * @param globalDefault - `remove.orphanStrategy`, or `undefined` if unset.
 * @returns The resolved `strategy` and whether the contributing rules
 *   disagreed (`conflict`).
 */
export declare function resolveOrphanStrategy(rules: RemoveRule[], globalDefault: OrphanStrategy | undefined): {
    strategy: OrphanStrategy;
    conflict: boolean;
};
//# sourceMappingURL=orphan-strategy.d.ts.map