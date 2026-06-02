export {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  setSupabaseKioskAccessToken,
  getSupabaseAccessToken,
  type BreakerySupabaseConfig,
} from './client.js';
export type { Database, Json } from './types.generated.js';
// Project-wide typed Supabase client. Re-exported here so app/edge code can type
// a client as SupabaseClient<Database> WITHOUT taking a direct dep on
// @supabase/supabase-js (keeps apps decoupled — cf. apps/pos lanHub.ts decoupling).
import type { SupabaseClient as SupabaseClientGeneric } from '@supabase/supabase-js';
import type { Database as DatabaseGenerated } from './types.generated.js';
export type TypedSupabaseClient = SupabaseClientGeneric<DatabaseGenerated>;
export * from './enums.js';
export { hasPermission, hasAnyPermission, type PermissionCode } from './rls/permissions.js';
export { loginWithPin, getSession, logoutSession, changePin } from './auth/pinAuth.js';
export type { LoginRequest, LoginResponse, LoginError, ChangePinRequest } from './auth/pinAuth.js';
export { issueKioskJwt } from './auth/kioskAuth.js';
export type {
  KioskScope,
  KioskIssueRequest,
  KioskIssueResponse,
  KioskIssueError,
} from './auth/kioskAuth.js';
