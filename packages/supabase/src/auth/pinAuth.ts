// Appels typés des Edge Functions auth-*.

/**
 * Body POSTed to the `auth-verify-pin` Edge Function.
 *
 * @property user_id     - UUID of the user_profile row.
 * @property pin         - 6-digit PIN entered on the numpad.
 * @property device_type - Device origin; controls allowed roles and rate limits.
 */
export interface LoginRequest {
  user_id: string;
  pin: string;
  device_type: 'pos' | 'backoffice';
}

/**
 * Successful response from `auth-verify-pin`.
 *
 * @property user        - Public user fields safe to mirror in client state.
 * @property session     - Server-side session record (the `token` is opaque and
 *                          used as `x-session-token` for {@link getSession},
 *                          {@link logoutSession}, {@link changePin}).
 * @property auth        - Supabase-style JWT bundle. `access_token` is HS256 and
 *                          must be wired via {@link setSupabaseAccessToken}.
 * @property permissions - Flat list of {@link PermissionCode} strings granted by the user's role.
 */
export interface LoginResponse {
  user: { id: string; full_name: string; role_code: string; employee_code: string };
  session: { token: string; session_id: string; created_at: string };
  auth: { access_token: string; refresh_token: string; expires_at: number };
  permissions: string[];
}

/**
 * Discriminated union of failure responses from `auth-verify-pin`.
 *
 * - `invalid_pin`      - Wrong PIN. `attempts_remaining` decrements before lockout.
 * - `account_locked`   - Too many failed attempts. Retry after `minutes_left`.
 * - `rate_limited`     - Per-IP throttle. Retry after `retry_after_sec` seconds.
 * - `user_inactive`    - User row exists but is_active = false.
 * - `user_not_found`   - Unknown `user_id`.
 * - `invalid_pin_format` - PIN is not 6 digits.
 * - `missing_fields`   - Body is missing required keys.
 * - `internal`         - Unexpected server error.
 */
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

/**
 * Verify a PIN and mint a session.
 *
 * Calls `POST {supabaseUrl}/functions/v1/auth-verify-pin`. On success the
 * caller should: (1) call {@link setSupabaseAccessToken} with `auth.access_token`,
 * (2) persist `session.token` in {@link safeStorage} for future {@link getSession}
 * probes, (3) cache `permissions` for client-side {@link hasPermission} checks.
 *
 * @param supabaseUrl - Project URL (no trailing slash).
 * @param body        - {@link LoginRequest} payload.
 * @returns {@link LoginResponse} on HTTP 200.
 * @throws {Error & { details: LoginError; status: number }} on any non-2xx response;
 *         inspect `err.details.error` to discriminate the failure mode.
 */
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

/**
 * Probe an existing session and refresh its `last_activity_at`.
 *
 * Calls `GET {supabaseUrl}/functions/v1/auth-get-session` with
 * `x-session-token`. Used on app boot to rehydrate auth state without forcing
 * a new PIN login.
 *
 * Session 19 / Phase 3.A — the EF now also returns the user's role-derived
 * `session_timeout_minutes` so the POS + BO shells can wire the idle-logout
 * hook (`useIdleTimeout`) without an extra round-trip.
 *
 * @param supabaseUrl  - Project URL.
 * @param sessionToken - Opaque token from {@link LoginResponse}.session.token.
 * @returns The user's public profile flattened with their permission list and
 *          `session_timeout_minutes` (may be `null` for legacy users without a
 *          role row — callers should treat that as "no idle logout").
 * @throws {Error & { status: number }} `session_invalid` on any non-2xx response
 *         (expired, revoked, or unknown token).
 */
export async function getSession(
  supabaseUrl: string,
  sessionToken: string,
): Promise<
  LoginResponse['user'] & {
    permissions: string[];
    session_timeout_minutes: number | null;
    /**
     * Fresh HS256 JWT bundle re-minted by the EF so the caller can restore the
     * PostgREST bearer after a hard reload (the clients run with
     * `persistSession: false`). `null` only for legacy EF deployments that
     * predate this field — callers must tolerate that.
     */
    auth: LoginResponse['auth'] | null;
  }
> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-get-session`, {
    headers: { 'x-session-token': sessionToken },
  });
  if (!res.ok) throw Object.assign(new Error('session_invalid'), { status: res.status });
  const body = (await res.json()) as {
    user: LoginResponse['user'];
    permissions: string[];
    session_timeout_minutes?: number | null;
    auth?: LoginResponse['auth'] | null;
  };
  return {
    ...body.user,
    permissions: body.permissions,
    session_timeout_minutes: body.session_timeout_minutes ?? null,
    auth: body.auth ?? null,
  };
}

/**
 * Revoke a session server-side. Best-effort: failures are not surfaced.
 *
 * Calls `POST {supabaseUrl}/functions/v1/auth-logout`. The caller is still
 * responsible for clearing local state and calling
 * `setSupabaseAccessToken(null)`.
 *
 * @param supabaseUrl  - Project URL.
 * @param sessionToken - Token to revoke.
 */
export async function logoutSession(supabaseUrl: string, sessionToken: string): Promise<void> {
  await fetchWithTimeout(`${supabaseUrl}/functions/v1/auth-logout`, {
    method: 'POST',
    headers: { 'x-session-token': sessionToken },
  });
}

/**
 * Body POSTed to `auth-change-pin`.
 *
 * @property user_id     - Target user. May be self or another user (admin override
 *                          requires the `users.update` permission server-side).
 * @property current_pin - Required for self-service rotation; omitted on admin override.
 * @property new_pin     - New 6-digit PIN.
 */
export interface ChangePinRequest {
  user_id: string;
  current_pin?: string;
  new_pin: string;
}

/**
 * Rotate a user's PIN.
 *
 * Calls `POST {supabaseUrl}/functions/v1/auth-change-pin`. Authentication is
 * by `x-session-token` (Authorization is unused — the EF re-derives identity
 * from the session row).
 *
 * @param supabaseUrl  - Project URL.
 * @param sessionToken - Session token of the *acting* user (self or admin).
 * @param body         - {@link ChangePinRequest} payload.
 * @throws {Error & { details: { error?: string }; status: number }} on any
 *         non-2xx response. Common errors: `invalid_pin`, `permission_denied`,
 *         `pin_reused`, `invalid_pin_format`.
 */
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
