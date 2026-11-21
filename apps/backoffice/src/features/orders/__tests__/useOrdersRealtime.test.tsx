// apps/backoffice/src/features/orders/__tests__/useOrdersRealtime.test.tsx
//
// Le nom du canal realtime doit être unique PAR MONTAGE. Avec `useId`, les
// deux montages de StrictMode recevaient le même nom : deux canaux homonymes
// se télescopent en silence et la liste cesse de se rafraîchir.

import { describe, it, expect, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const channelNames = vi.hoisted((): string[] => []);

vi.mock('@/lib/supabase.js', () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return {
    supabase: {
      channel: vi.fn((name: string) => { channelNames.push(name); return channel; }),
      removeChannel: vi.fn(),
    },
  };
});

import { useOrdersRealtime } from '../hooks/useOrdersRealtime.js';

describe('useOrdersRealtime', () => {
  it('opens a channel with a distinct name on each StrictMode mount', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </StrictMode>
    );
    renderHook(() => useOrdersRealtime(), { wrapper });
    expect(channelNames.length).toBeGreaterThanOrEqual(2);
    expect(new Set(channelNames).size).toBe(channelNames.length);
    for (const name of channelNames) expect(name).toMatch(/^orders-list-/);
  });
});
