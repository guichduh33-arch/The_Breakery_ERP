// packages/ui/src/primitives/Skeleton.tsx
//
// Barre de chargement générique (audit UX/UI 2026-08-13, lot 8).
//
// Un placeholder gris qui pulse doucement, à poser à la forme du contenu qu'il
// remplace. Il partage le motif exact du squelette de `DataTable`
// (`bg-surface-4 animate-pulse`), de sorte qu'une page qui montrait un « Loading… »
// nu ou un spinner plein rende désormais la SILHOUETTE de ce qui arrive.
//
// `motion-reduce:animate-none` coupe la pulsation pour qui a demandé moins de
// mouvement. Décoratif par défaut (`aria-hidden`) : c'est le conteneur qui
// porte l'annonce de chargement (`aria-busy`/`aria-live`), pas chaque barre.

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn.js';

export type SkeletonVariant = 'line' | 'block' | 'circle';

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** Forme : `line` (texte, rayon serré), `block` (carte), `circle` (avatar). */
  variant?: SkeletonVariant;
  /** Largeur CSS — nombre (px) ou chaîne. */
  width?: number | string;
  /** Hauteur CSS — nombre (px) ou chaîne. */
  height?: number | string;
}

const RADIUS: Record<SkeletonVariant, string> = {
  line:   'rounded-sm',
  block:  'rounded-md',
  circle: 'rounded-full',
};

/** Placeholder de chargement pulsant, dimensionné par props ou par className. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = 'line', width, height, className, style, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      data-slot="skeleton"
      className={cn(
        'animate-pulse bg-surface-4 motion-reduce:animate-none',
        RADIUS[variant],
        // Hauteur de texte par défaut pour la variante `line` sans dimension.
        variant === 'line' && height === undefined && 'h-4',
        className,
      )}
      style={{
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...style,
      }}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';
