// packages/utils/src/logger.ts
// Console wrapper avec hook Sentry breadcrumb (optionnel via injection).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

type BreadcrumbHook = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

let breadcrumbHook: BreadcrumbHook | null = null;

// D12 (session 8 perf-debt): pre-cache the level → console method mapping at
// module scope. Removes the per-call `level === 'debug' ? 'log' : level`
// conditional. We cache the method *key* rather than `console[k]` directly so
// that test spies (`vi.spyOn(console, 'log')`) still intercept the call —
// caching the function reference would lock us to the original `console.log`
// captured at module load.
const METHOD_BY_LEVEL: Record<LogLevel, ConsoleMethod> = {
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

export function setBreadcrumbHook(hook: BreadcrumbHook | null): void {
  breadcrumbHook = hook;
}

function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  const fn = console[METHOD_BY_LEVEL[level]];
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
