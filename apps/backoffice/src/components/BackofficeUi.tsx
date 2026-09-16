// Adaptations de présentation Instrument. Les primitives gardent leurs refs,
// événements et contrats ; les dimensions de la caisse restent dans @breakery/ui.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import {
  Button as UiButton,
  Card as UiCard, CardHeader as UiCardHeader, CardContent as UiCardContent,
  CardFooter as UiCardFooter, CardTitle as UiCardTitle,
  DialogContent as UiDialogContent, DialogHeader as UiDialogHeader,
  DialogFooter as UiDialogFooter, DialogTitle as UiDialogTitle,
  SheetContent as UiSheetContent, SheetHeader as UiSheetHeader,
  SheetFooter as UiSheetFooter, SheetTitle as UiSheetTitle,
  TabsList as UiTabsList, TabsTrigger as UiTabsTrigger,
  EmptyState as UiEmptyState, KpiTile as UiKpiTile, DataTable as UiDataTable,
  cn,
} from '@breakery/ui';
import type { DataTableProps, EmptyStateProps, KpiTileProps } from '@breakery/ui';

export const Button = forwardRef<ElementRef<typeof UiButton>, ComponentPropsWithoutRef<typeof UiButton>>(
  ({ className, variant = 'ink', size = 'sm', ...props }, ref) => (
    <UiButton ref={ref} variant={variant === 'primary' ? 'ink' : variant} size={size} className={cn(
      'font-medium normal-case tracking-normal active:scale-100',
      size === 'icon' && 'h-9 w-9', className,
    )} {...props} />
  ),
);
Button.displayName = 'BackofficeButton';

export const Card = forwardRef<ElementRef<typeof UiCard>, ComponentPropsWithoutRef<typeof UiCard>>(
  ({ className, ...props }, ref) => <UiCard ref={ref} className={cn('bo-card min-w-0 rounded-md shadow-none', className)} {...props} />,
);
Card.displayName = 'BackofficeCard';

export const CardHeader = forwardRef<ElementRef<typeof UiCardHeader>, ComponentPropsWithoutRef<typeof UiCardHeader>>(
  ({ className, ...props }, ref) => <UiCardHeader ref={ref} className={cn('p-5 pb-3', className)} {...props} />,
);
CardHeader.displayName = 'BackofficeCardHeader';

export const CardContent = forwardRef<ElementRef<typeof UiCardContent>, ComponentPropsWithoutRef<typeof UiCardContent>>(
  ({ className, ...props }, ref) => <UiCardContent ref={ref} className={cn('min-w-0 p-5 pt-0', className)} {...props} />,
);
CardContent.displayName = 'BackofficeCardContent';

export const CardFooter = forwardRef<ElementRef<typeof UiCardFooter>, ComponentPropsWithoutRef<typeof UiCardFooter>>(
  ({ className, ...props }, ref) => <UiCardFooter ref={ref} className={cn('flex-wrap gap-2 p-5 pt-0', className)} {...props} />,
);
CardFooter.displayName = 'BackofficeCardFooter';

export const CardTitle = forwardRef<ElementRef<typeof UiCardTitle>, ComponentPropsWithoutRef<typeof UiCardTitle>>(
  ({ className, ...props }, ref) => <UiCardTitle ref={ref} className={cn('font-body text-lg font-medium tracking-tight', className)} {...props} />,
);
CardTitle.displayName = 'BackofficeCardTitle';

export const DialogContent = forwardRef<ElementRef<typeof UiDialogContent>, ComponentPropsWithoutRef<typeof UiDialogContent>>(
  ({ className, ...props }, ref) => <UiDialogContent ref={ref} className={cn('bo-dialog min-w-0 rounded-md p-5', className)} {...props} />,
);
DialogContent.displayName = 'BackofficeDialogContent';

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<typeof UiDialogHeader>) {
  return <UiDialogHeader className={cn('border-b border-border-subtle pb-4 pr-8 text-left', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<typeof UiDialogFooter>) {
  return <UiDialogFooter className={cn('gap-2 border-t border-border-subtle pt-4 sm:space-x-0', className)} {...props} />;
}

export const DialogTitle = forwardRef<ElementRef<typeof UiDialogTitle>, ComponentPropsWithoutRef<typeof UiDialogTitle>>(
  ({ className, ...props }, ref) => <UiDialogTitle ref={ref} className={cn('font-body text-lg font-medium tracking-tight', className)} {...props} />,
);
DialogTitle.displayName = 'BackofficeDialogTitle';

export const SheetContent = forwardRef<ElementRef<typeof UiSheetContent>, ComponentPropsWithoutRef<typeof UiSheetContent>>(
  ({ className, ...props }, ref) => <UiSheetContent ref={ref} className={cn('bo-sheet min-w-0', className)} {...props} />,
);
SheetContent.displayName = 'BackofficeSheetContent';

export function SheetHeader({ className, ...props }: ComponentPropsWithoutRef<typeof UiSheetHeader>) {
  return <UiSheetHeader className={cn('border-b border-border-subtle p-5 pr-12', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentPropsWithoutRef<typeof UiSheetFooter>) {
  return <UiSheetFooter className={cn('bg-bg-elevated p-5', className)} {...props} />;
}

export const SheetTitle = forwardRef<ElementRef<typeof UiSheetTitle>, ComponentPropsWithoutRef<typeof UiSheetTitle>>(
  ({ className, ...props }, ref) => <UiSheetTitle ref={ref} className={cn('font-body text-lg font-medium tracking-tight', className)} {...props} />,
);
SheetTitle.displayName = 'BackofficeSheetTitle';

export const TabsList = forwardRef<ElementRef<typeof UiTabsList>, ComponentPropsWithoutRef<typeof UiTabsList>>(
  ({ className, ...props }, ref) => <UiTabsList ref={ref} className={cn('bo-tabs-list h-auto w-full flex-wrap justify-start gap-x-5 rounded-none bg-transparent p-0', className)} {...props} />,
);
TabsList.displayName = 'BackofficeTabsList';

export const TabsTrigger = forwardRef<ElementRef<typeof UiTabsTrigger>, ComponentPropsWithoutRef<typeof UiTabsTrigger>>(
  ({ className, ...props }, ref) => <UiTabsTrigger ref={ref} className={cn('bo-tabs-trigger rounded-none px-0 py-3 font-medium', className)} {...props} />,
);
TabsTrigger.displayName = 'BackofficeTabsTrigger';

export function EmptyState({ className, actionVariant = 'ink', headingLevel = 'h2', ...props }: EmptyStateProps) {
  return <UiEmptyState headingLevel={headingLevel} actionVariant={actionVariant} className={cn('bo-empty', className)} {...props} />;
}

export function KpiTile({ className, ...props }: KpiTileProps) {
  return <UiKpiTile className={cn('bo-kpi min-w-0 gap-2 p-4 shadow-none', className)} {...props} />;
}

export function DataTable<TRow>({ className, density = 'compact', ...props }: DataTableProps<TRow>) {
  return <UiDataTable density={density} announceRowExpansion={false} className={cn('bo-table min-w-0', className)} {...props} />;
}
