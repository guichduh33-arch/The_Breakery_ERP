import { TenderRow } from '@breakery/ui';

const noop = () => {};

// A realistic split payment on the PaymentTerminal right panel — cash with
// overpay (received/change suffix), QRIS, and card, all removable.
export const SplitPayment = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-2 w-96">
    <TenderRow method="cash" amount={100000} cashReceived={150000} changeGiven={50000} onRemove={noop} />
    <TenderRow method="qris" amount={85000} onRemove={noop} />
    <TenderRow method="card" amount={64500} onRemove={noop} />
  </div>
);

// Method sweep — the remaining payment_method enum members, read-only rows
// (no remove button): EDC, bank transfer, store credit and the e-wallets.
export const MethodSweep = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-2 w-96">
    <TenderRow method="edc" amount={125000} />
    <TenderRow method="transfer" amount={4850000} />
    <TenderRow method="store_credit" amount={35000} />
    <TenderRow method="gopay" amount={57500} />
    <TenderRow method="ovo" amount={42000} />
    <TenderRow method="dana" amount={28500} />
  </div>
);
