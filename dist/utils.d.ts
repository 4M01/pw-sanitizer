import type { SanitizerConfig } from './config/types.js';
/**
 * Resolves a directory and returns all files matching a glob pattern.
 * Returns an empty array (with an info log) if the directory does not exist.
 *
 * @param dir     - Directory to search in (absolute or relative to `cwd`).
 * @param pattern - Glob pattern relative to `dir` (e.g. `'**\\/*.html'`).
 * @returns Absolute paths of all matching files.
 */
export declare function findFiles(dir: string, pattern: string): Promise<string[]>;
/**
 * Computes the destination path for a sanitized output file.
 *
 * - **`in-place`** / **`side-by-side`**: returns `inputPath` as-is.
 * - **`copy`**: mirrors `inputPath` relative to `sourceDir` into the output directory.
 *
 * @param inputPath - Absolute path to the source file.
 * @param sourceDir - Root directory used to compute the relative path fragment.
 * @param config    - The full sanitizer configuration (read for `output.mode` and `output.dir`).
 * @returns The computed output path.
 */
export declare function computeOutputPath(inputPath: string, sourceDir: string, config: SanitizerConfig): string;
/**
 * Writes sanitized content to disk according to the configured output mode.
 *
 * - **`in-place`**: overwrites the original file at `inputPath`.
 * - **`side-by-side`**: writes `<basename>.sanitized<ext>` next to the original.
 * - **`copy`** *(default)*: mirrors the file into `outputPath`, creating parent dirs as needed.
 *
 * @param inputPath  - Absolute path to the original file (used for `in-place` and `side-by-side`).
 * @param outputPath - Computed destination path (used for `copy` mode).
 * @param content    - The sanitized string or Buffer to write.
 * @param config     - The full sanitizer configuration (read for `output.mode`).
 */
export declare function writeOutput(inputPath: string, outputPath: string, content: string | Buffer, config: SanitizerConfig): void;
//# sourceMappingURL=utils.d.ts.map