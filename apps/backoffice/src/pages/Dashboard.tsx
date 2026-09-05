// apps/backoffice/src/pages/Dashboard.tsx
//
// Écran 1c — Dashboard « Today ». Page d'accueil du backoffice.
//
// Le principe de la refonte : la page ne raconte plus la journée d'hier, elle
// montre l'état de la maison MAINTENANT. D'où trois changements de fond par
// rapport à l'ancien écran S63 :
//
//   1. Chaque chiffre porte ses COMPARAISONS (J-1 et même jour la semaine
//      passée). « Rp 8,42 jt » ne dit rien ; « ▲12,4% vs hier » dit tout.
//   2. Une file d'ACTIONS s'intercale entre les chiffres et les graphes : ce
//      qui reste à faire (caisse non clôturée, PO à recevoir, facture B2B en
//      retard) vaut mieux qu'une sixième courbe.
//   3. L'état du plancher et de la vitrine arrive en REALTIME, pas en poll :
//      leur marqueur « live » est une promesse tenue (useDashboardPanels).
//
// Cadences et droits : l'agrégat (`get_dashboard_overview_v3`, poll 60 s) porte
// la barrière `reports.read`, et son bloc trésorerie exige en plus
// `accounting.cash.read`. Les trois panneaux ont chacun LEUR droit — d'où des
// requêtes séparées, pour qu'un rôle sans droit rapport garde l'état du
// plancher qu'il a le droit de voir. Chaque carte dégrade seule ; un 42501 se
// rend « restreint », jamais en erreur rouge.
//
// La prop `data` (tests) désactive le hook agrégat ET les trois panneaux :
// aucun réseau en test.

import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, BellRing, Building2, CalendarHeart, FileDown, RefreshCw,
} from 'lucide-react';
import { Card, cn } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { toLocalDateStr } from '@breakery/domain';
import { formatDateLong } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { RestrictedState } from '@/components/RestrictedState.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useHolidaysList, holidayNameFor } from '@/features/settings/hooks/useHolidays.js';
import {
  useDashboardOverview,
  classifyDashboardError,
  type DashboardOverview,
} from '@/features/dashboard/hooks/useDashboardOverview.js';
import {
  useDisplayStockActivity, useOpenOrders, isRestricted,
} from '@/features/dashboard/hooks/useDashboardPanels.js';
import { DashboardKpiStrip } from '@/features/dashboard/components/DashboardKpiStrip.js';
// Les deux seuls consommateurs de `recharts` de la page d'accueil. Statiques,
// ils tiraient le chunk `charts` (443 Ko bruts / 117 Ko gzip) dans le premier
// téléchargement après connexion — pour deux graphes situés SOUS la bande de
// KPI. En `lazy`, la page arrive sans eux et le chunk se charge en second
// plan. Exports NOMMÉS : d'où le `.then()` qui les remet en `default`.
const RevenueTrendChart = lazy(() =>
  import('@/features/dashboard/components/RevenueTrendChart.js')
    .then((m) => ({ default: m.RevenueTrendChart })),
);
const HourlySalesChart = lazy(() =>
  import('@/features/dashboard/components/HourlySalesChart.js')
    .then((m) => ({ default: m.HourlySalesChart })),
);
import { OpenOrdersCard } from '@/features/dashboard/components/OpenOrdersCard.js';
import { CostMtdCard } from '@/features/dashboard/components/CostMtdCard.js';
import { DisplayStockCard } from '@/features/dashboard/components/DisplayStockCard.js';
import { RevenueShareCard } from '@/features/dashboard/components/RevenueShareCard.js';
import { Delta } from '@/features/dashboard/components/Delta.js';
import { formatClock, formatHourRange, formatIdr, formatIdrShort, formatPct } from '@/features/dashboard/utils/format.js';
import { exportDashboardCsv } from '@/features/dashboard/utils/dashboardCsv.js';
import { revenue30dTarget } from '@/features/dashboard/utils/kpiTargets.js';
import { useTodayHours } from '@/features/dashboard/hooks/useTodayHours.js';
import {
  TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON,
} from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface DashboardData {
  data: DashboardOverview | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface DashboardPageProps {
  /** Test-only override — when provided, every live hook is disabled. */
  data?: DashboardData;
}

/**
 * Raccourcis de l'en-tête. Le handoff les veut épinglables par utilisateur ;
 * la gestion des épingles est un chantier à part (persistance + éditeur), donc
 * cette liste est pour l'instant le jeu par défaut, filtré par droit.
 *
 * Arbitré le 2026-08-07 : l'épinglage part au backlog, il ne bloque pas 1c.
 */
const SHORTCUTS = [
  { to: '/backoffice/reports/daily-sales', label: 'Daily sales',  icon: BarChart3, permission: 'reports.sales.read' },
  { to: '/backoffice/inventory/alerts',    label: 'Stock alerts', icon: BellRing,  permission: 'inventory.read' },
  { to: '/backoffice/b2b',                 label: 'B2B orders',   icon: Building2, permission: 'b2b.read' },
] as const;

function todayTitle(): string {
  return `Today · ${formatDateLong(new Date())}`;
}

/**
 * Repli des deux graphes `lazy`. Deux contraintes, pas une :
 *   · `h-44` — la hauteur EXACTE des trois branches des deux graphes (courbe,
 *     état vide, état d'erreur). Un repli plus court ferait sauter la carte au
 *     moment où le chunk arrive.
 *   · `bg-surface-4` (papier pressé) — DESIGN.md § Do : un squelette blanc est
 *     invisible sur une carte blanche. Même geste que le squelette des cartes
 *     du tableau de bord (DashboardCard), animation coupée sous
 *     `motion-reduce`.
 */
function ChartSkeleton() {
  return (
    <div
      data-testid="chart-skeleton"
      role="status"
      aria-label="Loading chart"
      className="h-44 animate-pulse rounded bg-surface-4 motion-reduce:animate-none"
    />
  );
}

export default function DashboardPage({ data }: DashboardPageProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isTest = data !== undefined;
  const live = useDashboardOverview(!isTest);

  const overview  = isTest ? data.data : live.data ?? null;
  const isLoading = isTest ? data.isLoading : live.isLoading;
  const error     = isTest ? data.error : live.error ?? null;
  const refetch   = isTest ? data.refetch : () => { void live.refetch(); };

  const openOrders   = useOpenOrders(!isTest);
  const displayStock = useDisplayStockActivity(!isTest);

  const restricted =
    error !== null && classifyDashboardError(error) === 'permission_denied';

  // Amplitude du jour : « Rp 8,42 jt » ne dit pas la même chose à 09:42 d'une
  // journée qui ferme à 18:00 qu'à 17:50. Absente ou interdite → le sous-titre
  // se contente de la dernière synchro.
  const hours = useTodayHours(!isTest);

  // Settings §6.A — consommateur des jours fériés : une journée de CA inhabituel
  // doit se lire comme un contexte expliqué, pas comme une anomalie.
  const holidays = useHolidaysList();
  const todayHoliday = holidayNameFor(holidays.data, toLocalDateStr(new Date()));

  // Le titre suit le RENDU, pas le montage : mémorisé une fois, un onglet
  // laissé ouvert après minuit titrait encore la veille au-dessus des chiffres
  // du jour (critique BO du 2026-09-04). Le rafraîchissement de 60 s de la
  // vue d'ensemble rend l'écran de toute façon ; le format d'une date ne
  // vaut pas une mémo.
  const title = todayTitle();
  const canExport = hasPermission('reports.export');
  const shortcuts = SHORTCUTS.filter((s) => hasPermission(s.permission));

  const summary = overview?.revenue_30d_summary ?? null;
  const peak    = overview?.hourly_peak ?? null;

  // Le graphe 30 jours mène au tableau qui le détaille, sur la MÊME fenêtre —
  // et seulement si le rôle peut ouvrir cet écran, sinon `PermissionGate` le
  // renverrait ici même. Les bornes viennent des dates DÉJÀ tracées : lire la
  // première du tableau évite de recalculer un intervalle qui pourrait diverger
  // de celui du serveur.
  const revenueDays  = overview?.revenue_30d ?? [];
  const revenueStart = revenueDays[0]?.date ?? null;
  const revenueEnd   = revenueDays[revenueDays.length - 1]?.date ?? null;
  const revenueLink =
    revenueStart !== null && revenueEnd !== null && hasPermission('reports.sales.read')
      ? revenue30dTarget(revenueEnd, revenueStart)
      : null;

  return (
    <div className="space-y-3.5">
      <PageHeader
        title={title}
        subtitle={
          <span className="inline-flex items-center gap-2" aria-live="polite">
            {hours !== null && <>Open since {hours.open} · closes {hours.close} · </>}
            {/* Audit /impeccable 2026-08-13 (P2-4) — le seul témoin d'activité
                était la rotation de l'icône, éteinte par `motion-reduce`. Sous
                mouvement réduit l'écran ne répondait donc RIEN au clic, et on
                recliquait. Le témoin passe à un état STATIQUE — libellé qui
                change, contrôle désactivé et grisé — lisible par tout le monde,
                pas seulement par ceux qui acceptent le mouvement. Même geste
                que le bouton Refresh de la liste des commandes. */}
            {isLoading ? 'Refreshing…' : <>Last sync {formatClock(overview?.generated_at)}</>}
            <button
              type="button"
              onClick={refetch}
              disabled={isLoading}
              className="text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isLoading ? 'Refreshing dashboard' : 'Refresh dashboard'}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin motion-reduce:animate-none')} aria-hidden />
            </button>
          </span>
        }
        actions={
          <>
            {shortcuts.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className={TOOLBAR_BTN_SECONDARY}>
                <Icon className={TOOLBAR_ICON} aria-hidden />
                {label}
              </Link>
            ))}
            {/* Export est SECONDAIRE, pas primaire. Deux raisons qui se cumulent :
                l'encre du bandeau est réservée au bouton qui CRÉE (cf. l'en-tête
                de toolbarButton.ts), et Export n'ouvre rien — il télécharge ;
                et la tuile héro de la bande de KPI est déjà encrée, donc un
                second aplat encre viole The One Ink Fill Rule et fait désigner
                par le poids maximal de la page d'accueil une action secondaire
                plutôt que la réponse à la question qu'on vient y poser. */}
            {canExport && (
              <button
                type="button"
                className={TOOLBAR_BTN_SECONDARY}
                disabled={overview === null}
                onClick={() => { if (overview !== null) exportDashboardCsv(overview); }}
                data-testid="dashboard-export"
              >
                <FileDown className={TOOLBAR_ICON} aria-hidden />
                Export
              </button>
            )}
          </>
        }
      />

      {todayHoliday !== null && (
        /* Aplat retiré (The Ink-Not-Gold Rule) ; le liseré monte de
           `border-border-gold` — rgba(122,92,28,0.35), 1,64:1 sur le papier,
           donc invisible au sens de WCAG 1.4.11 — à `border-gold`, qui vaut
           5,41:1 sur ce même papier et porte seul le bandeau. */
        <div
          data-testid="holiday-banner"
          className="flex items-center gap-2 rounded-md border border-gold px-4 py-2.5 text-sm text-text-primary"
        >
          <CalendarHeart className="h-4 w-4 text-gold" aria-hidden />
          <span>
            Public holiday today: <strong>{todayHoliday}</strong> — expect unusual traffic patterns.
          </span>
        </div>
      )}

      {restricted ? (
        <RestrictedState
          what="dashboard metrics"
          permission="reports.read"
          data-testid="dashboard-restricted"
        />
      ) : (
        <>
          {error !== null && (
            <Card
              variant="default"
              padding="md"
              role="alert"
              className="flex flex-wrap items-start justify-between gap-3 shadow-none"
              data-testid="dashboard-error"
            >
              <div className="min-w-0">
                <p className="text-sm text-text-primary">Today&apos;s figures could not be loaded.</p>
                {/* Nommer ce que l'écran fait de son ignorance : sans cette
                    phrase, un tiret se lit comme « rien vendu » au lieu de
                    « on ne sait pas ». Le détail technique reste en second. */}
                <p className="mt-0.5 text-xs text-text-muted">
                  Values below read <span className="font-data">—</span> because they are unknown, not zero.
                  Other cards may still be up to date. ({error.message})
                </p>
              </div>
              <button type="button" onClick={refetch} className={TOOLBAR_BTN_SECONDARY}>
                Retry
              </button>
            </Card>
          )}

          <DashboardKpiStrip kpis={overview?.kpis ?? null} isLoading={isLoading} error={error} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
            <Card variant="default" padding="none" className="p-4 shadow-none">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <SectionLabel as="h2" className="font-data text-xs font-semibold text-text-primary">
                  {revenueLink === null ? (
                    'Revenue · 30 days'
                  ) : (
                    <Link
                      to={revenueLink.href}
                      data-testid="revenue-30d-link"
                      className={cn('rounded-sm hover:text-gold', FOCUS_RING)}
                    >
                      Revenue · 30 days
                      <span className="sr-only"> — {revenueLink.hint}</span>
                    </Link>
                  )}
                </SectionLabel>
                {summary !== null && (
                  <span className="text-sm text-text-secondary">
                    <span className="font-data tabular-nums" title={formatIdr(summary.total)}>{formatIdrShort(summary.total)}</span> total{' '}
                    <Delta value={summary.delta_pct} period="vs previous 30 d" />
                  </span>
                )}
              </div>
              <div className="mt-3">
                <Suspense fallback={<ChartSkeleton />}>
                  <RevenueTrendChart data={overview?.revenue_30d ?? []} error={error} />
                </Suspense>
              </div>
            </Card>

            <Card variant="default" padding="none" className="p-4 shadow-none">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <SectionLabel as="h2" className="font-data text-xs font-semibold text-text-primary">
                  Sales by hour
                </SectionLabel>
                <span className="text-xs text-text-muted">today vs same weekday last week</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {error !== null
                  ? 'Peak unavailable'
                  : peak === null
                    ? 'No peak yet today'
                    : `Peak ${formatHourRange(peak.from_hour, peak.to_hour)} · ${formatPct(peak.share_pct)} of the day`}
              </p>
              <div className="mt-2">
                <Suspense fallback={<ChartSkeleton />}>
                  <HourlySalesChart data={overview?.hourly_sales ?? []} error={error} />
                </Suspense>
              </div>
            </Card>
          </div>

          {/* `items-start` : chaque carte se dimensionne à son contenu. En
              `stretch` avec des contenus inégaux, les courtes montrent un tiers
              inférieur blanc et mort. */}
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OpenOrdersCard
              panel={openOrders.data ?? null}
              isLoading={openOrders.isLoading}
              isRestricted={isRestricted(openOrders.error)}
              error={isRestricted(openOrders.error) ? null : openOrders.error}
            />
            <CostMtdCard
              cost={overview?.cost_mtd ?? null}
              isLoading={isLoading}
              error={error}
            />
            <DisplayStockCard
              panel={displayStock.data ?? null}
              isLoading={displayStock.isLoading}
              isRestricted={isRestricted(displayStock.error)}
              error={isRestricted(displayStock.error) ? null : displayStock.error}
            />
            <RevenueShareCard
              share={overview?.revenue_share ?? []}
              payments={overview?.payments ?? null}
              isLoading={isLoading}
              error={error}
            />
          </div>
        </>
      )}
    </div>
  );
}
