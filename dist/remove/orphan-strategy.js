"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOrphanStrategy = resolveOrphanStrategy;
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
function resolveOrphanStrategy(rules, globalDefault) {
    const fallback = globalDefault ?? 'remove-children';
    if (rules.length === 0) {
        return { strategy: fallback, conflict: false };
    }
    const strategies = new Set();
    for (const rule of rules) {
        strategies.add(rule.orphanStrategy ?? fallback);
    }
    const conflict = strategies.has('remove-children') && strategies.has('keep-shell');
    // Most destructive wins.
    const strategy = strategies.has('remove-children')
        ? 'remove-children'
        : 'keep-shell';
    return { strategy, conflict };
}
//# sourceMappingURL=orphan-strategy.js.map