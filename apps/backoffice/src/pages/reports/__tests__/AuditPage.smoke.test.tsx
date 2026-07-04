// apps/backoffice/src/pages/reports/__tests__/AuditPage.smoke.test.tsx
//
// Session 59 / Task 6c — filters + expandable before/after (metadata) on the
// Audit Log page. Proves:
//   1. Actor/action/entity filters are wired onto useAuditLogs' params.
//   2. Clicking a row expands its metadata detail (JSON rendered).
//   3. `audit_logs.payload` is NOT selected by get_audit_logs_v1/_v2 today
//      (verified against the RPC definitions) — only `metadata` is shown.
//      This is the documented, in-scope deviation (brief allows "payload
//      et/ou metadata"); adding `payload` to the RPC would need a migration,
//      out of scope for this BO-pure task.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditPage from '@/pages/reports/AuditPage.js';

const ROWS = [
  {
    id: 2, actor_id: 'u-1', action: 'expense.approve', entity_type: 'expense',
    entity_id: 'e-1', metadata: { before: { status: 'submitted' }, after: { status: 'approved' } },
    created_at: '2026-07-04T10:00:00Z',
  },
  {
    id: 1, actor_id: 'u-2', action: 'product.update', entity_type: 'product',
    entity_id: 'p-1', metadata: { field: 'price', before: 10000, after: 12000 },
    created_at: '2026-07-03T09:00:00Z',
  },
];

const mockUseAuditLogs = vi.fn();
vi.mock('@/features/reports/hooks/useAuditLogs.js', () => ({
  useAuditLogs: (filters: unknown) => mockUseAuditLogs(filters),
}));

vi.mock('@/features/auth/hooks/useLoginUsers.js', () => ({
  useLoginUsers: () => ({
    data: [
      { id: 'u-1', display_name: 'Made', role: 'MANAGER' },
      { id: 'u-2', display_name: 'Wayan', role: 'CASHIER' },
    ],
  }),
}));

vi.mock('@/features/reports/components/ExportButtons.js', () => ({
  ExportButtons: () => <div data-testid="export-buttons" />,
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe('AuditPage — filters + before/after (S59 Task 6c)', () => {
  beforeEach(() => {
    mockUseAuditLogs.mockReset();
    mockUseAuditLogs.mockReturnValue({
      data: { pages: [ROWS] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

  it('renders the two audit rows', () => {
    renderPage();
    expect(screen.getByTestId('audit-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-2')).toBeInTheDocument();
  });

  it('passes actor/action/entity filters through to useAuditLogs once set (empty filters omit keys)', () => {
    renderPage();
    expect(mockUseAuditLogs).toHaveBeenCalledWith({});

    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
    expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1' });

    fireEvent.change(screen.getByTestId('audit-filter-action'), { target: { value: 'expense.approve' } });
    expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1', action: 'expense.approve' });

    fireEvent.change(screen.getByTestId('audit-filter-entity'), { target: { value: 'expense' } });
    expect(mockUseAuditLogs).toHaveBeenLastCalledWith({
      actorId: 'u-1', action: 'expense.approve', entityType: 'expense',
    });
  });

  it('"Clear filters" resets back to no filters', () => {
    renderPage();
    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    expect(mockUseAuditLogs).toHaveBeenLastCalledWith({});
  });

  it('clicking a row expands its metadata (before/after) detail; clicking again collapses it', async () => {
    renderPage();
    expect(screen.queryByTestId('audit-detail-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('audit-row-2'));
    await waitFor(() => {
      const detail = screen.getByTestId('audit-detail-2');
      expect(detail.textContent).toContain('submitted');
      expect(detail.textContent).toContain('approved');
    });

    fireEvent.click(screen.getByTestId('audit-row-2'));
    expect(screen.queryByTestId('audit-detail-2')).not.toBeInTheDocument();
  });
});
