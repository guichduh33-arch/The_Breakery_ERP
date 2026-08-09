// apps/backoffice/src/features/products/components/ProductPerformanceCard.tsx
//
// La carte de ventes de la fiche produit. Elle remplace celle que le distill du
// 2026-08-09 a retirée, qui affichait « 0% / 0 / — » en dur : trois valeurs
// jamais branchées, qu'un lecteur ne pouvait pas distinguer d'un relevé.
//
// Elle vit dans son propre fichier, et non dans GeneralPanel, pour la même
// raison que TestFlagToggle : les smokes rendent GeneralPanel SANS
// QueryClientProvider. Le composant qui porte le hook n'est monté qu'avec la
// permission ; sans elle, GeneralPanel rend `ProductPerformanceRestricted`, qui
// n'appelle rien.
//
// Forme reprise des cartes voisines de la colonne (Card padding="md", titre en
// capitales muettes) ; vocabulaire d'états repris de DashboardCard, dont la
// phrase d'erreur dit l'essentiel : ce qui manque n'est pas un zéro, c'est un
// inconnu.

import { Lock } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Card, Currency } from '@breakery/ui';
import { useProductPerformance } from '../hooks/useProductPerformance.js';

const TITLE_CLASS = 'mb-4 text-sm font-bold uppercase tracking-widest text-text-muted';

// Un seul séparateur de milliers dans la carte, et c'est celui du produit : la
// virgule (`Rp 4,850,000`), qu'impose déjà `Currency` sur la valeur principale.
// Formater la note en `id-ID` rendait « Counter 50.000 » deux lignes sous
// « Rp 300,000 » — un montant qui se lit cinquante.

/** Quantités : entières le plus souvent (pcs), décimales pour un produit au poids. */
function formatQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function ProductPerformanceCard({
  productId,
  days = 30,
}: {
  productId: string;
  days?: number;
}): JSX.Element {
  const { data, isLoading, error } = useProductPerformance(productId, days);

  // Un 42501 n'arrive pas ici : GeneralPanel ne monte ce composant qu'avec la
  // permission. S'il en remonte un quand même (droit retiré en cours de
  // session), il se lit comme une indisponibilité, pas comme un zéro.
  if (error !== null) {
    return (
      <Shell days={days}>
        <div className="py-1 text-[12.5px]" role="alert">
          <p className="text-text-primary">Sales data is unavailable.</p>
          <p className="mt-0.5 text-text-muted">
            Nothing here is a zero — it is unknown. ({error.message})
          </p>
        </div>
      </Shell>
    );
  }

  if (isLoading || data === null || data === undefined) {
    return (
      <Shell days={days}>
        <div className="space-y-2.5" data-testid="product-performance-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-3.5 animate-pulse rounded bg-surface-4 motion-reduce:animate-none"
            />
          ))}
        </div>
      </Shell>
    );
  }

  const { total, counter, b2b } = data;
  // La ventilation ne s'affiche que lorsqu'elle porte une information : sur un
  // produit sans aucune vente en gros, « Counter 120 · B2B 0 » n'apprend rien
  // et encombre trois lignes sur quatre.
  const hasB2b = b2b.units_sold > 0 || b2b.revenue > 0;

  return (
    <Shell days={days} window={data.window_days}>
      <div className="space-y-3.5" data-testid="product-performance">
        <Metric
          label="Units sold"
          value={formatQty(total.units_sold)}
          note={hasB2b
            ? `Counter ${formatQty(counter.units_sold)} · B2B ${formatQty(b2b.units_sold)}`
            : null}
        />
        <Metric
          label="Revenue"
          value={total.revenue > 0 ? <Currency amount={total.revenue} /> : '—'}
          // La note passe par `Currency` comme la valeur : un montant et son
          // détail ne peuvent pas se lire dans deux notations.
          note={hasB2b && total.revenue > 0
            ? <>Counter <Currency amount={counter.revenue} /> · B2B <Currency amount={b2b.revenue} /></>
            : null}
        />
        <Metric
          label="Conversion"
          value={`${total.conversion_pct}%`}
          // Un taux sans son dénominateur ne se lit pas : 12 % sur 8 commandes
          // et 12 % sur 1 200 ne disent pas la même chose.
          note={`${formatCount(total.orders_with_product)} of ${formatCount(total.orders_total)} orders`}
        />
      </div>
    </Shell>
  );
}

/** Rendu quand le rôle n'a pas `reports.sales.read` — aucun appel réseau. */
export function ProductPerformanceRestricted({ days = 30 }: { days?: number }): JSX.Element {
  return (
    <Shell days={days}>
      <div
        className="flex items-center gap-2 py-1 text-[12.5px] text-text-muted"
        data-testid="product-performance-restricted"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Restricted — your role does not have access to sales data.
      </div>
    </Shell>
  );
}

function Shell({
  days,
  window: windowDays,
  children,
}: {
  days: number;
  window?: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card padding="md">
      <h2 className={TITLE_CLASS}>Performance ({windowDays ?? days}d)</h2>
      {children}
    </Card>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</span>
      <div className="text-right">
        <div className="font-mono text-xl tabular-nums text-text-primary">{value}</div>
        {note !== null && <div className="mt-0.5 text-[11px] text-text-muted">{note}</div>}
      </div>
    </div>
  );
}
