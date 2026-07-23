// apps/backoffice/src/features/settings/__tests__/SettingsHistoryPage.smoke.test.tsx
//
// Settings History page (ADR-006 décision 9) — renders the merged audit feed
// with old → new per changed field, client-side category/key filters, actor
// name resolution via useLoginUsers, and the admin-only empty state.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import SettingsHistoryPage from '@/pages/settings/SettingsHistoryPage.js';
import type { SettingsHistoryEntry } from '@/features/settings/hooks/useSettingsHistory.js';

const mockFetchNextPage = vi.fn();

let mockEntries: SettingsHistoryEntry[] = [];
let mockIsLoading = false;
let mockHasNextPage = false;

vi.mock('@/features/settings/hooks/useSettingsHistory.js', () => ({
  useSettingsHistory: () => ({
    entries:            mockEntries,
    isLoading:          mockIsLoading,
    error:              null,
    hasNextPage:        mockHasNextPage,
    isFetchingNextPage: false,
    fetchNextPage:      mockFetchNextPage,
  }),
}));

vi.mock('@/features/auth/hooks/useLoginUsers.js', () => ({
  useLoginUsers: () => ({
    data: [{ id: 'actor-1', display_name: 'Mamat', role: 'SUPER_ADMIN' }],
  }),
}));

const SETTING_ENTRY: SettingsHistoryEntry = {
  id: 11,
  createdAt: '2026-07-22T10:00:00Z',
  actorId: 'actor-1',
  category: 'network',
  changes: [{ field: 'offline_cash_enabled', oldValue: true, newValue: false }],
};

const B2B_ENTRY: SettingsHistoryEntry = {
  id: 12,
  createdAt: '2026-07-21T09:00:00Z',
  actorId: 'actor-unknown',
  category: 'b2b',
  changes: [{ field: 'critical_overdue_days', oldValue: 30, newValue: 35 }],
};

describe('SettingsHistoryPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEntries = [SETTING_ENTRY, B2B_ENTRY];
    mockIsLoading = false;
    mockHasNextPage = false;
  });

  it('renders one row per entry with the key, category badge and old → new', () => {
    render(<SettingsHistoryPage />);
    const settingRow = screen.getByTestId('settings-history-row-11');
    expect(within(settingRow).getByText('offline_cash_enabled')).toBeInTheDocument();
    expect(within(settingRow).getByText('network')).toBeInTheDocument(); // category badge
    expect(settingRow).toHaveTextContent('true→false');
    expect(screen.getByTestId('settings-history-row-12')).toHaveTextContent('30→35');
  });

  it('resolves the actor name via useLoginUsers, falls back to the uuid prefix', () => {
    render(<SettingsHistoryPage />);
    expect(screen.getByText('Mamat')).toBeInTheDocument();
    expect(screen.getByText('actor-un')).toBeInTheDocument(); // slice(0, 8) fallback
  });

  it('filters by category client-side', () => {
    render(<SettingsHistoryPage />);
    fireEvent.change(screen.getByTestId('settings-history-filter-category'), { target: { value: 'b2b' } });
    expect(screen.queryByTestId('settings-history-row-11')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-history-row-12')).toBeInTheDocument();
  });

  it('filters by setting key client-side and shows the no-match state', () => {
    render(<SettingsHistoryPage />);
    fireEvent.change(screen.getByTestId('settings-history-filter-key'), { target: { value: 'offline' } });
    expect(screen.getByTestId('settings-history-row-11')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-history-row-12')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('settings-history-filter-key'), { target: { value: 'zzz-no-such-key' } });
    expect(screen.getByTestId('settings-history-no-match')).toBeInTheDocument();
  });

  it('shows the admin-only empty state when the feed is empty', () => {
    mockEntries = [];
    render(<SettingsHistoryPage />);
    expect(screen.getByText(/No setting changes recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/Only admins can view the audit trail/i)).toBeInTheDocument();
  });

  it('Load more appears only when a feed has a next page and forwards the call', () => {
    render(<SettingsHistoryPage />);
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();

    cleanup();
    mockHasNextPage = true;
    render(<SettingsHistoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Load more/i }));
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });
});
