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

  it('readOnly disables the URL input and both toggles', () => {
    render(<PrintingSettingsTab readOnly />);
    expect(screen.getByLabelText('Print server URL')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Auto-print receipt on payment' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Auto-open cash drawer (cash)' })).toBeDisabled();
  });
});
