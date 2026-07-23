// apps/backoffice/src/features/settings/__tests__/settings-pos-config-page.smoke.test.tsx
// S73 Lot 3 — smoke test for the org-level POS Configuration settings page.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPosConfigPage from '@/pages/settings/SettingsPosConfigPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v4') {
        return Promise.resolve({
          data: {
            category: 'pos_presets',
            settings: {
              pos_quick_payment_amounts: [50000, 100000, 200000],
              pos_opening_cash_presets: [1000000, 2000000, 5000000],
              pos_discount_presets: [
                { value: 10, name: 'Staff Meal' },
                { value: 50, name: 'Loyalty Discount' },
              ],
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v6
    },
  },
}));

let canUpdate = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => canUpdate }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('SettingsPosConfigPage', () => {
  it('renders all three section titles', async () => {
    canUpdate = true;
    render(wrap(<SettingsPosConfigPage />));
    await waitFor(() => expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument());

    expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument();
    expect(screen.getByText(/shift opening cash presets/i)).toBeInTheDocument();
    expect(screen.getByText(/quick discount presets/i)).toBeInTheDocument();
  });

  it('hides Remove buttons when the user lacks settings.update', async () => {
    canUpdate = false;
    render(wrap(<SettingsPosConfigPage />));
    await waitFor(() => expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument());

    // No remove buttons should be present
    expect(screen.queryAllByLabelText(/remove/i)).toHaveLength(0);
  });

  it('calls set_setting_v6 with category pos_presets on save', async () => {
    canUpdate = true;
    rpcCalls.length = 0;
    render(wrap(<SettingsPosConfigPage />));
    await waitFor(() => expect(screen.getByLabelText(/new quick payment amounts value/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/new quick payment amounts value/i), { target: { value: '300000' } });
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    if (addButtons.length > 0) {
      fireEvent.click(addButtons[0]!);
    }

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'set_setting_v6')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v6');
    expect(call?.args).toEqual({
      p_key: 'pos_quick_payment_amounts',
      p_value: [50000, 100000, 200000, 300000],
      p_category: 'pos_presets',
    });
  });
});
