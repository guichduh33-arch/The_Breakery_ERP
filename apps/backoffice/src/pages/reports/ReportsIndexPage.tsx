// apps/backoffice/src/pages/reports/ReportsIndexPage.tsx
//
// Session 14 / Phase 6.A — categorized hub matching the "Reports & Analytics"
// screenshot family (`report.jpg`, `report finance.jpg`, `inventory report.jpg`,
// `operations report.jpg`, `purshase report.jpg`, `log report.jpg`).
//
// Cards link to the existing report routes; reports we have not yet built are
// rendered as disabled tiles labelled "Soon" so the user can SEE the planned
// surface area without being able to navigate to a 404. Permission gating
// stays at the route level — clicking through still routes through the
// PermissionGate.
//
// Audit UX/UI 2026-08-13, lot 5 — trente tuiles réparties sur sept sections se
// balayaient à l'œil, section par section. Deux ajouts pour ramener le hub à
// une lecture de quatre-vingt-dix secondes :
//   · un champ de recherche qui filtre titre ET blurb (casse et accents
//     indifférents) ; une section dont plus aucune tuile ne correspond
//     disparaît, et un cul-de-sac se dit avec un état vide, pas avec du blanc ;
//   · une bande « Recently viewed » en tête, alimentée au clic sur une tuile et
//     persistée par poste (`bo:reports:recent`).
// Les tuiles ne portent PAS de valeur : le hub-à-valeurs de la direction est
// Settings, pas Reports.

import { useCallback, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, PieChart, Users, Boxes, Shield, Coins, Scale, Banknote, Layers3,
  Calendar, Clock, FileSpreadsheet, ListChecks, Receipt, ShoppingCart, Truck,
  AlertTriangle, TrendingUp, GitCommitHorizontal,
  LineChart, Sparkles, Megaphone, Cake, History, SearchX, type LucideIcon,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, EmptyState, Input, SectionLabel,
} from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { useRecentReports } from './recentReports.js';

interface ReportCard {
  to?:    string;          // omitted when the report isn't built yet
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
      { to: 'sales-by-staff',    title: 'Sales by Staff',    blurb: 'Total / order count / avg basket per staff.',   icon: Users },
      { to: 'cashier-variance',  title: 'Cashier Variance',  blurb: 'Cash / QRIS / card variance per cashier, by day of week.', icon: Banknote },
      { to: 'basket-analysis',   title: 'Basket Analysis',   blurb: 'Top cross-sell product pairs by lift.',         icon: Layers3 },
      { to: 'daily-sales',       title: 'Daily Sales',       blurb: 'Sales breakdown by day.',                       icon: Calendar },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    cards: [
      { to: 'stock-variance',    title: 'Stock Variance',     blurb: 'Expected vs current per product.', icon: Boxes },
      { to: 'production-yield',  title: 'Production Yield',   blurb: 'Top-10 batch variance outliers + per-recipe trend.', icon: BarChart3 },
      { to: 'recipe-cost',       title: 'Recipe Cost',        blurb: 'History of per-recipe unit cost.',                  icon: TrendingUp },
      { to: '../inventory/production/margin-watch', title: 'Margin Watch', blurb: 'Recipes whose expected gross margin has slipped below target.', icon: AlertTriangle },
      { to: 'stock-movements',     title: 'Stock Movement',     blurb: 'History of all stock changes.', icon: GitCommitHorizontal },
      { to: 'wastage',             title: 'Wastage & Spoilage', blurb: 'Manual waste + auto spoilage by product & lot.', icon: AlertTriangle },
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
      { to: 'payment-by-method', title: 'Payment by Method', blurb: 'Cash, Card, QRIS split + daily trend.',  icon: Receipt },
      { to: 'pb1',           title: 'VAT / PB1 Report',  blurb: 'Monthly PB1 collected, payable & ledger balance.', icon: FileSpreadsheet },
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
      { to: 'permission-changes',    title: 'Permission Change Log', blurb: 'Role & permission modifications.',  icon: Shield },
    ],
  },
];

/** Toutes les tuiles construites, indexées par cible — résolution des récents. */
const CARDS_BY_TARGET: ReadonlyMap<string, ReportCard> = new Map(
  SECTIONS.flatMap((s) => s.cards)
    .filter((c): c is ReportCard & { to: string } => c.to !== undefined)
    .map((c) => [c.to, c]),
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
  'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

function ReportTile({
  card,
  onOpen,
}: {
  card: ReportCard;
  onOpen: (to: string) => void;
}): JSX.Element {
  const Icon = card.icon;
  const inner = (
    <Card
      className={`h-full ${card.to !== undefined ? 'hover:bg-bg-overlay transition-colors' : 'opacity-60'}`}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-gold" aria-hidden />
          {card.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-text-secondary">{card.blurb}</p>
      </CardContent>
    </Card>
  );

  if (card.to === undefined) {
    return (
      <div className="block rounded-lg cursor-not-allowed" aria-disabled="true">
        {inner}
      </div>
    );
  }

  const to = card.to;
  return (
    <Link
      to={to}
      onClick={() => { onOpen(to); }}
      className="block focus:outline-none focus:ring-2 focus:ring-gold rounded-lg"
    >
      {inner}
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

  // Une section vide disparaît : sept en-têtes sans contenu sous une recherche
  // coûtent plus à lire que la liste elle-même.
  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({ ...s, cards: s.cards.filter(matches) })).filter(
        (s) => s.cards.length > 0,
      ),
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
    <div className="space-y-8">
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
        <section className="space-y-3">
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
        <section key={section.id} className="space-y-3">
          <SectionLabel as="h2" size="sm">{section.title}</SectionLabel>
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
