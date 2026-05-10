// Appels typés des Edge Functions auth-*.

export interface LoginRequest {
  user_id: string;
  pin: string;
  device_type: 'pos' | 'backoffice';
}

export interface LoginResponse {
  user: { id: string; full_name: string; role_code: string; employee_code: string };
  session: { token: string; session_id: string; created_at: string };
  auth: { access_token: string; refresh_token: string; expires_at: number };
  permissions: string[];
}

export type LoginError =
  | { error: 'invalid_pin'; attempts_remaining: number }
  | { error: 'account_locked'; minutes_left: number }
  | { error: 'rate_limited'; retry_after_sec: number }
  | { error: 'user_inactive' | 'user_not_found' | 'invalid_pin_format' | 'missing_fields' | 'internal' | 'network_timeout' };

// D6 (session 8 perf-debt): all auth fetches are wrapped in an AbortController
// with a hard 15s timeout. Without this, a hung Supabase Edge Function or a
// flaky uplink would freeze the POS login screen indefinitely. On timeout we
// throw a typed `network_timeout` error so callers can surface a transient
// "réseau lent — réessaye" toast without locking the UI.
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Shape mirrors the `loginWithPin` error contract: callers `catch`
      // can read `e.details?.error === 'network_timeout'` (which extends the
      // LoginError union) and surface a friendly "réseau lent" message.
      const details: LoginError = { error: 'network_timeout' };
      throw Object.assign(new Error('network_timeout'), { isTimeout: true as const, details });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginWithPin(supabaseUrl: string, body: LoginRequest): Promise<LoginResponse> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as LoginError;
    throw Object.assign(new Error(errBody.error ?? 'login_failed'), { details: errBody, status: res.status });
  }
  return (await res.json()) as LoginResponse;
}

export async function getSession(
  supabaseUrl: string,
  sessionToken: string,
): Promise<LoginResponse['user'] & { permissions: string[] }> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-get-session`, {
    headers: { 'x-session-token': sessionToken },
  });
  if (!res.ok) throw Object.assign(new Error('session_invalid'), { status: res.status });
  const body = (await res.json()) as { user: LoginResponse['user']; permissions: string[] };
  return { ...body.user, permissions: body.permissions };
}

export async function logoutSession(supabaseUrl: string, sessionToken: string): Promise<void> {
  await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-logout`, {
    method: 'POST',
    headers: { 'x-session-token': sessionToken },
  });
}

export interface ChangePinRequest {
  user_id: string;
  current_pin?: string;
  new_pin: string;
}

export async function changePin(
  supabaseUrl: string,
  sessionToken: string,
  body: ChangePinRequest,
): Promise<void> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-change-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(errBody.error ?? 'change_pin_failed'), { details: errBody, status: res.status });
  }
}
