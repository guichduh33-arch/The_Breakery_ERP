// apps/backoffice/src/pages/inventory/OpnameDetailPage.tsx
// Session 14 / Phase 4.C — opname workflow page, rewritten against the
// `stock opname.jpg` screenshot family.
//
// Header (back link + count number + status) → KPI tile row (section, items
// counted vs pending, total |variance|) → optional add-item form → items
// DataTable → action footer (Validate / Finalize / Cancel + error banner).

import { useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Layers, Sigma, X } from 'lucide-react';
import { Button, EmptyState, KpiTile } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useOpnameDetail } from '@/features/inventory-opname/hooks/useOpnameDetail.js';
import { useValidateOpname } from '@/features/inventory-opname/hooks/useOpnameMutations.js';
import { OpnameStatusBadge } from '@/features/inventory-opname/components/OpnameStatusBadge.js';
import { CountItemRow } from '@/features/inventory-opname/components/CountItemRow.js';
import { AddItemForm } from '@/features/inventory-opname/components/AddItemForm.js';
import { FinalizeOpnameDialog } from '@/features/inventory-opname/components/FinalizeOpnameDialog.js';
import { CancelOpnameDialog } from '@/features/inventory-opname/components/CancelOpnameDialog.js';

export default function OpnameDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const detail = useOpnameDetail(id ?? null);
  const validate = useValidateOpname();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canFinalize = hasPermission('inventory.opname.finalize');
  const canCreate   = hasPermission('inventory.opname.create');

  const [showFinalize, setShowFinalize] = useState<boolean>(false);
  const [showCancel,   setShowCancel  ] = useState<boolean>(false);
  const [validateErr,  setValidateErr ] = useState<string | null>(null);

  // Compute even when data is undefined so hook order stays stable.
  const items     = detail.data?.items ?? [];
  const readOnly  = detail.data?.status === 'finalized' || detail.data?.status === 'cancelled';
  const stats     = useMemo(() => {
    let counted = 0;
    let pending = 0;
    let varianceTotal = 0;
    for (const i of items) {
      if (i.counted_qty === null) pending += 1;
      else counted += 1;
      varianceTotal += Math.abs(i.variance ?? 0);
    }
    return { counted, pending, varianceTotal };
  }, [items]);
  if (detail.isLoading) {
    return <div className="text-sm text-text-secondary">Loading count…</div>;
  }
  if (detail.error !== null) {
    return (
      <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
        Failed to load count: {String(detail.error)}
      </div>
    );
  }
  if (detail.data === null || detail.data === undefined) {
    return <div className="text-sm text-text-secondary">Count not found.</div>;
  }

  const d = detail.data;

  function handleValidate(): void {
    if (id === undefined) return;
    setValidateErr(null);
    validate.mutate(
      { countId: id },
      { onError: (e) => { setValidateErr(e.message); } },
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/backoffice/inventory/opname"
          className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors duration-fast hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Back to counts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display font-mono text-3xl text-text-primary">{d.count_number}</h1>
          <OpnameStatusBadge status={d.status} />
        </div>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Count progress"
      >
        <KpiTile
          label="Section"
          value={d.section?.name ?? '—'}
          icon={Layers}
          footer={d.section?.code ?? undefined}
        />
        <KpiTile
          label="Items counted"
          value={stats.counted}
          icon={CheckCircle2}
          footer={`${stats.pending} pending of ${items.length}`}
        />
        <KpiTile
          label="Total |variance|"
          value={Number(stats.varianceTotal.toFixed(3))}
          icon={Sigma}
          footer="Sum of absolute deltas"
        />
      </section>

      {!readOnly && canCreate && (
        <AddItemForm countId={d.id} />
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated">
          <EmptyState
            icon={ClipboardList}
            title="No items in this count"
            description={
              !readOnly && canCreate
                ? 'Add items above to begin recording counts.'
                : 'This count has no items recorded.'
            }
            size="md"
          />
        </div>
      ) : (
        <table className="w-full text-sm bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          <thead className="bg-bg-base/40 border-b border-border-subtle">
            <tr>
              <th className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Product</th>
              <th className="text-right py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Expected</th>
              <th className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Counted</th>
              <th className="text-right py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Variance</th>
              <th className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted">Notes</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <CountItemRow key={it.id} countId={d.id} item={it} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      )}

      <footer className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        {validateErr !== null && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:mr-auto">
            {validateErr}
          </div>
        )}
        {(d.status === 'draft' || d.status === 'counting') && canCreate && (
          <Button
            variant="ghost"
            onClick={handleValidate}
            disabled={validate.isPending || stats.pending > 0}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {validate.isPending ? 'Validating…' : 'Validate (→ review)'}
          </Button>
        )}
        {(d.status === 'review' || d.status === 'counting') && canFinalize && (
          <Button onClick={() => { setShowFinalize(true); }} disabled={stats.pending > 0}>
            Finalize and post JE
          </Button>
        )}
        {!readOnly && canCreate && (
          <Button variant="ghost" onClick={() => { setShowCancel(true); }}>
            <X className="h-4 w-4" aria-hidden /> Cancel
          </Button>
        )}
      </footer>

      {d.status === 'cancelled' && d.cancel_reason !== null && (
        <div className="border-l-4 border-danger/40 bg-bg-elevated px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Cancelled:</span> {d.cancel_reason}
        </div>
      )}

      {showFinalize && (
        <FinalizeOpnameDialog
          countId={d.id}
          items={d.items}
          onClose={() => { setShowFinalize(false); }}
        />
      )}
      {showCancel && (
        <CancelOpnameDialog
          countId={d.id}
          onClose={() => { setShowCancel(false); }}
        />
      )}
    </div>
  );
}
