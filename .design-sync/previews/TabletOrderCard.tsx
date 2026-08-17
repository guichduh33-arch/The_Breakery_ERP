import { TabletOrderCard, type TabletOrderCardOrder } from '@breakery/ui';

// Cartes de suivi côté tablette serveur — statut commande + pastilles cuisine par ligne.
const now = Date.now();

const enCours: TabletOrderCardOrder = {
  id: 'ord-1',
  order_number: 'BRK-0841',
  table_number: 'T4',
  order_type: 'dine_in',
  sent_to_kitchen_at: new Date(now - 4 * 60_000 - 12_000).toISOString(),
  status: 'pending_payment',
  items: [
    { id: 'i1', name: 'Croissant beurre', quantity: 2, kitchen_status: 'preparing' },
    { id: 'i2', name: 'Latte', quantity: 1, kitchen_status: 'ready' },
    { id: 'i3', name: 'Baguette tradition', quantity: 1, kitchen_status: 'pending' },
    { id: 'i4', name: 'Éclair café', quantity: 2, kitchen_status: 'preparing' },
  ],
};

const payee: TabletOrderCardOrder = {
  id: 'ord-2',
  order_number: 'BRK-0836',
  table_number: 'T2',
  order_type: 'dine_in',
  sent_to_kitchen_at: new Date(now - 22 * 60_000).toISOString(),
  status: 'paid',
  items: [
    { id: 'i5', name: 'Pain au chocolat', quantity: 3, kitchen_status: 'served' },
    { id: 'i6', name: 'Café allongé', quantity: 2, kitchen_status: 'served' },
  ],
};

const annulee: TabletOrderCardOrder = {
  id: 'ord-3',
  order_number: 'BRK-0829',
  table_number: null,
  order_type: 'take_out',
  sent_to_kitchen_at: new Date(now - 38 * 60_000).toISOString(),
  status: 'voided',
  items: [
    { id: 'i7', name: "Jus d'orange pressé", quantity: 1, kitchen_status: 'pending' },
  ],
};

// Commande en attente de paiement — cuisine en cours, annulation encore possible.
export const EnCours = () => (
  <div className="w-[420px] bg-bg-base p-6">
    <TabletOrderCard order={enCours} onCancel={() => {}} />
  </div>
);

// Panorama des statuts : payée (lignes servies barrées) et annulée.
export const Statuts = () => (
  <div className="grid w-[840px] grid-cols-2 gap-4 bg-bg-base p-6">
    <TabletOrderCard order={payee} />
    <TabletOrderCard order={annulee} />
  </div>
);
