// apps/pos/src/features/kds/components/PrepTimer.tsx
//
// Session 13 / Phase 4.B — live MM:SS counter since `prep_started_at`.
// Re-renders every second via `useAgeTimer`. Colour-codes the value against
// the same `useKdsConfig()` thresholds (business_config
// kds_warning_threshold_minutes / kds_urgent_threshold_minutes) that drive
// the ticket border in KdsOrderCard, so both signals on a given ticket
// escalate together instead of the border following BO config while this
// timer stayed pinned to the old hardcoded 5/10 min constants:
//   < warning        : neutral
//   warning..urgent  : amber-warn
//   >= urgent         : red
//
// Renders a dash when `prepStartedAt` is null (no timer started yet).

import { useAgeTimer } from '../hooks/useAgeTimer';
import { useKdsConfig, type KdsConfig } from '../hooks/useKdsConfig';

interface PrepTimerProps {
  /** ISO timestamp string. Pass `null` to render a placeholder. */
  prepStartedAt: string | null;
}

function format(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function colourClass(ms: number, cfg: KdsConfig): string {
  if (ms >= cfg.urgentMs) return 'text-red-as-text font-semibold';
  if (ms >= cfg.warningMs) return 'text-amber-warn';
  return 'text-text-secondary';
}

export function PrepTimer({ prepStartedAt }: PrepTimerProps) {
  const now = useAgeTimer();
  const cfg = useKdsConfig();

  if (!prepStartedAt) {
    return (
      <span
        className="font-mono text-lg text-text-muted"
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
      className={`font-mono text-lg ${colourClass(elapsed, cfg)}`}
      aria-label={`Prep elapsed ${format(elapsed)}`}
    >
      {format(elapsed)}
    </span>
  );
}
