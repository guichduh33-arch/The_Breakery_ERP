// apps/backoffice/src/pages/inventory/AlertsPage.tsx
//
// Refonte design 2026-08-08 (direction « Instrument »).
//
// Les QUATRE onglets sont conservés — ils restent le mécanisme de navigation de
// l'écran. Ce qui change tient en trois points :
//
//   · le titre passe par PageHeader : Playfair ne rend plus que le monogramme
//     de marque, et cet écran l'utilisait encore en 3xl ;
//   · chaque onglet porte SON compte. La rangée de trois tuiles à icônes qui
//     coiffait la page disparaît avec : deux de ses trois mesures répétaient
//     déjà un onglet, et la troisième (« Status ») n'était pas une mesure mais
//     une phrase déguisée en chiffre ;
//   · le déficit total, seule mesure transverse qui ne redisait aucun onglet,
//     rejoint le sous-titre.
//
// Le compte est chargé au niveau de la page pour tous les onglets, y compris
// ceux qui ne sont pas montés : un onglet dont on ne voit pas le compte tant
// qu'on ne l'a pas ouvert n'attire l'attention sur rien. React-query dédoublonne
// par clé, l'onglet monté ne refait donc aucune requête.

import { useMemo, useState, type JSX } from 'react';
import { AlertTriangle, ShoppingCart, SlidersHorizontal, Wheat } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { useLowStock } from '@/features/inventory-alerts/hooks/useLowStock.js';
import { useReorderSuggestions } from '@/features/inventory-alerts/hooks/useReorderSuggestions.js';
import { useProductionSuggestions } from '@/features/inventory-alerts/hooks/useProductionSuggestions.js';
import { useStockConfigIssues } from '@/features/inventory-alerts/hooks/useStockConfigIssues.js';
import { LowStockTab } from '@/features/inventory-alerts/components/LowStockTab.js';
import { ReorderTab } from '@/features/inventory-alerts/components/ReorderTab.js';
import { ProductionAlertsTab } from '@/features/inventory-alerts/components/ProductionAlertsTab.js';
import { ConfigIssuesTab } from '@/features/inventory-alerts/components/ConfigIssuesTab.js';

/**
 * Le compte d'un onglet, collé à son libellé.
 *
 * Il se tait quand il vaut zéro : un « 0 » sur quatre onglets fabrique quatre
 * signaux là où il n'y en a aucun. Ce qui mérite l'œil, c'est ce qui compte.
 */
function TabCount({ value, tone }: { value: number; tone: 'danger' | 'warning' | 'neutral' }): JSX.Element | null {
  if (value === 0) return null;
  return (
    <span
      className={cn(
        'ml-1.5 font-data text-[10.5px] font-bold tabular-nums',
        tone === 'danger' && 'text-danger',
        tone === 'warning' && 'text-warning',
        tone === 'neutral' && 'text-text-muted',
      )}
      aria-hidden
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

export default function AlertsPage(): JSX.Element {
  const [tab, setTab] = useState('low');

  const lowStock = useLowStock(null);
  const reorder = useReorderSuggestions(30, 14);
  const production = useProductionSuggestions();
  const configIssues = useStockConfigIssues();

  const lowRows = useMemo(() => lowStock.data ?? [], [lowStock.data]);

  // Le déficit total additionne des lignes d'unités hétérogènes (des kg avec
  // des pièces) : c'est un ordre de grandeur, pas une quantité dans une unité —
  // d'où le `null` passé à `formatQuantity`, et le mot « units » resté au
  // pluriel générique dans la phrase. L'arrondi manuel disparaît : le
  // formateur plafonne lui-même à trois décimales (audit UX/UI 2026-08-13).
  const shortfall = useMemo(
    () => lowRows.reduce((sum, r) => sum + Number(r.shortfall), 0),
    [lowRows],
  );
  const atZero = useMemo(() => lowRows.filter((r) => r.current_qty <= 0).length, [lowRows]);

  const counts = {
    low: lowRows.length,
    reorder: reorder.data?.length ?? 0,
    production: production.data?.length ?? 0,
    config: configIssues.data?.length ?? 0,
  };

  // Le sous-titre porte ce qu'aucun onglet ne dit : combien manque, et combien
  // sont à zéro — c'est-à-dire déjà invendables, pas seulement bas.
  const subtitle =
    lowStock.isLoading
      ? 'Loading…'
      : lowStock.error !== null
        ? 'Low-stock figures unavailable — the rest of the page still works.'
        : counts.low === 0
          ? 'Nothing under threshold. What to reorder and produce is in the tabs below.'
          : `${counts.low} under threshold · ${atZero} at zero · ${formatQuantity(shortfall, null)} units short in total`;

  return (
    <div className="flex flex-col gap-[13px]">
      <PageHeader title="Stock alerts" subtitle={subtitle} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="low" className="gap-1.5" data-testid="tab-low">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Low stock
            <TabCount value={counts.low} tone="danger" />
          </TabsTrigger>
          <TabsTrigger value="reorder" className="gap-1.5" data-testid="tab-reorder">
            <ShoppingCart className="h-3.5 w-3.5" aria-hidden /> Reorder
            <TabCount value={counts.reorder} tone="warning" />
          </TabsTrigger>
          <TabsTrigger value="production" className="gap-1.5" data-testid="tab-production">
            <Wheat className="h-3.5 w-3.5" aria-hidden /> Production
            <TabCount value={counts.production} tone="warning" />
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5" data-testid="tab-config">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Product config
            <TabCount value={counts.config} tone="neutral" />
          </TabsTrigger>
        </TabsList>

        {/* Les tables portent leur propre chrome (bordure, en-tête inerte, pied) —
            les envelopper dans une carte ajouterait une seconde bordure. */}
        <TabsContent value="low" className="mt-2.5">
          <LowStockTab />
        </TabsContent>
        <TabsContent value="reorder" className="mt-2.5">
          <ReorderTab />
        </TabsContent>
        <TabsContent value="production" className="mt-2.5">
          <ProductionAlertsTab />
        </TabsContent>
        <TabsContent value="config" className="mt-2.5">
          <ConfigIssuesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
