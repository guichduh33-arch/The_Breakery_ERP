// packages/utils/src/logger.ts
// Console wrapper avec hook Sentry breadcrumb (optionnel via injection).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type BreadcrumbHook = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

let breadcrumbHook: BreadcrumbHook | null = null;

export function setBreadcrumbHook(hook: BreadcrumbHook | null): void {
  breadcrumbHook = hook;
}

function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  const fn = console[level === 'debug' ? 'log' : level];
  if (data !== undefined) {
    fn(`[${level}]`, message, data);
  } else {
    fn(`[${level}]`, message);
  }
  if (breadcrumbHook) breadcrumbHook(level, message, data);
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info:  (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
};
