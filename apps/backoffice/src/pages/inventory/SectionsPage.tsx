// apps/backoffice/src/pages/inventory/SectionsPage.tsx
// Session 13 / Phase 2.D — CRUD for sections (the physical zones backing inventory).

import { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useSectionsList,
  useSoftDeleteSection,
  type SectionRow,
} from '@/features/sections/hooks/useSectionsList.js';
import { SectionFormModal } from '@/features/sections/components/SectionFormModal.js';

export default function SectionsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('inventory.sections.update');

  const list = useSectionsList();
  const softDelete = useSoftDeleteSection();
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const [creating, setCreating] = useState<boolean>(false);

  function handleDelete(id: string) {
    // eslint-disable-next-line no-alert
    if (!confirm('Soft-delete this section? Existing references stay intact ; the section just stops appearing in pickers.')) return;
    softDelete.mutate({ id });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-text-primary">Sections</h1>
          <p className="text-sm text-text-secondary">
            Physical zones (warehouse, production kitchen, sales front) referenced
            by every section-aware stock movement.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => { setCreating(true); }}>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden /> New section
          </Button>
        )}
      </div>

      {list.isLoading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : list.error !== null ? (
        <div className="text-sm text-rose-600">Failed: {String(list.error)}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="text-left py-2 px-3">Code</th>
              <th className="text-left py-2 px-3">Name</th>
              <th className="text-left py-2 px-3">Kind</th>
              <th className="text-right py-2 px-3">Order</th>
              <th className="text-left py-2 px-3">Active</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border-subtle">
                <td className="py-2 px-3 font-mono text-xs">{s.code}</td>
                <td className="py-2 px-3">{s.name}</td>
                <td className="py-2 px-3 text-xs">{s.kind}</td>
                <td className="py-2 px-3 text-right font-mono">{s.display_order}</td>
                <td className="py-2 px-3">
                  {s.is_active ? (
                    <span className="text-xs text-emerald-600">Active</span>
                  ) : (
                    <span className="text-xs text-text-secondary">Inactive</span>
                  )}
                </td>
                {canWrite && (
                  <td className="py-2 px-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(s); }}>
                      <Edit2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { handleDelete(s.id); }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <SectionFormModal onClose={() => { setCreating(false); }} />
      )}
      {editing !== null && (
        <SectionFormModal initial={editing} onClose={() => { setEditing(null); }} />
      )}
    </div>
  );
}
