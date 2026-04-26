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
exports.loadConfig = loadConfig;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const logger_js_1 = require("../logger.js");
/**
 * Ordered list of config file names that are auto-discovered in the current
 * working directory when no explicit `--config` path is provided.
 */
const CONFIG_FILE_NAMES = [
    'playwright-sanitizer.config.ts',
    'playwright-sanitizer.config.js',
    'playwright-sanitizer.config.json',
];
/**
 * Loads a {@link SanitizerConfig} from an explicit file path.
 *
 * - `.json` files are parsed with `JSON.parse`.
 * - `.ts` / `.js` files are loaded via dynamic `import()`.
 *   If loading a `.ts` file fails, a compiled `.js` sibling is tried automatically.
 *
 * @param filePath - Absolute or relative path to the config file.
 * @returns The resolved {@link SanitizerConfig}.
 * @throws Calls `logger.fatal` (which throws) if the file is not found or cannot be parsed.
 */
async function loadConfigFromFile(filePath) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        return logger_js_1.logger.fatal(`Config file not found: ${absolutePath}`);
    }
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.json') {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        return JSON.parse(content);
    }
    // .ts or .js — use dynamic import
    try {
        const module = await import(absolutePath);
        return (module.default ?? module);
    }
    catch (err) {
        // If .ts failed, try .js sibling
        if (ext === '.ts') {
            const jsSibling = absolutePath.replace(/\.ts$/, '.js');
            if (fs.existsSync(jsSibling)) {
                try {
                    const module = await import(jsSibling);
                    return (module.default ?? module);
                }
                catch {
                    return logger_js_1.logger.fatal(`Failed to load config from both ${absolutePath} and ${jsSibling}. ` +
                        `Ensure tsx or ts-node is available, or provide a .js config file.`);
                }
            }
        }
        return logger_js_1.logger.fatal(`Failed to load config from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Attempts to load a sanitizer config from the `sanitizer` key inside
 * `playwright.config.ts` or `playwright.config.js` in the given directory.
 *
 * Returns `null` if no Playwright config is found, the file cannot be
 * loaded, or it does not contain a `sanitizer` key.
 *
 * @param cwd - The directory to search for a Playwright config file.
 * @returns The embedded {@link SanitizerConfig}, or `null` if not found.
 */
async function loadFromPlaywrightConfig(cwd) {
    const candidates = ['playwright.config.ts', 'playwright.config.js'];
    for (const name of candidates) {
        const fullPath = path.resolve(cwd, name);
        if (fs.existsSync(fullPath)) {
            try {
                const module = await import(fullPath);
                const config = module.default ?? module;
                if (config && typeof config === 'object' && 'sanitizer' in config) {
                    return config.sanitizer;
                }
            }
            catch {
                // Not loadable or no sanitizer key — continue
            }
        }
    }
    return null;
}
/**
 * Resolves and loads the sanitizer configuration.
 *
 * Config discovery priority (first match wins):
 * 1. Explicit `configPath` (from `--config` CLI flag or programmatic call)
 * 2. `playwright-sanitizer.config.ts` in `cwd`
 * 3. `playwright-sanitizer.config.js` in `cwd`
 * 4. `playwright-sanitizer.config.json` in `cwd`
 * 5. `sanitizer` key inside `playwright.config.ts` / `playwright.config.js`
 *
 * If none of the above are found, the function calls `logger.fatal` which
 * throws an `Error` with an actionable message.
 *
 * @param configPath - Optional explicit path to a config file.
 *   When provided, auto-discovery is skipped entirely.
 * @returns The resolved {@link SanitizerConfig}.
 * @throws Calls `logger.fatal` (which throws) when no config can be found or loaded.
 *
 * @example
 * ```ts
 * // Auto-discover config in cwd
 * const config = await loadConfig();
 *
 * // Load from an explicit path
 * const config = await loadConfig('./configs/sanitizer.config.ts');
 * ```
 */
async function loadConfig(configPath) {
    const cwd = process.cwd();
    // 1. Explicit path
    if (configPath) {
        logger_js_1.logger.verbose(`Loading config from explicit path: ${configPath}`);
        return loadConfigFromFile(configPath);
    }
    // 2-4. Auto-discover config files
    for (const name of CONFIG_FILE_NAMES) {
        const fullPath = path.resolve(cwd, name);
        if (fs.existsSync(fullPath)) {
            logger_js_1.logger.verbose(`Found config file: ${fullPath}`);
            return loadConfigFromFile(fullPath);
        }
    }
    // 5. Playwright config sanitizer key
    const fromPlaywright = await loadFromPlaywrightConfig(cwd);
    if (fromPlaywright) {
        logger_js_1.logger.verbose('Loaded config from playwright.config sanitizer key');
        return fromPlaywright;
    }
    return logger_js_1.logger.fatal('No playwright-sanitizer config found. ' +
        'Create playwright-sanitizer.config.ts or pass --config <path>.');
}
//# sourceMappingURL=loader.js.map