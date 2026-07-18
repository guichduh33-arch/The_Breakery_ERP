/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useOrgDisplaySettings, useSetOrgDisplaySetting } from '../hooks/useOrgDisplaySettings';
import { PrintingSettingsTab } from '../components/PrintingSettingsTab';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }));

const mutateMock = vi.fn();
vi.mock('../hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: vi.fn(() => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  })),
  useSetOrgDisplaySetting: vi.fn(() => ({ mutate: mutateMock, isPending: false })),
}));

// Chantier KOT copies — mock module (the real hook needs a QueryClientProvider).
vi.mock('../hooks/useKotCopies', () => ({
  KOT_COPIES_DEFAULTS: { barista: 1, kitchen: 1, display: 1 },
  useKotCopies: vi.fn(() => ({ data: { barista: 1, kitchen: 2, display: 0 } })),
  getKotCopies: vi.fn(() => Promise.resolve({ barista: 1, kitchen: 2, display: 0 })),
}));

beforeEach(() => {
  localStorage.clear();
  mutateMock.mockReset();
  usePosSettingsStore.setState({ printerUrl: '' });
  vi.mocked(useOrgDisplaySettings).mockReturnValue({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  });
  vi.mocked(useSetOrgDisplaySetting).mockReturnValue({
    mutate: mutateMock,
    isPending: false,
  } as unknown as ReturnType<typeof useSetOrgDisplaySetting>);
});

describe('PrintingSettingsTab', () => {
  it('editing the URL persists to the store', () => {
    render(<PrintingSettingsTab readOnly={false} />);
    const input = screen.getByLabelText(/print server url/i);
    fireEvent.change(input, { target: { value: 'http://192.168.1.77:3001' } });
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.77:3001');
  });

  it('toggling auto-print calls the org mutation with the printing category', () => {
    render(<PrintingSettingsTab readOnly={false} />);
    fireEvent.click(screen.getByRole('switch', { name: /auto-print/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'pos_auto_print_receipt', value: false, category: 'printing' },
      expect.anything(),
    );
  });

  it('toggling auto-open-drawer calls the org mutation with the printing category', () => {
    render(<PrintingSettingsTab readOnly={false} />);
    fireEvent.click(screen.getByRole('switch', { name: /auto-open cash drawer/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'pos_auto_open_drawer', value: false, category: 'printing' },
      expect.anything(),
    );
  });

  it('KOT stepper increment calls the org mutation with the station key', () => {
    render(<PrintingSettingsTab readOnly={false} />);
    // Steppers render in KOT_STATIONS order: kitchen (2), barista (1), display (0).
    const increases = screen.getAllByRole('button', { name: 'Increase' });
    fireEvent.click(increases[0]!); // kitchen 2 → 3
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'kot_copies_kitchen', value: 3, category: 'printing' },
      expect.anything(),
    );
  });

  it('KOT stepper decrement stops at 0 (paper off), no negative write', () => {
    render(<PrintingSettingsTab readOnly={false} />);
    const decreases = screen.getAllByRole('button', { name: 'Decrease' });
    // display is at 0 → its Decrease button is disabled (min reached).
    expect(decreases[2]).toBeDisabled();
  });

  it('readOnly disables the URL input and both toggles', () => {
    render(<PrintingSettingsTab readOnly />);
    expect(screen.getByLabelText('Print server URL')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Auto-print receipt on payment' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Auto-open cash drawer (cash)' })).toBeDisabled();
  });
});
