// apps/backoffice/src/pages/Loyalty.tsx
//
// BO loyalty management page. List + filters + modals for create/edit/
// delete/adjust + history drawer.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { CustomerDeleteConfirm } from '@/features/loyalty/components/CustomerDeleteConfirm.js';
import { LoyaltyHistoryDrawer } from '@/features/loyalty/components/LoyaltyHistoryDrawer.js';
import { LoyaltyAdjustModal } from '@/features/loyalty/components/LoyaltyAdjustModal.js';
import { CustomerListRow } from '@/features/loyalty/components/CustomerListRow.js';
import {
  useLoyaltyCustomersList,
  type CustomerListRow as Row,
  type LoyaltyCustomersFilters,
  type TierFilter,
} from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';

export default function LoyaltyPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('loyalty.read');
  const canAdjust = hasPermission('loyalty.adjust');
  const canCreate = hasPermission('customers.create');
  const canUpdate = hasPermission('customers.update');
  const canDelete = hasPermission('customers.delete');

  const [search, setSearch] = useState<string>('');
  const [tier,   setTier  ] = useState<TierFilter>('all');

  const filters = useMemo<LoyaltyCustomersFilters>(
    () => ({ ...(search !== '' ? { search } : {}), tier }),
    [search, tier],
  );

  const list = useLoyaltyCustomersList(filters);

  const [creating,  setCreating ] = useState(false);
  const [editing,   setEditing  ] = useState<Row | undefined>(undefined);
  const [viewing,   setViewing  ] = useState<Row | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Row | undefined>(undefined);
  const [deleting,  setDeleting ] = useState<Row | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view loyalty.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Loyalty</h1>
          <p className="text-text-secondary text-sm mt-1">Retail customers, balances, and ledger.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New customer
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="loy-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input
            id="loy-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or phone prefix"
            maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="loy-tier" className="text-xs uppercase tracking-widest text-text-secondary">Tier</label>
          <select
            id="loy-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value as TierFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="all">All tiers</option>
            <option value="bronze">Bronze</option>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {list.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
      {list.error && <div className="text-red py-12 text-center">{list.error.message}</div>}
      {list.data?.length === 0 && (
        <div className="text-text-secondary py-12 text-center">No customers match.</div>
      )}
      {list.data && list.data.length > 0 && (
        <table className="w-full text-sm bg-bg-elevated border border-border-subtle rounded-lg overflow-hidden">
          <thead className="text-xs uppercase tracking-widest text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-left">Balance</th>
              <th className="px-3 py-2 text-left">Lifetime</th>
              <th className="px-3 py-2 text-left">Last visit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((row) => (
              <CustomerListRow
                key={row.id}
                row={row}
                canAdjust={canAdjust}
                canEdit={canUpdate}
                canDelete={canDelete}
                onView={setViewing}
                onAdjust={setAdjusting}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ))}
          </tbody>
        </table>
      )}

      {/* Modals */}
      <CustomerFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <CustomerFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <LoyaltyHistoryDrawer customer={viewing} onClose={() => setViewing(undefined)} />
      <LoyaltyAdjustModal customer={adjusting} onClose={() => setAdjusting(undefined)} />
      <CustomerDeleteConfirm customer={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
