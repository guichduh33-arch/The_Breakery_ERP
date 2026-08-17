// apps/backoffice/src/components/kpi/KpiTile.tsx
//
// La tuile de KPI de la direction « Instrument » — extraite du `Tile` interne
// de DashboardKpiStrip (lot B, campagne Reports 2026-08-15) pour servir aussi
// les bandes KPI des rapports. C'est le composant signature de la maquette 4c :
// label mono 10 px, valeur mono 23 px (26 px sur la tuile héro encre), et la
// place de l'icône rendue aux COMPARAISONS, qui portent l'information.
//
// Une seule tuile héro par écran (« One Ink Fill Rule ») : la première de la
// bande répond à la question qu'on pose en ouvrant la page ; une deuxième
// détruirait la hiérarchie que la première installe.

import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, SectionLabel, cardVariants, cn } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
// LE barème de coloration signée du dépôt — on n'écrit pas `text-danger` ici.
// Il vit sous features/reports/utils parce que le module reports l'a fait
// naître, mais son en-tête le pose comme unique : cinq barèmes locaux et non
// légendés y ont été fondus. Le consommer plutôt que le recopier est ce qui
// empêche un sixième.
import { VARIANCE_TONE_TEXT, VARIANCE_TONE_TEXT_INK } from '@/features/reports/utils/varianceScale.js';

export const KPI_CARD = 'flex flex-col gap-[5px] px-[15px] py-[13px] shadow-none';
export const KPI_LABEL = 'font-data text-xs font-semibold text-text-muted';
export const KPI_VALUE = 'font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary';
export const KPI_NOTE = 'font-data text-xs leading-tight text-text-muted';

export const KPI_CARD_HERO = `${KPI_CARD} border-ink bg-ink`;
export const KPI_LABEL_HERO = 'font-data text-xs font-semibold text-ink-fg-sub';
export const KPI_VALUE_HERO = 'font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums text-ink-fg';
export const KPI_NOTE_HERO = 'font-data text-xs leading-tight text-ink-fg-sub';

// Une tuile-lien reste une TUILE. Pas de bleu, pas de soulignement : le seul
// signal au survol est le cran de surface prévu pour ça par le thème (survol /
// pressé), et son équivalent sur encre pour la tuile héro. Le focus passe par
// l'anneau maison — l'anneau par défaut du navigateur est sous le seuil 3:1.
const TILE_LINK      = `${FOCUS_RING} motion-safe:transition-colors hover:bg-surface-4`;
const TILE_LINK_HERO = `${FOCUS_RING} motion-safe:transition-colors hover:bg-ink-hover`;

export interface KpiTileProps {
  label: string;
  value: string;
  /**
   * Montant EXACT posé en infobulle quand `value` est en notation compacte
   * (« Rp 8,42 jt ») : un compact tronque, et sans lui le chiffre précis
   * n'est lisible nulle part sur la page.
   */
  valueTitle?: string;
  /** Tuile encre — exactement une par bande. */
  hero?: boolean;
  /**
   * Ton de la VALEUR. Une perte, un manquant de caisse, une trésorerie à
   * découvert s'affichaient jusqu'ici exactement comme leur contraire : la
   * tuile n'exposait aucune prop de ton, donc une valeur signée était
   * structurellement muette.
   *
   * La couleur est le TROISIÈME signal, jamais le seul (WCAG 1.4.1) : le signe
   * vient du formatteur (« -Rp … ») et le mot du slot `children`
   * (« shortfall », « loss », « overdrawn »). Retirer la couleur ne doit
   * effacer aucune information.
   *
   * Le ton se résout contre `hero` : sur l'encre, `--danger` tombe à 2,77:1 et
   * c'est `--ink-danger` qui porte (The Ink Semantics Rule). L'appelant n'a
   * donc rien à savoir du fond — il dit le SENS, la tuile choisit l'encre.
   */
  tone?: 'neutral' | 'danger';
  /**
   * Destination de drill-down, déjà filtrée par permission par l'appelant.
   * Absente, la tuile est inerte — un `<div>`, pas un lien mort.
   */
  to?: string;
  /** Complément `sr-only` annonçant la destination quand `to` est posé. */
  srHint?: string;
  /**
   * La mesure est ABSENTE. Les formatteurs du dashboard rendent alors un tiret
   * cadratin, que la tuile posait sans aucune sémantique : le nom accessible se
   * réduisait à « Gross margin — », c'est-à-dire à rien.
   *
   * La prop est pilotée par l'APPELANT — jamais par un reniflage de la chaîne
   * `'—'` : le tiret est un caractère d'affichage, pas un état, et un libellé
   * légitime qui en contiendrait un basculerait à tort.
   *
   * Forme imposée : la valeur passe `aria-hidden` et un `<span class="sr-only">`
   * porte le texte. PAS un `aria-label` — un `<span>` sans rôle est exposé en
   * `role="generic"`, sur lequel ARIA 1.2 INTERDIT `aria-label` ; et un
   * `aria-label` écraserait le chiffre les jours où il existe.
   */
  unavailable?: boolean;
  /** Texte lu à la place de la valeur absente. Défaut : `no data`. */
  unavailableLabel?: string;
  testId?: string;
  /** Ligne(s) sous la valeur : `<Delta>` ×2, ou une note neutre. */
  children?: ReactNode;
}

export function KpiTile({
  label, value, valueTitle, hero = false, tone = 'neutral', to, srHint, testId, children,
  unavailable = false, unavailableLabel = 'no data',
}: KpiTileProps): JSX.Element {
  // `neutral` laisse la couleur de la constante de valeur (text-text-primary /
  // text-ink-fg) : le barème n'écrase la teinte que lorsqu'il a quelque chose
  // à dire. `cn` s'appuie sur tailwind-merge, la dernière classe de couleur
  // gagne — sans lui les deux `text-*` coexisteraient et l'ordre du CSS
  // trancherait, pas l'intention.
  const toneClass = tone === 'danger'
    ? (hero ? VARIANCE_TONE_TEXT_INK.bad : VARIANCE_TONE_TEXT.bad)
    : undefined;

  const body = (
    <>
      <SectionLabel as="h3" className={hero ? KPI_LABEL_HERO : KPI_LABEL}>{label}</SectionLabel>
      <span
        className={cn(hero ? KPI_VALUE_HERO : KPI_VALUE, toneClass)}
        title={valueTitle}
        {...(unavailable ? { 'aria-hidden': true } : {})}
      >
        {value}
      </span>
      {unavailable && <span className="sr-only">{unavailableLabel}</span>}
      <div className="flex min-h-[16px] flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {children}
      </div>
    </>
  );

  if (to !== undefined) {
    // `cardVariants` plutôt qu'un `<Card>` enveloppé dans un `<Link>` : le lien
    // DOIT être la boîte elle-même, sinon la zone cliquable ne couvre pas la
    // tuile et le focus ne se dessine pas autour d'elle. La destination est
    // annoncée par un complément en `sr-only` et non par un `aria-label`, qui
    // écraserait le contenu — le chiffre disparaîtrait de la lecture vocale.
    return (
      <Link
        to={to}
        data-testid={testId}
        className={cn(
          cardVariants({ variant: 'default', padding: 'none' }),
          hero ? KPI_CARD_HERO : KPI_CARD,
          hero ? TILE_LINK_HERO : TILE_LINK,
        )}
      >
        {body}
        {srHint !== undefined && <span className="sr-only">{srHint}</span>}
      </Link>
    );
  }

  return (
    <Card
      variant="default"
      padding="none"
      className={hero ? KPI_CARD_HERO : KPI_CARD}
      data-testid={testId}
    >
      {body}
    </Card>
  );
}
