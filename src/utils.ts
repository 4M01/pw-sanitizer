import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { SanitizerConfig } from './config/types.js';
import { logger } from './logger.js';

/**
 * Resolves a directory and returns all files matching a glob pattern.
 * Returns an empty array (with an info log) if the directory does not exist.
 *
 * @param dir     - Directory to search in (absolute or relative to `cwd`).
 * @param pattern - Glob pattern relative to `dir` (e.g. `'**\\/*.html'`).
 * @returns Absolute paths of all matching files.
 */
export async function findFiles(dir: string, pattern: string): Promise<string[]> {
  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) {
    logger.info(`Directory not found: ${resolvedDir}`);
    return [];
  }

  return glob(pattern, { cwd: resolvedDir, absolute: true });
}

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
export function computeOutputPath(
  inputPath: string,
  sourceDir: string,
  config: SanitizerConfig
): string {
  const mode = config.output?.mode ?? 'copy';

  if (mode === 'in-place' || mode === 'side-by-side') {
    return inputPath;
  }

  const outputDir = config.output?.dir ?? './sanitized-report';
  const relative = path.relative(path.resolve(sourceDir), inputPath);
  return path.resolve(outputDir, relative);
}

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
export function writeOutput(
  inputPath: string,
  outputPath: string,
  content: string | Buffer,
  config: SanitizerConfig
): void {
  const mode = config.output?.mode ?? 'copy';

  if (mode === 'in-place') {
    fs.writeFileSync(inputPath, content);
    logger.verbose(`Wrote in-place: ${inputPath}`);
  } else if (mode === 'side-by-side') {
    const ext = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length);
    const sidePath = `${base}.sanitized${ext}`;
    fs.writeFileSync(sidePath, content);
    logger.verbose(`Wrote side-by-side: ${sidePath}`);
  } else {
    // 'copy' mode
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, content);
    logger.verbose(`Wrote copy: ${outputPath}`);
  }
}
