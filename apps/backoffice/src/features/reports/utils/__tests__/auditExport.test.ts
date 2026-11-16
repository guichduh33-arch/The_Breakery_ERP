// Contrat de l'export du journal : pour chaque code d'action, les champs attendus
// sont présents, chacun dans sa case. Les traces reprennent la FORME des lignes
// stockées (clés de metadata / payload relevées en production le 2026-11-14),
// avec des valeurs fictives.
import { describe, expect, it } from 'vitest';
import { buildCsv } from '@breakery/domain';
import type { AuditLogRow } from '../../hooks/useAuditLogs.js';
import { auditFields, type AuditFields } from '../auditFields.js';
import { AUDIT_CSV_COLUMNS, AUDIT_LEGACY_HEADERS, buildAuditExportRows } from '../auditExport.js';
import { describeAuditLog } from '../auditDescription.js';

const ORDER = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const SHIFT = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';

let counter = 0;
function audit(action: string, entity_type: string, entity_id: string | null, metadata: unknown, payload: unknown = null): AuditLogRow {
  counter += 1;
  return { id: `audit:${String(counter).padStart(20, '0')}`, actor_id: 'actor-1', actor_name: 'Ayu', action,
    entity_type, entity_id, metadata, payload, source: 'audit', created_at: '2026-11-14T02:00:00.000000+00:00' };
}
function pos(event: string, payload: unknown, context: Record<string, unknown> = {}, orderId: string | null = null): AuditLogRow {
  counter += 1;
  return { id: `pos:${String(counter)}`, actor_id: 'actor-1', actor_name: 'Ayu', action: `pos.${event}`,
    entity_type: orderId === null ? 'pos_device' : 'order', entity_id: orderId ?? DEVICE,
    metadata: { device_id: DEVICE, recorded_at: '2026-11-14T02:00:01Z', source: 'client', ...context },
    payload, source: 'pos', created_at: '2026-11-14T02:00:00.000000+00:00' };
}

type Expected = Partial<AuditFields>;
const CASES: [string, AuditLogRow, Expected][] = [
  ['pos.note_added', pos('note_added', { notes: 'no sugar', surface: 'tablet', table_number: 'T4' }),
    { terminalId: DEVICE, table: 'T4' }],
  ['pos.table_assigned (register)', pos('table_assigned', { from: 'T1', to: 'T2' }),
    { before: 'T1', after: 'T2', terminalId: DEVICE }],
  ['pos.table_assigned (tablet)', pos('table_assigned', { previous_table: 'T1', table_number: 'T2', surface: 'tablet' }),
    { before: 'T1', after: 'T2', table: 'T2' }],
  ['pos.order_type_changed (register)', pos('order_type_changed', { from: 'takeaway', to: 'dine_in' }),
    { before: 'takeaway', after: 'dine_in' }],
  ['pos.order_type_changed (tablet)', pos('order_type_changed', { old_type: 'dine_in', new_type: 'takeaway', surface: 'tablet' }),
    { before: 'dine_in', after: 'takeaway' }],
  ['pos.order_resumed', pos('order_resumed', { kind: 'reopen_fired', items: 3 }, {}, ORDER),
    { orderId: ORDER, terminalId: DEVICE }],
  ['pos.order_held', pos('order_held', { kind: 'hold_fired' }, {}, ORDER), { orderId: ORDER, terminalId: DEVICE }],
  ['pos.item_added', pos('item_added', { product_id: PRODUCT, name: 'Croissant' }),
    { product: 'Croissant', productId: PRODUCT, orderNumber: null }],
  ['pos.item_added (tablet append)', pos('item_added', { product_id: PRODUCT, name: 'Croissant', surface: 'tablet', table_number: 'T4' },
    { order_number: 'T1-0042' }, ORDER), { product: 'Croissant', orderNumber: 'T1-0042', orderId: ORDER, table: 'T4' }],
  ['pos.item_qty_changed', pos('item_qty_changed', { name: 'Latte', old_qty: 1, qty: 3 }),
    { product: 'Latte', quantity: 3, before: '1', after: '3' }],
  ['pos.payment_started', pos('payment_started', { method: 'cash', tenders: 1 }, { amount: 595000 }),
    { amount: 595000, paymentMethod: 'cash' }],
  ['pos.payment_completed', pos('payment_completed', { method: 'qris', change_given: 0 }, { amount: 120000, order_number: 'T1-0042' }),
    { amount: 120000, paymentMethod: 'qris', orderNumber: 'T1-0042', outcome: 'success' }],
  ['pos.payment_failed', pos('payment_failed', { kind: 'fatal', method: 'cash' }, { amount: 595000, reason: 'insufficient_stock' }),
    { amount: 595000, paymentMethod: 'cash', reasonCode: 'insufficient_stock', reasonNote: null, outcome: 'failed' }],
  ['pos.cash_drawer_opened', pos('cash_drawer_opened', { trigger: 'sale', method: 'cash', opened: true }, { amount: 0, order_number: 'T1-0042' }),
    { amount: null, orderNumber: 'T1-0042', paymentMethod: 'cash', outcome: 'success' }],
  ['pos.receipt_reprinted', pos('receipt_reprinted', { printed: false }, { order_number: 'T1-0042' }),
    { orderNumber: 'T1-0042', outcome: 'failed' }],
  ['pos.session_opened', pos('session_opened', {}, { session_id: SHIFT, amount: 500000 }), { shiftId: SHIFT, amount: 500000 }],
  ['order.complete', audit('order.complete', 'orders', ORDER, { order_number: 'T1-0042', total: 120000,
    payment_methods: [{ method: 'cash' }, { method: 'qris' }], table_number: 'T4' }),
    { orderId: ORDER, orderNumber: 'T1-0042', amount: 120000, paymentMethod: 'cash+qris', table: 'T4' }],
  ['order.pay_existing', audit('order.pay_existing', 'orders', ORDER, { order_number: 'T1-0042', total: 80000, payment_methods: ['card'] }),
    { orderId: ORDER, orderNumber: 'T1-0042', amount: 80000, paymentMethod: 'card' }],
  ['order.held', audit('order.held', 'orders', ORDER, {}), { orderId: ORDER }],
  ['order.reopened', audit('order.reopened', 'orders', ORDER, { receiving_session_id: SHIFT, shift_transferred: true }),
    { orderId: ORDER, shiftId: SHIFT }],
  ['order.tablet_appended', audit('order.tablet_appended', 'orders', ORDER, { items_added: 2, source: 'tablet' }), { orderId: ORDER }],
  ['shift.open', audit('shift.open', 'pos_session', SHIFT, { amount: 500000, terminal_id: DEVICE }),
    { shiftId: SHIFT, terminalId: DEVICE, amount: 500000 }],
  ['shift.close', audit('shift.close', 'pos_sessions', SHIFT, { variance: 8000, variance_card: 60000 }), { shiftId: SHIFT }],
  ['stock.movement', audit('stock.movement', 'stock_movements', 'mv-1', { movement_type: 'production_out', quantity: -2.5, unit: 'kg',
    reason: 'Material consumed by PROD-20261114-0001', allow_negative: false, new_current_stock: 12 }),
    { quantity: -2.5, unit: 'kg', reasonCode: null, reasonNote: 'Material consumed by PROD-20261114-0001' }],
  ['production.create', audit('production.create', 'production_records', 'pr-1', { product_id: PRODUCT, quantity_produced: 24,
    production_number: 'PROD-20261114-0001', force_negative: false }), { productId: PRODUCT, quantity: 24 }],
  ['display.add', audit('display.add', 'display_movement', 'dm-1', { product_id: PRODUCT, quantity: 12, reason: 'pos_mise_en_vitrine' }),
    { productId: PRODUCT, quantity: 12, reasonCode: 'pos_mise_en_vitrine', reasonNote: null }],
  ['display.waste (free text)', audit('display.waste', 'display_movement', 'dm-2', { declaration_id: 'd-1' },
    { product_id: PRODUCT, quantity: 3, reason: 'Sisa kmarin' }),
    { productId: PRODUCT, quantity: 3, reasonCode: null, reasonNote: 'Sisa kmarin' }],
  ['display.waste (coded reason and note)', audit('display.waste', 'display_movement', 'dm-3', { waste_reason: 'leftover', note: 'yesterday' },
    { product_id: PRODUCT, quantity: 3 }), { reasonCode: 'leftover', reasonNote: 'yesterday' }],
  ['product.cost_recomputed', audit('product.cost_recomputed', 'product', PRODUCT, { old_cost: 4000, new_cost: 4100, source: 'recipe_edit' }),
    { productId: PRODUCT, before: '4000', after: '4100' }],
  ['po.payment_recorded', audit('po.payment_recorded', 'purchase_order', 'po-1', { amount: 250000, method: 'transfer', po_number: 'PO-1' }),
    { amount: 250000, paymentMethod: 'transfer' }],
  ['purchase_order.received', audit('purchase_order.received', 'purchase_orders', 'po-1', { po_number: 'PO-1', total: 250000 }), { amount: 250000 }],
  ['login.success', audit('login.success', 'user_profiles', 'actor-1', { device_type: 'pos', session_id: 'user-session' }),
    { outcome: 'success', shiftId: null }],
  ['login.failed', audit('login.failed', 'user_profiles', 'actor-1', { attempts: 3 }), { outcome: 'failed' }],
  ['user.role_change', audit('user.role_change', 'user_profiles', 'actor-2', { old_role: 'CASHIER', new_role: 'MANAGER' }),
    { before: 'CASHIER', after: 'MANAGER' }],
  ['setting.update', audit('setting.update', 'setting', null, { key: 'shift_variance_threshold_abs', old: 50000, new: 20000 }),
    { before: '50000', after: '20000' }],
];

describe('audit export fields, per action code', () => {
  it.each(CASES)('%s carries its expected fields', (_name, row, expected) => {
    expect(auditFields(row)).toMatchObject(expected);
  });

  it('never exposes a secret setting value as before / after', () => {
    const fields = auditFields(audit('setting.update', 'setting', null, { key: 'api_key', old: 'old-secret', new: 'new-secret' }));
    expect(fields.before).toBeNull();
    expect(fields.after).toBeNull();
  });

  it('does not read a user session as a register shift', () => {
    expect(auditFields(audit('login.success', 'user_profiles', 'a', { session_id: 'user-session' })).shiftId).toBeNull();
  });
});

describe('audit descriptions read the stored context', () => {
  it('shows the note, the table change and the order type change', () => {
    expect(describeAuditLog(pos('note_added', { notes: 'no sugar', table_number: 'T4' }))).toBe('Order note updated · Table T4 · Note: no sugar');
    expect(describeAuditLog(pos('table_assigned', { from: 'T1', to: null }))).toBe('Table assigned · Table T1 → none');
    expect(describeAuditLog(pos('order_type_changed', { old_type: 'dine_in', new_type: 'takeaway' }))).toBe('Order type changed on POS · dine in → takeaway');
  });
  it('keeps the order and the product in two separate places for an added item', () => {
    expect(describeAuditLog(pos('item_added', { name: 'Croissant' }))).toBe('Item added to the cart · Croissant');
    expect(describeAuditLog(pos('item_added', { name: 'Croissant' }, { order_number: 'T1-0042' }, ORDER)))
      .toBe('Item added to the cart · T1-0042 · Croissant');
  });
  it('labels the drawer amount as change given, not as a sale amount', () => {
    const text = describeAuditLog(pos('cash_drawer_opened', { trigger: 'sale', opened: true }, { amount: 0, order_number: 'T1-0042' }));
    expect(text).toContain('Change given Rp 0');
    expect(text.startsWith('Cash drawer opening requested · T1-0042 · Change given')).toBe(true);
  });
});

describe('audit export file', () => {
  const held = audit('order.held', 'orders', ORDER, {});
  const paid = audit('order.complete', 'orders', ORDER, { order_number: 'T1-0042', total: 120000 });
  const reported = pos('payment_completed', { method: 'cash' }, { amount: 120000, order_number: 'T1-0042' });
  const heldOnPos = pos('order_held', { kind: 'hold_fired' }, {}, ORDER);
  const opened = audit('shift.open', 'pos_session', SHIFT, { amount: 500000 });
  const openedOnPos = pos('session_opened', {}, { session_id: SHIFT, amount: 500000 });
  const rows = [reported, paid, heldOnPos, held, openedOnPos, opened];
  const exported = buildAuditExportRows(rows);

  it('keeps the 13 historical columns first, with their names and order', () => {
    expect(AUDIT_CSV_COLUMNS.slice(0, 13).map((c) => c.header)).toEqual([...AUDIT_LEGACY_HEADERS]);
    expect(AUDIT_LEGACY_HEADERS).toEqual(['Event reference', 'Timestamp', 'Event', 'Action code', 'Description', 'Account',
      'Account role in event', 'Source', 'Record type', 'Record ID', 'Review cue', 'Evidence note', 'Actor ID']);
    const headers = AUDIT_CSV_COLUMNS.map((c) => c.header);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('links the device report and the server audit of one action with the same key', () => {
    const key = (row: AuditLogRow): string | null => exported.find((e) => e.row.id === row.id)?.fields.linkKey ?? null;
    expect(key(held)).toBe('order:T1-0042');
    expect(key(heldOnPos)).toBe(key(held));
    expect(key(reported)).toBe(key(paid));
    expect(key(openedOnPos)).toBe(`shift:${SHIFT}`);
    expect(key(openedOnPos)).toBe(key(opened));
  });

  it('fills the missing half of the order pair and separates the terminal from the order', () => {
    const line = exported.find((e) => e.row.id === reported.id);
    expect(line?.fields.orderId).toBe(ORDER);
    expect(line?.fields.terminalId).toBe(DEVICE);
    expect(exported.find((e) => e.row.id === held.id)?.fields.orderNumber).toBe('T1-0042');
  });

  it('writes severity labels, keeps numbers as numbers and neutralises formulas in the added text columns', () => {
    const at = (second: number): string => `2026-11-14T02:00:0${String(second)}.000000+00:00`;
    const lines = [
      { ...audit('shift.close', 'pos_sessions', SHIFT, { variance: 8000, variance_card: -60000 }), created_at: at(3) },
      { ...audit('display.adjust', 'display_movement', 'dm-9', { old_qty: -3, new_qty: 0, unit: 'pcs', reason: '=HYPERLINK("http://x")' }), created_at: at(2) },
      { ...pos('item_added', { name: '+SUM(A1)' }), created_at: at(1) },
    ];
    const out = buildAuditExportRows(lines);
    expect(out.map((e) => e.sequence)).toEqual([3, 2, 1]);
    const headers = AUDIT_CSV_COLUMNS.map((c) => c.header);
    const cell = (index: number, header: string): unknown => AUDIT_CSV_COLUMNS[headers.indexOf(header)]?.accessor(out[index]!);
    expect(cell(0, 'Severity')).toBe('High');
    expect(cell(1, 'Value before')).toBe(-3);
    expect(cell(1, 'Value after')).toBe(0);
    const csv = buildCsv(out, AUDIT_CSV_COLUMNS, { bom: false });
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`'+SUM(A1)`);
    expect(csv).not.toMatch(/,=HYPERLINK|,\+SUM/);
    expect(csv).toContain(',-3,0,');
  });

  it('keeps every column already published in place and adds the resolved context at the far right', () => {
    const headers = AUDIT_CSV_COLUMNS.map((c) => c.header);
    expect(headers.slice(13, 36)).toEqual(['Timestamp ISO', 'Sequence', 'Order number', 'Order ID', 'Terminal ID', 'Shift ID',
      'Table', 'Product', 'Product ID', 'Quantity', 'Unit', 'Amount', 'Payment method', 'Value before', 'Value after',
      'Reason code', 'Reason note', 'Outcome', 'Severity', 'Signal group', 'Group size', 'Link key', 'Evidence code']);
    expect(headers.slice(36)).toEqual(['Account role (current)', 'Terminal', 'Terminal sequence']);
  });

  it('fills an empty cell with the context resolved by the server and never overrides the trace', () => {
    // Un mouvement de stock ne porte ni produit ni nom ; une mise en attente ne porte pas de numéro.
    const movement = { ...audit('stock.movement', 'stock_movements', 'sm-1', { movement_type: 'waste', quantity: -2, unit: 'pcs' }),
      product_id: PRODUCT, product_name: 'Croissant', actor_role: 'MANAGER' };
    const heldBare = { ...audit('order.held', 'orders', ORDER, {}), order_id: ORDER, order_number: 'T1-0042' };
    const gesture = { ...pos('payment_started', { method: 'cash' }, { amount: 1000 }),
      device_id: DEVICE, device_label: 'Counter 1', device_seq: 41 };
    const traced = { ...pos('item_added', { product_id: PRODUCT, name: 'Trace name' }, { order_number: 'TRACE-1' }),
      product_name: 'Catalogue name', order_number: 'OTHER-9' };
    const out = buildAuditExportRows([movement, heldBare, gesture, traced]);
    expect(out[0]?.fields).toMatchObject({ productId: PRODUCT, product: 'Croissant' });
    expect(describeAuditLog(movement)).toContain('Croissant');
    expect(out[1]?.fields).toMatchObject({ orderId: ORDER, orderNumber: 'T1-0042', linkKey: 'order:T1-0042' });
    expect(describeAuditLog(heldBare)).toContain('T1-0042');
    expect(out[3]?.fields).toMatchObject({ product: 'Trace name', orderNumber: 'TRACE-1' });
    const headers = AUDIT_CSV_COLUMNS.map((c) => c.header);
    const cell = (index: number, header: string): unknown => AUDIT_CSV_COLUMNS[headers.indexOf(header)]?.accessor(out[index]!);
    expect(cell(0, 'Account role (current)')).toBe('MANAGER');
    expect(cell(2, 'Terminal')).toBe('Counter 1');
    expect(cell(2, 'Terminal sequence')).toBe(41);
    expect(cell(1, 'Terminal')).toBeNull();
    // Une ligne lue sans contexte résolu sort comme avant, cases vides.
    const plain = buildAuditExportRows([audit('stock.movement', 'stock_movements', 'sm-2', { movement_type: 'waste' })]);
    expect(plain[0]?.fields).toMatchObject({ product: null, productId: null, orderNumber: null });
    expect(AUDIT_CSV_COLUMNS[headers.indexOf('Account role (current)')]?.accessor(plain[0]!)).toBeNull();
  });

  it('numbers events from the oldest to the newest and writes an ISO time with seconds and offset', () => {
    expect(exported.map((e) => e.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
    const csv = buildCsv(exported, AUDIT_CSV_COLUMNS, { bom: false });
    const [header, first] = csv.split('\r\n');
    expect(header?.split(',').slice(13, 15)).toEqual(['Timestamp ISO', 'Sequence']);
    expect(first).toContain('2026-11-14 10:00:00');
    expect(first).toContain('2026-11-14T10:00:00.000+08:00');
    expect(csv.trimEnd().split('\r\n')).toHaveLength(rows.length + 1);
  });
});
