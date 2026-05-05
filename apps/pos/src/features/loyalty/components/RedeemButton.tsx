// apps/pos/src/features/loyalty/components/RedeemButton.tsx
import { Gift } from 'lucide-react';
import { Button } from '@breakery/ui';

interface RedeemButtonProps {
  balance: number;
  onClick: () => void;
  disabled?: boolean;
}

export function RedeemButton({ balance, onClick, disabled }: RedeemButtonProps) {
  const canRedeem = balance >= 100;
  return (
    <Button
      variant="outlineGold"
      size="sm"
      className="w-full"
      onClick={onClick}
      disabled={!canRedeem || disabled === true}
      title={!canRedeem ? 'Minimum 100 points to redeem' : undefined}
    >
      <Gift className="h-4 w-4 mr-2" aria-hidden />
      Redeem Points ({balance.toLocaleString()} pts)
    </Button>
  );
}
