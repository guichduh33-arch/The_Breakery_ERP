import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPaymentMethodsPage from '@/pages/settings/SettingsPaymentMethodsPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v2') {
        return Promise.resolve({
          data: { category: 'payments', settings: { enabled_payment_methods: ['cash', 'card'] } },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v2
    },
  },
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('SettingsPaymentMethodsPage', () => {
  it('renders checked/unchecked state from the RPC', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => expect(screen.getByLabelText(/^cash$/i)).toBeInTheDocument());

    expect((screen.getByLabelText(/^cash$/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^card$/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^qris$/i) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/^edc$/i) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/^transfer$/i) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/^store credit$/i) as HTMLInputElement).checked).toBe(false);
  });

  it('disables save and shows a warning when every method is unchecked', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByLabelText(/^cash$/i));

    fireEvent.click(screen.getByLabelText(/^cash$/i));
    fireEvent.click(screen.getByLabelText(/^card$/i));

    expect(screen.getByText(/au moins une méthode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled();
  });

  it('calls set_setting_v2 with the remaining methods on save', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByLabelText(/^cash$/i));

    fireEvent.click(screen.getByLabelText(/^card$/i));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v2')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v2');
    expect(call?.args).toEqual({
      p_key: 'enabled_payment_methods',
      p_value: ['cash'],
      p_category: 'payments',
    });
  });
});
