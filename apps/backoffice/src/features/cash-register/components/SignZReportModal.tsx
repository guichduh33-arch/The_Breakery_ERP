// apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx
//
// S29 Wave 6.B.1 — Modal to sign a draft Z-Report. 2 steps : preview + PIN.
// On sign success, regenerates PDF and opens it in a new tab.

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Button,
} from '@breakery/ui';
import { formatCurrency, roundIdr } from '@breakery/utils';
import { cn } from '@breakery/ui';
import { Loader2 } from 'lucide-react';
import {
  VARIANCE_TONE_TEXT, varianceToneSigned,
} from '@/features/reports/utils/varianceScale.js';
import { useZReport } from '../hooks/useZReport.js';
import { useSignZReport } from '../hooks/useSignZReport.js';
import { useGenerateZReportPdf } from '../hooks/useGenerateZReportPdf.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface SignZReportModalProps {
  open:         boolean;
  zreportId:    string | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?:   () => void;
}

// Le Z-report s'arrondit à la centaine de roupies AVANT d'être rendu : c'est
// la coupure de caisse réelle, pas un arrondi d'affichage. `roundIdr` porte
// cette règle métier ; `formatCurrency` ne fait que l'écrire (préfixe « Rp »
// compris) — audit UX/UI 2026-08-13, lot 1.
function formatIDR(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return formatCurrency(roundIdr(v));
}

/**
 * Seuil du barème signé, ici. Zéro et non un montant : cette modale est celle
 * où un responsable ENGAGE SA SIGNATURE sur une coupure de caisse. Tout manquant
 * mérite qu'il le voie, sans qu'on ait à inventer un plancher métier que rien
 * ne fonde. Un excédent reste `watch` — trop d'argent dans un tiroir est aussi
 * une anomalie, c'est la sémantique même de `varianceToneSigned`.
 */
const SIGNED = { bad: 0 } as const;

/**
 * Une ligne d'écart SIGNÉ. Le manquant qu'on contresigne rendait exactement
 * comme un excédent : même graisse, même encre, seul le signe les séparait.
 *
 * Trois signaux, dont DEUX non colorés (WCAG 1.4.1 — la couleur seule ne suffit
 * jamais) : le signe, que `formatIDR` produit déjà ; le mot (« shortfall » /
 * « overage ») ; la couleur en renfort. Le barème est celui du dépôt, pas un
 * `v < 0 ? rouge : vert` local — c'est ce que `varianceScale.ts` a fondu.
 *
 * Le montant rend en mono tabulaire : c'est un chiffre qu'on lit pour décider
 * (The Mono-Carries-Data Rule).
 */
function VarianceLine({
  label, value, testId,
}: {
  label: string;
  value: number | null | undefined;
  testId?: string;
}): JSX.Element {
  const known = value !== null && value !== undefined && Number.isFinite(value);
  const tone  = varianceToneSigned(known ? value : null, SIGNED);
  const word  = !known ? null : value < 0 ? 'shortfall' : value > 0 ? 'overage' : null;

  return (
    <div {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      <span className="text-text-secondary">{label}: </span>
      <span className={cn('font-data tabular-nums', VARIANCE_TONE_TEXT[tone])}>
        {formatIDR(value)}
      </span>
      {word !== null && (
        <span className={cn('ml-1.5 font-data text-xs', VARIANCE_TONE_TEXT[tone])}>{word}</span>
      )}
    </div>
  );
}

export function SignZReportModal({ open, zreportId, onOpenChange, onSuccess }: SignZReportModalProps): JSX.Element {
  const [step, setStep]       = useState<1 | 2>(1);
  const [pin, setPin]         = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: report, isLoading } = useZReport(zreportId ?? undefined);
  const signMutation = useSignZReport();
  const pdfMutation  = useGenerateZReportPdf();

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setPin('');
      setErrorMsg(null);
      signMutation.resetIdempotency();
      pdfMutation.resetIdempotency();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSign = async (): Promise<void> => {
    if (!zreportId) return;
    if (!/^\d{6}$/.test(pin)) {
      setErrorMsg('PIN must be 6 digits');
      return;
    }
    setErrorMsg(null);
    try {
      await signMutation.mutateAsync({ zreportId, managerPin: pin });
      const pdf = await pdfMutation.mutateAsync({ zreportId });
      if (pdf.signed_url) window.open(pdf.signed_url, '_blank', 'noopener,noreferrer');
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'Sign failed';
      setErrorMsg(msg);
    }
  };

  const snapshot = report?.snapshot;
  const sales    = snapshot?.sales_total   as number | undefined;
  const variance = snapshot?.cash_variance as number | undefined;
  const opened   = snapshot?.opened_at     as string | undefined;
  const closed   = snapshot?.closed_at     as string | undefined;
  // S67 (12 D2.2/D2.3) — optional three-way reconciliation. Pre-S67
  // snapshots lack the key entirely: rows below stay hidden (counted == null).
  const reconciliation = snapshot?.reconciliation as
    | Record<string, { counted: number | null; variance: number | null }>
    | null
    | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign Z-Report</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Review the shift summary, then enter your manager PIN to sign.'
              : 'Enter your 6-digit manager PIN to sign this Z-Report.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8" data-testid="zreport-loading">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !report ? (
          <p className="text-sm text-text-secondary py-4">Z-Report not found.</p>
        ) : step === 1 ? (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-text-secondary">Period: </span>
              {opened?.slice(0, 16).replace('T', ' ')} → {closed?.slice(0, 16).replace('T', ' ')}
            </div>
            <div>
              <span className="text-text-secondary">Sales total: </span>
              {formatIDR(sales)}
            </div>
            <VarianceLine label="Cash variance" value={variance} />
            {reconciliation?.qris?.counted != null && (
              <VarianceLine
                label="QRIS variance"
                value={reconciliation.qris.variance}
                testId="sign-qris-variance"
              />
            )}
            {reconciliation?.card?.counted != null && (
              <VarianceLine
                label="Card+EDC variance"
                value={reconciliation.card.variance}
                testId="sign-card-variance"
              />
            )}
            <DialogFooter className="pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="sign-cancel">Cancel</Button>
              <Button variant="ink" onClick={() => setStep(2)} data-testid="sign-continue">Continue</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="sign-pin" className="text-xs uppercase tracking-widest text-text-secondary block mb-1">
                Manager PIN
              </label>
              <input
                id="sign-pin"
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary tracking-widest ${FOCUS_RING}`}
                data-testid="sign-pin-input"
              />
            </div>
            {errorMsg !== null && (
              <p className="text-sm text-danger" role="alert">{errorMsg}</p>
            )}
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => setStep(1)} data-testid="sign-back">Back</Button>
              <Button
                variant="ink"
                onClick={() => void handleSign()}
                disabled={pin.length !== 6 || signMutation.isPending || pdfMutation.isPending}
                data-testid="sign-submit"
              >
                {signMutation.isPending || pdfMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Signing…</>
                  : 'Sign'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
