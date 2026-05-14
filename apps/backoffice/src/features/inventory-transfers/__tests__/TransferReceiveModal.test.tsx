// apps/backoffice/src/features/inventory-transfers/__tests__/TransferReceiveModal.test.tsx
// Session 12 — Phase 3 — Unit tests for TransferReceiveModal.
//
// Strategy mirrors IncomingStockForm.test.tsx:
//   - Mock @/lib/supabase to inspect RPC calls.
//   - Use a QueryClientProvider wrapper.
//   - Verify that the modal pre-fills qty_received with qty_requested, that
//     over-receiving raises a client-side error, that the RPC payload maps
//     correctly, and that each submission rotates the idempotency key.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TransferReceiveModal,
  type TransferReceiveModalItem,
} from '../components/TransferReceiveModal.js';

const mockRpc = vi.fn();

interface RpcResult { data: unknown; error: { message: string; code?: string } | null }

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(
        out ?? {
          data: { transfer_id: 't-1', transfer_number: 'TR-001', status: 'received', idempotent_replay: false },
          error: null,
        },
      );
    },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

// Track each crypto.randomUUID() call so we can assert the key rotates per submit.
const generatedUuids: string[] = [];
// eslint-disable-next-line @typescript-eslint/unbound-method
const realRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
beforeEach(() => {
  generatedUuids.length = 0;
  let counter = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => {
      counter += 1;
      const uuid = `00000000-0000-0000-0000-00000000000${counter}` as `${string}-${string}-${string}-${string}-${string}`;
      generatedUuids.push(uuid);
      return uuid;
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: realRandomUUID,
  });
});

const ITEMS: TransferReceiveModalItem[] = [
  { id: 'ti-1', product_name: 'Americano',  quantity_requested: 5,  unit: 'pcs' },
  { id: 'ti-2', product_name: 'Croissant',  quantity_requested: 12, unit: 'pcs' },
];

function renderModal(props?: Partial<Parameters<typeof TransferReceiveModal>[0]>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TransferReceiveModal
        open
        transferId="t-1"
        items={ITEMS}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('TransferReceiveModal', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('shows one row per item, pre-filling the received quantity to the requested quantity', () => {
    renderModal();
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();

    const americanoInput = screen.getByLabelText<HTMLInputElement>(/Received quantity for Americano/i);
    expect(americanoInput.value).toBe('5');

    const croissantInput = screen.getByLabelText<HTMLInputElement>(/Received quantity for Croissant/i);
    expect(croissantInput.value).toBe('12');
  });

  it('refuses submission when a received qty exceeds the requested qty', async () => {
    renderModal();
    fireEvent.change(
      screen.getByLabelText(/Received quantity for Americano/i),
      { target: { value: '999' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /Confirm receive/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/negative or exceeds the requested/i);
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('submits the mapped payload on a valid receive', async () => {
    mockRpc.mockReturnValue({
      data: { transfer_id: 't-1', transfer_number: 'TR-001', status: 'received', idempotent_replay: false },
      error: null,
    });
    renderModal();
    // Receive partial qty on item 1, full on item 2 (default).
    fireEvent.change(
      screen.getByLabelText(/Received quantity for Americano/i),
      { target: { value: '3' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /Confirm receive/i }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const [fn, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('receive_internal_transfer_v1');
    expect(args.p_transfer_id).toBe('t-1');
    expect(args.p_idempotency_key).toBe(generatedUuids[0]);
    expect(args.p_received_items).toEqual([
      { item_id: 'ti-1', quantity_received: 3 },
      { item_id: 'ti-2', quantity_received: 12 },
    ]);
  });

  it('rotates the idempotency key per submission (each is a fresh UUID)', async () => {
    // First submit — success.
    mockRpc.mockReturnValueOnce({
      data: { transfer_id: 't-1', transfer_number: 'TR-001', status: 'received', idempotent_replay: false },
      error: null,
    });
    const onClose = vi.fn();
    const { rerender } = renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Confirm receive/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    const firstKey = (mockRpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_idempotency_key;
    expect(typeof firstKey).toBe('string');

    // Re-open the modal (parent toggles open) → submit again.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <TransferReceiveModal
          open
          transferId="t-1"
          items={ITEMS}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    mockRpc.mockReturnValueOnce({
      data: { transfer_id: 't-1', transfer_number: 'TR-001', status: 'received', idempotent_replay: false },
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm receive/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    const secondKey = (mockRpc.mock.calls[1] as [string, Record<string, unknown>])[1].p_idempotency_key;
    expect(typeof secondKey).toBe('string');
    expect(secondKey).not.toBe(firstKey);
  });
});
