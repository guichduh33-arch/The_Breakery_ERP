import { TenderRow } from '@breakery/ui';

// Un règlement par famille : cash, carte, QRIS — avec X de suppression.
export const Methodes = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm space-y-2">
      <TenderRow method="cash" amount={50000} onRemove={() => {}} />
      <TenderRow method="card" amount={125000} onRemove={() => {}} />
      <TenderRow method="qris" amount={68000} onRemove={() => {}} />
    </div>
  </div>
);

// Cash avec rendu monnaie : reçu 100.000 pour 68.000, monnaie 32.000.
export const RenduMonnaie = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm">
      <TenderRow
        method="cash"
        amount={68000}
        cashReceived={100000}
        changeGiven={32000}
        onRemove={() => {}}
      />
    </div>
  </div>
);

// E-wallets individuels (ADR-006) + transfer et store credit, sans suppression.
export const EWallets = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm space-y-2">
      <TenderRow method="gopay" amount={45000} />
      <TenderRow method="ovo" amount={36000} />
      <TenderRow method="dana" amount={27000} />
      <TenderRow method="transfer" amount={250000} />
      <TenderRow method="store_credit" amount={15000} />
    </div>
  </div>
);
