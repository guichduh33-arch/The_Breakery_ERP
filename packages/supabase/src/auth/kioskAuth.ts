// packages/supabase/src/auth/kioskAuth.ts
// Typed client wrapper around the `kiosk-issue-jwt` Edge Function.
//
// Session 13 / Phase 1.B — D18.

export type KioskScope = 'kds' | 'display' | 'tablet';

export interface KioskIssueRequest {
  kiosk_id: string;
  scope: KioskScope;
  device_label?: string | undefined;
}

export interface KioskIssueResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_at: number;
  kiosk: {
    kiosk_id: string;
    scope: KioskScope;
    device_label: string | null;
  };
}

export type KioskIssueError =
  | { error: 'missing_fields' }
  | { error: 'invalid_scope' }
  | { error: 'invalid_json' }
  | { error: 'rate_limited'; retry_after_sec: number }
  | { error: 'ip_not_allowed' }
  | { error: 'method_not_allowed' }
  | { error: 'server_misconfigured_no_jwt_secret' }
  | { error: 'internal_error' }
  | { error: 'network_timeout' };

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const details: KioskIssueError = { error: 'network_timeout' };
      throw Object.assign(new Error('network_timeout'), { isTimeout: true as const, details });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint a fresh kiosk JWT via the `kiosk-issue-jwt` Edge Function.
 *
 * @param supabaseUrl - Project URL.
 * @param body        - {@link KioskIssueRequest} payload.
 * @returns {@link KioskIssueResponse} on success.
 * @throws {Error & { details: KioskIssueError; status: number }} on any non-2xx.
 */
export async function issueKioskJwt(
  supabaseUrl: string,
  body: KioskIssueRequest,
): Promise<KioskIssueResponse> {
  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/kiosk-issue-jwt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as KioskIssueError;
    throw Object.assign(new Error((errBody as { error?: string }).error ?? 'kiosk_issue_failed'), {
      details: errBody,
      status: res.status,
    });
  }
  return (await res.json()) as KioskIssueResponse;
}
