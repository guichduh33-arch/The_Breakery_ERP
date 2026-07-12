// apps/backoffice/src/pages/settings/SettingsHubPage.tsx
//
// Session 14 / Phase 6.A — root /settings page. Categorized hub matching
// `setting page.jpg`. Tiles link to the implemented sub-routes.
//
// S73 Lot 3 (Task 11) — zero dead-end tiles: every tile is either linked to
// a real route, or explicitly `planned: true` (a surface actively deferred
// to a dedicated future session). Tiles pointing at a permission-gated route
// carry a `permission` so operators who can't open the route don't see the
// tile at all.
//
// S75 Task 3 — Floor Plan shipped (real CRUD route below); only KDS
// Configuration remains `planned: true`.
//
// Route-level permission gating still applies too — clicking a visible tile
// routes through the matching <PermissionGate> in src/routes/index.tsx.

import { Link } from 'react-router-dom';
import {
  Building2, Clock, Receipt, Coffee, CreditCard, Heart, Boxes, Tag, Layers,
  Monitor, Briefcase, Printer, Bell, ShieldCheck, FileText, Mail, Wifi,
  History, Map, Grid3x3, type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from '@breakery/ui';
import type { PermissionCode } from '@breakery/supabase';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';

interface SettingTile {
  to?:         string;         // omitted + planned=false → should no longer exist
  planned?:    boolean;        // true = surface actively deferred to a dedicated session
  permission?: PermissionCode; // hides the tile if the user lacks the route's permission
  title:  string;
  blurb:  string;
  icon:   LucideIcon;
}

interface SettingSection {
  id:     string;
  title:  string;
  tiles:  SettingTile[];
}

const SECTIONS: SettingSection[] = [
  {
    id: 'general',
    title: 'General',
    tiles: [
      { to: '/backoffice/settings/general',  title: 'Company',        blurb: 'Business identity, currency, tax, address.', icon: Building2 },
      { to: '/backoffice/settings/holidays', title: 'Business Hours', blurb: 'Holidays + recurring closures.',             icon: Clock },
    ],
  },
  {
    id: 'sales',
    title: 'Sales & POS',
    tiles: [
      { to: '/backoffice/settings/pos', title: 'POS Configuration', blurb: 'Quick payment amounts, opening cash, discount presets.', icon: Coffee },
      { to: '/backoffice/settings/payment-methods', title: 'Payment Methods', blurb: 'Enable or disable POS payment methods.', icon: CreditCard },
      { to: '/backoffice/loyalty', title: 'Loyalty Program', blurb: 'Points earn rules, tiers, redemption.', icon: Heart },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    tiles: [
      { to: '/backoffice/settings/inventory', title: 'Inventory Config', blurb: 'Default thresholds, opname cadence.', icon: Boxes },
      { to: '/backoffice/categories', title: 'Product Categories', blurb: 'Category tree + colours.', icon: Tag },
      { to: '/backoffice/products',   title: 'Product Types',      blurb: 'Raw / Semi-finished / Finished — set per product.', icon: Layers },
      { planned: true, title: 'KDS Configuration', blurb: 'Stations, routing, prep times. (Planned — dedicated session)', icon: Monitor },
      { to: '/backoffice/settings/customer-display', title: 'Customer Display', blurb: 'Idle footer + brand slogan (all displays).', icon: Monitor },
    ],
  },
  {
    id: 'commerce',
    title: 'Commerce',
    tiles: [
      { to: '/backoffice/b2b/settings', title: 'B2B Settings', blurb: 'Wholesale pricing, payment terms, credit limits.', icon: Briefcase },
    ],
  },
  {
    id: 'system',
    title: 'System',
    tiles: [
      { to: '/backoffice/settings/printing', title: 'Printing', blurb: 'Auto-print + drawer automation (org-wide).', icon: Printer },
      { to: '/backoffice/settings/notifications', title: 'Notifications', blurb: 'System notification templates.', icon: Bell },
      { to: '/backoffice/settings/security', title: 'Security & PIN', blurb: 'Per-role session timeout.', icon: ShieldCheck, permission: 'settings.security.manage' },
      { to: '/backoffice/settings/accounting', title: 'Financial / Accounting', blurb: 'Fiscal periods, year-end close.', icon: FileText, permission: 'accounting.period.close' },
      { to: '/backoffice/settings/permissions', title: 'Roles & Permissions', blurb: 'View the role/permission matrix.', icon: ShieldCheck },
      { to: '/backoffice/settings/templates/email',   title: 'Email Templates',   blurb: 'Order confirmations, receipts, reset PIN.', icon: Mail },
      { to: '/backoffice/settings/templates/receipt', title: 'Receipt Templates', blurb: 'Header, footer, logo.',                       icon: Receipt },
      { to: '/backoffice/reports/audit', title: 'Audit Log', blurb: 'System-wide audit trail.', icon: History },
      { to: '/backoffice/lan-devices', title: 'Network Devices (LAN)', blurb: 'Devices participating in the on-site mesh.', icon: Wifi },
      { to: '/backoffice/reports/audit?action=setting.update', title: 'Settings History', blurb: 'Audit trail of every setting change.', icon: History },
      { to: '/backoffice/settings/expense-thresholds', title: 'Expense Thresholds', blurb: 'Approval thresholds + SOD.', icon: FileText, permission: 'expenses.thresholds.read' },
    ],
  },
  {
    id: 'layout',
    title: 'Layout',
    tiles: [
      { to: '/backoffice/settings/floor-plan', permission: 'tables.update', title: 'Floor Plan', blurb: 'Tables + room sections (POS floor plan).', icon: Map },
      { to: '/backoffice/inventory/sections', title: 'Sections', blurb: 'Inventory section topology.', icon: Grid3x3 },
    ],
  },
];

export default function SettingsHubPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        subtitle="Configure your business, POS, and system preferences."
      />

      {SECTIONS.map((section) => (
        <section key={section.id} className="space-y-3">
          <SectionLabel as="h2" size="sm">{section.title}</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {section.tiles.map((t) => {
              if (t.permission !== undefined && !hasPermission(t.permission)) return null;
              const Icon = t.icon;
              const cardInner = (
                <Card className={`h-full ${t.to !== undefined ? 'hover:bg-bg-overlay transition-colors' : 'opacity-60'}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-gold" aria-hidden />
                      {t.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-secondary">{t.blurb}</p>
                  </CardContent>
                </Card>
              );
              return t.to !== undefined ? (
                <Link
                  key={`${section.id}-${t.title}`}
                  to={t.to}
                  className="block focus:outline-none focus:ring-2 focus:ring-gold rounded-lg"
                >
                  {cardInner}
                </Link>
              ) : (
                <div
                  key={`${section.id}-${t.title}`}
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
