# `@breakery/supabase`

Internal client + typed API surface for the Supabase backend (Postgres + Edge
Functions + Realtime). Owned by the monorepo, consumed by `@breakery/app-pos`,
`@breakery/app-backoffice`, and `@breakery/domain` consumers.

> Workspace package (`workspace:*`). Not published to npm.

---

## Why this package exists

The official `@supabase/supabase-js` client is configured for OAuth/email
flows. The Breakery ERP authenticates via **6-digit PIN** through a custom
Edge Function that mints **HS256** JWTs, while modern Supabase CLI ships an
**ES256-only** GoTrue server. The two don't agree on `/auth/v1/user`.

This package wraps `createClient()` so that:

1. The PIN-issued access token is injected into the `Authorization` header
   via a `global.fetch` wrapper, **bypassing GoTrue entirely**.
2. `autoRefreshToken` and `persistSession` are disabled — session lifecycle
   is owned by the `auth-*` Edge Functions, not GoTrue.
3. Permission, enum, and Edge-Function call signatures are exported as
   typed helpers so apps don't reach into raw `fetch`.

---

## Quick start

```ts
import {
  getSupabaseClient,
  setSupabaseAccessToken,
  loginWithPin,
} from '@breakery/supabase';

// 1. Initialize the singleton on app boot:
const supabase = getSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// 2. Sign the user in:
const res = await loginWithPin(import.meta.env.VITE_SUPABASE_URL, {
  user_id: 'a4f1…',
  pin: '123456',
  device_type: 'pos',
});

// 3. Wire the PIN JWT into the client. All subsequent supabase.from() /
//    supabase.functions.invoke() / supabase.channel() calls now carry
//    `Authorization: Bearer <token>`.
setSupabaseAccessToken(res.auth.access_token);

// 4. Query as usual:
const { data } = await supabase.from('orders').select('*').eq('status', 'paid');
```

---

## API reference

### Client (`./client`)

| Export | Signature | Purpose |
|---|---|---|
| `getSupabaseClient` | `(config?: BreakerySupabaseConfig) => SupabaseClient<Database>` | Lazy singleton. `config` required on first call. |
| `resetSupabaseClient` | `() => void` | Clears singleton + token. Test-only. |
| `setSupabaseAccessToken` | `(token: string \| null) => void` | Inject PIN JWT into the fetch wrapper. |
| `getSupabaseAccessToken` | `() => string \| null` | Read currently injected token. |
| `BreakerySupabaseConfig` | `{ url: string; anonKey: string }` | Init config interface. |

### PIN auth (`./auth/pinAuth`)

All four functions speak to Edge Functions deployed under `/functions/v1/auth-*`.
They throw `Error & { details, status }` on any non-2xx response.

| Export | Endpoint | Auth |
|---|---|---|
| `loginWithPin(url, body)` | `POST /functions/v1/auth-verify-pin` | None (public) |
| `getSession(url, sessionToken)` | `GET /functions/v1/auth-get-session` | `x-session-token` |
| `logoutSession(url, sessionToken)` | `POST /functions/v1/auth-logout` | `x-session-token` |
| `changePin(url, sessionToken, body)` | `POST /functions/v1/auth-change-pin` | `x-session-token` |

Types: `LoginRequest`, `LoginResponse`, `LoginError`, `ChangePinRequest`.

### Permissions (`./rls/permissions`)

Pure client-side lookup against the `permissions[]` array returned by
`loginWithPin`. **No server roundtrip** — the server is the source of truth
at login time and again on each `getSession` probe.

| Export | Signature |
|---|---|
| `hasPermission(perms, required)` | `(readonly string[], PermissionCode) => boolean` |
| `hasAnyPermission(perms, required)` | `(readonly string[], readonly PermissionCode[]) => boolean` |
| `PermissionCode` | Union type — see source for the closed set. |

### Enums (`./enums`)

Mirror of Postgres enum types. Keep in sync with `supabase/migrations/*_init_*.sql`.

`ORDER_TYPES`, `PAYMENT_METHODS`, `SHIFT_STATUSES`, `ORDER_STATUSES`,
`MOVEMENT_TYPES`, `CUSTOMER_TYPES`, `LOYALTY_TXN_TYPES`.

### Generated types (`./types`)

Re-export of `Database` and `Json` from `types.generated.ts` (regenerated via
`pnpm db:types`). Subpath import: `@breakery/supabase/types`.

---

## Edge Function reference (OpenAPI 3.0 fragment)

```yaml
openapi: 3.0.3
info:
  title: Breakery PIN Auth Edge Functions
  version: 0.1.0
  description: |
    PIN-based session lifecycle. Tokens are HS256 JWTs minted by the EFs,
    not GoTrue. Authenticated routes accept the opaque session token via
    the `x-session-token` header.

servers:
  - url: '{supabaseUrl}/functions/v1'
    variables:
      supabaseUrl:
        default: http://localhost:54321
        description: Supabase project URL (no trailing slash).

paths:
  /auth-verify-pin:
    post:
      summary: Verify PIN, mint session + JWT
      operationId: loginWithPin
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/LoginRequest' }
      responses:
        '200':
          description: Login success
          content:
            application/json:
              schema: { $ref: '#/components/schemas/LoginResponse' }
        '400':
          description: missing_fields | invalid_pin_format
        '401':
          description: invalid_pin (with attempts_remaining)
        '403':
          description: user_inactive | user_not_found
        '423':
          description: account_locked (with minutes_left)
        '429':
          description: rate_limited (with retry_after_sec)

  /auth-get-session:
    get:
      summary: Probe session, return user + permissions
      operationId: getSession
      parameters:
        - in: header
          name: x-session-token
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Active session
          content:
            application/json:
              schema:
                type: object
                properties:
                  user: { $ref: '#/components/schemas/User' }
                  permissions:
                    type: array
                    items: { type: string }
        '401':
          description: session_invalid (expired, revoked, or unknown)

  /auth-logout:
    post:
      summary: Revoke session
      operationId: logoutSession
      parameters:
        - in: header
          name: x-session-token
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Always 200, even for unknown tokens (best-effort)

  /auth-change-pin:
    post:
      summary: Rotate PIN (self or admin override)
      operationId: changePin
      parameters:
        - in: header
          name: x-session-token
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ChangePinRequest' }
      responses:
        '204':
          description: PIN rotated
        '400':
          description: invalid_pin_format | pin_reused
        '401':
          description: invalid_pin (current_pin mismatch)
        '403':
          description: permission_denied (admin override without users.update)

components:
  schemas:
    User:
      type: object
      required: [id, full_name, role_code, employee_code]
      properties:
        id: { type: string, format: uuid }
        full_name: { type: string }
        role_code: { type: string }
        employee_code: { type: string }

    LoginRequest:
      type: object
      required: [user_id, pin, device_type]
      properties:
        user_id: { type: string, format: uuid }
        pin: { type: string, pattern: '^[0-9]{6}$' }
        device_type:
          type: string
          enum: [pos, backoffice]

    LoginResponse:
      type: object
      required: [user, session, auth, permissions]
      properties:
        user: { $ref: '#/components/schemas/User' }
        session:
          type: object
          required: [token, session_id, created_at]
          properties:
            token: { type: string }
            session_id: { type: string, format: uuid }
            created_at: { type: string, format: date-time }
        auth:
          type: object
          required: [access_token, refresh_token, expires_at]
          properties:
            access_token: { type: string, description: 'HS256 JWT' }
            refresh_token: { type: string }
            expires_at: { type: integer, description: 'Unix epoch seconds' }
        permissions:
          type: array
          items: { type: string }

    ChangePinRequest:
      type: object
      required: [user_id, new_pin]
      properties:
        user_id: { type: string, format: uuid }
        current_pin:
          type: string
          pattern: '^[0-9]{6}$'
          description: 'Required for self rotation; omit for admin override.'
        new_pin: { type: string, pattern: '^[0-9]{6}$' }
```

---

## Development

```sh
pnpm --filter @breakery/supabase lint       # eslint
pnpm --filter @breakery/supabase typecheck  # tsc --noEmit
pnpm --filter @breakery/supabase test       # vitest
pnpm db:types                               # regenerate types.generated.ts
```

Bumping `@supabase/supabase-js`: re-run typecheck across the monorepo —
the `Database` type and the `global.fetch` signature are both touched.
