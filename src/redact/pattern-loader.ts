import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RedactPattern } from '../config/types.js';
import { logger } from '../logger.js';

export class PatternFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`redact.patternFiles: file not found: ${filePath}`);
    this.name = 'PatternFileNotFoundError';
  }
}

/**
 * Load redact patterns from an external file (.ts, .js, or .json).
 *
 * - .json files are loaded via JSON.parse (no RegExp support)
 * - .ts/.js files are loaded via dynamic import()
 * - If a .ts file fails to import, tries a .js sibling
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
