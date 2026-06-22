// apps/backoffice/src/features/products/components/StationsPanel.tsx
//
// Assigns a product to one or more production stations (sections with
// kind='production'). This is the mapping the redesigned Production page filters
// on: each station tab shows only the products assigned to it (strict filter).
//
// Writes go through set_product_sections_v1 (REPLACE semantics). Gate:
// products.sections.update — without it the controls are disabled and no Save.

import { Factory, Star } from 'lucide-react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Card } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useProductSections } from '../hooks/useProductSections.js';
import { useSetProductSections } from '../hooks/useSetProductSections.js';
import type { ProductRow } from '../types.js';

interface Props {
  product: ProductRow;
}

export function StationsPanel({ product }: Props): JSX.Element {
  const canWrite = useAuthStore((s) => s.hasPermission('products.sections.update'));
  const sections = useSections();
  const { data, isLoading, error } = useProductSections(product.id);
  const setSections = useSetProductSections(product.id);

  const stations = useMemo(
    () => (sections.data ?? []).filter((s) => s.kind === 'production'),
    [sections.data],
  );

  // Draft state — selected section ids + which one is primary.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  // Re-sync the draft whenever the server data arrives/changes.
  useEffect(() => {
    if (data === undefined) return;
    setSelected(new Set(data.map((d) => d.section_id)));
    setPrimaryId(data.find((d) => d.is_primary)?.section_id ?? null);
  }, [data]);

  const isDirty = useMemo(() => {
    if (data === undefined) return false;
    const serverIds = new Set(data.map((d) => d.section_id));
    const serverPrimary = data.find((d) => d.is_primary)?.section_id ?? null;
    if (serverIds.size !== selected.size) return true;
    for (const id of selected) if (!serverIds.has(id)) return true;
    return serverPrimary !== primaryId;
  }, [data, selected, primaryId]);

  function toggle(sectionId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
        if (primaryId === sectionId) setPrimaryId(null);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  function handleSave(): void {
    if (!isDirty) return;
    const sectionIds = Array.from(selected);
    // Primary must belong to the selection; otherwise default to the first
    // selected station (or null when the selection is empty).
    const primary =
      primaryId !== null && selected.has(primaryId)
        ? primaryId
        : (sectionIds[0] ?? null);
    setSections.mutate(
      { sectionIds, primarySectionId: primary },
      {
        onSuccess: () => { toast.success('Production stations saved.'); },
        onError:   (err) => { toast.error(`Failed to save stations: ${err.message}`); },
      },
    );
  }

  if (isLoading || sections.isLoading) {
    return <div className="py-16 text-center text-sm text-text-secondary">Loading stations…</div>;
  }
  if (error !== null && error !== undefined) {
    return (
      <div role="alert" className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red">
        Failed to load stations: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-soft text-gold">
            <Factory className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="font-display text-lg text-text-primary">Production Stations</h2>
            <p className="text-xs italic text-text-secondary">
              The stations that produce this product. The Production page only lists a product
              under the stations selected here.
            </p>
          </div>
        </div>

        {stations.length === 0 ? (
          <p className="text-sm italic text-text-muted">No production sections defined.</p>
        ) : (
          <ul className="space-y-2" data-testid="stations-list">
            {stations.map((s) => {
              const checked = selected.has(s.id);
              const isPrimary = primaryId === s.id;
              return (
                <li
                  key={s.id}
                  data-testid={`station-row-${s.code}`}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-overlay px-4 py-3"
                >
                  <label className="flex flex-1 items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canWrite}
                      onChange={() => toggle(s.id)}
                      aria-label={`Assign to ${s.name}`}
                      className="h-4 w-4 accent-gold disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="text-sm text-text-primary">{s.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                      {s.code}
                    </span>
                  </label>

                  {/* Primary toggle — only meaningful for a checked station. */}
                  <button
                    type="button"
                    disabled={!canWrite || !checked}
                    onClick={() => setPrimaryId(s.id)}
                    aria-label={`Set ${s.name} as primary station`}
                    aria-pressed={isPrimary}
                    title={isPrimary ? 'Primary station' : 'Set as primary'}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                      (isPrimary
                        ? 'bg-gold-soft text-gold'
                        : 'text-text-muted hover:enabled:text-text-primary')
                    }
                  >
                    <Star className={'h-3.5 w-3.5 ' + (isPrimary ? 'fill-gold' : '')} aria-hidden />
                    Primary
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!isDirty || setSections.isPending}
            onClick={handleSave}
            data-testid="stations-save-btn"
            className="rounded-full bg-gold px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            {setSections.isPending ? 'Saving…' : 'Save Stations'}
          </button>
        </div>
      )}
    </div>
  );
}
