import { RefundReceiptModal } from '@breakery/ui';

// Confirmation post-remboursement — plein écran, accent danger, ventilation par tender.
export const Remboursement = () => (
  <RefundReceiptModal
    open
    refundNumber="RF-2026-0042"
    orderNumber="BRK-0834"
    totalRefunded={86_000}
    tenders={[
      { method: 'cash', amount: 50_000 },
      { method: 'qris', amount: 36_000 },
    ]}
    isFullVoid={false}
    onClose={() => {}}
  />
);

// Variante void intégral — même reçu, en-tête « Order Voided », tender unique.
export const Annulation = () => (
  <RefundReceiptModal
    open
    refundNumber="RF-2026-0043"
    orderNumber="BRK-0851"
    totalRefunded={132_000}
    tenders={[{ method: 'card', amount: 132_000 }]}
    isFullVoid
    onClose={() => {}}
  />
);
