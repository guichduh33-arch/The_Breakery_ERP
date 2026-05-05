import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('mark_item_served RPC', () => {
  let admin: ReturnType<typeof createClient>;
  let authedClient: ReturnType<typeof createClient>;
  let sessionId: string;
  let productId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    await admin.from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', 'EMP000');

    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();
    if (!profile) throw new Error('Seed not loaded — run supabase db reset');

    const loginRes = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile.id, pin: '1234', device_type: 'pos' }),
    });
    const loginBody = await loginRes.json();
    if (!loginBody.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);

    authedClient = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${loginBody.auth.access_token}` } },
    });

    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: profile.id })
      .eq('opened_by', profile.id).eq('status', 'open');

    const { data: session, error: sessionErr } = await admin.from('pos_sessions')
      .insert({ opened_by: profile.id, opening_cash: 100000 }).select('id').single();
    if (sessionErr || !session) throw new Error(`POS session failed: ${JSON.stringify(sessionErr)}`);
    sessionId = session.id;

    const { data: products } = await admin.from('products').select('id').limit(1);
    if (!products?.length) throw new Error('Need at least 1 product in seed');
    productId = products[0].id;
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
  });

  async function createReadyItem(): Promise<string> {
    const { data: order, error: orderErr } = await admin.from('orders').insert({
      order_number:  `#TEST-${Date.now()}`,
      session_id:    sessionId,
      order_type:    'dine_in',
      served_by:     '00000000-0000-0000-0000-000000000001',
      subtotal:      35000,
      tax_amount:    0,
      total:         35000,
      status:        'paid',
    }).select('id').single();
    if (orderErr || !order) throw new Error(`Order insert failed: ${JSON.stringify(orderErr)}`);

    const { data: item, error: itemErr } = await admin.from('order_items').insert({
      order_id:       order.id,
      product_id:     productId,
      quantity:       1,
      unit_price:     35000,
      line_total:     35000,
      name_snapshot:  'Test Item',
      kitchen_status: 'ready',
      is_locked:      true,
    }).select('id').single();
    if (itemErr || !item) throw new Error(`Item insert failed: ${JSON.stringify(itemErr)}`);

    return item.id;
  }

  async function createItemWithStatus(status: string): Promise<string> {
    const { data: order, error: orderErr } = await admin.from('orders').insert({
      order_number:  `#TEST-${Date.now()}-${status}`,
      session_id:    sessionId,
      order_type:    'dine_in',
      served_by:     '00000000-0000-0000-0000-000000000001',
      subtotal:      35000,
      tax_amount:    0,
      total:         35000,
      status:        'paid',
    }).select('id').single();
    if (orderErr || !order) throw new Error(`Order insert failed: ${JSON.stringify(orderErr)}`);

    const { data: item, error: itemErr } = await admin.from('order_items').insert({
      order_id:       order.id,
      product_id:     productId,
      quantity:       1,
      unit_price:     35000,
      line_total:     35000,
      name_snapshot:  'Test Item',
      kitchen_status: status,
      is_locked:      status !== 'pending',
    }).select('id').single();
    if (itemErr || !item) throw new Error(`Item insert failed (${status}): ${JSON.stringify(itemErr)}`);

    return item.id;
  }

  it('ready → served: sets kitchen_status, served_at, and served_by', async () => {
    const itemId = await createReadyItem();

    const { data, error } = await authedClient.rpc('mark_item_served', { p_item_id: itemId });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.kitchen_status).toBe('served');
    expect(data.served_at).not.toBeNull();
    expect(data.served_by).not.toBeNull();

    const { data: dbRow } = await admin.from('order_items').select('kitchen_status, served_at, served_by').eq('id', itemId).single();
    expect(dbRow!.kitchen_status).toBe('served');
    expect(dbRow!.served_at).not.toBeNull();
  });

  it('pending → served: raises P0011', async () => {
    const itemId = await createItemWithStatus('pending');

    const { data, error } = await authedClient.rpc('mark_item_served', { p_item_id: itemId });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0011');
    expect(error!.message).toMatch(/Item must be ready before serving/);
  });

  it('preparing → served: raises P0011', async () => {
    const itemId = await createItemWithStatus('preparing');

    const { data, error } = await authedClient.rpc('mark_item_served', { p_item_id: itemId });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0011');
    expect(error!.message).toMatch(/Item must be ready before serving/);
  });

  it('served → served (idempotent failure): raises P0011', async () => {
    const itemId = await createItemWithStatus('served');

    const { data, error } = await authedClient.rpc('mark_item_served', { p_item_id: itemId });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0011');
    expect(error!.message).toMatch(/Item must be ready before serving/);
  });

  it('nonexistent UUID → raises P0011', async () => {
    const fakeId = '00000000-dead-beef-0000-000000000000';

    const { data, error } = await authedClient.rpc('mark_item_served', { p_item_id: fakeId });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0011');
    expect(error!.message).toMatch(/Item must be ready before serving/);
  });
});
