import { useEffect, useState, type ReactNode } from 'react';
import { ShoppingBag, ChevronUp } from 'lucide-react';
import { Button, Currency, Sheet, SheetContent, SheetTitle, SheetDescription } from '@breakery/ui';

export function AdaptiveCartPanel({ children, count, total, summaryAction, desktopMinWidth = 1100, cartLabel = false }: {
  children: ReactNode; count: number; total: number; summaryAction?: ReactNode; desktopMinWidth?: number; cartLabel?: boolean;
}) {
  const [wide, setWide] = useState(() => window.innerWidth >= desktopMinWidth);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const resize = () => setWide(window.innerWidth >= desktopMinWidth);
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [desktopMinWidth]);
  if (wide) return <div className="w-[360px] shrink-0 min-h-0 flex flex-col">{children}</div>;
  return (
    <>
      <div className="shrink-0 flex items-center gap-2 border-t border-border-subtle bg-bg-elevated p-2" aria-label="Order summary">
        <Button variant="secondary" size="md" className={`flex-1 min-w-0 justify-between gap-2 ${cartLabel ? 'min-h-16 px-3 border-gold text-text-primary' : ''}`} onClick={() => setOpen(true)} aria-expanded={open} aria-label={cartLabel ? `Open cart, ${count} ${count === 1 ? 'item' : 'items'}` : undefined}>
          {cartLabel ? <>
            <ShoppingBag className="h-5 w-5 shrink-0 text-gold" aria-hidden />
            <span className="flex-1 min-w-0 text-left"><span className="block text-base font-semibold">Cart · {count}</span><Currency amount={total} className="text-sm" /></span>
            <ChevronUp className="h-5 w-5 shrink-0" aria-hidden />
          </> : <><span>View order · {count}</span><Currency amount={total} /></>}
        </Button>
        {summaryAction && <div className="shrink-0">{summaryAction}</div>}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="theme-pos h-[85vh] supports-[height:100dvh]:h-[85dvh] gap-0 rounded-t-xl pb-safe-bottom">
          <div className="shrink-0 p-4 pr-14 border-b border-border-subtle">
            <SheetTitle>{cartLabel ? 'Your cart' : 'Your order'}</SheetTitle>
            <SheetDescription>{count} items — review before continuing.</SheetDescription>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
