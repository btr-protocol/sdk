/**
 * Unified logger for BTR DEX - works in both backend (Bun/Node) and frontend (browser)
 *
 * A logger is a DIAGNOSTIC channel and nothing else. It used to forward every `warn`/`error`
 * to a host-supplied notification handler, which made the front end toast raw developer
 * strings at users ("bind wallet", "Failed to set pane heights"). Telling a user something is
 * a deliberate call the caller makes; it is never a side effect of logging.
 * @module @btr-protocol/sdk/utils/logger
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context?: string;
  message: string;
  data?: unknown;
}

let defaultContext: string | undefined;
let minLevel: LogLevel = 'info';

function formatLog(entry: LogEntry): string {
  const ctx = entry.context ? `[${entry.context}] ` : '';
  return `${ctx}${entry.message}`;
}

function consoleMethod(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'debug':
      return console.debug;
    case 'info':
      return console.info;
    case 'warn':
      return console.warn;
    case 'error':
      return console.error;
  }
}

function shouldLog(level: LogLevel): boolean {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return levels.indexOf(level) >= levels.indexOf(minLevel);
}

function log(level: LogLevel, message: string, data?: unknown, context?: string): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context: context ?? defaultContext,
    message,
    data,
  };

  const method = consoleMethod(level);
  method(formatLog(entry), data ?? '');
}

/**
 * Set the default context for all logs
 */
export function setContext(context: string): void {
  defaultContext = context;
}

/**
 * Clear the default context
 */
export function clearContext(): void {
  defaultContext = undefined;
}

/**
 * Set the minimum log level
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * Single logger instance - use this everywhere
 */
export const logger = {
  debug: (message: string, data?: unknown) => log('debug', message, data),
  info: (message: string, data?: unknown) => log('info', message, data),
  warn: (message: string, data?: unknown) => log('warn', message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
  withContext: (context: string) => ({
    debug: (message: string, data?: unknown) => log('debug', message, data, context),
    info: (message: string, data?: unknown) => log('info', message, data, context),
    warn: (message: string, data?: unknown) => log('warn', message, data, context),
    error: (message: string, data?: unknown) => log('error', message, data, context),
  }),
};

/**
 * Convenience exports
 */
export const debug = logger.debug;
export const info = logger.info;
export const warn = logger.warn;
export const error = logger.error;
export { info as log };
