import { config } from '../config';

/**
 * Log levels enum
 */
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Map string log level to enum
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

const currentLogLevel = LOG_LEVEL_MAP[config.logLevel.toLowerCase()] ?? LogLevel.INFO;

/**
 * Format log message with timestamp and metadata
 */
function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaString = meta && Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${message}${metaString}`;
}

/**
 * Logger utility with level-based filtering
 */
export const logger = {
  error(message: string, meta?: Record<string, unknown>): void {
    if (currentLogLevel >= LogLevel.ERROR) {
      console.error(formatMessage('ERROR', message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (currentLogLevel >= LogLevel.WARN) {
      console.warn(formatMessage('WARN', message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (currentLogLevel >= LogLevel.INFO) {
      console.log(formatMessage('INFO', message, meta));
    }
  },

  debug(message: string, meta?: Record<string, unknown>): void {
    if (currentLogLevel >= LogLevel.DEBUG) {
      console.log(formatMessage('DEBUG', message, meta));
    }
  },
};
