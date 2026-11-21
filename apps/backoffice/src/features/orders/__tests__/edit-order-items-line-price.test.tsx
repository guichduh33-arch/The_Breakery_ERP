// apps/backoffice/src/features/orders/__tests__/edit-order-items-line-price.test.tsx
//
// L'aperçu de l'édition prend le prix de ligne du SERVEUR (`line_total`,
// modificateurs compris). `unit_price × qty` perdait les suppléments : une
// ligne 2 × (20 000 + 5 000 d'extra) s'affichait 40 000 au lieu de 50 000.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditOrderItemsModal } from '../components/EditOrderItemsModal.js';

vi.mock('@/features/orders/hooks/useEditOrderItems.js', () => ({
  useEditOrderItems: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/orders/components/ProductPicker.js', () => ({
  ProductPicker: () => null,
}));

describe('EditOrderItemsModal line price', () => {
  it('shows the server line total, modifiers included, not unit_price × qty', () => {
    render(
      <EditOrderItemsModal
        open
        onClose={() => undefined}
        orderId="o-1"
        orderNumber="ORD-1"
        currentItems={[{
          id: 'i-1', product_id: 'p-1', name_snapshot: 'Latte + oat milk',
          qty: 2, unit_price: 20_000, line_total: 50_000, modifiers: [{ name: 'Oat milk' }], is_locked: false,
        }]}
      />,
    );
    expect(screen.getAllByText('Rp 50.000').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Rp 40.000')).not.toBeInTheDocument();
  });
});
