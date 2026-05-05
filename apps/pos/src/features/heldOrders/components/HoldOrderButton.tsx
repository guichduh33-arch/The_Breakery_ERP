import { PauseCircle } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useHoldOrder } from '../hooks/useHoldOrder';

interface HoldOrderButtonProps {
  disabled?: boolean;
}

export function HoldOrderButton({ disabled }: HoldOrderButtonProps) {
  const holdOrder = useHoldOrder();

  function handleClick() {
    const raw = window.prompt('Hold note (optional):');
    holdOrder(raw ?? undefined);
  }

  return (
    <Button
      variant="outlineGold"
      size="lg"
      className="w-full"
      onClick={handleClick}
      disabled={disabled}
    >
      <PauseCircle className="h-4 w-4 mr-2" aria-hidden />
      Hold
    </Button>
  );
}
