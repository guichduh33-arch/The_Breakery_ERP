// apps/pos/src/features/cart/SendToKitchenButton.tsx
// Fires prep tickets to all mapped station printers for unprinted cart items.
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useFireToStations } from './hooks/useFireToStations';

export function SendToKitchenButton() {
  const unprintedCount = useCartStore((s) => s.unprintedItems().length);
  const fireMutation = useFireToStations();

  const disabled = unprintedCount === 0 || fireMutation.isPending;

  async function handleClick() {
    if (disabled) return;
    const rawTable = useCartStore.getState().cart.tableNumber;
    const ctx = rawTable ? { tableNumber: rawTable } : {};
    try {
      const results = await fireMutation.mutateAsync(ctx);
      // Toast per station — honest about partial failures.
      for (const r of results) {
        if (r.ok) {
          toast.success(`Sent to ${r.role} (${r.itemIds.length} item(s))`);
        } else {
          toast.error(`${r.role} printer unreachable — not printed`);
        }
      }
      // Edge case: all items mapped to 'none' / no stations returned.
      if (results.length === 0) {
        toast.success('Items locked (no station printers configured)');
      }
    } catch (err) {
      const e = err as Error;
      toast.error(`Fire to stations failed: ${e.message}`);
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
      {fireMutation.isPending ? 'Sending…' : 'Send to Kitchen'}
    </Button>
  );
}
