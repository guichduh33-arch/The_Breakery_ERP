// apps/pos/src/features/display/components/CDPaymentPanel.tsx
//
// Split-brand redesign (owner request 2026-07-07) — RIGHT HALF of the customer
// display while a `payment_complete` broadcast is showing. Replaces the
// payment branch of the retired CDActiveCartView and enriches it with the
// receipt-parity details: payment method, tax included, and the loyalty
// outcome for attached customers. All figures arrive server-authoritative in
// the broadcast (SuccessModal) — nothing is recomputed here.

import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { Currency } from '@breakery/ui';

import { METHODS } from '@/features/payment/components/paymentMethods';

import type { PaymentCompleteMessage } from '../hooks/useCartBroadcast';

/**
 * Design Wave C — fade the confirmation in on mount using motion.css tokens.
 * `--motion-slow` collapses to 0 ms under `prefers-reduced-motion` (handled at
 * the CSS-variable level), so this respects the OS preference with no guard.
 */
function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`${className ?? ''} [transition:opacity_var(--motion-slow)_var(--motion-ease-out)] ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {children}
    </div>
  );
}

/** Human label for the tender (shared source with the payment grid). */
function methodLabel(method: string): string {
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

export function CDPaymentPanel({ message }: { message: PaymentCompleteMessage }): JSX.Element {
  const showChange = message.method === 'cash' && (message.change ?? 0) > 0;
  const points = message.points_earned;

  return (
    <FadeIn className="m-auto w-full max-w-xl text-center space-y-8 px-8">
      <div data-testid="cd-payment-complete" className="space-y-8">
        <div className="space-y-2">
          <h2 className="font-serif text-6xl text-gold">
            {message.customer_name ? `Merci, ${message.customer_name} !` : 'Merci !'}
          </h2>
          <p className="text-text-secondary text-2xl" data-testid="cd-payment-method">
            Paiement reçu · {methodLabel(message.method)}
          </p>
        </div>

        {/* Amount block — total + the tax already included in it (PB1). */}
        <div className="rounded-3xl border border-border-subtle bg-bg-elevated px-10 py-8 space-y-3">
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-text-secondary uppercase tracking-widest text-sm">Total</span>
            <Currency
              amount={message.total}
              emphasis="gold"
              className="text-5xl font-bold tabular-nums"
            />
          </div>
          {message.tax_amount > 0 && (
            <div
              className="flex items-baseline justify-between gap-6 text-text-secondary"
              data-testid="cd-payment-tax"
            >
              <span className="uppercase tracking-widest text-xs">Taxes incluses</span>
              <Currency amount={message.tax_amount} className="text-lg text-text-secondary" />
            </div>
          )}
        </div>

        {showChange && (
          <div>
            <div className="text-text-secondary uppercase tracking-widest text-xs mb-1">
              Monnaie à rendre
            </div>
            {/* Feedback only — the value itself is not animated (money-path). */}
            <Currency
              amount={message.change ?? 0}
              emphasis="gold"
              className="text-5xl font-bold tabular-nums"
            />
          </div>
        )}

        {/* Loyalty outcome — only for attached customers with points earned. */}
        {points !== null && points > 0 && (
          <div
            className="rounded-3xl border border-gold-soft bg-bg-elevated px-10 py-6 space-y-1"
            data-testid="cd-payment-loyalty"
          >
            <div className="text-text-secondary uppercase tracking-widest text-xs">
              Points fidélité
            </div>
            <div className="font-mono text-gold text-3xl font-semibold">+{points} pts</div>
            {message.loyalty_balance_after !== null && (
              <p className="text-text-secondary text-sm" data-testid="cd-payment-loyalty-balance">
                Nouveau solde · {message.loyalty_balance_after} pts
              </p>
            )}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
