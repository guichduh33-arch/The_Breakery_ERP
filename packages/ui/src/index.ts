// lib
export { cn } from './lib/cn.js';

// primitives
export { Button, buttonVariants, type ButtonProps } from './primitives/Button.js';
export { Input, type InputProps } from './primitives/Input.js';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './primitives/Dialog.js';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './primitives/Tabs.js';
export { ScrollArea, ScrollBar } from './primitives/ScrollArea.js';
export { Separator } from './primitives/Separator.js';
export { Badge, badgeVariants, type BadgeProps } from './primitives/Badge.js';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
  type CardProps,
} from './primitives/Card.js';
export { Toaster } from './primitives/Toast.js';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  type SheetContentProps,
} from './primitives/Sheet.js';
export { EmptyState, type EmptyStateProps } from './primitives/EmptyState.js';

// app shell components
export { SkipToContent, type SkipToContentProps } from './components/SkipToContent.js';

// design-system signature components (Session 14 / Phase 1.A)
export { SectionLabel, type SectionLabelProps } from './components/SectionLabel.js';
export { BrandMark, type BrandMarkProps, type BrandMarkSize } from './components/BrandMark.js';
export {
  KpiTile,
  type KpiTileProps,
  type KpiDelta,
  type KpiDeltaDirection,
  type KpiValueFormat,
} from './components/KpiTile.js';
export { Stat, type StatProps, type StatDirection } from './components/Stat.js';

// domain components
export { Numpad, type NumpadProps } from './components/Numpad.js';
export { NumpadPin, type NumpadPinProps } from './components/NumpadPin.js';
export { Currency, type CurrencyProps } from './components/Currency.js';
export { QuantityStepper, type QuantityStepperProps } from './components/QuantityStepper.js';
export { OrderTypeTabs, type OrderTypeTabsProps } from './components/OrderTypeTabs.js';
export {
  FullScreenModal,
  FullScreenModalClose,
  type FullScreenModalProps,
} from './components/FullScreenModal.js';
export {
  ModifierModal,
  type ModifierModalProps,
  type ModifierModalProduct,
} from './components/ModifierModal.js';
export {
  CustomerForm,
  type CustomerFormValues,
  type CustomerFormProps,
} from './components/CustomerForm.js';
export {
  LoyaltyAdjustForm,
  type LoyaltyAdjustFormValues,
  type LoyaltyAdjustFormProps,
} from './components/LoyaltyAdjustForm.js';
export {
  CustomerSearchModal,
  type CustomerSearchModalProps,
} from './components/CustomerSearchModal.js';
export { LoyaltyBadge, type LoyaltyBadgeProps } from './components/LoyaltyBadge.js';
export {
  RedeemPointsModal,
  type RedeemPointsModalProps,
} from './components/RedeemPointsModal.js';
export {
  TableSelectorModal,
  type TableSelectorModalProps,
  type RestaurantTable,
} from './components/TableSelectorModal.js';
export {
  HeldOrdersModal,
  type HeldOrdersModalProps,
  type HeldOrder,
  type HeldOrderCart,
} from './components/HeldOrdersModal.js';
export {
  TabletInboxRow,
  type TabletInboxRowProps,
  type TabletOrderEntry,
} from './components/TabletInboxRow.js';
export {
  TabletOrderCard,
  type TabletOrderCardProps,
  type TabletOrderCardOrder,
  type TabletOrderItem,
  type OrderStatus,
  type KitchenStatus,
} from './components/TabletOrderCard.js';
export {
  DiscountModal,
  type DiscountModalProps,
} from './components/DiscountModal.js';
export {
  PinVerificationModal,
  type PinVerificationModalProps,
  type VerifyResult,
} from './components/PinVerificationModal.js';
export {
  CustomerCategoryBadge,
  type CustomerCategoryBadgeProps,
  type CustomerCategory,
} from './components/CustomerCategoryBadge.js';
export {
  ComboLineRow,
  type ComboLineRowProps,
  type ComboComponent,
} from './components/ComboLineRow.js';
export {
  PromotionTypeBadge,
  type PromotionTypeBadgeProps,
  type PromotionType,
} from './components/PromotionTypeBadge.js';
export {
  PromotionForm,
  emptyPromotionValues,
  validatePromotion,
  type PromotionFormProps,
  type PromotionFormValues,
  type PromotionFormOption,
  type PromotionFormErrors,
  type PromotionScope,
} from './components/PromotionForm.js';
export {
  PromotionLineRow,
  type PromotionLineRowProps,
} from './components/PromotionLineRow.js';
export {
  TenderRow,
  type TenderRowProps,
  type TenderRowMethod,
} from './components/TenderRow.js';
export {
  TenderListBuilder,
  type TenderListBuilderProps,
  type TenderEntry,
} from './components/TenderListBuilder.js';
export {
  RefundLineRow,
  type RefundLineRowProps,
  type RefundLineRowItem,
} from './components/RefundLineRow.js';
export {
  RefundTenderSplitter,
  type RefundTenderSplitterProps,
  type RefundTenderSplitterEntry,
  type RefundTenderMethodEntry,
} from './components/RefundTenderSplitter.js';
export {
  RefundReceiptModal,
  type RefundReceiptModalProps,
  type RefundReceiptTender,
} from './components/RefundReceiptModal.js';
