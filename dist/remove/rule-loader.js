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
exports.RuleFileNotFoundError = void 0;
exports.loadRuleFile = loadRuleFile;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const logger_js_1 = require("../logger.js");
/**
 * Thrown when a rule file path listed in `remove.ruleFiles` cannot be
 * resolved or loaded.
 */
class RuleFileNotFoundError extends Error {
    constructor(filePath) {
        super(`remove.ruleFiles: file not found: ${filePath}`);
        this.name = 'RuleFileNotFoundError';
    }
}
exports.RuleFileNotFoundError = RuleFileNotFoundError;
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
async function loadRuleFile(filePath) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new RuleFileNotFoundError(filePath);
    }
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.json') {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            logger_js_1.logger.fatal(`Rule file ${filePath} must export an array of RemoveRule objects.`);
        }
        return parsed;
    }
    // .ts or .js — dynamic import
    try {
        const module = await import(absolutePath);
        const rules = module.default ?? module;
        if (!Array.isArray(rules)) {
            logger_js_1.logger.fatal(`Rule file ${filePath} must export a default array of RemoveRule objects.`);
        }
        return rules;
    }
    catch (err) {
        if (ext === '.ts') {
            const jsSibling = absolutePath.replace(/\.ts$/, '.js');
            if (fs.existsSync(jsSibling)) {
                try {
                    const module = await import(jsSibling);
                    const rules = module.default ?? module;
                    if (!Array.isArray(rules)) {
                        logger_js_1.logger.fatal(`Rule file ${jsSibling} must export a default array of RemoveRule objects.`);
                    }
                    return rules;
                }
                catch {
                    throw new RuleFileNotFoundError(`Failed to load rule file from both ${filePath} and ${jsSibling}`);
                }
            }
        }
        throw new RuleFileNotFoundError(`Failed to load rule file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=rule-loader.js.map