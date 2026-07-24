// ADR-006 déc. 9 — business hours : rendu depuis la catégorie business,
// validation open < close, save = les 7 jours explicites via set_setting_v8.
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsBusinessHoursPage from '@/pages/settings/SettingsBusinessHoursPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v6') {
        return Promise.resolve({
          data: {
            category: 'business',
            settings: {
              name: 'The Breakery',
              // mon ouvert, tue fermé explicite, wed..sun jamais configurés.
              business_hours: { mon: { open: '07:00', close: '22:00' }, tue: null },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v8
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

describe('SettingsBusinessHoursPage', () => {
  it('renders the weekly schedule from the RPC (open, closed, unconfigured)', async () => {
    render(wrap(<SettingsBusinessHoursPage />));
    await waitFor(() => expect(screen.getByTestId('bh-open-mon')).toBeInTheDocument());

    expect(screen.getByTestId<HTMLInputElement>('bh-open-mon').checked).toBe(true);
    expect(screen.getByTestId<HTMLInputElement>('bh-from-mon').value).toBe('07:00');
    expect(screen.getByTestId<HTMLInputElement>('bh-until-mon').value).toBe('22:00');
    // tue (null) et wed (absent) rendus fermés tous les deux.
    expect(screen.getByTestId<HTMLInputElement>('bh-open-tue').checked).toBe(false);
    expect(screen.getByTestId<HTMLInputElement>('bh-open-wed').checked).toBe(false);
    expect(screen.getByTestId('bh-save')).toBeDisabled();
  });

  it('blocks save while a window is inverted (open >= close)', async () => {
    render(wrap(<SettingsBusinessHoursPage />));
    await waitFor(() => screen.getByTestId('bh-from-mon'));

    fireEvent.change(screen.getByTestId('bh-from-mon'), { target: { value: '23:00' } });

    expect(screen.getByText(/opening must precede closing/i)).toBeInTheDocument();
    expect(screen.getByTestId('bh-save')).toBeDisabled();
  });

  it('saving writes all 7 explicit days through set_setting_v8', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsBusinessHoursPage />));
    await waitFor(() => screen.getByTestId('bh-open-sun'));

    fireEvent.click(screen.getByTestId('bh-open-sun'));
    fireEvent.click(screen.getByTestId('bh-save'));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v8')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'set_setting_v8');
    expect(call?.args).toEqual({
      p_key: 'business_hours',
      p_value: {
        mon: { open: '07:00', close: '22:00' },
        tue: null,
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: { open: '07:00', close: '22:00' },
      },
      p_category: 'business',
    });
  });
});
