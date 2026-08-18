// packages/ui/src/components/SectionLabel.tsx
//
// SectionLabel — Luxe Bakery signature section/group label.
//
// Session 14 D5 — "Labels MAJUSCULES tracking large = signature". Every
// reference screenshot uses this pattern for section/group labels:
//   ACTIVE ORDER · OPERATIONS · TODAY'S REVENUE · TOP PRODUCTS TODAY · ...
//
// Convention: text-xs/sm, font-bold, uppercase, tracking-widest (0.12em ; le
// thème back-office le pousse à 0.14em, cf. colors.css).
// Color: text-text-muted (subdued) by default — callers override for gold
// emphasis. Replaces the ad-hoc `<span className="uppercase tracking-widest
// ...">` scattered throughout the existing pages.
//
// Polymorphic via the `as` prop so callers pick the right semantic element:
//   <SectionLabel as="h2">  - sidebar / nav group
//   <SectionLabel as="h3">  - KPI tile label
//   <SectionLabel as="div"> - inline label (default)

import { createElement, type HTMLAttributes, type JSX } from 'react';
import { cn } from '../lib/cn.js';

export type SectionLabelTag = 'div' | 'h2' | 'h3' | 'span' | 'p';

export interface SectionLabelProps extends HTMLAttributes<HTMLElement> {
  /** Semantic tag. Default 'div'. Pick h2/h3 for proper landmark hierarchy. */
  as?: SectionLabelTag;
  /**
   * Size variant. Les deux valeurs viennent de la rampe canonique
   * (`packages/ui/src/tokens/typography.css`), jamais d'un nombre écrit ici.
   * - 'xs' = 12px (--type-xs) — sidebar groups, KPI tile labels (minor)
   * - 'sm' = 14px (--type-sm) — section headings (major)
   *
   * Ce bloc annonçait 11 px et 13 px : les valeurs d'AVANT la décompression de
   * l'échelle du 2026-08-01 (« 11 / 13 / 15 / 17 » dans 6 px, aucune hiérarchie
   * perceptible). Le preset rend 12 px et 14 px depuis. Corrigé le 2026-08-18 —
   * c'est le primitif qui rend TOUS les libellés de section des deux apps, un
   * docstring faux s'y recopie plus loin que partout ailleurs.
   */
  size?: 'xs' | 'sm';
}

export function SectionLabel({
  as = 'div',
  size = 'xs',
  className,
  children,
  ...props
}: SectionLabelProps): JSX.Element {
  return createElement(
    as,
    {
      ...props,
      className: cn(
        'font-bold uppercase tracking-widest text-text-muted',
        size === 'xs' ? 'text-xs' : 'text-sm',
        className,
      ),
    },
    children,
  );
}
