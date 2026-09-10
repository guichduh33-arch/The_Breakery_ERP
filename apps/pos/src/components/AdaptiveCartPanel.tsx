import { useEffect, useState, type ReactNode } from 'react';
import { Button, Currency, Sheet, SheetContent, SheetTitle, SheetDescription } from '@breakery/ui';

export function AdaptiveCartPanel({ children, count, total, summaryAction }: {
  children: ReactNode; count: number; total: number; summaryAction?: ReactNode;
}) {
  const [wide, setWide] = useState(() => window.innerWidth >= 1100);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const resize = () => setWide(window.innerWidth >= 1100);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  if (wide) return <div className="w-[360px] shrink-0 min-h-0 flex flex-col">{children}</div>;
  return (
    <>
      <div className="shrink-0 flex items-center gap-2 border-t border-border-subtle bg-bg-elevated p-2" aria-label="Order summary">
        <Button variant="secondary" size="md" className="flex-1 min-w-0 justify-between gap-2" onClick={() => setOpen(true)} aria-expanded={open}>
          <span>View order · {count}</span><Currency amount={total} />
        </Button>
        {summaryAction && <div className="shrink-0">{summaryAction}</div>}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="theme-pos h-[85dvh] gap-0 rounded-t-xl pb-safe-bottom">
          <div className="shrink-0 p-4 pr-14 border-b border-border-subtle">
            <SheetTitle>Your order</SheetTitle>
            <SheetDescription>{count} items — review before continuing.</SheetDescription>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
