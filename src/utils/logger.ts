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

function log(level: LogLevel, message: string, data?: unknown, context?: string): void {
  if (level === 'debug') return; // min level = info
  console[level](context ? `[${context}] ${message}` : message, data ?? '');
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
