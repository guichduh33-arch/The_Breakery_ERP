// apps/pos/src/features/payment/split/ItemAssignStep.tsx
//
// Session 14 / Phase 2.C — Split flow step 2 (refs 91 / 93).
//
// Two-column layout :
//   LEFT  : "ORDER ITEMS" — list of cart lines with a "N left" chip showing
//           how many units remain unassigned. Tapping a line assigns ONE
//           unit to the currently active payer (right-tab).
//   RIGHT : Tabs across the top (Client 1 / Client 2 / …), the active payer
//           total + count, and the list of items assigned to that payer.
//           Each assigned row has a "-" button to give one unit back.
//
// Tactic chosen vs. drag-and-drop : the cashier always has one payer tab
// selected ; tapping a left-side line transfers one unit to that tab. Easier
// on touch + matches the implicit affordance of the screenshot
// ("Tap item to assign to selected payer" sub-copy).

import type { JSX } from 'react';
import { Plus, Minus, Users } from 'lucide-react';
import { Button, Currency, cn } from '@breakery/ui';
import type { CartItem } from '@breakery/domain';
import { COLOR_CLASSES, type SplitPayer } from './types';

export interface ItemAssignStepProps {
  /** Cart lines with their original quantity. */
  cartItems: readonly CartItem[];
  /** Payers + current assignments. */
  payers: SplitPayer[];
  /** Active payer (the one items get assigned to on tap). */
  activePayerId: string;
  /** Cart grand total (informational footer). */
  grandTotal: number;
  /** Switch active payer (clicking a tab). */
  onSetActivePayer: (id: string) => void;
  /** Optionally add a payer (the "+" tab in ref 91). */
  onAddPayer?: () => void;
  /** Assign one unit of `cartItemId` to the active payer. */
  onAssign: (cartItemId: string) => void;
  /** Unassign one unit of `cartItemId` from the given payer. */
  onUnassign: (cartItemId: string, payerId: string) => void;
}

/** Compute total qty already assigned across all payers for one line. */
function totalAssigned(payers: SplitPayer[], cartItemId: string): number {
  let n = 0;
  for (const p of payers) {
    for (const a of p.items) {
      if (a.cartItemId === cartItemId) n += a.quantity;
    }
  }
  return n;
}

/** Compute one payer's subtotal in IDR. */
export function payerSubtotal(payer: SplitPayer, cartItems: readonly CartItem[]): number {
  let s = 0;
  for (const a of payer.items) {
    const line = cartItems.find((c) => c.id === a.cartItemId);
    if (!line) continue;
    const adj = line.modifiers.reduce((acc, m) => acc + m.price_adjustment, 0);
    s += (line.unit_price + adj) * a.quantity;
  }
  return s;
}

export function ItemAssignStep({
  cartItems,
  payers,
  activePayerId,
  grandTotal,
  onSetActivePayer,
  onAddPayer,
  onAssign,
  onUnassign,
}: ItemAssignStepProps): JSX.Element {
  const activePayer = payers.find((p) => p.id === activePayerId) ?? payers[0]!;
  const activeColors = COLOR_CLASSES[activePayer.color];
  const activeSubtotal = payerSubtotal(activePayer, cartItems);
  const activeItemCount = activePayer.items.reduce((s, a) => s + a.quantity, 0);

  return (
    <div className="flex-1 grid grid-cols-2 gap-px bg-border-subtle overflow-hidden" data-testid="split-item-assign">
      {/* LEFT — order items */}
      <section className="bg-bg-base p-6 overflow-y-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-xs uppercase tracking-widest text-gold">Order Items</h3>
          <span className="text-xs text-text-secondary">Tap item to assign to selected payer</span>
        </div>

        <ul className="space-y-3">
          {cartItems.map((line) => {
            const adj = line.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
            const unitLine = line.unit_price + adj;
            const assignedAcrossAll = totalAssigned(payers, line.id);
            const remaining = Math.max(0, line.quantity - assignedAcrossAll);
            const exhausted = remaining === 0;
            // Per-payer assignment count for THIS line
            const perPayerCount = activePayer.items.find((a) => a.cartItemId === line.id)?.quantity ?? 0;

            return (
              <li key={line.id}>
                <button
                  type="button"
                  disabled={exhausted}
                  onClick={() => onAssign(line.id)}
                  data-testid={`split-assign-line-${line.id}`}
                  className={cn(
                    'w-full text-left rounded-md border p-3 transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                    exhausted
                      ? 'bg-bg-input/30 border-border-subtle opacity-60 cursor-not-allowed'
                      : 'bg-bg-base border-border-subtle hover:border-gold/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-text-primary font-semibold leading-tight">{line.name}</div>
                      {line.modifiers.length > 0 && (
                        <div className="text-[11px] text-text-secondary mt-0.5 truncate">
                          {line.modifiers.map((m) => m.option_label).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-sm whitespace-nowrap">
                      <Currency amount={unitLine * line.quantity} className="text-text-primary" />
                      <span className="text-text-secondary ml-1">×{line.quantity}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
                        exhausted
                          ? activeColors.bg + ' ' + activeColors.border + ' ' + activeColors.text
                          : 'border-purple-400/60 bg-purple-400/10 text-purple-400',
                      )}
                    >
                      {exhausted ? (
                        <>
                          <span className={cn('h-1.5 w-1.5 rounded-full', activeColors.dot)} aria-hidden />
                          {activePayer.label} ×{perPayerCount}
                          {perPayerCount > 0 && (
                            <span
                              role="button"
                              aria-label="Unassign one unit"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onUnassign(line.id, activePayerId);
                                }
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onUnassign(line.id, activePayerId);
                              }}
                              className="ml-1 text-text-secondary hover:text-text-primary cursor-pointer"
                            >
                              −
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <Plus className="h-2.5 w-2.5" aria-hidden /> {remaining} left
                        </>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* RIGHT — payer tabs + active payer items */}
      <section className="bg-bg-base p-6 overflow-y-auto flex flex-col">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-3 mb-4">
          {payers.map((p) => {
            const isActive = p.id === activePayer.id;
            const colors = COLOR_CLASSES[p.color];
            const sub = payerSubtotal(p, cartItems);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSetActivePayer(p.id)}
                aria-pressed={isActive}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors',
                  isActive
                    ? cn(colors.text, colors.bg, 'border-b-2', colors.border.replace('border-', 'border-b-'))
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', colors.dot)} aria-hidden />
                {p.label}
                {sub > 0 && (
                  <span className={cn('ml-1 normal-case tracking-normal text-[10px] font-mono', isActive ? colors.text : 'text-text-secondary')}>
                    <Currency amount={sub} />
                  </span>
                )}
              </button>
            );
          })}
          {onAddPayer && (
            <button
              type="button"
              onClick={onAddPayer}
              aria-label="Add payer"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {/* Active payer body */}
        {activePayer.items.length === 0 ? (
          <div className="flex-1 grid place-items-center text-center text-text-secondary">
            <div className="space-y-2">
              <Users className="h-8 w-8 mx-auto text-text-muted" aria-hidden />
              <p className="text-sm font-semibold text-text-primary">No items assigned yet</p>
              <p className="text-xs">Tap items on the left to assign them</p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {activePayer.items.map((a) => {
              const line = cartItems.find((c) => c.id === a.cartItemId);
              if (!line) return null;
              const adj = line.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
              const rowTotal = (line.unit_price + adj) * a.quantity;
              return (
                <li
                  key={a.cartItemId}
                  className={cn(
                    'rounded-md border p-3 flex items-center justify-between gap-3',
                    activeColors.bg,
                    activeColors.border,
                  )}
                >
                  <span className={cn('text-sm font-semibold', activeColors.text)}>{line.name}</span>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-text-secondary">×{a.quantity}</span>
                    <Currency amount={rowTotal} className={cn('font-mono', activeColors.text)} />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Unassign one unit"
                      onClick={() => onUnassign(a.cartItemId, activePayer.id)}
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer */}
        <div className="mt-auto pt-4 border-t border-border-subtle">
          <div className="flex items-baseline justify-between text-xs text-text-secondary uppercase tracking-widest">
            <span>{activePayer.label} subtotal</span>
            <span>({activeItemCount} items)</span>
          </div>
          <Currency
            amount={activeSubtotal}
            emphasis="gold"
            className={cn('text-2xl block', activeColors.text)}
          />
          <div className="mt-2 text-[11px] text-text-muted flex items-center justify-between">
            <span>Total cart</span>
            <Currency amount={grandTotal} className="text-text-secondary" />
          </div>
        </div>
      </section>
    </div>
  );
}
