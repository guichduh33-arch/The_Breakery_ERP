// apps/pos/src/lib/accessToken.ts
//
// Resolve the bearer token for direct EF fetches (process-payment, refund-order,
// void-order, cancel-item). Under PIN auth the JWT lives in the module-scoped
// holder injected by `setSupabaseAccessToken` — GoTrue never sees it, so
// `supabase.auth.getSession()` returns null in a real browser (the historical
// `no_auth_session` checkout breakage). The GoTrue session is kept as a
// fallback for email-login and test contexts.
import { getSupabaseAccessToken } from '@breakery/supabase';

export async function getAccessToken(): Promise<string> {
  const pinToken = getSupabaseAccessToken();
  if (pinToken) return pinToken;
  const { supabase } = await import('@/lib/supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no_auth_session');
  return session.access_token;
}
