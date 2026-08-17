import { TabletInboxRow, type TabletOrderEntry } from '@breakery/ui';

// Inbox caisse des commandes tablette envoyées en cuisine — pickup pour encaisser.
const now = Date.now();

const dineIn: TabletOrderEntry = {
  id: 'ord-1',
  order_number: 'BRK-0841',
  table_number: 'T4',
  order_type: 'dine_in',
  waiter_id: 'w-1',
  waiter_name: 'Ayu Lestari',
  sent_to_kitchen_at: new Date(now - 3 * 60_000 - 24_000).toISOString(),
  items_count: 4,
  active_items_count: 4,
  items_total: 156_000,
  notes: 'Sans gluten — allergie table 4',
};

const takeOut: TabletOrderEntry = {
  id: 'ord-2',
  order_number: 'BRK-0842',
  table_number: null,
  order_type: 'take_out',
  waiter_id: 'w-2',
  waiter_name: 'Made Wira',
  sent_to_kitchen_at: new Date(now - 47_000).toISOString(),
  items_count: 2,
  active_items_count: 2,
  items_total: 58_000,
  notes: null,
};

const emptied: TabletOrderEntry = {
  id: 'ord-3',
  order_number: 'BRK-0838',
  table_number: 'T2',
  order_type: 'dine_in',
  waiter_id: 'w-1',
  waiter_name: 'Ayu Lestari',
  sent_to_kitchen_at: new Date(now - 12 * 60_000).toISOString(),
  items_count: 3,
  active_items_count: 0,
  items_total: 0,
  notes: null,
};

// File d'attente : dine-in avec note allergie + take-out tout frais.
export const Inbox = () => (
  <div className="flex w-[820px] flex-col gap-3 bg-bg-base p-6">
    <TabletInboxRow entry={dineIn} onPickup={() => {}} />
    <TabletInboxRow entry={takeOut} onPickup={() => {}} />
  </div>
);

// Commande vidée par cancel-item (ADR-010) — plus rien à encaisser, bouton Close.
export const Videe = () => (
  <div className="w-[820px] bg-bg-base p-6">
    <TabletInboxRow entry={emptied} onPickup={() => {}} onClose={() => {}} />
  </div>
);
