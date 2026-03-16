import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RemoveRule } from '../config/types.js';
import { logger } from '../logger.js';

export class RuleFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`remove.ruleFiles: file not found: ${filePath}`);
    this.name = 'RuleFileNotFoundError';
  }
}

/**
 * Load remove rules from an external file (.ts, .js, or .json).
 *
 * - .json files are loaded via JSON.parse (no RegExp support; strings matched as substrings)
 * - .ts/.js files are loaded via dynamic import()
 * - If a .ts file fails to import, tries a .js sibling
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
