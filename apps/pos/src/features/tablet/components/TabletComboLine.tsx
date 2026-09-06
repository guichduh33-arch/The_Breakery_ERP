// apps/pos/src/features/tablet/components/TabletComboLine.tsx
//
// Lot D (2026-09-05) — sous-liste des composants d'une ligne combo du panier
// tablette. Sans elle, une ligne combo configurée s'affichait comme un produit
// nu : la serveuse ne pouvait pas relire ce qu'elle venait de choisir avant
// d'envoyer en cuisine.
//
// Même dérivation que le comptoir (`CartLineRow.ComboCartLineRow`) : la
// composition de LA LIGNE est la seule source vraie de ce que la commande
// enregistrera ; la définition ne sert qu'à résoudre les libellés, et ses
// options par défaut ne sont jamais affichées (un défaut n'est pas un choix —
// bug 2026-07-31). Les réponses aux modificateurs d'un composant (ADR-017)
// sont jointes par « · », comme au comptoir.

import type { JSX } from 'react';
import type { ComboComponent } from '@breakery/domain';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';

export interface TabletComboLineProps {
  /** Produit combo de la ligne — sert à charger sa définition (libellés). */
  productId: string;
  /** Composition choisie, telle qu'elle partira au serveur. */
  components: ComboComponent[];
}

export function TabletComboLine({ productId, components }: TabletComboLineProps): JSX.Element | null {
  const { data: def } = useComboConfig(productId);

  const labelByProductId = new Map(
    (def?.groups ?? []).flatMap((g) =>
      g.options.map((o) => [o.component_product_id, o.label] as const),
    ),
  );

  const lines: { name: string; quantity: number }[] = [];
  for (const comp of components) {
    const label = labelByProductId.get(comp.product_id) ?? 'Component';
    const answers = (comp.modifiers ?? []).map((m) => m.option_label).join(' · ');
    const name = answers ? `${label} — ${answers}` : label;
    const existing = lines.find((c) => c.name === name);
    if (existing) {
      existing.quantity += comp.quantity;
    } else {
      lines.push({ name, quantity: comp.quantity });
    }
  }

  if (lines.length === 0) return null;

  return (
    <ul className="mt-0.5 space-y-0.5 text-xs text-text-muted">
      {lines.map((c) => (
        <li key={c.name} className="flex items-baseline gap-1.5">
          <span className="tabular-nums shrink-0">{c.quantity}×</span>
          <span className="min-w-0 truncate">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}
