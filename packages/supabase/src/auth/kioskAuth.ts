// packages/supabase/src/auth/kioskAuth.ts
// Typed client wrapper around the `kiosk-issue-jwt` Edge Function.
//
// Session 13 / Phase 1.B — D18.

import { getSupabaseClient } from '../client.js';

export type KioskScope = 'kds' | 'display' | 'tablet';

export interface KioskIssueRequest {
  action: 'pair' | 'renew';
  device_id?: string;
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
  | { error: 'kiosk_unauthorized' | 'kiosk_unavailable' | 'pairing_required' }
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

/**
 * Mint a fresh kiosk JWT via the `kiosk-issue-jwt` Edge Function.
 *
 * @param supabaseUrl - Project URL.
 * @param body        - {@link KioskIssueRequest} payload.
 * @returns {@link KioskIssueResponse} on success.
 * @throws {Error & { details: KioskIssueError; status: number }} on any non-2xx.
 */
export async function issueKioskJwt(
  _supabaseUrl: string,
  body: KioskIssueRequest,
  credentials: { secret: string; pairingCode?: string },
): Promise<KioskIssueResponse> {
  const headers: Record<string, string> = { 'x-kiosk-secret': credentials.secret };
  if (credentials.pairingCode) headers['x-kiosk-pairing-code'] = credentials.pairingCode;
  const result = await getSupabaseClient().functions.invoke<KioskIssueResponse>('kiosk-issue-jwt', {
    body, headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = result.data;
  const error: unknown = result.error;
  if (error || !data) {
    const context: unknown = (error as { context?: unknown } | null)?.context;
    const response = context instanceof Response ? context : null;
    const details = response ? await response.json().catch(() => ({ error: 'kiosk_unavailable' })) as KioskIssueError : { error: 'kiosk_unavailable' };
    throw Object.assign(new Error(details.error), { details, status: response?.status });
  }
  return data;
}
