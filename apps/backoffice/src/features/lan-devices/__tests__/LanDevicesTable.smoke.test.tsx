// apps/backoffice/src/features/lan-devices/__tests__/LanDevicesTable.smoke.test.tsx
// Session 13 / Phase 5.A — smoke test for the LAN devices table.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { LanDevicesTable } from '../components/LanDevicesTable.js';
import * as devicesMod from '../hooks/useLanDevices.js';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';

// Module-level mock, controllable per-test via `currentCanManage` — mirrors
// the pattern used across BO smokes (e.g. ExpenseDetailPage.smoke.test.tsx)
// since useAuthStore is a zustand store hook, not spy-able in place.
let currentCanManage = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => currentCanManage }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

type DevicesQuery = UseQueryResult<LanDeviceRow[], Error>;

function fakeQuery(data: LanDeviceRow[], overrides: Partial<DevicesQuery> = {}): DevicesQuery {
  return { data, isLoading: false, error: null, ...overrides } as unknown as DevicesQuery;
}

describe('LanDevicesTable', () => {
  it('renders empty state when no devices', () => {
    currentCanManage = true;
    vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([]));
    render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
    expect(screen.getByText(/No LAN devices registered/i)).toBeInTheDocument();
  });

  it('renders rows with online / stale status', () => {
    currentCanManage = true;
    const now = Date.now();
    vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([
      {
        id: 'd1', code: 'POS-01', name: 'Front terminal',
        device_type: 'pos', ip_address: '192.168.1.10', port: null,
        location: 'counter', is_active: true,
        last_heartbeat_at: new Date(now - 5_000).toISOString(),
        capabilities: {}, created_at: '', updated_at: '', deleted_at: null,
      },
      {
        id: 'd2', code: 'PRN-01', name: 'Kitchen printer',
        device_type: 'printer', ip_address: '192.168.1.20', port: 9100,
        location: 'kitchen', is_active: true,
        last_heartbeat_at: new Date(now - 5 * 60_000).toISOString(),
        capabilities: {}, created_at: '', updated_at: '', deleted_at: null,
      },
    ]));

    render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
    expect(screen.getByText('POS-01')).toBeInTheDocument();
    expect(screen.getByText('PRN-01')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('shows IP:port and station for printers', () => {
    currentCanManage = true;
    vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([
      {
        id: 'd2', code: 'PRN-01', name: 'Kitchen printer', device_type: 'printer',
        ip_address: '192.168.1.20', port: 9100, location: 'kitchen', is_active: true,
        last_heartbeat_at: null, capabilities: { station: 'kitchen' },
        created_at: '', updated_at: '', deleted_at: null,
      },
    ]));
    render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
    expect(screen.getByText('192.168.1.20:9100')).toBeInTheDocument();
    expect(screen.getByText('kitchen', { selector: 'span' })).toBeInTheDocument();
  });

  it('hides actions without lan.devices.manage', () => {
    currentCanManage = false;
    vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([
      { id: 'd1', code: 'POS-01', name: 'T', device_type: 'pos', ip_address: null, port: null,
        location: null, is_active: true, last_heartbeat_at: null, capabilities: {},
        created_at: '', updated_at: '', deleted_at: null },
    ]));
    render(wrap(<LanDevicesTable onEdit={vi.fn()} />));
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
