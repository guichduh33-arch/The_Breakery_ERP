import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin, isManagerPinBlocked, recordManagerPinFailure, MANAGER_PIN_FAIL_WINDOW_SEC } from '../_shared/manager-pin.ts';
import { getActingAuthUserId } from '../_shared/acting-user.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { handleCancelUnpaid } from './handler.ts';

serve((req) => handleCancelUnpaid(req, {
  cors: handleCors,
  json: jsonResponse,
  actor: getActingAuthUserId,
  rateLimit: async (request) => {
    const ip = getClientIp(request);
    const result = await checkRateLimitDurable({ functionName: 'cancel-unpaid-order',
      bucketKey: `ip:${ip}`, ipAddress: ip, maxPerWindow: 10, windowSec: 60 });
    return result.allowed ? null : rateLimitedResponse(result.retryAfterSec);
  },
  manager: async (pin, request) => {
    const ip = getClientIp(request);
    if (await isManagerPinBlocked(ip)) return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
    const result = await verifyManagerPin(pin);
    if (result.ok) return result.manager_profile_id;
    if (result.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (result.reason === 'no_match') {
      const failed = await recordManagerPinFailure(ip, 'cancel-unpaid-order');
      return failed.blocked ? rateLimitedResponse(failed.retryAfterSec) : jsonResponse({ error: 'wrong_pin' }, 401);
    }
    return jsonResponse({ error: 'authorization_unavailable' }, 503);
  },
  execute: async (args) => {
    const result = await getAdminClient().rpc('cancel_unpaid_order_v1', args);
    if (result.error) console.error('[cancel-unpaid-order] rpc', result.error.code);
    return result;
  },
}).catch(() => jsonResponse({ error: 'authorization_unavailable' }, 503)));
