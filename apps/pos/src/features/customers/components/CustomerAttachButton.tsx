// apps/pos/src/features/customers/components/CustomerAttachButton.tsx
import { UserPlus } from 'lucide-react';
import { Button } from '@breakery/ui';

interface CustomerAttachButtonProps {
  onClick: () => void;
}

export function CustomerAttachButton({ onClick }: CustomerAttachButtonProps) {
  return (
    <Button variant="outlineGold" size="sm" className="w-full" onClick={onClick}>
      <UserPlus className="h-4 w-4 mr-2" aria-hidden />
      Attach Customer
    </Button>
  );
}
