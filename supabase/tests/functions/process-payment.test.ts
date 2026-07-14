import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/process-payment`;

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('process-payment', () => {
  let accessToken: string;
  let sessionId: string;
  let productIds: string[] = [];
  // S78 (D-6) : le prix ligne est canonique SERVEUR depuis S50
  // (_resolve_line_price_v1) — les unit_price client sont ignorés. Les
  // assertions de montants se calculent depuis les retail_price réels.
  let priceA = 0;
  let priceB = 0;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Reset any lockout and get admin profile
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', 'EMP000');
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('employee_code', 'EMP000')
      .single();
    if (!profile) throw new Error('Seed not loaded — run supabase db reset');

    accessToken = await loginAs('EMP000', '1234');

    // Close any existing open session for admin
    await admin
      .from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: profile.id })
      .eq('opened_by', profile.id)
      .eq('status', 'open');

    // Create a new open POS session via direct insert
    const { data: session, error: sessionErr } = await admin
      .from('pos_sessions')
      .insert({ opened_by: profile.id, opening_cash: 100000 })
      .select('id')
      .single();
    if (sessionErr || !session) {
      throw new Error(`POS session creation failed: ${JSON.stringify(sessionErr)}`);
    }
    sessionId = session.id;

    // S78 : LIMIT 2 sans filtre tombait sur des produits display/inactifs/
    // stock 0 → 409 insufficient_stock. Sélection filtrée + déterministe.
    const { data: products } = await admin.from('products')
      .select('id, retail_price')
      .eq('is_active', true)
      .is('deleted_at', null)
      .eq('is_display_item', false)
      .eq('is_test', false)
      .gt('retail_price', 0)
      .order('created_at', { ascending: true })
      .limit(2);
    productIds = (products ?? []).map((p: { id: string }) => p.id);
    if (productIds.length < 2) throw new Error('Need at least 2 eligible products in seed');
    priceA = Number((products![0] as { retail_price: number }).retail_price);
    priceB = Number((products![1] as { retail_price: number }).retail_price);

    // Reset stock to ensure tests pass
    await admin
      .from('products')
      .update({ current_stock: 50 })
      .in('id', productIds);
  });

  // S78 (D-7) : la session ouverte au beforeAll n'était JAMAIS refermée —
  // fuite durable qui cassait les fixtures pgTAP one_open_session_per_user
  // du run suivant (pollution inter-runs documentée S77).
  afterAll(async () => {
    if (!sessionId) return;
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin
      .from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('status', 'open');
  });

  it('creates an order on valid payload', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [
          { product_id: productIds[0], quantity: 1, unit_price: priceA },
          { product_id: productIds[1], quantity: 1, unit_price: priceB },
        ],
        payment: { method: 'cash', amount: priceA + priceB, cash_received: priceA + priceB + 20000, change_given: 20000 },
      }),
    });
    const body = await res.json();
    expect(res.status, `body=${JSON.stringify(body)}`).toBe(200);
    expect(String(body.order_number)).toMatch(/^#/);
    expect(Number(body.subtotal)).toBe(priceA + priceB);
    expect(Number(body.change_given)).toBe(20000);
  });

  it('rejects on insufficient stock', async () => {
    // S78 (D-6) : allow_negative_stock est TRUE sur la DB dev vivante — la
    // vente à 99999 passait alors LÉGITIMEMENT (et créait une commande de
    // ~2 Mds IDR dans les données dev !). Flag forcé à false le temps du
    // test, restauré dans finally (exécution sérielle).
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: cfg } = await admin.from('business_config')
      .select('id, allow_negative_stock').limit(1).single();
    const hadNegative = cfg?.allow_negative_stock === true;
    if (hadNegative) {
      await admin.from('business_config')
        .update({ allow_negative_stock: false }).eq('id', cfg!.id);
    }
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          order_type: 'dine_in',
          items: [{ product_id: productIds[0], quantity: 99999, unit_price: priceA }],
          payment: { method: 'cash', amount: priceA * 99999, cash_received: priceA * 99999 },
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('insufficient_stock');
    } finally {
      if (hadNegative) {
        await admin.from('business_config')
          .update({ allow_negative_stock: true }).eq('id', cfg!.id);
      }
    }
  });

  it('returns existing order on duplicate idempotency_key (D8)', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      session_id: sessionId,
      order_type: 'dine_in' as const,
      items: [
        { product_id: productIds[0], quantity: 1, unit_price: priceA },
        { product_id: productIds[1], quantity: 1, unit_price: priceB },
      ],
      payment: { method: 'cash' as const, amount: priceA + priceB, cash_received: priceA + priceB + 20000, change_given: 20000 },
      idempotency_key: idempotencyKey,
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    // 1st POST — should create the order
    const first = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    const firstBody = await first.json();
    expect(first.status, `body=${JSON.stringify(firstBody)}`).toBe(200);
    expect(firstBody.order_id).toBeTruthy();

    // 2nd POST — same key, same payload → must return the same order_id (replay)
    const second = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.order_id).toBe(firstBody.order_id);
    // RPC should flag the replay so the client can act on it
    expect(secondBody.idempotent_replay).toBe(true);
  });

  it('rejects when idempotency_key is not a UUID', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 1, unit_price: priceA }],
        payment: { method: 'cash', amount: priceA, cash_received: priceA },
        idempotency_key: 'not-a-uuid',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_idempotency_key');
  });

  it('accepts customer_id and loyalty_points_redeemed in payload and forwards to RPC', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: customer } = await admin
      .from('customers')
      .select('id, loyalty_points')
      .eq('name', 'Loyal Gold Customer')
      .single();
    if (!customer) return;

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 1, unit_price: priceA }],
        payment: { method: 'cash', amount: priceA, cash_received: priceA },
        customer_id: customer.id,
        loyalty_points_redeemed: 500,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_id).toBeTruthy();
  });
});
