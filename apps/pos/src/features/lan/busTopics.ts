// Contrat partagé sans IO : validation identique sur le terminal et le hub.
export { parseOrderFired, parseOrderItemStatus } from '@breakery/domain';
export type {
  BusModifierLine,
  BusFiredItem,
  OrderFiredPayload,
  BusKitchenStatus,
  OrderItemStatusPayload,
  OrderPaidOfflinePayload,
} from '@breakery/domain';
