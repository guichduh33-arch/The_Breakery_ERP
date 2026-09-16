import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePOSReceiveStock, POSReceiveStockError } from './usePOSReceiveStock';
import { useReturnToKitchen, DisplayGestureError } from './useReturnToKitchen';
import { useWasteDisplay } from './useWasteDisplay';
import { useAdjustDisplay } from './useAdjustDisplay';
import type { POSStockProductRow } from './usePOSStockProducts';
import { isDisplayQuantity } from '../quantity';

type Kind = 'receive' | 'return' | 'waste' | 'adjust';
interface Attempt {
  kind: Kind;
  product: POSStockProductRow;
  quantity: number;
  reason: string;
  idempotencyKey: string;
  uncertain?: boolean;
}
function description(a: Attempt): string {
  return `${a.product.name}: ${a.kind === 'adjust' ? 'set display to' : a.kind} ${a.quantity} ${a.product.unit}`;
}

/** Une réponse perdue conserve le geste complet, jamais sa seule clé. */
export function useDisplayStockGestures(canManage: boolean) {
  const receive = usePOSReceiveStock();
  const returned = useReturnToKitchen();
  const waste = useWasteDisplay();
  const adjust = useAdjustDisplay();
  const attempts = useRef(new Map<string, Attempt>());
  const busy = useRef(new Set<string>());
  const [pending, setPending] = useState<Attempt[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const refresh = (): void => {
    setPending([...attempts.current.values()]);
    setRunning([...busy.current]);
  };
  async function execute(a: Attempt): Promise<boolean> {
    if (!canManage || busy.current.has(a.product.id)) return false;
    busy.current.add(a.product.id);
    attempts.current.set(a.product.id, a);
    refresh();
    try {
      const args = { productId: a.product.id, quantity: a.quantity, reason: a.reason, idempotencyKey: a.idempotencyKey };
      const result = a.kind === 'adjust'
        ? await adjust.mutateAsync({ productId: a.product.id, newQty: a.quantity, reason: a.reason, idempotencyKey: a.idempotencyKey })
        : await (a.kind === 'receive' ? receive : a.kind === 'return' ? returned : waste).mutateAsync(args);
      if (typeof result !== 'object' || result === null || Array.isArray(result)
        || result.product_id !== a.product.id || typeof result.new_display_stock !== 'number'
        || !Number.isFinite(result.new_display_stock)) throw new Error('Unconfirmed response');
      attempts.current.delete(a.product.id);
      setCompleted((previous) => ({ ...previous, [a.product.id]: (previous[a.product.id] ?? 0) + 1 }));
      const replay = typeof result === 'object' && result !== null && !Array.isArray(result) && result.idempotent_replay === true;
      const confirmation = `${a.product.name}: display stock ${result.new_display_stock} ${a.product.unit}.`;
      if (replay) toast.info(`Already recorded — ${confirmation}`);
      else toast.success(`Recorded — ${confirmation}`);
      return true;
    } catch (error) {
      const refused = (error instanceof POSReceiveStockError || error instanceof DisplayGestureError) && error.code !== 'unknown';
      if (refused && !a.uncertain) {
        attempts.current.delete(a.product.id);
        toast.error(error.code === 'insufficient_display_stock' ? 'Not enough display stock. Check the quantity.'
          : error.code === 'forbidden' ? 'You do not have permission to manage display stock.'
            : 'Operation refused. Check the product, quantity and reason.');
      } else {
        a.uncertain = true;
        toast.error(`Could not confirm ${description(a)}. Retry this same operation.`);
      }
      return false;
    } finally {
      busy.current.delete(a.product.id);
      refresh();
    }
  }
  async function submit(kind: Kind, product: POSStockProductRow, quantity: number, reason: string): Promise<boolean> {
    if (!canManage || !isDisplayQuantity(quantity) || (kind !== 'adjust' && quantity === 0)) return false;
    const existing = attempts.current.get(product.id);
    if (existing && (existing.kind !== kind || existing.quantity !== quantity || existing.reason !== reason)) return false;
    return execute(existing ?? { kind, product, quantity, reason, idempotencyKey: crypto.randomUUID() });
  }
  return { pending, running, completed, submit, retry: execute, description };
}
