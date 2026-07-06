// apps/backoffice/src/features/lan-devices/__tests__/lan-device-form.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';

const mutate = vi.fn();
vi.mock('../hooks/useUpsertLanDevice.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useUpsertLanDevice.js')>();
  return { ...mod, useUpsertLanDevice: () => ({ mutate, isPending: false }) };
});

import { LanDeviceFormModal } from '../components/LanDeviceFormModal.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function row(over: Partial<LanDeviceRow>): LanDeviceRow {
  return {
    id: 'r1', code: 'X', name: 'X', device_type: 'printer', ip_address: '192.168.1.61',
    port: 9100, location: null, is_active: true, last_heartbeat_at: null,
    capabilities: { station: 'barista' }, created_at: '', updated_at: '', deleted_at: null,
    ...over,
  };
}

beforeEach(() => mutate.mockClear());

describe('LanDeviceFormModal', () => {
  it('shows the station select only for printers', () => {
    render(wrap(<LanDeviceFormModal open onClose={() => {}} device={null} prefill={null} allDevices={[]} />));
    // défaut = printer → station visible
    expect(screen.getByLabelText(/station/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/device type/i), { target: { value: 'kds' } });
    expect(screen.queryByLabelText(/station/i)).not.toBeInTheDocument();
  });

  it('prefills ip/port from a scan hit and submits capabilities.station', () => {
    render(wrap(
      <LanDeviceFormModal open onClose={() => {}} device={null}
        prefill={{ ip_address: '192.168.1.60', port: 9100 }} allDevices={[]} />,
    ));
    expect(screen.getByLabelText(/ip address/i)).toHaveValue('192.168.1.60');
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'PRN-KITCHEN-1' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Kitchen printer' } });
    fireEvent.change(screen.getByLabelText(/station/i), { target: { value: 'kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PRN-KITCHEN-1', ip_address: '192.168.1.60', port: 9100, station: 'kitchen' }),
      expect.anything(),
    );
  });

  it('warns (non-blocking) when another active printer already has the station', () => {
    render(wrap(
      <LanDeviceFormModal open onClose={() => {}} device={null} prefill={null}
        allDevices={[row({ id: 'other', capabilities: { station: 'kitchen' } })]} />,
    ));
    fireEvent.change(screen.getByLabelText(/station/i), { target: { value: 'kitchen' } });
    expect(screen.getByText(/already assigned/i)).toBeInTheDocument();
    // non bloquant : le bouton Save reste actif
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('requires ip+port for printers', () => {
    render(wrap(<LanDeviceFormModal open onClose={() => {}} device={null} prefill={null} allDevices={[]} />));
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'PRN-1' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'P' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/ip address and port are required/i)).toBeInTheDocument();
  });
});
