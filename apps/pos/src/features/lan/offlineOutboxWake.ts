const EVENT = 'breakery:offline-outbox-committed';
const CHANNEL = 'breakery:offline-outbox-wake.v1';
let channel: BroadcastChannel | null = null;
let subscribers = 0;

/** Signal sans contenu métier ; une notification perdue ne modifie jamais l'outbox. */
export function notifyOutboxCommitted(): void {
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const sender = channel ?? new BroadcastChannel(CHANNEL);
    sender.postMessage('changed');
    if (sender !== channel) sender.close();
  } catch { /* La reprise au prochain montage/reconnect reste disponible. */ }
}
export function subscribeOutboxCommitted(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  subscribers++;
  try {
    if (!channel && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => window.dispatchEvent(new Event(EVENT));
    }
  } catch { /* Le réveil dans l'onglet courant reste disponible. */ }
  return () => {
    window.removeEventListener(EVENT, listener);
    if (--subscribers === 0) { channel?.close(); channel = null; }
  };
}
