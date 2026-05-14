// apps/pos/src/features/kds/__tests__/UndoBumpToast.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the 60s undo countdown toast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { UndoBumpToast } from '../components/UndoBumpToast';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('UndoBumpToast', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders countdown and Undo CTA at mount', () => {
    const bumpedAtMs = Date.now();
    render(withQuery(
      <UndoBumpToast orderItemId="oi-1" bumpedAtMs={bumpedAtMs} onClose={() => {}} />,
    ));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo bump/i })).toBeInTheDocument();
    expect(screen.getByText(/60s/i)).toBeInTheDocument();
  });

  it('calls onClose after the 60s window passes', () => {
    const onClose = vi.fn();
    const bumpedAtMs = Date.now();

    render(withQuery(
      <UndoBumpToast orderItemId="oi-1" bumpedAtMs={bumpedAtMs} onClose={onClose} />,
    ));

    // Initially the toast is visible (countdown active) — onClose not called.
    expect(onClose).not.toHaveBeenCalled();

    // Advance 61 seconds — the setInterval re-renders the component, the
    // effect inside notices remaining<=0 and calls onClose synchronously.
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(onClose).toHaveBeenCalled();
  });
});
