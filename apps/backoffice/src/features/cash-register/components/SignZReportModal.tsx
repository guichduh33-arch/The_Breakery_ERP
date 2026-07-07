// apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx
//
// S29 Wave 6.B.1 — Modal to sign a draft Z-Report. 2 steps : preview + PIN.
// On sign success, regenerates PDF and opens it in a new tab.

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Button,
} from '@breakery/ui';
import { Loader2 } from 'lucide-react';
import { useZReport } from '../hooks/useZReport.js';
import { useSignZReport } from '../hooks/useSignZReport.js';
import { useGenerateZReportPdf } from '../hooks/useGenerateZReportPdf.js';

export interface SignZReportModalProps {
  open:         boolean;
  zreportId:    string | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?:   () => void;
}

function formatIDR(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    .format(Math.round(v / 100) * 100);
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
              Rp {formatIDR(sales)}
            </div>
            <div>
              <span className="text-text-secondary">Cash variance: </span>
              Rp {formatIDR(variance)}
            </div>
            <DialogFooter className="pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="sign-cancel">Cancel</Button>
              <Button onClick={() => setStep(2)} data-testid="sign-continue">Continue</Button>
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
                className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary tracking-widest"
                data-testid="sign-pin-input"
              />
            </div>
            {errorMsg !== null && (
              <p className="text-sm text-danger" role="alert">{errorMsg}</p>
            )}
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={() => setStep(1)} data-testid="sign-back">Back</Button>
              <Button
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
