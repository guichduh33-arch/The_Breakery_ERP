// apps/backoffice/src/features/inventory-production/components/ProductionRecordList.tsx
//
// Recent production batches. Compact table — a non-reverted row exposes the
// counter-entry action.
//
// ⚠️ CE COMPOSANT N'A AUCUN IMPORTEUR dans `apps/backoffice/src` (relevé du
// 2026-08-21). L'écran de production monte `ProductionTodayPanel` à sa place.
// Il n'est PAS supprimé ici — supprimer un fichier est une décision qui revient
// au propriétaire. En attendant, il partage l'affordance d'annulation avec
// l'écran vivant (`RevertProductionAction`) plutôt que d'en tenir une copie :
// le jour où il retrouve un appelant, il n'y en aura toujours qu'une.

import { type JSX } from 'react';
import { useProductionRecords } from '../hooks/useProductionRecords.js';
import { RevertProductionAction } from './RevertProductionAction.js';
import { formatDateTimeShortWita, formatQuantity } from '@breakery/utils';

export default function ProductionRecordList(): JSX.Element {
  const { data, isLoading, isError } = useProductionRecords();

  if (isLoading) return <div className="text-text-secondary text-sm">Loading…</div>;
  if (isError) return <div className="text-red text-sm">Error loading production records.</div>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <div className="text-text-muted text-sm">No production records yet.</div>;
  }

  return (
    <div className="border border-border-subtle rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Number, product, quantity, waste, date and status per production record</caption>
          <thead className="bg-surface-inert text-xs uppercase tracking-widest text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Number</th>
              <th scope="col" className="px-3 py-2 text-left">Product</th>
              <th scope="col" className="px-3 py-2 text-right">Qty</th>
              <th scope="col" className="px-3 py-2 text-right">Waste</th>
              <th scope="col" className="px-3 py-2 text-left">Date</th>
              <th scope="col" className="px-3 py-2 text-left">Status</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // Une contre-passation est un FAIT du registre : elle garde son
              // contraste, son état se dit par la colonne Status.
              <tr key={r.id} className="border-t border-border-subtle">
                <td className="px-3 py-2 font-mono">{r.production_number}</td>
                <td className="px-3 py-2">{r.product_name ?? r.product_id.slice(0, 8)}</td>
                {/* Pas d'unité dans `production_records` : sans suffixe. */}
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQuantity(r.quantity_produced, null)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQuantity(r.quantity_waste, null)}</td>
                <td className="px-3 py-2">{formatDateTimeShortWita(r.production_date)}</td>
                <td className="px-3 py-2">
                  {r.reverted_at !== null
                    ? <span className="text-warning">Reverted</span>
                    : r.je_posted
                      ? <span className="text-success">Posted</span>
                      : <span className="text-text-muted">Pending</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.reverted_at === null && (
                    <RevertProductionAction
                      productionId={r.id}
                      productionNumber={r.production_number}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </div>
  );
}
