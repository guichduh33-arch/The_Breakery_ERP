// supabase/tests/functions/purchasing-po.test.ts
// Session 13 / Phase 3.A — Live integration tests for the purchasing PO flow.
//
// Coverage:
//   - Manager creates a PO → status='pending'.
//   - Manager partially receives → status='partial', balanced JE posted,
//     stock incremented, GRN row written.
//   - Manager fully receives remainder → status='received', second GRN +
//     second JE posted, lot minted upfront for product with shelf life.
//   - Cancel after receipt refused (PO_ALREADY_RECEIVED).
//   - Cashier role forbidden on create.
//   - Cancel before any receipt succeeds.
//
// Mirrors the inventory-production.test.ts pattern.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PIN_FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  if (!profile) throw new Error(`No profile for ${employeeCode}`);

  const res = await fetch(PIN_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token as string;
}

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

interface ProdRow { id: string; sku: string; }

async function ensureProduct(
  admin: ReturnType<typeof createClient>,
  sku: string,
  name: string,
  unit: string,
  cost: number,
  shelfLifeHours: number | null,
): Promise<ProdRow> {
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  const { data: existing } = await admin
    .from('products')
    .select('id, sku')
    .eq('sku', sku)
    .maybeSingle();
  if (existing) {
    await admin.from('products')
      .update({ current_stock: 0, default_shelf_life_hours: shelfLifeHours, deleted_at: null, is_active: true })
      .eq('id', existing.id);
    return existing as ProdRow;
  }
  const { data, error } = await admin.from('products').insert({
    sku, name, category_id: (cat as { id: string }).id,
    retail_price: 5000, current_stock: 0,
    unit, cost_price: cost, product_type: 'finished', is_active: true,
    default_shelf_life_hours: shelfLifeHours,
  }).select('id, sku').single();
  if (error) throw error;
  return data as ProdRow;
}

async function ensureSupplier(admin: ReturnType<typeof createClient>, code: string, name: string): Promise<{ id: string }> {
  const { data: existing } = await admin.from('suppliers').select('id').eq('code', code).maybeSingle();
  if (existing) {
    await admin.from('suppliers').update({ is_active: true, deleted_at: null }).eq('id', (existing as { id: string }).id);
    return existing as { id: string };
  }
  const { data, error } = await admin.from('suppliers').insert({
    code, name, payment_terms_days: 30, is_active: true,
  }).select('id').single();
  if (error) throw error;
  return data as { id: string };
}

describe('purchasing PO full cycle — integration', () => {
  let managerToken: string;
  let cashierToken: string;
  let prodA:        ProdRow;
  let prodB:        ProdRow;
  let supplier:     { id: string };
  let sectionId:    string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    cashierToken = await loginAs('EMP001', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    prodA = await ensureProduct(admin, 'VT_PO_PROD_A', 'Vitest PO Product A', 'kg', 3000, null);
    prodB = await ensureProduct(admin, 'VT_PO_PROD_B', 'Vitest PO Product B', 'pcs', 4000, 48);
    supplier = await ensureSupplier(admin, 'VT_PO_SUPP', 'Vitest PO Supplier');

    const { data: section } = await admin.from('sections')
      .select('id').is('deleted_at', null).order('display_order').limit(1).single();
    sectionId = (section as { id: string }).id;
  });

  it('full cycle: create → partial receive → full receive', async () => {
    const sb = jwtClient(managerToken);

    // 1. Create PO with 2 lines.
    const { data: createRes, error: createErr } = await sb.rpc('create_purchase_order_v1', {
      p_supplier_id:   supplier.id,
      p_items: [
        { product_id: prodA.id, quantity: 10, unit: 'kg',  unit_cost: 3000 },
        { product_id: prodB.id, quantity: 20, unit: 'pcs', unit_cost: 4000 },
      ],
      p_payment_terms: 'credit',
      p_vat_rate:      0.11,
    });
    expect(createErr).toBeNull();
    const po = createRes as { po_id: string; po_number: string; subtotal: number; vat_amount: number; total_amount: number; status: string };
    expect(po.status).toBe('pending');
    expect(po.po_number).toMatch(/^PO-\d{8}-\d{4,}$/);
    // 10*3000 + 20*4000 = 110000 subtotal, 12100 vat, 122100 total.
    expect(Number(po.subtotal)).toBe(110000);
    expect(Number(po.vat_amount)).toBe(12100);
    expect(Number(po.total_amount)).toBe(122100);

    // 2. Partial receipt — 5 of product A.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: items } = await admin.from('purchase_order_items')
      .select('id, product_id, quantity')
      .eq('po_id', po.po_id);
    const itemA = (items as { id: string; product_id: string }[]).find(it => it.product_id === prodA.id)!;
    const itemB = (items as { id: string; product_id: string }[]).find(it => it.product_id === prodB.id)!;

    const { data: rcv1, error: rcv1Err } = await sb.rpc('receive_purchase_order_v1', {
      p_po_id:          po.po_id,
      p_section_id:     sectionId,
      p_received_items: [{ po_item_id: itemA.id, received_quantity: 5 }],
    });
    expect(rcv1Err).toBeNull();
    const grn1 = rcv1 as { grn_id: string; grn_number: string; je_id: string; status: string; subtotal: number; vat_amount: number; total: number };
    expect(grn1.status).toBe('partial');
    expect(grn1.grn_number).toMatch(/^GRN-\d{8}-\d{4,}$/);

    // 3. Balanced JE check.
    const { data: je1 } = await admin.from('journal_entries')
      .select('total_debit, total_credit')
      .eq('reference_type', 'purchase')
      .eq('reference_id', grn1.grn_id)
      .single();
    const je1row = je1 as { total_debit: number; total_credit: number };
    expect(Number(je1row.total_debit)).toBeCloseTo(Number(je1row.total_credit), 2);
    // Subtotal 5*3000=15000, vat = round(12100 * 15000/110000, 2) = round(1650, 2) = 1650, total 16650
    expect(Number(grn1.subtotal)).toBeCloseTo(15000, 2);
    expect(Number(grn1.vat_amount)).toBeCloseTo(1650, 2);
    expect(Number(grn1.total)).toBeCloseTo(16650, 2);

    // 4. Stock incremented.
    const { data: stockA } = await admin.from('products')
      .select('current_stock').eq('id', prodA.id).single();
    expect(Number((stockA as { current_stock: number }).current_stock)).toBeGreaterThanOrEqual(5);

    // 5. stock_movement created with metadata.po_id.
    const { data: movs } = await admin.from('stock_movements')
      .select('id, movement_type, metadata')
      .filter('metadata->>po_id', 'eq', po.po_id);
    const purchaseMovs = (movs as { movement_type: string }[]).filter(m => m.movement_type === 'purchase');
    expect(purchaseMovs.length).toBeGreaterThanOrEqual(1);

    // 6. Full receipt of remainder — 5 more of A and 20 of B.
    const { data: rcv2, error: rcv2Err } = await sb.rpc('receive_purchase_order_v1', {
      p_po_id:          po.po_id,
      p_section_id:     sectionId,
      p_received_items: [
        { po_item_id: itemA.id, received_quantity: 5 },
        { po_item_id: itemB.id, received_quantity: 20 },
      ],
    });
    expect(rcv2Err).toBeNull();
    const grn2 = rcv2 as { grn_id: string; status: string };
    expect(grn2.status).toBe('received');

    // 7. Second JE balanced.
    const { data: je2 } = await admin.from('journal_entries')
      .select('total_debit, total_credit')
      .eq('reference_type', 'purchase')
      .eq('reference_id', grn2.grn_id)
      .single();
    const je2row = je2 as { total_debit: number; total_credit: number };
    expect(Number(je2row.total_debit)).toBeCloseTo(Number(je2row.total_credit), 2);

    // 8. Lot minted upfront for product B (has shelf life).
    const { data: lotsB } = await admin.from('stock_lots')
      .select('id, metadata, quantity')
      .eq('product_id', prodB.id)
      .filter('metadata->>po_id', 'eq', po.po_id);
    expect((lotsB as unknown[]).length).toBeGreaterThanOrEqual(1);

    // 9. No lots for product A (no shelf life).
    const { data: lotsA } = await admin.from('stock_lots')
      .select('id')
      .eq('product_id', prodA.id)
      .filter('metadata->>po_id', 'eq', po.po_id);
    expect((lotsA as unknown[]).length).toBe(0);

    // 10. Cancel after receipt refused.
    const { error: cancelErr } = await sb.rpc('cancel_purchase_order_v1', {
      p_po_id:  po.po_id,
      p_reason: 'should fail — already received',
    });
    expect(cancelErr?.message ?? '').toMatch(/PO_ALREADY_RECEIVED/);
  });

  it('cashier forbidden on create_purchase_order_v1', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('create_purchase_order_v1', {
      p_supplier_id: supplier.id,
      p_items: [{ product_id: prodA.id, quantity: 1, unit: 'kg', unit_cost: 3000 }],
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('cancel before receipt succeeds', async () => {
    const sb = jwtClient(managerToken);
    const { data: createRes } = await sb.rpc('create_purchase_order_v1', {
      p_supplier_id: supplier.id,
      p_items: [{ product_id: prodA.id, quantity: 2, unit: 'kg', unit_cost: 3000 }],
    });
    const poId = (createRes as { po_id: string }).po_id;

    const { data: cancelRes, error: cancelErr } = await sb.rpc('cancel_purchase_order_v1', {
      p_po_id:  poId,
      p_reason: 'vitest cancel',
    });
    expect(cancelErr).toBeNull();
    const cancel = cancelRes as { status: string };
    expect(cancel.status).toBe('cancelled');
  });
});
