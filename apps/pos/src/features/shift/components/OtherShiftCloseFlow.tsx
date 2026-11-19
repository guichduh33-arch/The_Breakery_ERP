// S3-01 — un manager clôture la session ouverte d'un autre caissier (décision de
// Mamat du 2026-11-19, ADR-043). Même aperçu et même écran de clôture que pour
// sa propre session ; le serveur exige pos.session.close_other.
import { Button, FullScreenModal } from '@breakery/ui';
import { useShiftCloseSummary } from '../hooks/useShiftCloseSummary';
import { CloseShiftModal } from './CloseShiftModal';

interface Props {
  sessionId: string;
  cashierName: string;
  onClose: () => void;
}

export function OtherShiftCloseFlow({ sessionId, cashierName, onClose }: Props) {
  const summary = useShiftCloseSummary(sessionId);

  if (!summary.data) {
    return (
      <FullScreenModal open onOpenChange={(o) => { if (!o) onClose(); }} accessibleTitle="Close shift">
        <div className="m-auto p-6 space-y-4" data-testid="other-shift-close-loading">
          <p role={summary.isError ? 'alert' : 'status'}>
            {summary.isError ? 'Shift summary could not be loaded' : `Loading the shift of ${cashierName}…`}
          </p>
          {summary.isError && <Button onClick={() => { void summary.refetch(); }}>Try again</Button>}
          <Button variant="secondary" onClick={onClose}>Back</Button>
        </div>
      </FullScreenModal>
    );
  }

  return (
    <CloseShiftModal
      open
      sessionId={sessionId}
      expectedCash={summary.data.expectedCash}
      thresholdAbs={summary.data.thresholdAbs}
      thresholdPct={summary.data.thresholdPct}
      pinThresholdAbs={summary.data.pinThresholdAbs}
      pinThresholdPct={summary.data.pinThresholdPct}
      onClose={onClose}
    />
  );
}
