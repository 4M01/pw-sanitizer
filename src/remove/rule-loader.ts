import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RemoveRule } from '../config/types.js';
import { logger } from '../logger.js';

/**
 * Thrown when a rule file path listed in `remove.ruleFiles` cannot be
 * resolved or loaded.
 */
export class RuleFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`remove.ruleFiles: file not found: ${filePath}`);
    this.name = 'RuleFileNotFoundError';
  }
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
export async function loadRuleFile(filePath: string): Promise<RemoveRule[]> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new RuleFileNotFoundError(filePath);
  }

  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.json') {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const parsed = JSON.parse(content) as RemoveRule[];
    if (!Array.isArray(parsed)) {
      logger.fatal(`Rule file ${filePath} must export an array of RemoveRule objects.`);
    }
    return parsed;
  }

  // .ts or .js — dynamic import
  try {
    const module = await import(absolutePath);
    const rules = module.default ?? module;
    if (!Array.isArray(rules)) {
      logger.fatal(`Rule file ${filePath} must export a default array of RemoveRule objects.`);
    }
    return rules as RemoveRule[];
  } catch (err) {
    if (ext === '.ts') {
      const jsSibling = absolutePath.replace(/\.ts$/, '.js');
      if (fs.existsSync(jsSibling)) {
        try {
          const module = await import(jsSibling);
          const rules = module.default ?? module;
          if (!Array.isArray(rules)) {
            logger.fatal(`Rule file ${jsSibling} must export a default array of RemoveRule objects.`);
          }
          return rules as RemoveRule[];
        } catch {
          throw new RuleFileNotFoundError(
            `Failed to load rule file from both ${filePath} and ${jsSibling}`
          );
        }
      }
    }

    throw new RuleFileNotFoundError(
      `Failed to load rule file ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
