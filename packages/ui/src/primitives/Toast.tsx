import { Toaster as Sonner } from 'sonner';
import type { ComponentProps } from 'react';

type ToasterProps = ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-bg-elevated group-[.toaster]:text-text-primary group-[.toaster]:border-border-subtle group-[.toaster]:shadow-md',
          description: 'group-[.toast]:text-text-secondary',
          actionButton: 'group-[.toast]:bg-gold group-[.toast]:text-bg-base',
          cancelButton: 'group-[.toast]:bg-bg-overlay group-[.toast]:text-text-muted',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
