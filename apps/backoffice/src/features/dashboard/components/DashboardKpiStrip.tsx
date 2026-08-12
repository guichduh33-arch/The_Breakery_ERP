// apps/backoffice/src/features/dashboard/components/DashboardKpiStrip.tsx
//
// Écran 1c — la bande de sept KPI, chacun avec ses deux comparaisons.
//
// La tuile n'a PAS d'icône : le `KpiTile` partagé pose une pastille d'icône or
// devant chaque valeur, et six pastilles or côte à côte donnaient une frise
// décorative où l'œil ne trouve plus le chiffre. Ici la place gagnée sert aux
// comparaisons, qui portent l'information (« 8,42 jt » ne dit rien, « 8,42 jt
// ▲12,4% » dit tout).
//
// Deux tuiles portent une NOTE DE SOURCE au lieu d'une comparaison, parce que
// leur mesure a une réserve gravée dans la migration 20260806000001 :
//   · marge brute — calculée au coût COURANT, avec la part du CA effectivement
//     couverte par un cost_price. Une marge à 61,8 % sur 40 % du CA couvert
//     n'est pas une marge à 61,8 %.
//   · cash on hand — le découpage tiroir/coffre est DÉRIVÉ, pas mesuré.
// Taire ces réserves ferait passer une estimation pour un relevé.

import type { JSX, ReactNode } from 'react';
import { Card, SectionLabel, cn } from '@breakery/ui';
import { Delta } from './Delta.js';
import {
  formatCount, formatIdr, formatIdrShort, formatPct,
} from '../utils/format.js';
import type { DashboardKpis } from '../hooks/useDashboardOverview.js';

const CARD = 'flex flex-col gap-[5px] px-[15px] py-[13px] shadow-none';
const LABEL = 'font-data text-[10px] font-semibold text-text-muted';
const VALUE = 'font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary';
const NOTE = 'font-data text-[10px] leading-tight text-text-muted';

// Tuile HÉRO — direction « Instrument » (maquette 3a). La première tuile est
// remplie d'encre et sa valeur monte de 23 à 26 px. Ce n'est pas un ornement :
// sept tuiles identiques donnent une frise où rien ne prime, alors que la
// question qu'on pose à un dashboard de boulangerie en ouvrant la page est
// toujours la même — combien a-t-on fait aujourd'hui. Une seule tuile est
// traitée ainsi ; une deuxième détruirait la hiérarchie qu'elle installe.
const CARD_HERO = `${CARD} border-ink bg-ink`;
const LABEL_HERO = 'font-data text-[10px] font-semibold text-ink-fg-sub';
const VALUE_HERO = 'font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums text-ink-fg';
const NOTE_HERO = 'font-data text-[10px] leading-tight text-ink-fg-sub';

function Tile({
  label, value, children, testId, hero = false, valueTitle,
}: {
  label: string;
  value: string;
  children?: ReactNode;
  testId: string;
  hero?: boolean;
  /**
   * Montant EXACT posé en infobulle quand `value` est en notation compacte
   * (« Rp 8,42 jt »). Un compact tronque : sans lui, le chiffre précis de la
   * journée n'est lisible nulle part sur la page — audit UX/UI 2026-08-13.
   */
  valueTitle?: string;
}): JSX.Element {
  return (
    <Card
      variant="default"
      padding="none"
      className={hero ? CARD_HERO : CARD}
      data-testid={testId}
    >
      <SectionLabel as="h3" className={hero ? LABEL_HERO : LABEL}>{label}</SectionLabel>
      <span className={hero ? VALUE_HERO : VALUE} title={valueTitle}>{value}</span>
      <div className="flex min-h-[16px] flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {children}
      </div>
    </Card>
  );
}

const UNAVAILABLE_TILES = [
  'Net revenue', 'Orders', 'Customers', 'Items sold', 'Avg basket', 'Gross margin', 'Cash on hand',
] as const;

export function DashboardKpiStrip({
  kpis,
  isLoading,
  error = null,
}: {
  kpis: DashboardKpis | null;
  isLoading: boolean;
  /** Échec de la RPC. Sans lui, `kpis === null` restait indiscernable d'un
   *  chargement et la bande pulsait indéfiniment en affirmant qu'elle charge. */
  error?: Error | null;
}): JSX.Element {
  const grid = 'grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7';

  // Donnée absente ET plus de chargement en cours : on ne connaît pas ces
  // valeurs. Le tiret cadratin est déjà le vocabulaire de l'inconnu dans ce
  // module (`format.ts`) — un zéro, lui, affirmerait une journée sans vente.
  if (!isLoading && kpis === null) {
    return (
      <div className={grid} data-testid="dashboard-kpi-row">
        {UNAVAILABLE_TILES.map((label, i) => (
          <Card
            key={label}
            variant="default"
            padding="none"
            className={cn(i === 0 ? CARD_HERO : CARD)}
            data-testid="kpi-unavailable"
          >
            <SectionLabel as="h3" className={i === 0 ? LABEL_HERO : LABEL}>{label}</SectionLabel>
            <span className={i === 0 ? VALUE_HERO : VALUE}>—</span>
            <div className="flex min-h-[16px] items-baseline">
              {/* Le muet est taillé pour le papier ; sur l'encre il tombe sous
                  le seuil de lecture — d'où la famille ink-* (Ink Semantics). */}
              <span className={i === 0 ? NOTE_HERO : NOTE}>
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
      <div className={grid} data-testid="dashboard-kpi-row">
        {Array.from({ length: 7 }).map((_, i) => (
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

  return (
    <div className={grid} data-testid="dashboard-kpi-row">
      <Tile
        label="Net revenue"
        value={formatIdrShort(kpis.net_revenue.value)}
        valueTitle={formatIdr(kpis.net_revenue.value)}
        testId="kpi-net-revenue"
        hero
      >
        <Delta value={kpis.net_revenue.vs_yesterday} period="yest" onInk />
        <Delta value={kpis.net_revenue.vs_d7} period="D-7" onInk />
      </Tile>

      <Tile label="Orders" value={formatCount(kpis.orders.value)} testId="kpi-orders">
        <Delta value={kpis.orders.vs_yesterday} period="yest" />
        <Delta value={kpis.orders.vs_d7} period="D-7" />
      </Tile>

      {/* Adossée à « Orders » : les deux mesurent la même journée, l'une en
          tickets l'autre en clients, et leur écart EST l'information (20
          commandes pour 4 clients ne raconte pas la même journée que 20 pour
          19). Les compter loin l'un de l'autre rendrait la lecture croisée
          impossible. Les clients anonymes sont exclus côté SQL. */}
      <Tile label="Customers" value={formatCount(kpis.customers.value)} testId="kpi-customers">
        <Delta value={kpis.customers.vs_yesterday} period="yest" />
        <Delta value={kpis.customers.vs_d7} period="D-7" />
      </Tile>

      <Tile label="Items sold" value={formatCount(kpis.items_sold.value)} testId="kpi-items-sold">
        <Delta value={kpis.items_sold.vs_yesterday} period="yest" />
        <Delta value={kpis.items_sold.vs_d7} period="D-7" />
      </Tile>

      <Tile label="Avg basket" value={formatIdr(kpis.avg_basket.value)} testId="kpi-avg-basket">
        <Delta value={kpis.avg_basket.vs_yesterday} period="yest" />
        <Delta value={kpis.avg_basket.vs_d7} period="D-7" />
      </Tile>

      <Tile label="Gross margin" value={formatPct(margin.value)} testId="kpi-gross-margin">
        <Delta value={margin.vs_yesterday_pt} unit="pt" period="yest" />
        <Delta value={margin.vs_d7_pt} unit="pt" period="D-7" />
      </Tile>

      <Tile
        label="Cash on hand"
        value={cash.restricted === true ? '—' : formatIdrShort(cash.value)}
        {...(cash.restricted === true ? {} : { valueTitle: formatIdr(cash.value) })}
        testId="kpi-cash-on-hand"
      >
        {cash.restricted === true ? (
          <span className={NOTE}>restricted — cash permission required</span>
        ) : (
          <span
            className={NOTE}
            title={`drawer ${formatIdr(cash.drawer)} · safe ${formatIdr(cash.safe)} — drawer is derived from open POS sessions, not a dedicated ledger account.`}
          >
            drawer {formatIdrShort(cash.drawer)} · safe {formatIdrShort(cash.safe)}
            {cash.is_derived === true && ' (derived)'}
          </span>
        )}
      </Tile>

      {/* La réserve de la marge vit sous la bande, pas dans la tuile : elle
          concerne la mesure elle-même et non sa variation du jour. */}
      <p className={cn(NOTE, 'col-span-full -mt-0.5')} data-testid="gross-margin-basis">
        Gross margin uses the current cost price
        {margin.cost_coverage_pct !== null && (
          <> · {formatPct(margin.cost_coverage_pct)} of revenue has a costed product</>
        )}
        {' '}— day-to-day changes reflect mix and prices, not cost drift.
      </p>
    </div>
  );
}
