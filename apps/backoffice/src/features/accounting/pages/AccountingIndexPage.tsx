// apps/backoffice/src/features/accounting/pages/AccountingIndexPage.tsx
// Session 26b / Wave 6 — Accounting cockpit hub : 4 tiles.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ClipboardList, LineChart, Scale } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import type { PermissionCode } from '@breakery/supabase';

interface Tile {
  to:          string;
  label:       string;
  description: string;
  icon:        typeof BookOpen;
  permission:  PermissionCode;
}

const TILES: Tile[] = [
  {
    to: '/backoffice/accounting/chart-of-accounts',
    label: 'Chart of Accounts',
    description: 'Browse the full COA, toggle account active state.',
    icon: BookOpen,
    permission: 'accounting.coa.read',
  },
  {
    to: '/backoffice/accounting/journal-entries',
    label: 'Journal Entries',
    description: 'Browse all JE history + post manual OD entries.',
    icon: ClipboardList,
    permission: 'accounting.gl.read',
  },
  {
    to: '/backoffice/accounting/general-ledger',
    label: 'General Ledger',
    description: 'Per-account drilldown with running balance.',
    icon: LineChart,
    permission: 'accounting.gl.read',
  },
  {
    to: '/backoffice/accounting/trial-balance',
    label: 'Trial Balance',
    description: 'All accounts with sum DR/CR + balanced check.',
    icon: Scale,
    permission: 'accounting.tb.read',
  },
];

export default function AccountingIndexPage(): JSX.Element {
  const hasPerm = useAuthStore((s) => s.hasPermission);
  const visible = TILES.filter((t) => hasPerm(t.permission));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-text-primary">Accounting</h1>
        <p className="text-sm text-text-secondary italic">
          Comptable cockpit — Chart of Accounts, Journal Entries, General Ledger, Trial Balance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" data-testid="accounting-index-tiles">
        {visible.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.to}
              to={tile.to}
              className="rounded-lg border border-border-subtle bg-bg-elevated p-4 hover:border-border-strong transition-colors"
              data-testid={`accounting-tile-${tile.permission}`}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-text-secondary" aria-hidden />
                <h2 className="font-semibold text-text-primary">{tile.label}</h2>
              </div>
              <p className="mt-2 text-sm text-text-secondary">{tile.description}</p>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-text-secondary">
          You don&apos;t have permission to view any accounting cockpit area.
        </p>
      )}
    </div>
  );
}
