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
//
// Deux propriétés ajoutées ensuite, chacune décrite là où elle vit :
//   · un chiffre REMONTE À SON ORIGINE — la tuile est un lien vers la page qui
//     porte sa mesure, sur la même fenêtre (table et exceptions : `kpiTargets`).
//   · le matin NE MENT PAS — tant que la journée n'a aucune vente, les
//     comparaisons cèdent la place à une mention unique (`dayState`).

import { useMemo, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, SectionLabel, cardVariants, cn } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Delta } from './Delta.js';
import {
  formatCount, formatIdr, formatIdrShort, formatPct,
} from '../utils/format.js';
import { buildKpiTargets, type KpiTarget, type KpiTargetKey } from '../utils/kpiTargets.js';
import { hasNoSalesYetToday, NO_SALES_YET_NOTE } from '../utils/dayState.js';
import type { DashboardKpis } from '../hooks/useDashboardOverview.js';

const CARD = 'flex flex-col gap-[5px] px-[15px] py-[13px] shadow-none';
const LABEL = 'font-data text-xs font-semibold text-text-muted';
const VALUE = 'font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary';
const NOTE = 'font-data text-xs leading-tight text-text-muted';

// Tuile HÉRO — direction « Instrument » (maquette 3a). La première tuile est
// remplie d'encre et sa valeur monte de 23 à 26 px. Ce n'est pas un ornement :
// sept tuiles identiques donnent une frise où rien ne prime, alors que la
// question qu'on pose à un dashboard de boulangerie en ouvrant la page est
// toujours la même — combien a-t-on fait aujourd'hui. Une seule tuile est
// traitée ainsi ; une deuxième détruirait la hiérarchie qu'elle installe.
const CARD_HERO = `${CARD} border-ink bg-ink`;
const LABEL_HERO = 'font-data text-xs font-semibold text-ink-fg-sub';
const VALUE_HERO = 'font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums text-ink-fg';
const NOTE_HERO = 'font-data text-xs leading-tight text-ink-fg-sub';

// Une tuile-lien reste une TUILE. Pas de bleu, pas de soulignement : le seul
// signal au survol est le cran de surface prévu pour ça par le thème ivoire
// (`--surface-4` porte le commentaire « survol / pressé »), et son équivalent
// sur encre pour la tuile héro. Le focus passe par l'anneau maison — l'anneau
// par défaut du navigateur a été mesuré sous le seuil WCAG de 3:1.
const TILE_LINK      = `${FOCUS_RING} motion-safe:transition-colors hover:bg-surface-4`;
const TILE_LINK_HERO = `${FOCUS_RING} motion-safe:transition-colors hover:bg-ink-hover`;

function Tile({
  label, value, children, testId, hero = false, valueTitle, target = null,
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
  /**
   * Cible de drill-down, déjà filtrée par permission par l'appelant. `null`
   * laisse la tuile inerte — un `<div>`, pas un lien mort.
   */
  target?: KpiTarget | null;
}): JSX.Element {
  const body = (
    <>
      <SectionLabel as="h3" className={hero ? LABEL_HERO : LABEL}>{label}</SectionLabel>
      <span className={hero ? VALUE_HERO : VALUE} title={valueTitle}>{value}</span>
      <div className="flex min-h-[16px] flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {children}
      </div>
    </>
  );

  if (target !== null) {
    // `cardVariants` plutôt qu'un `<Card>` enveloppé dans un `<Link>` : le lien
    // DOIT être la boîte elle-même, sinon la zone cliquable ne couvre pas la
    // tuile et le focus ne se dessine pas autour d'elle. La destination est
    // annoncée par un complément en `sr-only` et non par un `aria-label`, qui
    // écraserait le contenu — le chiffre disparaîtrait de la lecture vocale.
    return (
      <Link
        to={target.href}
        data-testid={testId}
        className={cn(
          cardVariants({ variant: 'default', padding: 'none' }),
          hero ? CARD_HERO : CARD,
          hero ? TILE_LINK_HERO : TILE_LINK,
        )}
      >
        {body}
        <span className="sr-only">{target.hint}</span>
      </Link>
    );
  }

  return (
    <Card
      variant="default"
      padding="none"
      className={hero ? CARD_HERO : CARD}
      data-testid={testId}
    >
      {body}
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

  // Journée pas encore commencée : la veille sert de base à des comparaisons
  // qui n'ont pas d'objet, et la bande affichait sept « ▼ 100,0% » à
  // l'ouverture. On retire les comparaisons et on DIT pourquoi, une fois.
  const noSalesYet = hasNoSalesYetToday(kpis);

  return (
    <div className={grid} data-testid="dashboard-kpi-row">
      <Tile
        label="Net revenue"
        value={formatIdrShort(kpis.net_revenue.value)}
        valueTitle={formatIdr(kpis.net_revenue.value)}
        testId="kpi-net-revenue"
        target={target('net_revenue')}
        hero
      >
        {!noSalesYet && (
          <>
            <Delta value={kpis.net_revenue.vs_yesterday} period="yest" onInk />
            <Delta value={kpis.net_revenue.vs_d7} period="D-7" onInk />
          </>
        )}
      </Tile>

      <Tile
        label="Orders"
        value={formatCount(kpis.orders.value)}
        testId="kpi-orders"
        target={target('orders')}
      >
        {!noSalesYet && (
          <>
            <Delta value={kpis.orders.vs_yesterday} period="yest" />
            <Delta value={kpis.orders.vs_d7} period="D-7" />
          </>
        )}
      </Tile>

      {/* Adossée à « Orders » : les deux mesurent la même journée, l'une en
          tickets l'autre en clients, et leur écart EST l'information (20
          commandes pour 4 clients ne raconte pas la même journée que 20 pour
          19). Les compter loin l'un de l'autre rendrait la lecture croisée
          impossible. Les clients anonymes sont exclus côté SQL. */}
      <Tile
        label="Customers"
        value={formatCount(kpis.customers.value)}
        testId="kpi-customers"
        target={target('customers')}
      >
        {!noSalesYet && (
          <>
            <Delta value={kpis.customers.vs_yesterday} period="yest" />
            <Delta value={kpis.customers.vs_d7} period="D-7" />
          </>
        )}
      </Tile>

      <Tile
        label="Items sold"
        value={formatCount(kpis.items_sold.value)}
        testId="kpi-items-sold"
        target={target('items_sold')}
      >
        {!noSalesYet && (
          <>
            <Delta value={kpis.items_sold.vs_yesterday} period="yest" />
            <Delta value={kpis.items_sold.vs_d7} period="D-7" />
          </>
        )}
      </Tile>

      <Tile
        label="Avg basket"
        value={formatIdr(kpis.avg_basket.value)}
        testId="kpi-avg-basket"
        target={target('avg_basket')}
      >
        {!noSalesYet && (
          <>
            <Delta value={kpis.avg_basket.vs_yesterday} period="yest" />
            <Delta value={kpis.avg_basket.vs_d7} period="D-7" />
          </>
        )}
      </Tile>

      <Tile
        label="Gross margin"
        value={formatPct(margin.value)}
        testId="kpi-gross-margin"
        target={target('gross_margin')}
      >
        {!noSalesYet && (
          <>
            <Delta value={margin.vs_yesterday_pt} unit="pt" period="yest" />
            <Delta value={margin.vs_d7_pt} unit="pt" period="D-7" />
          </>
        )}
      </Tile>

      {/* La trésorerie est un SOLDE, pas un flux du jour : sa note de source
          reste lisible même quand la journée n'a pas commencé — elle ne dépend
          d'aucune comparaison. */}
      <Tile
        label="Cash on hand"
        value={cash.restricted === true ? '—' : formatIdrShort(cash.value)}
        {...(cash.restricted === true ? {} : { valueTitle: formatIdr(cash.value) })}
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
            drawer {formatIdrShort(cash.drawer)} · safe {formatIdrShort(cash.safe)}
            {cash.is_derived === true && ' (derived)'}
          </span>
        )}
      </Tile>

      {/* Une mention, pas sept. Elle prend la place des comparaisons retirées
          et nomme l'état plutôt que de le laisser deviner à un mur de tirets. */}
      {noSalesYet && (
        <p className={cn(NOTE, 'col-span-full -mt-0.5')} data-testid="no-sales-yet">
          {NO_SALES_YET_NOTE}
        </p>
      )}

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
