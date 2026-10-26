import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireSession } from '../_shared/session-auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Surrogate-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

async function download(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const session = await requireSession(req);
  if (session instanceof Response) return session;
  const ip = getClientIp(req);
  const limit = await checkRateLimitDurable({ functionName: 'download-expense-receipt',
    bucketKey: `session:${session.sessionId}`, ipAddress: ip, maxPerWindow: 30, windowSec: 60 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSec);
  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !('expense_id' in body)
    || typeof body.expense_id !== 'string' || !UUID.test(body.expense_id)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const admin = getAdminClient();
  const args = { p_session_id: session.sessionId, p_expense_id: body.expense_id };
  const authorized = await admin.rpc('authorize_expense_receipt_download_v1', args);
  if (authorized.error) return authorizationError(authorized.error.code);
  if (typeof authorized.data !== 'string' || !authorized.data) return jsonResponse({ error: 'receipt_unavailable' }, 503);
  const file = await admin.storage.from('expense-receipts').download(authorized.data);
  if (file.error || !file.data) return jsonResponse({ error: 'receipt_unavailable' }, 503);
  // Une révocation ou un remplacement survenu pendant la lecture interdit la réponse.
  const confirmed = await admin.rpc('authorize_expense_receipt_download_v1', args);
  if (confirmed.error) return authorizationError(confirmed.error.code);
  if (confirmed.data !== authorized.data) return jsonResponse({ error: 'receipt_changed' }, 409);
  const extension = /\.(jpg|jpeg|png|webp|pdf)$/i.exec(authorized.data)?.[1]?.toLowerCase() ?? 'bin';
  return new Response(file.data, { headers: { ...corsHeaders,
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="receipt-${body.expense_id}.${extension}"` } });
}

function authorizationError(code: string | undefined): Response {
  if (code === 'PT401') return jsonResponse({ error: 'session_expired' }, 401);
  if (code === 'P0002') return jsonResponse({ error: 'receipt_not_found' }, 404);
  return jsonResponse({ error: 'receipt_unavailable' }, 503);
}

serve(async (req) => {
  try { return noStore(await download(req)); }
  catch { return noStore(jsonResponse({ error: 'receipt_unavailable' }, 503)); }
});
