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
      const declaration = a.kind === 'waste';
      if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Unconfirmed response');
      const declarationStatus = typeof result.status === 'string' ? result.status : '';
      if (declaration) {
        if (typeof result.declaration_id !== 'string' || !['pending','approved','rejected'].includes(declarationStatus)
          || typeof result.display_withdrawal_applied !== 'boolean' || typeof result.idempotent_replay !== 'boolean') throw new Error('Unconfirmed declaration');
      } else if (result.product_id !== a.product.id ||
        (result.new_display_stock !== null && (typeof result.new_display_stock !== 'number' || !Number.isFinite(result.new_display_stock)))) {
        throw new Error('Unconfirmed response');
      }
      if (a.kind === 'adjust' && (typeof result.effect_id !== 'string' || result.effect_id.length === 0
        || typeof result.idempotent_replay !== 'boolean')) throw new Error('Unconfirmed display update');
      attempts.current.delete(a.product.id);
      setCompleted((previous) => ({ ...previous, [a.product.id]: (previous[a.product.id] ?? 0) + 1 }));
      const replay = typeof result === 'object' && result !== null && !Array.isArray(result) && result.idempotent_replay === true;
      const confirmation = declaration
        ? result.display_withdrawal_applied
          ? declarationStatus === 'pending'
            ? `${a.product.name}: removed from the display. Global stock awaits owner approval.`
            : declarationStatus === 'rejected'
              ? `${a.product.name}: declaration already rejected. Display quantity is not restored; global stock approval was rejected.`
              : `${a.product.name}: declaration already approved. Display quantity was removed; global stock is approved.`
          : declarationStatus === 'pending'
            ? `${a.product.name}: previous declaration awaits owner approval. Display withdrawal is pending.`
            : `${a.product.name}: declaration already ${declarationStatus}. No new stock operation was recorded.`
        : `${a.product.name}: operation recorded.`;
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
