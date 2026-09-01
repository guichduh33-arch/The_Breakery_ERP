// apps/backoffice/src/features/inventory/components/LowStockBadge.tsx
//
// Pastille d'état de stock d'une ligne de la liste d'inventaire.
//
// Critique 2026-08-31 (P2) — la bande de compteurs déclare CINQ paniers
// (`useStockCounters.ts` : total / low / zero / negative / untracked) et la
// ligne n'en connaissait qu'un. Observé : « Chocolatine · 0 pcs · LOW STOCK »
// et « Croissant Almond · -1 pcs · LOW STOCK ». Le tableau de bord dit déjà à
// l'opératrice qu'un compteur vide est CATÉGORIQUEMENT différent (« 2 counters
// empty — POS blocks the sale ») ; la ligne qui EST cet état ne le disait pas.
// Vocabulaire de la bande et vocabulaire de la ligne se contredisaient au seul
// endroit où le chef de rayon lit les deux ensemble.
//
// Trois états, à l'INTÉRIEUR de la garde d'entrée existante :
//   · quantité < 0  → « Negative »     (danger — une valeur impossible)
//   · quantité = 0  → « Out of stock » (danger — le POS bloque la vente)
//   · sinon         → « Low stock »    (avertissement — il reste du stock)
//
// La garde d'entrée ne bouge PAS, et c'est délibéré : aucun produit ne gagne
// une pastille qu'il n'avait pas. Un produit à 0 avec un seuil à 0 reste donc
// sans pastille — le distinguer d'un produit non suivi exigerait
// `track_inventory` dans la ligne, que ce composant ne reçoit pas. Écart connu.

import { Badge } from '@breakery/ui';

export interface LowStockBadgeProps {
  currentStock:       number;
  minStockThreshold:  number;
}

export function LowStockBadge({ currentStock, minStockThreshold }: LowStockBadgeProps) {
  if (minStockThreshold <= 0)            return null;
  if (currentStock >= minStockThreshold) return null;

  const { label, variant } = currentStock < 0
    ? { label: 'Negative',     variant: 'destructive' as const }
    : currentStock === 0
      ? { label: 'Out of stock', variant: 'destructive' as const }
      : { label: 'Low stock',    variant: 'warning' as const };

  return (
    <Badge variant={variant} className="ml-2 text-xs uppercase tracking-widest">
      {label}
    </Badge>
  );
}
