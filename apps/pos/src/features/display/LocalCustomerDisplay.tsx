import { lineTotalOf, type CartItem } from '@breakery/domain';
import { useLocalDisplayConnection } from './hooks/useCartBroadcastReceiver';
import { CustomerDisplayView } from './CustomerDisplayView';
import { BrandedLayout } from './components/BrandedLayout';
import { CDBrandPanel } from './components/CDBrandPanel';
import { CDPaymentPanel } from './components/CDPaymentPanel';
import { ShowcasePanel } from './components/ShowcasePanel';
import { useOrgDisplaySettings } from '@/features/settings/hooks/useOrgDisplaySettings';
import { useShowcaseProducts } from './hooks/useShowcaseProducts';

export function LocalCustomerDisplay({ source }: { source: string }) {
  const { message, connected } = useLocalDisplayConnection(source);
  const { displayFooterMessage, showcaseProductIds } = useOrgDisplaySettings();
  const { data: showcase = [] } = useShowcaseProducts(showcaseProductIds, true);
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
        : connected && showcase.length > 0 ? <div className="flex-1 flex min-h-0"><ShowcasePanel products={showcase} /></div> : null}
    </div>
  </BrandedLayout>;
}
