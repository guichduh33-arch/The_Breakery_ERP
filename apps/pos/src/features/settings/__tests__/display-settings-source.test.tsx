import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DisplaySettingsTab } from '../components/DisplaySettingsTab';
import { displayChannel, getDisplaySourceId } from '@/features/display/displaySource';

vi.mock('../hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: () => ({ displayFooterMessage: '', displaySlogan: '' }),
  useSetOrgDisplaySetting: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('customer display opened from settings', () => {
  it('opens the channel of this checkout, including when reopened', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const checkoutSource = getDisplaySourceId();
    render(<DisplaySettingsTab readOnly={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open customer display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open customer display' }));

    expect(open).toHaveBeenCalledTimes(2);
    for (const call of open.mock.calls) {
      const url = new URL(String(call[0]), window.location.origin);
      expect(url.pathname).toBe('/display');
      expect(url.searchParams.get('source')).toBe(checkoutSource);
      expect(displayChannel(url.searchParams.get('source')!)).toBe(displayChannel());
      expect(call[1]).toBe('breakery-customer-display');
    }
  });
});
