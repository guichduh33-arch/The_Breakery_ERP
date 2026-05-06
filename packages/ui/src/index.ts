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
} from './primitives/Card.js';
export { Toaster } from './primitives/Toast.js';

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
