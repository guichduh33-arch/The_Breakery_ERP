// apps/backoffice/src/features/btob/__tests__/b2b-order-activity-section.test.tsx
//
// Rendu de la section Activity : colonnes date-heure / action / utilisateur /
// détail, aveu explicite quand l'audit est hors permission, alerte sur échec.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { B2bOrderActivity } from '../components/B2bOrderActivity.js';

const state = vi.hoisted(() => ({
  canReadAudit: true,
  auditError: false,
}));

vi.mock('../hooks/useB2bOrderActivity.js', () => ({
  useB2bOrderActivity: () => ({
    canReadAudit: state.canReadAudit,
    audit: state.auditError
      ? { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
      : {
        data: state.canReadAudit ? [{
          id: 7, action: 'b2b.order.delivered', created_at: '2026-11-01T04:05:00Z',
          metadata: null, actor: { full_name: 'Agus' },
        }] : undefined,
        isLoading: false, isError: false, refetch: vi.fn(),
      },
    payments: {
      data: [{
        id: 'a1', amount_applied: 240000, created_at: '2026-11-05T03:00:00Z',
        payment: { payment_number: 'BP-2026-0030', method: 'cash', paid_at: '2026-11-05T03:00:00Z',
          created_at: '2026-11-05T03:00:00Z', creator: { full_name: 'Annisa' } },
      }],
      isLoading: false, isError: false, refetch: vi.fn(),
    },
  }),
}));

describe('B2bOrderActivity', () => {
  beforeEach(() => { state.canReadAudit = true; state.auditError = false; });

  it('lists date & time, action, user and details, most recent first', () => {
    render(<B2bOrderActivity orderId="o1" />);
    expect(screen.getByRole('columnheader', { name: /date & time/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /user/i })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Payment received');
    expect(rows[0]).toHaveTextContent('Annisa');
    expect(rows[0]).toHaveTextContent('BP-2026-0030 · Cash · Rp 240.000 applied');
    expect(rows[1]).toHaveTextContent('Collected');
    expect(rows[1]).toHaveTextContent('Agus');
  });

  it('says that order events need the audit permission when it is missing', () => {
    state.canReadAudit = false;
    render(<B2bOrderActivity orderId="o1" />);
    expect(screen.getByText(/only payments are listed/i)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('shows an alert with a retry when the order events fail to load', () => {
    state.auditError = true;
    render(<B2bOrderActivity orderId="o1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/order events could not be loaded/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
