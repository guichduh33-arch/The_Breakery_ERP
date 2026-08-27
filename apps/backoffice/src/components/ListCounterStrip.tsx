// apps/backoffice/src/components/ListCounterStrip.tsx
//
// Archétype LIST — la bande de compteurs qui SONT les filtres.
//
// Ce n'est pas une rangée de KPI : un KPI se lit, un compteur d'archétype List
// se clique. La distinction porte tout le composant — un compteur sans
// `onSelect` reste rendu mais n'est pas un bouton, et n'annonce donc rien de
// cliquable à un lecteur d'écran.
//
// La bande est une seule carte segmentée par des filets, pas N cartes espacées :
// les compteurs se comparent entre eux, et l'espacement les aurait détachés.
// Le compteur actif porte un liseré or à gauche plutôt qu'un fond plein —
// l'or est une encre de sens dans ce thème, il ne remplit rien.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';

export type CounterTone = 'neutral' | 'danger' | 'warning' | 'success';

export interface ListCounter {
  /** Clé stable — sert d'identifiant de filtre. */
  id: string;
  label: string;
  value: number | string;
  /** Couleur de la valeur. Le ton dit la gravité, jamais la catégorie. */
  tone?: CounterTone;
  /**
   * Compteur d'ARRIÈRE-PLAN : la valeur se grise. Ce n'est pas un ton — il ne
   * dit aucune gravité — mais l'inverse : « ces lignes existent, elles ne sont
   * pas ce que tu es venu regarder » (le catalogue désactivé, par exemple).
   * Prend le pas sur `tone` : une valeur ne peut pas être à la fois en retrait
   * et alarmante.
   */
  muted?: boolean;
  /**
   * Absent = compteur informatif, rendu mais non cliquable. Un compteur qui ne
   * filtre rien ne doit pas se présenter comme un contrôle.
   */
  onSelect?: () => void;
  /** Infobulle — sert à porter la définition d'un compte ambigu. */
  title?: string;
}

const TONE: Record<CounterTone, string> = {
  neutral: 'text-text-primary',
  danger:  'text-danger',
  warning: 'text-warning',
  success: 'text-success',
};

const LABEL = 'font-data text-xs uppercase tracking-widest text-text-muted';
// Palier « Valeur KPI ordinaire » de DESIGN.md (mono, 600, 23 px, -0.02em,
// tabulaire) — même écriture que DashboardKpiStrip ; la couleur vient du ton.
const VALUE = 'font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums';

export interface ListCounterStripProps {
  counters: readonly ListCounter[];
  /** Id du compteur actif — celui dont le filtre s'applique. */
  activeId?: string | null;
  className?: string;
  /** Étiquette du groupe pour les lecteurs d'écran. */
  ariaLabel?: string;
  'data-testid'?: string;
}

export function ListCounterStrip({
  counters,
  activeId = null,
  className,
  ariaLabel = 'Filters',
  'data-testid': testId,
}: ListCounterStripProps): JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        // `border-strong` et non `border-subtle` : la bande est un GROUPE DE
        // CONTRÔLES, pas une carte. Sa limite extérieure valait 1,20:1 contre le
        // papier (critique du 2026-08-21), sous les 3:1 de WCAG 1.4.11 — le
        // groupe cliquable n'avait pas de bord visible. `border-strong` est le
        // token de limite de contrôle sur le papier : 3,33:1. Le filet INTERNE
        // reste `border-muted` : il sépare deux cellules du même groupe, il ne
        // délimite pas le groupe.
        // `overflow-x-auto` et non `overflow-hidden` : la bande est une rangée de
        // FILTRES, et `hidden` en découpait silencieusement la queue dès qu'une
        // fenêtre étroite la faisait déborder — les derniers compteurs
        // devenaient inatteignables sans qu'aucun signe ne le dise. `auto` ne
        // pose sa barre que lorsqu'il y a réellement à faire défiler ; à largeur
        // suffisante le rendu ne bouge pas, et l'arrondi continue de découper les
        // extrémités puisque la boîte reste un conteneur de défilement.
        'flex items-stretch overflow-x-auto rounded-md border border-border-strong bg-bg-elevated',
        className,
      )}
    >
      {counters.map((counter) => {
        const isActive = counter.id === activeId;
        const tone = counter.muted === true
          ? 'text-text-muted'
          : TONE[counter.tone ?? 'neutral'];
        const shell = cn(
          'flex flex-col gap-0.5 px-[18px] py-[11px] text-left',
          'border-r border-border-muted last:border-r-0',
          isActive && 'shadow-[inset_2px_0_0_var(--gold-base)]',
        );

        if (counter.onSelect === undefined) {
          return (
            <div
              key={counter.id}
              className={shell}
              data-testid={`counter-${counter.id}`}
              {...(counter.title === undefined ? {} : { title: counter.title })}
            >
              <span className={LABEL}>{counter.label}</span>
              <span className={cn(VALUE, tone)}>{counter.value}</span>
            </div>
          );
        }

        return (
          <button
            key={counter.id}
            type="button"
            onClick={counter.onSelect}
            aria-pressed={isActive}
            data-testid={`counter-${counter.id}`}
            {...(counter.title === undefined ? {} : { title: counter.title })}
            className={cn(
              shell,
              'transition-colors duration-fast ease-motion-out',
              !isActive && 'hover:bg-surface-4',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
            )}
          >
            <span className={LABEL}>{counter.label}</span>
            <span className={cn(VALUE, tone)}>{counter.value}</span>
          </button>
        );
      })}
    </div>
  );
}
