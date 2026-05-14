// apps/backoffice/src/pages/settings/SettingsHolidaysPage.tsx
//
// Session 13 / Phase 5.C — Holiday calendar CRUD. Recurring holidays surface
// in a "Recurring" section so admins know they need to re-seed next year's
// date when applicable.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useHolidaysList, type HolidayRow } from '@/features/settings/hooks/useHolidays.js';
import { HolidayFormModal }   from '@/features/settings/components/HolidayFormModal.js';
import { HolidayDeleteConfirm } from '@/features/settings/components/HolidayDeleteConfirm.js';

function typeLabel(t: string): string {
  switch (t) {
    case 'national':  return 'National';
    case 'religious': return 'Religious';
    case 'company':   return 'Company';
    default: return t;
  }
}

function typeBadgeClass(t: string): string {
  switch (t) {
    case 'national':  return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'religious': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'company':   return 'bg-gold-soft text-gold border-gold/30';
    default: return 'bg-bg-overlay text-text-secondary border-border-subtle';
  }
}

export default function SettingsHolidaysPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canManage = hasPermission('settings.holidays.manage');

  const list = useHolidaysList();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<HolidayRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<HolidayRow | undefined>(undefined);

  const groups = useMemo(() => {
    const rows = list.data ?? [];
    const recurring = rows.filter((r) => r.is_recurring);
    const fixed     = rows.filter((r) => !r.is_recurring);
    return { recurring, fixed };
  }, [list.data]);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  function row(r: HolidayRow) {
    return (
      <tr key={r.id} className="border-t border-border-subtle">
        <td className="px-4 py-2 text-sm font-medium">{r.date}</td>
        <td className="px-4 py-2 text-sm">{r.name}</td>
        <td className="px-4 py-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${typeBadgeClass(r.type)}`}>
            {typeLabel(r.type)}
          </span>
        </td>
        <td className="px-4 py-2 text-sm text-text-secondary">{r.is_recurring ? 'Yes' : 'No'}</td>
        <td className="px-4 py-2 text-sm text-text-secondary">{r.notes ?? ''}</td>
        <td className="px-4 py-2 text-right">
          {canManage && (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
              <Button type="button" size="sm" variant="ghostDestructive" onClick={() => setDeleting(r)}>Delete</Button>
            </>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Holidays</h1>
          <p className="text-text-secondary text-sm mt-1">
            National, religious, and company-level non-working days. Recurring holidays are listed separately —
            verify the date for next year before rolling over.
          </p>
        </div>
        {canManage && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New holiday
          </Button>
        )}
      </div>

      {list.isLoading && <div className="text-text-secondary">Loading…</div>}
      {list.error && <div className="text-red">Failed to load: {list.error.message}</div>}

      {!list.isLoading && !list.error && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-text-secondary">
              Recurring ({groups.recurring.length})
            </h2>
            <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="text-left px-4 py-3 w-32">Date</th>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3 w-28">Type</th>
                    <th className="text-left px-4 py-3 w-28">Recurring</th>
                    <th className="text-left px-4 py-3">Notes</th>
                    <th className="text-right px-4 py-3 w-44">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.recurring.length === 0
                    ? <tr><td colSpan={6} className="px-4 py-6 text-text-secondary">No recurring holidays.</td></tr>
                    : groups.recurring.map(row)}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-text-secondary">
              Fixed-date ({groups.fixed.length})
            </h2>
            <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="text-left px-4 py-3 w-32">Date</th>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3 w-28">Type</th>
                    <th className="text-left px-4 py-3 w-28">Recurring</th>
                    <th className="text-left px-4 py-3">Notes</th>
                    <th className="text-right px-4 py-3 w-44">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.fixed.length === 0
                    ? <tr><td colSpan={6} className="px-4 py-6 text-text-secondary">No fixed-date holidays.</td></tr>
                    : groups.fixed.map(row)}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <HolidayFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <HolidayFormModal open={editing !== undefined} mode="edit"
        {...(editing !== undefined ? { initial: editing } : {})}
        onClose={() => setEditing(undefined)} />
      <HolidayDeleteConfirm open={deleting !== undefined}
        {...(deleting !== undefined ? { row: deleting } : {})}
        onClose={() => setDeleting(undefined)} />
    </div>
  );
}
