import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), state: { isAuthenticated: true, sessionToken: 'session-a', user: { id: 'operator', role_code: 'SUPER_ADMIN' }, hasPermission: (_code: string): boolean => true } }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc }, supabaseUrl: 'https://yjhhhmjgsmyzyymvixot.supabase.co' }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: { getState: () => mocks.state } }));
import { HistoricalReferencePanel } from '../HistoricalReferencePanel.js';
const record = { sku: 'COMBO-010', id: '20000000-0000-0000-0000-000000000001', name: 'Combo Classic', unit: 'pcs', category_id: '10000000-0000-0000-0000-000000000001', product_type: 'combo', deleted_at: null, is_active: false, visible_on_pos: false, available_for_sale: false, track_inventory: false, deduct_stock: false, is_display_item: false, current_stock: 0, retail_price: 0, cost_price: 0 };
async function upload() {
  const p = { format: 'breakery-historical-references/1', target_project_ref: 'yjhhhmjgsmyzyymvixot', products: [{ sku: 'COMBO-010', name: record.name, category_id: record.category_id, unit: 'pcs', product_type: 'combo' }], suppliers: [] };
  const file = { size: 1000, text: () => Promise.resolve(JSON.stringify(p)) } as File;
  fireEvent.change(screen.getByLabelText('Reference package (.json)'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Create or verify references' });
}
beforeEach(() => { mocks.rpc.mockReset(); mocks.from.mockReset(); mocks.state.sessionToken = 'session-a'; mocks.state.hasPermission = () => true; });
afterEach(cleanup);
describe('historical reference creation', () => {
  it('requires deliberate confirmation before any lookup or creation', async () => {
    render(<HistoricalReferencePanel />); await upload();
    expect(screen.getByRole('button', { name: 'Create or verify references' })).toBeDisabled();
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reuses a matching reference without changing it', async () => {
    mocks.rpc.mockResolvedValue({ data: [record], error: null }); render(<HistoricalReferencePanel />); await upload();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Create or verify references' }));
    expect(await screen.findByRole('list', { name: 'Verified references' })).toHaveTextContent(record.id);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith('get_operational_products_v1');
  });
  it('does not reuse a finished SKU when the approved reference is a combo', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...record, product_type: 'finished' }], error: null }); render(<HistoricalReferencePanel />); await upload();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Create or verify references' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match'); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith('get_operational_products_v1');
  });
  it('creates an inactive zero-stock reference and verifies the persisted configuration', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: { product: record, ignored_fields: [] }, error: null }).mockResolvedValueOnce({ data: [record], error: null });
    render(<HistoricalReferencePanel />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create or verify references' }));
    await screen.findByRole('list', { name: 'Verified references' });
    const call = mocks.rpc.mock.calls[1] as unknown[] | undefined;
    expect(call?.[0]).toBe('create_product_v4');
    expect(call?.[1]).toMatchObject({ p_payload: { is_active: false, visible_on_pos: false, track_inventory: false, deduct_stock: false, is_display_item: false, available_for_sale: false, product_type: 'combo' } });
  });
  it('stops before creation if the session changes during lookup', async () => {
    let complete: (value: unknown) => void = () => undefined;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<HistoricalReferencePanel />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create or verify references' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1)); mocks.state.sessionToken = 'session-b';
    complete({ data: [], error: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('operator session'); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
