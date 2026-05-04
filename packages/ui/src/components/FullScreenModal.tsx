import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface FullScreenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function FullScreenModal({
  open,
  onOpenChange,
  children,
  className,
}: FullScreenModalProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-backdrop backdrop-blur-md z-50" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 bg-bg-base text-text-primary z-50 flex flex-col focus:outline-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const FullScreenModalClose = DialogPrimitive.Close;
