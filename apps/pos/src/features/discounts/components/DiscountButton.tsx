// apps/pos/src/features\discounts\components\DiscountButton.tsx
import { Tag } from 'lucide-react';
import { Button } from '@breakery/ui';

interface DiscountButtonProps {
  onClick: () => void;
  hasDiscount: boolean;
}

export function DiscountButton({ onClick, hasDiscount }: DiscountButtonProps) {
  // Audit 2026-08-24 (responsive P1) — la remise modifie le montant
  // encaissé : Règle des 56, pas le h-9 de size sm.
  return (
    <Button
      variant={hasDiscount ? 'primary' : 'secondary'}
      size="md"
      onClick={onClick}
      className="w-full"
      aria-label="Apply cart discount"
    >
      <Tag className="h-4 w-4 mr-2" aria-hidden />
      {hasDiscount ? 'Edit Discount' : 'Discount'}
    </Button>
  );
}
