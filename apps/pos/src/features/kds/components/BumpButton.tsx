// apps/pos/src/features/kds/components/BumpButton.tsx
//
// Session 13 / Phase 4.B — bump button that wraps the `kds_bump_item_v1`
// RPC. On success, surfaces an `UndoBumpToast` for 60 seconds.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { toast } from 'sonner';

import { useKdsBumpItem } from '../hooks/useKdsBumpItem';
import { UndoBumpToast } from './UndoBumpToast';

interface BumpButtonProps {
  orderItemId: string;
  disabled?: boolean;
}

export function BumpButton({ orderItemId, disabled }: BumpButtonProps) {
  const bump = useKdsBumpItem();
  const [showUndo, setShowUndo] = useState<{ ts: number } | null>(null);

  const handleClick = () => {
    bump.mutate(
      { orderItemId },
      {
        onSuccess: () => {
          setShowUndo({ ts: Date.now() });
        },
        onError: (err: Error & { code?: string }) => {
          toast.error(err.message || 'Could not bump item');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="gold"
        size="sm"
        onClick={handleClick}
        disabled={disabled || bump.isPending}
        aria-label="Bump item to ready"
      >
        Bump
      </Button>
      {showUndo && (
        <UndoBumpToast
          orderItemId={orderItemId}
          bumpedAtMs={showUndo.ts}
          onClose={() => setShowUndo(null)}
        />
      )}
    </>
  );
}
