// apps/backoffice/src/features/lan-devices/__tests__/upsert-hook.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const inserted: unknown[] = [];
const updated: { patch: unknown; id: string }[] = [];
let nextError: { code: string; message: string } | null = null;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe('lan_devices');
      return {
        insert: (row: unknown) => {
          inserted.push(row);
          return Promise.resolve({ error: nextError });
        },
        update: (patch: unknown) => ({
          eq: (_col: string, id: string) => {
            updated.push({ patch, id });
            return Promise.resolve({ error: nextError });
          },
        }),
      };
    },
  },
}));

import { useUpsertLanDevice } from '../hooks/useUpsertLanDevice.js';
import { useDeleteLanDevice } from '../hooks/useDeleteLanDevice.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { inserted.length = 0; updated.length = 0; nextError = null; });

describe('useUpsertLanDevice', () => {
  it('INSERTs a printer with capabilities.station', async () => {
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      code: 'PRN-KITCHEN-1', name: 'Kitchen printer', device_type: 'printer',
      ip_address: '192.168.1.60', port: 9100, location: 'kitchen', is_active: true, station: 'kitchen',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inserted[0]).toMatchObject({
      code: 'PRN-KITCHEN-1', device_type: 'printer', ip_address: '192.168.1.60',
      port: 9100, capabilities: { station: 'kitchen' },
    });
  });

  it('UPDATEs by id, merging existing capabilities and dropping station when null', async () => {
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      id: 'dev-1', code: 'KDS-1', name: 'KDS', device_type: 'kds',
      ip_address: null, port: null, location: null, is_active: true, station: null,
      existingCapabilities: { station: 'kitchen', print_widths: [80] },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updated[0]!.id).toBe('dev-1');
    expect(updated[0]!.patch).toMatchObject({ capabilities: { print_widths: [80] } });
    expect((updated[0]!.patch as { capabilities: Record<string, unknown> }).capabilities).not.toHaveProperty('station');
  });

  it('maps 23505 to code_taken', async () => {
    nextError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const { result } = renderHook(() => useUpsertLanDevice(), { wrapper });
    result.current.mutate({
      code: 'DUP', name: 'x', device_type: 'pos',
      ip_address: null, port: null, location: null, is_active: true, station: null,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('code_taken');
  });
});

describe('useDeleteLanDevice', () => {
  it('soft-deletes by setting deleted_at', async () => {
    const { result } = renderHook(() => useDeleteLanDevice(), { wrapper });
    result.current.mutate({ id: 'dev-9' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updated[0]!.id).toBe('dev-9');
    expect((updated[0]!.patch as { deleted_at: string }).deleted_at).toMatch(/^\d{4}-/);
  });
});
