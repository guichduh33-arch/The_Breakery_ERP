import { useEffect, useState } from 'react';
import { CART_CHANNEL, type CartBroadcastMessage } from './useCartBroadcast';

/** Mount on the /display side: listens for cart snapshots. */
export function useCartBroadcastReceiver(): CartBroadcastMessage | null {
  const [message, setMessage] = useState<CartBroadcastMessage | null>(null);
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    bc.onmessage = (e: MessageEvent<CartBroadcastMessage>) => {
      if (e.data?.type === 'cart_update') setMessage(e.data);
    };
    return () => {
      bc.close();
    };
  }, []);
  return message;
}
