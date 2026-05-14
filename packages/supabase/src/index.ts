export {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  setSupabaseKioskAccessToken,
  getSupabaseAccessToken,
  type BreakerySupabaseConfig,
} from './client.js';
export type { Database, Json } from './types.generated.js';
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
