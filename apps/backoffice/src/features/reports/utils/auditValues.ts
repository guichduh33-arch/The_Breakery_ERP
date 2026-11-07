// Normalisation prudente des anciennes traces et de leurs détails techniques.
export function auditRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function auditNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
const SECRET_KEY = /^(?:p_)?(?:pin|manager_pin|new_pin|old_pin|pin_hash|password|password_hash|token|jwt|access_token|refresh_token|session_token|session_token_hash|authorization|api_key|service_role_key|secret|secret_key)$/i;
export function auditSafeDetails(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, function (this: unknown, key: string, item: unknown) {
      const parent = auditRecord(this);
      const field = parent.key ?? parent.field;
      const secretChange = typeof field === 'string' && SECRET_KEY.test(field)
        && ['old', 'new', 'before', 'after', 'value'].includes(key);
      return SECRET_KEY.test(key) || secretChange ? '[redacted]' : item;
    }, 2);
  } catch {
    return '[unserializable]';
  }
}
