// apps/pos/src/lib/supabase.ts
import { getSupabaseClient } from '@breakery/supabase';
import { parseAppEnv } from '@breakery/utils';

const env = parseAppEnv(import.meta.env);

export const supabase = getSupabaseClient({
  url: env.VITE_SUPABASE_URL,
  anonKey: env.VITE_SUPABASE_ANON_KEY,
});

export const supabaseUrl = env.VITE_SUPABASE_URL;
