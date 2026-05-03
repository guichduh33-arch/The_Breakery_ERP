// supabase/functions/_shared/supabase-admin.ts
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

let _admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}
