import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:duration-0 motion-reduce:active:scale-100 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold focus-visible:shadow-focus',
  {
    variants: {
      variant: {
        // Filled and outlined variants neutralise their colour when disabled
        // instead of only fading it: `opacity-50` over a saturated green or
        // gold still reads as a live, tappable button (design audit 2026-08-04
        // — three Backoffice forms whose primary action looked clickable while
        // it was not). The flat variants below stay on the base opacity, which
        // is legible enough on an already neutral surface.
        primary: 'bg-green hover:bg-green-hover text-green-fg uppercase tracking-wide rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        // Audit UX/UI 2026-08-13 (lot 5) — l'action primaire du Backoffice est
        // ENCRE, en casse de phrase (doctrine toolbarButton.ts) ; variant
        // additif, le POS garde `primary` vert.
        ink: 'bg-ink hover:bg-ink-hover text-ink-fg rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        gold: 'bg-gold hover:bg-gold-hover text-gold-fg uppercase tracking-wide rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        // `border-strong` et non `border-subtle` : le secondaire est une surface
        // qui vaut EXACTEMENT celle qui le porte (--bg-overlay = #ffffff dans le
        // thème back-office, comme la carte), son trait est donc le SEUL objet
        // qui le délimite et il porte les 3:1 de WCAG 1.4.11. Mesuré sur les
        // deux thèmes, 2026-08-18 :
        //   · back-office — subtle #e3e1db sur le blanc du bouton 1,308:1 (mort) ;
        //     strong #86827a 3,827:1 (clos). Sur les quatre fonds du thème :
        //     3,827 / 3,328 / 3,662 / 3,097:1.
        //   · POS luxe-dark — le remplissage est #231f1b : subtle #2a2622 y vaut
        //     1,090:1, strong #413a33 1,463:1. Le sombre ne PERD donc rien au
        //     changement, il gagne 34 % ; il reste sous 3:1, mais c'est une dette
        //     de la rampe sombre (aucun de ses deux traits ne la tient), pas une
        //     régression de cette ligne. Pas de surcharge scopée : elle figerait
        //     le pire des deux états.
        // Le SURVOL est `surface-4`, pas `bg-input` : c'est le cran « survol /
        // pressé » de la rampe dans les deux thèmes, et c'est déjà ce que rend
        // la chaîne de bandeau (`TOOLBAR_BTN_SECONDARY`). `bg-input` ne marquait
        // rien — mesuré le 2026-08-18, repos contre survol :
        //   · back-office — --bg-overlay et --bg-input valent TOUS DEUX #ffffff :
        //     1,000:1, ΔL 0,00000. Le bouton ne réagissait pas à la souris.
        //     surface-4 #e9e7e2 donne 1,236:1, ΔL 0,20034.
        //   · POS luxe-dark — #231f1b contre #1f1c18 : 1,037:1, ΔL 0,00229 ;
        //     surface-4 #2e2924 donne 1,137:1, ΔL 0,00878, soit 3,8× le pas.
        // Le sombre gagne donc lui aussi ; aucun thème ne perd.
        secondary: 'bg-bg-overlay border border-border-strong text-text-primary hover:bg-surface-4 rounded-md',
        outlineGold: 'bg-transparent border border-gold text-gold hover:bg-gold-soft uppercase tracking-wide rounded-md disabled:border-border-subtle disabled:text-text-muted disabled:opacity-100',
        ghost: 'bg-transparent text-text-primary hover:bg-bg-overlay rounded-md',
        ghostDestructive: 'bg-transparent text-red-as-text hover:bg-red-soft rounded-md',
        link: 'text-gold underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-touch-comfy px-4 text-sm',
        lg: 'h-touch-large px-6 text-base',
        icon: 'h-touch-comfy w-touch-comfy',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
