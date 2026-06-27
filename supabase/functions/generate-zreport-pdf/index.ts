// supabase/functions/generate-zreport-pdf/index.ts
//
// S29 Wave 3.B.3 — EF spécifique Z-Report : reads snapshot via get_zreport_snapshot_v1,
// renders zreport template, uploads to zreports/<yyyy>/<mm>/<shift_id>_<ts>.pdf via service role,
// updates z_reports.pdf_storage_path.
//
// Headers:
//   authorization:     Bearer JWT (required, user must have zreports.read)
//   x-idempotency-key: REQUIRED UUID v4
//
// Body: { zreport_id: UUID }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { getIdempotencyKey, MissingIdempotencyKeyError, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { getActingAuthUserId } from '../_shared/acting-user.ts';
import { initLayout, type BusinessInfo } from '../_shared/pdf-layout.ts';
import { render as renderZReport, type ZReportEnvelope } from '../_shared/pdf-templates/zreport.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  // Rate limit (per-IP, 10/min — Z-Report PDFs are heavier than generic reports)
  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'generate-zreport-pdf',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  // Idempotency REQUIRED (Z-Reports are immutable legal PDFs)
  try {
    getIdempotencyKey(req, { required: true });
  } catch (err) {
    if (err instanceof MissingIdempotencyKeyError) return jsonResponse({ error: err.code, message: err.message }, 400);
    if (err instanceof InvalidIdempotencyKeyError) return jsonResponse({ error: err.code, message: err.message }, 400);
    throw err;
  }

  // Auth — verify the PIN-JWT signature server-side. GoTrue (asymmetric ES256)
  // cannot validate the HS256 PIN-JWTs the app sends, so `auth.getUser()` always
  // 401'd under PIN-auth (the dominant mode) — the EF was effectively broken.
  // getActingAuthUserId VERIFIES the HMAC signature (JWT_SECRET) and returns the
  // `sub`; the snapshot RPC below independently enforces the zreports.read perm.
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'authorization_required' }, 401);

  const actingUserId = await getActingAuthUserId(req);
  if (!actingUserId) return jsonResponse({ error: 'invalid_auth' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // Parse body
  let body: { zreport_id?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (!body.zreport_id || !UUID_REGEX.test(body.zreport_id)) {
    return jsonResponse({ error: 'invalid_zreport_id' }, 400);
  }

  // Fetch snapshot via user JWT — perm check (zreports.read) is enforced inside RPC
  const { data: snapData, error: snapErr } = await userClient.rpc('get_zreport_snapshot_v1', {
    p_zreport_id: body.zreport_id,
  });
  if (snapErr) {
    if ((snapErr as { code?: string }).code === '42501') return jsonResponse({ error: 'permission_denied' }, 403);
    if ((snapErr as { code?: string }).code === 'P0002') return jsonResponse({ error: 'zreport_not_found' }, 404);
    return jsonResponse({ error: 'rpc_failed', detail: snapErr.message }, 500);
  }
  if (!snapData) return jsonResponse({ error: 'zreport_not_found' }, 404);

  const admin = getAdminClient();

  // Idempotent replay: if pdf_storage_path is already set, re-sign and return early
  const existingPath = (snapData as { pdf_storage_path?: string }).pdf_storage_path;
  if (existingPath) {
    const storagePath = existingPath.replace(/^zreports\//, '');
    const { data: signed, error: signErr } = await admin.storage
      .from('zreports')
      .createSignedUrl(storagePath, 3600);
    if (signErr || !signed?.signedUrl) {
      return jsonResponse({ error: 'sign_url_failed', detail: signErr?.message ?? 'no signed url' }, 500);
    }
    return jsonResponse({
      storage_path:      existingPath,
      signed_url:        signed.signedUrl,
      expires_at:        new Date(Date.now() + 3600_000).toISOString(),
      status:            (snapData as { status: string }).status,
      idempotent_replay: true,
    });
  }

  // Build PDF
  const { data: biz } = await admin
    .from('business_config')
    .select('business_name, npwp, address')
    .limit(1)
    .maybeSingle();
  const business: BusinessInfo = {
    name:    biz?.business_name || 'The Breakery',
    npwp:    biz?.npwp || undefined,
    address: biz?.address || undefined,
  };

  const envelope = snapData as ZReportEnvelope;
  let pdfBytes: Uint8Array;
  try {
    const ctx = await initLayout(business);
    await renderZReport(ctx, envelope, null);
    pdfBytes = await ctx.doc.save();
  } catch (err) {
    console.error('[generate-zreport-pdf] generation failed', err);
    return jsonResponse({ error: 'generation_failed', detail: String(err) }, 500);
  }

  // Upload to zreports/<yyyy>/<mm>/<shift_id>_<ts>.pdf via service role
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ts   = now.toISOString().replace(/[:.]/g, '-');
  const shiftId = (snapData as { shift_id: string }).shift_id;
  const storagePath = `${yyyy}/${mm}/${shiftId}_${ts}.pdf`;
  const fullPath    = `zreports/${storagePath}`;

  // upsert:true — two concurrent generations for the same z_report (before
  // pdf_storage_path is persisted) could otherwise collide on an identical
  // path and fail the second caller; overwriting the identical PDF is safe.
  const { error: uploadErr } = await admin.storage
    .from('zreports')
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    console.error('[generate-zreport-pdf] upload failed', uploadErr);
    return jsonResponse({ error: 'upload_failed', detail: uploadErr.message }, 500);
  }

  // Persist storage path on z_reports row
  const { error: updErr } = await admin
    .from('z_reports')
    .update({ pdf_storage_path: fullPath })
    .eq('id', body.zreport_id);
  if (updErr) console.error('[generate-zreport-pdf] update pdf_storage_path failed', updErr);

  // Create signed URL (1 hour)
  const { data: signed, error: signErr } = await admin.storage
    .from('zreports')
    .createSignedUrl(storagePath, 3600);
  if (signErr || !signed?.signedUrl) {
    return jsonResponse({ error: 'sign_url_failed', detail: signErr?.message ?? 'no signed url' }, 500);
  }

  return jsonResponse({
    storage_path:      fullPath,
    signed_url:        signed.signedUrl,
    expires_at:        new Date(Date.now() + 3600_000).toISOString(),
    status:            (snapData as { status: string }).status,
    idempotent_replay: false,
  });
});
