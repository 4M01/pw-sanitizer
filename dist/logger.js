"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.setLogLevel = setLogLevel;
exports.getLogLevel = getLogLevel;
exports.configureLogger = configureLogger;
let currentLevel = 'normal';
/**
 * Overrides the active log level at runtime.
 *
 * @param level - The new log level to apply.
 */
function setLogLevel(level) {
    currentLevel = level;
}
/**
 * Returns the currently active log level.
 *
 * @returns The active {@link LogLevel}.
 */
function getLogLevel() {
    return currentLevel;
}
/**
 * Configures the logger from a {@link ReportingConfig} object.
 * If `config.logLevel` is set, it overrides the current level.
 *
 * @param config - Optional reporting configuration. Safe to call with `undefined`.
 */
function configureLogger(config) {
    if (config?.logLevel) {
        currentLevel = config.logLevel;
    }
}
/** Numeric priority for each log level — higher means more verbose. */
const LEVEL_PRIORITY = {
    silent: 0,
    normal: 1,
    verbose: 2,
};
/**
 * Returns `true` if the current log level is at least as verbose as `requiredLevel`.
 *
 * @param requiredLevel - The minimum level needed to emit a message.
 */
function shouldLog(requiredLevel) {
    return LEVEL_PRIORITY[currentLevel] >= LEVEL_PRIORITY[requiredLevel];
}
/**
 * Singleton logger used throughout the sanitizer.
 *
 * All methods are no-ops when the active log level is below the required threshold.
 * The `fatal` method always emits and then throws — it never returns.
 *
 * @example
 * ```ts
 * import { logger } from './logger.js';
 * logger.info('Processing file...');
 * logger.verbose('Parsed 42 events from trace.json');
 * logger.warn('Duplicate pattern id "token" — last definition wins');
 * logger.error('Unexpected structure in report data');
 * logger.fatal('Config not found'); // throws Error
 * ```
 */
exports.logger = {
    /**
     * Logs an informational message at `normal` level.
     *
     * @param message - The message to log, prefixed with `[INFO]`.
     */
    info(message) {
        if (shouldLog('normal')) {
            console.log(`[INFO] ${message}`);
        }
    },
    /**
     * Logs a warning at `normal` level.
     *
     * @param message - The message to log, prefixed with `[WARN]`.
     */
    warn(message) {
        if (shouldLog('normal')) {
            console.warn(`[WARN] ${message}`);
        }
    },
    /**
     * Logs an error at `normal` level.
     * Suppressed only when log level is `silent`.
     *
     * @param message - The message to log, prefixed with `[ERROR]`.
     */
    error(message) {
        // Errors always print unless silent
        if (shouldLog('normal')) {
            console.error(`[ERROR] ${message}`);
        }
    },
    /**
     * Logs a detailed diagnostic message at `verbose` level.
     * No-op unless the active log level is `verbose`.
     *
     * @param message - The message to log, prefixed with `[VERBOSE]`.
     */
    verbose(message) {
        if (shouldLog('verbose')) {
            console.log(`[VERBOSE] ${message}`);
        }
    },
    /**
     * Logs a fatal error and immediately throws an `Error`.
     * This method **never returns** — the `never` return type is intentional
     * so TypeScript treats call sites as unreachable.
     *
     * @param message - The message to log, prefixed with `[FATAL]`, and used as the thrown error's message.
     * @throws {Error} Always — the provided message is used as the error message.
     */
    fatal(message) {
        console.error(`[FATAL] ${message}`);
        throw new Error(message);
    },
};
//# sourceMappingURL=logger.js.map