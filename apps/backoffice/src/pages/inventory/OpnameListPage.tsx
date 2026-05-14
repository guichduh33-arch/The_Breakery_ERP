// apps/backoffice/src/pages/inventory/OpnameListPage.tsx
// Session 13 / Phase 2.D — paginated list of opname (stock-count) sessions.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useOpnameList, type OpnameStatus } from '@/features/inventory-opname/hooks/useOpnameList.js';
import { OpnameStatusBadge } from '@/features/inventory-opname/components/OpnameStatusBadge.js';
import { CreateOpnameModal } from '@/features/inventory-opname/components/CreateOpnameModal.js';

const STATUS_OPTIONS: OpnameStatus[] = ['draft', 'counting', 'review', 'finalized', 'cancelled'];

export default function OpnameListPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('inventory.opname.create');

  const [statusFilter, setStatusFilter] = useState<OpnameStatus | ''>('');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const list = useOpnameList({
    ...(statusFilter !== '' ? { status: statusFilter } : {}),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-text-primary">Stock counts (Opname)</h1>
          <p className="text-sm text-text-secondary">
            Periodic counts compared against the section_stock cache. Finalizing
            emits adjustment movements + balanced journal entries.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden /> New count
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="opname-status-filter" className="text-sm text-text-secondary">
          Status :
        </label>
        <select
          id="opname-status-filter"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as OpnameStatus | ''); }}
          className="px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        >
          <option value="">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {list.isLoading ? (
        <div className="text-sm text-text-secondary">Loading counts…</div>
      ) : list.error !== null ? (
        <div className="text-sm text-rose-600">Failed to load counts: {String(list.error)}</div>
      ) : (list.data ?? []).length === 0 ? (
        <div className="text-sm text-text-secondary">No counts yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="text-left py-2 px-3">Count #</th>
              <th className="text-left py-2 px-3">Section</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Started</th>
              <th className="text-left py-2 px-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr key={row.id} className="border-b border-border-subtle hover:bg-bg-overlay">
                <td className="py-2 px-3">
                  <Link
                    to={`/backoffice/inventory/opname/${row.id}`}
                    className="font-mono text-gold hover:underline"
                  >
                    {row.count_number}
                  </Link>
                </td>
                <td className="py-2 px-3">{row.section?.name ?? '—'}</td>
                <td className="py-2 px-3"><OpnameStatusBadge status={row.status} /></td>
                <td className="py-2 px-3 text-text-secondary">
                  {new Date(row.started_at).toLocaleString()}
                </td>
                <td className="py-2 px-3 text-text-secondary truncate max-w-xs">
                  {row.notes ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createOpen && (
        <CreateOpnameModal
          onCreated={(id) => {
            setCreateOpen(false);
            navigate(`/backoffice/inventory/opname/${id}`);
          }}
          onClose={() => { setCreateOpen(false); }}
        />
      )}
    </div>
  );
}
