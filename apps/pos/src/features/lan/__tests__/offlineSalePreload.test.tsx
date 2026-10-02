import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { OfflineSaleContext } from '../OfflineSaleContext';

const loaders = vi.hoisted(() => ({ modifiers: vi.fn(), combo: vi.fn(), variants: vi.fn(), stations: vi.fn() }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ useStationMap: loaders.stations }));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [
  { id: 'untapped-parent', category_id: 'drinks', has_variants: true, product_type: 'standard' },
  { id: 'untapped-combo', category_id: 'food', product_type: 'combo' },
] }) }));
vi.mock('@/features/products/hooks/useCategories', () => ({ useCategories: () => ({ data: [] }) }));
vi.mock('@/features/products/hooks/useProductVariants', () => ({ useProductVariants: (id: string) => {
  loaders.variants(id); return { data: [{ id: 'untapped-variant' }] };
} }));
vi.mock('@/features/products/hooks/useProductModifiers', () => ({ useProductModifiers: loaders.modifiers }));
vi.mock('@/features/combos/hooks/useComboConfig', () => ({ useComboConfig: loaders.combo }));
vi.mock('@/features/settings/hooks/useTaxConfig', () => ({ useTaxConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useOfflineNetworkConfig', () => ({ useOfflineNetworkConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useEnabledPaymentMethods', () => ({ useEnabledPaymentMethods: () => new Set() }));
vi.mock('@/features/shift/hooks/useShift', () => ({ useCurrentShift: () => ({}) }));
vi.mock('@/features/promotions/hooks/usePromotions', () => ({ usePromotions: () => ({}) }));

it('loads every sellable product dependency without opening product modals', () => {
  const now = Date.now();
  useAuthStore.setState({
    user: { id: 'cashier', full_name: 'Test', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: 'session', isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: true,
    localSession: { version: 1, token: 'session', userId: 'cashier', permissions: [],
      expiresAt: now + 3600000, lastActivityAt: now, observedAt: now, idleMs: 1800000 },
  });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/pos']}>
    <OfflineSaleContext />
  </MemoryRouter></QueryClientProvider>);
  expect(loaders.variants).toHaveBeenCalledWith('untapped-parent');
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-parent', categoryId: 'drinks' });
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-variant', categoryId: 'drinks' });
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-combo', categoryId: 'food' });
  expect(loaders.combo).toHaveBeenCalledWith('untapped-combo');
  expect(loaders.stations).toHaveBeenCalled();
});
