// apps/pos/src/features/payment/components/TenderDraftPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's draft entry panel.
// Rendered only when a method is selected. data-testid `pay-add-tender` preserved.

import { Plus } from 'lucide-react';
import { Button, Currency, Numpad, SectionLabel, cn } from '@breakery/ui';
import { formatLabel } from '../format';

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
        <SectionLabel as="div" className="text-gold mb-2 text-center">
          Enter Amount
        </SectionLabel>
        <div className="bg-bg-input border-2 border-gold rounded-md py-5 text-center">
          <span className="font-mono tabular-nums text-3xl text-text-primary">
            Rp {cashReceivedStr || '0'}
          </span>
        </div>
        {isCashDraft && cashChange > 0 && draftTenderAmount === remaining && (
          <div className="mt-2 text-xs text-text-secondary text-right">
            Change: <Currency amount={cashChange} className="text-gold" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* AMOUNT RECEIVED preset grid */}
        <div>
          <SectionLabel as="div" className="text-gold mb-2">Amount Received</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCashReceivedStr(String(remaining))}
              className={cn(
                'col-span-2 rounded-md py-2.5 text-xs font-bold uppercase tracking-widest border',
                draftAmount === remaining
                  ? 'bg-gold text-bg-base border-gold'
                  : 'bg-bg-input border-border-subtle hover:bg-bg-overlay text-text-primary',
              )}
            >
              Exact ({formatLabel(remaining)})
            </button>
            {isCashDraft && quickAmounts.filter((q) => q >= remaining).slice(0, 4).map((q) => (
              <button
                key={q}
                onClick={() => setCashReceivedStr(String(q))}
                className="rounded-md py-2.5 text-xs font-mono tabular-nums bg-bg-input border border-border-subtle hover:bg-bg-overlay text-text-primary"
              >
                {formatLabel(q)}
              </button>
            ))}
          </div>
        </div>

        {/* Numpad */}
        <div>
          <SectionLabel as="div" className="text-gold mb-2">Cash Received</SectionLabel>
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
