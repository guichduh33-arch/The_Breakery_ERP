// apps/backoffice/src/__tests__/lan-devices-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip on LanDevicesPage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/features/lan-devices/hooks/useLanDevices.js', () => ({
  useLanDevices: () => ({
    data: [
      { id: 'd1', code: 'POS-01', name: 'Front terminal', device_type: 'pos',
        ip_address: '192.168.1.10', port: null, location: 'counter', is_active: true,
        last_heartbeat_at: new Date(Date.now() - 5_000).toISOString(),
        capabilities: {}, created_at: '', updated_at: '', deleted_at: null },
      { id: 'd2', code: 'PRN-01', name: 'Kitchen printer', device_type: 'printer',
        ip_address: '192.168.1.20', port: 9100, location: 'kitchen', is_active: true,
        last_heartbeat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        capabilities: {}, created_at: '', updated_at: '', deleted_at: null },
    ],
    isLoading: false,
    error: null,
  }),
  LAN_DEVICES_KEY: ['lan-devices'],
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe('LanDevicesPage (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders all 4 KPI tile labels', { timeout: 30_000 }, async () => {
    const LanDevicesPage = (await import('@/pages/lan-devices/LanDevicesPage.js')).default;
    renderPage(LanDevicesPage);
    expect(screen.getByText(/Total devices/i)).toBeInTheDocument();
    // "Online" / "Stale" also appear as row status badges — multiple matches expected.
    expect(screen.getAllByText(/^Online$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Stale$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/^Printers$/i)).toBeInTheDocument();
  });

  it('renders the underlying device rows', { timeout: 15_000 }, async () => {
    const LanDevicesPage = (await import('@/pages/lan-devices/LanDevicesPage.js')).default;
    renderPage(LanDevicesPage);
    expect(screen.getByText('POS-01')).toBeInTheDocument();
    expect(screen.getByText('PRN-01')).toBeInTheDocument();
  });
});
