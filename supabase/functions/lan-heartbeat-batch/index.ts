// supabase/functions/lan-heartbeat-batch/index.ts
// Spec 006x lot 2 — réception du heartbeat AGRÉGÉ poussé par le hub LAN
// (print-bridge), qui devient l'écrivain cloud unique de
// lan_devices.last_heartbeat_at en mode nominal.
//
// Authentication : header `x-hub-secret` == LAN_HEARTBEAT_SECRET (env EF).
// Le hub n'a AUCUNE credential Supabase (pas de service key sur le PC
// boutique) : même pattern que notification-dispatch (--no-verify-jwt +
// secret partagé en header, jamais en query ni en body — les bodies et
// query strings sont loggés). Si LAN_HEARTBEAT_SECRET n'est pas posée,
// l'EF est désactivée (503) : activation explicite.
//
// Body : { device_codes: string[] } (max 100). Appelle
// update_lan_heartbeat_v3 (batch, service_role) ; les codes
// inconnus/soft-deleted sont ignorés par la RPC et renvoyés dans
// `unknown` pour l'observabilité côté hub.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

const MAX_BATCH = 100;

export async function handleLanHeartbeat(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const envSecret = Deno.env.get('LAN_HEARTBEAT_SECRET');
  if (!envSecret) {
    return jsonResponse({ error: 'disabled', detail: 'LAN_HEARTBEAT_SECRET not set' }, 503);
  }
  const headerSecret = req.headers.get('x-hub-secret');
  if (headerSecret !== envSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const codes = (body as { device_codes?: unknown }).device_codes;
  if (
    !Array.isArray(codes) ||
    codes.length > MAX_BATCH ||
    !codes.every((c) => typeof c === 'string' && c.length > 0 && c.length <= 64)
  ) {
    return jsonResponse({ error: 'invalid_device_codes' }, 400);
  }

  const deduped = [...new Set(codes as string[])];
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('update_lan_heartbeat_v3', {
    p_device_codes: deduped,
  });
  if (error) {
    return jsonResponse({ error: 'rpc_error', detail: error.message }, 500);
  }

  const touched = ((data ?? []) as { code: string }[]).map((r) => r.code);
  const registry = await admin.rpc('get_lan_registry_v1');
  if (registry.error) return jsonResponse({ error: 'registry_unavailable' }, 503);
  const printers = await admin.from('lan_devices').select('code, ip_address, port')
    .eq('device_type', 'printer').eq('is_active', true).is('deleted_at', null);
  if (printers.error) return jsonResponse({ error: 'registry_unavailable' }, 503);
  const requestedPrinterCodes = (printers.data ?? [])
    .map((printer) => printer.code)
    .filter((code) => deduped.includes(code));
  if (requestedPrinterCodes.length > 0) {
    const printerHeartbeat = await admin.from('lan_devices')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .in('code', requestedPrinterCodes)
      .eq('device_type', 'printer')
      .eq('is_active', true)
      .is('deleted_at', null)
      .select('code');
    if (printerHeartbeat.error) {
      return jsonResponse({ error: 'printer_heartbeat_error', detail: printerHeartbeat.error.message }, 500);
    }
    for (const printer of printerHeartbeat.data ?? []) {
      if (!touched.includes(printer.code)) touched.push(printer.code);
    }
  }
  const unknown = deduped.filter((c) => !touched.includes(c));
  const value = registry.data as { printers?: { ip_address: string; port: number }[] };
  const printerCodes = new Map((printers.data ?? []).map((printer) => [
    `${printer.ip_address}:${printer.port}`,
    printer.code,
  ]));
  const enriched = {
    ...value,
    printers: (value.printers ?? []).map((printer) => ({
      ...printer,
      code: printerCodes.get(`${printer.ip_address}:${printer.port}`),
    })),
  };
  return jsonResponse({ touched, unknown, registry: enriched });
}

serve(handleLanHeartbeat);
