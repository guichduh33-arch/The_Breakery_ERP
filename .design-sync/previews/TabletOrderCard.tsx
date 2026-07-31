import { TabletOrderCard, type TabletOrderCardOrder } from '@breakery/ui';

const noop = () => {};

// Ages are computed live against Date.now() — anchor the timestamps at module
// load so the timer pill shows a plausible in-service age at capture.
const minutesAgo = (m: number, s = 0) => new Date(Date.now() - (m * 60 + s) * 1000).toISOString();

// Dine-in order still awaiting payment — mixed kitchen progress per line,
// cancel escape hatch visible (pending_payment + onCancel).
const table6: TabletOrderCardOrder = {
  id: 'ord-1',
  order_number: 'T-0142',
  table_number: 'Table 6',
  order_type: 'dine_in',
  sent_to_kitchen_at: minutesAgo(4, 32),
  status: 'pending_payment',
  items: [
    { id: 'i-1', name: 'Croissant au beurre', quantity: 2, kitchen_status: 'ready' },
    { id: 'i-2', name: 'Es kopi susu', quantity: 2, kitchen_status: 'preparing' },
    { id: 'i-3', name: 'Kouign-amann', quantity: 1, kitchen_status: 'pending' },
  ],
};

export const PendingPaymentDineIn = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96">
    <TabletOrderCard order={table6} onCancel={noop} />
  </div>
);

// Paid take-out nearly done — served lines strike through, no cancel footer.
const takeOut: TabletOrderCardOrder = {
  id: 'ord-2',
  order_number: 'T-0139',
  table_number: null,
  order_type: 'take_out',
  sent_to_kitchen_at: minutesAgo(11, 8),
  status: 'paid',
  items: [
    { id: 'i-4', name: 'Sourdough country loaf', quantity: 1, kitchen_status: 'served' },
    { id: 'i-5', name: 'Pain au chocolat', quantity: 3, kitchen_status: 'served' },
    { id: 'i-6', name: 'Cold brew bottle', quantity: 2, kitchen_status: 'ready' },
  ],
};

export const PaidTakeOut = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96">
    <TabletOrderCard order={takeOut} />
  </div>
);
