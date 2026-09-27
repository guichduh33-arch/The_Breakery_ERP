// apps/pos/src/features/display/components/PairDevicePrompt.tsx
//
// Activation serveur d'un code temporaire ; aucun nom d'écran librement saisi
// ne peut ouvrir une session. Le parent renouvelle après l'appairage réussi.

import { useState, type FormEvent } from 'react';

import { pairKiosk } from '@/lib/kioskAuth';

interface PairDevicePromptProps {
  onPaired: () => void;
  errorHint?: string | null;
}

export function PairDevicePrompt({ onPaired, errorHint }: PairDevicePromptProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await pairKiosk(trimmed);
      onPaired();
    } catch {
      setError('Pairing failed. Check the code and connection, or request a new code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="h-full flex items-center justify-center"
      data-testid="display-pair-prompt"
    >
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-bg-elevated px-10 py-12"
      >
        <h2 className="font-serif text-3xl text-gold mb-2">Pair this display</h2>
        <p className="text-text-secondary text-sm mb-8">
          Enter the pairing code provided by your administrator. The display will
          activate once the code is accepted.
        </p>

        <label htmlFor="display-pair-code" className="block text-text-muted text-xs uppercase tracking-widest mb-2">
          Pairing code
        </label>
        <input
          id="display-pair-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          className="w-full bg-bg-input border border-border-subtle rounded-md px-4 py-3 text-text-primary text-lg focus:outline-none focus:border-border-focus mb-6 min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-secondary"
          data-testid="display-pair-code-input"
          placeholder="Code from Customer Display settings"
        />

        {error || errorHint ? (
          <p
            className="text-danger-as-text text-sm mb-4"
            data-testid="display-pair-error"
            role="alert"
          >
            {error ?? errorHint}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className="w-full bg-green text-green-fg font-semibold py-3 rounded-md transition-base hover:bg-green-hover disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          data-testid="display-pair-submit"
        >
          {submitting ? 'Pairing…' : 'Pair display'}
        </button>
      </form>
    </div>
  );
}
