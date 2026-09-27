import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession, hashSessionToken } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function handleLanDevice(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const ip = getClientIp(req);
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return jsonResponse({ error: 'invalid_request' }, 400);
  const input = body as Record<string, unknown>;
  // Les terminaux du magasin partagent une IP ; séparer le trafic de présence
  // des tentatives d'activation pour éviter de bloquer une flotte légitime.
  const heartbeat = input.action === 'heartbeat';
  const limit = await checkRateLimitDurable({
    functionName: 'lan-device-access',
    bucketKey: (heartbeat ? 'heartbeat:' : 'activation:') + ip,
    ipAddress: ip,
    maxPerWindow: heartbeat ? 1200 : 60,
    windowSec: 60,
  });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSec);
  const admin = getAdminClient();
  if (['list', 'issue', 'revoke', 'permissions'].includes(String(input.action))) {
    const session = await requireSession(req);
    if (session instanceof Response) return session;
    if (
      input.action !== 'list' &&
      (typeof input.device_id !== 'string' || !UUID.test(input.device_id))
    )
      return jsonResponse({ error: 'invalid_device' }, 400);
    if (
      input.action === 'permissions' &&
      (!Array.isArray(input.permissions) ||
        input.permissions.length > 12 ||
        !input.permissions.every((p) => typeof p === 'string'))
    )
      return jsonResponse({ error: 'invalid_permissions' }, 400);
    const { data, error } = await admin.rpc('manage_lan_device_v1', {
      p_actor_id: session.userId,
      p_action: input.action,
      p_device_id: input.device_id ?? null,
      p_permissions: input.permissions ?? null,
    });
    if (error)
      return jsonResponse(
        { error: error.code === '42501' ? 'permission_denied' : 'invalid_request' },
        error.code === '42501' ? 403 : 400,
      );
    return jsonResponse(data);
  }
  if (input.action !== 'pair' && input.action !== 'heartbeat')
    return jsonResponse({ error: 'invalid_action' }, 400);
  const secret = req.headers.get('x-lan-secret') ?? '';
  const code = (req.headers.get('x-lan-pairing-code') ?? '').replaceAll('-', '').toLowerCase();
  if (
    !/^[0-9a-f]{64}$/.test(secret) ||
    (input.action === 'pair' && !/^[0-9a-f]{16}$/.test(code)) ||
    (input.action === 'heartbeat' &&
      (typeof input.device_id !== 'string' || !UUID.test(input.device_id)))
  )
    return jsonResponse({ error: 'device_unauthorized' }, 401);
  const { data, error } = await admin.rpc('authenticate_lan_device_v1', {
    p_secret_hash: await hashSessionToken(secret),
    p_pairing_hash: input.action === 'pair' ? await hashSessionToken(code) : null,
    p_device_id: input.action === 'heartbeat' ? input.device_id : null,
  });
  if (error || !data) return jsonResponse({ error: 'device_unauthorized' }, 401);
  if (input.action === 'heartbeat') {
    const result = await admin.rpc('update_lan_heartbeat_v3', { p_device_codes: [data.code] });
    if (result.error) return jsonResponse({ error: 'heartbeat_unavailable' }, 503);
  }
  return jsonResponse(data);
}
serve(async (req) => {
  try {
    return await handleLanDevice(req);
  } catch {
    return jsonResponse({ error: 'lan_unavailable' }, 503);
  }
});
