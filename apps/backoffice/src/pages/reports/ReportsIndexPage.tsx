// apps/backoffice/src/pages/reports/ReportsIndexPage.tsx
//
// Hub page listing the 5 reports currently available. Each card links to
// the matching child route. Permission-gated (we still show cards for
// reports the user cannot access — clicking redirects via PermissionGate).

import { Link } from 'react-router-dom';
import { BarChart3, PieChart, Users, Boxes, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';

interface ReportCard {
  to:       string;
  title:    string;
  blurb:    string;
  icon:     typeof BarChart3;
}

const REPORTS: ReportCard[] = [
  { to: 'sales-by-hour',     title: 'Sales by Hour',     blurb: 'Hourly revenue distribution.',       icon: BarChart3 },
  { to: 'sales-by-category', title: 'Sales by Category', blurb: 'Revenue + qty per product category.', icon: PieChart },
  { to: 'sales-by-staff',    title: 'Sales by Staff',    blurb: 'Total / order count / avg basket.',  icon: Users },
  { to: 'stock-variance',    title: 'Stock Variance',    blurb: 'Expected vs current per product.',    icon: Boxes },
  { to: 'audit',             title: 'Audit Log',         blurb: 'System-wide audit trail.',            icon: Shield },
];

export default function ReportsIndexPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-serif">Reports</h1>
      <p className="text-sm text-text-secondary">
        Pick a report. Filters and exports are per-report.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link
              key={r.to}
              to={r.to}
              className="block focus:outline-none focus:ring-2 focus:ring-gold rounded-lg"
            >
              <Card className="hover:bg-bg-overlay transition-colors h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 text-gold" aria-hidden />
                    {r.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-text-secondary">{r.blurb}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
