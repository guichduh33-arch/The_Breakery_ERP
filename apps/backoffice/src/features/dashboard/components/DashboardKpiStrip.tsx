// apps/backoffice/src/features/dashboard/components/DashboardKpiStrip.tsx
//
// Écran 1c — la bande de sept KPI, chacun avec ses deux comparaisons.
//
// Pas de pastille décorative devant la valeur : les comparaisons portent
// l'information. Seule une flèche discrète indique les mesures cliquables.
//
// Deux tuiles portent une NOTE DE SOURCE au lieu d'une comparaison, parce que
// leur mesure a une réserve gravée dans la migration 20260806000001 :
//   · marge brute — calculée au coût COURANT, avec la part du CA effectivement
//     couverte par un cost_price. Une marge à 61,8 % sur 40 % du CA couvert
//     n'est pas une marge à 61,8 %.
//   · cash on hand — le découpage tiroir/coffre est DÉRIVÉ, pas mesuré.
// Taire ces réserves ferait passer une estimation pour un relevé.
//
// Deux propriétés ajoutées ensuite, chacune décrite là où elle vit :
//   · un chiffre REMONTE À SON ORIGINE — la tuile est un lien vers la page qui
//     porte sa mesure, sur la même fenêtre (table et exceptions : `kpiTargets`).
//   · le matin NE MENT PAS — tant que la journée n'a aucune vente, les
//     comparaisons cèdent la place à une mention unique (`dayState`).

import { useMemo, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Card, cn } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { toLocalDateStr } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
// Lot B (campagne Reports 2026-08-15) — la tuile vit désormais en partagé
// (src/components/kpi/KpiTile.tsx), consommée par le dashboard ET les rapports.
// La tuile HÉRO encre (valeur 26 px, une seule par écran) y est documentée.
import {
  KpiTile,
  KPI_CARD, KPI_CARD_HERO, KPI_LABEL, KPI_LABEL_HERO,
  KPI_NOTE, KPI_NOTE_HERO, KPI_VALUE, KPI_VALUE_HERO,
} from '@/components/kpi/KpiTile.js';
import { Delta } from './Delta.js';
import {
  formatCount, formatIdr, formatIdrShort, formatPct,
} from '../utils/format.js';
import { buildKpiTargets, type KpiTarget, type KpiTargetKey } from '../utils/kpiTargets.js';
import {
  hasNoComparisonBase, hasNoSalesYetToday, noBaselineNote, NO_SALES_YET_NOTE,
} from '../utils/dayState.js';
import type { DashboardKpis } from '../hooks/useDashboardOverview.js';

const CARD = KPI_CARD;
const LABEL = KPI_LABEL;
const VALUE = KPI_VALUE;
const NOTE = KPI_NOTE;
const CARD_HERO = KPI_CARD_HERO;
const LABEL_HERO = KPI_LABEL_HERO;
const VALUE_HERO = KPI_VALUE_HERO;
const NOTE_HERO = KPI_NOTE_HERO;

/** Adaptateur local : la tuile partagée prend `to`/`srHint`, la bande raisonne
 *  encore en `KpiTarget | null` (cible filtrée par permission). */
function Tile({
  label, value, children, testId, hero = false, valueTitle, tone = 'neutral', target = null,
  unavailable = false, unavailableLabel, compact = false,
}: {
  compact?: boolean;
  label: string;
  value: string;
  children?: ReactNode;
  testId: string;
  hero?: boolean;
  valueTitle?: string;
  tone?: 'neutral' | 'danger';
  target?: KpiTarget | null;
  /**
   * La mesure est absente — le formatteur a rendu un tiret cadratin. L'état
   * vient du KPI (`.value === null`), jamais de la chaîne affichée : le tiret
   * est un caractère, pas un fait.
   */
  unavailable?: boolean;
  unavailableLabel?: string;
}): JSX.Element {
  if (compact) {
    const body = <>
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="font-data text-lg font-semibold tabular-nums" title={valueTitle}
        data-testid={testId + '-value'} aria-hidden={unavailable || undefined}>{value}</span>
      {unavailable && <span className="sr-only">{unavailableLabel ?? 'no data'}</span>}
      <span className="flex flex-wrap gap-x-3 gap-y-1">{children}</span>
      {target !== null && <><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden /><span className="sr-only">{target.hint}</span></>}
    </>;
    const classes = 'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm px-3 py-2';
    return target === null
      ? <div className={classes} data-testid={testId}>{body}</div>
      : <Link to={target.href} className={cn(classes, FOCUS_RING, 'hover:bg-surface-4')} data-testid={testId}>{body}</Link>;
  }
  return (
    <div className="relative min-w-0 [&>a]:h-full [&>div]:h-full [&_h3]:pr-5 [&_h3]:font-body [&_h3]:text-sm [&_h3]:normal-case [&_h3]:tracking-normal">
      <KpiTile
        label={label}
        value={value}
        {...(valueTitle !== undefined ? { valueTitle } : {})}
        hero={hero}
        tone={tone}
        {...(target !== null ? { to: target.href, srHint: target.hint } : {})}
        unavailable={unavailable}
        {...(unavailableLabel !== undefined ? { unavailableLabel } : {})}
        testId={testId}
      >
        {children}
      </KpiTile>
      {target !== null && (
        <ArrowUpRight
          className={cn('pointer-events-none absolute right-3 top-3 h-3.5 w-3.5', hero ? 'text-ink-gold' : 'text-gold')}
          aria-hidden
        />
      )}
    </div>
  );
}

const UNAVAILABLE_TILES = [
  'Net revenue', 'Orders', 'Customers', 'Items sold', 'Avg basket', 'Gross margin', 'Cash on hand',
] as const;

export function DashboardKpiStrip({
  kpis,
  isLoading,
  error = null,
  group = 'all',
}: {
  group?: 'all' | 'primary' | 'secondary';
  kpis: DashboardKpis | null;
  isLoading: boolean;
  /** Échec de la RPC. Sans lui, `kpis === null` restait indiscernable d'un
   *  chargement et la bande pulsait indéfiniment en affirmant qu'elle charge. */
  error?: Error | null;
}): JSX.Element {
  // Proposition A : quatre mesures principales, trois repères secondaires.
  const secondary = group === 'secondary';
  const includes = (label: string) => group === 'all' ||
    (['Customers', 'Items sold', 'Avg basket'].includes(label) === secondary);
  const labels = UNAVAILABLE_TILES.filter(includes);
  const grid = secondary
    ? 'grid grid-cols-1 gap-2 border-y border-border-subtle py-2 md:grid-cols-3'
    : 'grid grid-cols-2 gap-2.5 xl:grid-cols-4';
  const rowId = secondary ? 'dashboard-secondary-kpis' : 'dashboard-kpi-row';
  // Le montant exact tient dans les tuiles larges de A ; les très grands
  // soldes gardent la notation compacte et leur infobulle exacte.
  const money = (value: number | null) => group !== 'all' && value !== null && Math.abs(value) < 100_000_000
    ? formatIdr(value) : formatIdrShort(value);

  // Hooks avant toute sortie anticipée — les branches squelette et « données
  // indisponibles » plus bas rendent sans eux, mais ne peuvent pas les sauter.
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const targets = useMemo(() => buildKpiTargets(toLocalDateStr(new Date())), []);

  /**
   * Cible de la tuile, ou `null` si le rôle n'a pas le droit d'ouvrir l'écran
   * visé — `PermissionGate` le renverrait sur `/backoffice`. Même filtrage que
   * la barre de raccourcis de la page.
   */
  const target = (key: KpiTargetKey): KpiTarget | null => {
    const t = targets[key];
    return t !== null && hasPermission(t.permission) ? t : null;
  };

  // Donnée absente ET plus de chargement en cours : on ne connaît pas ces
  // valeurs. Le tiret cadratin est déjà le vocabulaire de l'inconnu dans ce
  // module (`format.ts`) — un zéro, lui, affirmerait une journée sans vente.
  if (!isLoading && kpis === null) {
    return (
      <div className={grid} data-testid={rowId}>
        {labels.map((label, i) => (
          <Card
            key={label}
            variant="default"
            padding="none"
            className={cn(!secondary && i === 0 ? CARD_HERO : CARD)}
            data-testid="kpi-unavailable"
          >
            <SectionLabel as="h3" className={!secondary && i === 0 ? LABEL_HERO : LABEL}>{label}</SectionLabel>
            <span className={!secondary && i === 0 ? VALUE_HERO : VALUE}>—</span>
            <div className="flex min-h-[16px] items-baseline">
              {/* Le muet est taillé pour le papier ; sur l'encre il tombe sous
                  le seuil de lecture — d'où la famille ink-* (Ink Semantics). */}
              <span className={!secondary && i === 0 ? NOTE_HERO : NOTE}>
                {error !== null ? 'unavailable' : 'no data'}
              </span>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (isLoading || kpis === null) {
    return (
      <div className={grid} data-testid={rowId}>
        {Array.from({ length: labels.length }).map((_, i) => (
          <Card
            key={i}
            variant="default"
            padding="none"
            className={cn(CARD, 'animate-pulse motion-reduce:animate-none')}
            data-testid="kpi-skeleton"
          >
            {/* surface-4 et non bg-overlay : ce dernier vaut #fff sur la carte
                blanche → squelette invisible (audit design 2026-07-08, BO F1). */}
            <div className="h-2.5 w-20 rounded bg-surface-4" />
            <div className="h-6 w-24 rounded bg-surface-4" />
            <div className="h-3 w-16 rounded bg-surface-4" />
          </Card>
        ))}
      </div>
    );
  }

  const margin = kpis.gross_margin;
  const cash   = kpis.cash_on_hand;

  // Journée pas encore commencée : la veille sert de base à des comparaisons
  // qui n'ont pas d'objet, et la bande affichait sept « ▼ 100,0% » à
  // l'ouverture. On retire les comparaisons et on DIT pourquoi, une fois.
  const noSalesYet = hasNoSalesYetToday(kpis);

  // Même raisonnement, une colonne à la fois : la journée a vendu, mais la
  // veille (ou le même jour la semaine passée) était vide. Six tirets alignés
  // ne disent pas « période sans base » — ils se lisent comme une panne.
  const noYesterday = !noSalesYet && hasNoComparisonBase(kpis, 'yesterday');
  const noD7        = !noSalesYet && hasNoComparisonBase(kpis, 'd7');
  const baselineNote = noBaselineNote(noYesterday, noD7);

  return (
    <div className={grid} data-testid={rowId}>
      {includes('Net revenue') && (
        <Tile
          label="Net revenue"
          value={money(kpis.net_revenue.value)}
          valueTitle={formatIdr(kpis.net_revenue.value)}
          unavailable={kpis.net_revenue.value === null}
          testId="kpi-net-revenue"
          target={target('net_revenue')}
          hero
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={kpis.net_revenue.vs_yesterday} period="yest" onInk />}
              {!noD7 && <Delta value={kpis.net_revenue.vs_d7} period="D-7" onInk />}
            </>
          )}
        </Tile>
      )}

      {includes('Orders') && (
        <Tile
          label="Orders"
          value={formatCount(kpis.orders.value)}
          unavailable={kpis.orders.value === null}
          testId="kpi-orders"
          target={target('orders')}
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={kpis.orders.vs_yesterday} period="yest" />}
              {!noD7 && <Delta value={kpis.orders.vs_d7} period="D-7" />}
            </>
          )}
        </Tile>
      )}

      {includes('Gross margin') && (
        <Tile
          label="Gross margin"
          value={formatPct(margin.value)}
          unavailable={margin.value === null}
          testId="kpi-gross-margin"
          target={target('gross_margin')}
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={margin.vs_yesterday_pt} unit="pt" period="yest" />}
              {!noD7 && <Delta value={margin.vs_d7_pt} unit="pt" period="D-7" />}
            </>
          )}
        </Tile>
      )}

      {includes('Cash on hand') && (
        <Tile
          label="Cash on hand"
          value={cash.restricted === true ? '—' : money(cash.value)}
          {...(cash.restricted === true ? {} : { valueTitle: formatIdr(cash.value) })}
          // Deux absences distinctes : la donnée n'existe pas, ou le rôle n'a pas
          // le droit de la voir. Le tiret était le même pour les deux.
          unavailable={cash.restricted === true || cash.value === null}
          {...(cash.restricted === true ? { unavailableLabel: 'restricted' } : {})}
          // Une trésorerie NÉGATIVE est un solde à découvert — donc, dans un
          // commerce qui n'a pas de découvert, une erreur de saisie ou un coffre
          // non compté. Elle s'affichait comme une trésorerie saine. La tuile est
          // CLAIRE (le héro n'est posé que sur la première de la bande) : le ton
          // s'y résout en `--danger`, pas en `--ink-danger`.
          tone={cash.restricted !== true && cash.value !== null && cash.value < 0 ? 'danger' : 'neutral'}
          testId="kpi-cash-on-hand"
          target={cash.restricted === true ? null : target('cash_on_hand')}
        >
          {cash.restricted === true ? (
            <span className={NOTE}>restricted — cash permission required</span>
          ) : (
            <span
              className={NOTE}
              title={`drawer ${formatIdr(cash.drawer)} · safe ${formatIdr(cash.safe)} — drawer is derived from open POS sessions, not a dedicated ledger account.`}
            >
              {/* Le MOT, deuxième signal : la couleur ne porte jamais seule. */}
              {cash.value !== null && cash.value < 0 && 'overdrawn · '}
              drawer {formatIdrShort(cash.drawer)} · safe {formatIdrShort(cash.safe)}
              {cash.is_derived === true && ' (derived)'}
            </span>
          )}
        </Tile>
      )}

      {includes('Customers') && (
        <Tile compact={secondary}
          label="Customers"
          value={formatCount(kpis.customers.value)}
          unavailable={kpis.customers.value === null}
          testId="kpi-customers"
          target={target('customers')}
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={kpis.customers.vs_yesterday} period="yest" />}
              {!noD7 && <Delta value={kpis.customers.vs_d7} period="D-7" />}
            </>
          )}
        </Tile>
      )}

      {includes('Items sold') && (
        <Tile compact={secondary}
          label="Items sold"
          value={formatCount(kpis.items_sold.value)}
          unavailable={kpis.items_sold.value === null}
          testId="kpi-items-sold"
          target={target('items_sold')}
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={kpis.items_sold.vs_yesterday} period="yest" />}
              {!noD7 && <Delta value={kpis.items_sold.vs_d7} period="D-7" />}
            </>
          )}
        </Tile>
      )}

      {includes('Avg basket') && (
        <Tile compact={secondary}
          label="Avg basket"
          value={money(kpis.avg_basket.value)}
          valueTitle={formatIdr(kpis.avg_basket.value)}
          unavailable={kpis.avg_basket.value === null}
          testId="kpi-avg-basket"
          target={target('avg_basket')}
        >
          {!noSalesYet && (
            <>
              {!noYesterday && <Delta value={kpis.avg_basket.vs_yesterday} period="yest" />}
              {!noD7 && <Delta value={kpis.avg_basket.vs_d7} period="D-7" />}
            </>
          )}
        </Tile>
      )}

      {/* Une mention, pas sept. Elle prend la place des comparaisons retirées
          et nomme l'état plutôt que de le laisser deviner à un mur de tirets. */}
      {!secondary && noSalesYet && (
        <p className={cn(NOTE, 'col-span-full -mt-0.5')} data-testid="no-sales-yet">
          {NO_SALES_YET_NOTE}
        </p>
      )}

      {/* La colonne repliée se nomme, une fois, au même endroit et dans le même
          registre que la mention d'ouverture. */}
      {!secondary && baselineNote !== null && (
        <p className={cn(NOTE, 'col-span-full -mt-0.5')} data-testid="no-baseline">
          {baselineNote}
        </p>
      )}

      {/* La réserve de la marge vit sous la bande, pas dans la tuile : elle
          concerne la mesure elle-même et non sa variation du jour. */}
      {!secondary && <p className={cn(NOTE, 'col-span-full -mt-0.5')} data-testid="gross-margin-basis">
        Gross margin uses the current cost price
        {margin.cost_coverage_pct !== null && (
          <> · {formatPct(margin.cost_coverage_pct)} of revenue has a costed product</>
        )}
        {' '}— day-to-day changes reflect mix and prices, not cost drift.
      </p>}
    </div>
  );
}
