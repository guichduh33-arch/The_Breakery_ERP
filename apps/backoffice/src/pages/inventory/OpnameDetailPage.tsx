// apps/backoffice/src/pages/inventory/OpnameDetailPage.tsx
// Session 13 / Phase 2.D — opname workflow page.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, X } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useOpnameDetail } from '@/features/inventory-opname/hooks/useOpnameDetail.js';
import { useValidateOpname } from '@/features/inventory-opname/hooks/useOpnameMutations.js';
import { OpnameStatusBadge } from '@/features/inventory-opname/components/OpnameStatusBadge.js';
import { CountItemRow } from '@/features/inventory-opname/components/CountItemRow.js';
import { AddItemForm } from '@/features/inventory-opname/components/AddItemForm.js';
import { FinalizeOpnameDialog } from '@/features/inventory-opname/components/FinalizeOpnameDialog.js';
import { CancelOpnameDialog } from '@/features/inventory-opname/components/CancelOpnameDialog.js';

export default function OpnameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useOpnameDetail(id ?? null);
  const validate = useValidateOpname();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canFinalize = hasPermission('inventory.opname.finalize');
  const canCreate   = hasPermission('inventory.opname.create');

  const [showFinalize, setShowFinalize] = useState<boolean>(false);
  const [showCancel,   setShowCancel  ] = useState<boolean>(false);
  const [validateErr,  setValidateErr ] = useState<string | null>(null);

  if (detail.isLoading) {
    return <div className="text-sm text-text-secondary">Loading count…</div>;
  }
  if (detail.error !== null) {
    return <div className="text-sm text-rose-600">Failed to load count: {String(detail.error)}</div>;
  }
  if (detail.data === null || detail.data === undefined) {
    return <div className="text-sm text-text-secondary">Count not found.</div>;
  }

  const d = detail.data;
  const readOnly = d.status === 'finalized' || d.status === 'cancelled';
  const totalVariance = d.items.reduce(
    (s, i) => s + Math.abs(i.variance ?? 0), 0,
  );
  const missingCounts = d.items.filter((i) => i.counted_qty === null).length;

  function handleValidate() {
    if (id === undefined) return;
    setValidateErr(null);
    validate.mutate(
      { countId: id },
      { onError: (e) => { setValidateErr(e.message); } },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/backoffice/inventory/opname" className="text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <h1 className="text-2xl font-serif text-text-primary">{d.count_number}</h1>
        <OpnameStatusBadge status={d.status} />
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="border border-border-subtle rounded p-3">
          <div className="text-xs uppercase text-text-secondary">Section</div>
          <div className="font-medium">{d.section?.name ?? '—'}</div>
        </div>
        <div className="border border-border-subtle rounded p-3">
          <div className="text-xs uppercase text-text-secondary">Items</div>
          <div className="font-medium">{d.items.length} ({missingCounts} pending)</div>
        </div>
        <div className="border border-border-subtle rounded p-3">
          <div className="text-xs uppercase text-text-secondary">Total |variance|</div>
          <div className="font-mono font-medium">{totalVariance}</div>
        </div>
      </div>

      {!readOnly && canCreate && (
        <AddItemForm countId={d.id} />
      )}

      {d.items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="text-left py-2 px-3">Product</th>
              <th className="text-right py-2 px-3">Expected</th>
              <th className="text-left py-2 px-3">Counted</th>
              <th className="text-right py-2 px-3">Variance</th>
              <th className="text-left py-2 px-3">Notes</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <CountItemRow key={it.id} countId={d.id} item={it} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-end gap-2">
        {(d.status === 'draft' || d.status === 'counting') && canCreate && (
          <Button variant="ghost" onClick={handleValidate} disabled={validate.isPending || missingCounts > 0}>
            <CheckCircle2 className="h-4 w-4 mr-1.5" aria-hidden />
            {validate.isPending ? 'Validating…' : 'Validate (→ review)'}
          </Button>
        )}
        {(d.status === 'review' || d.status === 'counting') && canFinalize && (
          <Button onClick={() => { setShowFinalize(true); }} disabled={missingCounts > 0}>
            Finalize & post JE
          </Button>
        )}
        {!readOnly && canCreate && (
          <Button variant="ghost" onClick={() => { setShowCancel(true); }}>
            <X className="h-4 w-4 mr-1.5" aria-hidden /> Cancel
          </Button>
        )}
      </div>

      {validateErr !== null && (
        <div className="text-sm text-rose-600">{validateErr}</div>
      )}

      {d.status === 'cancelled' && d.cancel_reason !== null && (
        <div className="text-sm text-text-secondary border-l-4 border-rose-300 pl-3">
          <strong>Cancelled:</strong> {d.cancel_reason}
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
