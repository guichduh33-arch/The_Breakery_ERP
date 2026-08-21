// apps/backoffice/src/features/inventory-production/components/ProductionTodayPanel.tsx
//
// Right column of the redesigned Production page: PRODUCED / WASTE KPI tiles and
// the production log for the selected day + station. Reads production_records
// (date-bounded) and filters to the active station client-side. Reverted records
// are excluded from the KPI totals.
//
// REMISE DANS L'ARCHÉTYPE 9 « Append-only log » (2026-08-21). DESIGN.md
// § Page Archetypes : « tout ce qui est en dessous [du panneau de saisie] porte
// LOCKED : déjà en stock, corrigeable par contre-écriture seulement ». Trois
// choses manquaient à ce panneau :
//
//   1. RIEN NE PORTAIT `LOCKED`. Le journal se lisait comme une liste ordinaire,
//      sans dire ni que ses lignes sont déjà en stock, ni ce qui les corrige. Le
//      verrou s'annonce désormais au-dessus des lignes, avec sa raison et son
//      issue — même vocabulaire que le verrou de l'inventaire tournant
//      (`pages/inventory/OpnameDetailPage`, `blockReason`) : on ne grise pas un
//      geste sans dire ce qui le débloque.
//   2. AUCUNE ACTION DE LIGNE. L'annulation d'une fournée était physiquement
//      inatteignable — voir l'en-tête de `RevertProductionAction`, qui porte le
//      détail. Chaque ligne non annulée expose désormais la contre-écriture.
//   3. UNE CONTRE-PASSATION RENDAIT À `opacity-50`. Dans un registre, une ligne
//      annulée est un FAIT, pas une donnée morte : elle se lit autant que les
//      autres, et son état se dit par un MOT. L'opacité est remplacée par un
//      libellé `REVERTED` et par la date de l'annulation.
//
// Les deux tuiles portaient enfin `text-3xl` (34 px) sur un aplat teinté :
// 34 px passe au-dessus du plus grand corps réellement rendu du produit (26 px,
// la valeur héro du dashboard), et DESIGN.md § Cartes veut une feuille blanche
// bordée, la couleur passant sur le TEXTE et non sur le fond. Elles reprennent
// les constantes partagées de la tuile de KPI — 23 px, le cran de la valeur de
// tuile ordinaire — plutôt qu'un nombre réécrit à la main.

import { Clock, Lock } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { Card, EmptyState, SectionLabel, cn } from '@breakery/ui';
// `production_records` ne porte pas l'unité du produit fabriqué : les quatre
// quantités de ce panneau se formatent sans suffixe (audit UX/UI 2026-08-13).
import { formatQuantity, formatDateTimeShortWita } from '@breakery/utils';
import { KPI_LABEL, KPI_VALUE } from '@/components/kpi/KpiTile.js';
import {
  useProductionRecords,
  type ProductionRecordSummary,
} from '../hooks/useProductionRecords.js';
import { RevertProductionAction } from './RevertProductionAction.js';

interface Props {
  sectionId: string;
  selectedDate: Date;
}

/**
 * Ce que le verrou de l'archétype dit à l'opérateur, en toutes lettres : ce
 * qu'il ne peut pas faire, POURQUOI, et par où passe le correctif. Un `LOCKED`
 * nu est une décoration ; celui-ci est une affirmation d'état.
 */
const LOCK_REASON =
  'Recorded batches are already in stock. They cannot be edited — only reverted, ' +
  'which restores the stock and posts a counter entry.';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function ProductionTodayPanel({ sectionId, selectedDate }: Props): JSX.Element {
  const fromDate = startOfDay(selectedDate).toISOString();
  const toDate = endOfDay(selectedDate).toISOString();
  const { data, isLoading } = useProductionRecords({ fromDate, toDate });

  const rows = useMemo<ProductionRecordSummary[]>(
    () => (data ?? []).filter((r) => r.section_id === sectionId),
    [data, sectionId],
  );

  const { produced, waste, revertedCount } = useMemo(() => {
    let p = 0;
    let w = 0;
    let reverted = 0;
    for (const r of rows) {
      if (r.reverted_at !== null) { reverted += 1; continue; }
      p += r.quantity_produced;
      w += r.quantity_waste;
    }
    return { produced: p, waste: w, revertedCount: reverted };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* DESIGN.md § Cartes : feuille blanche + bordure. La couleur porte sur le
          TEXTE, l'aplat teinté disparaît — et le corps redescend sur la rampe
          via `KPI_VALUE` (23 px), la valeur de tuile ordinaire. */}
      <div className="grid grid-cols-2 gap-4">
        <Card padding="md" className="text-center">
          <SectionLabel as="div" size="xs" className={KPI_LABEL}>Produced</SectionLabel>
          <div className={cn('mt-2', KPI_VALUE, 'text-success')} data-testid="kpi-produced">
            {formatQuantity(produced, null)}
          </div>
        </Card>
        <Card padding="md" className="text-center">
          <SectionLabel as="div" size="xs" className={KPI_LABEL}>Waste</SectionLabel>
          <div className={cn('mt-2', KPI_VALUE, 'text-danger')} data-testid="kpi-waste">
            {formatQuantity(waste, null)}
          </div>
        </Card>
      </div>

      <Card padding="md" className="min-h-[20rem]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel as="div" size="xs">Today&apos;s Production ({rows.length})</SectionLabel>
          {/* Le marqueur de l'archétype. Il ne se rend PAS quand le journal est
              vide : verrouiller le néant n'affirme rien. */}
          {rows.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface-inert px-2 py-0.5 font-data text-xs font-semibold uppercase tracking-widest text-text-muted"
              data-testid="production-log-locked"
            >
              <Lock className="h-3 w-3 text-text-subtle" aria-hidden />
              Locked
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-text-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Clock}
            size="md"
            title="No production recorded yet"
            description="Submitted batches for this station and day will appear here."
            data-testid="today-production-empty"
          />
        ) : (
          <>
            <p className="mt-2 text-xs text-text-muted" data-testid="production-log-lock-reason">
              {LOCK_REASON}
            </p>
            {/* La réserve se dit À CÔTÉ de la mesure, jamais en note de bas de
                page (DESIGN.md § Do's) : les deux tuiles excluent ces lignes. */}
            {revertedCount > 0 && (
              <p className="mt-1 text-xs text-text-muted" data-testid="production-log-reverted-note">
                {revertedCount === 1
                  ? '1 reverted batch is excluded from the totals above.'
                  : `${String(revertedCount)} reverted batches are excluded from the totals above.`}
              </p>
            )}
            <ul className="mt-3 space-y-2" data-testid="today-production-list">
              {rows.map((r) => {
                const reverted = r.reverted_at !== null;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-3 py-2 text-sm"
                    data-testid={`production-row-${r.production_number}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-text-primary">{r.product_name ?? r.product_id.slice(0, 8)}</div>
                      <div className="font-mono text-xs uppercase tracking-widest text-text-muted">
                        {r.production_number}
                      </div>
                      {/* Un état NOMMÉ, pas une opacité : la contre-passation est
                          un fait du registre, elle se lit à plein contraste. */}
                      {reverted && r.reverted_at !== null && (
                        <div className="font-mono text-xs uppercase tracking-widest text-warning">
                          Reverted · {formatDateTimeShortWita(r.reverted_at)}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-text-primary">{formatQuantity(r.quantity_produced, null)}</div>
                        {r.quantity_waste > 0 && (
                          <div className="text-xs text-danger">−{formatQuantity(r.quantity_waste, null)} waste</div>
                        )}
                      </div>
                      {/* Une ligne déjà annulée n'offre plus la contre-écriture :
                          le serveur la refuserait (`already_reverted`). */}
                      {!reverted && (
                        <RevertProductionAction
                          productionId={r.id}
                          productionNumber={r.production_number}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
