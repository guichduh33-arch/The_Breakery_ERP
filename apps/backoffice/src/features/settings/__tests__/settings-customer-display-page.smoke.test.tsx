// apps/backoffice/src/features/settings/__tests__/settings-customer-display-page.smoke.test.tsx
// S73 Lot 2 — smoke test for the org-level Customer Display settings page.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsCustomerDisplayPage from '@/pages/settings/SettingsCustomerDisplayPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v5') {
        return Promise.resolve({
          data: {
            category: 'customer_display',
            settings: { display_footer_message: 'Open daily 07:00-21:00', display_slogan: '' },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v7
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

describe('SettingsCustomerDisplayPage', () => {
  it('renders the fields seeded from the RPC', async () => {
    canUpdate = true;
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => expect(screen.getByLabelText(/idle footer message/i)).toBeInTheDocument());

    expect(screen.getByLabelText<HTMLInputElement>(/idle footer message/i).value).toBe('Open daily 07:00-21:00');
    expect(screen.getByLabelText<HTMLInputElement>(/brand slogan/i).value).toBe('');
  });

  it('disables the inputs and hides Save without settings.update', async () => {
    canUpdate = false;
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => expect(screen.getByLabelText(/idle footer message/i)).toBeInTheDocument());

    expect(screen.getByLabelText(/idle footer message/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('calls set_setting_v7 with the customer_display category on save', async () => {
    canUpdate = true;
    rpcCalls.length = 0;
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => screen.getByLabelText(/brand slogan/i));

    fireEvent.change(screen.getByLabelText(/brand slogan/i), { target: { value: 'French Bakery' } });
    fireEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'set_setting_v7')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v7');
    expect(call?.args).toEqual({
      p_key: 'display_slogan',
      p_value: 'French Bakery',
      p_category: 'customer_display',
    });
  });
});
