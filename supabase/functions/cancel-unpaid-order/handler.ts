// Contrat injectable : tests locaux sans Deno ni client réseau.
export interface CancelPayload {
  order_id: string;
  expected_updated_at: string;
  expected_items: Record<string, unknown>[];
  losses: { id: string; waste_qty: number }[];
  reason: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parsePayload(value: unknown): CancelPayload | null {
  if (!object(value) || typeof value.order_id !== 'string' || !UUID.test(value.order_id)
    || typeof value.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(value.expected_updated_at))
    || typeof value.reason !== 'string' || value.reason.trim().length < 3
    || !Array.isArray(value.expected_items) || value.expected_items.length === 0
    || !value.expected_items.every((item) => object(item) && typeof item.id === 'string' && UUID.test(item.id))
    || !Array.isArray(value.losses) || !value.losses.every((item) => object(item)
      && typeof item.id === 'string' && UUID.test(item.id)
      && typeof item.waste_qty === 'number' && Number.isFinite(item.waste_qty) && item.waste_qty >= 0)) return null;
  const expected = value.expected_items as Record<string, unknown>[];
  const losses = value.losses as CancelPayload['losses'];
  if (new Set(expected.map((item) => item.id)).size !== expected.length
    || new Set(losses.map((item) => item.id)).size !== losses.length) return null;
  return { order_id: value.order_id, expected_updated_at: value.expected_updated_at,
    expected_items: expected, losses, reason: value.reason.trim() };
}
export interface CancelDependencies {
  cors: (req: Request) => Response | null;
  json: (body: unknown, status?: number) => Response;
  rateLimit: (req: Request) => Promise<Response | null>;
  actor: (req: Request) => Promise<string | null>;
  manager: (pin: string, req: Request) => Promise<string | Response>;
  execute: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export async function handleCancelUnpaid(req: Request, deps: CancelDependencies): Promise<Response> {
  const cors = deps.cors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return deps.json({ error: 'method_not_allowed' }, 405);
  const limited = await deps.rateLimit(req);
  if (limited) return limited;
  const actor = await deps.actor(req);
  if (!actor) return deps.json({ error: 'not_authenticated' }, 401);
  const pin = req.headers.get('x-manager-pin');
  if (!pin) return deps.json({ error: 'missing_manager_pin' }, 400);
  const key = req.headers.get('x-idempotency-key');
  if (!key || !UUID.test(key)) return deps.json({ error: 'invalid_idempotency_key' }, 400);
  let raw: unknown;
  try { raw = await req.json(); } catch { return deps.json({ error: 'invalid_json' }, 400); }
  const body = parsePayload(raw);
  if (!body) return deps.json({ error: 'invalid_request' }, 400);
  const manager = await deps.manager(pin, req);
  if (manager instanceof Response) return manager;
  const { data, error } = await deps.execute({
    p_order_id: body.order_id, p_expected_updated_at: body.expected_updated_at,
    p_expected_items: body.expected_items, p_losses: body.losses,
    p_reason: body.reason, p_authorized_by: manager, p_acting_auth_user_id: actor,
    p_idempotency_key: key,
  });
  if (error) {
    const status = ({ P0001: 401, P0002: 404, P0003: 403, P0014: 409, '23514': 422, '22023': 400, '40P01': 503, '40001': 503 } as Record<string, number>)[error.code ?? ''] ?? 500;
    const message = error.code === 'P0014' ? 'order_changed' : status === 503 ? 'retry_required' : 'cancel_unpaid_failed';
    return deps.json({ error: message }, status);
  }
  return deps.json(data);
}
