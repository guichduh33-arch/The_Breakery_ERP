// apps/pos/src/features/payment/components/TenderDraftPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's draft entry panel.
// Rendered only when a method is selected. data-testid `pay-add-tender` preserved.

import { Plus } from 'lucide-react';
import { Button, Currency, Numpad, SectionLabel, cn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';

export interface TenderDraftPanelProps {
  cashReceivedStr: string;
  setCashReceivedStr: (value: string) => void;
  isCashDraft: boolean;
  cashChange: number;
  draftTenderAmount: number;
  draftAmount: number;
  remaining: number;
  quickAmounts: number[];
  draftValid: boolean;
  onAddTender: () => void;
}

export function TenderDraftPanel({
  cashReceivedStr,
  setCashReceivedStr,
  isCashDraft,
  cashChange,
  draftTenderAmount,
  draftAmount,
  remaining,
  quickAmounts,
  draftValid,
  onAddTender,
}: TenderDraftPanelProps) {
  return (
    <div className="space-y-4 mb-4">
      {/* ENTER AMOUNT — big centered display */}
      <div>
        <SectionLabel as="div" className="mb-2 text-center">
          Enter Amount
        </SectionLabel>
        {/* Critique run 3 (résiduel du lot 4) — saisie formatée dès la frappe,
            comme OpenShiftModal / CashInOutModal / PerPayerCashStep. */}
        <div className="bg-bg-input border-2 border-gold rounded-md py-5 text-center">
          <span className="font-mono tabular-nums text-3xl text-text-primary">
            {formatIdr(Number(cashReceivedStr || '0'))}
          </span>
        </div>
        {/* Audit 2026-08-27 — la monnaie à rendre est le chiffre que le caissier
            prépare en ouvrant le tiroir : gros corps mono or, lisible à bout de
            bras (était text-xs). */}
        {isCashDraft && cashChange > 0 && draftTenderAmount === remaining && (
          <div className="mt-2 flex items-baseline justify-between">
            <SectionLabel as="div">Change</SectionLabel>
            <Currency
              amount={cashChange}
              emphasis="gold"
              className="text-2xl font-mono tabular-nums"
            />
          </div>
        )}
      </div>

      {/* Critique run 4 lot 1 (adapt) — la paire presets/pavé imbriquée dans
          la colonne droite du terminal tombait à ~90 px par sous-colonne à
          390 px ; sous md elle s'empile, le pavé reprend la pleine largeur. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AMOUNT RECEIVED preset grid */}
        <div>
          <SectionLabel as="div" className="mb-2">Amount Received</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCashReceivedStr(String(remaining))}
              className={cn(
                // Critique run 4 lot 3 — valider un montant = parcours d'argent :
                // la Règle des 56 s'applique, 44 est le plancher du secondaire.
                'col-span-2 min-h-touch-comfy rounded-md py-2.5 text-xs font-bold uppercase tracking-widest border',
                'transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                draftAmount === remaining
                  ? 'bg-gold text-gold-fg border-gold'
                  : 'bg-bg-input border-border-subtle [@media(hover:hover)]:hover:bg-bg-overlay text-text-primary',
              )}
            >
              {/* Audit 2026-08-24 (theming P3) — Règle du Chiffre Immobile :
                  le montant du bouton Exact était le seul en Inter de l'écran. */}
              Exact (<span className="font-mono tabular-nums normal-case">{formatIdr(remaining)}</span>)
            </button>
            {isCashDraft && quickAmounts.filter((q) => q >= remaining).slice(0, 4).map((q) => (
              <button
                key={q}
                onClick={() => setCashReceivedStr(String(q))}
                className="min-h-touch-comfy rounded-md py-2.5 text-xs font-mono tabular-nums bg-bg-input border border-border-subtle [@media(hover:hover)]:hover:bg-bg-overlay text-text-primary transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {formatIdr(q)}
              </button>
            ))}
          </div>
        </div>

        {/* Numpad */}
        <div>
          <SectionLabel as="div" className="mb-2">Cash Received</SectionLabel>
          <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />
        </div>
      </div>

      <Button
        variant="secondary"
        size="lg"
        className="w-full uppercase tracking-widest"
        onClick={onAddTender}
        disabled={!draftValid}
        data-testid="pay-add-tender"
      >
        <Plus className="h-4 w-4 mr-2" aria-hidden /> Add Tender
      </Button>
    </div>
  );
}
