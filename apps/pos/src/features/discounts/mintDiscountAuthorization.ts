import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import { getManagerPin } from './managerPinHolder';

export async function mintDiscountAuthorization(): Promise<string> {
  const pin = getManagerPin();
  if (!pin) throw Object.assign(new Error('discount_requires_authorizer'), { status: 403 });
  const token = await getAccessToken();
  const response = await fetch(`${supabaseUrl}/functions/v1/verify-manager-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-manager-pin': pin },
    body: JSON.stringify({ required_permission: 'sales.discount', mint_scope: 'discount' }),
  });
  const body = await response.json() as { authorization_id?: string; error?: string };
  if (!response.ok || !body.authorization_id) {
    throw Object.assign(new Error(body.error ?? 'discount_requires_authorizer'), { status: response.status });
  }
  return body.authorization_id;
}
