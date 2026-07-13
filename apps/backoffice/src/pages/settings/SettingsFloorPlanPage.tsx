// apps/backoffice/src/pages/settings/SettingsFloorPlanPage.tsx
// S75 Task 3 — Floor Plan settings: tables + room sections CRUD.
//
// Tables are grouped under their active section (ordered by sort_order).
// Tables with `section_id === null` (or pointing at a section that's no
// longer active) fall under a catch-all "Interior" group — merged into a
// real "Interior" section if one exists, else rendered as a synthetic group.
import { useMemo, useState, type JSX } from 'react';
import { Plus, Pencil, Ban, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import type { RestaurantTable, TableSection } from '@breakery/domain';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useFloorPlanTables, useTableSections,
  useUpdateTable, useUpdateSection,
  useDeleteTable, useDeleteSection,
  mapFloorPlanError,
} from '@/features/floor-plan/hooks/useFloorPlanAdmin.js';
import { TableFormDialog } from '@/features/floor-plan/components/TableFormDialog.js';
import { SectionFormDialog } from '@/features/floor-plan/components/SectionFormDialog.js';

const INTERIOR_FALLBACK_KEY = '__interior_fallback__';
const INTERIOR_LABEL = 'Interior';

interface TableGroup {
  key:        string;
  label:      string;
  sortOrder:  number;
  section?:   TableSection;
  tables:     RestaurantTable[];
}

function buildGroups(tables: RestaurantTable[], sections: TableSection[]): TableGroup[] {
  // Include inactive sections too — they render with an Inactive badge + a
  // Reactivate button (post-_162 they're no longer hidden by RLS, and a
  // deactivated section must stay reachable to be flipped back on).
  const allSections = sections
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const groups = new Map<string, TableGroup>();
  for (const s of allSections) {
    groups.set(s.id, { key: s.id, label: s.name, sortOrder: s.sort_order, section: s, tables: [] });
  }

  const interiorSection = allSections.find((s) => s.is_active && s.name.trim().toLowerCase() === INTERIOR_LABEL.toLowerCase());

  function fallbackGroup(): TableGroup {
    if (interiorSection) return groups.get(interiorSection.id)!;
    if (!groups.has(INTERIOR_FALLBACK_KEY)) {
      groups.set(INTERIOR_FALLBACK_KEY, { key: INTERIOR_FALLBACK_KEY, label: INTERIOR_LABEL, sortOrder: -1, tables: [] });
    }
    return groups.get(INTERIOR_FALLBACK_KEY)!;
  }

  for (const t of tables) {
    if (t.section_id !== null && groups.has(t.section_id)) {
      groups.get(t.section_id)!.tables.push(t);
    } else {
      // section_id NULL, or points at an inactive/missing section — don't drop the row.
      fallbackGroup().tables.push(t);
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.section !== undefined || g.tables.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export default function SettingsFloorPlanPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission('tables.update');
  const canDelete = hasPermission('tables.delete');

  const { data: tables, isLoading: tablesLoading, error: tablesError } = useFloorPlanTables();
  const { data: sections, isLoading: sectionsLoading, error: sectionsError } = useTableSections();

  const updateTable = useUpdateTable();
  const updateSection = useUpdateSection();
  const deleteTable = useDeleteTable();
  const deleteSection = useDeleteSection();
  const [rowError, setRowError] = useState<string | null>(null);

  const [tableDialog, setTableDialog] = useState<{ mode: 'create' | 'edit'; table?: RestaurantTable | undefined } | null>(null);
  const [sectionDialog, setSectionDialog] = useState<{ mode: 'create' | 'edit'; section?: TableSection | undefined } | null>(null);

  const groups = useMemo(
    () => buildGroups(tables ?? [], sections ?? []),
    [tables, sections],
  );

  // Deactivate/Reactivate flip `is_active` via the UPDATE RPC WITHOUT touching
  // deleted_at (so the row stays visible + reversible, and the table_occupied /
  // section_in_use guards fire). Delete is the soft-DELETE RPC (deleted_at set →
  // row disappears from the BO), hence the distinct, more explicit label.
  function handleSetTableActive(table: RestaurantTable, isActive: boolean) {
    setRowError(null);
    updateTable.mutate(
      {
        id: table.id,
        name: table.name,
        seats: table.seats,
        section_id: table.section_id,
        sort_order: table.sort_order,
        is_active: isActive,
      },
      { onError: (e) => setRowError(mapFloorPlanError(e.message)) },
    );
  }

  function handleDeleteTable(table: RestaurantTable) {
    setRowError(null);
    const confirmed = window.confirm(`Delete table "${table.name}"? This removes it from the back office.`);
    if (!confirmed) return;
    deleteTable.mutate(table.id, {
      onError: (e) => setRowError(mapFloorPlanError(e.message)),
    });
  }

  function handleSetSectionActive(section: TableSection, isActive: boolean) {
    setRowError(null);
    updateSection.mutate(
      { id: section.id, name: section.name, sort_order: section.sort_order, is_active: isActive },
      { onError: (e) => setRowError(mapFloorPlanError(e.message)) },
    );
  }

  function handleDeleteSection(section: TableSection) {
    setRowError(null);
    const confirmed = window.confirm(`Delete section "${section.name}"? This removes it from the back office.`);
    if (!confirmed) return;
    deleteSection.mutate(section.id, {
      onError: (e) => setRowError(mapFloorPlanError(e.message)),
    });
  }

  const isLoading = tablesLoading || sectionsLoading;
  const loadError = tablesError ?? sectionsError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Floor Plan"
        subtitle="Tables and room sections used by the POS floor plan."
        actions={
          <>
            <Button variant="secondary" onClick={() => setSectionDialog({ mode: 'create' })} disabled={!canUpdate}>
              <Plus className="h-4 w-4" aria-hidden />
              Add section
            </Button>
            <Button variant="primary" onClick={() => setTableDialog({ mode: 'create' })} disabled={!canUpdate}>
              <Plus className="h-4 w-4" aria-hidden />
              Add table
            </Button>
          </>
        }
      />

      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {loadError !== null && loadError !== undefined && (
        <div className="text-red">Failed to load: {loadError.message}</div>
      )}
      {rowError !== null && (
        <div className="text-xs text-danger bg-danger-soft px-3 py-2 rounded" role="alert">{rowError}</div>
      )}

      {!isLoading && loadError == null && (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{group.label}</CardTitle>
                  {group.section && !group.section.is_active && <Badge variant="neutral">Inactive</Badge>}
                </div>
                {group.section && (canUpdate || canDelete) && (
                  <div className="flex items-center gap-1">
                    {canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSectionDialog({ mode: 'edit', section: group.section })}
                        aria-label={`Edit section ${group.label}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                    {canUpdate && (group.section.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetSectionActive(group.section!, false)}
                        aria-label={`Deactivate section ${group.label}`}
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetSectionActive(group.section!, true)}
                        aria-label={`Reactivate section ${group.label}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ))}
                    {canDelete && (
                      <Button
                        variant="ghostDestructive"
                        size="sm"
                        onClick={() => handleDeleteSection(group.section!)}
                        aria-label={`Delete section ${group.label}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {group.tables.length === 0 ? (
                  <p className="text-sm text-text-secondary">No tables in this section yet.</p>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {group.tables
                      .slice()
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">{t.name}</span>
                            <span className="text-xs text-text-secondary">{t.seats} seats</span>
                            {!t.is_active && <Badge variant="neutral">Inactive</Badge>}
                          </div>
                          {(canUpdate || canDelete) && (
                            <div className="flex items-center gap-1">
                              {canUpdate && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setTableDialog({ mode: 'edit', table: t })}
                                  aria-label={`Edit table ${t.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              )}
                              {canUpdate && (t.is_active ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSetTableActive(t, false)}
                                  aria-label={`Deactivate table ${t.name}`}
                                >
                                  <Ban className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSetTableActive(t, true)}
                                  aria-label={`Reactivate table ${t.name}`}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              ))}
                              {canDelete && (
                                <Button
                                  variant="ghostDestructive"
                                  size="sm"
                                  onClick={() => handleDeleteTable(t)}
                                  aria-label={`Delete table ${t.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tableDialog && (
        <TableFormDialog
          mode={tableDialog.mode}
          table={tableDialog.table}
          sections={sections ?? []}
          onClose={() => setTableDialog(null)}
        />
      )}
      {sectionDialog && (
        <SectionFormDialog
          mode={sectionDialog.mode}
          section={sectionDialog.section}
          onClose={() => setSectionDialog(null)}
        />
      )}
    </div>
  );
}
