import type { RedactConfig, RedactPattern } from '../config/types.js';
import { loadPatternFile } from './pattern-loader.js';
import { validatePattern } from '../config/validator.js';
import { logger } from '../logger.js';

/**
 * Builds the full list of redact patterns by merging:
 * 1. All patterns from patternFiles (in order)
 * 2. Inline patterns from config.patterns
 *
 * No built-in patterns are added. Only what the user declared.
 * Warns on duplicate `id` values (last-write-wins).
 */
export async function buildPatternRegistry(
  config: RedactConfig
): Promise<RedactPattern[]> {
  const allPatterns: RedactPattern[] = [];

  // Load from pattern files first
  if (config.patternFiles) {
    const files = Array.isArray(config.patternFiles)
      ? config.patternFiles
      : [config.patternFiles];

    for (const filePath of files) {
      const patterns = await loadPatternFile(filePath);
      allPatterns.push(...patterns);
    }
  }

  // Then inline patterns
  if (config.patterns) {
    allPatterns.push(...config.patterns);
  }

  // Validate each pattern
  for (const pattern of allPatterns) {
    validatePattern(pattern);
  }

  // Check for duplicate IDs and warn
  const seenIds = new Map<string, number>();
  for (let i = 0; i < allPatterns.length; i++) {
    const pattern = allPatterns[i]!;
    const previousIndex = seenIds.get(pattern.id);
    if (previousIndex !== undefined) {
      logger.warn(
        `Duplicate pattern id "${pattern.id}" — last definition wins (index ${i} replaces ${previousIndex}).`
      );
    }
    seenIds.set(pattern.id, i);
  }

  // Deduplicate: last-write-wins
  const deduped = new Map<string, RedactPattern>();
  for (const pattern of allPatterns) {
    deduped.set(pattern.id, pattern);
  }

  return Array.from(deduped.values());
}
