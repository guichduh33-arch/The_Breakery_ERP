// Une requête d'historique tombée n'est pas un historique vide (audit Sales
// 2026-11-21) : les onglets Loyalty et Store credit montrent l'erreur et un
// « Try again », jamais « No … activity yet ».
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LoyaltyTab } from '../customer-detail/LoyaltyTab.js';
import { StoreCreditTab } from '../customer-detail/StoreCreditTab.js';

const { failed, refetch } = vi.hoisted(() => {
  const refetch = vi.fn();
  return { refetch, failed: () => ({ data: undefined, isLoading: false, isError: true, error: new Error('boom'), refetch }) };
});
vi.mock('@/features/loyalty/hooks/useCustomerLoyaltyHistory.js', () => ({ useCustomerLoyaltyHistory: failed }));
vi.mock('@/features/customers/hooks/useStoreCreditHistory.js', () => ({ useStoreCreditHistory: failed }));

describe('customer history tabs on a failed query', () => {
  it('Loyalty shows the error, not an empty history', () => {
    render(<LoyaltyTab customerId="c-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Loyalty history could not be loaded');
    expect(screen.queryByText('No loyalty activity yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('Store credit shows the error, not an empty ledger', () => {
    render(<StoreCreditTab customerId="c-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Store-credit history could not be loaded');
    expect(screen.queryByText('No store-credit activity yet.')).not.toBeInTheDocument();
  });
});
