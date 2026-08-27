// apps/pos/src/features/payment/components/PaymentMethodGrid.tsx
// Iso-behaviour extraction of PaymentTerminal's method grid.
// data-testid `pay-method-${value}` and focus-visible classes preserved.

import { SectionLabel, cn } from '@breakery/ui';
import type { PaymentMethod } from '@breakery/domain';
import { METHODS_BY_VALUE, type MethodMeta } from './paymentMethods';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { useOfflineMode } from '@/features/lan/offlineMode';
import { useCartStore } from '@/stores/cartStore';

export interface PaymentMethodGridProps {
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentMethodGrid({ selectedMethod, onSelect }: PaymentMethodGridProps) {
  // S64 — only methods enabled in BO Settings render (fail-open = all 6).
  const enabled = useEnabledPaymentMethods();
  // Spec 006x lot 4 (A1) — hors-ligne, seul le CASH est encaissable ; les
  // flux non-cash sont online-only et disparaissent proprement de la grille.
  const offline = useOfflineMode();
  // ADR-013 Lot 4 (D8) — le tender store_credit exige un client rattaché
  // (gate serveur P0015) : sans client, la tuile disparaît (même pattern
  // que l'exclusion offline).
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  return (
    <>
      <SectionLabel as="div" className="mb-2">Select Payment Method</SectionLabel>
      {/* Critique run 4 lot 2 (harden) — ARIA honnête : radiogroup promettait
          la navigation aux flèches qu'aucun onKeyDown n'implémente (WCAG 2.1.1).
          Des boutons à bascule (aria-pressed) disent vrai : Tab + Enter suffisent. */}
      {/* Critique run 4 lot 1 (adapt) — 3 colonnes à 390 px = tuiles ~108 px
          où « Store Credit » déborde ; 2 colonnes sous md. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6" role="group" aria-label="Payment method">
        {/* ADR-006 déc. 9 lot A — iterate the enabled set (BO-configured
            order, Set preserves insertion order) instead of the constant. */}
        {[...enabled]
          .filter((v) => !offline || v === 'cash')
          .filter((v) => v !== 'store_credit' || attachedCustomer !== null)
          .map((v) => METHODS_BY_VALUE.get(v))
          .filter((m): m is MethodMeta => m !== undefined)
          .map((m) => {
          const Icon = m.icon;
          const active = selectedMethod === m.value;
          return (
            <button
              key={m.value}
              onClick={() => onSelect(m.value)}
              aria-pressed={active}
              className={cn(
                'h-24 rounded-md border flex flex-col items-center justify-center gap-1.5',
                'transition-[color,background-color,border-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                active
                  ? 'border-gold bg-gold-soft text-gold'
                  // Hover gaté (hover:hover) — doctrine 2026-08-23 (cf. ProductCard) :
                  // au doigt, :hover COLLE après le tap et le border-gold survolé
                  // imite l'état sélectionné. Souris inchangée.
                  : 'border-border-subtle bg-bg-elevated text-text-secondary [@media(hover:hover)]:hover:text-text-primary [@media(hover:hover)]:hover:border-gold',
              )}
              data-testid={`pay-method-${m.value}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {/* LOT 7 (audit 2026-06-25) — bump to text-sm for legibility at
                  arm's length during the rush; ease the tracking so longer
                  labels (Voucher) don't crowd. */}
              <span className="text-sm uppercase tracking-wide font-semibold">{m.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
