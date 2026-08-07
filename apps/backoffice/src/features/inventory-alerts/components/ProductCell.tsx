// apps/backoffice/src/features/inventory-alerts/components/ProductCell.tsx
//
// La cellule « produit » des quatre onglets d'alertes : le nom en lien, la
// référence en mono dessous.
//
// Les quatre onglets la réécrivaient à l'identique. Ce n'est pas qu'une
// factorisation : le SKU est une DONNÉE, il doit rendre en mono tabulaire, et
// une règle qui vit à quatre endroits finit par ne plus valoir qu'à trois.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';

export interface ProductCellProps {
  productId: string;
  name: string;
  /** Référence, ou toute autre ligne d'appoint (catégorie). */
  secondary?: string | null;
}

export function ProductCell({ productId, name, secondary }: ProductCellProps): JSX.Element {
  return (
    <div className="min-w-0">
      <Link
        to={`/backoffice/products/${productId}/dashboard`}
        className="text-[13px] text-text-primary transition-colors hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {name}
      </Link>
      {secondary !== null && secondary !== undefined && secondary !== '' && (
        <div className="font-data text-[10.5px] text-text-muted">{secondary}</div>
      )}
    </div>
  );
}
