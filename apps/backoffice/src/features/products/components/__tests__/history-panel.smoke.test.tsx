// apps/backoffice/src/features/products/components/__tests__/history-panel.smoke.test.tsx
//
// Product detail "History" tab smoke. Mocks useProductAuditLog so the
// component renders without touching @/lib/supabase.
//
// Coverage:
//   1. Empty state when there is no change-log (or the caller is not an admin).
//   2. Renders a row per audit entry with action + metadata summary.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProductAuditEntry } from '../../hooks/useProductAuditLog.js';
import { HistoryPanel } from '../HistoryPanel.js';

const mockUse = vi.fn();
vi.mock('@/features/products/hooks/useProductAuditLog.js', () => ({
  useProductAuditLog: (...args: unknown[]) => mockUse(...args),
  PRODUCT_AUDIT_LOG_QUERY_KEY: ['product-audit-log'],
}));

const ROWS: ProductAuditEntry[] = [
  {
    id: 2, action: 'product.updated', actor_id: 'abcdef12-3456-7890-abcd-ef1234567890',
    metadata: { field: 'retail_price', from: 90, to: 91 }, created_at: '2026-06-12T10:00:00Z',
  },
  {
    id: 1, action: 'product.deleted', actor_id: null,
    metadata: null, created_at: '2026-06-01T08:00:00Z',
  },
];

describe('HistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there is no history', () => {
    mockUse.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<HistoryPanel productId="prod-1" />);
    expect(screen.getByText(/no change history/i)).toBeInTheDocument();
  });

  it('renders a row per audit entry with action and metadata summary', () => {
    mockUse.mockReturnValue({ data: ROWS, isLoading: false, error: null });
    render(<HistoryPanel productId="prod-1" />);
    expect(screen.getByText('product.updated')).toBeInTheDocument();
    expect(screen.getByText('product.deleted')).toBeInTheDocument();
    // Metadata summary renders the key:value pairs.
    expect(screen.getByText(/field: retail_price/)).toBeInTheDocument();
    expect(screen.getByText(/to: 91/)).toBeInTheDocument();
  });
});
