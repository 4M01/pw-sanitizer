import type { RemoveRule } from '../config/types.js';
/**
 * Thrown when a rule file path listed in `remove.ruleFiles` cannot be
 * resolved or loaded.
 */
export declare class RuleFileNotFoundError extends Error {
    constructor(filePath: string);
}
/**
 * Loads an array of {@link RemoveRule}s from an external file.
 *
 * Supported formats:
 * - **`.json`** — parsed with `JSON.parse`; RegExp values are not supported.
 *   String matchers are evaluated as case-sensitive substring matches.
 * - **`.ts` / `.js`** — loaded via dynamic `import()`; the file must export a
 *   default array of {@link RemoveRule} objects (supports `RegExp` fields).
 *   If a `.ts` file fails to import (e.g. no `tsx` / `ts-node` available),
 *   a compiled `.js` sibling at the same path is tried automatically.
 *
 * @param filePath - Absolute or relative path to the rule file.
 * @returns Array of {@link RemoveRule}s defined in the file.
 * @throws {@link RuleFileNotFoundError} if the file does not exist or cannot be loaded.
 */
export declare function loadRuleFile(filePath: string): Promise<RemoveRule[]>;
//# sourceMappingURL=rule-loader.d.ts.map