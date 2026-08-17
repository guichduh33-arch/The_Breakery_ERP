import { HeldOrdersModal, type HeldOrder } from '@breakery/ui';

// Modale plein écran des commandes en attente (POS) — état ouvert et REMPLI :
// 3 ardoises, dont une avec client attaché et une avec note serveur.
const now = Date.now();

const entries: HeldOrder[] = [
  {
    id: 'held-1',
    heldAt: new Date(now - 4 * 60_000).toISOString(),
    cart: {
      items: [
        { id: 'l1', product_id: 'p-croissant', name: 'Croissant beurre', unit_price: 18_000, quantity: 2, modifiers: [] },
        { id: 'l2', product_id: 'p-latte', name: 'Latte', unit_price: 32_000, quantity: 1, modifiers: [] },
      ],
      customerId: null,
      loyaltyPointsToRedeem: 0,
      orderType: 'take_out',
      tableNumber: null,
    },
    notes: 'Revient chercher à 15h',
  },
  {
    id: 'held-2',
    heldAt: new Date(now - 18 * 60_000).toISOString(),
    cart: {
      items: [
        { id: 'l3', product_id: 'p-baguette', name: 'Baguette tradition', unit_price: 15_000, quantity: 3, modifiers: [] },
        { id: 'l4', product_id: 'p-eclair', name: 'Éclair café', unit_price: 25_000, quantity: 2, modifiers: [] },
        { id: 'l5', product_id: 'p-jus', name: "Jus d'orange pressé", unit_price: 28_000, quantity: 1, modifiers: [] },
      ],
      customerId: 'cust-ibu-sari',
      loyaltyPointsToRedeem: 0,
      orderType: 'dine_in',
      tableNumber: 'T4',
    },
  },
  {
    id: 'held-3',
    heldAt: new Date(now - 65 * 60_000).toISOString(),
    cart: {
      items: [
        { id: 'l6', product_id: 'p-pain-choc', name: 'Pain au chocolat', unit_price: 20_000, quantity: 6, modifiers: [] },
      ],
      customerId: null,
      loyaltyPointsToRedeem: 0,
      orderType: 'take_out',
      tableNumber: null,
    },
    notes: 'Commande bureau — appeler avant',
  },
];

export const Ouvert = () => (
  <HeldOrdersModal
    open
    onClose={() => {}}
    entries={entries}
    onRestore={() => {}}
    onDelete={() => {}}
    cartHasItems={false}
  />
);
