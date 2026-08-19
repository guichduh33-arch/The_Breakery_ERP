// apps/backoffice/src/pages/inventory/ProductionPage.tsx
//
// Production page — station-based production entry.
//
// Layout: the shared page header, then a row of production-station tabs
// (sections kind='production') + a day navigator, then a 2-column board:
//   - left  : Production Entry card (multi-row, atomic, backdatable)
//   - right : PRODUCED / WASTE KPI tiles + the day's production log
//
// Products are strictly filtered per station via product_sections (assign them
// in the product editor → Stations tab). Submitting calls
// record_batch_production_v7; the entry's date/time may be backdated.
//
// Mise en conformité de shell 2026-08-19 — trois défauts d'un même bloc :
//
//   1. La page n'avait AUCUN `<h1>` : elle démarrait sur la rangée d'onglets et
//      ses titres commençaient en h2. Le bandeau passe par `PageHeader`, unique
//      source du `<h1>` de la vue, sous le libellé exact de la navigation
//      (« Production », `layouts/nav.ts`).
//   2. La station active et le jour vivaient en `useState` : le retour arrière
//      depuis une autre page et le partage de lien les perdaient. Ils rejoignent
//      l'URL via `useListParams`, comme l'état de liste des autres pages.
//   3. Le jour se calculait sur `new Date()` du navigateur et se rendait par
//      `toLocaleDateString('en-US')`. Le jour comptable n'est pas le jour du
//      navigateur du lecteur (ADR-019) : le défaut et la comparaison
//      « aujourd'hui » passent par `todayIsoDate()`, et plus aucun rendu ne
//      dépend du fuseau du poste.

import { useMemo, type JSX } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@breakery/ui';
import { businessDateIso, formatDate, todayIsoDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useSections } from '@/hooks/useSections.js';
import { PageHeader } from '@/components/PageHeader.js';
import { useListParams } from '@/hooks/useListParams.js';
import { ProductionEntryCard } from '@/features/inventory-production/components/ProductionEntryCard.js';
import { ProductionTodayPanel } from '@/features/inventory-production/components/ProductionTodayPanel.js';

// Le jour de la semaine se lit dans une table, pas dans `toLocaleDateString` :
// l'API du navigateur rendait le jour du fuseau DU LECTEUR, et sans locale
// explicite elle rend aussi la langue du poste. L'index vient d'une `Date`
// construite sur les composants locaux du jour métier (voir
// `dayIsoToLocalDate`), donc il désigne bien ce jour-là partout.
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const PAGE_SUBTITLE =
  'What each station produced and wasted, one day at a time. Entries may be backdated.';

/** `true` si `s` est un jour ISO `yyyy-MM-dd` qui existe réellement. */
function isDayIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const instant = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) return false;
  // Le round-trip élimine les dates qui débordent en silence (`2026-02-31`
  // devient le 3 mars). Minuit UTC tombe à 08:00 le MÊME jour à Makassar : la
  // conversion ne déplace jamais la date, elle ne fait que la valider dans le
  // fuseau métier.
  return businessDateIso(instant) === s;
}

/**
 * Le jour ISO voisin. Arithmétique de calendrier pure, menée en UTC pour ne
 * dépendre d'aucun décalage local ni d'aucun changement d'heure.
 */
function shiftDayIso(dayIso: string, delta: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Le jour ISO en `Date` locale à minuit — la forme qu'attendent les deux cartes
 * filles (fenêtre du jour du journal, amorce du `datetime-local` de la saisie).
 * Construite sur les composants LOCAUX pour que leur `startOfDay` / `getDate()`
 * retombe sur ce jour-là. L'heure est indifférente : la carte de saisie la
 * réécrit à l'heure courante à chaque changement de jour.
 */
function dayIsoToLocalDate(dayIso: string): Date {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export default function ProductionPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('inventory.read');
  const canCreate = hasPermission('inventory.production.create');

  const sections = useSections();
  const stations = useMemo(
    () => (sections.data ?? []).filter((s) => s.kind === 'production'),
    [sections.data],
  );

  // Station et jour vivent dans l'URL : un lien vers « la pâtisserie, avant-hier »
  // se colle dans une conversation, et le retour depuis une autre page restaure
  // ce qu'on regardait. `useListParams` porte les deux pièges déjà payés
  // ailleurs (patch unique, forme fonctionnelle) — voir le hook.
  const [params, patchParams] = useListParams();

  const dayParam = params.get('day');
  // Un jour absent ou malformé retombe sur AUJOURD'HUI, sans planter.
  const dayIso = dayParam !== null && isDayIso(dayParam) ? dayParam : todayIsoDate();
  const selectedDate = useMemo(() => dayIsoToLocalDate(dayIso), [dayIso]);

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="Production" subtitle={PAGE_SUBTITLE} />
        <div className="text-text-secondary">You do not have permission to view production.</div>
      </div>
    );
  }

  // La station active se DÉRIVE de l'URL — un paramètre absent ou inconnu
  // retombe sur la première station. Le `useEffect` qui posait ce défaut un
  // cycle APRÈS le rendu disparaît avec lui : l'onglet naît sélectionné, il
  // n'existe plus un instant à `aria-selected="false"`.
  const stationParam = params.get('station');
  const activeStation = stations.find((s) => s.id === stationParam) ?? stations[0] ?? null;
  const activeId = activeStation?.id ?? '';
  const isToday = dayIso === todayIsoDate();

  function selectStation(id: string): void {
    patchParams({ station: id });
  }

  // Revenir sur aujourd'hui RETIRE la clé : le défaut ne s'écrit pas dans l'URL.
  function shiftDay(delta: number): void {
    const next = shiftDayIso(dayIso, delta);
    patchParams({ day: next === todayIsoDate() ? null : next });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Production" subtitle={PAGE_SUBTITLE} />

      {/* Station tabs + day navigator */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav role="tablist" aria-label="Production stations" className="flex flex-wrap gap-2">
          {stations.map((s) => {
            const selected = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectStation(s.id)}
                data-testid={`station-tab-${s.code}`}
                className={cn(
                  'rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-widest transition-colors',
                  selected
                    ? 'border-gold bg-gold-soft text-gold'
                    : 'border-border-subtle text-text-muted hover:text-text-primary',
                )}
              >
                {s.name}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-border-subtle px-2 py-1">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            aria-label="Previous day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:text-text-primary"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-[8rem] text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-gold">
              {isToday ? 'Today' : WEEKDAY_SHORT[selectedDate.getDay()]}
            </div>
            <div className="text-xs text-text-muted" data-testid="production-selected-date">
              {formatDate(dayIso)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            aria-label="Next day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:text-text-primary"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {stations.length === 0 ? (
        <div className="rounded-lg border border-border-subtle p-8 text-center text-sm text-text-muted">
          No production stations defined.
        </div>
      ) : activeStation === null ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {canCreate ? (
              <ProductionEntryCard
                sectionId={activeStation.id}
                sectionName={activeStation.name}
                selectedDate={selectedDate}
              />
            ) : (
              <div className="rounded-lg border border-border-subtle p-8 text-center text-sm text-text-muted">
                You do not have permission to record production.
              </div>
            )}
          </div>
          <div className="lg:col-span-1">
            <ProductionTodayPanel sectionId={activeStation.id} selectedDate={selectedDate} />
          </div>
        </div>
      )}
    </div>
  );
}
