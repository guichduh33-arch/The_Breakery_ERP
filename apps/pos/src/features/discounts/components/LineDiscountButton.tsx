// apps/pos/src/features/discounts/components/LineDiscountButton.tsx
import { Tag } from 'lucide-react';
import { Button } from '@breakery/ui';

interface LineDiscountButtonProps {
  onClick: () => void;
  hasDiscount: boolean;
}

export function LineDiscountButton({ onClick, hasDiscount }: LineDiscountButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={hasDiscount ? 'Edit line discount' : 'Apply line discount'}
      className={hasDiscount ? 'text-gold' : 'text-text-muted hover:text-text-primary'}
    >
      <Tag className="h-4 w-4" aria-hidden />
    </Button>
  );
}
