// apps/backoffice/src/features/products/__tests__/products-page-tabs.smoke.test.tsx
// S42 — P7: route-based tabs use nav semantics (aria-current), not ARIA tab roles.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsPageTabs } from '../components/ProductsPageTabs.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (_: string) => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

describe('ProductsPageTabs [S42 smoke]', () => {
  it('P7: no ARIA tab roles; active link carries aria-current=page', () => {
    render(
      <MemoryRouter initialEntries={['/backoffice/products']}>
        <ProductsPageTabs />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    const active = screen.getByRole('link', { name: 'Products' });
    expect(active).toHaveAttribute('aria-current', 'page');
    const inactive = screen.getByRole('link', { name: 'Import / Export' });
    expect(inactive).not.toHaveAttribute('aria-current');
  });
});
