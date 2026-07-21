import { useRef, type JSX } from 'react';
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
  const notes = useTabletCartStore((s) => s.notes);
  const clearCart = useTabletCartStore((s) => s.clearCart);
  const userId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const mutation = useCreateTabletOrder();
  const clientUuidRef = useRef<string>(crypto.randomUUID());

  const isEmpty = items.length === 0;

  function handleSend() {
    if (!userId) return;
    mutation.mutate(
      {
        cart: { items, tableNumber, orderType, notes },
        waiterId: userId,
        clientUuid: clientUuidRef.current,
      },
      {
        onSuccess: ({ orderId, localNumber }) => {
          clearCart();
          clientUuidRef.current = crypto.randomUUID();
          // Spec 006x lot 4 — envoi parti par le bus LAN : la commande n'existe
          // pas encore en cloud, la liste des commandes ne la montrera pas.
          // On reste sur la prise de commande, numéro local en confirmation.
          if (orderId === null) {
            toast.success(`Commande ${localNumber ?? ''} envoyée en cuisine (hors-ligne)`);
            return;
          }
          toast.success('Order sent to kitchen');
          void navigate('/tablet/orders', { state: { justSentOrderId: orderId } });
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
