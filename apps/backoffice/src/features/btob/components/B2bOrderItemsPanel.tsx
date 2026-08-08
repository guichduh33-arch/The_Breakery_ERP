// apps/backoffice/src/features/btob/components/B2bOrderItemsPanel.tsx
//
// Le détail dépliable d'une commande B2B : ses lignes.
//
// Il vit sur le remplissage inerte, en retrait à gauche : ce bloc n'est pas une
// ligne de la liste, c'est l'intérieur de la ligne au-dessus. Sans ce décalage,
// une table dans une table se lit comme deux tables.
//
// Une ligne annulée reste affichée, barrée et à zéro. La faire disparaître
// donnerait une somme de lignes qui ne retombe pas sur le total de la commande,
// et laisserait croire qu'elle n'a jamais existé.

import type { JSX } from 'react';
import { formatIdr } from '@breakery/utils';
import { useB2bOrderItems } from '../hooks/useB2bOrderItems.js';

export interface B2bOrderItemsPanelProps {
  orderId: string;
  /** Total de la commande — sert de contrôle visible face à la somme des lignes. */
  orderTotal: number;
}

export function B2bOrderItemsPanel({ orderId, orderTotal }: B2bOrderItemsPanelProps): JSX.Element {
  const { data, isLoading, error } = useB2bOrderItems(orderId);

  if (isLoading) {
    return (
      <div className="space-y-1.5 px-6 py-3" data-testid="b2b-items-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 w-1/3 animate-pulse rounded bg-surface-4 motion-reduce:animate-none" />
        ))}
      </div>
    );
  }

  if (error !== null) {
    return (
      <p className="px-6 py-3 text-[12.5px] text-danger" role="alert">
        Could not load the order lines: {error.message}
      </p>
    );
  }

  const items = data ?? [];

  if (items.length === 0) {
    return (
      <p className="px-6 py-3 text-[12.5px] text-text-muted">
        This order has no line. It was most likely cancelled before anything was added.
      </p>
    );
  }

  const live = items.filter((i) => !i.is_cancelled);
  const linesTotal = live.reduce((sum, i) => sum + Number(i.line_total), 0);
  // Un écart entre la somme des lignes et le total de la commande est réel :
  // remise d'entête, arrondi, taxe. On le montre plutôt que de le taire.
  const drift = Math.round((Number(orderTotal) - linesTotal) * 100) / 100;

  return (
    <div className="px-6 py-3" data-testid="b2b-items-panel">
      <table className="w-full">
        <thead>
          <tr>
            <th className="pb-1.5 text-left font-data text-[10px] uppercase tracking-widest text-text-muted">Item</th>
            <th className="pb-1.5 text-right font-data text-[10px] uppercase tracking-widest text-text-muted">Qty</th>
            <th className="pb-1.5 text-right font-data text-[10px] uppercase tracking-widest text-text-muted">Unit price</th>
            <th className="pb-1.5 text-right font-data text-[10px] uppercase tracking-widest text-text-muted">Line total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={item.is_cancelled ? 'text-text-muted' : 'text-text-primary'}>
              <td className={`py-1 text-[12.5px] ${item.is_cancelled ? 'line-through' : ''}`}>
                {item.name_snapshot}
                {item.is_cancelled && (
                  <span className="ml-2 font-data text-[10px] uppercase tracking-widest text-text-muted no-underline">
                    cancelled
                  </span>
                )}
              </td>
              <td className="py-1 text-right font-data text-[12.5px] tabular-nums">{Number(item.quantity)}</td>
              <td className="py-1 text-right font-data text-[12.5px] tabular-nums">{formatIdr(item.unit_price)}</td>
              <td className="py-1 text-right font-data text-[12.5px] tabular-nums">
                {item.is_cancelled ? formatIdr(0) : formatIdr(item.line_total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-muted">
            <td colSpan={3} className="pt-1.5 text-right font-data text-[10px] uppercase tracking-widest text-text-muted">
              {live.length} {live.length === 1 ? 'line' : 'lines'}
            </td>
            <td className="pt-1.5 text-right font-data text-[12.5px] font-semibold tabular-nums">
              {formatIdr(linesTotal)}
            </td>
          </tr>
          {drift !== 0 && (
            <tr>
              <td colSpan={4} className="pt-1 text-right font-data text-[10.5px] text-text-muted">
                order total {formatIdr(orderTotal)} — {drift > 0 ? 'header charge' : 'header discount'}{' '}
                {formatIdr(Math.abs(drift))}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
