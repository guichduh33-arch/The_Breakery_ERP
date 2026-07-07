import { Currency } from '@breakery/ui';
import type { CartBroadcastMessage } from './hooks/useCartBroadcast';

interface Item {
  id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

export function CDActiveCartView({ message }: { message: CartBroadcastMessage | null }) {
  // S57 C-D4 — payment confirmation screen (thank-you + change to collect).
  if (message?.type === 'payment_complete') {
    const showChange = message.method === 'cash' && (message.change ?? 0) > 0;
    return (
      <div className="m-auto text-center space-y-4" data-testid="cd-payment-complete">
        <h2 className="font-serif text-6xl text-gold">Merci !</h2>
        <p className="text-text-secondary text-2xl">Paiement reçu</p>
        {showChange && (
          <div className="pt-2">
            <div className="text-text-secondary uppercase tracking-widest text-xs mb-1">
              Monnaie à rendre
            </div>
            <Currency
              amount={message.change ?? 0}
              emphasis="gold"
              className="text-5xl font-bold tabular-nums"
            />
          </div>
        )}
      </div>
    );
  }

  if (!message || message.cart.items.length === 0) {
    return (
      <div className="m-auto text-center space-y-2">
        <h2 className="font-serif text-3xl text-text-primary">Welcome to The Breakery</h2>
        <p className="text-text-secondary">Your order will appear here</p>
      </div>
    );
  }
  const items = message.cart.items as Item[];
  return (
    <div className="flex flex-col h-full p-8">
      <header className="mb-6">
        <h2 className="font-serif text-2xl text-text-primary">Your order</h2>
        {message.customer && <p className="text-text-secondary text-sm">{message.customer.name}</p>}
      </header>
      <ul className="flex-1 space-y-3 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between text-text-primary">
            <span>
              <span className="text-gold font-mono mr-2">{i.quantity}×</span>
              {i.name}
            </span>
            <Currency amount={i.unit_price * i.quantity} />
          </li>
        ))}
      </ul>
      <footer className="mt-6 pt-4 border-t border-border-subtle flex items-center justify-between">
        <span className="text-text-secondary uppercase tracking-widest text-xs">Total</span>
        <Currency amount={message.totals.total} emphasis="gold" className="text-3xl" />
      </footer>
    </div>
  );
}
