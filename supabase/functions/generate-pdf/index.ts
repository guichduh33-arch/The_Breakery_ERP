// supabase/functions/generate-pdf/index.ts
//
// S29 Wave 3.B.2 — EF générique : renders one of 12 PDF templates and uploads to
// reports-exports/<user_id>/yyyy/mm/<filename>.pdf.
//
// Headers:
//   authorization:     Bearer JWT (required, user impersonation for perm check)
//   x-idempotency-key: optional UUID v4
//
// Body: {
//   template: TemplateName (one of 12),
//   data:     object (template-specific),
//   period?:  { start: string, end: string },
//   filename: string (no extension),
//   comparePrevious?: { data: object }
// }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { getIdempotencyKey, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { initLayout, type BusinessInfo } from '../_shared/pdf-layout.ts';
import { TEMPLATES, type TemplateName } from '../_shared/pdf-templates/index.ts';

interface Body {
  template:         TemplateName;
  data:             Record<string, unknown> | unknown[];
  period?:          { start: string; end: string };
  filename:         string;
  comparePrevious?: { data: Record<string, unknown> | unknown[] };
}

const SAFE_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  // Rate limit FIRST (per-IP, 30/min)
  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'generate-pdf',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 30,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  // Idempotency (optional — validates format if present)
  try {
    getIdempotencyKey(req);
  } catch (err) {
    if (err instanceof InvalidIdempotencyKeyError) return jsonResponse({ error: err.code, message: err.message }, 400);
    throw err;
  }

  // Auth
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'authorization_required' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: 'invalid_auth' }, 401);

  // Parse body
  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object') return jsonResponse({ error: 'invalid_body' }, 400);

  const tplReg = TEMPLATES[body.template];
  if (!tplReg) return jsonResponse({ error: 'invalid_template', message: `Unknown template: ${body.template}` }, 400);
  if (!body.filename || !SAFE_FILENAME_REGEX.test(body.filename)) {
    return jsonResponse({ error: 'invalid_filename', message: 'filename must match [A-Za-z0-9._-]+' }, 400);
  }

  // Permission check (caller must have the template's required permission)
  const { data: hasPerm, error: permErr } = await userClient.rpc('has_permission', {
    p_uid:  userData.user.id,
    p_perm: tplReg.permission,
  });
  if (permErr) return jsonResponse({ error: 'permission_check_failed', detail: permErr.message }, 500);
  if (!hasPerm) return jsonResponse({ error: 'permission_denied', required: tplReg.permission }, 403);

  // Business info (for header) — real business_config columns (the historical
  // select referenced phantom business_name/address columns and always fell
  // back to the hardcoded defaults; fixed with migration 20260716000168).
  const admin = getAdminClient();
  const { data: biz } = await admin
    .from('business_config')
    .select('name, fiscal_address, npwp, logo_url')
    .limit(1)
    .maybeSingle();
  const business: BusinessInfo = {
    name:    biz?.name || 'The Breakery',
    npwp:    biz?.npwp || undefined,
    address: biz?.fiscal_address || undefined,
    logoUrl: biz?.logo_url || undefined,
  };

  // Build PDF
  let pdfBytes: Uint8Array;
  try {
    const ctx = await initLayout(business);
    await tplReg.render(ctx, body.data, body.period ?? null);
    if (body.comparePrevious) {
      // Render previous period as additional page(s).
      await tplReg.render(ctx, body.comparePrevious.data, body.period ?? null);
    }
    pdfBytes = await ctx.doc.save();
  } catch (err) {
    console.error('[generate-pdf] generation failed', err);
    return jsonResponse({ error: 'generation_failed', detail: String(err) }, 500);
  }

  // Upload to reports-exports/<user_id>/yyyy/mm/<filename>.pdf
  // S78 : upload via service role (miroir generate-zreport-pdf) — l'upsert
  // d'un path existant est un UPDATE storage.objects que la RLS user refuse
  // (« new row violates row-level security ») : tout re-export du même
  // filename répondait 500 upload_failed. La permission du caller est déjà
  // vérifiée plus haut (has_permission), le path reste scoped par user_id.
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
  const path = `${userData.user.id}/${yyyy}/${mm}/${body.filename}.pdf`;

  const { error: uploadErr } = await admin.storage
    .from('reports-exports')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    console.error('[generate-pdf] upload failed', uploadErr);
    return jsonResponse({ error: 'upload_failed', detail: uploadErr.message }, 500);
  }

  const { data: signed, error: signErr } = await admin.storage
    .from('reports-exports')
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) {
    return jsonResponse({ error: 'sign_url_failed', detail: signErr?.message ?? 'no signed url' }, 500);
  }

  return jsonResponse({
    storage_path: `reports-exports/${path}`,
    signed_url:   signed.signedUrl,
    expires_at:   new Date(Date.now() + 3600_000).toISOString(),
  });
});
