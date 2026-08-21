// apps/backoffice/src/features/expenses/components/ReceiptUploader.tsx
//
// Uploads receipt files to the private `expense-receipts` bucket under the
// path convention `expenses/{expense_id}/receipt.<ext>`. Returns the storage
// path on success — the caller persists it in `expenses.receipt_url`.

import { useState } from 'react';
import { supabase } from '@/lib/supabase.js';
import { Button } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface ReceiptUploaderProps {
  /** UUID for namespacing the path. For new expenses, generate a draft UUID client-side. */
  expenseId: string;
  /** Existing path. */
  value?: string;
  /** Called when upload completes — receives the storage path (object name). */
  onUploaded: (path: string) => void;
  disabled?: boolean;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_SIZE = 5 * 1024 * 1024;

export function ReceiptUploader({
  expenseId, value, onUploaded, disabled,
}: ReceiptUploaderProps): JSX.Element {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (file === undefined) return;

    setError(null);
    if (file.size > MAX_SIZE) {
      setError('Receipt is too large (max 5 MB).');
      return;
    }
    const ext = file.name.split('.').pop() ?? 'bin';
    const path = `expenses/${expenseId}/receipt.${ext}`;

    setBusy(true);
    try {
      const { error: upErr } = await supabase.storage
        .from('expense-receipts')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr !== null) {
        setError(upErr.message);
        return;
      }
      onUploaded(path);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        // Le libellé visible du champ est un `<span>` porté par le formulaire
        // appelant (ExpenseForm, « Receipt (optional) ») : il ne peut pas être
        // associé, l'id du contrôle vivant ici. Le nom accessible est donc posé
        // sur le contrôle lui-même — WCAG 1.3.1 / 4.1.2.
        aria-label="Receipt file"
        accept={ACCEPT}
        disabled={disabled === true || busy}
        onChange={(e) => { void handleChange(e); }}
        /* Le bouton du champ est un CONTRÔLE, pas une pastille : il prend la
           géométrie de contrôle du système — feuille blanche, liseré
           `border-strong` (3,83:1, seuil WCAG 1.4.11 clos), rayon 4 px, survol
           sur papier pressé. Il portait `bg-gold-soft` + `text-gold` sans
           bordure, ce que The Ink-Not-Gold Rule interdit et que DESIGN.md
           relève par ailleurs comme le contrôle « Receipt file » à 1,08:1 —
           une seule passe règle les deux défauts. */
        className={`block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-bg-elevated file:px-3 file:py-1.5 file:text-sm file:text-text-primary hover:file:bg-surface-4 ${FOCUS_RING}`}
      />
      {busy && <div className="text-xs text-text-secondary">Uploading…</div>}
      {error !== null && <div className="text-xs text-red">{error}</div>}
      {value !== undefined && value !== '' && (
        <div className="text-xs text-text-secondary">
          <span className="font-mono">{value}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-2"
            onClick={() => { onUploaded(''); }}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
