// apps/backoffice/src/pages/settings/SettingsHistoryPage.tsx
//
// Settings History (ADR-006 décision 9) — dedicated, human-readable view of
// every setting change: business_config settings (`setting.update`) and B2B
// settings (`b2b_settings.updated`), merged newest-first with an explicit
// old → new rendering per changed field.
//
// The route is admin-gated (AdminGate in routes/index.tsx) AND the underlying
// `audit_logs` table is admin_read RLS-gated — the gate hides the surface,
// the RLS is the real guard. Category/key filters are client-side: the whole
// history is a few dozen rows, no server round-trip needed.

import { useMemo, useState, type JSX } from 'react';
import { History } from 'lucide-react';
import { Badge, Button, Card, EmptyState, SectionLabel } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { useLoginUsers } from '@/features/auth/hooks/useLoginUsers.js';
import {
  useSettingsHistory,
  type SettingsHistoryEntry,
} from '@/features/settings/hooks/useSettingsHistory.js';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v) ?? '—';
  } catch {
    return '[unserializable]';
  }
}

export default function SettingsHistoryPage(): JSX.Element {
  const {
    entries, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useSettingsHistory();
  const users = useLoginUsers();

  const [category, setCategory] = useState('');
  const [keySearch, setKeySearch] = useState('');

  const actorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users.data ?? []) map.set(u.id, u.display_name);
    return map;
  }, [users.data]);

  const categories = useMemo(
    () => [...new Set(entries.map((e) => e.category))].sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const needle = keySearch.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== '' && e.category !== category) return false;
      if (needle !== '' && !e.changes.some((c) => c.field.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [entries, category, keySearch]);

  const hasFilters = category !== '' || keySearch !== '';

  function renderActor(entry: SettingsHistoryEntry): string {
    if (entry.actorId === null) return '—';
    return actorNames.get(entry.actorId) ?? entry.actorId.slice(0, 8);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings History"
        subtitle="Audit trail of every setting change — business settings and B2B settings, newest first."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-40"
            data-testid="settings-history-filter-category"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Setting key
          <input
            type="text"
            value={keySearch}
            onChange={(e) => setKeySearch(e.target.value)}
            placeholder="e.g. tax_rate"
            className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            data-testid="settings-history-filter-key"
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => { setCategory(''); setKeySearch(''); }}
            className="h-9 rounded-md px-3 text-xs text-text-secondary hover:text-text-primary"
            data-testid="settings-history-filter-clear"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading history…</p>}
      {error !== null && (
        <p className="text-sm text-danger" role="alert">
          {error.message !== '' ? error.message : 'Failed to load settings history.'}
        </p>
      )}

      {!isLoading && error === null && entries.length === 0 && (
        <EmptyState
          icon={History}
          title="No setting changes recorded"
          description="Every change made through the Settings pages appears here. Only admins can view the audit trail."
          size="lg"
        />
      )}

      {!isLoading && entries.length > 0 && (
        <>
          {visible.length === 0 ? (
            <p className="text-sm text-text-secondary" data-testid="settings-history-no-match">
              No changes match the current filters.
            </p>
          ) : (
            <Card variant="default" padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border-subtle bg-bg-base/40">
                    <tr>
                      <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">When</SectionLabel></th>
                      <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Setting</SectionLabel></th>
                      <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Change</SectionLabel></th>
                      <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">By</SectionLabel></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => (
                      <tr key={entry.id} className="border-t border-border-subtle align-top" data-testid={`settings-history-row-${entry.id}`}>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                          {fmtDateTime(entry.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {entry.changes.length === 0 ? (
                              <span className="font-mono text-xs">—</span>
                            ) : entry.changes.map((c) => (
                              <span key={c.field} className="font-mono text-xs">{c.field}</span>
                            ))}
                            <Badge variant="outline">{entry.category}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {entry.changes.length === 0 ? (
                            '—'
                          ) : (
                            <div className="flex flex-col gap-1">
                              {entry.changes.map((c) => (
                                <span key={c.field} className="break-all">
                                  {fmtValue(c.oldValue)}
                                  <span className="mx-1 text-text-primary">→</span>
                                  {fmtValue(c.newValue)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-text-secondary">
                          {renderActor(entry)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {hasNextPage && (
            <div className="flex justify-center pt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => { fetchNextPage(); }}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
