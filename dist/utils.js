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
exports.findFiles = findFiles;
exports.computeOutputPath = computeOutputPath;
exports.writeOutput = writeOutput;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const glob_1 = require("glob");
const logger_js_1 = require("./logger.js");
/**
 * Resolves a directory and returns all files matching a glob pattern.
 * Returns an empty array (with an info log) if the directory does not exist.
 *
 * @param dir     - Directory to search in (absolute or relative to `cwd`).
 * @param pattern - Glob pattern relative to `dir` (e.g. `'**\\/*.html'`).
 * @returns Absolute paths of all matching files.
 */
async function findFiles(dir, pattern) {
    const resolvedDir = path.resolve(dir);
    if (!fs.existsSync(resolvedDir)) {
        logger_js_1.logger.info(`Directory not found: ${resolvedDir}`);
        return [];
    }
    return (0, glob_1.glob)(pattern, { cwd: resolvedDir, absolute: true });
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
function computeOutputPath(inputPath, sourceDir, config) {
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
function writeOutput(inputPath, outputPath, content, config) {
    const mode = config.output?.mode ?? 'copy';
    if (mode === 'in-place') {
        fs.writeFileSync(inputPath, content);
        logger_js_1.logger.verbose(`Wrote in-place: ${inputPath}`);
    }
    else if (mode === 'side-by-side') {
        const ext = path.extname(inputPath);
        const base = inputPath.slice(0, -ext.length);
        const sidePath = `${base}.sanitized${ext}`;
        fs.writeFileSync(sidePath, content);
        logger_js_1.logger.verbose(`Wrote side-by-side: ${sidePath}`);
    }
    else {
        // 'copy' mode
        const dir = path.dirname(outputPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, content);
        logger_js_1.logger.verbose(`Wrote copy: ${outputPath}`);
    }
}
//# sourceMappingURL=utils.js.map