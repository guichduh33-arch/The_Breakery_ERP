import { lineTotalOf, type CartItem } from '@breakery/domain';
import { useLocalDisplayConnection } from './hooks/useCartBroadcastReceiver';
import { CustomerDisplayView } from './CustomerDisplayView';
import { BrandedLayout } from './components/BrandedLayout';
import { CDBrandPanel } from './components/CDBrandPanel';
import { CDPaymentPanel } from './components/CDPaymentPanel';
import { ShowcasePanel } from './components/ShowcasePanel';
import { useOrgDisplaySettings } from '@/features/settings/hooks/useOrgDisplaySettings';
import { useShowcaseProducts } from './hooks/useShowcaseProducts';
import { useAuthStore } from '@/stores/authStore';
import { useDisplayOrders } from './hooks/useDisplayOrders';
import { useReadyOrders } from './hooks/useReadyOrders';
import { useDisplayRealtime } from './hooks/useDisplayRealtime';
import { CurrentOrderCard } from './components/CurrentOrderCard';
import { OrderQueueTicker } from './components/OrderQueueTicker';

export function LocalCustomerDisplay({ source }: { source: string }) {
  const { message, connected } = useLocalDisplayConnection(source);
  const canReadCloud = useAuthStore((state) => state.isAuthenticated && state.bootstrapStatus === 'ready'
    && state.cloudValidated && !state.isLocked);
  const { displayFooterMessage, showcaseProductIds, showReadyOrders } = useOrgDisplaySettings(canReadCloud);
  const { data: showcase = [] } = useShowcaseProducts(showcaseProductIds, canReadCloud);
  const showQueue = connected && canReadCloud && showReadyOrders;
  const { data: orders = [] } = useDisplayOrders(showQueue);
  const { data: readyOrders = [] } = useReadyOrders(showQueue);
  useDisplayRealtime(source, showQueue);
  if (message?.type === 'cart_update' && message.cart.items.length) {
    return <CustomerDisplayView orderLabel={message.customer?.name ?? null} totals={message.totals}
      items={(message.cart.items as CartItem[]).map((item) => ({ ...item,
        line_total: Math.max(0, lineTotalOf(item) - (item.discount?.amount ?? 0)),
        modifiers: item.modifiers.map((modifier) => ({ label: modifier.option_label, price_adjustment: modifier.price_adjustment })),
      }))} />;
  }
  return <BrandedLayout footer={<span>{connected ? displayFooterMessage || 'Connected to checkout' : 'Connection to checkout lost — reopen this display from the POS menu'}</span>}>
    <div className="h-full flex gap-8"><div className="flex-1 flex min-h-0"><CDBrandPanel /></div>
      {message?.type === 'payment_complete' ? <div className="flex-1 flex min-h-0"><CDPaymentPanel message={message} /></div>
        : showQueue ? <div className="flex-1 min-h-0 flex flex-col gap-8">
          <CurrentOrderCard order={orders[0] ?? null} />
          <div className="flex-1 min-h-0"><OrderQueueTicker orders={orders.slice(1)} readyOrders={readyOrders} /></div>
        </div> : connected && canReadCloud && showcase.length > 0 ? <div className="flex-1 flex min-h-0"><ShowcasePanel products={showcase} /></div> : null}
    </div>
  </BrandedLayout>;
}
