import { useEffect, useState } from 'react';
import {
  CART_CHANNEL,
  PAYMENT_COMPLETE_DISPLAY_MS,
  type CartBroadcastMessage,
} from './useCartBroadcast';

/** Mount on the /display side: listens for cart snapshots + payment confirmations. */
export function useCartBroadcastReceiver(): CartBroadcastMessage | null {
  const [message, setMessage] = useState<CartBroadcastMessage | null>(null);
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    let revertTimer: ReturnType<typeof setTimeout> | undefined;
    bc.onmessage = (e: MessageEvent<CartBroadcastMessage>) => {
      const data = e.data;
      if (data?.type === 'cart_update') {
        // A new cart replaces the "Merci" screen immediately (next order started).
        clearTimeout(revertTimer);
        setMessage(data);
      } else if (data?.type === 'payment_complete') {
        // S57 C-D4 — show the thank-you / change screen, then revert to welcome.
        clearTimeout(revertTimer);
        setMessage(data);
        revertTimer = setTimeout(() => setMessage(null), PAYMENT_COMPLETE_DISPLAY_MS);
      }
    };
    return () => {
      clearTimeout(revertTimer);
      bc.close();
    };
  }, []);
  return message;
}
