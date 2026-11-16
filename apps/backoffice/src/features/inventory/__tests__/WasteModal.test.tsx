// apps/backoffice/src/features/inventory/__tests__/WasteModal.test.tsx
// Session 12 — Unit tests for the WasteModal component.
//
// Contract:
//   - Quantity > current_stock is rejected client-side (disabled submit + inline error)
//   - Reason comes from the closed `waste_reason` list (S1-18); the note is
//     optional, required (3+ chars) for "Other"
//   - Submit calls the `submit_stock_declaration` family with productId,
//     quantity (positive), the reason code, the note and idempotencyKey

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WasteModal } from '../components/WasteModal.js';

// Ordre de l'enum Postgres `waste_reason` (types générés) et libellés attendus.
const EXPECTED_REASONS = [
  ['mis_baked', 'Mis-baked'], ['poor_proofing', 'Poor proofing'], ['cosmetic', 'Cosmetic defect'],
  ['demo', 'Demonstration'], ['recipe_test', 'Recipe test'], ['tasting', 'Tasting'],
  ['expired', 'Expired'], ['leftover', 'Leftover'], ['damaged', 'Damaged'], ['other', 'Other'],
];

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
      return Promise.resolve(out ?? { data: { declaration_id: 'd-1', status: 'pending', idempotent_replay: false }, error: null });
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

  it('renders with locked product and reason Expired by default', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Record waste — Waste Sample/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason$/i)).toHaveValue('expired');
    expect(screen.getByRole('option', { name: 'Expired', selected: true })).toBeInTheDocument();
  });

  it('feeds the reason select from the waste_reason enum with English labels', () => {
    renderModal(STOCK_ROW);
    const select = screen.getByLabelText<HTMLSelectElement>(/^Reason$/i);
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual(EXPECTED_REASONS);
  });

  it('preserves decimal quantities and units in the payload and confirmation', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd-1', status: 'pending' }, error: null });
    renderModal({ ...STOCK_ROW, unit: 'kg', current_stock: 2 });
    fireEvent.change(screen.getByLabelText(/Quantity wasted.*kg/i), { target: { value: '0.125' } });
    expect(screen.queryByText(/2 kg →/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_stock_declaration_v3', expect.objectContaining({ p_operation: 'waste', p_quantity: 0.125 })));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Owner approval is required')));
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
    const submit = screen.getByRole('button', { name: 'Submit for approval' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    expect(submit).toBeEnabled();
  });

  it('leaves the theoretical availability check to independent Owner approval', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '999' } });
    expect(screen.queryByText(/Cannot exceed current stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeEnabled();
  });

  it('Other without a note blocks submit; a 3+ char note unblocks it', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/^Reason$/i), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });

    const submit = screen.getByRole('button', { name: 'Submit for approval' });
    expect(submit).toBeDisabled();
    const note = screen.getByLabelText(/Note \(required\)/i);
    expect(note).toBeRequired();

    fireEvent.change(note, { target: { value: 'ab' } });
    expect(submit).toBeDisabled();
    fireEvent.change(note, { target: { value: 'Custom shrinkage' } });
    expect(submit).toBeEnabled();
  });

  it('rejects a note shorter than 3 characters on any reason', () => {
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });
    const note = screen.getByLabelText(/Note \(optional\)/i);
    expect(note).not.toBeRequired();
    fireEvent.change(note, { target: { value: 'x ' } });
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
  });

  it('sends the reason code and the trimmed note', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd-1', status: 'pending' }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Reason$/i), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText(/^Note/i), { target: { value: '  Freezer failure  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc.mock.calls[0]).toEqual(['submit_stock_declaration_v3', expect.objectContaining({
      p_operation: 'waste', p_waste_reason: 'other', p_reason: 'Freezer failure',
    })]);
  });

  it('surfaces the server refusal of a missing note', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'reason_required' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent(/note of at least 3 characters/i); });
  });

  it('submits with positive quantity + default reason code, no note + idempotencyKey', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd-1', status: 'pending' }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const call = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('submit_stock_declaration_v3');
    expect(call[1]).toMatchObject({
      p_product_id:   'p-1',
      p_quantity:     3,
      p_operation:    'waste',
      p_waste_reason: 'expired',
      p_reason:       '',
    });
    expect(call[1]).toHaveProperty('p_idempotency_key');
  });

  it('surfaces insufficient_stock error from RPC', async () => {
    mockRpc.mockReturnValue({ data: null, error: { message: 'insufficient_stock' } });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/owner must review stock availability/i);
    });
  });

  // L'écran disait deux fois le stock actuel — « 40 (max: 40) » — sans jamais
  // dire ce qu'il resterait après le geste.
  it('never previews a theoretical stock delta', () => {
    renderModal(STOCK_ROW);           // current_stock = 25
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    expect(screen.queryByText(/25 pcs → 22 pcs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/−3/)).not.toBeInTheDocument();
  });

  // Le registre est append-only. L'interface doit le dire AVANT le bouton qui
  // produit l'écriture, sinon l'utilisateur cherche un « Edit » qui n'existe pas.
  it('states the irreversibility before the submit button', () => {
    renderModal(STOCK_ROW);
    expect(screen.getByText(/Your declaration is recorded in your name/i)).toBeInTheDocument();
    expect(screen.getByText(/Stock changes only after independent owner approval/i)).toBeInTheDocument();
  });

  it('confirms the recorded waste with the resulting on-hand', async () => {
    mockRpc.mockReturnValue({ data: { declaration_id: 'd-1', status: 'pending' }, error: null });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => { expect(mockToast.success).toHaveBeenCalledTimes(1); });
    expect(mockToast.success.mock.calls[0]?.[0]).toMatch(/Waste declaration submitted — Waste Sample.*Owner approval is required/);
  });

  // Un rejeu ne doit pas se présenter comme une seconde perte enregistrée.
  it('says a replay was not decremented twice', async () => {
    mockRpc.mockReturnValue({
      data: { declaration_id: 'd-1', status: 'pending', idempotent_replay: true }, error: null,
    });
    renderModal(STOCK_ROW);
    fireEvent.change(screen.getByLabelText(/Quantity wasted/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => { expect(mockToast.success).toHaveBeenCalledTimes(1); });
    expect(mockToast.success.mock.calls[0]?.[0]).toMatch(/already submitted/);
  });
});
