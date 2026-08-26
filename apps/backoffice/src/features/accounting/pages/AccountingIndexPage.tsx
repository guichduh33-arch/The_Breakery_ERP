// apps/backoffice/src/features/accounting/pages/AccountingIndexPage.tsx
// Session 26b / Wave 6 — Accounting cockpit hub : 4 tiles.
//
// Critique du 2026-08-26 — le module comptable « lit comme un produit plus
// ancien ». Trois écarts, corrigés ici :
//
//  1. LE SOUS-TITRE était du français en italique (« Comptable cockpit »).
//     L'interface parle anglais (CLAUDE.md), et l'italique n'est pas un des
//     rôles typographiques déclarés par DESIGN.md — il n'existait nulle part
//     ailleurs dans le back-office.
//  2. LA CASSE. Les libellés étaient en Title Case là où la barre latérale
//     écrit déjà « Chart of accounts », « Journal entries », « General ledger »,
//     « Trial balance » (`layouts/nav.ts`) et où DESIGN.md § Boutons tranche :
//     « casse de phrase — c'est ce que le back-office emploie ». Les quatre
//     titres de page du module suivent, faute de quoi la tuile et l'écran
//     qu'elle ouvre ne se nommeraient plus pareil.
//  3. LES TUILES ÉTAIENT UN MENU. L'archétype Hub de DESIGN.md veut que chaque
//     tuile porte sa VALEUR courante — c'est ce que fait déjà le hub Réglages.
//     Ici chaque valeur sort d'un hook DÉJÀ écrit, et chacune est demandée avec
//     la clé de requête que la page cible utilisera : le hub n'ajoute pas un
//     aller-retour, il le déplace d'un cran en amont et le clic suivant lit le
//     cache. La période par défaut du journal et de la balance est celle de
//     leurs écrans respectifs (mois courant), pour cette raison exacte.
//
// La valeur vit dans un composant PAR tuile, et non dans un `summaryLineFor`
// central comme aux Réglages : les hooks sont gatés par permission côté RLS, et
// `visible` a déjà retiré les tuiles que le profil ne détient pas. Monter le
// composant sous la tuile suffit donc à ne jamais émettre une requête que le
// serveur refuserait — sans toucher à la signature des quatre hooks.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ClipboardList, LineChart, Scale } from 'lucide-react';
import { Skeleton } from '@breakery/ui';
import { monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { PermissionCode } from '@breakery/supabase';
import { useChartOfAccounts } from '../hooks/useChartOfAccounts.js';
import { useJournalEntries } from '../hooks/useJournalEntries.js';
import { useTrialBalance } from '../hooks/useTrialBalance.js';

interface Tile {
  to:          string;
  label:       string;
  description: string;
  icon:        typeof BookOpen;
  permission:  PermissionCode;
  /** Valeur courante de la tuile. Absente = la tuile n'en a pas de source. */
  Value?:      () => JSX.Element;
}

// La période d'ouverture du hub est celle de `JournalEntriesPage` et de
// `TrialBalancePage` — c'est ce qui fait que le clic suivant lit le cache au
// lieu de repayer l'aller-retour. Elle était RECOPIÉE ici, et les copies
// partageaient le même défaut : `toISOString()` rend de l'UTC, donc entre minuit
// et 08 h WITA la borne haute était la veille et la borne basse pouvait tomber
// au mois précédent. Un seul helper désormais (`@breakery/utils`), qui sort du
// fuseau métier — les copies ne peuvent plus diverger.

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});
const num = (n: number): string => n.toLocaleString('id-ID');

/** Coquille commune : squelette au chargement, tiret quand la donnée manque.
 *  Un hub ne rend jamais une erreur en pleine page — le lien reste cliquable et
 *  l'écran cible dira ce qui ne va pas. */
function TileValue({
  isLoading, text,
}: { isLoading: boolean; text: string | null }): JSX.Element {
  if (isLoading) return <Skeleton width="9rem" />;
  return (
    <p className="font-data text-sm tabular-nums text-text-primary">{text ?? '—'}</p>
  );
}

function CoaValue(): JSX.Element {
  const q = useChartOfAccounts();
  const rows = q.data;
  const text = rows === undefined
    ? null
    : `${num(rows.filter((a) => a.is_active).length)} active of ${num(rows.length)} ${rows.length === 1 ? 'account' : 'accounts'}`;
  return <TileValue isLoading={q.isLoading} text={q.isError ? null : text} />;
}

function JournalValue(): JSX.Element {
  const q = useJournalEntries({ startDate: monthStartIsoDate(), endDate: todayIsoDate() });
  const first = q.data?.pages[0];
  const latest = first?.rows[0];
  // `total` n'est demandé que sur la première page — c'est le compte EXACT des
  // écritures du mois, pas le nombre de lignes chargées.
  const text = first === undefined
    ? null
    : first.total === 0 || latest === undefined
      ? 'No entry this month'
      : `${num(first.total ?? first.rows.length)} this month · last ${latest.entry_number}`;
  return <TileValue isLoading={q.isLoading} text={q.isError ? null : text} />;
}

function TrialBalanceValue(): JSX.Element {
  const q = useTrialBalance(monthStartIsoDate(), todayIsoDate());
  const d = q.data;
  const text = d === undefined
    ? null
    : d.balanced
      ? `Balanced · ${num(d.lines.length)} ${d.lines.length === 1 ? 'account' : 'accounts'}`
      : `Out of balance by ${idr.format(Math.abs(d.delta))}`;
  return <TileValue isLoading={q.isLoading} text={q.isError ? null : text} />;
}

const TILES: Tile[] = [
  {
    to: '/backoffice/accounting/chart-of-accounts',
    label: 'Chart of accounts',
    description: 'Browse the full COA, toggle account active state.',
    icon: BookOpen,
    permission: 'accounting.coa.read',
    Value: CoaValue,
  },
  {
    to: '/backoffice/accounting/journal-entries',
    label: 'Journal entries',
    description: 'Browse all JE history + post manual journal entries.',
    icon: ClipboardList,
    permission: 'accounting.gl.read',
    Value: JournalValue,
  },
  {
    // Pas de valeur : le grand livre se lit PAR COMPTE, et aucune requête
    // existante n'en résume l'état sans qu'un compte soit choisi. Une valeur
    // inventée ici (« N comptes mouvementés ») demanderait une RPC neuve — hors
    // mandat. La tuile garde donc son blurb, ce qui est la forme honnête.
    to: '/backoffice/accounting/general-ledger',
    label: 'General ledger',
    description: 'Per-account drilldown with running balance.',
    icon: LineChart,
    permission: 'accounting.gl.read',
  },
  {
    to: '/backoffice/accounting/trial-balance',
    label: 'Trial balance',
    description: 'All accounts with sum DR/CR + balanced check.',
    icon: Scale,
    permission: 'accounting.tb.read',
    Value: TrialBalanceValue,
  },
];

export default function AccountingIndexPage(): JSX.Element {
  const hasPerm = useAuthStore((s) => s.hasPermission);
  const visible = TILES.filter((t) => hasPerm(t.permission));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        subtitle="Chart of accounts, journal entries, general ledger and trial balance."
      />

      <div className="grid gap-3 sm:grid-cols-2" data-testid="accounting-index-tiles">
        {visible.map((tile) => {
          const Icon = tile.icon;
          const Value = tile.Value;
          return (
            <Link
              key={tile.to}
              to={tile.to}
              // `FOCUS_RING` : ces quatre tuiles sont les portes du module, et
              // leur seul retour était le survol SOURIS — au clavier, on
              // traversait le hub sans savoir où l'on était (WCAG 2.4.11).
              className={`rounded-lg border border-border-subtle bg-bg-elevated p-4 hover:border-border-strong transition-colors ${FOCUS_RING}`}
              data-testid={`accounting-tile-${tile.permission}`}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-text-secondary" aria-hidden />
                <h2 className="font-semibold text-text-primary">{tile.label}</h2>
              </div>
              {Value !== undefined
                ? <div className="mt-2"><Value /></div>
                : <p className="mt-2 text-sm text-text-secondary">{tile.description}</p>}
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
