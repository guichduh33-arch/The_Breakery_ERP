// apps/backoffice/src/pages/reports/ReportsIndexPage.tsx
//
// Le hub des rapports : une tuile par rapport, groupées par famille (Sales,
// Inventory, Purchases, Finance, Operations, Marketing, Logs). Les tuiles ne
// portent AUCUNE valeur — le hub-à-valeurs de la direction est le tableau de
// bord, pas Reports.
//
// Trois choses le rendent balayable sans le lire en entier :
//   · une recherche qui filtre titre ET blurb (casse et accents indifférents) ;
//     une famille dont plus aucune tuile ne correspond disparaît, et un
//     cul-de-sac se dit avec un état vide, pas avec du blanc ;
//   · un compte par famille, DÉRIVÉ de la table ci-dessous et jamais écrit à la
//     main, qui suit le filtrage (« 3 of 6 ») — l'œil sait avant de descendre
//     ce que la recherche a laissé dans chaque groupe ;
//   · une bande « Recently viewed » en tête, alimentée au clic sur une tuile et
//     persistée par poste (`bo:reports:recent`).
//
// Le gating par permission reste au niveau des ROUTES : le hub montre tout, la
// PermissionGate refuse à l'entrée. C'est intentionnel — un hub qui se réduit
// en silence ne dit pas à un gérant qu'un rapport existe mais lui est fermé.
//
// Lot H (campagne Reports 2026-08-15) — la page rejoint l'archétype du socle :
// tuile-lien composée sur `cardVariants` (le lien EST la boîte, donc la zone
// cliquable couvre la tuile et le focus se dessine autour d'elle), gouttières et
// coins du module, plus de titre serif. La mécanique « Soon » — tuile inerte
// pour un rapport annoncé mais non construit — est retirée : plus aucune tuile
// ne s'en servait, et une branche morte sur le chemin de rendu se paie au
// premier ajout. Ajouter un rapport = ajouter une ligne dans `SECTIONS`.

import { useCallback, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, PieChart, Users, Boxes, Shield, Coins, Scale, Banknote, Layers3,
  Calendar, CalendarClock, Clock, CreditCard, FileSpreadsheet, KeyRound, ListChecks, Receipt,
  Package, ShoppingCart, Truck, AlertTriangle, TrendingDown, TrendingUp, Hourglass,
  GitCommitHorizontal, Undo2, BadgePercent,
  LineChart, Sparkles, Megaphone, Cake, History, SearchX, type LucideIcon,
} from 'lucide-react';
import { cardVariants, cn, EmptyState, Input, SectionLabel } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useRecentReports } from './recentReports.js';

interface ReportCard {
  to:     string;
  title:  string;
  blurb:  string;
  icon:   LucideIcon;
}

interface ReportSection {
  id:     string;
  title:  string;
  cards:  ReportCard[];
}

const SECTIONS: ReportSection[] = [
  {
    id: 'sales',
    title: 'Sales',
    cards: [
      { to: 'sales-by-hour',     title: 'Sales by Hour',     blurb: 'Hourly revenue distribution.',                  icon: Clock },
      { to: 'sales-by-category', title: 'Sales by Category', blurb: 'Revenue + qty per product category.',           icon: PieChart },
      { to: 'sales-by-product',  title: 'Sales by Product',  blurb: 'Qty, revenue and counter/B2B split per product, down to each sale.', icon: Package },
      { to: 'sales-by-customer', title: 'Sales by Customer', blurb: 'Who matters and who is churning — identified vs anonymous capture.', icon: Users },
      { to: 'sales-by-staff',    title: 'Sales by Staff',    blurb: 'Total / order count / avg basket per staff.',   icon: Users },
      { to: 'refunds-voids',     title: 'Refunds & Voids',   blurb: 'Money going back out — voids, partial refunds, reasons and double signature.', icon: Undo2 },
      { to: 'discounts-loyalty', title: 'Discounts & Loyalty', blurb: 'Money given away — four levers, PIN signatures, points issued vs burned.', icon: BadgePercent },
      { to: 'sales-by-origin',   title: 'Sales by Origin',     blurb: 'Counter, floor tablets or back-office — read from the source-coded number.', icon: GitCommitHorizontal },
      { to: 'combo-sales',       title: 'Combo Sales',         blurb: 'Do combos sell, which ones — and do they lift the ticket. Component picks included.', icon: Layers3 },
      { to: 'cashier-variance',  title: 'Cashier Variance',  blurb: 'Cash / QRIS / card variance per cashier, by day of week.', icon: Banknote },
      { to: 'basket-analysis',   title: 'Basket Analysis',   blurb: 'Top cross-sell product pairs by lift.',         icon: Layers3 },
      { to: 'daily-sales',       title: 'Daily Sales',       blurb: 'Sales breakdown by day.',                       icon: Calendar },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    cards: [
      { to: 'stock-position',    title: 'Stock Position at Date', blurb: 'End-of-day quantity & value rebuilt from the ledger — the inventory sheet.', icon: Package },
      { to: 'stock-variance',    title: 'Stock Variance',     blurb: 'Expected vs current per product.', icon: Boxes },
      { to: 'production-yield',  title: 'Production Yield',   blurb: 'Top-10 batch variance outliers + per-recipe trend.', icon: BarChart3 },
      { to: 'recipe-cost',       title: 'Recipe Cost',        blurb: 'History of per-recipe unit cost.',                  icon: TrendingUp },
      { to: '../inventory/production/margin-watch', title: 'Margin Watch', blurb: 'Recipes whose expected gross margin has slipped below target.', icon: TrendingDown },
      { to: 'stock-movements',     title: 'Stock Movement',     blurb: 'History of all stock changes.', icon: GitCommitHorizontal },
      { to: 'wastage',             title: 'Wastage & Spoilage', blurb: 'Manual waste + auto spoilage by product & lot.', icon: AlertTriangle },
      { to: 'perishable-turnover', title: 'Perishable Turnover', blurb: 'Days in stock against shelf life, and the share that expired.', icon: Hourglass },
    ],
  },
  {
    id: 'purchases',
    title: 'Purchases',
    cards: [
      { to: 'cost-spend',         title: 'Cost & Spend Analytics', blurb: 'Material purchases (COGS) + OpEx — charts, categories, trend.', icon: PieChart },
      { to: 'purchase-items',     title: 'Purchase Items',     blurb: 'All purchased items with prices and dates.',  icon: ShoppingCart },
      { to: 'purchase-by-date',   title: 'Purchase by Date',   blurb: 'Purchase history timeline.',                  icon: Calendar },
      { to: 'purchase-by-supplier', title: 'Purchase by Supplier', blurb: 'Supplier performance and costs.',         icon: Truck },
      { to: 'purchase-price-trends', title: 'Purchase Price Trends', blurb: 'Unit purchase price per article over time — who raised, what to renegotiate.', icon: TrendingUp },
      { to: 'supplier-payments', title: 'Supplier Payments', blurb: 'Paid out over the period + what is still owed, per supplier — debt, not commitment.', icon: Banknote },
    ],
  },
  {
    id: 'finance',
    title: 'Finance & Payments',
    cards: [
      { to: 'profit-loss',   title: 'Profit & Loss',   blurb: 'Revenue, COGS and OpEx for a period.',       icon: Coins },
      { to: 'gross-margin',  title: 'Gross Margin',    blurb: 'Revenue, COGS & margin per product (current WAC).', icon: TrendingUp },
      { to: 'operating-expenses', title: 'Operating Expenses', blurb: 'Expense ledger by category, status & trend.', icon: Receipt },
      { to: 'balance-sheet', title: 'Balance Sheet',   blurb: 'Assets vs liabilities + equity snapshot.',   icon: Scale },
      { to: 'cash-flow',     title: 'Cash Flow',       blurb: 'Indirect-method cash movement statement.',   icon: Banknote },
      { to: 'payment-by-method', title: 'Payment by Method', blurb: 'Cash, Card, QRIS split + daily trend.',  icon: CreditCard },
      { to: 'pb1',           title: 'VAT / PB1 Report',  blurb: 'Monthly PB1 collected, payable & ledger balance.', icon: FileSpreadsheet },
      { to: 'ar-aging',      title: 'AR Aging (B2B)',    blurb: 'Money outstanding by lateness — who to chase, DSO, credit exposure.', icon: CalendarClock },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    cards: [
      { to: 'staff-performance',    title: 'Staff Performance',    blurb: 'Orders, revenue and performance per staff.',                       icon: Users },
      { to: 'production-report',    title: 'Production Report',    blurb: 'Production quantities, values and costs.',                          icon: BarChart3 },
      { to: 'production-efficiency', title: 'Production Efficiency', blurb: 'Waste rate by product and daily trend.',                            icon: TrendingUp },
    ],
  },
  {
    id: 'marketing',
    title: 'Marketing',
    cards: [
      { to: '../marketing/cohort',    title: 'Cohorts',   blurb: 'Retention cohorts by first-order month.',      icon: LineChart },
      { to: '../marketing/segments',  title: 'Segments',  blurb: 'RFM customer segments & spend distribution.',   icon: Sparkles },
      { to: '../marketing/promo-roi', title: 'Promo ROI', blurb: 'Redemptions, discount cost & incremental lift.', icon: Megaphone },
      { to: '../marketing/birthday',  title: 'Birthdays', blurb: 'Upcoming customer birthdays for outreach.',      icon: Cake },
    ],
  },
  {
    id: 'logs',
    title: 'Logs & Audit',
    cards: [
      { to: 'audit',                 title: 'Audit Log',         blurb: 'System-wide audit trail.',         icon: Shield },
      { to: 'off-hours-sales',       title: 'Off-Hours Sales',   blurb: 'Payments taken outside business hours (fraud signal).', icon: Clock },
      { to: 'price-changes',         title: 'Price Changes',     blurb: 'History of product price updates.', icon: ListChecks },
      { to: 'permission-changes',    title: 'Permission Change Log', blurb: 'Role & permission modifications.',  icon: KeyRound },
    ],
  },
];

/** Toutes les tuiles, indexées par cible — résolution des récents. */
const CARDS_BY_TARGET: ReadonlyMap<string, ReportCard> = new Map(
  SECTIONS.flatMap((s) => s.cards).map((c) => [c.to, c]),
);

const TOTAL_CARDS = SECTIONS.reduce((n, s) => n + s.cards.length, 0);

/**
 * Repli de comparaison : minuscules, diacritiques retirés, espaces normalisés.
 * « Wastage & Spoilage » se trouve avec « spoilage », et « pérennité » avec
 * « perennite » — le back-office est en anglais mais les postes ne le sont pas.
 */
/** Marques combinatoires isolées par la décomposition NFD (`é` → `e` + U+0301). */
const COMBINING_MARKS = /\p{M}/gu;

function fold(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim();
}

const GRID_CLASS =
  'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * La tuile EST le lien : `cardVariants` plutôt qu'un `<Card>` enveloppé dans un
 * `<Link>`, sinon la zone cliquable ne couvre pas la boîte et l'anneau de focus
 * se dessine autour d'un conteneur vide (même parti que `KpiTile`). Le seul
 * signal au survol est le cran de surface que le thème réserve à ça — pas de
 * bleu, pas de soulignement.
 */
const TILE_CLASS = cn(
  cardVariants({ variant: 'default', padding: 'none' }),
  'flex h-full flex-col gap-1 p-3.5 shadow-none',
  'motion-safe:transition-colors hover:bg-surface-4',
  FOCUS_RING,
);

function ReportTile({
  card,
  onOpen,
}: {
  card: ReportCard;
  onOpen: (to: string) => void;
}): JSX.Element {
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      onClick={() => { onOpen(card.to); }}
      className={TILE_CLASS}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Icon className="h-4 w-4 shrink-0 text-gold" aria-hidden />
        {card.title}
      </span>
      <span className="text-xs leading-snug text-text-muted">{card.blurb}</span>
    </Link>
  );
}

export default function ReportsIndexPage() {
  const [query, setQuery] = useState('');
  const { recent, record } = useRecentReports();

  const needle = fold(query);

  const matches = useCallback(
    (c: ReportCard): boolean =>
      needle === '' || fold(`${c.title} ${c.blurb}`).includes(needle),
    [needle],
  );

  // Une famille vide disparaît : une colonne d'en-têtes sans contenu sous une
  // recherche coûte plus à lire que la liste elle-même. `total` est le compte
  // AVANT filtrage — c'est ce qui permet à l'en-tête de dire « 3 of 6 ».
  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        cards: s.cards.filter(matches),
        total: s.cards.length,
      })).filter((s) => s.cards.length > 0),
    [matches],
  );

  // Les récents suivent la même règle de filtrage que le reste, et une entrée
  // dont la route n'existe plus se résout à rien — donc s'efface.
  const recentCards = useMemo(
    () =>
      recent
        .map((to) => CARDS_BY_TARGET.get(to))
        .filter((c): c is ReportCard => c !== undefined)
        .filter(matches),
    [recent, matches],
  );

  const shownCount = sections.reduce((n, s) => n + s.cards.length, 0);
  const searching = needle !== '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Pick a report. Filters and exports are per-report."
        actions={
          <div className="w-full sm:w-72">
            <label htmlFor="reports-find" className="sr-only">
              Find a report
            </label>
            <Input
              id="reports-find"
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              placeholder="Find a report"
              maxLength={64}
              autoComplete="off"
            />
          </div>
        }
      />

      {/* Compte annoncé aux lecteurs d'écran — le filtrage est autrement muet. */}
      <p className="sr-only" role="status">
        {searching
          ? `${String(shownCount)} of ${String(TOTAL_CARDS)} reports match "${query.trim()}".`
          : `${String(TOTAL_CARDS)} reports.`}
      </p>

      {recentCards.length > 0 && (
        <section className="space-y-2.5">
          <SectionLabel as="h2" size="sm">
            <span className="inline-flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" aria-hidden />
              Recently viewed
            </span>
          </SectionLabel>
          <div className={GRID_CLASS}>
            {recentCards.map((c) => (
              <ReportTile key={`recent-${c.title}`} card={c} onOpen={record} />
            ))}
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.id} className="space-y-2.5">
          <div className="flex items-baseline gap-2">
            <SectionLabel as="h2" size="sm">{section.title}</SectionLabel>
            {/* Le compte reste HORS du `<h2>` : son nom accessible doit rester
                le seul titre de la famille. Le mot « reports » est rendu en
                sr-only pour qu'un nombre nu ne soit pas lu sans son unité. */}
            <span
              className="font-data text-xs tabular-nums text-text-muted"
              data-testid="family-count"
            >
              {searching
                ? `${String(section.cards.length)} of ${String(section.total)}`
                : String(section.total)}
              <span className="sr-only"> reports</span>
            </span>
          </div>
          <div className={GRID_CLASS}>
            {section.cards.map((c) => (
              <ReportTile key={`${section.id}-${c.title}`} card={c} onOpen={record} />
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <EmptyState
          icon={SearchX}
          title="No report matches"
          description={`Nothing here answers "${query.trim()}". Try a shorter word, or clear the search to see all ${String(TOTAL_CARDS)} reports.`}
          action={{ label: 'Clear search', onClick: () => { setQuery(''); } }}
        />
      )}
    </div>
  );
}
