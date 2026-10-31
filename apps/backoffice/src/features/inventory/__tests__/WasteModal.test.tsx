// Validation, confidentialité et rejeu des déclarations de pertes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WasteModal } from '../components/WasteModal.js';

const mockRpc = vi.fn();
interface RpcResult { data: unknown; error: { message: string } | null }
const emptyResult: RpcResult = { data: [], error: null };
const emptyChain = {
  select: () => emptyChain,
  is:     () => emptyChain,
  eq:     () => emptyChain,
  or:     () => emptyChain,
  order:  () => emptyChain,
  limit:  () => Promise.resolve(emptyResult),
};
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(out ?? { data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    },
    from: () => emptyChain,
  },
}));

// `vi.hoisted` et non un `const` nu : vi.mock est hissé au-dessus des
// déclarations, et cette fabrique-ci évalue son objet IMMÉDIATEMENT (elle le
// renvoie), contrairement au mock de supabase qui ne référence sa fonction
// qu'à l'appel. Sans hoisted, on lit la variable dans sa zone morte.
const mockToast = vi.hoisted(() => ({
  success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mockToast }));

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

const STOCK_ROW = {
  product_id: 'p-1',
  sku: 'SKU-WAS',
  name: 'Waste Sample',
  category_id: null,
  category_name: null,
  current_stock: 25,
  min_stock_threshold: 0,
  track_inventory: true,
  unit: 'pcs',
  stock_value: 0,
  last_movement_at: null,
};

function renderModal(initial?: typeof STOCK_ROW) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WasteModal
        open
        {...(initial !== undefined ? { initialProduct: initial } : {})}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('WasteModal', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockToast.success.mockReset();
    mockToast.info.mockReset();
  });

  it('renders with locked product and preset Expired by default', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Record waste — Waste Sample/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason$/i)).toHaveValue('Expired');
  });

  it('preserves decimal quantities and units in the payload and confirmation', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    renderModal({ ...STOCK_ROW, unit: 'kg', current_stock: 2 });
    fireEvent.change(screen.getByLabelText(/Quantity wasted.*kg/i), { target: { value: '0.125' } });
    expect(screen.queryByText(/2 kg →/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_stock_declaration_v2', expect.objectContaining({ p_quantity: 0.125 })));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Owner approval')));
  });

  it('locks an uncertain waste and retries the same movement', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'network unavailable' } });
    renderModal(STOCK_ROW);
    const quantity = screen.getByLabelText(/Quantity wasted/i);
    fireEvent.change(quantity, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await screen.findByRole('button', { name: 'Retry declaration' });
    expect(quantity).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry declaration' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  });

  it('Record waste button is disabled until qty within stock + preset selected', () => {
    renderModal(STOCK_ROW);
    const submit = screen.getByRole('button', { name: /Submit for approval/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    expect(submit).toBeEnabled();
  });

  it('accepts a declaration above any stale stock value without exposing availability', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '999' } });
    expect(screen.queryByText(/Cannot exceed current stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeEnabled();
  });

  it('Other preset reveals describe textarea (>= 3 chars required)', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/^Reason$/i), { target: { value: 'Other' } });
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });

    // Submit disabled because the Describe textarea is empty
    const submit = screen.getByRole('button', { name: /Submit for approval/i });
    expect(submit).toBeDisabled();

    const desc = screen.getByLabelText(/Describe/i);
    fireEvent.change(desc, { target: { value: 'Custom shrinkage' } });
    expect(submit).toBeEnabled();
  });

  it('submits with positive quantity + preset reason + idempotencyKey', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('submit_stock_declaration_v2');
    expect(call[1]).toMatchObject({
      p_operation: 'waste',
      p_product_id: 'p-1',
      p_quantity:   3,
      p_reason:     'Expired',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('surfaces insufficient_stock error from RPC', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'insufficient_stock' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/owner must review stock availability/i);
    });
  });

  // L'écran disait deux fois le stock actuel — « 40 (max: 40) » — sans jamais
  // dire ce qu'il resterait après le geste.
  it('does not show stock or a resulting-stock preview', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    expect(screen.queryByText(/25 pcs|22 pcs|−3/)).not.toBeInTheDocument();
  });

  // Le registre est append-only. L'interface doit le dire AVANT le bouton qui
  // produit l'écriture, sinon l'utilisateur cherche un « Edit » qui n'existe pas.
  it('states the approval requirement before submitting', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/declaration is recorded in your name/i)).toBeInTheDocument();
    expect(screen.getByText(/Stock changes only after independent owner approval/i)).toBeInTheDocument();
  });

  it('confirms the declaration without a stock result', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));

    await waitFor(() => { expect(mockToast.success).toHaveBeenCalledTimes(1); });
    expect(mockToast.success.mock.calls[0]?.[0]).toMatch(/Declaration submitted.*Waste Sample.*Owner approval/);
  });

  // Un rejeu ne doit pas se présenter comme une seconde perte enregistrée.
  it('says a replay was not decremented twice', async () => {
    mockRpc.mockReturnValue({
      data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: true }, error: null,
    });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));

    await waitFor(() => { expect(mockToast.info).toHaveBeenCalledTimes(1); });
    expect(mockToast.info.mock.calls[0]?.[0]).toMatch(/already submitted/i);
    expect(mockToast.success).not.toHaveBeenCalled();
  });
  it.each(['approved', 'rejected'] as const)('reports an already %s declaration on replay', async (status) => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status, display_withdrawal_applied: false, idempotent_replay: true }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(expect.stringContaining('already ' + status)));
    expect(mockToast.info.mock.calls[0]?.[0]).not.toMatch(/required|unchanged|22/);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
