/// <reference types="@testing-library/jest-dom" />
// ADR-030 — les diagnostics LAN ont quitté le back-office pour cet onglet.
// Couvre les trois gestes déménagés : balayage réseau, test d'imprimante,
// état du hub.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { toast } from 'sonner';
import { NetworkScanPanel } from '../components/NetworkScanPanel';
import { PrinterTestPanel } from '../components/PrinterTestPanel';
import { HubStatusPanel } from '../components/HubStatusPanel';
import { usePrinterDevices } from '../hooks/usePrinterDevices';
import { scanPrinters, probePrinter, getHubStatus } from '@/services/print/bridgeDiagnostics';
import { printStationTicket } from '@/services/print/printService';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/services/print/bridgeDiagnostics', () => ({
  scanPrinters: vi.fn(),
  probePrinter: vi.fn(),
  getHubStatus: vi.fn(),
}));

vi.mock('@/services/print/printService', () => ({
  printStationTicket: vi.fn(),
}));

vi.mock('../hooks/usePrinterDevices', () => ({
  usePrinterDevices: vi.fn(),
}));

const KITCHEN = {
  id: 'p1',
  code: 'PRN-KITCHEN',
  name: 'Kitchen printer',
  ip_address: '192.168.1.50',
  port: 9100,
  station: 'kitchen',
};

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePrinterDevices).mockReturnValue({
    data: [KITCHEN],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePrinterDevices>);
});

describe('NetworkScanPanel', () => {
  it('refuses a public prefix without calling the bridge', async () => {
    render(<NetworkScanPanel readOnly={false} />);
    fireEvent.change(screen.getByLabelText('Network prefix'), { target: { value: '8.8.8' } });
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));

    expect(await screen.findByText(/private network prefix/i)).toBeInTheDocument();
    expect(scanPrinters).not.toHaveBeenCalled();
  });

  it('lists hits and marks the ones already registered', async () => {
    vi.mocked(scanPrinters).mockResolvedValue({
      devices: [
        { ip: '192.168.1.50', port: 9100, latencyMs: 4 },
        { ip: '192.168.1.77', port: 9100, latencyMs: 9 },
      ],
      hostsScanned: 254,
      durationMs: 1200,
    });

    render(<NetworkScanPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));

    expect(await screen.findByText('192.168.1.77:9100')).toBeInTheDocument();
    // Déjà au registre → pas de bouton Copy, on affiche son code.
    expect(screen.getByText(/Already registered — PRN-KITCHEN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy 192.168.1.77:9100' })).toBeInTheDocument();
  });

  it('surfaces an unreachable bridge with an actionable message', async () => {
    vi.mocked(scanPrinters).mockRejectedValue(new Error('bridge_unreachable'));

    render(<NetworkScanPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: /scan network/i }));

    expect(await screen.findByText(/Print-bridge unreachable/i)).toBeInTheDocument();
  });
});

describe('PrinterTestPanel', () => {
  it('probes then prints a test ticket on the registered printer', async () => {
    vi.mocked(probePrinter).mockResolvedValue({ reachable: true, latencyMs: 5 });
    vi.mocked(printStationTicket).mockResolvedValue({ success: true });

    render(<PrinterTestPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test PRN-KITCHEN' }));

    await waitFor(() => expect(printStationTicket).toHaveBeenCalled());
    expect(probePrinter).toHaveBeenCalledWith('192.168.1.50', 9100);
    const [target, payload] = vi.mocked(printStationTicket).mock.calls[0]!;
    expect(target).toEqual({ ip_address: '192.168.1.50', port: 9100 });
    expect(payload.role).toBe('kitchen');
    expect(payload.order_number).toBe('TEST');
    expect(toast.success).toHaveBeenCalled();
  });

  it('stops at the probe when the printer does not answer', async () => {
    vi.mocked(probePrinter).mockResolvedValue({ reachable: false });

    render(<PrinterTestPanel readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test PRN-KITCHEN' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(printStationTicket).not.toHaveBeenCalled();
  });

  it('disables the test button in read-only mode', () => {
    render(<PrinterTestPanel readOnly />);
    expect(screen.getByRole('button', { name: 'Test PRN-KITCHEN' })).toBeDisabled();
  });
});

describe('HubStatusPanel', () => {
  it('renders the bus presence when the hub answers', async () => {
    vi.mocked(getHubStatus).mockResolvedValue({
      enabled: true,
      version: '1.2.0',
      uptime_s: 3720,
      token_required: true,
      devices: [
        {
          device_code: 'POS-FRONT-01',
          device_type: 'pos',
          ip: '192.168.1.20',
          connected_at: '2026-08-22T01:00:00Z',
          last_seen_at: '2026-08-22T02:00:00Z',
        },
      ],
      buffer: { count: 3, oldest_ts: null, newest_ts: null },
    });

    renderWithQuery(<HubStatusPanel />);

    expect(await screen.findByText('Hub online')).toBeInTheDocument();
    expect(screen.getByText('POS-FRONT-01')).toBeInTheDocument();
    expect(screen.getByText('v1.2.0')).toBeInTheDocument();
  });

  it('tells the user where to look when the hub is unreachable', async () => {
    vi.mocked(getHubStatus).mockRejectedValue(new Error('bridge_unreachable'));

    renderWithQuery(<HubStatusPanel />);

    expect(await screen.findByText(/Hub unreachable/i)).toBeInTheDocument();
  });
});
