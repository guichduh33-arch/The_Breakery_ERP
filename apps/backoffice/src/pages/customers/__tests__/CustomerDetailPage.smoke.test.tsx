import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerDetailPage } from '../CustomerDetailPage.js';

const baseCustomer = {
  id: 'c-1',
  name: 'Café Bali',
  email: 'cb@example.com',
  phone: '+62-811',
  category_id: 'cat-1',
  category: {
    id: 'cat-1',
    name: 'Wholesale',
    slug: 'wholesale',
    price_modifier_type: 'wholesale' as const,
    discount_percentage: 0,
    points_multiplier: 1,
    loyalty_enabled: true,
  },
  loyalty_points: 100,
  lifetime_points: 500,
  total_spent: 5_000_000,
  total_visits: 42,
  last_visit_at: '2026-05-22T10:00:00Z',
  birth_date: null,
  marketing_consent: true,
  deleted_at: null,
  b2b_company_name: 'Café Bali SRL',
  b2b_tax_id: '01.234.567.8-901',
  b2b_payment_terms_days: 30,
  b2b_credit_limit: 10_000_000,
  b2b_current_balance: 2_500_000,
  retail_credit_limit: null as number | null,
  store_credit_balance: 150_000,
  created_at: '2026-01-01',
};

let mockCustomerType: 'b2b' | 'retail' = 'b2b';
let mockRetailCreditLimit: number | null = null;
// ADR-013 Lot 4 — permissions simulées (défaut : aucune, comme le store réel
// sans session ; les tests historiques restent iso-comportement).
let mockPerms: string[] = [];

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    selector({ hasPermission: (c: string) => mockPerms.includes(c) }),
}));

vi.mock('@/features/customers/hooks/useStoreCreditHistory.js', () => ({
  storeCreditHistoryKey: (id: string) => ['store-credit-history', id],
  useStoreCreditHistory: () => ({ isLoading: false, data: [] }),
}));

let mockDetailFails = false;
let mockLoyaltyPoints = 100;

// La modale réelle a ses propres tests ; ici on vérifie le SENS transmis.
vi.mock('@/features/loyalty/components/LoyaltyAdjustModal.js', () => ({
  LoyaltyAdjustModal: ({ customer, direction }: { customer?: unknown; direction?: string }) =>
    customer === undefined ? null : <div data-testid="adjust-modal">{direction ?? 'none'}</div>,
}));

vi.mock('@/features/customers/hooks/useCustomerDetail.js', () => ({
  useCustomerDetail: (id: string) => mockDetailFails ? {
    isLoading: false,
    data: undefined,
    error: new Error('permission denied for table customers'),
    refetch: vi.fn(),
  } : {
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      customer: {
        ...baseCustomer,
        loyalty_points: mockLoyaltyPoints,
        id,
        customer_type: mockCustomerType,
        retail_credit_limit: mockRetailCreditLimit,
      },
      orders_count: 42,
      recent_orders: [
        {
          id: 'o-1',
          order_number: 'ORD-001',
          created_at: '2026-05-22T10:00:00Z',
          total: 250_000,
          status: 'completed',
          order_type: 'dine_in',
          items_count: 3,
        },
      ],
    },
  },
}));

vi.mock('@/features/customers/hooks/useUpdateRetailCreditLimit.js', () => ({
  useUpdateRetailCreditLimit: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/loyalty/hooks/useCustomerLoyaltyHistory.js', () => ({
  loyaltyHistoryKey: (id: string) => ['loyalty-history', id],
  useCustomerLoyaltyHistory: () => ({ isLoading: false, data: [] }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

// Les onglets du kit (Radix) s'activent à l'appui du bouton, pas au clic.
function openTab(name: RegExp): void {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/customers/:id" element={<CustomerDetailPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomerDetailPage', () => {
  beforeEach(() => {
    mockCustomerType = 'b2b';
    mockRetailCreditLimit = null;
    mockPerms = [];
    mockDetailFails = false;
    mockLoyaltyPoints = 100;
  });

  // Un échec de lecture affichait « Loading… » pour toujours.
  it('says the customer could not be loaded, with a retry, instead of loading forever', async () => {
    mockDetailFails = true;
    renderAt('/backoffice/customers/c-1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/this customer could not be loaded/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // Le retour vers la liste passe par le fil d'Ariane, rendu dans l'erreur aussi.
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('href', '/backoffice/customers');
    expect(screen.getByRole('heading', { level: 1, name: 'Customer' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('opens the points form in the direction of the button', async () => {
    mockPerms = ['loyalty.adjust'];
    renderAt('/backoffice/customers/c-1');
    fireEvent.click(await screen.findByRole('button', { name: /redeem points/i }));
    expect(screen.getByTestId('adjust-modal')).toHaveTextContent('redeem');
  });

  it('renders header with name, category chip and active badge', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Wholesale')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows B2B credit info on the Info tab', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByText(/10\.000\.000|10,000,000/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2\.500\.000|2,500,000/)).toBeInTheDocument();
  });

  it('drills into an order from the Orders tab', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    openTab(/Orders/);
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=orders');
    const orderLink = await screen.findByRole('link', { name: /ORD-001/ });
    expect(orderLink.getAttribute('href')).toBe('/backoffice/orders/o-1');
  });

  it('does not show the retail tab-limit field for a b2b customer', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/tab limit/i)).not.toBeInTheDocument();
  });

  it('shows the retail tab-limit field for a retail customer, seeded from the mutation value', async () => {
    mockCustomerType = 'retail';
    mockRetailCreditLimit = 750_000;
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/tab limit/i)).toHaveValue('750000');
  });

  // ADR-013 Lot 4 — avoir client (solde + onglet + boutons gatés).
  it('shows the store-credit balance in the loyalty hero', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('store-credit-balance').textContent).toMatch(/150\.000|150,000/);
  });

  it('opens the Store credit tab (empty history)', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    openTab(/Store credit/);
    expect(screen.getByText('No store-credit activity yet.')).toBeInTheDocument();
  });

  it('opens on the tab named in the URL, and ignores an unknown one', async () => {
    renderAt('/backoffice/customers/c-1?tab=store-credit');
    expect(await screen.findByRole('tab', { name: /Store credit/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No store-credit activity yet.')).toBeInTheDocument();
  });

  it('falls back to the Info tab for an unknown tab value', async () => {
    renderAt('/backoffice/customers/c-1?tab=secret');
    expect(await screen.findByRole('tab', { name: /Info/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts the breadcrumb with Sales and ends with the customer name', async () => {
    renderAt('/backoffice/customers/c-1');
    await screen.findByRole('heading', { name: 'Café Bali' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Sales');
    expect(crumbs).toHaveTextContent('Café Bali');
  });

  it('says why the conversion is disabled below the minimum', async () => {
    mockPerms = ['customers.store_credit.convert'];
    mockLoyaltyPoints = 40;
    renderAt('/backoffice/customers/c-1');
    const btn = await screen.findByTestId('convert-store-credit');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/needs at least 100 points to convert/i);
  });

  it('hides grant/convert buttons without the store_credit permissions', async () => {
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('grant-store-credit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('convert-store-credit')).not.toBeInTheDocument();
  });

  it('shows grant/convert buttons with the store_credit permissions', async () => {
    mockPerms = ['customers.store_credit.grant', 'customers.store_credit.convert'];
    renderAt('/backoffice/customers/c-1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Café Bali' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('grant-store-credit')).toBeInTheDocument();
    // loyalty_points = 100 : conversion possible (>= 100).
    expect(screen.getByTestId('convert-store-credit')).not.toBeDisabled();
  });
});
