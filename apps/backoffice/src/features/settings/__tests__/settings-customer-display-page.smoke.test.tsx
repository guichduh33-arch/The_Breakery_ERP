// apps/backoffice/src/features/settings/__tests__/settings-customer-display-page.smoke.test.tsx
// S73 Lot 2 — smoke test for the org-level Customer Display settings page.
// ADR-023 — la page porte aussi la curation de la vitrine et l'interrupteur de
// la file de retrait.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsCustomerDisplayPage from '@/pages/settings/SettingsCustomerDisplayPage.js';

const CROISSANT = '11111111-1111-4111-8111-111111111111';
const ECLAIR = '22222222-2222-4222-8222-222222222222';
const BAGUETTE = '33333333-3333-4333-8333-333333333333';
const CAFE = '44444444-4444-4444-8444-444444444444';
const DISPARU = '55555555-5555-4555-8555-555555555555';

const CATALOGUE = [
  { id: CROISSANT, sku: 'CRO-01', name: 'Croissant', retail_price: 25000, image_url: null, parent_product_id: null },
  { id: ECLAIR, sku: 'ECL-01', name: 'Éclair', retail_price: 38000, image_url: null, parent_product_id: null },
  { id: BAGUETTE, sku: 'BAG-01', name: 'Baguette', retail_price: 24000, image_url: null, parent_product_id: null },
  { id: CAFE, sku: 'CAF-01', name: 'Café', retail_price: 35000, image_url: null, parent_product_id: null },
];

const rpcCalls: { fn: string; args: unknown }[] = [];
let savedSelection: string[] = [];
let savedShowReady = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v10') {
        return Promise.resolve({
          data: {
            category: 'customer_display',
            settings: {
              display_footer_message: 'Open daily 07:00-21:00',
              display_slogan: '',
              display_showcase_product_ids: savedSelection,
              display_show_ready_orders: savedShowReady,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v13
    },
    // useShowcaseCandidates : .select().eq().eq().is().order()
    from: () => {
      const order = () => Promise.resolve({ data: CATALOGUE, error: null });
      const is = () => ({ order });
      const eq2 = () => ({ is });
      const eq1 = () => ({ eq: eq2 });
      return { select: () => ({ eq: eq1 }) };
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

beforeEach(() => {
  canUpdate = true;
  rpcCalls.length = 0;
  savedSelection = [];
  savedShowReady = false;
});

describe('SettingsCustomerDisplayPage', () => {
  it('renders the fields seeded from the RPC', async () => {
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
    expect(screen.queryByTestId('showcase-add')).not.toBeInTheDocument();
  });

  it('calls set_setting_v13 with the customer_display category on save', async () => {
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => screen.getByLabelText(/brand slogan/i));

    fireEvent.change(screen.getByLabelText(/brand slogan/i), { target: { value: 'French Bakery' } });
    fireEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'set_setting_v13')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v13');
    expect(call?.args).toEqual({
      p_key: 'display_slogan',
      p_value: 'French Bakery',
      p_category: 'customer_display',
    });
  });

  // ── ADR-023 : la curation ─────────────────────────────────────────────────

  it('dit ce que montre l’écran quand la sélection est vide', async () => {
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => expect(screen.getByTestId('showcase-empty')).toBeInTheDocument());
    expect(screen.getByTestId('showcase-empty')).toHaveTextContent(/brand alone/i);
  });

  it('découpe la sélection en pages de trois', async () => {
    savedSelection = [CROISSANT, ECLAIR, BAGUETTE, CAFE];
    render(wrap(<SettingsCustomerDisplayPage />));

    await waitFor(() => expect(screen.getAllByTestId('showcase-row')).toHaveLength(4));
    expect(screen.getAllByTestId('showcase-page')).toHaveLength(2);
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
  });

  it('signale un produit que le catalogue ne vend plus', async () => {
    savedSelection = [CROISSANT, DISPARU];
    render(wrap(<SettingsCustomerDisplayPage />));

    await waitFor(() => expect(screen.getByTestId('showcase-row-stale')).toBeInTheDocument());
    expect(screen.getByTestId('showcase-row-stale')).toHaveTextContent(/not shown on the display/i);
  });

  it('ajoute un produit par le sélecteur, puis enregistre la liste d’ids', async () => {
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => screen.getByTestId('showcase-add'));

    fireEvent.click(screen.getByTestId('showcase-add'));
    await waitFor(() => screen.getByTestId('showcase-product-picker'));
    fireEvent.click(screen.getByTestId(`showcase-picker-row-${ECLAIR}`));

    await waitFor(() => expect(screen.getAllByTestId('showcase-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v13')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'set_setting_v13');
    expect(call?.args).toEqual({
      p_key: 'display_showcase_product_ids',
      p_value: [ECLAIR],
      p_category: 'customer_display',
    });
  });

  it('remonte un produit dans l’ordre d’affichage', async () => {
    savedSelection = [CROISSANT, ECLAIR];
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => expect(screen.getAllByTestId('showcase-row')).toHaveLength(2));

    // La flèche « monter » de la seconde ligne.
    fireEvent.click(screen.getAllByTestId('showcase-move-up')[1]!);

    const ids = screen.getAllByTestId('showcase-row').map((r) => r.getAttribute('data-product-id'));
    expect(ids).toEqual([ECLAIR, CROISSANT]);
  });

  it('retire un produit de la sélection', async () => {
    savedSelection = [CROISSANT, ECLAIR];
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => expect(screen.getAllByTestId('showcase-row')).toHaveLength(2));

    fireEvent.click(screen.getAllByTestId('showcase-remove')[0]!);

    const ids = screen.getAllByTestId('showcase-row').map((r) => r.getAttribute('data-product-id'));
    expect(ids).toEqual([ECLAIR]);
  });

  it('enregistre l’interrupteur de la file de retrait', async () => {
    render(wrap(<SettingsCustomerDisplayPage />));
    await waitFor(() => screen.getByTestId('show-ready-orders'));

    expect(screen.getByTestId<HTMLInputElement>('show-ready-orders').checked).toBe(false);
    fireEvent.click(screen.getByTestId('show-ready-orders'));
    fireEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'set_setting_v13')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'set_setting_v13');
    expect(call?.args).toEqual({
      p_key: 'display_show_ready_orders',
      p_value: true,
      p_category: 'customer_display',
    });
  });
});
