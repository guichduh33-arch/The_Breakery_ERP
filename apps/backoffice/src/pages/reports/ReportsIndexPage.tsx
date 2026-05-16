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

import { Link } from 'react-router-dom';
import {
  BarChart3, PieChart, Users, Boxes, Shield, Coins, Scale, Banknote, Layers3,
  Calendar, Clock, FileSpreadsheet, ListChecks, Receipt, ShoppingCart, Truck,
  AlertTriangle, TrendingUp, type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from '@breakery/ui';

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
      { to: 'basket-analysis',   title: 'Basket Analysis',   blurb: 'Top cross-sell product pairs by lift.',         icon: Layers3 },
      {                          title: 'Daily Sales',       blurb: 'Sales breakdown by day. (Soon)',                icon: Calendar },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    cards: [
      { to: 'stock-variance',    title: 'Stock Variance',     blurb: 'Expected vs current per product.', icon: Boxes },
      { to: 'production-yield',  title: 'Production Yield',   blurb: 'Top-10 batch variance outliers + per-recipe trend.', icon: BarChart3 },
      {                          title: 'Stock Movement',     blurb: 'History of all stock changes. (Soon)', icon: TrendingUp },
      {                          title: 'Wastage & Spoilage', blurb: 'Track items discarded due to damage or expiry. (Soon)', icon: AlertTriangle },
    ],
  },
  {
    id: 'purchases',
    title: 'Purchases',
    cards: [
      { title: 'Purchase Items',     blurb: 'All purchased items with prices and dates. (Soon)', icon: ShoppingCart },
      { title: 'Purchase by Date',   blurb: 'Purchase history timeline. (Soon)',                  icon: Calendar },
      { title: 'Purchase by Supplier', blurb: 'Supplier performance and costs. (Soon)',           icon: Truck },
    ],
  },
  {
    id: 'finance',
    title: 'Finance & Payments',
    cards: [
      { to: 'profit-loss',   title: 'Profit & Loss',   blurb: 'Revenue, COGS and OpEx for a period.',       icon: Coins },
      { to: 'balance-sheet', title: 'Balance Sheet',   blurb: 'Assets vs liabilities + equity snapshot.',   icon: Scale },
      { to: 'cash-flow',     title: 'Cash Flow',       blurb: 'Indirect-method cash movement statement.',   icon: Banknote },
      {                      title: 'Payment by Method', blurb: 'Cash, Card, QRIS, etc. (Soon)',             icon: Receipt },
      {                      title: 'VAT / Tax Report',  blurb: 'Monthly VAT collected, deductible & payable. (Soon)', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    cards: [
      { title: 'Staff Performance',    blurb: 'Orders, revenue and performance per staff. (Soon)',                       icon: Users },
      { title: 'Production Report',    blurb: 'Production quantities, values and costs. (Soon)',                          icon: BarChart3 },
      { title: 'Production Efficiency', blurb: 'Waste rate by product and daily trend. (Soon)',                            icon: TrendingUp },
    ],
  },
  {
    id: 'logs',
    title: 'Logs & Audit',
    cards: [
      { to: 'audit',                 title: 'Audit Log',         blurb: 'System-wide audit trail.',         icon: Shield },
      {                              title: 'Price Changes',     blurb: 'History of product price updates. (Soon)', icon: ListChecks },
      {                              title: 'Permission Change Log', blurb: 'Role & permission modifications. (Soon)',  icon: Shield },
    ],
  },
];

export default function ReportsIndexPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Reports &amp; Analytics</h1>
        <p className="text-text-secondary text-sm mt-1">
          Pick a report. Filters and exports are per-report.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.id} className="space-y-3">
          <SectionLabel as="h2" size="sm">{section.title}</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {section.cards.map((c) => {
              const Icon = c.icon;
              const cardInner = (
                <Card className={`h-full ${c.to !== undefined ? 'hover:bg-bg-overlay transition-colors' : 'opacity-60'}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-gold" aria-hidden />
                      {c.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-secondary">{c.blurb}</p>
                  </CardContent>
                </Card>
              );
              return c.to !== undefined ? (
                <Link
                  key={`${section.id}-${c.title}`}
                  to={c.to}
                  className="block focus:outline-none focus:ring-2 focus:ring-gold rounded-lg"
                >
                  {cardInner}
                </Link>
              ) : (
                <div
                  key={`${section.id}-${c.title}`}
                  className="block rounded-lg cursor-not-allowed"
                  aria-disabled="true"
                >
                  {cardInner}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
