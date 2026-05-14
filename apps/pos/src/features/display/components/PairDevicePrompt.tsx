// apps/pos/src/features/display/components/PairDevicePrompt.tsx
//
// Session 13 / Phase 4.C — D-4C-7.
//
// Inline pairing form for unpaired display devices. Writes the kiosk_id
// (= display_screens.code) and optional device_label to localStorage via
// `writeKioskPairing()` ; the parent page then retries the kiosk-issue-jwt
// flow via `useKioskAuth.retry()`.
//
// Token-only — no hardcoded hex.

import { useState, type FormEvent } from 'react';

import { writeKioskPairing } from '@/lib/kioskAuth';

interface PairDevicePromptProps {
  onPaired: () => void;
  errorHint?: string | null;
}

export function PairDevicePrompt({ onPaired, errorHint }: PairDevicePromptProps) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await writeKioskPairing({
        kiosk_id: trimmed,
        ...(label.trim() ? { device_label: label.trim() } : {}),
      });
      onPaired();
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
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-bg-elevated px-10 py-12"
      >
        <h2 className="font-serif text-3xl text-gold mb-2">Pair this display</h2>
        <p className="text-text-secondary text-sm mb-8">
          Enter the pairing code provided by your manager. The display will
          activate once the code is accepted.
        </p>

        <label className="block text-text-muted text-xs uppercase tracking-widest mb-2">
          Pairing code
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          className="w-full bg-bg-input border border-border-subtle rounded-md px-4 py-3 text-text-primary text-lg focus:outline-none focus:border-border-focus mb-6"
          data-testid="display-pair-code-input"
          placeholder="e.g. display-front-1"
        />

        <label className="block text-text-muted text-xs uppercase tracking-widest mb-2">
          Device label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full bg-bg-input border border-border-subtle rounded-md px-4 py-3 text-text-primary mb-6"
          placeholder="Front counter screen"
        />

        {errorHint ? (
          <p
            className="text-danger text-sm mb-4"
            data-testid="display-pair-error"
            role="alert"
          >
            {errorHint}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className="w-full bg-gold text-bg-base font-semibold py-3 rounded-md transition-base hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="display-pair-submit"
        >
          {submitting ? 'Pairing…' : 'Pair display'}
        </button>
      </form>
    </div>
  );
}
