import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsInventoryPage from '@/pages/settings/SettingsInventoryPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v4') {
        return Promise.resolve({ data: { category: 'inventory', settings: { allow_negative_stock: true } }, error: null });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v5
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

describe('SettingsInventoryPage', () => {
  it('renders the allow_negative_stock toggle from the RPC', async () => {
    render(wrap(<SettingsInventoryPage />));
    await waitFor(() => expect(screen.getByLabelText(/stock négatif/i)).toBeInTheDocument());
    expect(screen.getByLabelText<HTMLInputElement>(/stock négatif/i).checked).toBe(true);
  });

  it('calls set_setting_v5 on save', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsInventoryPage />));
    await waitFor(() => screen.getByLabelText(/stock négatif/i));
    fireEvent.click(screen.getByLabelText(/stock négatif/i));
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer/i }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v5')).toBe(true));
  });
});
