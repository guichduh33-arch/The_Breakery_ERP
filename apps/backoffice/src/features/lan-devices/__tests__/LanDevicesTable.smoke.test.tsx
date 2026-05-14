// apps/backoffice/src/features/lan-devices/__tests__/LanDevicesTable.smoke.test.tsx
// Session 13 / Phase 5.A — smoke test for the LAN devices table.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanDevicesTable } from '../components/LanDevicesTable.js';
import * as devicesMod from '../hooks/useLanDevices.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeQuery(data: unknown, overrides: Partial<any> = {}): any {
  return { data, isLoading: false, error: null, ...overrides };
}

describe('LanDevicesTable', () => {
  it('renders empty state when no devices', () => {
    vi.spyOn(devicesMod, 'useLanDevices').mockReturnValue(fakeQuery([]));
    render(wrap(<LanDevicesTable />));
    expect(screen.getByText(/No LAN devices registered/i)).toBeInTheDocument();
  });

  it('renders rows with online / stale status', () => {
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

    render(wrap(<LanDevicesTable />));
    expect(screen.getByText('POS-01')).toBeInTheDocument();
    expect(screen.getByText('PRN-01')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
  });
});
