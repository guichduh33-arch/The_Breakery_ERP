// apps/pos/src/features/audit/PosEventOutboxMount.tsx
//
// S72 Lot 2 — mounts the audit-journal outbox flusher at the App shell (mirror
// of IdleTimeoutMount), so it runs across every POS route — counter, tablet and
// KDS alike. It flushes: once on mount (drains a backlog left by a prior offline
// span or restart), on the browser `online` event (reconnect), and on a slow
// interval as a safety net. Emission itself is handled by emitPosEvent; this
// component only drives the drain. Renders nothing.

import { useEffect } from 'react';
import { flushPosEvents } from './emitPosEvent';

const FLUSH_INTERVAL_MS = 30_000;

export function PosEventOutboxMount(): null {
  useEffect(() => {
    void flushPosEvents();

    const onOnline = (): void => {
      void flushPosEvents();
    };
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => void flushPosEvents(), FLUSH_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, []);

  return null;
}
