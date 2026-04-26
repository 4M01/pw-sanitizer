"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPatternRegistry = buildPatternRegistry;
const pattern_loader_js_1 = require("./pattern-loader.js");
const validator_js_1 = require("../config/validator.js");
const logger_js_1 = require("../logger.js");
/**
 * Builds the complete, deduplicated list of {@link RedactPattern}s for a run.
 *
 * Merge order:
 * 1. All patterns loaded from `config.patternFiles` (in declaration order)
 * 2. Inline patterns from `config.patterns`
 *
 * No built-in patterns are ever injected — only what the user explicitly declared.
 * If the same `id` appears more than once, a warning is emitted and the **last**
 * definition wins (last-write-wins semantics).
 *
 * @param config - The `redact` section of the sanitizer config.
 * @returns Deduplicated array of validated {@link RedactPattern}s, ready for use.
 */
async function buildPatternRegistry(config) {
    const allPatterns = [];
    // Load from pattern files first
    if (config.patternFiles) {
        const files = Array.isArray(config.patternFiles)
            ? config.patternFiles
            : [config.patternFiles];
        for (const filePath of files) {
            const patterns = await (0, pattern_loader_js_1.loadPatternFile)(filePath);
            allPatterns.push(...patterns);
        }
    }
    // Then inline patterns
    if (config.patterns) {
        allPatterns.push(...config.patterns);
    }
    // Validate each pattern
    for (const pattern of allPatterns) {
        (0, validator_js_1.validatePattern)(pattern);
    }
    // Check for duplicate IDs and warn
    const seenIds = new Map();
    for (let i = 0; i < allPatterns.length; i++) {
        const pattern = allPatterns[i];
        const previousIndex = seenIds.get(pattern.id);
        if (previousIndex !== undefined) {
            logger_js_1.logger.warn(`Duplicate pattern id "${pattern.id}" — last definition wins (index ${i} replaces ${previousIndex}).`);
        }
        seenIds.set(pattern.id, i);
    }
    // Deduplicate: last-write-wins
    const deduped = new Map();
    for (const pattern of allPatterns) {
        deduped.set(pattern.id, pattern);
    }
    return Array.from(deduped.values());
}
//# sourceMappingURL=pattern-registry.js.map