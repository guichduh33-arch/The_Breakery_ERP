// apps/pos/src/features/shift/hooks/__tests__/useDenominationCountEnabled.test.tsx
//
// S67 (12 D2.3) — locks the fail-CLOSED contract: a config-read outage must
// never force the denomination grid onto the operator (opposite polarity of
// useEnabledPaymentMethods, which fails OPEN). Mirrors the sibling harness
// (vi.hoisted mock + QueryClientProvider wrapper) per repo convention —
// referencing a plain `const` inside vi.mock() triggers a Vitest hoisting
// error, so `maybeSingle` is declared via vi.hoisted() here.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle }) }) }),
  },
}));

import { useDenominationCountEnabled } from '../useDenominationCountEnabled';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDenominationCountEnabled', () => {
  it('returns true when business_config has the flag on', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { shift_denomination_count_enabled: true }, error: null });
    const { result } = renderHook(() => useDenominationCountEnabled(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
  it('fails CLOSED to false on error (config outage never forces the grid)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useDenominationCountEnabled(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
