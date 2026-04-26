import type { ReportingConfig } from './config/types.js';
/**
 * Supported log verbosity levels.
 *
 * - `silent` — suppresses all output, including errors
 * - `normal`  — shows info, warnings, and errors (default)
 * - `verbose` — shows everything including detailed step-level traces
 */
export type LogLevel = 'silent' | 'normal' | 'verbose';
/**
 * Overrides the active log level at runtime.
 *
 * @param level - The new log level to apply.
 */
export declare function setLogLevel(level: LogLevel): void;
/**
 * Returns the currently active log level.
 *
 * @returns The active {@link LogLevel}.
 */
export declare function getLogLevel(): LogLevel;
/**
 * Configures the logger from a {@link ReportingConfig} object.
 * If `config.logLevel` is set, it overrides the current level.
 *
 * @param config - Optional reporting configuration. Safe to call with `undefined`.
 */
export declare function configureLogger(config?: ReportingConfig): void;
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
export declare const logger: {
    /**
     * Logs an informational message at `normal` level.
     *
     * @param message - The message to log, prefixed with `[INFO]`.
     */
    info(message: string): void;
    /**
     * Logs a warning at `normal` level.
     *
     * @param message - The message to log, prefixed with `[WARN]`.
     */
    warn(message: string): void;
    /**
     * Logs an error at `normal` level.
     * Suppressed only when log level is `silent`.
     *
     * @param message - The message to log, prefixed with `[ERROR]`.
     */
    error(message: string): void;
    /**
     * Logs a detailed diagnostic message at `verbose` level.
     * No-op unless the active log level is `verbose`.
     *
     * @param message - The message to log, prefixed with `[VERBOSE]`.
     */
    verbose(message: string): void;
    /**
     * Logs a fatal error and immediately throws an `Error`.
     * This method **never returns** — the `never` return type is intentional
     * so TypeScript treats call sites as unreachable.
     *
     * @param message - The message to log, prefixed with `[FATAL]`, and used as the thrown error's message.
     * @throws {Error} Always — the provided message is used as the error message.
     */
    fatal(message: string): never;
};
//# sourceMappingURL=logger.d.ts.map