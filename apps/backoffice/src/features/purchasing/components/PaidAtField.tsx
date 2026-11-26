// ADR-048 — champ « Paid at » d'un paiement fournisseur : la date réelle du
// décaissement, choisie par l'opérateur. Aucun défaut au jour courant : une
// saisie tardive datée d'aujourd'hui fausserait la caisse et la banque du jour.
// La valeur `datetime-local` part telle quelle ; le serveur la lit au fuseau
// métier de la session PostgreSQL.

import type { JSX } from 'react';
import { FOCUS_RING } from '@/components/focusRing.js';

export function PaidAtField({
  id, value, onChange, disabled = false,
}: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }): JSX.Element {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
        Paid at <span aria-hidden className="text-danger">*</span>
      </label>
      <input
        id={id}
        type="datetime-local"
        required
        aria-required="true"
        aria-describedby={`${id}-hint`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
        data-testid="paid-at-input"
      />
      <p id={`${id}-hint`} className="text-xs text-text-secondary">
        {value.trim() === '' ? 'Required: the date the money actually left.' : 'The payment and its journal entry use this date.'}
      </p>
    </div>
  );
}
