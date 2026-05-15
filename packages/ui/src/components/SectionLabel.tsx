// packages/ui/src/components/SectionLabel.tsx
//
// SectionLabel — Luxe Bakery signature section/group label.
//
// Session 14 D5 — "Labels MAJUSCULES tracking large = signature". Every
// reference screenshot uses this pattern for section/group labels:
//   ACTIVE ORDER · OPERATIONS · TODAY'S REVENUE · TOP PRODUCTS TODAY · ...
//
// Convention: text-xs/sm, font-bold, uppercase, tracking-widest (0.12em).
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
   * Size variant.
   * - 'xs' = 11px (--type-xs) — sidebar groups, KPI tile labels (minor)
   * - 'sm' = 13px (--type-sm) — section headings (major)
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
