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
//   4. Review finding (fixed) — Action/Entity type are debounced 300ms
//      before reaching useAuditLogs, so typing doesn't re-fetch per
//      keystroke. Actor (a <select>) stays immediate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('actor (select) filter reaches useAuditLogs immediately, no debounce', () => {
    renderPage();
    expect(mockUseAuditLogs).toHaveBeenCalledWith({});

    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
    expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1' });
  });

  describe('debounced action/entity filters (review finding fix)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('debounces action/entity so useAuditLogs settles 300ms after the last keystroke', () => {
      renderPage();

      fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1' });

      fireEvent.change(screen.getByTestId('audit-filter-action'), { target: { value: 'expense.approve' } });
      // Not yet committed to useAuditLogs — still debouncing.
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1' });
      act(() => { vi.advanceTimersByTime(300); });
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1', action: 'expense.approve' });

      fireEvent.change(screen.getByTestId('audit-filter-entity'), { target: { value: 'expense' } });
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ actorId: 'u-1', action: 'expense.approve' });
      act(() => { vi.advanceTimersByTime(300); });
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({
        actorId: 'u-1', action: 'expense.approve', entityType: 'expense',
      });
    });

    it('typing character by character only triggers ONE fetch, after stabilization', () => {
      renderPage();
      const callsBefore = mockUseAuditLogs.mock.calls.length;
      const input = screen.getByTestId('audit-filter-action');

      // "exp" typed one character at a time, 100ms apart — well under the
      // 300ms debounce window between keystrokes.
      fireEvent.change(input, { target: { value: 'e' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'ex' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'exp' } });
      act(() => { vi.advanceTimersByTime(100); });

      // 300ms hasn't elapsed since the LAST keystroke yet — no commit.
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({});
      expect(mockUseAuditLogs.mock.calls.length).toBe(callsBefore); // no re-render/re-call yet

      act(() => { vi.advanceTimersByTime(200); }); // total 300ms since last keystroke
      expect(mockUseAuditLogs).toHaveBeenLastCalledWith({ action: 'exp' });
      // Exactly one additional call committed the debounced value (not one per keystroke).
      expect(mockUseAuditLogs.mock.calls.length).toBe(callsBefore + 1);
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
