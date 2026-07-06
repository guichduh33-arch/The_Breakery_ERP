// apps/backoffice/src/features/lan-devices/utils/ipGuard.ts
// Copie client de la validation préfixe privé (le bridge revalide côté serveur).
const PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivatePrefix(prefix: string): boolean {
  const m = PREFIX_RE.exec(prefix);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
  if (a > 255 || b > 255 || c > 255) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
