import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';
import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

export function TabletCheckoutButton(): JSX.Element {
  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const clearCart = useTabletCartStore((s) => s.clearCart);
  const userId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const mutation = useCreateTabletOrder();

  const isEmpty = items.length === 0;

  function handleSend() {
    if (!userId) return;
    mutation.mutate(
      { cart: { items, tableNumber, orderType }, waiterId: userId },
      {
        onSuccess: () => {
          toast.success('Order sent to kitchen');
          clearCart();
          void navigate('/tablet/orders');
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to send order');
        },
      },
    );
  }

  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      disabled={isEmpty || mutation.isPending}
      onClick={handleSend}
    >
      Send to Kitchen
    </Button>
  );
}
