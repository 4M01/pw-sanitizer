"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatternFileNotFoundError = void 0;
exports.loadPatternFile = loadPatternFile;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const logger_js_1 = require("../logger.js");
/**
 * Thrown when a pattern file path listed in `redact.patternFiles` cannot be
 * resolved or loaded.
 */
class PatternFileNotFoundError extends Error {
    constructor(filePath) {
        super(`redact.patternFiles: file not found: ${filePath}`);
        this.name = 'PatternFileNotFoundError';
    }
}
exports.PatternFileNotFoundError = PatternFileNotFoundError;
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
async function loadPatternFile(filePath) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new PatternFileNotFoundError(filePath);
    }
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.json') {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            logger_js_1.logger.fatal(`Pattern file ${filePath} must export an array of RedactPattern objects.`);
        }
        return parsed;
    }
    // .ts or .js — dynamic import
    try {
        const module = await import(absolutePath);
        const patterns = module.default ?? module;
        if (!Array.isArray(patterns)) {
            logger_js_1.logger.fatal(`Pattern file ${filePath} must export a default array of RedactPattern objects.`);
        }
        return patterns;
    }
    catch (err) {
        // If .ts file failed, try .js sibling
        if (ext === '.ts') {
            const jsSibling = absolutePath.replace(/\.ts$/, '.js');
            if (fs.existsSync(jsSibling)) {
                try {
                    const module = await import(jsSibling);
                    const patterns = module.default ?? module;
                    if (!Array.isArray(patterns)) {
                        logger_js_1.logger.fatal(`Pattern file ${jsSibling} must export a default array of RedactPattern objects.`);
                    }
                    return patterns;
                }
                catch {
                    throw new PatternFileNotFoundError(`Failed to load pattern file from both ${filePath} and ${jsSibling}`);
                }
            }
        }
        throw new PatternFileNotFoundError(`Failed to load pattern file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=pattern-loader.js.map