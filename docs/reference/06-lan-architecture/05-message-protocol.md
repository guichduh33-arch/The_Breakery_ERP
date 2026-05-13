# 05 — LAN Message Protocol

> **Last verified**: 2026-05-03

This page documents the wire format that travels over both transports (BroadcastChannel and Supabase Realtime). It covers the envelope, the full set of message types, payload shapes for the high-traffic ones, ordering / deduplication semantics, and the timeout / acknowledgement model.

Source of truth: `src/services/lan/lanProtocol.ts` (578 lines).

---

## 1. The envelope — `ILanMessage<T>`

Every message — whether a heartbeat, a print request, or an order update — wraps a typed payload in this envelope:

```ts
interface ILanMessage<T = unknown> {
  id: string;            // crypto.randomUUID() — used for dedup / correlation
  type: TLanMessageType; // see catalogue below
  from: string;          // sender device_id
  to?: string;           // target device_id; omitted for broadcast
  timestamp: string;     // ISO-8601 (sender clock)
  payload: T;            // type-specific shape
}
```

Source: `lanProtocol.ts:99-106`.

Construction is centralised in `createMessage()` (`lanProtocol.ts:553-567`):

```ts
export function createMessage<T>(
  type: TLanMessageType,
  fromDevice: string,
  payload: T,
  toDevice?: string,
): ILanMessage<T> {
  return {
    id: crypto.randomUUID(),
    type,
    from: fromDevice,
    to: toDevice,
    timestamp: new Date().toISOString(),
    payload,
  };
}
```

Both the hub (`lanHub.broadcast()` / `lanHub.sendTo()`) and clients (`lanClient.send()`) call `createMessage` exclusively — there is no other entry point that builds an envelope. This means every `id`, `from`, and `timestamp` is set the same way everywhere.

---

## 2. Routing semantics

| Field | Behaviour |
|-------|-----------|
| `to` undefined | **Broadcast** — every subscriber processes it (subject to per-type handlers) |
| `to === ownDeviceId` | **Direct** — recipient processes it; others drop it |
| `to !== ownDeviceId` | Dropped silently (`lanClient.ts:283-286`) |
| `from === ownDeviceId` | Self-loop — dropped silently (`lanClient.ts:279-281`, `lanHubMessageHandler.ts:24-26`) |

Self-loop suppression matters because both transports (BroadcastChannel and Realtime) **do** echo your own messages back — without the check, every device would handle its own heartbeat.

---

## 3. Catalogue of message types — `LAN_MESSAGE_TYPES`

Defined as `const` object at `lanProtocol.ts:33-88`. The string values are the on-the-wire names.

### 3.1 Connection management

| Constant | Wire value | Direction | Payload |
|----------|------------|-----------|---------|
| `HEARTBEAT` | `'heartbeat'` | any → broadcast | `IHeartbeatPayload` |
| `NODE_REGISTER` | `'node_register'` | client → hub | `{ deviceName, deviceType }` |
| `NODE_DEREGISTER` | `'node_deregister'` | client → hub (then hub re-broadcasts) | `{}` from client; `{ deviceId, deviceName, reason }` from hub |
| `HUB_ANNOUNCE` | `'hub_announce'` | hub → broadcast | reserved (no current emitter) |

### 3.2 Cart & order sync

| Constant | Wire value | Direction | Payload |
|----------|------------|-----------|---------|
| `CART_UPDATE` | `'cart_update'` | hub → broadcast | `ICartUpdatePayload` |
| `CART_CLEAR` | `'cart_clear'` | hub → broadcast | `{}` |
| `ORDER_CREATE` | `'order_create'` | hub → broadcast | `IOrderSyncPayload` |
| `ORDER_UPDATE` | `'order_update'` | hub → broadcast | `IOrderSyncPayload` |
| `ORDER_COMPLETE` | `'order_complete'` | hub → broadcast | `IOrderCompletePayload` |

### 3.3 Display sync

| Constant | Wire value | Target | Payload |
|----------|------------|--------|---------|
| `DISPLAY_CART` | `'display_cart'` | display | cart shape |
| `DISPLAY_TOTAL` | `'display_total'` | display | total shape |
| `DISPLAY_WELCOME` | `'display_welcome'` | display | `{}` |
| `DISPLAY_ORDER_READY` | `'display_order_ready'` | display | order ready shape |

### 3.4 Order status

| Constant | Wire value | Direction |
|----------|------------|-----------|
| `ORDER_STATUS` | `'order_status'` | hub → broadcast |
| `ORDER_READY` | `'order_ready'` | hub → broadcast |

### 3.5 KDS sync

| Constant | Wire value | Direction | Payload |
|----------|------------|-----------|---------|
| `KDS_NEW_ORDER` | `'kds_new_order'` | hub → kds | order items |
| `KDS_ORDER_ACK` | `'kds_order_ack'` | kds → hub | `{ order_id }` |
| `KDS_ORDER_READY` | `'kds_order_ready'` | kds → hub | `{ order_id }` |
| `KDS_ORDER_BUMP` | `'kds_order_bump'` | kds → hub | `{ order_id }` |
| `KDS_ITEM_PREPARING` | `'kds_item_preparing'` | kds → hub | `IKdsItemPreparingPayload` (Story 4.5) |
| `KDS_ITEM_READY` | `'kds_item_ready'` | kds → hub | `IKdsItemReadyPayload` (Story 4.5) |
| `KDS_TABLE_TRANSFER` | `'kds_table_transfer'` | hub → broadcast | `IKdsTableTransferPayload` |

### 3.6 Inventory & stock

| Constant | Wire value | Direction |
|----------|------------|-----------|
| `STOCK_UPDATE` | `'stock_update'` | hub → broadcast |
| `LOW_STOCK_ALERT` | `'low_stock_alert'` | hub → broadcast |

### 3.7 Sync commands

| Constant | Wire value | Direction |
|----------|------------|-----------|
| `SYNC_REQUEST` | `'sync_request'` | any → any |
| `SYNC_RESPONSE` | `'sync_response'` | any → any |
| `FULL_SYNC` | `'full_sync'` | hub → broadcast |

### 3.8 Tablet order flow

| Constant | Wire value | Direction | Payload |
|----------|------------|-----------|---------|
| `TABLET_ORDER_SUBMIT` | `'tablet_order_submit'` | tablet → hub | `ITabletOrderSubmitPayload` |
| `TABLET_ORDER_RECEIVED` | `'tablet_order_received'` | hub → tablet | `ITabletOrderReceivedPayload` |
| `ORDER_PAYMENT_COMPLETE` | `'order_payment_complete'` | hub → broadcast | `IOrderPaymentCompletePayload` |
| `ORDER_CANCELLED` | `'order_cancelled'` | hub → broadcast | `IOrderCancelledPayload` |

### 3.9 Print routing

| Constant | Wire value | Direction | Payload |
|----------|------------|-----------|---------|
| `PRINT_REQUEST` | `'print_request'` | client → hub | `IPrintRequestPayload` |
| `PRINT_RESULT` | `'print_result'` | hub → broadcast | `IPrintResultPayload` |

---

## 4. Key payload shapes

Reproduced directly from `lanProtocol.ts` for the high-traffic types.

### 4.1 `IHeartbeatPayload` (lines 111–116)

```ts
{
  deviceName: string;
  deviceType: TDeviceType;       // 'pos' | 'kds' | 'display' | 'tablet' | 'mobile' | 'desktop'
  status: 'active' | TLanNodeStatus;
  uptime: number;                 // seconds since this device's start
}
```

### 4.2 `ICartUpdatePayload` (lines 121–131)

```ts
{
  cart_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price: number;
    name: string;
  }>;
  total: number;
  customer_id?: string;
}
```

### 4.3 `ITabletOrderSubmitPayload` (lines 201–219)

```ts
{
  order_id: string;
  order_number: string;
  table_number: string | null;
  order_type: string;             // 'dine_in' | 'takeaway' | 'delivery' | 'b2b'
  waiter_name: string;
  waiter_id: string;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    modifiers?: string[];
    notes?: string;
    dispatch_station?: string;    // 'kitchen' | 'barista' — drives KDS routing
  }>;
  total: number;
  timestamp: string;
}
```

### 4.4 `ITabletOrderReceivedPayload` (lines 225–231)

```ts
{
  order_id: string;
  order_number: string;
  status: 'received' | 'error';
  message?: string;               // print warnings or error description
  timestamp: string;
}
```

### 4.5 `IPrintRequestPayload` / `IPrintResultPayload` (lines 261–277)

```ts
// Request
{
  request_id: string;             // UUID — correlate with PRINT_RESULT
  ticket_type: 'receipt' | 'kitchen' | 'barista';
  data: Record<string, unknown>;  // serialised IKitchenTicketData
  timestamp: string;
}

// Result
{
  request_id: string;             // matches request
  success: boolean;
  error?: string;
  timestamp: string;
}
```

### 4.6 KDS item-status payloads (lines 152–183)

```ts
// IKdsItemPreparingPayload (Story 4.5)
{
  order_id: string;
  order_number: string;
  item_ids: string[];
  station: TKitchenStation;       // 'kitchen' | 'barista'
  timestamp: string;
}

// IKdsItemReadyPayload (Story 4.5)
{
  order_id: string;
  order_number: string;
  item_ids: string[];
  station: TKitchenStation;
  prepared_at: string;
  timestamp: string;
}
```

### 4.7 Order completion / cancellation (lines 189–255)

```ts
// IOrderCompletePayload (Story 4.6)
{
  order_id: string;
  order_number: string;
  station: TKitchenStation;
  completed_at: string;
  timestamp: string;
}

// IOrderPaymentCompletePayload
{
  order_id: string;
  order_number: string;
  payment_method: string;
  amount: number;
  timestamp: string;
}

// IOrderCancelledPayload
{
  order_id: string;
  order_number: string;
  reason?: string;
  cancelled_by: string;
  timestamp: string;
}
```

---

## 5. Sequence numbers — what `lastMessageSeq` actually does

Despite the name, V2 **does not** implement strict per-sender sequence numbers on the wire. The envelope has no `seq` field.

What exists is a **client-side queue counter** in `useLanStore.lastMessageSeq` (`lanStore.ts:50`, incremented in `addPendingMessage` line 191–196). This counter only serves to ensure that messages added to the offline queue replay in the order they were enqueued. It is never sent over the network and never inspected by the receiver.

If true ordering matters (it does for `KDS_ITEM_PREPARING` → `KDS_ITEM_READY`), the application relies on:

1. **Single sender per resource** — only the kitchen KDS sends `KDS_ITEM_PREPARING` for kitchen items. No cross-device race.
2. **Idempotent receivers** — handlers are written to be safe under reordering / replay (e.g. setting an item to `'preparing'` when it is already `'preparing'` is a no-op).
3. **Database as authoritative** — every meaningful state change is also persisted; LAN messages are advisory.

---

## 6. Acknowledgements (ACK / NACK)

Only **two** message types have explicit ACKs:

| Request | ACK | NACK |
|---------|-----|------|
| `PRINT_REQUEST` | `PRINT_RESULT` with `success: true` | `PRINT_RESULT` with `success: false, error` |
| `TABLET_ORDER_SUBMIT` | `TABLET_ORDER_RECEIVED` with `status: 'received'` | `TABLET_ORDER_RECEIVED` with `status: 'error', message` |

Other request-shaped messages (`KDS_ORDER_BUMP`, `NODE_REGISTER`, etc.) are fire-and-forget. Their effects are observable elsewhere:

- `NODE_REGISTER` → device appears in the hub's `connectedDevices` list (visible at `/settings/lan`)
- `KDS_ORDER_BUMP` → next refetch from `kds_order_queue` reflects the bump

Senders correlate ACKs to their requests via the `request_id` (PRINT) or `order_id`/`order_number` (tablet). There is no built-in correlation of arbitrary message types beyond `id` lookup if the sender chooses to track it.

---

## 7. Timeouts

The protocol itself has **no per-message timeout**. Timeouts live at higher layers:

| Layer | Where | Timeout |
|-------|-------|---------|
| Realtime channel subscription | Supabase client default | ~10 s before `TIMED_OUT` is emitted |
| `update_lan_node_heartbeat` RPC | `lanProtocol.ts:323-340` | Default Supabase REST timeout (~30 s) |
| Network probe (discovery) | `networkDiscovery.ts:21` | 1 500 ms per probe |
| Print server scan | `networkDiscovery.ts:264` | 60 000 ms total |
| Heartbeat staleness | `useLanHub({ staleTimeout })` | 120 000 ms default |

If you send a `PRINT_REQUEST` and never receive a `PRINT_RESULT`, the caller is on its own — there is no automatic resend. UI layers (e.g. KDS print button) typically show a spinner with their own ~10 s timeout and then surface "no response" to the operator.

---

## 8. Idempotency expectations per type

| Type | Idempotent? | Reasoning |
|------|-------------|-----------|
| `HEARTBEAT` | Yes | Replay just re-stamps `lastHeartbeat` |
| `NODE_REGISTER` | Yes | `addConnectedDevice` replaces existing entry by `deviceId` |
| `NODE_DEREGISTER` | Yes | `removeConnectedDevice` is no-op if device already gone |
| `PRINT_REQUEST` | **No** | Replay would print a duplicate ticket — sender must deduplicate by `request_id` if they retry |
| `TABLET_ORDER_SUBMIT` | **No** | Replay would re-dispatch to KDS and re-print — but the hub guards against unknown senders, not against duplicate IDs |
| `KDS_ITEM_PREPARING` / `KDS_ITEM_READY` | Yes | Setting same status twice is a no-op |
| `ORDER_PAYMENT_COMPLETE` | Yes | UI just refreshes; DB has the authoritative payment row |
| `STOCK_UPDATE` / `LOW_STOCK_ALERT` | Yes | Receivers refetch from DB |
| `DISPLAY_CART` / `DISPLAY_TOTAL` | Yes | Pure UI state, last-write-wins |
| `KDS_ORDER_BUMP` | Yes | Bumping an already-bumped order is a no-op |

For the two non-idempotent types, **sender retry policy is "do not auto-retry"**. Operators trigger manual re-attempts. This avoids accidentally double-printing tickets or double-dispatching orders.

---

## 9. Adding a new message type — checklist

1. Add the constant to `LAN_MESSAGE_TYPES` (`lanProtocol.ts:33-88`). Use `snake_case` for the wire value.
2. Define the payload interface (`I<Name>Payload`) and export it.
3. On the **sender** side, call `lanClient.send(LAN_MESSAGE_TYPES.NEW_TYPE, payload)` (clients) or `lanHub.broadcast/sendTo(...)` (hub).
4. On the **receiver** side, register a handler with `lanClient.on(LAN_MESSAGE_TYPES.NEW_TYPE, msg => ...)` (clients) or add a `case` in `lanHubMessageHandler.processMessage()` (hub).
5. Decide ACK semantics: if the message is a request, define a corresponding `*_RESULT` or `*_RECEIVED` type and broadcast it from the handler.
6. Document in this file's catalogue (Section 3) and the lan-specialist skill's "Message Types Reference" table.

> **Do not** add ad-hoc message types in feature code without registering the constant — handlers will silently ignore unknown types (`lanClient.ts:296` logs a warning), so missing registrations look like silent no-ops.

---

## 10. Cross-references

- Hub broker: `01-hub-client-model.md`
- Heartbeat-specific timing: `03-heartbeat-and-state.md`
- Print-routing flow that uses `PRINT_REQUEST` / `PRINT_RESULT`: `04-print-routing.md`
- Device-type taxonomy referenced in `IHeartbeatPayload.deviceType`: `06-device-types.md`
