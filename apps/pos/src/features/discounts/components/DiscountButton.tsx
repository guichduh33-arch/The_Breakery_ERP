// apps/pos/src/features\discounts\components\DiscountButton.tsx
import { Tag } from 'lucide-react';
import { Button } from '@breakery/ui';

interface DiscountButtonProps {
  onClick: () => void;
  hasDiscount: boolean;
}

export function DiscountButton({ onClick, hasDiscount }: DiscountButtonProps) {
  return (
    <Button
      variant={hasDiscount ? 'primary' : 'secondary'}
      size="sm"
      onClick={onClick}
      className="w-full"
      aria-label="Apply cart discount"
    >
      <Tag className="h-4 w-4 mr-2" aria-hidden />
      {hasDiscount ? 'Edit Discount' : 'Discount'}
    </Button>
  );
}
