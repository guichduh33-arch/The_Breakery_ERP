// apps/pos/src/features/cart/SendToKitchenButton.tsx
//
// "Send to Kitchen" CTA — locks all unlocked cart items so they can no longer
// be edited.
//
// V1 caveat (TODO session 2.1):
//   The real spec wants order_items to be inserted in DB with status='draft'
//   so that the KDS Realtime channel (postgres_changes on order_items) can
//   pick them up. As of v1 we only flip the cart-store lock + emit a Realtime
//   event via a dedicated `kitchen_tickets` payload (handled by the KDS agent).
//   The proper draft-order persistence needs a new RPC
//   (`create_draft_order_items`) — out of scope for this swarm batch.
//
// See task report for full discussion.
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useSendToKitchen } from './hooks/useSendToKitchen';

export function SendToKitchenButton() {
  const unlocked = useCartStore((s) => s.unlockedItems());
  const sendMutation = useSendToKitchen();

  const disabled = unlocked.length === 0 || sendMutation.isPending;

  async function handleClick() {
    if (disabled) return;
    try {
      await sendMutation.mutateAsync(unlocked.map((i) => i.id));
      toast.success(`Sent ${unlocked.length} item(s) to kitchen`);
    } catch (err) {
      const e = err as Error;
      toast.error(`Send to kitchen failed: ${e.message}`);
    }
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      className="w-full"
      disabled={disabled}
      onClick={() => { void handleClick(); }}
    >
      <Send className="h-4 w-4 mr-2" aria-hidden />
      {sendMutation.isPending ? 'Sending…' : 'Send to Kitchen'}
    </Button>
  );
}
