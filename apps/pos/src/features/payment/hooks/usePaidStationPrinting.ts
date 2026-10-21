import { useEffect } from 'react';
import { toast } from 'sonner';
import type { PaymentAttempt } from '@/stores/paymentAttempt';
import type { UseFireToStationsResult } from '@/features/cart/hooks/useFireToStations';
import { useAuthStore } from '@/stores/authStore';

export function usePaidStationPrinting(attempt: PaymentAttempt | null, fire: UseFireToStationsResult['mutation']) {
  const mutateAsync = fire.mutateAsync;
  const profileId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    // Les anciens paiements confirmés n'ont pas de marqueur : ne jamais présumer une absence d'impression.
    if (!attempt?.result || attempt.offline || profileId !== attempt.context.userId) return;
    if (attempt.stationPrinting !== 'prepared') {
      toast.error('Kitchen print status unavailable — check print jobs before reprinting');
      return;
    }
    void mutateAsync({ orderNumber: attempt.result.orderNumber, printOnly: true, printSnapshot: attempt }).then((results) => {
      for (const result of results) if (!result.ok) toast.error(`${result.role} print unconfirmed — check print jobs before reprinting`);
    }).catch((error: unknown) => {
      toast.error(`Station print failed: ${error instanceof Error ? error.message : 'unknown'}`);
    });
  }, [attempt, mutateAsync, profileId]);
}
