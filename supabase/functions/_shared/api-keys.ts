// Résolution des clés API nommées injectées par Supabase.
// Une configuration moderne invalide ne doit jamais utiliser une clé legacy.
function resolveApiKey(variable: string, legacyVariable: string, prefix: string): string | null {
  // Activation explicite par environnement pour préserver les appelants dev.
  const name = Deno.env.get('SUPABASE_API_KEY_NAME');
  if (name === undefined) return Deno.env.get(legacyVariable) || null;
  const configured = Deno.env.get(variable);
  if (!name || configured === undefined) throw new Error(`Missing ${variable} configuration`);
  let keys: unknown;
  try { keys = JSON.parse(configured); }
  catch { throw new Error(`Invalid ${variable} configuration`); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new Error(`Invalid ${variable} configuration`);
  }
  const key = (keys as Record<string, unknown>)[name];
  if (typeof key !== 'string' || !key.startsWith(prefix) || key.length <= prefix.length) {
    throw new Error(`Missing named key in ${variable}`);
  }
  return key;
}

export function getServerApiKey(): string | null {
  return resolveApiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_');
}

export function getPublishableApiKey(): string | null {
  return resolveApiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY', 'sb_publishable_');
}
