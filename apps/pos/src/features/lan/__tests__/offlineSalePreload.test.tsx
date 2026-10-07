import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { OfflineSaleContext } from '../OfflineSaleContext';

const loaders = vi.hoisted(() => ({ modifiers: vi.fn(), combo: vi.fn(), variants: vi.fn(), stations: vi.fn(), preload: vi.fn(), shift: vi.fn() }));
vi.mock('@/features/products/hooks/usePrefetchProductModifiers', () => ({ usePrefetchModifierOptions: loaders.preload }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ useStationMap: loaders.stations }));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [
  { id: 'untapped-parent', category_id: 'drinks', has_variants: true, product_type: 'standard' },
  { id: 'untapped-combo', category_id: 'food', product_type: 'combo' },
] }) }));
vi.mock('@/features/products/hooks/useCategories', () => ({ useCategories: () => ({ data: [] }) }));
vi.mock('@/features/products/hooks/usePromotionVariants', () => ({ usePromotionVariants: (ids: string[]) => {
  loaders.variants(ids); return new Map([['untapped-parent', [{ id: 'untapped-variant' }]]]);
} }));
vi.mock('@/features/products/hooks/useProductModifiers', () => ({ useProductModifiers: loaders.modifiers }));
vi.mock('@/features/combos/hooks/useComboConfig', () => ({ useComboConfig: loaders.combo }));
vi.mock('@/features/settings/hooks/useTaxConfig', () => ({ useTaxConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useOfflineNetworkConfig', () => ({ useOfflineNetworkConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useEnabledPaymentMethods', () => ({ useEnabledPaymentMethods: () => new Set() }));
vi.mock('@/features/shift/hooks/useShift', () => ({ useCurrentShift: loaders.shift }));
vi.mock('@/features/promotions/hooks/usePromotions', () => ({ usePromotions: () => ({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  const now = Date.now();
  useAuthStore.setState({
    user: { id: 'cashier', full_name: 'Test', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: 'session', isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: true,
    localSession: { version: 1, token: 'session', userId: 'cashier', permissions: [],
      expiresAt: now + 3600000, lastActivityAt: now, observedAt: now, idleMs: 1800000 },
  });
});

it('loads every sellable product dependency without opening product modals', () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/pos']}>
    <OfflineSaleContext />
  </MemoryRouter></QueryClientProvider>);
  expect(loaders.variants).toHaveBeenCalledWith(['untapped-parent']);
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-parent', categoryId: 'drinks' });
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-variant', categoryId: 'drinks' });
  expect(loaders.modifiers).toHaveBeenCalledWith({ productId: 'untapped-combo', categoryId: 'food' });
  expect(loaders.combo).toHaveBeenCalledWith('untapped-combo');
  expect(loaders.stations).toHaveBeenCalled();
});

it('preloads untapped tablet product and variant options without a cashier shift', () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/tablet/order']}>
    <OfflineSaleContext />
  </MemoryRouter></QueryClientProvider>);
  expect(loaders.preload).toHaveBeenCalledWith([
    { productId: 'untapped-parent', categoryId: 'drinks' },
    { productId: 'untapped-variant', categoryId: 'drinks' },
    { productId: 'untapped-combo', categoryId: 'food' },
  ], true, Infinity);
  expect(loaders.shift).not.toHaveBeenCalled();
});

it('does not preload options for a locked tablet session', () => {
  useAuthStore.setState({ isLocked: true });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/tablet/order']}>
    <OfflineSaleContext />
  </MemoryRouter></QueryClientProvider>);
  expect(loaders.preload).not.toHaveBeenCalled();
});
