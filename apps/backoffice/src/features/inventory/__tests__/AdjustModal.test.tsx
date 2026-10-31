// Validation, confidentialité et rejeu des déclarations de comptage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdjustModal } from '../components/AdjustModal.js';

// ---- Mocks ----------------------------------------------------------------

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

// `vi.hoisted` : cette fabrique renvoie son objet immédiatement, contrairement
// au mock de supabase qui ne référence sa fonction qu'à l'appel.
const mockToast = vi.hoisted(() => ({
  success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mockToast }));

// crypto.randomUUID is invoked at mount for the idempotency key.
if (typeof crypto.randomUUID !== 'function') {
  // jsdom in CI may miss crypto.randomUUID — polyfill.
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function renderModal(initial?: Parameters<typeof AdjustModal>[0]['initialProduct']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdjustModal
        open
        {...(initial !== undefined ? { initialProduct: initial } : {})}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const STOCK_ROW = {
  product_id: 'p-1',
  sku: 'SKU-ADJ',
  name: 'Adjust Sample',
  category_id: null,
  category_name: null,
  current_stock: 10,
  min_stock_threshold: 0,
  track_inventory: true,
  unit: 'pcs',
  stock_value: 0,
  last_movement_at: null,
};

describe('AdjustModal', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('locked-product mode hides the typeahead and shows product name in title', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Declare stock count — Adjust Sample/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Product$/i)).not.toBeInTheDocument();
  });

  it('submits decimal stock in its base unit without truncation', async () => {
    renderModal({ ...STOCK_ROW, unit: 'kg', current_stock: 2 });
    fireEvent.change(screen.getByLabelText(/New on-hand quantity.*kg/i), { target: { value: '1.375' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i), { target: { value: 'Physical recount' } });
    expect(screen.queryByText(/2 kg →/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_stock_declaration_v2', expect.objectContaining({ p_quantity: 1.375 })));
  });

  it('locks uncertain details and retries with the identical key and payload', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'network unavailable' } });
    renderModal(STOCK_ROW);
    const quantity = screen.getByLabelText(/New on-hand quantity/i);
    fireEvent.change(quantity, { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i), { target: { value: 'Physical recount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await screen.findByRole('button', { name: 'Retry declaration' });
    expect(quantity).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry declaration' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  });

  it.each([
    ['idempotency_conflict', 'Check movement history'],
    ['invalid_quantity', '3 decimal places'],
  ])('explains %s without a generic error', async (code, message) => {
    mockRpc.mockReturnValue({ data: null, error: { message: code } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i), { target: { value: 'Physical recount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  });

  it('hides theoretical stock and requires a quantity before submitting', () => {
    renderModal(STOCK_ROW);
    expect(screen.queryByText(/Current stock:/)).not.toBeInTheDocument();
    expect(screen.queryByText('10 pcs')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
  });

  it('never reveals a delta even when the caller has a previous stock value', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '15' } });
    expect(screen.queryByText(/Δ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10.*15/)).not.toBeInTheDocument();
  });

  it('rejects negative newQty (validator) — Apply stays disabled', () => {
    renderModal(STOCK_ROW);
    const newQty = screen.getByLabelText(/New on-hand quantity/i);
    fireEvent.change(newQty, { target: { value: '-3' } });
    const reason = screen.getByPlaceholderText(/At least 3 characters/i);
    fireEvent.change(reason, { target: { value: 'Some reason here' } });
    expect(screen.getByRole('button', { name: /Submit for approval/i })).toBeDisabled();
  });

  it('submits with productId + newQty + reason + idempotencyKey when valid', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '22' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Manual recount after closing' } });

    const apply = screen.getByRole('button', { name: /Submit for approval/i });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('submit_stock_declaration_v2');
    expect(call[1]).toMatchObject({
      p_operation: 'adjust',
      p_product_id: 'p-1',
      p_quantity:    22,
      p_reason:     'Manual recount after closing',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('shows error banner when RPC returns a forbidden error', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'forbidden' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Going to fail with forbidden' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no longer have permission/i);
    });
  });

  it('explains independent approval and confirms only the declaration', async () => {
    mockToast.success.mockReset();
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status: 'pending', display_withdrawal_applied: false, idempotent_replay: false }, error: null });
    renderModal(STOCK_ROW);

    // Le registre est append-only : l'écran doit le dire avant le bouton.
    expect(screen.getByText(/Stock changes only after independent owner approval/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '22' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'Manual recount after closing' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/i }));

    await waitFor(() => { expect(mockToast.success).toHaveBeenCalledTimes(1); });
    expect(mockToast.success.mock.calls[0]?.[0]).toMatch(/Declaration submitted.*Adjust Sample.*Owner approval/);
    expect(mockToast.success.mock.calls[0]?.[0]).not.toMatch(/is now|22 pcs/);
  });

  it('rejects reason < 3 chars (Apply disabled)', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '20' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i),
      { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: /Submit for approval/i })).toBeDisabled();
  });
  it.each(['approved', 'rejected'] as const)('reports a replay already %s without claiming unchanged stock', async (status) => {
    mockToast.info.mockReset();
    mockRpc.mockReturnValue({ data: { declaration_id: 'd', status, display_withdrawal_applied: false, idempotent_replay: true }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/New on-hand quantity/i), { target: { value: '22' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 3 characters/i), { target: { value: 'Physical recount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(expect.stringContaining('already ' + status)));
    expect(mockToast.info.mock.calls[0]?.[0]).not.toMatch(/required|unchanged|22/);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
