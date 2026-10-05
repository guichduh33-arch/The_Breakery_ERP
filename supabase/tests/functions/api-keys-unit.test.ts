import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishableApiKey, getServerApiKey } from '../../functions/_shared/api-keys';

let env: Record<string, string>;
beforeEach(() => {
  env = { SUPABASE_SERVICE_ROLE_KEY: 'legacy-server', SUPABASE_ANON_KEY: 'legacy-public' };
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } });
});
afterEach(() => vi.unstubAllGlobals());

describe('résolution des clés API', () => {
  it('conserve les environnements sans nouvelles clés', () => {
    expect(getServerApiKey()).toBe('legacy-server');
    expect(getPublishableApiKey()).toBe('legacy-public');
  });
  it('préfère les clés modernes, sans confondre client et serveur', () => {
    env.API_KEY_NAME = 'default';
    env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: 'sb_secret_test-only' });
    env.SUPABASE_PUBLISHABLE_KEYS = JSON.stringify({ default: 'sb_publishable_test-only' });
    expect(getServerApiKey()).toBe('sb_secret_test-only');
    expect(getPublishableApiKey()).toBe('sb_publishable_test-only');
  });
  it('sélectionne uniquement le nom configuré', () => {
    env.API_KEY_NAME = 'release';
    env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: 'sb_secret_old', release: 'sb_secret_new' });
    expect(getServerApiKey()).toBe('sb_secret_new');
  });
  it.each(['', '{', 'null', '[]', '{}', '{"default":42}', '{"default":"sb_publishable_wrong"}'])
    ('refuse une configuration serveur invalide sans fallback : %s', configured => {
      env.API_KEY_NAME = 'default';
      env.SUPABASE_SECRET_KEYS = configured;
      expect(getServerApiKey).toThrow();
    });
  it('refuse une clé serveur à la place de la clé publique', () => {
    env.API_KEY_NAME = 'default';
    env.SUPABASE_PUBLISHABLE_KEYS = '{"default":"sb_secret_wrong"}';
    expect(getPublishableApiKey).toThrow();
  });
  it('ne révèle ni la configuration ni la valeur dans les erreurs', () => {
    env.API_KEY_NAME = 'default';
    env.SUPABASE_SECRET_KEYS = 'test-private-value';
    expect(getServerApiKey).toThrow('Invalid SUPABASE_SECRET_KEYS configuration');
  });
  it('retourne null si aucune clé ne peut être résolue', () => {
    env = {};
    expect(getServerApiKey()).toBeNull();
    expect(getPublishableApiKey()).toBeNull();
  });
  it('refuse une activation sans les nouvelles clés', () => {
    env.API_KEY_NAME = 'default';
    expect(getServerApiKey).toThrow('Missing SUPABASE_SECRET_KEYS configuration');
  });
  it('ignore les clés modernes tant que la migration n’est pas activée', () => {
    env.SUPABASE_SECRET_KEYS = '{"default":"sb_secret_test-only"}';
    expect(getServerApiKey()).toBe('legacy-server');
  });
});
