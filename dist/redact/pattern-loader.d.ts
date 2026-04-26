import type { RedactPattern } from '../config/types.js';
/**
 * Thrown when a pattern file path listed in `redact.patternFiles` cannot be
 * resolved or loaded.
 */
export declare class PatternFileNotFoundError extends Error {
    constructor(filePath: string);
}
/**
 * Loads an array of {@link RedactPattern}s from an external file.
 *
 * Supported formats:
 * - **`.json`** — parsed with `JSON.parse`; RegExp values are not supported
 *   (use string patterns instead, which are matched case-insensitively).
 * - **`.ts` / `.js`** — loaded via dynamic `import()`; the file must export a
 *   default array of {@link RedactPattern} objects (supports `RegExp` fields).
 *   If a `.ts` file fails to import (e.g. no `tsx` / `ts-node` available),
 *   a compiled `.js` sibling at the same path is tried automatically.
 *
 * @param filePath - Absolute or relative path to the pattern file.
 * @returns Array of {@link RedactPattern}s defined in the file.
 * @throws {@link PatternFileNotFoundError} if the file does not exist or cannot be loaded.
 */
export declare function loadPatternFile(filePath: string): Promise<RedactPattern[]>;
//# sourceMappingURL=pattern-loader.d.ts.map