import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../functions/_shared/jwt';

let env: Record<string, string>;
const payload = { sub: 'test-user', role: 'authenticated', exp: 2000000000, app_metadata: { provider: 'pin' } };
beforeEach(() => {
  env = {};
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } });
});
afterEach(() => vi.unstubAllGlobals());

async function signatureValid(jwt: string, secret: string): Promise<boolean> {
  const [header, body, signature] = jwt.split('.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(`${header}.${body}`));
}

describe('signature PIN HS256 avec identifiant de clé', () => {
  it('garde le header legacy quand aucun identifiant n’est configuré', async () => {
    const jwt = await signJwt(payload, 'test-only-first-secret');
    expect(JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(await signatureValid(jwt, 'test-only-first-secret')).toBe(true);
  });
  it('signe kid et conserve les claims', async () => {
    env.JWT_SIGNING_KEY_ID = '11111111-2222-4333-8444-555555555555';
    const jwt = await signJwt(payload, 'test-only-second-secret');
    const [header, body] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'HS256', typ: 'JWT', kid: env.JWT_SIGNING_KEY_ID,
    });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual(payload);
    expect(await signatureValid(jwt, 'test-only-second-secret')).toBe(true);
    expect(await signatureValid(jwt, 'test-only-first-secret')).toBe(false);
  });
  it.each(['', 'not-a-key-id', '11111111-2222-4333-8444-555555555555 extra'])
    ('refuse un identifiant invalide : %s', async kid => {
      env.JWT_SIGNING_KEY_ID = kid;
      await expect(signJwt(payload, 'test-only-secret')).rejects.toThrow('Invalid JWT_SIGNING_KEY_ID configuration');
    });
  it('ne réutilise pas la signature de l’ancienne clé après changement du secret', async () => {
    await signJwt(payload, 'test-only-old-secret');
    const jwt = await signJwt(payload, 'test-only-new-secret');
    expect(await signatureValid(jwt, 'test-only-new-secret')).toBe(true);
    expect(await signatureValid(jwt, 'test-only-old-secret')).toBe(false);
  });
  it('couvre le kid par la signature', async () => {
    env.JWT_SIGNING_KEY_ID = '11111111-2222-4333-8444-555555555555';
    const jwt = await signJwt(payload, 'test-only-secret');
    const [, body, signature] = jwt.split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).toString('base64url');
    expect(await signatureValid(`${header}.${body}.${signature}`, 'test-only-secret')).toBe(false);
  });
});
