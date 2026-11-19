// S3-03 — le propriétaire annule la dernière clôture d'un terminal. Le serveur
// contre-passe l'écart et le règlement du tiroir, retire le rapport Z brouillon
// et rouvre la session ; ce modal ne fait que recueillir le PIN et le motif.
import { useState } from 'react';
import { Button, FullScreenModal, Input, NumpadPin } from '@breakery/ui';
import { toast } from 'sonner';
import { undoShiftCloseMessage, useUndoShiftClose } from '../hooks/useUndoShiftClose';

interface Props {
  open: boolean;
  sessionId: string | null;
  cashierName: string;
  onClose: () => void;
}

export function UndoShiftCloseModal({ open, sessionId, cashierName, onClose }: Props) {
  const mutation = useUndoShiftClose();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinKey, setPinKey] = useState(0);

  function close() {
    if (mutation.isPending) return;
    setReason(''); setError(null); setPinKey((k) => k + 1);
    onClose();
  }

  async function submit(managerPin: string) {
    if (!sessionId || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync({ sessionId, managerPin, reason });
      toast.success('Shift reopened');
      setReason(''); setPinKey((k) => k + 1);
      onClose();
    } catch (err) {
      setError(undoShiftCloseMessage(err));
      setPinKey((k) => k + 1);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(v) => { if (!v) close(); }} accessibleTitle="Undo shift close" className="overflow-y-auto">
      <div className="mx-auto w-full max-w-md space-y-4 p-6" data-testid="undo-shift-close-modal">
        <h2 className="text-xl font-bold text-text-primary">Undo shift close</h2>
        <p className="text-sm text-text-secondary">
          The shift of {cashierName} opens again. The cash variance and the drawer settlement are reversed,
          and the draft Z-report is removed. The cashier then counts and closes again.
        </p>
        <label htmlFor="undo-shift-reason" className="text-sm text-text-secondary">Reason (optional)</label>
        <Input id="undo-shift-reason" value={reason} disabled={mutation.isPending}
          onChange={(e) => setReason(e.target.value)} data-vkp="qwerty" />
        <p className="text-sm text-text-secondary">Enter the owner PIN to confirm.</p>
        <NumpadPin key={pinKey} isLoading={mutation.isPending} error={error}
          onSubmit={(pin) => { void submit(pin); }} />
        <Button variant="secondary" className="w-full" disabled={mutation.isPending} onClick={close}>Close</Button>
      </div>
    </FullScreenModal>
  );
}
