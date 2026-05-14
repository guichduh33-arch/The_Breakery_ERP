// packages/domain/src/lan/index.ts
// Session 13 / Phase 5.A — barrel for LAN domain primitives.

export {
  MessageDedup,
  type MessageDedupOptions,
} from './messageDedup.js';

export {
  isLanMessage,
  createMessage,
  type LanMessage,
  type LanMessageType,
  type OrderUpdateMessage,
  type KdsBumpMessage,
  type KdsRecallMessage,
  type KdsUndoMessage,
  type PrintRequestMessage,
  type PrintResultMessage,
  type DisplayCartMessage,
  type DisplayOrderReadyMessage,
  type HeartbeatMessage,
  type DeviceRegisteredMessage,
} from './protocol.js';
