import { useEffect, useState } from 'react';
import { displayChannel, getDisplaySourceId } from '../displaySource';
import { PAYMENT_COMPLETE_DISPLAY_MS, type CartBroadcastMessage } from './useCartBroadcast';

export function useLocalDisplayConnection(source: string) {
  const [message, setMessage] = useState<CartBroadcastMessage | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const bc = new BroadcastChannel(displayChannel(source));
    let lastSeen = 0;
    let revertTimer: ReturnType<typeof setTimeout> | undefined;
    bc.onmessage = (event: MessageEvent<CartBroadcastMessage | { type: 'presence' }>) => {
      const data = event.data;
      if (!data || !['cart_update', 'payment_complete', 'presence'].includes(data.type)) return;
      lastSeen = Date.now();
      setConnected(true);
      if (data.type === 'presence') return;
      clearTimeout(revertTimer);
      setMessage(data);
      if (data.type === 'payment_complete') revertTimer = setTimeout(() => setMessage(null), PAYMENT_COMPLETE_DISPLAY_MS);
    };
    bc.postMessage({ type: 'request_state' });
    const watch = setInterval(() => {
      if (!lastSeen || Date.now() - lastSeen > 6500) {
        setConnected(false);
        setMessage(null);
        bc.postMessage({ type: 'request_state' });
      }
    }, 2000);
    return () => { clearTimeout(revertTimer); clearInterval(watch); bc.close(); };
  }, [source]);
  return { message, connected };
}

export function useCartBroadcastReceiver(): CartBroadcastMessage | null {
  return useLocalDisplayConnection(new URLSearchParams(window.location.search).get('source') ?? getDisplaySourceId()).message;
}
