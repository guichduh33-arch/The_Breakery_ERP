// apps/pos/src/features/kds/components/PrepTimer.tsx
//
// Session 13 / Phase 4.B — live MM:SS counter since `prep_started_at`.
// Re-renders every second via `useAgeTimer`. Colour-codes the value :
//   < 5 min  : neutral
//   5-10 min : amber-warn
//   >= 10 min : red
//
// Renders a dash when `prepStartedAt` is null (no timer started yet).

import { useAgeTimer } from '../hooks/useAgeTimer';

interface PrepTimerProps {
  /** ISO timestamp string. Pass `null` to render a placeholder. */
  prepStartedAt: string | null;
}

const FIVE_MIN_MS = 5 * 60 * 1_000;
const TEN_MIN_MS  = 10 * 60 * 1_000;

function format(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function colourClass(ms: number): string {
  if (ms >= TEN_MIN_MS) return 'text-red font-semibold';
  if (ms >= FIVE_MIN_MS) return 'text-amber-warn';
  return 'text-text-secondary';
}

export function PrepTimer({ prepStartedAt }: PrepTimerProps) {
  const now = useAgeTimer();

  if (!prepStartedAt) {
    return (
      <span
        className="font-mono text-xs text-text-muted"
        aria-label="Prep timer not started"
      >
        --:--
      </span>
    );
  }

  const startedMs = new Date(prepStartedAt).getTime();
  const elapsed = Number.isFinite(startedMs) ? Math.max(0, now - startedMs) : 0;

  return (
    <span
      className={`font-mono text-xs ${colourClass(elapsed)}`}
      aria-label={`Prep elapsed ${format(elapsed)}`}
    >
      {format(elapsed)}
    </span>
  );
}
