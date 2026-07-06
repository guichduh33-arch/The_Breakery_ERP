// apps/backoffice/src/features/lan-devices/__tests__/scan-panel.smoke.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';
import { ScanPanel } from '../components/ScanPanel.js';

afterEach(() => vi.restoreAllMocks());

function device(over: Partial<LanDeviceRow>): LanDeviceRow {
  return {
    id: 'd1', code: 'PRN-01', name: 'P', device_type: 'printer', ip_address: '192.168.1.60',
    port: 9100, location: null, is_active: true, last_heartbeat_at: null, capabilities: {},
    created_at: '', updated_at: '', deleted_at: null, ...over,
  };
}

function stubScan(devices: { ip: string; port: number; latencyMs: number }[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ devices, hostsScanned: 254, durationMs: 900 }), { status: 200 }),
  ));
}

describe('ScanPanel', () => {
  it('scans and lists hits with an Add button', async () => {
    stubScan([{ ip: '192.168.1.61', port: 9100, latencyMs: 7 }]);
    const onAdd = vi.fn();
    render(<ScanPanel devices={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText('192.168.1.61:9100')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith({ ip_address: '192.168.1.61', port: 9100 });
  });

  it('flags already-configured printers by IP', async () => {
    stubScan([{ ip: '192.168.1.60', port: 9100, latencyMs: 4 }]);
    render(<ScanPanel devices={[device({})]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/already configured/i)).toBeInTheDocument());
    expect(screen.getByText(/PRN-01/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('shows the empty state after a scan with no hits', async () => {
    stubScan([]);
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/no printer found/i)).toBeInTheDocument());
  });

  it('rejects a public prefix client-side', () => {
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/network prefix/i), { target: { value: '8.8.8' } });
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    expect(screen.getByText(/private network prefix/i)).toBeInTheDocument();
  });

  it('surfaces bridge_unreachable with a hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    render(<ScanPanel devices={[]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));
    await waitFor(() => expect(screen.getByText(/print-bridge unreachable/i)).toBeInTheDocument());
  });
});
