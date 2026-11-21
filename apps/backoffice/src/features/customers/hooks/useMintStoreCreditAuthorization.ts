// apps/backoffice/src/features/customers/hooks/useMintStoreCreditAuthorization.ts
// ADR-013 Lot 4 (D6) — obtain a single-use manager authorization nonce for
// granting store credit. Calls the verify-manager-pin EF with the manager PIN
// in the `x-manager-pin` header (S25 pattern, never the body) and
// `mint_scope: 'store_credit_grant'` in the body; the EF verifies the PIN,
// enforces the scope-mapped permission (customers.store_credit.grant)
// server-side and mints a `discount_authorizations` row (60 s TTL). The
// returned authorization_id is consumed atomically by grant_store_credit_v1 —
// one nonce per RPC call; a failed RPC burns it (re-mint on next attempt).

import { getAccessToken } from '@/lib/accessToken.js';

interface MintResponse {
  verified_user_id?: string;
  authorization_id?: string;
  error?: string;
  message?: string;
}

export type ManagerMintScope = 'store_credit_grant' | 'loyalty_points_grant';

export function mintStoreCreditAuthorization(managerPin: string): Promise<string> {
  return mintManagerAuthorization('store_credit_grant', managerPin);
}

/** Même véhicule pour tout scope BO de verify-manager-pin (ex. points fidélité). */
export async function mintManagerAuthorization(scope: ManagerMintScope, managerPin: string): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const accessToken = await getAccessToken();
  const res = await fetch(`${supabaseUrl}/functions/v1/verify-manager-pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-manager-pin': managerPin,
    },
    body: JSON.stringify({ mint_scope: scope }),
  });
  const body = await res.json().catch(() => ({})) as MintResponse;
  if (!res.ok || !body.authorization_id) {
    throw Object.assign(new Error(body.error ?? 'authorization_failed'), {
      details: body,
      status: res.status,
    });
  }
  return body.authorization_id;
}
