export {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  getSupabaseAccessToken,
  type BreakerySupabaseConfig,
} from './client.js';
export type { Database, Json } from './types.generated.js';
export * from './enums.js';
export { hasPermission, hasAnyPermission, type PermissionCode } from './rls/permissions.js';
export { loginWithPin, getSession, logoutSession, changePin } from './auth/pinAuth.js';
export type { LoginRequest, LoginResponse, LoginError, ChangePinRequest } from './auth/pinAuth.js';
