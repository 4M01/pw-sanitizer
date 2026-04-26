import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RedactPattern } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Thrown when a pattern file path listed in `redact.patternFiles` cannot be
 * resolved or loaded.
 */
export class PatternFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`redact.patternFiles: file not found: ${filePath}`);
    this.name = 'PatternFileNotFoundError';
  }
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
export async function loadPatternFile(filePath: string): Promise<RedactPattern[]> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new PatternFileNotFoundError(filePath);
  }

  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.json') {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const parsed = JSON.parse(content) as RedactPattern[];
    if (!Array.isArray(parsed)) {
      logger.fatal(`Pattern file ${filePath} must export an array of RedactPattern objects.`);
    }
    return parsed;
  }

  // .ts or .js — dynamic import
  try {
    const module = await import(absolutePath);
    const patterns = module.default ?? module;
    if (!Array.isArray(patterns)) {
      logger.fatal(`Pattern file ${filePath} must export a default array of RedactPattern objects.`);
    }
    return patterns as RedactPattern[];
  } catch (err) {
    // If .ts file failed, try .js sibling
    if (ext === '.ts') {
      const jsSibling = absolutePath.replace(/\.ts$/, '.js');
      if (fs.existsSync(jsSibling)) {
        try {
          const module = await import(jsSibling);
          const patterns = module.default ?? module;
          if (!Array.isArray(patterns)) {
            logger.fatal(`Pattern file ${jsSibling} must export a default array of RedactPattern objects.`);
          }
          return patterns as RedactPattern[];
        } catch {
          throw new PatternFileNotFoundError(
            `Failed to load pattern file from both ${filePath} and ${jsSibling}`
          );
        }
      }
    }

    throw new PatternFileNotFoundError(
      `Failed to load pattern file ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
