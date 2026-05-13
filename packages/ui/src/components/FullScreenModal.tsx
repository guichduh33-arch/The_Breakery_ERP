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
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-backdrop backdrop-blur-md z-50 motion-reduce:animate-none motion-reduce:transition-none"
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 bg-bg-base text-text-primary z-50 flex flex-col focus:outline-none',
            // motion-reduce: respect prefers-reduced-motion (TASK-22-009)
            'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:duration-0',
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
