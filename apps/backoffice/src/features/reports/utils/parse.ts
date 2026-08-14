// apps/backoffice/src/features/reports/utils/parse.ts
//
// Lot A1 (campagne Reports 2026-08-15) — helpers de normalisation des
// enveloppes JSONB rendues par les RPC de rapport. `supabase.rpc` est typé
// `Json` : un cast `as unknown as X` ne vérifie rien, et un payload dégradé
// (période vide, fallback serveur partiel) traverse jusqu'au rendu. Ces
// helpers garantissent la forme déclarée par l'interface du hook.

export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}
