// apps/backoffice/src/pages/settings/SettingsHubPage.tsx
//
// Session 14 / Phase 6.A — root /settings page. Categorized hub matching
// `setting page.jpg`. Tiles link to the implemented sub-routes; planned
// surfaces render as disabled tiles labelled "(Soon)" so the operator can
// see the full surface area without 404'ing.
//
// Permission gating stays at the route level — clicking a tile still
// routes through the matching <PermissionGate> in src/routes/index.tsx.

import { Link } from 'react-router-dom';
import {
  Building2, Clock, Receipt, Coffee, CreditCard, Heart, Boxes, Tag, Layers,
  Monitor, Briefcase, Printer, Bell, ShieldCheck, FileText, Mail, Wifi,
  Network, History, Map, Grid3x3, type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from '@breakery/ui';

interface SettingTile {
  to?:    string; // omitted = "Soon"
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
      { to: '/backoffice/settings/general',  title: 'Tax',            blurb: 'Tax rate + tax-inclusive pricing.',          icon: Receipt },
    ],
  },
  {
    id: 'sales',
    title: 'Sales & POS',
    tiles: [
      { title: 'POS Configuration', blurb: 'Quick payment amounts, opening cash, discount presets. (Soon)', icon: Coffee },
      { title: 'Payment Methods',   blurb: 'Cash, Card, QRIS, store credit. (Soon)',                        icon: CreditCard },
      { title: 'Loyalty Program',   blurb: 'Points earn rules, tiers, redemption. (Soon)',                  icon: Heart },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    tiles: [
      { title: 'Inventory Config',  blurb: 'Default thresholds, opname cadence. (Soon)', icon: Boxes },
      { title: 'Product Categories', blurb: 'Category tree + colours. (Soon)',           icon: Tag },
      { title: 'Product Types',      blurb: 'Raw / Semi-finished / Finished. (Soon)',     icon: Layers },
      { title: 'KDS Configuration',  blurb: 'Stations, routing, prep times. (Soon)',      icon: Monitor },
      { title: 'Customer Display',   blurb: 'CFD branding, idle messages. (Soon)',        icon: Monitor },
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
      { title: 'Printing',                 blurb: 'Receipt + KDS printer config. (Soon)',                   icon: Printer },
      { title: 'Notifications',            blurb: 'Email + push notification preferences. (Soon)',          icon: Bell },
      { title: 'Security & PIN',           blurb: 'PIN policies, session timeout, 2FA. (Soon)',             icon: ShieldCheck },
      { title: 'Financial / Accounting',   blurb: 'Account mappings, posting rules. (Soon)',                icon: FileText },
      { to: '/backoffice/settings/permissions', title: 'Roles & Permissions', blurb: 'View the role/permission matrix.', icon: ShieldCheck },
      { to: '/backoffice/settings/templates/email',   title: 'Email Templates',   blurb: 'Order confirmations, receipts, reset PIN.', icon: Mail },
      { to: '/backoffice/settings/templates/receipt', title: 'Receipt Templates', blurb: 'Header, footer, logo.',                       icon: Receipt },
      { title: 'Audit Log',                blurb: 'System-wide audit trail. (Soon)',                        icon: History },
      { to: '/backoffice/lan-devices',     title: 'LAN Network',  blurb: 'Devices participating in the on-site mesh.', icon: Wifi },
      { title: 'Network Devices',          blurb: 'Discovered devices on the LAN. (Soon)',                  icon: Network },
      { title: 'Settings History',         blurb: 'Audit trail of every setting change. (Soon)',            icon: History },
    ],
  },
  {
    id: 'layout',
    title: 'Layout',
    tiles: [
      { title: 'Floor Plan', blurb: 'Tables, sections, walking paths. (Soon)', icon: Map },
      { title: 'Sections',   blurb: 'Inventory section topology. (Soon)',      icon: Grid3x3 },
    ],
  },
];

export default function SettingsHubPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="text-text-secondary text-sm mt-1">
          Configure your business, POS, and system preferences.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.id} className="space-y-3">
          <SectionLabel as="h2" size="sm">{section.title}</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {section.tiles.map((t) => {
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
