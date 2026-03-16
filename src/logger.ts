import type { ReportingConfig } from './config/types.js';

export type LogLevel = 'silent' | 'normal' | 'verbose';

let currentLevel: LogLevel = 'normal';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function configureLogger(config?: ReportingConfig): void {
  if (config?.logLevel) {
    currentLevel = config.logLevel;
  }
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  normal: 1,
  verbose: 2,
};

function shouldLog(requiredLevel: LogLevel): boolean {
  return LEVEL_PRIORITY[currentLevel] >= LEVEL_PRIORITY[requiredLevel];
}

export const logger = {
  info(message: string): void {
    if (shouldLog('normal')) {
      console.log(`[INFO] ${message}`);
    }
  },

  warn(message: string): void {
    if (shouldLog('normal')) {
      console.warn(`[WARN] ${message}`);
    }
  },

  error(message: string): void {
    // Errors always print unless silent
    if (shouldLog('normal')) {
      console.error(`[ERROR] ${message}`);
    }
  },

  verbose(message: string): void {
    if (shouldLog('verbose')) {
      console.log(`[VERBOSE] ${message}`);
    }
  },

  fatal(message: string): never {
    console.error(`[FATAL] ${message}`);
    throw new Error(message);
  },
};
