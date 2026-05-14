// apps/backoffice/src/pages/accounting/MappingsPage.tsx
//
// Session 13 / Phase 6.C / module 10-012 — Accounting mappings admin.
// Table of all rows in `accounting_mappings`. ADMIN+ can edit each row;
// MANAGER+ can read. Audit log row written per change via the RPC
// `update_accounting_mapping_v1`.

import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { useMappings, type MappingRow } from '@/features/accounting-mappings/hooks/useMappings.js';
import { MappingEditDialog } from '@/features/accounting-mappings/components/MappingEditDialog.js';
import { Button } from '@breakery/ui';

export default function MappingsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('accounting.read');
  const canUpdate = hasPermission('accounting.mapping.update');

  const list = useMappings();

  const [editing, setEditing] = useState<MappingRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view accounting mappings.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Accounting Mappings</h1>
        <p className="text-text-secondary text-sm mt-1 max-w-2xl">
          Symbolic JE keys (e.g. <code>SALE_POS_REVENUE</code>) routed to chart-of-accounts codes.
          JE triggers resolve via these rows — never via hardcoded account codes.
          Edits are recorded in <code>audit_logs</code> and require a reason.
        </p>
      </div>

      {list.isLoading && <div className="text-text-secondary">Loading mappings…</div>}
      {list.error && (
        <div className="text-red">Failed to load mappings: {list.error.message}</div>
      )}

      {!list.isLoading && !list.error && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
                <th className="px-4 py-3">Mapping key</th>
                <th className="px-4 py-3">Account code</th>
                <th className="px-4 py-3">Account name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                {canUpdate && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.data?.map((row) => (
                <tr key={row.mapping_key} className="border-t border-border-subtle hover:bg-bg-overlay">
                  <td className="px-4 py-3 font-mono text-text-primary">{row.mapping_key}</td>
                  <td className="px-4 py-3 font-mono">{row.account_code}</td>
                  <td className="px-4 py-3">{row.account_name ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary text-xs max-w-md">
                    {row.description ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {row.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-soft text-green border border-green/30 text-xs">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-bg-overlay text-text-secondary border border-border-subtle text-xs">
                        Inactive
                      </span>
                    )}
                    {row.account_is_postable === false && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-soft text-amber-warn border border-amber-warn/30 text-xs">
                        Not postable!
                      </span>
                    )}
                  </td>
                  {canUpdate && (
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(row)}
                      >
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {list.data?.length === 0 && (
                <tr>
                  <td colSpan={canUpdate ? 6 : 5} className="px-4 py-8 text-center text-text-secondary">
                    No mappings configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <MappingEditDialog
        open={Boolean(editing)}
        initial={editing}
        onClose={() => setEditing(undefined)}
      />
    </div>
  );
}
