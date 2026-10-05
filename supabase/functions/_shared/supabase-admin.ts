// supabase/functions/_shared/supabase-admin.ts
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { getServerApiKey } from './api-keys.ts';

let _admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const key = getServerApiKey();
  if (!url || !key) throw new Error('Missing Supabase URL or server API key');
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Le SDK épinglé ajoute la clé API en Bearer par défaut. Une clé moderne
    // doit voyager uniquement dans apikey ; les autres JWT restent inchangés.
    global: { fetch: (input, init) => {
      if (!key.startsWith('sb_secret_')) return fetch(input, init);
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      if (headers.get('authorization') === `Bearer ${key}`) headers.delete('authorization');
      return fetch(input, { ...init, headers });
    } },
  });
  return _admin;
}
