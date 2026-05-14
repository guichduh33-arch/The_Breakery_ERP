// apps/pos/src/features/kds/__tests__/BumpButton.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the Bump CTA.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BumpButton } from '../components/BumpButton';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('BumpButton', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('renders an accessible button', () => {
    render(withQuery(<BumpButton orderItemId="oi-1" />));
    expect(screen.getByRole('button', { name: /bump item to ready/i })).toBeInTheDocument();
  });

  it('calls kds_bump_item_v1 with the item id and an idempotency key on click', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    render(withQuery(<BumpButton orderItemId="oi-1" />));
    fireEvent.click(screen.getByRole('button', { name: /bump/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('kds_bump_item_v1', expect.objectContaining({
        p_order_item_id: 'oi-1',
        p_idempotency_key: expect.any(String),
      }));
    });
  });

  it('disables the button while pending', async () => {
    rpcMock.mockImplementation(() => new Promise(() => {})); // never resolves

    render(withQuery(<BumpButton orderItemId="oi-1" />));
    const btn = screen.getByRole('button', { name: /bump item to ready/i });
    fireEvent.click(btn);
    // Mutation transitions to pending asynchronously — wait for disabled.
    await waitFor(() => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
