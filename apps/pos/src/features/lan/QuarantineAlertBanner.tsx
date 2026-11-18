// apps/pos/src/features/lan/QuarantineAlertBanner.tsx
//
// S3-17 — ADR-018 D5 : alerte caisse PERSISTANTE quand un règlement hors ligne
// a été définitivement refusé au rejeu. C'est de l'argent déjà encaissé qui ne
// remontera pas sans geste humain : aucun bouton de fermeture, l'alerte reste
// tant que l'enregistrement existe (registre durable, sans purge — D4).
// D6 : aucun écran de correction ni rejeu forcé ; la consigne renvoie vers un
// manager, l'opération se ressaisit en caisse.

import type { JSX } from 'react';
import { useQuarantinedPayments } from './hooks/useQuarantinedPayments';

export function QuarantineAlertBanner(): JSX.Element | null {
  const payments = useQuarantinedPayments();
  if (payments.length === 0) return null;

  const count = payments.length;
  return (
    <div
      role="alert"
      data-testid="offline-quarantine-alert"
      className="px-4 py-2 text-sm text-red-as-text bg-danger-soft border-b border-danger"
    >
      <p className="font-semibold text-center">
        {count === 1
          ? '1 offline payment was rejected by the server and must be settled with a manager'
          : `${count} offline payments were rejected by the server and must be settled with a manager`}
      </p>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-0.5 text-xs">
        {payments.map((p) => (
          <li key={p.id} data-testid="offline-quarantine-item">
            <span className="font-mono font-semibold">{p.intent.local_number}</span>
            {' — '}
            {p.reason || 'Unknown reason'}
            {p.code ? ` (${p.code})` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
