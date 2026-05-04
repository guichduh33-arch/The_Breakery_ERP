import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated.js';

let _client: SupabaseClient<Database> | null = null;

export interface BreakerySupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseClient(config?: BreakerySupabaseConfig): SupabaseClient<Database> {
  if (_client) return _client;
  if (!config) throw new Error('Supabase client not initialized — pass config on first call');
  _client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-app': 'breakery' } },
  });
  return _client;
}

export function resetSupabaseClient(): void {
  _client = null;
}
