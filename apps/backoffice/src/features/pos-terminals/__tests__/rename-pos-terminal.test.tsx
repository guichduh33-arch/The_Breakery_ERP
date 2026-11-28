// apps/backoffice/src/features/pos-terminals/__tests__/rename-pos-terminal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rpcCalls: { fn: string; args: unknown }[] = [];
let nextError: { code: string; message: string } | null = null;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: 'id', error: nextError });
    },
  },
}));

import { useRenamePosTerminal, validateTerminalLabel } from '../hooks/useRenamePosTerminal.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { rpcCalls.length = 0; nextError = null; });

describe('validateTerminalLabel', () => {
  it('refuse un nom vide ou blanc', () => {
    expect(validateTerminalLabel('   ')).toBe('Name is required.');
  });
  it('refuse un nom trop long', () => {
    expect(validateTerminalLabel('x'.repeat(41))).toMatch(/40 characters/);
  });
  it('accepte un nom normal', () => {
    expect(validateTerminalLabel('Main till')).toBeNull();
  });
});

describe('useRenamePosTerminal', () => {
  it('appelle register_pos_device_v1 avec le nom rogné', async () => {
    const { result } = renderHook(() => useRenamePosTerminal(), { wrapper });
    result.current.mutate({ deviceToken: 'pd_75b45abc', label: '  Main till ', kind: 'counter' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcCalls).toEqual([{
      fn: 'register_pos_device_v1',
      args: { p_device_token: 'pd_75b45abc', p_label: 'Main till', p_kind: 'counter' },
    }]);
  });

  it('n’appelle pas le serveur pour un nom vide', async () => {
    const { result } = renderHook(() => useRenamePosTerminal(), { wrapper });
    result.current.mutate({ deviceToken: 'pd_75b45abc', label: ' ', kind: 'tablet' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Name is required.');
    expect(rpcCalls).toEqual([]);
  });

  it('traduit le refus de permission en message lisible', async () => {
    nextError = { code: '42501', message: 'permission denied: reports.audit.read required' };
    const { result } = renderHook(() => useRenamePosTerminal(), { wrapper });
    result.current.mutate({ deviceToken: 'pd_75b45abc', label: 'Tab A8', kind: 'tablet' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('You are not allowed to rename terminals.');
  });
});
