// apps/backoffice/src/lib/accessToken.ts
//
// Resolve the bearer token for direct EF fetches (void-order, generate-pdf, …).
// Under PIN auth the JWT lives in the module-scoped holder injected by
// `setSupabaseAccessToken` — GoTrue never sees it, so `supabase.auth.getSession()`
// returns null in a real browser (the historical `no_auth_session` breakage).
// The GoTrue session is kept as a fallback for email-login / test contexts.
// Mirrors apps/pos/src/lib/accessToken.ts.
import { getSupabaseAccessToken } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';

export async function getAccessToken(): Promise<string> {
  const pinToken = getSupabaseAccessToken();
  if (pinToken) return pinToken;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no_auth_session');
  return session.access_token;
}
