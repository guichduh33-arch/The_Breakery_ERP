import { RefundLineRow, type RefundLineRowItem } from '@breakery/ui';

// Lignes sélectionnables de la modale de remboursement POS — checkbox + stepper.
const croissants: RefundLineRowItem = {
  order_item_id: 'oi-1',
  name: 'Croissant beurre',
  quantity: 3,
  line_total: 54_000,
  qty_already_refunded: 0,
  is_cancelled: false,
};

const lattes: RefundLineRowItem = {
  order_item_id: 'oi-2',
  name: 'Latte',
  quantity: 2,
  line_total: 64_000,
  qty_already_refunded: 0,
  is_cancelled: false,
};

const eclair: RefundLineRowItem = {
  order_item_id: 'oi-3',
  name: 'Éclair café',
  quantity: 1,
  line_total: 25_000,
  qty_already_refunded: 0,
  is_cancelled: false,
};

// Sélection en cours : ligne cochée entière, ligne partielle avec stepper, ligne non cochée.
export const Selection = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[520px] rounded-xl border border-border-subtle bg-bg-elevated px-2 py-1">
      <RefundLineRow item={croissants} selectedQty={3} refundAmount={54_000} onChange={() => {}} />
      <RefundLineRow item={lattes} selectedQty={1} refundAmount={32_000} onChange={() => {}} />
      <RefundLineRow item={eclair} selectedQty={0} refundAmount={0} onChange={() => {}} className="border-b-0" />
    </div>
  </div>
);

// États bloquants : déjà partiellement remboursée, annulée, entièrement remboursée.
export const Etats = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[520px] rounded-xl border border-border-subtle bg-bg-elevated px-2 py-1">
      <RefundLineRow
        item={{ order_item_id: 'oi-4', name: 'Pain au chocolat', quantity: 2, line_total: 40_000, qty_already_refunded: 1, is_cancelled: false }}
        selectedQty={1}
        refundAmount={20_000}
        onChange={() => {}}
      />
      <RefundLineRow
        item={{ order_item_id: 'oi-5', name: 'Baguette tradition', quantity: 1, line_total: 15_000, qty_already_refunded: 0, is_cancelled: true }}
        selectedQty={0}
        refundAmount={0}
        onChange={() => {}}
      />
      <RefundLineRow
        item={{ order_item_id: 'oi-6', name: "Jus d'orange pressé", quantity: 2, line_total: 56_000, qty_already_refunded: 2, is_cancelled: false }}
        selectedQty={0}
        refundAmount={0}
        onChange={() => {}}
        className="border-b-0"
      />
    </div>
  </div>
);
