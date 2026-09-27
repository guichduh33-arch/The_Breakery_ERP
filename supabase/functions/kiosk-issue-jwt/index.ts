// Appairage écran : session administrateur pour créer/révoquer, secret propre
// à l'appareil pour renouveler. Aucun nom d'écran ne vaut authentification.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession, hashSessionToken } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { getJwtSecret, signJwt } from '../_shared/jwt.ts';

const HEX_SECRET = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_SECONDS = 15 * 60;

export async function handleKiosk(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const ip = getClientIp(req);
  const limit = await checkRateLimitDurable({
    functionName: 'kiosk-issue-jwt', bucketKey: 'ip:' + ip, ipAddress: ip,
    maxPerWindow: 30, windowSec: 60,
  });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSec);
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const input = body as Record<string, unknown>;
  const admin = getAdminClient();
  if (['create', 'revoke', 'list'].includes(String(input.action))) {
    const session = await requireSession(req);
    if (session instanceof Response) return session;
    if (input.action === 'create' && (typeof input.label !== 'string'
      || input.label.trim().length < 1 || input.label.trim().length > 80)) {
      return jsonResponse({ error: 'invalid_label' }, 400);
    }
    if (input.action === 'revoke' && (typeof input.device_id !== 'string' || !UUID.test(input.device_id))) {
      return jsonResponse({ error: 'invalid_device_id' }, 400);
    }
    // La RPC recontrôle le droit actuel : un snapshot de login ne suffit pas.
    const { data, error } = await admin.rpc('manage_display_device_v1', {
      p_actor_id: session.userId, p_action: input.action,
      p_device_id: input.action === 'revoke' ? input.device_id : null,
      p_label: input.action === 'create' ? input.label : null,
    });
    if (error) return jsonResponse({ error: error.code === '42501' ? 'permission_denied' : 'kiosk_unavailable' }, error.code === '42501' ? 403 : 503);
    return jsonResponse(data);
  }
  if (input.action !== 'pair' && input.action !== 'renew') {
    return jsonResponse({ error: 'pairing_required' }, 401);
  }
  const secret = req.headers.get('x-kiosk-secret') ?? '';
  const code = (req.headers.get('x-kiosk-pairing-code') ?? '').replaceAll('-', '').toLowerCase();
  if (!HEX_SECRET.test(secret) || (input.action === 'pair' && !/^[0-9a-f]{16}$/.test(code))) {
    return jsonResponse({ error: 'kiosk_unauthorized' }, 401);
  }
  if (input.action === 'renew' && (typeof input.device_id !== 'string' || !UUID.test(input.device_id))) {
    return jsonResponse({ error: 'kiosk_unauthorized' }, 401);
  }
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return jsonResponse({ error: 'kiosk_unavailable' }, 503);
  const { data, error } = await admin.rpc('authenticate_display_device_v1', {
    p_secret_hash: await hashSessionToken(secret),
    p_pairing_hash: input.action === 'pair' ? await hashSessionToken(code) : null,
    p_device_id: input.action === 'renew' ? input.device_id : null,
  });
  if (error || !data) return jsonResponse({ error: error?.code === '42501' ? 'kiosk_unauthorized' : 'kiosk_unavailable' }, error?.code === '42501' ? 401 : 503);
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt({
    iss: 'supabase', aud: 'authenticated', role: 'kiosk_display', sub: data.id,
    iat: now, exp: now + TTL_SECONDS,
    app_metadata: { provider: 'kiosk', scope: 'display' },
  }, jwtSecret);
  return jsonResponse({ access_token: accessToken, token_type: 'Bearer',
    expires_at: now + TTL_SECONDS,
    kiosk: { kiosk_id: data.id, scope: 'display', device_label: data.label },
  });
}

serve(async (req: Request) => {
  try { return await handleKiosk(req); }
  catch { return jsonResponse({ error: 'kiosk_unavailable' }, 503); }
});
