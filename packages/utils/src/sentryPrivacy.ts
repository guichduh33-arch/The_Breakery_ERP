// Les rapports ne transportent que la position technique du plantage.
interface ErrorReport {
  event_id?: string;
  timestamp?: number;
  environment?: string;
  exception?: {
    values?: {
      type?: string;
      stacktrace?: {
        frames?: { filename?: string; lineno?: number; colno?: number; in_app?: boolean }[];
      };
    }[];
  };
}

const nativeErrors = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);

function assetName(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  try {
    const name = new URL(filename, 'https://local.invalid').pathname.split('/').pop();
    return name && /^[a-zA-Z0-9_-]{1,150}\.(?:[cm]?js|tsx?)$/.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeSentryEvent(event: ErrorReport) {
  return {
    type: undefined,
    level: 'error' as const,
    platform: 'javascript',
    ...(event.environment && ['development', 'production', 'staging', 'test'].includes(event.environment) ? { environment: event.environment } : {}),
    ...(event.event_id && /^[a-f0-9]{32}$/i.test(event.event_id) ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    exception: {
      values: (event.exception?.values ?? [{}]).map((exception) => ({
        type: exception.type && nativeErrors.has(exception.type) ? exception.type : 'Error',
        value: 'Application error (details withheld)',
        stacktrace: {
          frames: (exception.stacktrace?.frames ?? []).map((frame) => {
            const filename = assetName(frame.filename);
            return {
              ...(filename ? { filename } : {}),
              ...(typeof frame.lineno === 'number' && Number.isSafeInteger(frame.lineno) ? { lineno: frame.lineno } : {}),
              ...(typeof frame.colno === 'number' && Number.isSafeInteger(frame.colno) ? { colno: frame.colno } : {}),
              ...(typeof frame.in_app === 'boolean' ? { in_app: frame.in_app } : {}),
            };
          }),
        },
      })),
    },
  };
}

export const sentryPrivacyOptions = {
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enableLogs: false,
  sendClientReports: false,
  maxBreadcrumbs: 0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
  },
  beforeBreadcrumb: () => null,
};
