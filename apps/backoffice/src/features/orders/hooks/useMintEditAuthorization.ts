// apps/backoffice/src/features/orders/hooks/useMintEditAuthorization.ts
// ADR-010 D3 — obtain a single-use manager authorization nonce for editing a
// kitchen-sent (locked) order line. Calls the verify-manager-pin EF with the
// manager PIN in the `x-manager-pin` header (S25 pattern, never the body) and
// `mint_scope: 'order_item_edit'` in the body; the EF verifies the PIN,
// enforces the scope-mapped permission (pos.sale.cancel_item) server-side and
// mints a `discount_authorizations` row (60 s TTL). The returned
// authorization_id is consumed atomically by update_order_item_qty_v2 — one
// nonce per RPC call.

import { getAccessToken } from '@/lib/accessToken.js';

interface MintResponse {
  verified_user_id?: string;
  authorization_id?: string;
  error?: string;
  message?: string;
}

export async function mintEditAuthorization(managerPin: string): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const accessToken = await getAccessToken();
  const res = await fetch(`${supabaseUrl}/functions/v1/verify-manager-pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-manager-pin': managerPin,
    },
    body: JSON.stringify({ mint_scope: 'order_item_edit' }),
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
